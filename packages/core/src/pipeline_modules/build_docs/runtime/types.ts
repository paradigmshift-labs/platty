import type { DB } from '@/db/client.js'
import type { CodeRelationConfidence, CodeRelationKind } from '@/db/schema/build_relations.js'
import type { GenerationRunStatus, GenerationTaskStatus, TechnicalDocumentType } from '@/db/schema/build_docs.js'
import type { ServiceMapEdgeKind, ServiceMapEdgeSource, ServiceMapNodeType } from '@/db/schema/build_service_map.js'

export const BUILD_DOCS_GENERATION_SCHEMA_VERSION = 'build_docs_cli_generation_v2'
export const BUILD_DOCS_LEASE_TTL_MS = 15 * 60 * 1000

export interface BuildDocsGenerationRuntimeInput {
  db: DB
}

export interface DocumentTarget {
  documentId: string
  documentType: TechnicalDocumentType
  seedNodeIds: string[]
  entryPointIds: string[]
  primaryEntryPointId: string
  targetKey: string
  metadata: {
    framework_hint: string | null
    file_path: string
  }
}

export interface GenerationTargetContext extends Record<string, unknown> {
  document_id: string
  document_type: TechnicalDocumentType
  target_key: string
  primary_entry_point_id: string
  seed_node_ids: string[]
  entry_point_ids: string[]
  repository_id: string
  method: string
  path: string
  handler: string
  file_path: string
  framework_hint: string | null
}

export interface SourceContext extends Record<string, unknown> {
  evidence_id: string
  node_id: string
  node_type: string
  dep_type: 'entrypoint' | 'dependency'
  hop: number
  file_path: string
  symbol: string
  line_start: number | null
  line_end: number | null
  signature: string | null
  source_missing: boolean
  source_excerpt: string
}

export type SourceLinkRole = 'access' | 'input' | 'response'

export interface SourceLinkCandidate extends Record<string, unknown> {
  candidate_id: string
  node_id: string
  symbol: string
  node_type: string
  file_path: string
  line_start: number | null
  line_end: number | null
  evidence_id: string
  role_hints: string[]
}

export type SourceLinkSelection = Partial<Record<SourceLinkRole, string[]>>

export interface SourceLinks extends Record<SourceLinkRole, string[]> {}

export type StaticContractMode = 'none' | 'field_map' | 'source_ref_only'

export interface StaticSourceRef extends Record<string, unknown> {
  kind: 'route_path' | 'query_dto' | 'body_dto' | 'return_type' | 'source_symbol'
  symbol: string
  file_path: string
  line_start: number | null
  line_end: number | null
  evidence_id: string
}

export interface StaticContractSection extends Record<string, unknown> {
  mode: StaticContractMode
  source_refs: StaticSourceRef[]
  fields: Record<string, unknown> | null
}

export interface StaticDocumentContracts extends Record<string, unknown> {
  request?: {
    path: StaticContractSection
    query: StaticContractSection
    body: StaticContractSection
  }
  response?: StaticContractSection
}

export interface StaticDocumentEnvelope extends Record<string, unknown> {
  id: string
  type: TechnicalDocumentType
  identity: Record<string, unknown>
  relations: Record<string, unknown[]>
  evidence_refs: string[]
  relation_evidence_checked: true
  contracts?: StaticDocumentContracts
  source_links?: SourceLinks
}

export interface CollectedContract {
  nodeId: string
  nodeType: string
  name: string
  filePath: string
  lineStart: number | null
  lineEnd: number | null
  signature: string | null
  sourceCode: string
  sourceMissing: boolean
  hop: number
  depType: 'entrypoint' | 'dependency'
}

export interface GroupContext {
  group: DocumentTarget
  contracts: CollectedContract[]
  relations: Array<{
    relationId: string
    repoId: string
    sourceNodeId: string
    kind: CodeRelationKind
    target: string | null
    operation: string | null
    canonicalTarget?: string | null
    payload: Record<string, unknown>
    evidenceNodeIds: string[]
    confidence: CodeRelationConfidence
    unresolvedReason: string | null
  }>
  estimatedTokens: number
  truncated: boolean
}

export interface RelationFactContext extends Record<string, unknown> {
  evidence_id: string
  relation_id: string
  repo_id: string
  source_node_id: string
  kind: CodeRelationKind
  target: string | null
  canonical_target: string | null
  operation: string | null
  confidence: CodeRelationConfidence
  source: 'deterministic' | 'service_map'
  evidence_node_ids: string[]
  payload: Record<string, unknown>
  unresolved_reason: string | null
}

