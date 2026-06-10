export type BusinessDocsTaskType =
  | 'system_design'
  | 'data_dictionary'
  | 'business_rules'
  | 'use_case_list'
  | 'use_case_list_refine'
  | 'use_case_spec'
  | 'epic_glossary'
  | 'project_glossary'

export type BusinessDocsStoredDocumentType =
  | 'design'
  | 'data_dictionary'
  | 'br'
  | 'ucl'
  | 'ucs'
  | 'glossary'

export type BusinessDocsLowerDocumentType =
  | 'api_spec'
  | 'screen_spec'
  | 'event_spec'
  | 'schedule_spec'

export type BusinessDocsPreviewDocType =
  | 'system_design'
  | 'data_dictionary'
  | 'br'
  | 'ucl'
  | 'ucs'
  | 'glossary'

export type BusinessDocsGenerationRunStatus =
  | 'running'
  | 'repair_requested'
  | 'failed'
  | 'completed'
  | 'cancelled'

export type BusinessDocsGenerationTaskStatus =
  | 'pending'
  | 'leased'
  | 'expired'
  | 'submitted'
  | 'saved'
  | 'proposal_created'
  | 'repair_requested'
  | 'blocked'
  | 'failed'
  | 'skipped'

export type BusinessDocsContextPageKind =
  | 'target'
  | 'schema'
  | 'source_graph_projection'
  | 'source_document_cards'
  | 'relation_evidence'
  | 'model_evidence'
  | 'upstream_business_docs'
  | 'existing_canonical'
  | 'validation_errors'
  | 'project_glossary_context'

export interface BusinessDocsRuntimePolicy {
  workerRuntime: 'external_cli'
  workerProvider: 'codex'
  maxWorkerCount: number
  approvedActiveLeases: number
  epicSchedulingConcurrency: number
  writerSoftLimit: number
  ucsChunkSize: number
  ucsSchedulingConcurrency: number
  maxRepairAttempts: number
  persistMode: 'incremental'
  projectGlossaryMode: 'auto'
  judgeMode: 'off'
  outputLanguage: 'ko' | 'en'
}

export interface BusinessDocsBlocker {
  severity: 'fatal' | 'warning'
  code: 'NO_CONFIRMED_EPICS' | 'NO_SOURCE_DOCUMENTS' | 'PROJECT_NOT_FOUND'
  message: string
  epicId?: string
}

export type BusinessDocsProjectGlossaryMode = 'full_build' | 'incremental_merge' | 'blocked' | 'skipped'

export type BusinessDocsSourceDocCounts = Record<BusinessDocsLowerDocumentType, number>

export interface BusinessDocsPerEpicPreview {
  epicId: string
  epicName: string
  existingPassedDocTypes: BusinessDocsPreviewDocType[]
  missingDocTypes: BusinessDocsPreviewDocType[]
  sourceDocCounts: BusinessDocsSourceDocCounts
  blockers: BusinessDocsBlocker[]
}

export type BusinessDocsEstimatedTasks = Record<BusinessDocsTaskType, number> & { total: number }

export interface BusinessDocsPreview {
  project: {
    id: string
    name: string
  }
  confirmedEpicCount: number
  selectedEpicCount: number
  blockers: BusinessDocsBlocker[]
  documentPlan: {
    perEpic: BusinessDocsPerEpicPreview[]
    projectGlossary: BusinessDocsProjectGlossaryMode
  }
  recommendedPolicy: BusinessDocsRuntimePolicy
  estimatedTasks: BusinessDocsEstimatedTasks
  warnings: string[]
}

