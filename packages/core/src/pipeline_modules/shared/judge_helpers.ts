export const criticalFailureValues = [
  'auth_mismatch',
  'permission_mismatch',
  'db_side_effect_missing',
  'external_call_missing',
  'event_publish_missing',
  'unsupported_business_claim',
  'use_case_missing',
  'epic_boundary_misclassified',
] as const

export type CriticalFailure = typeof criticalFailureValues[number]

export interface CriticalJudgeVerdict {
  score: number
  critical_failures?: CriticalFailure[]
}

export function isCriticalVerdict(verdict: CriticalJudgeVerdict): boolean {
  return verdict.score === 0 || (verdict.critical_failures?.length ?? 0) > 0
}

