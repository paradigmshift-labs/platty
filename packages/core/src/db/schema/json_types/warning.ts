import { z } from 'zod'

/**
 * Warning — repository 분석/검증 중 발견된 비차단 경고.
 * F3 validate_paths가 누락된 schema 파일, entrypoint 등을 발견 시 수집.
 */
export const WarningSchema = z.object({
  field: z.string(),                                              // 'schema_sources', 'entrypoint_files' 등
  message: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
})

export type Warning = z.infer<typeof WarningSchema>
