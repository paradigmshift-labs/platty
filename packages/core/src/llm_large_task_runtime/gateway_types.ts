export type LlmGatewayMode =
  | 'independent_map'
  | 'independent_map_reduce'
  | 'optional_refinement'
  | 'semantic_map_reduce'

export interface TokenBudget {
  targetInputTokens: number
  reduceTargetInputTokens?: number
  maxInputTokens: number
  maxOutputTokens: number
  maxReduceGroupSize?: number
  maxReduceDepth: number
}

export interface LlmGatewayExecutionPolicy {
  mapConcurrency: number
  reduceConcurrency: number
  timeoutMs: number
  maxRetries: number
  maxRepairAttempts: number
  maxChunkSplitDepth: number
}

export interface LlmGenerateResult {
  text: string
  result?: unknown
}

export interface LlmGenerateOptions {
  signal?: AbortSignal
  maxOutputTokens?: number
}

export interface LlmStepContext {
  taskName: string
  stage: 'map' | 'reduce' | 'judge' | 'repair'
  attempt: number
  level?: number
  groupId?: string
  signal: AbortSignal
  llm: {
    generate(prompt: string, options?: LlmGenerateOptions): Promise<LlmGenerateResult>
  }
  telemetry: LlmGatewayTelemetrySink
}

export type MapStep<TChunk, TMapOutput> = (
  chunk: TChunk,
  ctx: LlmStepContext,
) => Promise<TMapOutput>

export type ValidateMapStep<TChunk, TMapOutput> = (
  output: TMapOutput,
  input: { chunk: TChunk; stage: 'post_map' | 'post_map_repair' },
) => ValidationResult

export type RepairMapStep<TProjection, TChunk, TMapOutput> = (
  input: {
    projection: TProjection
    chunk: TChunk
    output: TMapOutput
    validation: ValidationResult
  },
  ctx: LlmStepContext,
) => Promise<TMapOutput>

export type ReduceStep<TMapOutput, TOutput> = (
  items: Array<TMapOutput | TOutput>,
  ctx: LlmStepContext,
) => Promise<TOutput>

export type ValidateStep<TOutput> = (
  output: TOutput,
  ctx: { stage: 'post_merge' | 'post_repair' },
) => ValidationResult

export type JudgeStep<TOutput> = (
  output: TOutput,
  ctx: LlmStepContext,
) => Promise<JudgeResult>

export type RepairStep<TProjection, TChunk, TMapOutput, TOutput> = (
  input: {
    projection: TProjection
    chunks: TChunk[]
    mapOutputs: TMapOutput[]
    output: TOutput
    validation: ValidationResult
    judge?: JudgeResult
  },
  ctx: LlmStepContext,
) => Promise<TOutput>

export interface ChunkPlanner<TProjection, TChunk> {
  plan(input: {
    projection: TProjection
    tokenBudget: TokenBudget
    estimateTokens: (prompt: string) => number
    signal?: AbortSignal
  }): Promise<TChunk[]> | TChunk[]
  splitOversizedChunk?(input: {
    chunk: TChunk
    projection: TProjection
    tokenBudget: TokenBudget
    estimateTokens: (prompt: string) => number
    signal?: AbortSignal
  }): Promise<TChunk[]> | TChunk[]
}

export interface LlmGatewayTask<
  TInput,
  TGraph,
  TProjection,
  TChunk,
  TMapOutput,
  TOutput,
> {
  name: string
  mode: LlmGatewayMode
  tokenBudget: TokenBudget
  execution: LlmGatewayExecutionPolicy
  buildGraph?: (input: TInput) => Promise<TGraph> | TGraph
  project: (
    input: TInput,
    graph: TGraph | null,
  ) => Promise<TProjection> | TProjection
  chunkPlanner: ChunkPlanner<TProjection, TChunk>
  mapper: MapStep<TChunk, TMapOutput>
  validateMapOutput?: ValidateMapStep<TChunk, TMapOutput>
  repairMapOutput?: RepairMapStep<TProjection, TChunk, TMapOutput>
  reducer?: ReduceStep<TMapOutput, TOutput>
  deterministicMerge?: (items: TMapOutput[]) => TOutput
  skipReduceWhenSingleMapOutput?: boolean
  deterministicReduceFallback?: (input: {
    items: Array<TMapOutput | TOutput>
    reason: string
    level: number
    groupId: string
  }) => TOutput
  validate: ValidateStep<TOutput>
  judge?: JudgeStep<TOutput>
  repair?: RepairStep<TProjection, TChunk, TMapOutput, TOutput>
  debugRecorder: LlmGatewayDebugRecorder
  validateReduceOutput?: boolean

  getProjectionItemIds?: (projection: TProjection) => Iterable<string>
  getProjectionItemCount?: (projection: TProjection) => number
  getChunkId?: (chunk: TChunk) => string
  getChunkItemIds?: (chunk: TChunk) => Iterable<string>
  getChunkPrompt?: (chunk: TChunk) => string
  getReducePrompt?: (items: Array<TMapOutput | TOutput>, ctx: { level: number; groupId: string }) => string
  summarizeMapOutput?: (output: TMapOutput) => unknown
  summarizeOutput?: (output: TOutput) => unknown
  allowEmptyChunks?: boolean
}

export interface ValidationIssue {
  code: string
  message: string
  details?: unknown
}

