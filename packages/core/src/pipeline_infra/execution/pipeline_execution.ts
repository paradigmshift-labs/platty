import { AsyncLocalStorage } from 'node:async_hooks'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { llmProviderEnum, type EventKind, type LlmProvider, type RunKind } from '@/db/schema/enums.js'
import { pipelineEvents, pipelineRuns, pipelineSteps } from '@/db/schema/pipeline_runs.js'
import { PipelineRun, type LlmOverride, type PipelineEventEmitOptions } from '@/observability/logger.js'
import { progressBus } from '@/observability/progress.js'
import { upsertProjectPhaseStatus, upsertRepositoryPhaseStatus } from '../phase/phase_status.js'
import type { ModelUsageBucket, ModelUsageSummary } from '../observability/pipeline_run_meta.js'
import { registerActivePipelineRun } from './cancellation.js'
import { linkPipelineRun } from './run_links.js'
import {
  PipelineLlmBudgetExceededError,
  createPipelineLlmContext,
  createPipelineLlmTaskRegistry,
  type PipelineLlmCallRecord,
  type PipelineLlmGatewayEvent,
  type PipelineLlmContext,
  type PipelineLlmTaskRegistry,
} from '../llm/llm_context.js'
import type {
  MarkCancelledInput,
  MarkFailedInput,
  MarkPassedInput,
  MarkSkippedInput,
  MarkWaitingForUserInput,
  PipelineFailure,
  PipelineStageStart,
  PipelineStageResult,
  PipelineStepContext,
  ResumeStageInput,
  RunChildInput,
  RunStageInput,
  StageOutcome,
  StepInput,
} from '../types.js'

export interface PipelineExecutionOptions {
  db?: DB
  llmTaskRegistry?: PipelineLlmTaskRegistry
  llmEnvConcurrency?: number
  llmProviderLimit?: number
  llmProjectBudgetLimit?: number
  llmBudgetUsd?: number
  recordLlmCall?: (record: PipelineLlmCallRecord) => void
  recordLlmGatewayEvent?: (event: PipelineLlmGatewayEvent) => void
  llmOverride?: LlmOverride
}

export class PipelineExecution {
  private readonly db: DB
  private readonly llmTaskRegistry: PipelineLlmTaskRegistry
  private readonly opts: PipelineExecutionOptions

  constructor(opts: PipelineExecutionOptions = {}) {
    if (!opts.db) {
      throw new Error('PipelineExecution requires an explicit DB instance.')
    }
    this.db = opts.db
    this.llmTaskRegistry = opts.llmTaskRegistry ?? createPipelineLlmTaskRegistry()
    this.opts = { ...opts, llmTaskRegistry: this.llmTaskRegistry }
  }

  async runStage<T>(
    input: RunStageInput,
    fn: (ctx: PipelineContext) => Promise<T>,
  ): Promise<PipelineStageResult<T>> {
    return this.startStage(input, fn).completion
  }

  async resumeStage<T>(
    input: ResumeStageInput,
    fn: (ctx: PipelineContext) => Promise<T>,
  ): Promise<PipelineStageResult<T>> {
    return this.startResumeStage(input, fn).completion
  }

  startResumeStage<T>(
    input: ResumeStageInput,
    fn: (ctx: PipelineContext) => Promise<T>,
  ): PipelineStageStart<T> {
    const previous = this.validateResumeSource(input)
    const phase = input.phase === undefined ? input.kind : input.phase
    const started = this.startStage(
      {
        ...input,
        force: true,
        meta: {
          ...input.meta,
          previousRunId: input.previousRunId,
          resumeToken: input.resumeToken,
        },
      },
      async (ctx) => {
        ctx.emit('resumed', 'Pipeline run resumed', {
          previousRunId: input.previousRunId,
          resumeToken: input.resumeToken,
        })
        return fn(ctx)
      },
    )
    linkPipelineRun(this.db, {
      parentRunId: previous.id,
      childRunId: started.runId,
      relation: 'resumes',
      phase,
      repoId: input.repoId ?? previous.repoId ?? null,
    })
    return started
  }

