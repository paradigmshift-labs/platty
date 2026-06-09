export type ErrorCode =
  | 'ANALYSIS_FAILED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'ALREADY_RUNNING'
  | 'UNSUPPORTED_LANGUAGE'
  | 'PIPELINE_TIMEOUT'
  | 'SYNC_STAGING_REQUIRED'
  | 'SYNC_GIT_DIFF_FAILED'
  | 'SYNC_APPLY_PATCHES_REQUIRED'
  | 'SYNC_PLAN_COMMIT_DRIFT'
  | 'SYNC_PLAN_ITEMS_NOT_READY'
  | 'SYNC_PLAN_CONFIRMATION_REQUIRED'
  | 'LLM_FAILED'
  | 'ABORTED'

export class PipelineError extends Error {
  public readonly code: ErrorCode
  public readonly cause?: unknown

  constructor(message: string, code: ErrorCode = 'ANALYSIS_FAILED', options?: { cause?: unknown }) {
    super(message)
    this.name = 'PipelineError'
    this.code = code
    if (options?.cause !== undefined) {
      this.cause = options.cause
    }
  }
}

export class AbortError extends Error {
  constructor(message = 'Operation aborted') {
    super(message)
    this.name = 'AbortError'
  }
}
