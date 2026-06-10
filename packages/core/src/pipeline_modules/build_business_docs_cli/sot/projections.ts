import type {
  BusinessDocument,
  BusinessRulesDocument,
  BusinessSourceGraph,
  DataDictionaryDocument,
  DesignDocument,
  EpicSourceBundle,
  GlossaryDocument,
  ModelEvidence,
  UseCaseListDocument,
  UseCaseListItem,
  UseCaseSpecDocument,
} from './types.js'
import type { Document, DocRelationLink } from '@/db/schema/build_docs.js'

type ProjectionKind =
  | 'design_epic_overview'
  | 'data_dictionary_model_map'
  | 'business_rules_rule_candidates'
  | 'use_case_list_coverage'
  | 'use_case_spec_single_uc'
  | 'epic_glossary_terms'

interface ProjectionOptions {
  sourceDocumentIds?: Set<string>
  contentBudget?: number
  sourceGraphMode?: 'standard' | 'slice'
  includeKeyFacts?: boolean
  includeContent?: boolean
  includeCrossBusinessDocs?: boolean
  includeRelationPayload?: boolean
  summaryBudget?: number
  keyFactsMode?: 'standard' | 'flow'
}

const CONTENT_BUDGETS: Record<ProjectionKind, number> = {
  design_epic_overview: 700,
  data_dictionary_model_map: 300,
  business_rules_rule_candidates: 1800,
  use_case_list_coverage: 1700,
  use_case_spec_single_uc: 2400,
  epic_glossary_terms: 900,
}
const SUMMARY_BUDGET = 500
const DESIGN_FLOW_SUMMARY_BUDGET = 220

export function projectDesignInputs(bundle: EpicSourceBundle, options: ProjectionOptions = {}): Record<string, unknown> {
  return baseProjection(bundle, 'design_epic_overview', {
    source_documents: compactSourceDocuments(bundle.sourceDocuments, {
      sourceDocumentIds: options.sourceDocumentIds,
      contentBudget: options.contentBudget ?? CONTENT_BUDGETS.design_epic_overview,
      includeKeyFacts: true,
      includeContent: false,
      summaryBudget: DESIGN_FLOW_SUMMARY_BUDGET,
      keyFactsMode: 'flow',
    }),
    related_screen_documents: compactRelatedScreenDocuments(bundle.relatedScreenDocuments, {
      sourceDocumentIds: options.sourceDocumentIds,
      contentBudget: options.contentBudget ?? CONTENT_BUDGETS.design_epic_overview,
      includeContent: false,
      summaryBudget: DESIGN_FLOW_SUMMARY_BUDGET,
      keyFactsMode: 'flow',
    }),
    cross_epic_context: compactCrossEpicContext(bundle.crossEpicContext, {
      includeBusinessDocs: false,
      summaryBudget: DESIGN_FLOW_SUMMARY_BUDGET,
    }),
    document_relations: projectDocumentRelations(
      bundle.docRelationLinks.filter((link) => link.kind !== 'db_access'),
      options.sourceDocumentIds,
      { includePayload: false },
    ),
    model_evidence: [],
  }, options.sourceDocumentIds, options.sourceGraphMode ?? 'slice')
}

export function projectDataDictionaryInputs(
  bundle: EpicSourceBundle,
  design: DesignDocument | null,
  options: { modelEvidence?: ModelEvidence[] } = {},
): Record<string, unknown> {
  const modelEvidence = options.modelEvidence ?? bundle.modelEvidence
  const modelSourceIds = new Set(modelEvidence.flatMap((evidence) => evidence.sourceDocumentIds))
  return baseProjection(bundle, 'data_dictionary_model_map', {
    source_documents: compactSourceDocuments(bundle.sourceDocuments, {
      sourceDocumentIds: modelSourceIds.size > 0 ? modelSourceIds : undefined,
      contentBudget: CONTENT_BUDGETS.data_dictionary_model_map,
    }),
    model_evidence: projectModelEvidence(modelEvidence, { includeFields: true }),
    design: design ? summarizeDesignForDataDictionary(design) : null,
  }, modelSourceIds.size > 0 ? modelSourceIds : undefined)
}

