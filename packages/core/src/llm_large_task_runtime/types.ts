export type LlmLargeTaskMode =
  | 'single'
  | 'single_with_compaction'
  | 'independent_map'
  | 'semantic_map_reduce'
  | 'adaptive'

export type LlmLargeTaskSelectedMode = Exclude<LlmLargeTaskMode, 'adaptive'>

export interface TokenEstimator {
  id: string
  estimate(text: string): number
}

export interface LlmModelContextProfile {
  provider: string
  model: string
  source: 'built_in' | 'environment' | 'project_setting' | 'user_setting' | 'run_override'
  contextWindowTokens: number
  maxOutputTokens: number
  defaultOutputReserveTokens: number
  reasoningReserveTokens: number
  safetyMarginTokens: number
  estimatorId: string
  estimatorOverestimateRatio: number
  inputCostPerMillionTokensUsd?: number
  outputCostPerMillionTokensUsd?: number
}

export interface ResolveModelProfileInput {
  provider: string
  model: string
  override?: LlmModelContextProfile
}

export interface TokenBudgetRequest {
  targetInputRatio?: number
  targetInputTokens?: number
  maxOutputTokens?: number
  reasoningReserveTokens?: number
  safetyMarginTokens?: number
}

export interface ResolvedTokenBudget {
  source: 'model_profile'
  maxSafeInputTokens: number
  targetInputTokens: number
  maxOutputTokens: number
  reasoningReserveTokens: number
  safetyMarginTokens: number
}

export interface TokenChunk<T> {
  id: string
  items: T[]
  estimatedTokens: number
}

export type PlannedCallStage = 'single' | 'compaction' | 'selector' | 'map' | 'reduce' | 'repair' | 'judge'

export interface PlannedLlmCall {
  id: string
  stage: PlannedCallStage
  estimatedInputTokens: number
  estimatedOutputTokens: number
}

export interface LlmRunEstimate {
  expectedInputTokens: number
  expectedOutputTokens: number
  plannedLlmCalls: number
  worstCaseProviderCalls: number
  plannedConcurrency: number
  expectedCostUsd?: { min: number; max: number }
}

export interface LlmLargeTaskPlan<TItem = unknown> {
  name: string
  selectedMode: LlmLargeTaskSelectedMode
  profile: LlmModelContextProfile
  budget: ResolvedTokenBudget
  chunks: Array<TokenChunk<TItem>>
  reduceGroups: Array<TokenChunk<unknown>>
  calls: PlannedLlmCall[]
  estimate: LlmRunEstimate
}

export interface ValidationIssue {
  code: string
  message: string
  details?: unknown
}

export type LlmOutputValidationResult =
  | { ok: true; warnings?: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] }

export interface LlmJudgePolicy<TOutput, TJudge> {
  enabled?: boolean
  renderPrompt(output: TOutput): string
  parse(text: string): TJudge
  accept(verdict: TJudge): boolean
}

export interface LlmLargeTaskRequest<TItem = unknown, TOutput = string, TJudge = unknown> {
  name: string
  provider: string
  model: string
  mode: LlmLargeTaskMode
  tenantId?: string
  profileOverride?: LlmModelContextProfile
  budgetRequest?: TokenBudgetRequest
  fixedPrompt: string
  items: TItem[]
  estimator?: TokenEstimator
  estimatorOverestimateRatio?: number
  queue?: Partial<LlmWorkerQueueOptions>
  adaptive?: {
    fallbackMode?: Exclude<LlmLargeTaskSelectedMode, 'single'>
  }
  itemToText?: (item: TItem) => string
  splitItem?: (item: TItem) => TItem[]
  maxItemsPerChunk?: number
  maxItemsPerReduceGroup?: number
  renderSinglePrompt?: (items: TItem[]) => string
  renderMapPrompt?: (chunk: TokenChunk<TItem>) => string
  renderReducePrompt?: (items: unknown[]) => string
  deterministicMerge?: (items: unknown[]) => TOutput
  parseOutput?: (text: string, stage: PlannedCallStage) => TOutput
  parseMapOutput?: (text: string, chunk: TokenChunk<TItem>) => unknown
  parseReduceOutput?: (text: string, items: unknown[]) => TOutput
  validateOutput?: (output: TOutput) => LlmOutputValidationResult
  repairOutput?: (output: TOutput, validation: LlmOutputValidationResult) => TOutput | Promise<TOutput>
  judge?: LlmJudgePolicy<TOutput, TJudge>
  limits?: {
    maxLlmCalls?: number
    maxEstimatedCostUsd?: number
  }
}

export interface LlmLargeTaskMetrics {
  selectedMode: LlmLargeTaskSelectedMode
  callCount: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  actualInputTokens: number
  actualOutputTokens: number
  warnings: string[]
}

export interface LlmLargeTaskRunResult<TOutput = unknown> {
  output: TOutput
  plan: LlmLargeTaskPlan
  metrics: LlmLargeTaskMetrics
}

export interface LlmWorkerQueueCall<T = unknown> {
  id: string
  tenantId?: string
  provider: string
  model: string
  stage: PlannedCallStage
  execute(attempt: number): Promise<T>
}

export interface LlmWorkerQueueRetryPolicy {
  maxAttempts: number
  backoffMs: (attempt: number, error: unknown) => number
  isRetryable?: (error: unknown) => boolean
}

export interface LlmWorkerQueueOptions {
  concurrency: number
  tenantConcurrency?: Record<string, number>
  providerConcurrency?: Record<string, number>
  modelConcurrency?: Record<string, number>
  queueDepthLimit?: number
  retry?: LlmWorkerQueueRetryPolicy
  onEvent?: (event: LlmWorkerQueueEvent) => void
}

export type LlmWorkerQueueEvent =
  | { type: 'queued'; id: string; queueDepth: number }
  | { type: 'started'; id: string; active: number; attempt: number }
  | { type: 'finished'; id: string; active: number; attempt: number }
  | { type: 'failed'; id: string; active: number; attempt: number; code: string }

export type LlmProvider = (prompt: string, options?: { stage?: PlannedCallStage; attempt?: number; signal?: AbortSignal; maxOutputTokens?: number }) => Promise<{ text: string }>
