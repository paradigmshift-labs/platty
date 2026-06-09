export type BusinessDocsSyncTargetDocType = 'design' | 'data_dictionary' | 'br' | 'ucl' | 'glossary'
export type BusinessDocsSyncTargetScope = 'epic' | 'project'

export interface BusinessDocsSyncTargetHash {
  key: string
  projectId: string
  documentType: BusinessDocsSyncTargetDocType
  scope: BusinessDocsSyncTargetScope
  scopeId: string
  epicId: string | null
  sourceHash: string
  staticSnapshotId: string | null
  sourceInputs: Record<string, unknown>
}

export interface BusinessDocsSourceHashResult {
  projectId: string
  latestStaticSnapshotId: string | null
  targets: BusinessDocsSyncTargetHash[]
}

export type BusinessDocsSyncTargetState = 'fresh' | 'missing' | 'stale' | 'blocked'

export interface BusinessDocsSyncTargetPreview extends BusinessDocsSyncTargetHash {
  state: BusinessDocsSyncTargetState
  reason: 'source_hash_match' | 'missing_document' | 'source_changed' | 'no_source_documents'
  existingDocumentId: string | null
  existingDocumentSourceHash: string | null
  taskPlanned: boolean
}

export interface BusinessDocsSyncOrphanPreview {
  documentId: string
  key: string
  documentType: BusinessDocsSyncTargetDocType
  scope: 'epic' | 'project'
  scopeId: string
  epicId: string | null
  state: 'orphaned'
  reason: 'epic_missing_or_unconfirmed' | 'source_target_missing'
}

export interface BusinessDocsSyncPreviewSummary {
  fresh: number
  missing: number
  stale: number
  orphaned: number
  blocked: number
  tasksPlanned: number
}

export interface BusinessDocsSyncPreviewResult {
  projectId: string
  project: {
    id: string
    name: string
  }
  docSyncPlanId?: string
  latestStaticSnapshotId: string | null
  summary: BusinessDocsSyncPreviewSummary
  targets: BusinessDocsSyncTargetPreview[]
  orphanedTargets: BusinessDocsSyncOrphanPreview[]
}
