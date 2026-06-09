import { getLlmAdapter, type LlmSpec } from '@/llm/registry.js'
import type { LlmRequest, LlmResponse } from '@/llm/types.js'
import { PIPELINE_LEGACY_LARGE_TASK_ID, type PipelineLegacyLargeTaskInput } from './large_task_gateway.js'
import { runLlmGatewayTask } from '@/llm_large_task_runtime/run_gateway_task.js'

export type PipelineGatewayTaskMode = 'single' | 'batch' | 'map_reduce'
export type LlmGatewayTaskId = string
export const PIPELINE_SINGLE_LLM_TASK_ID = 'llm.single.generate'
export const PIPELINE_ADAPTER_LLM_TASK_ID = 'llm.adapter.generate'

export interface PipelineSingleLlmGenerateInput {
  spec: LlmSpec
  request: LlmRequest
}

export type PipelineSingleLlmGenerateOutput = LlmResponse

export interface PipelineAdapterLlmGenerateOptions {
  signal?: AbortSignal
  provider?: string
  model?: string
  pass?: string
  attempt?: number
  [key: string]: unknown
}

export interface PipelineAdapterLlmAdapter<TOutput = unknown> {
  generate(prompt: string, options?: PipelineAdapterLlmGenerateOptions): Promise<TOutput>
}

export interface PipelineAdapterLlmGenerateInput<TOutput = unknown> {
  adapter: PipelineAdapterLlmAdapter<TOutput>
  prompt: string
  options?: PipelineAdapterLlmGenerateOptions
}

export interface PipelineGatewayOptions {
  subjectId?: string
  timeoutMs?: number
}

export interface PipelineLlmTelemetry {
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  [key: string]: unknown
}

export type PipelineLlmGatewayEventType = 'queued' | 'started' | 'finished' | 'failed'

export interface PipelineLlmGatewayEvent {
  type: PipelineLlmGatewayEventType
  runId: string
  stepId?: string | number
  stage: string
  taskId: string
  mode: PipelineGatewayTaskMode
  unitId: string
  concurrency: number
  queuedAtMs: number
  startedAtMs?: number
  finishedAtMs?: number
  waitMs?: number
  durationMs?: number
  activeCalls: number
  queueDepth: number
  success?: boolean
  failureCode?: string
}

export interface PipelineGatewayTaskContext {
  taskId: string
  mode: PipelineGatewayTaskMode
  concurrency: number
  signal?: AbortSignal
  recordTelemetry(telemetry: PipelineLlmTelemetry): void
}

export interface PipelineGatewayTask<TInput = unknown, TOutput = unknown> {
  id: LlmGatewayTaskId
  mode: PipelineGatewayTaskMode
  taskMaxConcurrency?: number
  run(input: TInput, ctx: PipelineGatewayTaskContext): Promise<TOutput> | TOutput
}

export interface PipelineLlmTaskRegistry {
  register<TInput, TOutput>(task: PipelineGatewayTask<TInput, TOutput>): void
  get<TInput, TOutput>(taskId: LlmGatewayTaskId): PipelineGatewayTask<TInput, TOutput>
}

export interface PipelineLlmCallRecord extends PipelineLlmTelemetry {
  runId: string
  stepId?: string | number
  stage: string
  taskId: string
  mode: PipelineGatewayTaskMode
  unitId: string
  pass: string
  attempt: number
  correlationId: string
  concurrency: number
}

export interface CreatePipelineLlmContextOptions {
  registry: PipelineLlmTaskRegistry
  runId: string
  stepId?: string | number | (() => string | number | undefined)
  stage: string
  signal?: AbortSignal
  envConcurrency?: number
  providerLimit?: number
  projectBudgetLimit?: number
  budgetUsd?: number
  recordCall?: (record: PipelineLlmCallRecord) => void
  recordGatewayEvent?: (event: PipelineLlmGatewayEvent) => void
  onBudgetExceeded?: () => void
}

export interface PipelineLlmContext {
  gatewayTask<TInput, TOutput>(
    taskId: LlmGatewayTaskId,
    input: TInput,
    options?: PipelineGatewayOptions,
  ): Promise<TOutput>
}

