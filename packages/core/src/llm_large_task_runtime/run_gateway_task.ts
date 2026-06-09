import { createTokenEstimator } from './token_estimator.js'
import { InMemoryLlmGatewayTelemetrySink, createCompositeTelemetrySink } from './gateway_telemetry.js'
import { planTokenAwareReduceGroups } from './gateway_chunk_planner.js'
import {
  LlmGatewayError,
  type LlmGatewayDebugEvent,
  type JudgeResult,
  type LlmGatewayRunResult,
  type LlmGatewayTask,
  type LlmStepContext,
  type RunLlmGatewayTaskOptions,
  type ValidationResult,
} from './gateway_types.js'
import { mapWithWorkerQueue, throwIfStopped } from './worker_queue.js'

export async function runLlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  input: TInput,
  options: RunLlmGatewayTaskOptions = {},
): Promise<LlmGatewayRunResult<TOutput>> {
  assertTaskContract(task)

  const memoryTelemetry = new InMemoryLlmGatewayTelemetrySink()
  const telemetry = createCompositeTelemetrySink(memoryTelemetry, options.telemetry)
  const llm = options.llm ?? unavailableLlm
  const estimateTokens = options.estimateTokens ?? createTokenEstimator()

  try {
    await recordDebug(task, { type: 'task_started', taskName: task.name, mode: task.mode })
    throwIfStopped(options.signal)

    const graph = task.buildGraph ? await task.buildGraph(input) : null
    const projection = await task.project(input, graph)
    const projectionTokens = estimateTokens(toPromptString(projection))
    await recordDebug(task, {
      type: 'projection_built',
      taskName: task.name,
      itemCount: getProjectionItemCount(task, projection),
      estimatedTokens: projectionTokens,
    })

    throwIfStopped(options.signal)
    const plannedChunks = await task.chunkPlanner.plan({
      projection,
      tokenBudget: task.tokenBudget,
      estimateTokens,
      signal: options.signal,
    })
    const chunks = await validateAndSplitChunks(task, projection, plannedChunks, estimateTokens, options.signal, 0)
    const chunkTokenSizes = chunks.map((chunk) => estimateTokens(getChunkPrompt(task, chunk)))
    await recordDebug(task, {
      type: 'chunks_planned',
      taskName: task.name,
      chunkCount: chunks.length,
      chunkTokenSizes,
      targetInputTokens: task.tokenBudget.targetInputTokens,
      maxInputTokens: task.tokenBudget.maxInputTokens,
      totalChunkTokens: chunkTokenSizes.reduce((sum, tokenCount) => sum + tokenCount, 0),
      maxChunkTokens: Math.max(0, ...chunkTokenSizes),
    })

    let completedMapChunks = 0
    let failedMapChunks = 0
    const totalMapChunks = chunks.length
    const mapOutputs = await mapWithWorkerQueue(
      chunks,
      task.execution.mapConcurrency,
      async (chunk) => {
        const chunkId = getChunkId(task, chunk)
        try {
          const output = await runMapStep(task, projection, chunk, llm, telemetry, options.signal)
          completedMapChunks += 1
          await recordDebug(task, {
            type: 'map_progress',
            taskName: task.name,
            completedChunks: completedMapChunks,
            totalChunks: totalMapChunks,
            failedChunks: failedMapChunks,
            lastChunkId: chunkId,
          })
          return output
        } catch (error) {
          failedMapChunks += 1
          await recordDebug(task, {
            type: 'map_progress',
            taskName: task.name,
            completedChunks: completedMapChunks,
            totalChunks: totalMapChunks,
            failedChunks: failedMapChunks,
            lastChunkId: chunkId,
          })
          throw error
        }
      },
      options.signal,
    )

    throwIfStopped(options.signal)
    const output = task.mode === 'independent_map' || task.mode === 'optional_refinement'
      ? task.deterministicMerge!(mapOutputs)
      : task.skipReduceWhenSingleMapOutput && mapOutputs.length === 1
        ? mapOutputs[0] as unknown as TOutput
        : await runTreeReduce(task, mapOutputs, llm, telemetry, estimateTokens, options.signal)

    const checked = await validateJudgeAndRepair(task, {
      projection,
      chunks,
      mapOutputs,
      output,
      llm,
      telemetry,
      signal: options.signal,
    })

    await recordDebug(task, { type: 'task_finished', taskName: task.name, status: 'success' })
    return {
      status: 'success',
      output: checked.output,
      validation: checked.validation,
      judge: checked.judge,
      telemetry: memoryTelemetry.snapshot(),
    }
  } catch (error) {
    const normalized = normalizeError(error)
    const stopped = normalized.code === 'TASK_STOPPED'
    await recordDebug(task, stopped
      ? { type: 'task_stopped', taskName: task.name, reason: normalized.message }
      : { type: 'task_finished', taskName: task.name, status: 'failed' })
    telemetry.record({ type: 'stage_failed', stage: 'task', code: normalized.code, message: normalized.message, details: normalized.details })
    throw normalized
  }
}

