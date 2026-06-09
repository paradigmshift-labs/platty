import type { Document, DocumentMemory, DocRelationLink } from '@/db/schema/build_docs.js'
import type { Epic } from '@/db/schema/core.js'
import type { EpicDependency, EpicDocumentLink } from '@/db/schema/build_epics.js'
import type { Model } from '@/db/schema/build_models.js'
import type { CriticalFailure } from '@/pipeline_modules/shared/judge_helpers.js'
import type { OutputLanguage } from '@/pipeline_modules/shared/output_language.js'

export type BusinessDocumentType = 'design' | 'system_design' | 'data_dictionary' | 'br' | 'ucl' | 'ucs' | 'glossary'
export type BusinessDocumentScope = 'epic' | 'uc' | 'project'
export type BusinessDocumentStatus = 'passed' | 'failed' | 'blocked'
export type BusinessWriter = 'system' | 'llm' | 'user'
export type BuildBusinessDocsOutputLanguage = OutputLanguage

export interface BusinessSourceGap {
  code: string
  message: string
  sourceDocumentId?: string
}

export interface BusinessJudgeVerdict {
  passed: boolean
  score: number
  missing_evidence: string[]
  unsupported_claims: string[]
  required_fixes: string[]
  critical_failures: CriticalFailure[]
  notes?: string
}

export interface BusinessDocumentBase {
  type: BusinessDocumentType
  id: string
  title: string
  summary: string
  scope: BusinessDocumentScope
  scope_id: string
  source_doc_ids?: string[]
  evidence_gaps: string[]
}

export interface DesignDocument extends BusinessDocumentBase {
  type: 'design'
  epic_id: string
  overview: string
  api_list: {
    active: Array<{
      api_id: string
      method: string
      path: string
      summary: string
      actor: string
    }>
    batch: Array<{
      api_id: string
      job_name: string
      cron?: string | null
      summary: string
    }>
    event: Array<{
      api_id: string
      event_key: string
      summary: string
    }>
  }
  logical_erd: string | null
  sequence_diagrams: Array<{
    id: string
    title: string
    uc_hint?: string
    mermaid: string
  }>
  screen_api_map: Array<{
    screen_id: string
    screen_name: string
    route_path: string
    api_calls: Array<{
      trigger: string
      api_id: string
      purpose: string
    }>
  }>
  auth_summary: Array<{
    pattern: string
    applies_to: string
    note: string | null
  }>
  nfr: {
    transaction: string
    caching: string
    concurrency: string
    event: string
  }
  error_codes: Array<{
    code: string
    http_status?: number
    message: string
    type: string
    api_ids: string[]
  }>
  open_questions: Array<{
    id: string
    question: string
    impact: 'high' | 'medium' | 'low'
    context: string
  }>
  /** Backward-compatible summary fields for existing downstream prompts and persisted documents. */
  boundaries: string[]
  data_flow: string[]
  key_decisions: Array<string | {
    id: string
    title: string
    rationale: string
    alternatives?: string | null
  }>
}

export interface SystemDesignDocument extends BusinessDocumentBase {
  type: 'system_design'
  epic_id: string
  overview: string
  flow_groups: Array<{
    name: string
    purpose: string
    steps: string[]
  }>
  sequence_diagrams: Array<{
    title: string
    mermaid: string
  }>
  navigation_hints: Array<{
    label: string
    reason: string
    go_to: 'api_spec' | 'screen_spec' | 'schedule_spec' | 'event_spec' | 'data_dictionary' | 'code'
  }>
  cross_epic_effects: string[]
  open_questions: string[]
}

export interface DataDictionaryDocument extends BusinessDocumentBase {
  type: 'data_dictionary'
  epic_id: string
  entities: Array<{
    name: string
    table_name: string
    fields: Array<{
      name: string
      column_name?: string
      type?: string
      required?: boolean
      constraints?: string[]
      description?: string
      description_source?: 'explicit_source' | 'model_comment' | 'common_field' | 'inferred' | 'unknown'
      source_refs?: string[]
    }>
    source_refs?: string[]
  }>
  open_questions?: string[]
}

export interface BusinessRulesDocument extends BusinessDocumentBase {
  type: 'br'
  epic_id: string
  rules: Array<{
    id: string
    statement: string
    source_refs?: string[]
    pattern?: 'ubiquitous' | 'event_driven' | 'state_driven' | 'optional' | 'unwanted_behavior' | 'permission' | 'policy' | 'time' | 'exception' | 'notification' | 'data_visibility'
    rationale?: string
    status?: 'confirmed' | 'inferred'
  }>
  by_pattern?: {
    ubiquitous: number
    event_driven: number
    state_driven: number
    optional: number
    unwanted_behavior: number
  }
}

export interface UseCaseCoverage {
  use_case_id: string
  use_case_key?: string
  source_document_id: string
  role: 'primary' | 'supporting' | 'exception' | 'background'
  reason: string
  confidence: 'high' | 'medium' | 'low'
}

export interface UseCaseListItem {
  use_case_id: string
  title: string
  actor: string
  goal: string
  coverage?: UseCaseCoverage[]
  secondary_actors?: string[]
  trigger?: string
  business_event?: string
  priority?: 'HIGH' | 'MED' | 'LOW'
}

export interface UseCaseListDocument extends BusinessDocumentBase {
  type: 'ucl'
  epic_id: string
  use_cases: UseCaseListItem[]
  actor_defs?: Array<{
    actor: string
    type: 'primary' | 'secondary'
    description: string
  }>
  unmapped_source_doc_ids?: string[]
}