export function createPipelineLlmTaskRegistry(): PipelineLlmTaskRegistry {
  const tasks = new Map<string, PipelineGatewayTask>()
  tasks.set(PIPELINE_SINGLE_LLM_TASK_ID, {
    id: PIPELINE_SINGLE_LLM_TASK_ID,
    mode: 'single',
    async run(input: PipelineSingleLlmGenerateInput, ctx) {
      const adapter = getLlmAdapter(input.spec)
      const response = await adapter.call({
        ...input.request,
        signal: input.request.signal ?? ctx.signal,
      })
      ctx.recordTelemetry({
        provider: adapter.provider,
        model: response.model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costUsd: response.costUsd,
      })
      return response
    },
  })
  tasks.set(PIPELINE_ADAPTER_LLM_TASK_ID, {
    id: PIPELINE_ADAPTER_LLM_TASK_ID,
    mode: 'single',
    async run(input: PipelineAdapterLlmGenerateInput, ctx) {
      const output = await input.adapter.generate(input.prompt, {
        ...input.options,
        signal: input.options?.signal ?? ctx.signal,
      })
      ctx.recordTelemetry(extractAdapterTelemetry(output, input.options))
      return output
    },
  })
  tasks.set(PIPELINE_LEGACY_LARGE_TASK_ID, {
    id: PIPELINE_LEGACY_LARGE_TASK_ID,
    mode: 'map_reduce',
    async run(input: PipelineLegacyLargeTaskInput, ctx) {
      return runLlmGatewayTask(input.task, input.input, {
        ...input.options,
        signal: input.options?.signal ?? ctx.signal,
      })
    },
  })
  return {
    register(task) {
      if (tasks.has(task.id)) throw new Error(`Pipeline LLM task already registered: ${task.id}`)
      tasks.set(task.id, task)
    },
    get<TInput, TOutput>(taskId: LlmGatewayTaskId) {
      const task = tasks.get(taskId)
      if (!task) throw new Error(`Pipeline LLM task not registered: ${taskId}`)
      return task as PipelineGatewayTask<TInput, TOutput>
    },
  }
}

export function createPipelineLlmContext(opts: CreatePipelineLlmContextOptions): PipelineLlmContext {
  let spentUsd = 0
  const limiters = new Map<string, PipelineTaskLimiter>()
  return {
    async gatewayTask<TInput, TOutput>(taskId: LlmGatewayTaskId, input: TInput, options?: PipelineGatewayOptions) {
      const task = opts.registry.get<TInput, TOutput>(taskId)
      const telemetry: PipelineLlmTelemetry[] = []
      const concurrency = clampConcurrency({
        envDefault: opts.envConcurrency,
        taskMax: task.taskMaxConcurrency,
        providerLimit: opts.providerLimit,
        projectBudgetLimit: opts.projectBudgetLimit,
      })
      const limiterKey = `${taskId}:${concurrency}`
      let limiter = limiters.get(limiterKey)
      if (!limiter) {
        limiter = new PipelineTaskLimiter(concurrency)
        limiters.set(limiterKey, limiter)
      }
      const unitId = options?.subjectId ?? 'singleton'
      const stepId = resolveStepId(opts.stepId)
      const queuedAtMs = Date.now()
      const taskMetadata = extractTaskMetadata(input, task.mode)
      const baseRecord = {
        runId: opts.runId,
        stepId,
        stage: opts.stage,
        taskId,
        mode: task.mode,
        unitId,
        pass: taskMetadata.pass,
        attempt: taskMetadata.attempt,
        correlationId: `${opts.runId}:${stepId ?? 'run'}:${unitId}:${taskMetadata.pass}:${taskMetadata.attempt}`,
        concurrency,
      }
      opts.recordGatewayEvent?.({
        type: 'queued',
        ...baseRecord,
        queuedAtMs,
        activeCalls: limiter.activeCount(),
        queueDepth: limiter.queueDepth() + 1,
      })
      await limiter.acquire()
      const startedAtMs = Date.now()
      opts.recordGatewayEvent?.({
        type: 'started',
        ...baseRecord,
        queuedAtMs,
        startedAtMs,
        waitMs: startedAtMs - queuedAtMs,
        activeCalls: limiter.activeCount(),
        queueDepth: limiter.queueDepth(),
      })
      let output: TOutput
      try {
        output = await task.run(input, {
          taskId,
          mode: task.mode,
          concurrency,
          signal: opts.signal,
          recordTelemetry: (record) => telemetry.push(record),
        }) as TOutput
      } catch (error) {
        const finishedAtMs = Date.now()
        opts.recordGatewayEvent?.({
          type: 'failed',
          ...baseRecord,
          queuedAtMs,
          startedAtMs,
          finishedAtMs,
          waitMs: startedAtMs - queuedAtMs,
          durationMs: finishedAtMs - startedAtMs,
          activeCalls: limiter.activeCount(),
          queueDepth: limiter.queueDepth(),
          success: false,
          failureCode: errorCode(error),
        })
        throw error
      } finally {
        limiter.release()
      }
      const finishedAtMs = Date.now()
      if (opts.recordCall) {
        const records = telemetry.length > 0 ? telemetry : [{}]
        for (const record of records) opts.recordCall({ ...baseRecord, ...record })
      }
      for (const record of telemetry) {
        if (typeof record.costUsd === 'number' && Number.isFinite(record.costUsd)) spentUsd += record.costUsd
      }
      if (typeof opts.budgetUsd === 'number' && Number.isFinite(opts.budgetUsd) && spentUsd > opts.budgetUsd) {
        opts.onBudgetExceeded?.()
        const error = new PipelineLlmBudgetExceededError(opts.budgetUsd, spentUsd)
        opts.recordGatewayEvent?.({
          type: 'failed',
          ...baseRecord,
          queuedAtMs,
          startedAtMs,
          finishedAtMs,
          waitMs: startedAtMs - queuedAtMs,
          durationMs: finishedAtMs - startedAtMs,
          activeCalls: limiter.activeCount(),
          queueDepth: limiter.queueDepth(),
          success: false,
          failureCode: error.code,
        })
        throw error
      }
      opts.recordGatewayEvent?.({
        type: 'finished',
        ...baseRecord,
        queuedAtMs,
        startedAtMs,
        finishedAtMs,
        waitMs: startedAtMs - queuedAtMs,
        durationMs: finishedAtMs - startedAtMs,
        activeCalls: limiter.activeCount(),
        queueDepth: limiter.queueDepth(),
        success: true,
      })
      return output as TOutput
    },
  }
}