async function validateAndSplitChunks<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  projection: TProjection,
  chunks: TChunk[],
  estimateTokens: (prompt: string) => number,
  signal?: AbortSignal,
  depth = 0,
): Promise<TChunk[]> {
  if (chunks.length === 0 && !task.allowEmptyChunks) {
    throw new LlmGatewayError('EMPTY_CHUNK_LIST', 'Chunk planner returned no chunks.')
  }

  const projectionIds = task.getProjectionItemIds ? new Set(task.getProjectionItemIds(projection)) : null
  const result: TChunk[] = []

  for (const chunk of chunks) {
    throwIfStopped(signal)
    const chunkId = getChunkId(task, chunk)
    if (!chunkId) throw new LlmGatewayError('CHUNK_ID_MISSING', 'Chunk planner returned a chunk without a stable id.')

    const prompt = getChunkPrompt(task, chunk)
    const tokenCount = estimateTokens(prompt)
    if (tokenCount > task.tokenBudget.maxInputTokens) {
      if (!task.chunkPlanner.splitOversizedChunk) {
        throw new LlmGatewayError('CHUNK_TOKEN_LIMIT_EXCEEDED', 'Chunk prompt exceeds max input tokens.', {
          details: { chunkId, tokenCount, maxInputTokens: task.tokenBudget.maxInputTokens },
        })
      }
      if (depth >= task.execution.maxChunkSplitDepth) {
        throw new LlmGatewayError('CHUNK_TOKEN_LIMIT_EXCEEDED', 'Chunk split exceeded max depth while still over token limit.', {
          details: { chunkId, tokenCount, maxInputTokens: task.tokenBudget.maxInputTokens, maxChunkSplitDepth: task.execution.maxChunkSplitDepth },
        })
      }
      const split = await task.chunkPlanner.splitOversizedChunk({
        chunk,
        projection,
        tokenBudget: task.tokenBudget,
        estimateTokens,
        signal,
      })
      if (split.length === 0) {
        throw new LlmGatewayError('CHUNK_SPLIT_NO_PROGRESS', 'Chunk splitter returned no chunks for an oversized chunk.', {
          details: { chunkId, tokenCount, maxInputTokens: task.tokenBudget.maxInputTokens },
        })
      }
      const splitTokenCounts = split.map((splitChunk) => estimateTokens(getChunkPrompt(task, splitChunk)))
      if (splitTokenCounts.every((splitTokenCount) => splitTokenCount >= tokenCount)) {
        throw new LlmGatewayError('CHUNK_SPLIT_NO_PROGRESS', 'Chunk splitter did not reduce oversized chunk token counts.', {
          details: { chunkId, tokenCount, splitTokenCounts, maxInputTokens: task.tokenBudget.maxInputTokens },
        })
      }
      result.push(...await validateAndSplitChunks(task, projection, split, estimateTokens, signal, depth + 1))
      continue
    }

    if (projectionIds && task.getChunkItemIds) {
      for (const itemId of task.getChunkItemIds(chunk)) {
        if (!projectionIds.has(itemId)) {
          throw new LlmGatewayError('CHUNK_ITEM_ID_UNKNOWN', 'Chunk planner referenced an item id outside the Projection.', {
            details: { chunkId, itemId },
          })
        }
      }
    }

    result.push(chunk)
  }

  return result
}

