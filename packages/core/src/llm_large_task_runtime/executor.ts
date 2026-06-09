import { LlmLargeTaskError } from './errors.js'
import { estimateTokens } from './token_estimator.js'
import { createLlmWorkerQueue } from './worker_queue.js'
import { planLlmLargeTask } from './planner.js'
import type { LlmLargeTaskRequest, LlmLargeTaskRunResult, LlmProvider, LlmWorkerQueueCall, PlannedCallStage } from './types.js'

export async function executeLlmLargeTask<TItem, TOutput, TJudge>(
  request: LlmLargeTaskRequest<TItem, TOutput, TJudge>,
  options: { llm: LlmProvider; signal?: AbortSignal },
): Promise<LlmLargeTaskRunResult<TOutput>> {
  const plan = planLlmLargeTask(request)
  const queue = createLlmWorkerQueue(request.queue)
  const parseOutput = request.parseOutput ?? ((text: string) => text as TOutput)
  const warnings: string[] = []
  let output: TOutput

  if (plan.selectedMode === 'single') {
    const prompt = request.renderSinglePrompt?.(request.items) ?? JSON.stringify(request.items)
    const [text] = await queue.runAll([providerCall(request, 'single:1', 'single', () =>
      options.llm(prompt, { stage: 'single', signal: options.signal, maxOutputTokens: plan.budget.maxOutputTokens }).then((response) => response.text))])
    output = parseOutput(text!, 'single')
  } else {
    const mapCalls: Array<LlmWorkerQueueCall<unknown>> = plan.chunks.map((chunk) =>
      providerCall(request, `map:${chunk.id}`, 'map', async () => {
        const prompt = request.renderMapPrompt?.(chunk) ?? JSON.stringify(chunk.items)
        const response = await options.llm(prompt, { stage: 'map', signal: options.signal, maxOutputTokens: plan.budget.maxOutputTokens })
        return request.parseMapOutput ? request.parseMapOutput(response.text, chunk) : response.text
      }))
    const mapOutputs = await queue.runAll(mapCalls)
    if (plan.selectedMode === 'independent_map') {
      output = request.deterministicMerge
        ? request.deterministicMerge(mapOutputs)
        : parseOutput(JSON.stringify(mapOutputs), 'map')
    } else {
      output = await runTreeReduce(request, options, queue, mapOutputs, plan.budget.maxOutputTokens, parseOutput)
    }
  }

  const validated = request.validateOutput?.(output) ?? { ok: true }
  if (!validated.ok) {
    if (!request.repairOutput) {
      throw new LlmLargeTaskError('OUTPUT_VALIDATION_FAILED', 'Runtime output failed validation.', { issues: validated.issues })
    }
    output = await request.repairOutput(output, validated)
    const repaired = request.validateOutput?.(output) ?? { ok: true }
    if (!repaired.ok) throw new LlmLargeTaskError('OUTPUT_VALIDATION_FAILED', 'Runtime output still failed validation after repair.', { issues: repaired.issues })
  } else if (validated.warnings) {
    warnings.push(...validated.warnings.map((warning) => warning.code))
  }

  if (request.judge?.enabled) {
    const prompt = request.judge.renderPrompt(output)
    const [judgeText] = await queue.runAll([providerCall(request, 'judge:1', 'judge', () =>
      options.llm(prompt, { stage: 'judge', signal: options.signal, maxOutputTokens: Math.min(2_000, plan.budget.maxOutputTokens) }).then((response) => response.text))])
    const verdict = request.judge.parse(judgeText!)
    if (!request.judge.accept(verdict)) {
      throw new LlmLargeTaskError('JUDGE_FAILED', 'Runtime judge rejected output.', { verdict })
    }
  }

  const outputText = JSON.stringify(output)
  return {
    output,
    plan,
    metrics: {
      selectedMode: plan.selectedMode,
      callCount: plan.calls.length,
      estimatedInputTokens: plan.estimate.expectedInputTokens,
      estimatedOutputTokens: plan.estimate.expectedOutputTokens,
      actualInputTokens: plan.estimate.expectedInputTokens,
      actualOutputTokens: estimateTokens(outputText),
      warnings,
    },
  }
}

async function runTreeReduce<TItem, TOutput, TJudge>(
  request: LlmLargeTaskRequest<TItem, TOutput, TJudge>,
  options: { llm: LlmProvider; signal?: AbortSignal },
  queue: ReturnType<typeof createLlmWorkerQueue>,
  mapOutputs: unknown[],
  maxOutputTokens: number,
  parseOutput: (text: string, stage: PlannedCallStage) => TOutput,
): Promise<TOutput> {
  let current = mapOutputs
  let level = 1
  while (current.length > 1) {
    const groups = pairs(current)
    const reduced = await queue.runAll(groups.map((group, index) =>
      providerCall(request, `reduce:L${level}:G${index + 1}`, 'reduce', async () => {
        const prompt = request.renderReducePrompt?.(group) ?? JSON.stringify(group)
        const response = await options.llm(prompt, { stage: 'reduce', signal: options.signal, maxOutputTokens })
        return request.parseReduceOutput ? request.parseReduceOutput(response.text, group) : parseOutput(response.text, 'reduce')
      })))
    current = reduced
    level += 1
  }
  if (current.length === 1) return current[0] as TOutput
  const reducePrompt = request.renderReducePrompt?.(current) ?? JSON.stringify(current)
  const [reducedText] = await queue.runAll([providerCall(request, 'reduce:empty', 'reduce', () =>
    options.llm(reducePrompt, { stage: 'reduce', signal: options.signal, maxOutputTokens }).then((response) => response.text))])
  return request.parseReduceOutput ? request.parseReduceOutput(reducedText!, current) : parseOutput(reducedText!, 'reduce')
}

function pairs<T>(items: T[]): T[][] {
  const groups: T[][] = []
  for (let index = 0; index < items.length; index += 2) groups.push(items.slice(index, index + 2))
  return groups
}

function providerCall<TItem, TOutput, TJudge, T>(
  request: LlmLargeTaskRequest<TItem, TOutput, TJudge>,
  id: string,
  stage: PlannedCallStage,
  execute: () => Promise<T>,
): LlmWorkerQueueCall<T> {
  return {
    id,
    tenantId: request.tenantId,
    provider: request.provider,
    model: request.model,
    stage,
    execute,
  }
}