export function projectBusinessRulesInputs(
  bundle: EpicSourceBundle,
  design: DesignDocument | null,
  dataDictionary: DataDictionaryDocument | null,
  options: ProjectionOptions = {},
): Record<string, unknown> {
  return baseProjection(bundle, 'business_rules_rule_candidates', {
    source_documents: compactSourceDocuments(bundle.sourceDocuments, {
      sourceDocumentIds: options.sourceDocumentIds,
      contentBudget: options.contentBudget ?? CONTENT_BUDGETS.business_rules_rule_candidates,
    }),
    design: design ? summarizeDesign(design) : null,
    data_dictionary: dataDictionary ? summarizeDataDictionary(dataDictionary) : null,
    cross_epic_context: compactCrossEpicContext(bundle.crossEpicContext),
  })
}

export function projectUseCaseListInputs(
  bundle: EpicSourceBundle,
  design: DesignDocument | null,
  dataDictionary: DataDictionaryDocument | null,
  businessRules: BusinessRulesDocument | null,
  options: ProjectionOptions = {},
): Record<string, unknown> {
  return baseProjection(bundle, 'use_case_list_coverage', {
    source_documents: compactSourceDocuments(bundle.sourceDocuments, {
      sourceDocumentIds: options.sourceDocumentIds,
      contentBudget: options.contentBudget ?? CONTENT_BUDGETS.use_case_list_coverage,
    }),
    design: design ? summarizeDesign(design) : null,
    data_dictionary: dataDictionary ? summarizeDataDictionary(dataDictionary) : null,
    business_rules: businessRules ? summarizeBusinessRules(businessRules) : null,
    cross_epic_context: compactCrossEpicContext(bundle.crossEpicContext),
  })
}

export function projectUseCaseSpecInputs(
  bundle: EpicSourceBundle,
  input: {
    design: DesignDocument | null
    dataDictionary: DataDictionaryDocument | null
    businessRules: BusinessRulesDocument | null
    useCaseList: UseCaseListDocument
    useCase: UseCaseListItem
  },
): Record<string, unknown> {
  const sourceDocumentIds = new Set((input.useCase.coverage ?? []).map((coverage) => coverage.source_document_id))
  return baseProjection(bundle, 'use_case_spec_single_uc', {
    source_documents: compactSourceDocuments(bundle.sourceDocuments, {
      sourceDocumentIds,
      contentBudget: CONTENT_BUDGETS.use_case_spec_single_uc,
    }),
    design: input.design ? summarizeDesign(input.design) : null,
    data_dictionary: input.dataDictionary ? summarizeDataDictionary(input.dataDictionary) : null,
    business_rules: input.businessRules ? summarizeBusinessRules(input.businessRules) : null,
    use_case_list: summarizeUseCaseList(input.useCaseList),
    use_case: input.useCase,
    cross_epic_context: compactCrossEpicContext(bundle.crossEpicContext),
  })
}

export function projectEpicGlossaryInputs(
  bundle: EpicSourceBundle,
  input: {
    design: DesignDocument | null
    dataDictionary: DataDictionaryDocument | null
    businessRules: BusinessRulesDocument | null
    useCaseList: UseCaseListDocument | null
    useCaseSpecs: UseCaseSpecDocument[]
  },
  options: ProjectionOptions = {},
): Record<string, unknown> {
  return baseProjection(bundle, 'epic_glossary_terms', {
    source_documents: compactSourceDocuments(bundle.sourceDocuments, {
      sourceDocumentIds: options.sourceDocumentIds,
      contentBudget: options.contentBudget ?? CONTENT_BUDGETS.epic_glossary_terms,
    }),
    model_evidence: projectModelEvidence(bundle.modelEvidence, { includeFields: false }),
    design: input.design ? summarizeDesign(input.design) : null,
    data_dictionary: input.dataDictionary ? summarizeDataDictionary(input.dataDictionary) : null,
    business_rules: input.businessRules ? summarizeBusinessRules(input.businessRules) : null,
    use_case_list: input.useCaseList ? summarizeUseCaseList(input.useCaseList) : null,
    use_case_specs: input.useCaseSpecs.map(summarizeBusinessDocument),
    cross_epic_context: compactCrossEpicContext(bundle.crossEpicContext),
  })
}