async function runMapStep<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  projection: TProjection,
  chunk: TChunk,
  llm: LlmStepContext['llm'],
  telemetry: LlmStepContext['telemetry'],
  signal?: AbortSignal,
): Promise<TMapOutput> {
  const chunkId = getChunkId(task, chunk)
  return retryStep(task.execution.maxRetries, async (attempt, attemptSignal) => {
    const startedAt = Date.now()
    await recordDebug(task, { type: 'map_started', taskName: task.name, chunkId, attempt })
    try {
      const output = await withTimeout(
        () => task.mapper(chunk, { taskName: task.name, stage: 'map', attempt, signal: attemptSignal, llm, telemetry }),
        task.execution.timeoutMs,
        attemptSignal,
      )
      const validated = task.validateMapOutput?.(output, { chunk, stage: 'post_map' }) ?? { fatalIssues: [], warnings: [] }
      if (validated.fatalIssues.length > 0) {
        await recordDebug(task, {
          type: 'map_validation_failed',
          taskName: task.name,
          chunkId,
          attempt,
          fatalCount: validated.fatalIssues.length,
          warningCount: validated.warnings.length,
        })
        if (!task.repairMapOutput) {
          throw new LlmGatewayError('VALIDATION_FAILED', 'Map output failed validation and no map repair step was provided.', { validation: validated })
        }
        const repaired = await task.repairMapOutput({
          projection,
          chunk,
          output,
          validation: validated,
        }, { taskName: task.name, stage: 'repair', attempt, signal: attemptSignal, llm, telemetry })
        const repairedValidation = task.validateMapOutput?.(repaired, { chunk, stage: 'post_map_repair' }) ?? { fatalIssues: [], warnings: [] }
        if (repairedValidation.fatalIssues.length > 0) {
          throw new LlmGatewayError('VALIDATION_FAILED', 'Map output still failed validation after repair.', { validation: repairedValidation })
        }
        await recordDebug(task, {
          type: 'map_repair_finished',
          taskName: task.name,
          chunkId,
          attempt,
          fatalCount: repairedValidation.fatalIssues.length,
          warningCount: repairedValidation.warnings.length,
        })
        await recordDebug(task, {
          type: 'map_finished',
          taskName: task.name,
          chunkId,
          durationMs: Date.now() - startedAt,
          outputSummary: task.summarizeMapOutput?.(repaired) ?? summarizeUnknown(repaired),
        })
        return repaired
      }
      await recordDebug(task, {
        type: 'map_finished',
        taskName: task.name,
        chunkId,
        durationMs: Date.now() - startedAt,
        outputSummary: task.summarizeMapOutput?.(output) ?? summarizeUnknown(output),
      })
      return output
    } catch (error) {
      await recordDebug(task, { type: 'map_failed', taskName: task.name, chunkId, attempt, error: readableError(error) })
      throw error
    }
  }, telemetry, 'map', signal)
}

