export type LlmLargeTaskErrorCode =
  | 'MODEL_PROFILE_NOT_FOUND'
  | 'TOKEN_BUDGET_INVALID'
  | 'FIXED_PROMPT_OVERHEAD_EXCEEDS_TOKEN_BUDGET'
  | 'ADAPTIVE_FALLBACK_REQUIRED'
  | 'CHUNK_SPLIT_NO_PROGRESS'
  | 'PLAN_LLM_CALL_COUNT_EXCEEDS_LIMIT'
  | 'PLAN_ESTIMATED_COST_EXCEEDS_LIMIT'
  | 'QUEUE_DEPTH_EXCEEDED'
  | 'OUTPUT_VALIDATION_FAILED'
  | 'JUDGE_FAILED'

export class LlmLargeTaskError extends Error {
  constructor(
    readonly code: LlmLargeTaskErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'LlmLargeTaskError'
  }
}

export function errorCode(error: unknown): string {
  if (error instanceof LlmLargeTaskError) return error.code
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return 'UNKNOWN'
}