  startStage<T>(
    input: RunStageInput,
    fn: (ctx: PipelineContext) => Promise<T>,
  ): PipelineStageStart<T> {
    const phase = input.phase === undefined ? input.kind : input.phase
    const reusable = this.findReusableRun(input)
    if (reusable) {
      this.linkParentRun(input, reusable.id, phase)
      return {
        runId: reusable.id,
        reused: true,
        completion: Promise.resolve(buildReusedResult<T>(reusable)),
      }
    }

    const run = PipelineRun.start({
      projectId: input.projectId,
      repoId: input.repoId ?? undefined,
      kind: input.kind,
      totalSteps: input.totalSteps,
      triggeredBy: input.triggeredBy,
      meta: {
        ...input.meta,
        sourceCommit: input.sourceCommit ?? null,
        parentRunId: input.parentRunId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      llmOverride: this.opts.llmOverride,
    }, this.db)

    this.linkParentRun(input, run.id, phase)

    let committed: StageOutcome | null = null
    const commitOutcome = (outcome: StageOutcome) => {
      if (committed) throw new Error('Pipeline outcome already committed.')
      committed = outcome
      this.persistOutcome({
        runId: run.id,
        input,
        phase,
        outcome,
      })
    }

    const controller = new AbortController()
    if (input.signal?.aborted) controller.abort()
    input.signal?.addEventListener('abort', () => controller.abort(), { once: true })
    const unregisterActiveRun = registerActivePipelineRun(run.id, {
      abort: () => controller.abort(),
    })
    const runLlmUsage = createRunLlmUsageAccumulator()

    const ctx = new PipelineContext({
      db: this.db,
      run,
      input,
      phase,
      signal: controller.signal,
      executionOptions: this.opts,
      commitOutcome,
      abortExecution: () => controller.abort(),
      recordRunLlmCall: runLlmUsage.record,
    })

    const completion = (async (): Promise<PipelineStageResult<T>> => {
      try {
        throwIfAborted(ctx.signal)
        const value = await fn(ctx)
        if (!committed) {
          const failure = internalFailure('PIPELINE_OUTCOME_NOT_COMMITTED', 'Pipeline stage returned without committing an outcome.')
          const outcome = ctx.markFailed({ failure, retryable: false })
          commitOutcome(outcome)
          run.finish('failed', failure.message)
          return { ok: false, runId: run.id, outcome, failure }
        }
        const outcome = committed as StageOutcome
        const status = outcome.status === 'passed' || outcome.status === 'skipped'
          ? 'done'
          : outcome.status === 'waiting_for_user'
            ? 'waiting_for_user'
            : outcome.status
        this.persistRunLlmUsageSnapshot(run.id, runLlmUsage.snapshot())
        run.finish(status, outcome.status === 'failed' || outcome.status === 'cancelled' ? outcome.failure.message : undefined)
        if (outcome.status === 'failed' || outcome.status === 'cancelled') {
          return { ok: false, runId: run.id, outcome, failure: outcome.failure }
        }
        return { ok: true, runId: run.id, outcome, value }
      } catch (error) {
        const failure = normalizeFailure(error)
        const outcome = failure.kind === 'cancelled'
          ? ctx.markCancelled({ failure: { ...failure, kind: 'cancelled' } })
          : ctx.markFailed({ failure, retryable: failure.retryable })
        if (!committed) commitOutcome(outcome)
        this.persistRunLlmUsageSnapshot(run.id, runLlmUsage.snapshot())
        run.finish(failure.kind === 'cancelled' ? 'cancelled' : 'failed', failure.message)
        return { ok: false, runId: run.id, outcome, failure }
      } finally {
        unregisterActiveRun()
      }
    })()

    return { runId: run.id, completion }
  }

  private persistOutcome(input: {
    runId: string
    input: RunStageInput
    phase: RunKind | null
    outcome: StageOutcome
  }): void {
    const { runId, phase, outcome } = input
    if (outcome.status === 'waiting_for_user') {
      insertPipelineEvent(this.db, runId, 'requires_user_action', outcome.action.title, {
        action: outcome.action,
        resumeToken: outcome.resumeToken,
      })
      mergeRunMeta(this.db, runId, {
        waitingForUser: {
          action: outcome.action,
          resumeToken: outcome.resumeToken,
        },
      })
    }
    if (phase === null) return

    const meta = outcome.status === 'waiting_for_user'
      ? {
          ...outcome.phaseMeta,
          action: outcome.action,
          resumeToken: outcome.resumeToken,
          partialOutputRefs: outcome.partialOutputRefs,
          summary: outcome.summary,
        }
      : {
          ...('phaseMeta' in outcome ? outcome.phaseMeta : undefined),
          outputRefs: 'outputRefs' in outcome ? outcome.outputRefs : undefined,
          partialOutputRefs: 'partialOutputRefs' in outcome ? outcome.partialOutputRefs : undefined,
          summary: 'summary' in outcome ? outcome.summary : undefined,
          failure: 'failure' in outcome ? outcome.failure : undefined,
          skippedReason: 'reason' in outcome ? outcome.reason : undefined,
        }

    const source = {
      status: outcome.status,
      sourceRunId: runId,
      sourceCommit: 'sourceCommit' in outcome ? outcome.sourceCommit ?? input.input.sourceCommit ?? null : input.input.sourceCommit ?? null,
      upstreamVersions: outcome.upstreamVersions ?? null,
      meta,
    }

    if (input.input.repoId) {
      upsertRepositoryPhaseStatus(this.db, input.input.repoId, phase, source)
    } else {
      upsertProjectPhaseStatus(this.db, input.input.projectId, phase, source)
    }
  }

  private findReusableRun(input: RunStageInput): typeof pipelineRuns.$inferSelect | undefined {
    if (!input.idempotencyKey || input.force) return undefined
    const rows = this.db.select().from(pipelineRuns).where(and(
      eq(pipelineRuns.projectId, input.projectId),
      input.repoId ? eq(pipelineRuns.repoId, input.repoId) : isNull(pipelineRuns.repoId),
      eq(pipelineRuns.kind, input.kind),
    )).orderBy(desc(pipelineRuns.startedAt)).all()
    return rows.find((row) => {
      const meta = row.meta as Record<string, unknown> | null
      return meta?.idempotencyKey === input.idempotencyKey && meta?.sourceCommit === (input.sourceCommit ?? null)
    })
  }

  private validateResumeSource(input: ResumeStageInput): typeof pipelineRuns.$inferSelect {
    const previous = this.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, input.previousRunId)).get()
    if (!previous) {
      throw new Error(`Cannot resume pipeline run ${input.previousRunId}: previous run was not found.`)
    }
    if (previous.projectId !== input.projectId) {
      throw new Error(`Cannot resume pipeline run ${input.previousRunId}: project mismatch.`)
    }
    if ((previous.repoId ?? null) !== (input.repoId ?? null)) {
      throw new Error(`Cannot resume pipeline run ${input.previousRunId}: repository mismatch.`)
    }
    if (previous.status !== 'waiting_for_user') {
      throw new Error(`Cannot resume pipeline run ${input.previousRunId}: previous run is ${previous.status}.`)
    }
    const expectedToken = getRunMetaResumeToken(previous.meta)
    if (!expectedToken || expectedToken !== input.resumeToken) {
      throw new Error(`Cannot resume pipeline run ${input.previousRunId}: invalid resume token.`)
    }
    return previous
  }

  private linkParentRun(input: RunStageInput, childRunId: string, phase: RunKind | null): void {
    if (!input.parentRunId) return
    linkPipelineRun(this.db, {
      parentRunId: input.parentRunId,
      childRunId,
      relation: 'orchestrates',
      phase,
      repoId: input.repoId ?? null,
    })
  }

  private persistRunLlmUsageSnapshot(runId: string, snapshot: ModelUsageSummary | null): void {
    if (!snapshot) return
    mergeRunMeta(this.db, runId, { modelUsage: snapshot })
  }
}