async function runTreeReduce<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  items: TMapOutput[],
  llm: LlmStepContext['llm'],
  telemetry: LlmStepContext['telemetry'],
  estimateTokens: (prompt: string) => number,
  signal?: AbortSignal,
): Promise<TOutput> {
  if (!task.reducer) {
    throw new LlmGatewayError('TASK_CONTRACT_INVALID', 'Task must provide reducer or deterministicMerge.')
  }
  if (items.length === 0) {
    throw new LlmGatewayError('EMPTY_REDUCE_INPUT', 'Tree reduce cannot run with zero map outputs.')
  }

  let current: Array<TMapOutput | TOutput> = [...items]
  let level = 1
  while (current.length > 1 || level === 1) {
    if (level > task.tokenBudget.maxReduceDepth) {
      if (task.deterministicReduceFallback) {
        const reason = 'reduce tree exceeded max depth'
        telemetry.record({ type: 'fallback_used', stage: 'reduce', fallbackType: 'deterministic_reduce', reason, level, groupId: `L${level}:fallback` })
        return task.deterministicReduceFallback({ items: current, reason, level, groupId: `L${level}:fallback` })
      }
      throw new LlmGatewayError('TREE_REDUCE_DEPTH_EXCEEDED', 'Tree reduce exceeded max depth.', {
        details: { level, itemCount: current.length, maxReduceDepth: task.tokenBudget.maxReduceDepth },
      })
    }

    const groups = splitReduceGroupsToFitTokenBudget(
      task,
      planTokenAwareReduceGroups(current, {
        tokenBudget: task.tokenBudget,
        estimateTokens,
        buildPrompt: (group) => task.getReducePrompt?.(group, { level, groupId: `L${level}:G?` }) ?? toPromptString(group),
      }),
      level,
      estimateTokens,
    )
    const groupTokenSizes = groups.map((group, index) => estimateTokens(task.getReducePrompt?.(group, { level, groupId: `L${level}:G${index + 1}` }) ?? toPromptString(group)))
    await recordDebug(task, {
      type: 'reduce_groups_planned',
      taskName: task.name,
      level,
      groupCount: groups.length,
      groupItemCounts: groups.map((group) => group.length),
      groupTokenSizes,
      targetInputTokens: task.tokenBudget.reduceTargetInputTokens ?? task.tokenBudget.targetInputTokens,
      maxInputTokens: task.tokenBudget.maxInputTokens,
    })
    let completedReduceGroups = 0
    let failedReduceGroups = 0
    const totalReduceGroups = groups.length
    const reduced = await mapWithWorkerQueue(
      groups,
      task.execution.reduceConcurrency,
      async (group, index) => {
        const groupId = `L${level}:G${index + 1}`
        if (group.length === 1 && current.length > 1) {
          completedReduceGroups += 1
          await recordDebug(task, {
            type: 'reduce_progress',
            taskName: task.name,
            level,
            completedGroups: completedReduceGroups,
            totalGroups: totalReduceGroups,
            failedGroups: failedReduceGroups,
            lastGroupId: groupId,
          })
          return group[0] as TOutput
        }
        try {
          const output = await runReduceGroup(task, group, level, groupId, llm, telemetry, estimateTokens, signal)
          completedReduceGroups += 1
          await recordDebug(task, {
            type: 'reduce_progress',
            taskName: task.name,
            level,
            completedGroups: completedReduceGroups,
            totalGroups: totalReduceGroups,
            failedGroups: failedReduceGroups,
            lastGroupId: groupId,
          })
          return output
        } catch (error) {
          failedReduceGroups += 1
          await recordDebug(task, {
            type: 'reduce_progress',
            taskName: task.name,
            level,
            completedGroups: completedReduceGroups,
            totalGroups: totalReduceGroups,
            failedGroups: failedReduceGroups,
            lastGroupId: groupId,
          })
          throw error
        }
      },
      signal,
    )

    if (reduced.length >= current.length && current.length > 1 && task.deterministicReduceFallback) {
      const reason = 'reduce tree made no progress'
      telemetry.record({ type: 'fallback_used', stage: 'reduce', fallbackType: 'deterministic_reduce', reason, level, groupId: `L${level}:fallback` })
      return task.deterministicReduceFallback({ items: current, reason, level, groupId: `L${level}:fallback` })
    }
    if (reduced.length === 1) return reduced[0]!
    current = reduced
    level += 1
  }

  return current[0] as TOutput
}