export interface BusinessDocsStartResult {
  mode: 'created' | 'resumed'
  run: {
    id: string
    projectId: string
    status: BusinessDocsGenerationRunStatus
    sourceCommit: string
    forceRegenerate: boolean
    createdAt: string
    updatedAt: string
  }
  project: {
    id: string
    name: string
  }
  policy: BusinessDocsRuntimePolicy
  preview: BusinessDocsPreview
  tasks: {
    total: number
    created: number
    resumable: number
    skippedExisting: number
    byType: BusinessDocsEstimatedTasks
  }
  contexts: {
    bundlesCreated: number
    pagesCreated: number
    deferredDependencyContexts: number
  }
  nextAction: {
    type: 'lease_tasks' | 'inspect_existing_run' | 'fix_preview_blockers'
    command?: string[]
  }
}

export type BusinessDocsStartServiceResult =
  | { ok: true; data: BusinessDocsStartResult }
  | {
    ok: false
    code: 'BUSINESS_DOCS_START_BLOCKED'
    message: string
    preview: BusinessDocsPreview
  }

export interface BusinessDocsLeasedTask {
  id: string
  runId: string
  taskType: BusinessDocsTaskType
  documentType: BusinessDocsStoredDocumentType
  scope: 'epic' | 'project' | 'use_case'
  scopeId: string
  epicId: string | null
  attemptNo: number
  leaseToken: string
  leaseExpiresAt: string
  contextHandle: string
  contextPageTokens: string[]
  dependsOnTaskIds: string[]
}

export interface BusinessDocsLeaseResult {
  run: {
    id: string
    projectId: string
    status: BusinessDocsGenerationRunStatus
  }
  worker: {
    id: string
  }
  lease: {
    requested: number
    granted: number
    activeLeaseLimit: number
    activeLeasesBefore: number
    leaseTtlMs: number
  }
  tasks: BusinessDocsLeasedTask[]
  nextAction: {
    type: 'read_context' | 'no_ready_tasks'
  }
}

export interface BusinessDocsHeartbeatResult {
  task: {
    id: string
    runId: string
    status: 'leased'
    workerId: string
    attemptNo: number
    leaseExpiresAt: string
    contextHandle: string
  }
  lease: {
    leaseToken: string
    leaseTtlMs: number
  }
}

export interface BusinessDocsContextBundleResult {
  run: {
    id: string
    projectId: string
    status: BusinessDocsGenerationRunStatus
  }
  task: {
    id: string
    runId: string
    status: 'leased'
    taskType: BusinessDocsTaskType
    documentType: BusinessDocsStoredDocumentType
    scope: 'epic' | 'project' | 'use_case'
    scopeId: string
    attemptNo: number
    leaseExpiresAt: string
    contextHandle: string
  }
  manifest: BusinessDocsContextManifest
  pages: Array<{
    pageToken: string
    pageKind: BusinessDocsContextPageKind
    pageOrder: number
    summary: string
    evidenceIds: string[]
    contentHash: string
  }>
}

export interface BusinessDocsContextPageResult {
  run: BusinessDocsContextBundleResult['run']
  task: BusinessDocsContextBundleResult['task']
  page: {
    pageToken: string
    pageKind: BusinessDocsContextPageKind
    pageOrder: number
    summary: string
    evidenceIds: string[]
    contentHash: string
    content: Record<string, unknown>
  }
  manifest: Pick<
    BusinessDocsContextManifest,
    'schemaVersion' | 'sourceCommit' | 'generatedAt' | 'evidenceIdNamespace'
  >
}

export type BusinessDocsLeaseFailureCode =
  | 'BUSINESS_DOCS_RUN_NOT_FOUND'
  | 'BUSINESS_DOCS_RUN_NOT_LEASEABLE'
  | 'BUSINESS_DOCS_INVALID_LIMIT'

export type BusinessDocsLeaseServiceResult =
  | { ok: true; data: BusinessDocsLeaseResult }
  | { ok: false; code: BusinessDocsLeaseFailureCode; message: string }

export type BusinessDocsHeartbeatServiceResult =
  | { ok: true; data: BusinessDocsHeartbeatResult }
  | {
    ok: false
    code: 'BUSINESS_DOCS_LEASE_TOKEN_REQUIRED' | 'BUSINESS_DOCS_LEASE_CONFLICT'
    message: string
  }