interface PipelineContextOptions {
  db: DB
  run: PipelineRun
  input: RunStageInput
  phase: RunKind | null
  signal: AbortSignal
  executionOptions: PipelineExecutionOptions
  commitOutcome(outcome: StageOutcome): void
  abortExecution(): void
  recordRunLlmCall(record: PipelineLlmCallRecord): void
}

export class PipelineContext {
  readonly runId: string
  readonly projectId: string
  readonly repoId?: string | null
  readonly phase: RunKind | null
  readonly signal: AbortSignal
  readonly llm: PipelineLlmContext
  private readonly stepScope = new AsyncLocalStorage<number>()

  constructor(private readonly opts: PipelineContextOptions) {
    this.runId = opts.run.id
    this.projectId = opts.input.projectId
    this.repoId = opts.input.repoId
    this.phase = opts.phase
    this.signal = opts.signal
    this.llm = createPipelineLlmContext({
      registry: opts.executionOptions.llmTaskRegistry ?? createPipelineLlmTaskRegistry(),
      runId: opts.run.id,
      stepId: () => this.stepScope.getStore(),
      stage: opts.input.kind,
      signal: opts.signal,
      envConcurrency: opts.executionOptions.llmEnvConcurrency,
      providerLimit: opts.executionOptions.llmProviderLimit,
      projectBudgetLimit: opts.executionOptions.llmProjectBudgetLimit,
      budgetUsd: opts.executionOptions.llmBudgetUsd,
      recordCall: (record) => {
        if (typeof record.stepId === 'number') {
          recordPipelineLlmUsage(this.opts.db, record.stepId, record)
        }
        opts.recordRunLlmCall(record)
        opts.executionOptions.recordLlmCall?.(record)
      },
      recordGatewayEvent: (event) => {
        opts.run.emitAdmin('log', `LLM gateway ${event.type}`, event as unknown as Record<string, unknown>, {
          messageKey: `pipeline.llm_gateway.${event.type}`,
          messageParams: {
            stage: event.stage,
            taskId: event.taskId,
            mode: event.mode,
          },
        })
        opts.executionOptions.recordLlmGatewayEvent?.(event)
      },
      onBudgetExceeded: opts.abortExecution,
    })
  }