function baseProjection(
  bundle: EpicSourceBundle,
  projectionKind: ProjectionKind,
  extra: Record<string, unknown>,
  sourceDocumentIds?: Set<string>,
  sourceGraphMode: 'standard' | 'slice' = 'standard',
): Record<string, unknown> {
  return {
    projection: {
      kind: projectionKind,
      note: 'This is a bounded Source Graph projection, not the full EpicSourceBundle.',
      source_graph: summarizeSourceGraph(bundle.sourceGraph, sourceDocumentIds, sourceGraphMode),
    },
    epic: bundle.epic,
    source_gaps: bundle.sourceGaps,
    ...extra,
  }
}

function compactSourceDocuments(docs: Document[], options: ProjectionOptions = {}): Array<Record<string, unknown>> {
  const selected = options.sourceDocumentIds
    ? docs.filter((doc) => options.sourceDocumentIds!.has(doc.id))
    : docs
  return selected.map((doc) => compactObject({
    id: doc.id,
    type: doc.type,
    scope: doc.scope,
    scope_id: doc.scopeId,
    summary: truncateText(doc.summary, options.summaryBudget ?? SUMMARY_BUDGET),
    key_facts: options.includeKeyFacts ? extractDocumentKeyFacts(doc, options.keyFactsMode) : undefined,
    content: options.includeContent === false ? undefined : compactJson(doc.content, options.contentBudget ?? 1600),
  }))
}

function projectDocumentRelations(
  links: DocRelationLink[],
  sourceDocumentIds?: Set<string>,
  options: { includePayload?: boolean } = {},
): Array<Record<string, unknown>> {
  return links
    .filter((link) => !sourceDocumentIds || sourceDocumentIds.has(link.documentId))
    .map((link) => compactObject({
      document_id: link.documentId,
      kind: link.kind,
      operation: link.operation,
      target: link.target,
      canonical_target: link.canonicalTarget,
      confidence: link.confidence,
      payload: options.includePayload === false ? undefined : compactJson(link.payloadJson, 600),
    }))
}

function compactRelatedScreenDocuments(
  screens: EpicSourceBundle['relatedScreenDocuments'],
  options: ProjectionOptions = {},
): Array<Record<string, unknown>> {
  return screens
    .filter((screen) => !options.sourceDocumentIds || screen.matchedSourceDocumentIds.some((id) => options.sourceDocumentIds!.has(id)))
    .map((screen) => compactObject({
      id: screen.document.id,
      type: screen.document.type,
      scope: screen.document.scope,
      scope_id: screen.document.scopeId,
      summary: truncateText(screen.document.summary, options.summaryBudget ?? SUMMARY_BUDGET),
      matched_source_document_ids: screen.matchedSourceDocumentIds,
      match_reason: screen.reason,
      key_facts: extractDocumentKeyFacts(screen.document, options.keyFactsMode),
      content: options.includeContent === false ? undefined : compactJson(screen.document.content, options.contentBudget ?? 1600),
    }))
}

function compactCrossEpicContext(
  items: EpicSourceBundle['crossEpicContext'],
  options: { includeBusinessDocs?: boolean; summaryBudget?: number } = {},
): Array<Record<string, unknown>> {
  return items.map((item) => compactObject({
    direction: item.direction,
    epic: {
      id: item.epic.id,
      name: item.epic.name,
      abbr: item.epic.abbr,
      summary: truncateText(item.epic.summary, options.summaryBudget ?? SUMMARY_BUDGET),
    },
    dependency: {
      source_epic_id: item.dependency.sourceEpicId,
      target_epic_id: item.dependency.targetEpicId,
      kind: item.dependency.kind,
      reason: truncateText(item.dependency.reason, options.summaryBudget ?? SUMMARY_BUDGET),
    },
    business_docs: options.includeBusinessDocs === false ? undefined : item.businessDocs.map((doc) => ({
      id: doc.id,
      type: doc.type,
      summary: truncateText(doc.summary, options.summaryBudget ?? SUMMARY_BUDGET),
      key_decisions: compactJson(readField(doc.content, 'key_decisions'), 800),
      rules: compactJson(readField(doc.content, 'rules'), 1200),
      use_cases: compactJson(readField(doc.content, 'use_cases'), 1200),
      terms: compactJson(readField(doc.content, 'terms'), 1200),
    })),
  }))
}