export type BusinessDocsContextBundleServiceResult =
  | { ok: true; data: BusinessDocsContextBundleResult }
  | {
    ok: false
    code: 'BUSINESS_DOCS_LEASE_TOKEN_REQUIRED' | 'BUSINESS_DOCS_CONTEXT_NOT_FOUND' | 'BUSINESS_DOCS_LEASE_CONFLICT'
    message: string
  }

export type BusinessDocsContextPageServiceResult =
  | { ok: true; data: BusinessDocsContextPageResult }
  | {
    ok: false
    code:
      | 'BUSINESS_DOCS_LEASE_TOKEN_REQUIRED'
      | 'BUSINESS_DOCS_CONTEXT_NOT_FOUND'
      | 'BUSINESS_DOCS_CONTEXT_PAGE_NOT_FOUND'
      | 'BUSINESS_DOCS_LEASE_CONFLICT'
    message: string
  }

export interface BusinessDocsSubmittedDocumentItem {
  itemType: string
  stableKey: string
  ordinal?: number
  title?: string
  summary?: string
  content: Record<string, unknown>
  evidenceIds?: string[]
}

export interface BusinessDocsGlossaryAmbiguityCandidate {
  meaning: string
  epic_ids: string[]
  source_doc_ids: string[]
}

export interface BusinessDocsGlossaryAmbiguity {
  status: 'none' | 'ambiguous' | 'user_resolved'
  candidates: BusinessDocsGlossaryAmbiguityCandidate[]
  resolution_note?: string
}

export interface BusinessDocsGlossaryRegistryContent {
  term: string
  canonical_term: string
  definition: string
  termType?: 'domain' | 'role' | 'process' | 'status' | 'forbidden' | 'ambiguous'
  type?: 'domain' | 'role' | 'process' | 'status'
  code_term?: string
  aliases?: string[]
  synonyms?: string[]
  candidate_aliases?: string[]
  antonyms?: string[]
  contrast_terms?: string[]
  related_terms?: string[]
  signals?: string[]
  epic_ids?: string[]
  source_doc_ids?: string[]
  source_mapping?: Array<{ sourceRef: string; role: string; reason: string }>
  trigger?: string
  caution?: string
  entity?: string
  code_value?: string
  ambiguity?: BusinessDocsGlossaryAmbiguity
}

export interface BusinessDocsSubmittedDocument {
  schemaVersion: 'business-doc.v1'
  documentType: BusinessDocsStoredDocumentType
  scope: 'epic' | 'project' | 'use_case'
  scopeId: string
  title: string
  summary: string
  content: Record<string, unknown>
  evidenceIds: string[]
  baseContentHash?: string | null
  items?: BusinessDocsSubmittedDocumentItem[]
}

export type BusinessDocsValidationErrorCode =
  | 'SCHEMA_INVALID'
  | 'TARGET_MISMATCH'
  | 'UNKNOWN_EVIDENCE_ID'
  | 'DUPLICATE_ITEM_KEY'
  | 'MISSING_FINAL_UCL_ITEMS'
  | 'SOT_VALIDATION_FAILED'
  | 'SOURCE_COVERAGE_MISSING'
  | 'DOCUMENT_QUALITY_INSUFFICIENT'
  | 'UCL_QUALITY_INSUFFICIENT'
  | 'UCS_QUALITY_INSUFFICIENT'
  | 'DD_QUALITY_INSUFFICIENT'
  | 'BR_QUALITY_INSUFFICIENT'
  | 'DESIGN_QUALITY_INSUFFICIENT'
  | 'GLOSSARY_QUALITY_INSUFFICIENT'
  | 'GLOSSARY_ALIAS_COLLISION'
  | 'SOURCE_RELATION_UNSUPPORTED'

export interface BusinessDocsValidationError {
  code: BusinessDocsValidationErrorCode
  path: string
  message: string
}

