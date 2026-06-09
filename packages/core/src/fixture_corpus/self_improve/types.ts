import type { CorpusStageId, FixtureExecutionScope } from '../registry.js'

export type SelfImproveStage = CorpusStageId | 'all'

export type SelfImproveDecision =
  | 'pass_existing_expected'
  | 'promote_new_expected'
  | 'update_stale_expected'
  | 'pipeline_fix_required'
  | 'adapter_addition_required'
  | 'contract_change_reported'
  | 'oracle_required'
  | 'manual_review'

export type SelfImproveCompareScenario = 'A_new' | 'B_regression' | 'C_recheck' | 'incomplete'
export type OracleCandidateConfidence = 'low' | 'medium' | 'high'

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface SourceEvidence {
  path: string
  summary: string
  confidence: OracleCandidateConfidence
}

export interface OracleCandidate {
  fixtureId: string
  stage: SelfImproveStage
  candidatePath: string
  evidence: SourceEvidence[]
  confidence: OracleCandidateConfidence
  notes?: string[]
}

export interface SelfImproveDecisionInput {
  fixtureId: string
  stage: SelfImproveStage
  fixtureScope: FixtureExecutionScope
  compareScenario: SelfImproveCompareScenario
  comparePassed: boolean
  expectedPath?: string
  actualPath?: string
  candidatePath?: string
  expectedExists?: boolean
  actualExists?: boolean
  candidateExists?: boolean
  actualMatchesExpected?: boolean
  actualMatchesCandidate?: boolean
  oracleConfidence?: OracleCandidateConfidence
  contractChangeSuspected?: boolean
  adapterGapSuspected?: boolean
  oracleRequired?: boolean
}

export interface SelfImproveDecisionResult {
  decision: SelfImproveDecision
  reason: string
  shouldPromoteCandidate: boolean
  shouldOverwriteExpected: boolean
  mayAutoFixPipeline: boolean
  contractChange: boolean
  adapterAddition: boolean
  reportRequired: boolean
}

export const SELF_IMPROVE_DECISIONS = [
  'pass_existing_expected',
  'promote_new_expected',
  'update_stale_expected',
  'pipeline_fix_required',
  'adapter_addition_required',
  'contract_change_reported',
  'oracle_required',
  'manual_review',
] as const satisfies readonly SelfImproveDecision[]

export const SELF_IMPROVE_FAILURE_LIMIT = 5

export const SELF_IMPROVE_REPORTABLE_DECISIONS = [
  'promote_new_expected',
  'update_stale_expected',
  'pipeline_fix_required',
  'adapter_addition_required',
  'contract_change_reported',
  'oracle_required',
  'manual_review',
] as const satisfies readonly SelfImproveDecision[]