function extractDocumentKeyFacts(doc: Document, mode: ProjectionOptions['keyFactsMode'] = 'standard'): Record<string, unknown> {
  const content = doc.content ?? {}
  if (mode === 'flow') {
    return compactObject({
      identity: pickObject(content, ['method', 'path', 'route_path', 'screen_name', 'handler', 'file_path', 'name', 'job_name', 'event_key']),
      route: pickObject(readObject(content, 'identity') ?? content, ['method', 'path', 'route_path', 'screen_name', 'handler', 'file_path', 'name']),
      auth: readFirst(content, ['auth', 'security', 'guards', 'permissions'], 500),
      errors: readFirst(content, ['errors', 'error_codes', 'exceptions'], 500),
      business_rules: readFirst(content, ['business_rules', 'rules'], 500),
      relations: readFirst(content, ['relations'], 500),
    })
  }
  return compactObject({
    identity: pickObject(content, ['method', 'path', 'route_path', 'screen_name', 'handler', 'file_path', 'name', 'job_name', 'event_key']),
    route: pickObject(readObject(content, 'identity') ?? content, ['method', 'path', 'route_path', 'screen_name', 'handler', 'file_path', 'name']),
    request: readFirst(content, ['request', 'input', 'request_dto', 'requestDto', 'params', 'query', 'body']),
    response: readFirst(content, ['response', 'output', 'response_dto', 'responseDto', 'returns']),
    auth: readFirst(content, ['auth', 'security', 'guards', 'permissions']),
    errors: readFirst(content, ['errors', 'error_codes', 'exceptions']),
    business_rules: readFirst(content, ['business_rules', 'rules']),
    relations: readFirst(content, ['relations']),
  })
}

function pickObject(value: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  return compactObject(Object.fromEntries(keys.map((key) => [key, record[key]])))
}

function readObject(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const nested = (value as Record<string, unknown>)[key]
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : undefined
}

function readField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[key]
}

function readFirst(value: unknown, keys: string[], maxChars = 1200): unknown {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return compactJson(record[key], maxChars)
  }
  return undefined
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) =>
    item !== undefined
    && item !== null
    && !(Array.isArray(item) && item.length === 0)
    && !(typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 0)))
}

function projectModelEvidence(modelEvidence: ModelEvidence[], options: { includeFields?: boolean; includeRelationTargets?: boolean } = {}): Array<Record<string, unknown>> {
  return modelEvidence.map((evidence) => ({
    id: evidence.model.id,
    name: evidence.model.name,
    table_name: evidence.model.tableName,
    field_count: evidence.model.fields.length,
    relation_count: evidence.model.relations.length,
    fields: options.includeFields === false ? undefined : evidence.model.fields,
    relations: options.includeFields === false ? undefined : compactJson(evidence.model.relations, 2000),
    source_document_ids: evidence.sourceDocumentIds,
    relation_targets: options.includeRelationTargets === false ? undefined : evidence.relationTargets,
  }))
}