export interface BusinessDocsNormalizedSubmitRecord {
  schemaVersion: 'business-docs-submit.v1'
  taskId: string
  leaseToken: string
  attemptNo: number
  contentHash: string
  document: BusinessDocsSubmittedDocument
}

export interface BusinessDocsSubmitResult {
  task: {
    id: string
    runId: string
    taskType: BusinessDocsTaskType
    documentType: BusinessDocsStoredDocumentType
    scope: 'epic' | 'project' | 'use_case'
    scopeId: string
    status: 'saved' | 'proposal_created' | 'repair_requested' | 'failed'
    attemptNo: number
    contextHandle: string
  }
  submit: {
    contentHash: string
    idempotent: boolean
    validationErrorCount: number
  }
  document: {
    savedDocumentId: string | null
    proposalId: string | null
    operation: 'create' | 'update' | 'proposal_create' | 'proposal_update' | 'checkpoint_only' | null
    baseDocumentId: string | null
  }
  repair: {
    validationPageToken: 'validation_errors' | null
    nextAttemptNo: number | null
    maxRepairAttempts: number
  }
  downstream: {
    contextsUnlocked: number
    contextPagesUpserted: number
    ucsTasksCreated: number
  }
  nextAction: {
    type: 'lease_more' | 'repair_task' | 'stop_failed'
  }
}

export type BusinessDocsSubmitFailureCode =
  | 'BUSINESS_DOCS_TASK_NOT_FOUND'
  | 'BUSINESS_DOCS_RUN_NOT_SUBMITTABLE'
  | 'BUSINESS_DOCS_LEASE_CONFLICT'
  | 'BUSINESS_DOCS_ATTEMPT_CONFLICT'
  | 'BUSINESS_DOCS_TASK_NOT_SUBMITTABLE'
  | 'BUSINESS_DOCS_SUBMIT_NOT_IDEMPOTENT'

export type BusinessDocsSubmitServiceResult =
  | { ok: true; data: BusinessDocsSubmitResult }
  | { ok: false; code: BusinessDocsSubmitFailureCode; message: string }

export type BusinessDocsTaskStatusCounts = Record<BusinessDocsGenerationTaskStatus, number> & {
  total: number
}