export interface SharedCodeSegmentContext extends Record<string, unknown> {
  segment_id: string
  root_node_id: string
  root_symbol: string
  root_file_path: string
  detector_version: string
  summary_schema_version: string
  used_by_entrypoint_count: number
  used_by_entrypoints?: Array<{
    entry_point_id: string
    document_type: TechnicalDocumentType
    target_key: string
    depth: number
  }>
  covered_node_ids?: string[]
  summary: {
    title: string
    natural_language_summary: string
    public_contract: string[]
    business_relevance: string[]
    source_refs: Array<{
      node_id: string
      symbol: string
      file_path: string
      line_start: number | null
      line_end: number | null
    }>
  }
}

export interface LlmResult {
  model?: string
  provider?: string
  usage?: Record<string, unknown>
}

export interface SynthesisResult {
  document: Record<string, unknown> | null
  rawLlmOutput: string
  status: 'ok' | 'failed'
  retries: number
  llmResult: LlmResult
  prompt: string
  hasDivergence: boolean
  divergenceItems: unknown[]
  attempts?: unknown[]
  failure?: unknown
}

export interface PersistResult {
  upserted_docs: number
  upserted_deps: number
  document_id: string
}

export interface RelatedServiceMapEdgeContext extends Record<string, unknown> {
  evidence_id: string
  id: string
  direction: 'incoming' | 'outgoing'
  kind: ServiceMapEdgeKind
  confidence: CodeRelationConfidence
  source: ServiceMapEdgeSource
  source_type: ServiceMapNodeType
  source_id: string
  source_label: string | null
  target_type: ServiceMapNodeType
  target_id: string
  target_label: string | null
  canonical_target: string
}

export interface DraftSchemaContext extends Record<string, unknown> {
  schema_name: TechnicalDocumentType
  schema_version: string
  llm_output_shape: Record<string, unknown>
  system_injected_fields: string[]
  required_fields: string[]
  output_rules: string[]
  quality_rules: string[]
}

export interface BuildDocsGenerationMetadata extends Record<string, unknown> {
  run_id: string
  task_id?: string
  schema_version: string
  source_commit: string
  generated_at: string
  evidence_id_namespace: string
}

export interface BuildDocsGenerationManifest extends Record<string, unknown> {
  context_handle: string
  task_id: string
  schema_version: string
  required_pages: string[]
  optional_pages: string[]
  evidence_ids: string[]
  page_token_budget_estimates?: Record<string, number>
  source_context_compaction?: {
    original_source_context_count: number
    compacted_source_context_count: number
    omitted_node_count: number
    segment_ids: string[]
  }
}

export interface BuildDocsGenerationContextResponse {
  metadata: BuildDocsGenerationMetadata
  manifest: BuildDocsGenerationManifest
  content: {
    target: GenerationTargetContext
    source_context: SourceContext[]
    shared_context?: SharedCodeSegmentContext[]
    source_context_compaction?: BuildDocsGenerationManifest['source_context_compaction']
    source_link_candidates?: SourceLinkCandidate[]
    code_relation_facts: RelationFactContext[]
    service_map_facts: RelationFactContext[]
    related_edges: RelatedServiceMapEdgeContext[]
    schema: DraftSchemaContext
    rules: string[]
    evidence_gaps: string[]
    evidence_reference_rules: {
      allowed_evidence_ids: string[]
      required: boolean
    }
    source_excerpts: SourceContext[]
    relation_facts: RelationFactContext[]
  }
}

export interface ValidationError extends Record<string, unknown> {
  code: string
  path: string
  message: string
}

export interface LeasedGenerationTask {
  type: 'task'
  task_id: string
  lease_token: string
  document_type: TechnicalDocumentType
  target_summary: string
  lease_expires_at: string
}

export type LeaseTaskResult =
  | { type: 'not_approved'; run_id: string; run_status: GenerationRunStatus }
  | { type: 'no_task_available'; run_id: string; remaining_pending_task_count: number }
  | LeasedGenerationTask

export type LeaseTasksResult =
  | { type: 'not_approved'; run_id: string; run_status: GenerationRunStatus }
  | {
      type: 'tasks'
      run_id: string
      leased_tasks: LeasedGenerationTask[]
      actual_lease_count: number
      remaining_pending_task_count: number
    }

export interface BuildDocsPreconditionDetails extends Record<string, unknown> {
  missing: string[]
  stale: string[]
  failed: string[]
}

export interface BuildDocsNextAction extends Record<string, unknown> {
  type: 'run_required_stage'
  stage: 'build_service_map' | 'build_graph' | 'build_pattern_profile' | 'build_models' | 'build_route' | 'build_relations'
  command: string[]
}

export interface SubmitSavedResult {
  status: 'saved'
  validation_errors: []
  saved_document_id: string
  next_recommended_action: 'continue'
}

export interface SubmitRepairResult {
  status: 'repair_requested' | 'failed'
  validation_errors: ValidationError[]
  saved_document_id: null
  next_recommended_action: 'regenerate_task' | 'stop'
}

export type SubmitTaskResult = SubmitSavedResult | SubmitRepairResult

export type TaskStatusCounts = Record<GenerationTaskStatus, number>
