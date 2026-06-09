export type ExportExitCode = 0 | 1

export function assertRealLlmExportEnabled(env: Record<string, string | undefined> = process.env): void {
  if (env.PIPELINE_E2E_REAL_LLM !== '1') {
    throw new Error('PIPELINE_E2E_REAL_LLM=1 is required for real LLM export scripts.')
  }
}

export function mergeExportExitCode(current: ExportExitCode, next: ExportExitCode): ExportExitCode {
  return current === 1 || next === 1 ? 1 : 0
}