export interface BusinessDocsLifecycleRunSummary {
  id: string
  projectId: string
  status: BusinessDocsGenerationRunStatus
  sourceCommit: string
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export interface BusinessDocsLifecycleRecentEvent {
  type:
    | 'run_created'
    | 'run_completed'
    | 'run_failed'
    | 'run_cancelled'
    | 'task_pending'
    | 'task_leased'
    | 'task_saved'
    | 'task_proposal_created'
    | 'task_repair_requested'
    | 'task_failed'
    | 'task_expired'
  taskId?: string
  taskType?: BusinessDocsTaskType
  at: string
}

export type BusinessDocsLifecycleNextAction =
  | { type: 'lease_tasks'; command?: string[] }
  | { type: 'repair_task'; command?: string[] }
  | { type: 'retry_failed'; command?: string[] }
  | { type: 'cleanup_completed'; command?: string[] }
  | { type: 'done'; command?: string[] }
  | { type: 'cancelled'; command?: string[] }

export interface BusinessDocsStatusResult {
  run: BusinessDocsLifecycleRunSummary
  tasks: {
    counts: BusinessDocsTaskStatusCounts
    activeLeases: number
    expiredRecovered: number
    retryableFailed: Array<{
      id: string
      taskType: BusinessDocsTaskType
      attemptNo: number
      lastError: unknown
    }>
  }
  documents: {
    saved: number
    proposals: number
    failed: number
  }
  contexts: {
    bundles: number
    pages: number
    cleaned: boolean
  }
  recentEvents: BusinessDocsLifecycleRecentEvent[]
  nextAction: BusinessDocsLifecycleNextAction
}

export interface BusinessDocsResumeResult {
  run: BusinessDocsLifecycleRunSummary
  recovered: {
    expiredLeases: number
    repairTasksReady: number
    failedTasksReady: number
  }
  nextAction: BusinessDocsLifecycleNextAction
}

export interface BusinessDocsReleaseLeasesResult {
  run: BusinessDocsLifecycleRunSummary
  released: {
    activeLeases: number
  }
  nextAction: { type: 'lease_tasks' | 'done' | 'repair_task' | 'retry_failed' }
}

export interface BusinessDocsRetryResult {
  run: BusinessDocsLifecycleRunSummary
  task: {
    id: string
    runId: string
    status: 'pending'
    previousStatus: 'repair_requested' | 'failed' | 'expired'
    attemptNo: number
    contextHandle: string
  }
  nextAction: { type: 'lease_tasks' }
}

export interface BusinessDocsCancelResult {
  run: BusinessDocsLifecycleRunSummary
  cancelled: {
    activeLeasesCleared: number
    pendingTasksBlocked: number
    contextRetained: boolean
  }
  nextAction: { type: 'cancelled' }
}

export interface BusinessDocsCleanupResult {
  run: BusinessDocsLifecycleRunSummary
  cleanup: {
    bundlesDeleted: number
    pagesDeleted: number
    contextRetained: boolean
  }
  nextAction: { type: 'done' }
}

export type BusinessDocsLifecycleFailureCode =
  | 'BUSINESS_DOCS_RUN_NOT_FOUND'
  | 'BUSINESS_DOCS_RUN_NOT_RESUMABLE'
  | 'BUSINESS_DOCS_RUN_NOT_CANCELLABLE'
  | 'BUSINESS_DOCS_RUN_NOT_CLEANABLE'
  | 'BUSINESS_DOCS_TASK_NOT_FOUND'
  | 'BUSINESS_DOCS_TASK_NOT_RETRYABLE'

export type BusinessDocsStatusServiceResult =
  | { ok: true; data: BusinessDocsStatusResult }
  | { ok: false; code: 'BUSINESS_DOCS_RUN_NOT_FOUND'; message: string }

export type BusinessDocsResumeServiceResult =
  | { ok: true; data: BusinessDocsResumeResult }
  | { ok: false; code: 'BUSINESS_DOCS_RUN_NOT_FOUND' | 'BUSINESS_DOCS_RUN_NOT_RESUMABLE'; message: string }

export type BusinessDocsReleaseLeasesServiceResult =
  | { ok: true; data: BusinessDocsReleaseLeasesResult }
  | { ok: false; code: 'BUSINESS_DOCS_RUN_NOT_FOUND' | 'BUSINESS_DOCS_RUN_NOT_RESUMABLE'; message: string }

export type BusinessDocsRetryServiceResult =
  | { ok: true; data: BusinessDocsRetryResult }
  | { ok: false; code: 'BUSINESS_DOCS_TASK_NOT_FOUND' | 'BUSINESS_DOCS_TASK_NOT_RETRYABLE'; message: string }

export type BusinessDocsCancelServiceResult =
  | { ok: true; data: BusinessDocsCancelResult }
  | { ok: false; code: 'BUSINESS_DOCS_RUN_NOT_FOUND' | 'BUSINESS_DOCS_RUN_NOT_CANCELLABLE'; message: string }

export type BusinessDocsCleanupServiceResult =
  | { ok: true; data: BusinessDocsCleanupResult }
  | { ok: false; code: 'BUSINESS_DOCS_RUN_NOT_FOUND' | 'BUSINESS_DOCS_RUN_NOT_CLEANABLE'; message: string }

export interface BusinessDocsValidationIssue {
  severity: 'fatal' | 'warning'
  code: string
  message: string
  documentId?: string
  taskId?: string
}

export interface BusinessDocsValidateResult {
  run: BusinessDocsLifecycleRunSummary
  fatal: BusinessDocsValidationIssue[]
  warnings: BusinessDocsValidationIssue[]
  summary: {
    fatalCount: number
    warningCount: number
  }
}

export interface BusinessDocsReviewResult {
  run: BusinessDocsLifecycleRunSummary
  tasks: {
    counts: BusinessDocsTaskStatusCounts
  }
  documents: {
    saved: number
    proposals: number
    failed: number
    activeDocumentCount: number
    proposalCount: number
    byType: Record<string, number>
  }
  items: {
    total: number
    linkedToSource: number
    unlinked: number
    byType: Record<string, number>
  }
  coverage: {
    requiredEpicCount: number
    epicsWithRequiredDocs: number
    missingByEpic: Array<{ epicId: string; missingDocumentTypes: BusinessDocsStoredDocumentType[] }>
  }
  validation: {
    fatalCount: number
    warningCount: number
    issuesByCode: Record<string, number>
  }
  nextAction: BusinessDocsLifecycleNextAction
}

export interface BusinessDocsDocumentShowResult {
  document: {
    id: string
    type: string
    scope: string
    scopeId: string | null
    status: string
    validity: string
    summary: string | null
    content: Record<string, unknown> | null
    contentHash: string | null
    staticSnapshotId: string | null
    documentSourceHash: string | null
    sourceRunId: string | null
  }
  freshness: {
    state: 'fresh' | 'stale' | 'orphaned'
    reason: 'source_changed' | 'orphaned' | null
  }
  items: Array<{
    id: string
    itemType: string
    stableKey: string
    title: string | null
    summary: string | null
    content: Record<string, unknown>
    status: string
    sourceDocumentLinks: Array<{ documentId: string; linkType: string; role: string | null }>
    targetDocumentLinks: Array<{ documentId: string; linkType: string; role: string | null }>
    relatedItems: Array<{ itemId: string; linkType: string; role: string | null }>
    modelLinks: Array<{ modelId: string; fieldName: string | null; linkType: string; role: string }>
  }>
}

export type BusinessDocsValidateServiceResult =
  | { ok: true; data: BusinessDocsValidateResult }
  | { ok: false; code: 'BUSINESS_DOCS_RUN_NOT_FOUND'; message: string }

export type BusinessDocsReviewServiceResult =
  | { ok: true; data: BusinessDocsReviewResult }
  | { ok: false; code: 'BUSINESS_DOCS_RUN_NOT_FOUND'; message: string }

export type BusinessDocsDocumentShowServiceResult =
  | { ok: true; data: BusinessDocsDocumentShowResult }
  | { ok: false; code: 'BUSINESS_DOCS_DOCUMENT_NOT_FOUND'; message: string }

export interface BusinessDocsContextManifest {
  runId: string
  taskId: string
  schemaVersion: string
  sourceCommit: string
  generatedAt: string
  evidenceIdNamespace: string
  pageTokens: string[]
  dependencyTaskIds: string[]
  dependencyPagesReady: boolean
  deferredPages: BusinessDocsContextPageKind[]
}

export const TASK_DOCUMENT_TYPE = {
  system_design: 'design',
  data_dictionary: 'data_dictionary',
  business_rules: 'br',
  use_case_list: 'ucl',
  use_case_list_refine: 'ucl',
  use_case_spec: 'ucs',
  epic_glossary: 'glossary',
  project_glossary: 'glossary',
} as const satisfies Record<BusinessDocsTaskType, BusinessDocsStoredDocumentType>

export const DEFAULT_BUSINESS_DOCS_RUNTIME_POLICY = {
  workerRuntime: 'external_cli',
  workerProvider: 'codex',
  maxWorkerCount: 20,
  approvedActiveLeases: 20,
  epicSchedulingConcurrency: 4,
  writerSoftLimit: 6,
  ucsChunkSize: 1,
  ucsSchedulingConcurrency: 16,
  maxRepairAttempts: 1,
  persistMode: 'incremental',
  projectGlossaryMode: 'auto',
  judgeMode: 'off',
  outputLanguage: 'en',
} as const satisfies BusinessDocsRuntimePolicy