async function runReduceGroup<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  items: Array<TMapOutput | TOutput>,
  level: number,
  groupId: string,
  llm: LlmStepContext['llm'],
  telemetry: LlmStepContext['telemetry'],
  estimateTokens: (prompt: string) => number,
  signal?: AbortSignal,
): Promise<TOutput> {
  const prompt = task.getReducePrompt?.(items, { level, groupId }) ?? toPromptString(items)
  const tokenCount = estimateTokens(prompt)
  if (tokenCount > task.tokenBudget.maxInputTokens) {
    throw new LlmGatewayError('REDUCE_TOKEN_LIMIT_EXCEEDED', 'Reduce prompt exceeds max input tokens.', {
      details: { level, groupId, tokenCount, maxInputTokens: task.tokenBudget.maxInputTokens },
    })
  }

  try {
    return await retryStep(task.execution.maxRetries, async (attempt, attemptSignal) => {
      const startedAt = Date.now()
      await recordDebug(task, {
        type: 'reduce_started',
        taskName: task.name,
        level,
        groupId,
        itemCount: items.length,
        attempt,
        estimatedTokens: tokenCount,
        targetInputTokens: task.tokenBudget.reduceTargetInputTokens ?? task.tokenBudget.targetInputTokens,
        maxInputTokens: task.tokenBudget.maxInputTokens,
      })
      try {
        const output = await withTimeout(
          () => task.reducer!(items, { taskName: task.name, stage: 'reduce', attempt, level, groupId, signal: attemptSignal, llm, telemetry }),
          task.execution.timeoutMs,
          attemptSignal,
        )
        if (task.validateReduceOutput) {
          const validation = task.validate(output, { stage: 'post_merge' })
          if (validation.fatalIssues.length > 0) {
            await recordDebug(task, {
              type: 'reduce_validation_failed',
              taskName: task.name,
              level,
              groupId,
              attempt,
              fatalCount: validation.fatalIssues.length,
              warningCount: validation.warnings.length,
            })
            throw new LlmGatewayError('VALIDATION_FAILED', 'Reducer output failed validation.', { validation })
          }
        }
        await recordDebug(task, {
          type: 'reduce_finished',
          taskName: task.name,
          level,
          groupId,
          durationMs: Date.now() - startedAt,
          outputSummary: task.summarizeOutput?.(output) ?? summarizeUnknown(output),
        })
        return output
      } catch (error) {
        await recordDebug(task, { type: 'reduce_failed', taskName: task.name, level, groupId, attempt, error: readableError(error) })
        throw error
      }
    }, telemetry, 'reduce', signal)
  } catch (error) {
    if (!task.deterministicReduceFallback) {
      throw new LlmGatewayError('REDUCE_FAILED', 'Reduce failed and no deterministic fallback was provided.', { cause: error })
    }
    const reason = readableError(error)
    telemetry.record({ type: 'fallback_used', stage: 'reduce', fallbackType: 'deterministic_reduce', reason, level, groupId })
    return task.deterministicReduceFallback({ items, reason, level, groupId })
  }
}

async function validateJudgeAndRepair<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  input: {
    projection: TProjection
    chunks: TChunk[]
    mapOutputs: TMapOutput[]
    output: TOutput
    llm: LlmStepContext['llm']
    telemetry: LlmStepContext['telemetry']
    signal?: AbortSignal
  },
): Promise<{ output: TOutput; validation: ValidationResult; judge?: JudgeResult }> {
  let output = input.output
  let validation = task.validate(output, { stage: 'post_merge' })
  await recordValidation(task, validation, 'post_merge')
  let judge = task.judge
    ? await runJudgeStep(task, output, input.llm, input.telemetry, input.signal)
    : undefined
  if (validation.fatalIssues.length === 0 && (!judge || judge.fatalIssues.length === 0)) return { output, validation, judge }

  if (!task.repair) {
    if (validation.fatalIssues.length > 0) {
      throw new LlmGatewayError('VALIDATION_FAILED', 'Validation failed and no repair step was provided.', {
        validation,
      })
    }
    throw new LlmGatewayError('JUDGE_FAILED', 'Judge returned fatal issues and no repair step was provided.', {
      details: { fatalIssues: judge?.fatalIssues ?? [] },
    })
  }

  for (let attempt = 1; attempt <= task.execution.maxRepairAttempts; attempt += 1) {
    throwIfStopped(input.signal)
    await recordDebug(task, {
      type: 'repair_started',
      taskName: task.name,
      attempt,
      issueCount: validation.fatalIssues.length + validation.warnings.length,
    })
    output = await retryStep(task.execution.maxRetries, async (retryAttempt, attemptSignal) => withTimeout(
      () => task.repair!({
        projection: input.projection,
        chunks: input.chunks,
        mapOutputs: input.mapOutputs,
        output,
        validation,
        judge,
      }, { taskName: task.name, stage: 'repair', attempt: retryAttempt, signal: attemptSignal, llm: input.llm, telemetry: input.telemetry }),
      task.execution.timeoutMs,
      attemptSignal,
    ), input.telemetry, 'repair', input.signal)
    validation = task.validate(output, { stage: 'post_repair' })
    await recordValidation(task, validation, 'post_repair')
    judge = task.judge
      ? await runJudgeStep(task, output, input.llm, input.telemetry, input.signal)
      : undefined
    await recordDebug(task, {
      type: 'repair_finished',
      taskName: task.name,
      attempt,
      fatalCount: validation.fatalIssues.length,
      warningCount: validation.warnings.length,
    })
    if (validation.fatalIssues.length === 0 && (!judge || judge.fatalIssues.length === 0)) return { output, validation, judge }
  }

  if (validation.fatalIssues.length > 0) {
    throw new LlmGatewayError('VALIDATION_FAILED', 'Validation failed after max repair attempts.', {
      validation,
    })
  }
  throw new LlmGatewayError('JUDGE_FAILED', 'Judge returned fatal issues after max repair attempts.', {
    details: { fatalIssues: judge?.fatalIssues ?? [] },
  })
}