function resolveStepId(stepId: CreatePipelineLlmContextOptions['stepId']): string | number | undefined {
  return typeof stepId === 'function' ? stepId() : stepId
}

function extractTaskMetadata(input: unknown, mode: PipelineGatewayTaskMode): { pass: string; attempt: number } {
  const record = toRecord(input)
  const options = toRecord(record?.options)
  const request = toRecord(record?.request)
  const telemetry = toRecord(request?.telemetry)
  return {
    pass: stringValue(options?.pass) ?? stringValue(telemetry?.pass) ?? (mode === 'single' ? 'single' : mode),
    attempt: positiveInteger(options?.attempt) ?? positiveInteger(telemetry?.attempt) ?? 1,
  }
}

function extractAdapterTelemetry(output: unknown, options?: PipelineAdapterLlmGenerateOptions): PipelineLlmTelemetry {
  const outputRecord = toRecord(output)
  const result = toRecord(outputRecord?.result) ?? outputRecord
  const usage = toRecord(result?.usage)
  return {
    provider: stringValue(result?.provider) ?? stringValue(options?.provider),
    model: stringValue(result?.model) ?? stringValue(options?.model),
    inputTokens: numberValue(usage?.inputTokens),
    outputTokens: numberValue(usage?.outputTokens),
    costUsd: numberValue(result?.costUsd),
  }
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && typeof value === 'number' && value > 0 ? value : undefined
}

class PipelineTaskLimiter {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  release(): void {
    this.active -= 1
    const next = this.queue.shift()
    if (next) next()
  }

  activeCount(): number {
    return this.active
  }

  queueDepth(): number {
    return this.queue.length
  }
}

export class PipelineLlmBudgetExceededError extends Error {
  readonly code = 'PIPELINE_LLM_BUDGET_EXCEEDED'
  readonly kind = 'budget_exceeded'

  constructor(
    readonly budgetUsd: number,
    readonly spentUsd: number,
  ) {
    super(`Pipeline LLM budget exceeded: spent ${spentUsd} USD, budget ${budgetUsd} USD.`)
    this.name = 'PipelineLlmBudgetExceededError'
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  if (error instanceof Error) return error.name
  return 'UNKNOWN'
}

function clampConcurrency(input: {
  envDefault?: number
  taskMax?: number
  providerLimit?: number
  projectBudgetLimit?: number
}): number {
  const envDefault = input.envDefault
    ?? parsePositiveInt(process.env.PIPELINE_LLM_CONCURRENCY)
    ?? parsePositiveInt(process.env.LLM_WORKER_QUEUE_CONCURRENCY)
    ?? 10
  const candidates = [
    envDefault,
    input.taskMax,
    input.providerLimit,
    input.projectBudgetLimit,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  return Math.max(1, Math.min(...(candidates.length > 0 ? candidates : [1])))
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}