export interface UseCaseSpecDocument extends BusinessDocumentBase {
  type: 'ucs'
  epic_id: string
  use_case_id: string
  preconditions?: string[]
  postconditions?: string[]
  main_flow: string[]
  alternate_flows: Array<string | { id: string; condition: string; steps: string[] }>
  exception_flows?: Array<{
    id: string
    condition: string
    http_status?: number
    error_code?: string
    handling: string
  }>
  business_rules?: Array<{
    id: string
    rule: string
    applies_to: string
    source_refs: string[]
  }>
  related_apis?: Array<{
    api_id: string
    method?: string
    path?: string
    role: string
  }>
  open_questions?: string[]
}

export interface GlossaryEntry {
  type?: 'domain' | 'role' | 'process' | 'status'
  term: string
  canonical_term?: string
  definition: string
  code_term?: string
  aliases?: string[]
  synonyms: string[]
  candidate_aliases?: string[]
  antonyms: string[]
  contrast_terms?: string[]
  related_terms: string[]
  signals?: string[]
  epic_ids: string[]
  source_doc_ids: string[]
  trigger?: string
  caution?: string
  entity?: string
  code_value?: string
  ambiguity?: {
    status: 'none' | 'ambiguous' | 'user_resolved'
    candidates: Array<{ meaning: string; epic_ids: string[]; source_doc_ids: string[] }>
    resolution_note?: string
  }
}

export interface GlossaryDocument extends BusinessDocumentBase {
  type: 'glossary'
  glossary_scope: 'epic' | 'project'
  epic_id?: string
  terms: GlossaryEntry[]
  forbidden_terms?: Array<{
    canonical_term: string
    forbidden: string
    reason: string
  }>
  term_changes?: Array<Record<string, unknown>>
}

export type BusinessDocument =
  | DesignDocument
  | SystemDesignDocument
  | DataDictionaryDocument
  | BusinessRulesDocument
  | UseCaseListDocument
  | UseCaseSpecDocument
  | GlossaryDocument

export interface BuildDocumentResult<TDocument extends BusinessDocument = BusinessDocument> {
  targetType: BusinessDocumentType
  document: TDocument | null
  promptInput: unknown
  prompt: string
  rawLlmOutput: string
  verdict: BusinessJudgeVerdict | null
  sourceGaps: BusinessSourceGap[]
  status: BusinessDocumentStatus
  systemSourceDocIds?: string[]
  blockedBy?: string[]
  failure?: {
    code: string
    message: string
    sourceGaps: BusinessSourceGap[]
    prompt?: string
    rawLlmOutput?: string
  }
}

export interface ConfirmedEpic {
  id: string
  projectId: string
  name: string
  abbr: string | null
  summary: string | null
  confirmedAt: string
}

export interface ModelEvidence {
  model: Model
  sourceDocumentIds: string[]
  relationTargets: string[]
}

export interface BusinessSourceGraphDocumentNode {
  id: string
  type: string
  scope: string
  scopeId: string | null
  summary: string | null
  contentChars: number
  epicRole?: string
  relationTargets: string[]
  linkedModelIds: string[]
}

export interface BusinessSourceGraphModelNode {
  id: string
  name: string
  tableName: string
  fieldCount: number
  sourceDocumentIds: string[]
  relationTargets: string[]
}

export interface BusinessSourceGraph {
  epicId: string
  documents: BusinessSourceGraphDocumentNode[]
  models: BusinessSourceGraphModelNode[]
  edges: Array<{
    from: string
    to: string
    kind: 'epic_link' | 'db_access' | 'model_evidence' | 'epic_dependency'
    label?: string
  }>
}

export interface CrossEpicContextItem {
  epic: ConfirmedEpic
  direction: 'outgoing' | 'incoming'
  dependency: EpicDependency
  businessDocs: Array<{
    id: string
    type: string
    summary: string | null
    content: Record<string, unknown> | null
  }>
}

export interface EpicSourceBundle {
  epic: ConfirmedEpic
  sourceDocuments: Document[]
  relatedScreenDocuments: Array<{
    document: Document
    matchedSourceDocumentIds: string[]
    reason: string
  }>
  crossEpicContext: CrossEpicContextItem[]
  epicDocumentLinks: EpicDocumentLink[]
  docRelationLinks: DocRelationLink[]
  modelEvidence: ModelEvidence[]
  sourceGraph: BusinessSourceGraph
  memories: DocumentMemory[]
  existingBusinessDocs: Document[]
  sourceGaps: BusinessSourceGap[]
}

export interface BusinessDocsRerunPolicy {
  protectUserEdited: boolean
  createProposalOnUserEdit: boolean
}

export interface PersistBusinessDocsResult {
  canonicalCreated: number
  canonicalUpdated: number
  proposalCreated: number
  skipped: number
  documentIds: string[]
  proposalIds: string[]
}

export interface EpicBusinessDocsResult {
  epicId: string
  epicName: string
  status: 'passed' | 'failed' | 'skipped'
  failedAt: 'design' | 'system_design' | 'dd' | 'br' | 'ucl' | 'ucs' | 'glossary' | null
  passedDocTypes: BusinessDocumentType[]
}

export interface BusinessDocsValidationResult {
  passed: boolean
  missing: string[]
  blocked: string[]
}

export type EpicRow = Epic