export interface ValidationResult {
  fatalIssues: ValidationIssue[]
  warnings: ValidationIssue[]
}

export interface JudgeResult {
  score: number | null
  fatalIssues: ValidationIssue[]
  warnings: ValidationIssue[]
}

export interface LlmGatewayDebugRecorder {
  record(event: LlmGatewayDebugEvent): Promise<void> | void
}

export type LlmGatewayDebugEvent =
  | { type: 'task_started'; taskName: string; mode: LlmGatewayMode }
  | { type: 'projection_built'; taskName: string; itemCount: number; estimatedTokens: number }
  | {
    type: 'chunks_planned'
    taskName: string
    chunkCount: number
    chunkTokenSizes: number[]
    targetInputTokens: number
    maxInputTokens: number
    totalChunkTokens: number
    maxChunkTokens: number
  }
  | { type: 'map_started'; taskName: string; chunkId: string; attempt: number }
  | { type: 'map_finished'; taskName: string; chunkId: string; durationMs: number; outputSummary: unknown }
  | { type: 'map_validation_failed'; taskName: string; chunkId: string; attempt: number; fatalCount: number; warningCount: number }
  | { type: 'map_repair_finished'; taskName: string; chunkId: string; attempt: number; fatalCount: number; warningCount: number }
  | { type: 'map_failed'; taskName: string; chunkId: string; attempt: number; error: string }
  | { type: 'map_progress'; taskName: string; completedChunks: number; totalChunks: number; failedChunks: number; lastChunkId: string }
  | {
    type: 'reduce_groups_planned'
    taskName: string
    level: number
    groupCount: number
    groupItemCounts: number[]
    groupTokenSizes: number[]
    targetInputTokens: number
    maxInputTokens: number
  }
  | {
    type: 'reduce_started'
    taskName: string
    level: number
    groupId: string
    itemCount: number
    attempt: number
    estimatedTokens: number
    targetInputTokens: number
    maxInputTokens: number
  }
  | { type: 'reduce_finished'; taskName: string; level: number; groupId: string; durationMs: number; outputSummary: unknown }
  | { type: 'reduce_validation_failed'; taskName: string; level: number; groupId: string; attempt: number; fatalCount: number; warningCount: number }
  | { type: 'reduce_failed'; taskName: string; level: number; groupId: string; attempt: number; error: string }
  | { type: 'reduce_progress'; taskName: string; level: number; completedGroups: number; totalGroups: number; failedGroups: number; lastGroupId: string }
  | { type: 'validation_finished'; taskName: string; stage: 'post_merge' | 'post_repair'; fatalCount: number; warningCount: number }
  | { type: 'judge_finished'; taskName: string; score: number | null; warningCount: number }
  | { type: 'repair_started'; taskName: string; attempt: number; issueCount: number }
  | { type: 'repair_finished'; taskName: string; attempt: number; fatalCount: number; warningCount: number }
  | { type: 'task_stopped'; taskName: string; reason: string }
  | { type: 'task_finished'; taskName: string; status: 'success' | 'failed' | 'stopped' }

export type LlmGatewayTelemetryEvent =
  | { type: 'stage_failed'; stage: string; code: string; message: string; details?: unknown }
  | { type: 'stage_finished'; stage: string; durationMs: number; details?: unknown }
  | { type: 'retry'; stage: string; attempt: number; message: string }
  | { type: 'fallback_used'; stage: string; fallbackType: 'deterministic_reduce'; reason: string; level: number; groupId: string }

export interface LlmGatewayTelemetrySink {
  record(event: LlmGatewayTelemetryEvent): void
}

export interface LlmGatewayTelemetrySnapshot {
  events: LlmGatewayTelemetryEvent[]
}

export interface RunLlmGatewayTaskOptions {
  signal?: AbortSignal
  llm?: LlmStepContext['llm']
  telemetry?: LlmGatewayTelemetrySink
  estimateTokens?: (prompt: string) => number
}

export interface LlmGatewayRunResult<TOutput> {
  status: 'success'
  output: TOutput
  validation: ValidationResult
  judge?: JudgeResult
  telemetry: LlmGatewayTelemetrySnapshot
}

export type LlmGatewayErrorCode =
  | 'TASK_STOPPED'
  | 'CHUNK_TOKEN_LIMIT_EXCEEDED'
  | 'CHUNK_SPLIT_NO_PROGRESS'
  | 'REDUCE_TOKEN_LIMIT_EXCEEDED'
  | 'CHUNK_ITEM_ID_UNKNOWN'
  | 'CHUNK_ID_MISSING'
  | 'EMPTY_CHUNK_LIST'
  | 'EMPTY_REDUCE_INPUT'
  | 'TREE_REDUCE_DEPTH_EXCEEDED'
  | 'MAP_FAILED'
  | 'REDUCE_FAILED'
  | 'REPAIR_FAILED'
  | 'VALIDATION_FAILED'
  | 'JUDGE_FAILED'
  | 'TIMEOUT'
  | 'SCHEMA_PARSE_FAILED'
  | 'TASK_CONTRACT_INVALID'

export class LlmGatewayError extends Error {
  readonly code: LlmGatewayErrorCode
  readonly details?: unknown
  readonly validation?: ValidationResult

  constructor(
    code: LlmGatewayErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown; validation?: ValidationResult } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'LlmGatewayError'
    this.code = code
    this.details = options.details
    this.validation = options.validation
  }
}