  step<T>(input: StepInput, fn: (step: PipelineStepContext) => Promise<T> | T): Promise<T> {
    throwIfAborted(this.signal)
    const phase = this.phase ?? this.opts.input.kind
    return Promise.resolve(this.opts.run.step({ phase, step: input.step, label: input.label }, (step) => {
      return this.stepScope.run(step.stepId, () => {
        throwIfAborted(this.signal)
        return fn(step)
      })
    }))
  }

  emit(kind: EventKind, message: string, data?: Record<string, unknown>, opts?: PipelineEventEmitOptions): void {
    this.opts.run.emit(kind, message, data, opts)
  }

  emitAdmin(kind: EventKind, message: string, data?: Record<string, unknown>, opts?: Omit<PipelineEventEmitOptions, 'visibility'>): void {
    this.opts.run.emitAdmin(kind, message, data, opts)
  }

  markPassed(input: MarkPassedInput): StageOutcome {
    return { status: 'passed', ...input }
  }

  markFailed(input: MarkFailedInput): StageOutcome {
    return { status: 'failed', ...input }
  }

  markSkipped(input: MarkSkippedInput): StageOutcome {
    return { status: 'skipped', ...input }
  }

  markCancelled(input: MarkCancelledInput): StageOutcome {
    return { status: 'cancelled', ...input }
  }

  markWaitingForUser(input: MarkWaitingForUserInput): StageOutcome {
    return { status: 'waiting_for_user', ...input }
  }

  commitOutcome(outcome: StageOutcome): void {
    this.opts.commitOutcome(outcome)
  }

  async runChild<T>(input: RunChildInput, fn: (child: PipelineContext) => Promise<T>): Promise<PipelineStageResult<T>> {
    const childPipeline = new PipelineExecution({
      db: this.opts.db,
      llmTaskRegistry: this.opts.executionOptions.llmTaskRegistry,
      llmEnvConcurrency: this.opts.executionOptions.llmEnvConcurrency,
      llmProviderLimit: this.opts.executionOptions.llmProviderLimit,
      llmProjectBudgetLimit: this.opts.executionOptions.llmProjectBudgetLimit,
      llmBudgetUsd: this.opts.executionOptions.llmBudgetUsd,
      recordLlmCall: this.opts.executionOptions.recordLlmCall,
      recordLlmGatewayEvent: this.opts.executionOptions.recordLlmGatewayEvent,
      llmOverride: this.opts.executionOptions.llmOverride,
    })
    const child = await childPipeline.runStage(
      {
        ...input,
        parentRunId: this.runId,
        signal: mergeAbortSignals(this.signal, input.signal),
      },
      fn,
    )
    if (!child.ok && input.failurePolicy === 'fail_fast') {
      throw child.failure
    }
    return child
  }
}