function summarizeSourceGraph(graph: BusinessSourceGraph, sourceDocumentIds?: Set<string>, mode: 'standard' | 'slice' = 'standard'): Record<string, unknown> {
  const documents = sourceDocumentIds
    ? graph.documents.filter((doc) => sourceDocumentIds.has(doc.id))
    : graph.documents
  const visibleDocumentIds = new Set(documents.map((doc) => doc.id))
  const models = sourceDocumentIds
    ? graph.models.filter((model) => model.sourceDocumentIds.some((id) => visibleDocumentIds.has(id)))
    : graph.models
  return {
    epic_id: graph.epicId,
    document_count: documents.length,
    model_count: models.length,
    edge_count: graph.edges.length,
    epic_dependencies: graph.edges
      .filter((edge) => edge.kind === 'epic_dependency')
      .map((edge) => ({ from: edge.from, to: edge.to, kind: edge.label })),
    documents: documents.map((doc) => ({
      id: doc.id,
      type: doc.type,
      summary: truncateText(doc.summary, SUMMARY_BUDGET),
      content_chars: doc.contentChars,
      epic_role: doc.epicRole,
      linked_model_ids: doc.linkedModelIds,
      relation_targets: mode === 'slice' ? undefined : doc.relationTargets.slice(0, 4),
    })),
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      table_name: model.tableName,
      field_count: model.fieldCount,
      source_document_ids: model.sourceDocumentIds,
    })),
  }
}

function compactJson(value: unknown, maxChars: number): unknown {
  if (value === undefined) return undefined
  const text = safeJson(value)
  if (text.length <= maxChars) return value
  return {
    truncated: true,
    original_chars: text.length,
    excerpt: text.slice(0, maxChars),
  }
}

function truncateText(value: string | null, maxChars: number): string | null {
  if (!value || value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...`
}

function summarizeDesign(document: DesignDocument): Record<string, unknown> {
  return {
    ...summarizeBusinessDocument(document),
    overview: document.overview,
    api_list: document.api_list,
    logical_erd: document.logical_erd,
    screen_api_map: document.screen_api_map,
    auth_summary: document.auth_summary,
    nfr: document.nfr,
    error_codes: document.error_codes,
    open_questions: document.open_questions,
    boundaries: document.boundaries,
    data_flow: document.data_flow,
    key_decisions: document.key_decisions,
  }
}

function summarizeDesignForDataDictionary(document: DesignDocument): Record<string, unknown> {
  return {
    ...summarizeBusinessDocument(document),
    overview: document.overview,
    boundaries: document.boundaries,
    data_flow: document.data_flow,
    key_decisions: document.key_decisions,
    open_questions: document.open_questions,
    referenced_api_ids: [
      ...document.api_list.active.map((api) => api.api_id),
      ...document.api_list.batch.map((api) => api.api_id),
      ...document.api_list.event.map((api) => api.api_id),
    ],
  }
}

function summarizeDataDictionary(document: DataDictionaryDocument): Record<string, unknown> {
  return {
    ...summarizeBusinessDocument(document),
    entities: document.entities.map((entity) => ({
      name: entity.name,
      table_name: entity.table_name,
      source_refs: entity.source_refs,
      fields: (entity.fields ?? []).map((field) => ({
        name: field.name,
        column_name: field.column_name,
        type: field.type,
        required: field.required,
        constraints: field.constraints,
        description: field.description,
        description_source: field.description_source,
        source_refs: field.source_refs,
      })),
    })),
    open_questions: document.open_questions,
  }
}

function summarizeBusinessRules(document: BusinessRulesDocument): Record<string, unknown> {
  return {
    ...summarizeBusinessDocument(document),
    rules: document.rules,
    by_pattern: document.by_pattern,
  }
}

function summarizeUseCaseList(document: UseCaseListDocument): Record<string, unknown> {
  return {
    ...summarizeBusinessDocument(document),
    use_cases: document.use_cases,
    actor_defs: document.actor_defs,
    unmapped_source_doc_ids: document.unmapped_source_doc_ids,
  }
}

function summarizeBusinessDocument(document: BusinessDocument | GlossaryDocument): Record<string, unknown> {
  return {
    id: document.id,
    type: document.type,
    title: document.title,
    summary: document.summary,
    scope: document.scope,
    scope_id: document.scope_id,
    source_doc_ids: document.source_doc_ids,
    evidence_gaps: document.evidence_gaps,
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