async function runJudgeStep<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  output: TOutput,
  llm: LlmStepContext['llm'],
  telemetry: LlmStepContext['telemetry'],
  signal?: AbortSignal,
) {
  const judge = await retryStep(task.execution.maxRetries, async (attempt, attemptSignal) => withTimeout(
    () => task.judge!(output, { taskName: task.name, stage: 'judge', attempt, signal: attemptSignal, llm, telemetry }),
    task.execution.timeoutMs,
    attemptSignal,
  ), telemetry, 'judge', signal)
  await recordDebug(task, {
    type: 'judge_finished',
    taskName: task.name,
    score: judge.score,
    warningCount: judge.warnings.length,
  })
  return judge
}

async function retryStep<T>(
  maxRetries: number,
  run: (attempt: number, signal: AbortSignal) => Promise<T>,
  telemetry: LlmStepContext['telemetry'],
  stage: string,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const controller = new AbortController()
    const combined = combineAbortSignals(signal, controller.signal)
    try {
      throwIfStopped(combined)
      return await run(attempt, combined)
    } catch (error) {
      controller.abort(error)
      lastError = error
      const normalized = normalizeStageError(error, stage)
      if (normalized.code === 'TASK_STOPPED' || attempt > maxRetries) {
        telemetry.record({ type: 'stage_failed', stage, code: normalized.code, message: normalized.message, details: normalized.details })
        throw normalized
      }
      telemetry.record({ type: 'retry', stage, attempt, message: normalized.message })
    }
  }
  throw normalizeError(lastError)
}

async function withTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = Math.max(1, Math.floor(timeoutMs))
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', stop)
      reject(new LlmGatewayError('TIMEOUT', `LLM map/reduce step timed out after ${timeout}ms.`))
    }, timeout)
    timer.unref?.()

    const stop = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new LlmGatewayError('TASK_STOPPED', 'LLM map/reduce task was stopped.'))
    }
    signal?.addEventListener('abort', stop, { once: true })

    run().then((value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      resolve(value)
    }, (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      reject(error)
    })
  })
}

function splitReduceGroupsToFitTokenBudget<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  groups: Array<Array<TMapOutput | TOutput>>,
  level: number,
  estimateTokens: (prompt: string) => number,
): Array<Array<TMapOutput | TOutput>> {
  const result: Array<Array<TMapOutput | TOutput>> = []
  groups.forEach((group, index) => {
    result.push(...splitReduceGroupToFitTokenBudget(task, group, level, `L${level}:G${index + 1}`, estimateTokens))
  })
  return result
}

function splitReduceGroupToFitTokenBudget<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  group: Array<TMapOutput | TOutput>,
  level: number,
  groupId: string,
  estimateTokens: (prompt: string) => number,
): Array<Array<TMapOutput | TOutput>> {
  const prompt = task.getReducePrompt?.(group, { level, groupId }) ?? toPromptString(group)
  const tokenCount = estimateTokens(prompt)
  if (tokenCount <= task.tokenBudget.maxInputTokens) return [group]
  if (group.length <= 1) {
    throw new LlmGatewayError('REDUCE_TOKEN_LIMIT_EXCEEDED', 'Reduce prompt exceeds max input tokens.', {
      details: { level, groupId, tokenCount, maxInputTokens: task.tokenBudget.maxInputTokens },
    })
  }
  const midpoint = Math.ceil(group.length / 2)
  return [
    ...splitReduceGroupToFitTokenBudget(task, group.slice(0, midpoint), level, `${groupId}.1`, estimateTokens),
    ...splitReduceGroupToFitTokenBudget(task, group.slice(midpoint), level, `${groupId}.2`, estimateTokens),
  ]
}