function normalizeFailure(error: unknown): PipelineFailure {
  if (isPipelineFailure(error)) return error
  if (error instanceof PipelineLlmBudgetExceededError) {
    return {
      kind: 'budget_exceeded',
      code: error.code,
      message: error.message,
      retryable: false,
      details: {
        budgetUsd: error.budgetUsd,
        spentUsd: error.spentUsd,
      },
      causeName: error.name,
    }
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.message === 'This operation was aborted')) {
    return {
      kind: 'cancelled',
      code: 'PIPELINE_CANCELLED',
      message: error.message,
      retryable: false,
      causeName: error.name,
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return internalFailure('PIPELINE_INTERNAL_ERROR', message, error instanceof Error ? error.name : undefined)
}

function buildReusedResult<T>(run: typeof pipelineRuns.$inferSelect): PipelineStageResult<T> {
  if (run.status === 'waiting_for_user') {
    return {
      ok: true,
      runId: run.id,
      reused: true,
      value: undefined as T,
      outcome: {
        status: 'waiting_for_user',
        action: getRunMetaUserAction(run.meta) ?? {
          kind: 'resume_existing_run',
          title: 'Resume existing pipeline run',
          decisionRef: { kind: 'artifact', id: run.id },
        },
        resumeToken: getRunMetaResumeToken(run.meta) ?? run.id,
        summary: { status: run.status },
      },
    }
  }
  if (run.status === 'running' || run.status === 'queued') {
    const failure = internalFailure(
      'PIPELINE_RUN_ALREADY_RUNNING',
      `Pipeline run is already ${run.status}.`,
    )
    failure.retryable = true
    return {
      ok: false,
      runId: run.id,
      reused: true,
      outcome: {
        status: 'skipped',
        reason: 'idempotency_reused',
        upstreamPhase: run.kind,
        upstreamRunId: run.id,
        upstreamSourceCommit: getRunMetaSourceCommit(run.meta),
        summary: { status: run.status },
      },
      failure,
    }
  }
  if (run.status === 'failed') {
    const failure = internalFailure('PIPELINE_REUSED_FAILED_RUN', run.errorMessage ?? 'Reused failed pipeline run.')
    return {
      ok: false,
      runId: run.id,
      reused: true,
      outcome: {
        status: 'failed',
        failure,
        retryable: failure.retryable,
        summary: { status: run.status },
      },
      failure,
    }
  }
  if (run.status === 'cancelled') {
    const failure: PipelineFailure & { kind: 'cancelled' } = {
      kind: 'cancelled',
      code: 'PIPELINE_REUSED_CANCELLED_RUN',
      message: run.errorMessage ?? 'Reused cancelled pipeline run.',
      retryable: false,
    }
    return {
      ok: false,
      runId: run.id,
      reused: true,
      outcome: {
        status: 'cancelled',
        failure,
        summary: { status: run.status },
      },
      failure,
    }
  }
  return {
    ok: true,
    runId: run.id,
    reused: true,
    value: undefined as T,
    outcome: {
      status: 'skipped',
      reason: 'idempotency_reused',
      upstreamPhase: run.kind,
      upstreamRunId: run.id,
      upstreamSourceCommit: getRunMetaSourceCommit(run.meta),
      summary: { status: run.status },
    },
  }
}

function recordPipelineLlmUsage(db: DB, stepId: number, record: PipelineLlmCallRecord): void {
  db.update(pipelineSteps)
    .set({
      llmProvider: toDbLlmProvider(record.provider),
      model: record.model,
      inputTokens: sql`COALESCE(${pipelineSteps.inputTokens}, 0) + ${record.inputTokens ?? 0}`,
      outputTokens: sql`COALESCE(${pipelineSteps.outputTokens}, 0) + ${record.outputTokens ?? 0}`,
      cacheCreationTokens: sql`COALESCE(${pipelineSteps.cacheCreationTokens}, 0) + ${record.cacheCreationTokens ?? 0}`,
      cacheReadTokens: sql`COALESCE(${pipelineSteps.cacheReadTokens}, 0) + ${record.cacheReadTokens ?? 0}`,
      costUsd: sql`COALESCE(${pipelineSteps.costUsd}, 0) + ${record.costUsd ?? 0}`,
    })
    .where(eq(pipelineSteps.id, stepId))
    .run()
}

function createRunLlmUsageAccumulator(): {
  record(record: PipelineLlmCallRecord): void
  snapshot(): ModelUsageSummary | null
} {
  const byProvider: NonNullable<ModelUsageSummary['byProvider']> = {}
  const byModel: NonNullable<ModelUsageSummary['byModel']> = {}
  const totals: ModelUsageSummary['totals'] = {
    calls: 0,
    transportRetries: 0,
    escalations: 0,
    estimatedUsd: 0,
  }

  return {
    record(record) {
      totals.calls += 1
      addUsage(totals, record)
      if (typeof record.provider === 'string') addUsage(bucketFor(byProvider, record.provider), record)
      if (typeof record.model === 'string') addUsage(bucketFor(byModel, record.model), record)
    },
    snapshot() {
      if (totals.calls === 0) return null
      return {
        byProvider,
        byModel,
        totals,
      }
    },
  }
}

function bucketFor(target: Record<string, ModelUsageBucket>, key: string): ModelUsageBucket {
  target[key] ??= {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedUsd: 0,
  }
  target[key].calls += 1
  return target[key]
}

function addUsage(target: ModelUsageBucket | ModelUsageSummary['totals'], record: PipelineLlmCallRecord): void {
  target.inputTokens = (target.inputTokens ?? 0) + (record.inputTokens ?? 0)
  target.outputTokens = (target.outputTokens ?? 0) + (record.outputTokens ?? 0)
  target.estimatedUsd += record.costUsd ?? 0
}

function toDbLlmProvider(provider: unknown): LlmProvider | undefined {
  return typeof provider === 'string' && (llmProviderEnum as readonly string[]).includes(provider)
    ? provider as LlmProvider
    : undefined
}

function getRunMetaResumeToken(meta: unknown): string | null {
  const waiting = getRunMetaWaitingForUser(meta)
  const value = waiting?.resumeToken
  return typeof value === 'string' ? value : null
}

function getRunMetaWaitingForUser(meta: unknown): Record<string, unknown> | null {
  if (typeof meta !== 'object' || meta === null) return null
  const value = (meta as Record<string, unknown>).waitingForUser
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function getRunMetaUserAction(meta: unknown): Extract<StageOutcome, { status: 'waiting_for_user' }>['action'] | null {
  const waiting = getRunMetaWaitingForUser(meta)
  const action = waiting?.action
  if (typeof action !== 'object' || action === null) return null
  const record = action as Record<string, unknown>
  if (
    typeof record.kind !== 'string'
    || typeof record.title !== 'string'
    || typeof record.decisionRef !== 'object'
    || record.decisionRef === null
  ) {
    return null
  }
  return record as Extract<StageOutcome, { status: 'waiting_for_user' }>['action']
}

function getRunMetaSourceCommit(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null) return null
  const value = (meta as Record<string, unknown>).sourceCommit
  return typeof value === 'string' ? value : null
}

function mergeRunMeta(db: DB, runId: string, patch: Record<string, unknown>): void {
  const row = db.select({ meta: pipelineRuns.meta }).from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
  const existing = typeof row?.meta === 'object' && row.meta !== null ? row.meta as Record<string, unknown> : {}
  db.update(pipelineRuns)
    .set({ meta: { ...existing, ...patch } })
    .where(eq(pipelineRuns.id, runId))
    .run()
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('This operation was aborted')
  error.name = 'AbortError'
  throw error
}

function mergeAbortSignals(parent: AbortSignal, child?: AbortSignal): AbortSignal {
  if (!child) return parent
  if (parent.aborted) return parent
  if (child.aborted) return child
  const controller = new AbortController()
  const abort = () => controller.abort()
  parent.addEventListener('abort', abort, { once: true })
  child.addEventListener('abort', abort, { once: true })
  return controller.signal
}

function internalFailure(code: string, message: string, causeName?: string): PipelineFailure {
  return {
    kind: 'internal',
    code,
    message,
    retryable: false,
    causeName,
  }
}

function isPipelineFailure(error: unknown): error is PipelineFailure {
  return typeof error === 'object' && error !== null && 'kind' in error && 'code' in error && 'retryable' in error
}

function insertPipelineEvent(
  db: DB,
  runId: string,
  kind: EventKind,
  message: string,
  data?: Record<string, unknown>,
): void {
  db.insert(pipelineEvents)
    .values({ runId, kind, message, data })
    .run()
  progressBus.publish(runId, { kind, message, data })
}
