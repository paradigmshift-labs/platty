export interface PlattyNextAction {
  type: string
  command?: string[]
  message?: string
  [key: string]: unknown
}

export interface PlattyCommandMessage {
  code: string
  message: string
  retryable?: boolean
}

export interface PlattyEvidenceRef {
  label: string
  path?: string
  url?: string
}

export interface PlattyCommandResult<T = unknown> {
  ok: boolean
  data?: T
  nextAction?: PlattyNextAction
  warnings: PlattyCommandMessage[]
  errors: PlattyCommandMessage[]
  evidenceRefs: PlattyEvidenceRef[]
}

export interface PlattyCommandResponse<T = unknown> {
  exitCode: number
  result: PlattyCommandResult<T>
  stdout: string
  stderr: string
  skipDefaultRender?: boolean
}

export function success<T>(data?: T, extra: Partial<PlattyCommandResult<T>> = {}): PlattyCommandResult<T> {
  return {
    ok: true,
    ...(data === undefined ? {} : { data }),
    ...(extra.nextAction ? { nextAction: extra.nextAction } : {}),
    warnings: extra.warnings ?? [],
    errors: extra.errors ?? [],
    evidenceRefs: extra.evidenceRefs ?? [],
  }
}

export function failure(code: string, message: string, extra: Partial<PlattyCommandResult> = {}): PlattyCommandResult {
  return {
    ok: false,
    ...(extra.data === undefined ? {} : { data: extra.data }),
    ...(extra.nextAction ? { nextAction: extra.nextAction } : {}),
    warnings: extra.warnings ?? [],
    errors: [{ code, message, ...(extra.errors?.[0]?.retryable === undefined ? {} : { retryable: extra.errors[0].retryable }) }],
    evidenceRefs: extra.evidenceRefs ?? [],
  }
}

export function renderJson(result: PlattyCommandResult) {
  return `${JSON.stringify(result, null, 2)}\n`
}

export function renderText(result: PlattyCommandResult) {
  if (result.ok) return 'ok\n'
  const firstError = result.errors[0]
  return `${firstError?.code ?? 'ERROR'}: ${firstError?.message ?? 'command failed'}\n`
}