async function recordValidation<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  validation: ValidationResult,
  stage: 'post_merge' | 'post_repair',
): Promise<void> {
  await recordDebug(task, {
    type: 'validation_finished',
    taskName: task.name,
    stage,
    fatalCount: validation.fatalIssues.length,
    warningCount: validation.warnings.length,
  })
}

async function recordDebug<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  event: LlmGatewayDebugEvent,
): Promise<void> {
  await task.debugRecorder.record(event)
}

function getProjectionItemCount<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  projection: TProjection,
): number {
  if (task.getProjectionItemCount) return task.getProjectionItemCount(projection)
  if (Array.isArray(projection)) return projection.length
  if (isObjectWithArray(projection, 'items')) return projection.items.length
  return 0
}

function getChunkId<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  chunk: TChunk,
): string {
  if (task.getChunkId) return task.getChunkId(chunk)
  if (isObjectWithString(chunk, 'id')) return chunk.id
  return ''
}

function getChunkPrompt<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  chunk: TChunk,
): string {
  if (task.getChunkPrompt) return task.getChunkPrompt(chunk)
  if (isObjectWithString(chunk, 'prompt')) return chunk.prompt
  return toPromptString(chunk)
}

function assertTaskContract<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
): void {
  if (!task.reducer && !task.deterministicMerge) {
    throw new LlmGatewayError('TASK_CONTRACT_INVALID', 'Task must provide either reducer or deterministicMerge.')
  }
  if ((task.mode === 'independent_map' || task.mode === 'optional_refinement') && !task.deterministicMerge) {
    throw new LlmGatewayError('TASK_CONTRACT_INVALID', `${task.mode} tasks must provide deterministicMerge.`)
  }
  if ((task.mode === 'independent_map_reduce' || task.mode === 'semantic_map_reduce') && !task.reducer) {
    throw new LlmGatewayError('TASK_CONTRACT_INVALID', `${task.mode} tasks must provide reducer.`)
  }
}

function combineAbortSignals(parent: AbortSignal | undefined, child: AbortSignal): AbortSignal {
  if (!parent) return child
  if (parent.aborted) return parent
  const controller = new AbortController()
  const abort = () => controller.abort(parent.reason)
  parent.addEventListener('abort', abort, { once: true })
  child.addEventListener('abort', abort, { once: true })
  return controller.signal
}

function normalizeError(error: unknown): LlmGatewayError {
  if (error instanceof LlmGatewayError) return error
  return new LlmGatewayError('REDUCE_FAILED', readableError(error), { cause: error })
}

function normalizeStageError(error: unknown, stage: string): LlmGatewayError {
  if (error instanceof LlmGatewayError) return error
  if (stage === 'map') return new LlmGatewayError('MAP_FAILED', readableError(error), { cause: error })
  if (stage === 'repair') return new LlmGatewayError('REPAIR_FAILED', readableError(error), { cause: error })
  if (stage === 'judge') return new LlmGatewayError('JUDGE_FAILED', readableError(error), { cause: error })
  return new LlmGatewayError('REDUCE_FAILED', readableError(error), { cause: error })
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function summarizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (value && typeof value === 'object') return { type: 'object', keys: Object.keys(value).slice(0, 8) }
  return { type: typeof value }
}

function toPromptString(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function isObjectWithString(value: unknown, key: string): value is Record<typeof key, string> {
  return Boolean(value && typeof value === 'object' && typeof (value as Record<string, unknown>)[key] === 'string')
}

function isObjectWithArray(value: unknown, key: string): value is Record<typeof key, unknown[]> {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>)[key]))
}

const unavailableLlm: LlmStepContext['llm'] = {
  async generate() {
    throw new Error('No LLM adapter was provided to the map/reduce runtime.')
  },
}
