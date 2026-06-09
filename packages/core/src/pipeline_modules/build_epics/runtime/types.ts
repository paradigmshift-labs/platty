import type { EpicDraftCommand } from '@/pipeline_modules/build_epics/core/editable_draft.js'
import type { BuildEpicsDocumentType, PersistConfirmedEpicsResult, ReviewableEpicPlan, ValidationIssue } from '@/pipeline_modules/build_epics/core/types.js'

export type BuildEpicsRuntimeTaskType = 'taxonomy_candidate' | 'taxonomy_consolidation' | 'document_assignment' | 'cross_domain_link'
export type BuildEpicsRuntimeStatus = 'building' | 'ready' | 'invalid'

export interface BuildEpicsRuntimePolicyInput {
  maxWorkerCount?: number
  taskMultiplier?: number
  taxonomyChunkSize?: number
  assignmentChunkMinSize?: number
  assignmentChunkMaxSize?: number
  crossDomainChunkSize?: number
  maxCrossLinksPerDocument?: number
  maxRepairPasses?: number
  maxReviewRatioWarning?: number
  maxReviewRatioFatal?: number
  targetDomainMin?: number
  targetDomainMax?: number
  targetEpicMin?: number
  targetEpicMax?: number
  outputLanguage?: 'ko' | 'en'
  allowPartialBuildDocs?: boolean
}

export interface ResolvedBuildEpicsRuntimePolicy extends Required<BuildEpicsRuntimePolicyInput> {
  resolvedAssignmentChunkSize: number
  resolvedAssignmentTaskCount: number
  resolvedTaxonomyTaskCount: number
  resolvedTaxonomyConsolidationTaskCount: number
  resolvedCrossDomainTaskCount: number
}

export interface BuildEpicsDocumentCard {
  documentId: string
  type: BuildEpicsDocumentType
  title: string
  summary: string
  method?: string
  path?: string
  access?: string | null
  routePath?: string
  eventKey?: string
  jobName?: string
  actorHints: string[]
  domainHints: string[]
  relationHints: Array<{ kind: string; target: string | null; operation: string | null; evidenceIds: string[] }>
}

export interface TaxonomyConsolidationAlias {
  fromStableKey: string
  toStableKey: string
  reason: string
}

export interface TaxonomyBoundaryNote {
  stableKey: string
  includes: string[]
  excludes: string[]
}

export interface BuildEpicsRuntimeValidation {
  fatal: ValidationIssue[]
  warnings: ValidationIssue[]
}

export interface BuildEpicsEditableRuntimePlan extends ReviewableEpicPlan {
  version?: number
}

export interface BuildEpicsDraftEditInput {
  expectedVersion: number
  commands: EpicDraftCommand[]
}

export interface BuildEpicsDraftEditResult {
  runId: string
  draftStatus: BuildEpicsRuntimeStatus
  previousVersion: number
  nextVersion: number
  validation: BuildEpicsRuntimeValidation
  changeSummary: {
    commandCount: number
    createdEpics: number
    movedDocuments: number
    renamedEpics: number
    mergedEpics: number
  }
}

export interface BuildEpicsDraftConfirmResult {
  runId: string
  draftVersion: number
  status: 'confirmed'
  persistResult: PersistConfirmedEpicsResult
}

export interface BuildEpicsDraftSnapshot {
  status: BuildEpicsRuntimeStatus
  plan: BuildEpicsEditableRuntimePlan
  validation: BuildEpicsRuntimeValidation
}
