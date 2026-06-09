import { createHash } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DB } from '@/db/client.js'
import {
  documentItemDocumentLinks,
  documentItems,
  documentProposals,
  documents,
  type Document,
} from '@/db/schema/build_docs.js'
import {
  businessDocContextBundles,
  businessDocContextPages,
  businessDocGenerationRuns,
  businessDocGenerationTasks,
  type BusinessDocContextBundle,
  type BusinessDocContextPage,
  type BusinessDocGenerationRun,
  type BusinessDocGenerationTask,
  type NewBusinessDocContextBundle,
  type NewBusinessDocContextPage,
  type NewBusinessDocGenerationTask,
} from '@/db/schema/build_business_docs_generation.js'
import type {
  BusinessDocsContextManifest,
  BusinessDocsContextPageKind,
  BusinessDocsNormalizedSubmitRecord,
  BusinessDocsStoredDocumentType,
  BusinessDocsSubmittedDocument,
  BusinessDocsSubmittedDocumentItem,
  BusinessDocsSubmitResult,
  BusinessDocsSubmitServiceResult,
  BusinessDocsTaskType,
  BusinessDocsValidationError,
} from './types.js'
import type { BusinessDocument, BusinessDocumentType } from './sot/types.js'
import { validateBusinessDocumentV3 } from './sot/v3_validators.js'
import { stableKeyPart } from './sot/utils.js'
import {
  appendVersion,
  replaceDocumentItemSatellites,
  replaceDocumentLinks,
} from './sot/persist_graph.js'
import { validateBusinessDocumentSotQuality } from './quality.js'
import {
  readSourceEvidenceTargets,
  resolveItemSourceTargets,
} from './source_refs.js'

const SUBMITTABLE_RUN_STATUSES = new Set(['running', 'repair_requested'])
const DEPENDENCY_SUCCESS_STATUSES = new Set(['saved', 'proposal_created'])
const STORED_DOCUMENT_TYPES = ['design', 'data_dictionary', 'br', 'ucl', 'ucs', 'glossary'] as const
const SUBMIT_RECORD_SCHEMA_VERSION = 'business-docs-submit.v1'
const CONTEXT_SCHEMA_VERSION = 'business-docs-context.v1'
const SOURCE_COMMIT = 'unknown'
const V3_LINK_COVERAGE_THRESHOLD = 0.8

interface SubmitInput {
  projectId: string
  taskId: string
  leaseToken: string
  attemptNo: number
  document: Record<string, unknown>
  now?: () => Date
  makeId?: () => string
}

interface SubmitContext {
  run: BusinessDocGenerationRun
  task: BusinessDocGenerationTask
  bundle: BusinessDocContextBundle
  pages: BusinessDocContextPage[]
}

interface ValidatedSubmit {
  document: BusinessDocsSubmittedDocument | null
  errors: BusinessDocsValidationError[]
}

interface DownstreamResult {
  contextsUnlocked: number
  contextPagesUpserted: number
  ucsTasksCreated: number
}

interface SubmitSyncMetadata {
  sourceHash: string
  staticSnapshotId: string | null
  reason: string | null
}

type RuntimeDb = Pick<DB, 'select' | 'insert' | 'update' | 'delete' | 'run'>
type RuntimeReadDb = Pick<DB, 'select'>

export function submitBusinessDocsTask(db: DB, input: SubmitInput): BusinessDocsSubmitServiceResult {
  const now = (input.now ?? (() => new Date()))()
  const nowIso = now.toISOString()
  const makeId = input.makeId ?? nanoid

  return db.transaction((tx): BusinessDocsSubmitServiceResult => {
    const context = loadSubmitContext(tx, input.taskId)
    if (!context || context.task.projectId !== input.projectId || context.run.projectId !== input.projectId) {
      return failure('BUSINESS_DOCS_TASK_NOT_FOUND', 'Business docs task was not found for the selected project.')
    }

    const normalizedDocument = normalizeSubmittedDocument(input.document, context)
    const contentHash = hashJson(normalizedDocument)
    const storedSubmit = parseSubmitRecord(context.task.submittedJson)
    const idempotency = checkIdempotency(storedSubmit, input, contentHash)
    if (idempotency === 'same') {
      return {
        ok: true,
        data: buildIdempotentResult(tx, context, storedSubmit!, contentHash),
      }
    }
    if (idempotency === 'changed') {
      return failure('BUSINESS_DOCS_SUBMIT_NOT_IDEMPOTENT', 'Submit replay content does not match the stored submit hash.')
    }
    if (idempotency === 'lease_conflict') {
      return failure('BUSINESS_DOCS_LEASE_CONFLICT', 'Business docs lease token does not authorize this submit.')
    }
    if (idempotency === 'attempt_conflict') {
      return failure('BUSINESS_DOCS_ATTEMPT_CONFLICT', 'Business docs submit attempt does not match the stored submit attempt.')
    }

    if (!SUBMITTABLE_RUN_STATUSES.has(context.run.status)) {
      return failure('BUSINESS_DOCS_RUN_NOT_SUBMITTABLE', 'Business docs generation run is not submittable.')
    }
    if (context.task.status !== 'leased') {
      return failure('BUSINESS_DOCS_TASK_NOT_SUBMITTABLE', 'Business docs task is not submittable.')
    }
    if (
      context.task.leaseToken !== input.leaseToken ||
      !context.task.leaseExpiresAt ||
      context.task.leaseExpiresAt <= nowIso
    ) {
      return failure('BUSINESS_DOCS_LEASE_CONFLICT', 'Business docs lease token does not authorize this submit.')
    }
    if (context.task.attemptNo !== input.attemptNo) {
      return failure('BUSINESS_DOCS_ATTEMPT_CONFLICT', 'Business docs submit attempt does not match the current task attempt.')
    }

    const validation = validateSubmittedDocument(normalizedDocument, context)
    const submitRecord = {
      schemaVersion: SUBMIT_RECORD_SCHEMA_VERSION,
      taskId: context.task.id,
      leaseToken: input.leaseToken,
      attemptNo: input.attemptNo,
      contentHash,
      document: (validation.document ?? normalizedDocument) as BusinessDocsSubmittedDocument,
    } satisfies BusinessDocsNormalizedSubmitRecord

    if (validation.errors.length > 0 || !validation.document) {
      return {
        ok: true,
        data: applyValidationFailure(tx, {
          context,
          submitRecord,
          errors: validation.errors,
          now: nowIso,
          contentHash,
        }),
      }
    }

    if (context.task.taskType === 'use_case_list') {
      return {
        ok: true,
        data: saveCheckpointOnly(tx, {
          context,
          submitRecord,
          now: nowIso,
          contentHash,
        }),
      }
    }

    const sotErrors = runV3Validation(validation.document, context)
    if (sotErrors.length > 0) {
      return {
        ok: true,
        data: applyValidationFailure(tx, {
          context,
          submitRecord,
          errors: sotErrors,
          now: nowIso,
          contentHash,
        }),
      }
    }

    return {
      ok: true,
      data: persistValidDocument(tx, {
        context,
        submitRecord,
        document: validation.document,
        now: nowIso,
        makeId,
        contentHash,
      }),
    }
  })
}

/**
 * Phase B — deterministic v3 quality gate. Runs after the CLI schema/evidence
 * validation passes and before persistence. Adapts the worker-submitted
 * document into the BusinessDocument shape v3 expects, recovers the EPIC's
 * systemSourceDocIds from the persisted context pages (Phase A stamped them on
 * the target / source_document_cards pages), then maps any fatal v3 issue into
 * the CLI's validation-error shape so the worker sees WHY the save was blocked.
 */
function runV3Validation(
  document: BusinessDocsSubmittedDocument,
  context: SubmitContext,
): BusinessDocsValidationError[] {
  const result = validateBusinessDocumentV3({
    document: adaptSubmittedToBusinessDocument(document),
    systemSourceDocIds: recoverSystemSourceDocIds(context),
    linkCoverageThreshold: V3_LINK_COVERAGE_THRESHOLD,
  })
  if (result.passed) return []
  return result.issues
    .filter((issue) => issue.severity === 'fatal')
    .map((issue) => ({
      code: 'SOT_VALIDATION_FAILED',
      path: issue.fieldPath ? `$.content.${issue.fieldPath}` : '$',
      message: `${issue.code}: ${issue.fieldPath ? `${issue.fieldPath}: ${issue.message}` : issue.message}`,
    }))
}

/**
 * Adapts a BusinessDocsSubmittedDocument into the BusinessDocument union the v3
 * validators consume. The worker carries the type-specific core arrays
 * (rules / use_cases / entities / terms / flow_groups / …) inside `content`,
 * so we spread `content` over the base fields. Core arrays default to `[]` and
 * `evidence_gaps` to `[]` so the validator's `.length` reads are always safe.
 */
function adaptSubmittedToBusinessDocument(document: BusinessDocsSubmittedDocument): BusinessDocument {
  const content = document.content ?? {}
  const base = {
    ...content,
    type: document.documentType as BusinessDocumentType,
    id: `${document.scope}:${document.scopeId}:${document.documentType}`,
    title: document.title,
    summary: document.summary,
    scope: mapScope(document.scope),
    scope_id: document.scopeId,
    evidence_gaps: asStringArray(content.evidence_gaps),
  } as Record<string, unknown>
  ensureCoreArrays(base, document.documentType)
  if (document.documentType === 'glossary') normalizeGlossaryContent(base)
  return base as unknown as BusinessDocument
}

/** Defaults the type-specific core arrays v3 reads via `.length` so a partial submit never throws. */
function ensureCoreArrays(base: Record<string, unknown>, documentType: BusinessDocsStoredDocumentType): void {
  const coreArrayKeys: Record<string, string[]> = {
    br: ['rules'],
    ucl: ['use_cases'],
    data_dictionary: ['entities'],
    glossary: ['terms'],
    design: ['sequence_diagrams'],
    ucs: [],
  }
  for (const key of coreArrayKeys[documentType] ?? []) {
    if (!Array.isArray(base[key])) base[key] = []
  }
}

function normalizeGlossaryContent(base: Record<string, unknown>): void {
  const terms = Array.isArray(base.terms) ? base.terms : []
  base.terms = terms.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
    const term = raw as Record<string, unknown>
    const explicitCanonicalTerm = typeof term.canonical_term === 'string' ? term.canonical_term.trim() : ''
    const hasExplicitCanonicalTerm = explicitCanonicalTerm.length > 0
    return {
      ...term,
      canonical_term: hasExplicitCanonicalTerm
        ? explicitCanonicalTerm
        : term.term,
      _canonical_term_missing: !hasExplicitCanonicalTerm,
      aliases: asStringArray(term.aliases),
      synonyms: asStringArray(term.synonyms),
      candidate_aliases: asStringArray(term.candidate_aliases),
      antonyms: asStringArray(term.antonyms),
      contrast_terms: asStringArray(term.contrast_terms),
      related_terms: asStringArray(term.related_terms),
      signals: asStringArray(term.signals),
      epic_ids: asStringArray(term.epic_ids),
      source_doc_ids: asStringArray(term.source_doc_ids),
    }
  })
}

function itemsForSotQualityValidation(input: {
  documentType: BusinessDocsStoredDocumentType
  scope: BusinessDocsSubmittedDocument['scope'] | null
  scopeId: string | null
  title: string | null
  summary: string | null
  content: Record<string, unknown> | null
  evidenceIds: string[] | null
  baseContentHash?: string | null
  items?: BusinessDocsSubmittedDocumentItem[]
}): BusinessDocsSubmittedDocumentItem[] {
  if (
    input.documentType !== 'glossary' ||
    !input.scope ||
    !input.scopeId ||
    !input.title ||
    !input.summary ||
    !input.content ||
    !input.evidenceIds
  ) {
    return input.items ?? []
  }

  const document: BusinessDocsSubmittedDocument = {
    schemaVersion: 'business-doc.v1',
    documentType: input.documentType,
    scope: input.scope,
    scopeId: input.scopeId,
    title: input.title,
    summary: input.summary,
    content: input.content,
    evidenceIds: input.evidenceIds,
    baseContentHash: input.baseContentHash,
    items: input.items,
  }
  return itemsForPersistenceFromDocument(document, adaptSubmittedToBusinessDocument(document)) ?? []
}

/** Recovers the EPIC's systemSourceDocIds (Phase A) from the persisted context pages. */
function recoverSystemSourceDocIds(context: SubmitContext): string[] {
  for (const pageToken of ['target', 'source_document_cards']) {
    const page = context.pages.find((candidate) => candidate.pageToken === pageToken)
    const ids = asStringArray(page?.contentJson?.systemSourceDocIds)
    if (ids.length > 0) return ids
  }
  return []
}

function recoverSyncMetadata(context: SubmitContext): SubmitSyncMetadata | null {
  const targetPage = context.pages.find((page) => page.pageKind === 'target')
  const sync = targetPage?.contentJson?.sync
  if (!isRecord(sync)) return null

  const sourceHash = typeof sync.sourceHash === 'string' ? sync.sourceHash.trim() : ''
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) return null

  const staticSnapshotId = typeof sync.staticSnapshotId === 'string' && sync.staticSnapshotId.trim()
    ? sync.staticSnapshotId.trim()
    : null
  const reason = typeof sync.reason === 'string' && sync.reason.trim()
    ? sync.reason.trim()
    : null

  return { sourceHash, staticSnapshotId, reason }
}

function mapScope(scope: BusinessDocsSubmittedDocument['scope']): BusinessDocument['scope'] {
  return scope === 'use_case' ? 'uc' : scope
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function loadSubmitContext(db: RuntimeReadDb, taskId: string): SubmitContext | null {
  const task = db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.id, taskId))
    .get()
  if (!task) return null
  const run = db.select().from(businessDocGenerationRuns)
    .where(eq(businessDocGenerationRuns.id, task.runId))
    .get()
  const bundle = db.select().from(businessDocContextBundles)
    .where(eq(businessDocContextBundles.taskId, task.id))
    .get()
  if (!run || !bundle) return null
  const pages = db.select().from(businessDocContextPages)
    .where(eq(businessDocContextPages.contextHandle, bundle.contextHandle))
    .orderBy(asc(businessDocContextPages.pageOrder))
    .all()
  return { run, task, bundle, pages }
}

function checkIdempotency(
  stored: BusinessDocsNormalizedSubmitRecord | null,
  input: SubmitInput,
  contentHash: string,
): 'none' | 'same' | 'changed' | 'lease_conflict' | 'attempt_conflict' {
  if (!stored || stored.taskId !== input.taskId) return 'none'
  if (stored.leaseToken !== input.leaseToken || stored.attemptNo !== input.attemptNo) return 'none'
  return stored.contentHash === contentHash ? 'same' : 'changed'
}

function normalizeSubmittedDocument(raw: Record<string, unknown>, context: SubmitContext): Record<string, unknown> {
  if (!isRecord(raw.content)) return raw
  const content = raw.content

  if (raw.documentType === 'data_dictionary') {
    const entities = dataDictionaryEntitiesFromSubmittedItems(readLooseSubmittedItems(raw.items))
    if (hasUsableDataDictionaryEntities(content.entities)) return raw
    if (entities.length === 0 && !isPlaceholderArray(content.entities, hasUsableDataDictionaryEntities)) return raw
    return {
      ...raw,
      content: {
        ...content,
        entities: entities.length > 0 ? entities : [],
      },
    }
  }

  if (raw.documentType === 'ucl') {
    const useCases = useCasesFromSubmittedItems(readLooseSubmittedItems(raw.items), context)
    if (useCases.length === 0 || !isPlaceholderArray(content.use_cases, hasUsableUseCases)) return raw
    return {
      ...raw,
      content: {
        ...content,
        use_cases: useCases,
      },
    }
  }

  if (raw.documentType === 'design') {
    const design = designContentFromSubmittedItems(readLooseSubmittedItems(raw.items), context)
    if (design.sequence_diagrams.length === 0 || !isPlaceholderArray(content.sequence_diagrams, hasUsableDesignSequenceDiagrams)) return raw
    return {
      ...raw,
      content: {
        ...content,
        sequence_diagrams: design.sequence_diagrams,
        source_doc_ids: design.source_doc_ids,
      },
    }
  }

  if (raw.documentType === 'glossary') {
    const terms = glossaryTermsFromSubmittedItems(readLooseSubmittedItems(raw.items), context)
    if (terms.length === 0 || !isPlaceholderArray(content.terms, hasUsableGlossaryTerms)) return raw
    return {
      ...raw,
      content: {
        ...content,
        terms,
      },
    }
  }

  if (raw.documentType !== 'br') return raw
  const rulesValue = content.rules
  const hasRulesArray = Array.isArray(rulesValue)
  if (hasRulesArray && (rulesValue.length === 0 || hasUsableBusinessRules(rulesValue))) return raw
  if (hasRulesArray && !isPlaceholderArray(rulesValue, hasUsableBusinessRules)) return raw
  if (!hasRulesArray && asStringArray(content.evidence_gaps).length > 0) return raw

  const items = readLooseSubmittedItems(raw.items)
  const rules = items
    .map((item) => ruleFromSubmittedItem(item, context))
    .filter((rule): rule is Record<string, unknown> => rule !== null)
  if (rules.length === 0) return raw

  return {
    ...raw,
    content: {
      ...content,
      rules,
    },
  }
}

function isPlaceholderArray(value: unknown, isUsable: (value: unknown) => boolean): boolean {
  return Array.isArray(value) &&
    value.length > 0 &&
    !isUsable(value) &&
    value.every((item) => isRecord(item) && Object.keys(item).length === 0)
}

function hasUsableBusinessRules(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((rule) => isRecord(rule) && typeof rule.statement === 'string' && rule.statement.trim().length > 0)
}

function useCasesFromSubmittedItems(
  items: BusinessDocsSubmittedDocumentItem[],
  context: SubmitContext,
): Record<string, unknown>[] {
  const sourceTargets = readSourceEvidenceTargets(context.pages)
  return items
    .filter((item) => item.itemType === 'use_case')
    .map((item) => useCaseFromSubmittedItem(item, sourceTargets))
    .filter((useCase): useCase is Record<string, unknown> => useCase !== null)
}

function useCaseFromSubmittedItem(
  item: BusinessDocsSubmittedDocumentItem,
  sourceTargets: ReturnType<typeof readSourceEvidenceTargets>,
): Record<string, unknown> | null {
  const content = item.content
  const useCaseId = trimmedString(content.useCaseId) || trimmedString(item.stableKey)
  const title = trimmedString(item.title) || useCaseId
  const goal = trimmedString(content.goal) || trimmedString(item.summary) || title
  if (!useCaseId || !title || !goal) return null
  const coverage = resolveItemSourceTargets(item, sourceTargets).map((target) => ({
    use_case_id: useCaseId,
    source_document_id: target.documentId,
    role: target.role,
    reason: trimmedString(content.coverageRelation) || 'source coverage',
    confidence: 'high',
  }))
  return {
    use_case_id: useCaseId,
    title,
    actor: trimmedString(content.actor) || '사용자',
    goal,
    coverage,
    trigger: trimmedString(content.trigger) || title,
    business_event: trimmedString(content.business_event) || undefined,
    priority: 'MED',
  }
}

function hasUsableUseCases(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((useCase) =>
    isRecord(useCase) &&
    typeof useCase.use_case_id === 'string' &&
    useCase.use_case_id.trim().length > 0 &&
    typeof useCase.title === 'string' &&
    useCase.title.trim().length > 0 &&
    typeof useCase.actor === 'string' &&
    useCase.actor.trim().length > 0 &&
    typeof useCase.goal === 'string' &&
    useCase.goal.trim().length > 0)
}

function designContentFromSubmittedItems(
  items: BusinessDocsSubmittedDocumentItem[],
  context: SubmitContext,
): { sequence_diagrams: Record<string, unknown>[]; source_doc_ids: string[] } {
  const sourceTargets = readSourceEvidenceTargets(context.pages)
  const sourceDocIds = new Set<string>()
  const sequenceDiagrams = items
    .map((item) => {
      const targets = resolveItemSourceTargets(item, sourceTargets)
      for (const target of targets) sourceDocIds.add(target.documentId)
      return designSequenceDiagramFromSubmittedItem(item)
    })
    .filter((diagram): diagram is Record<string, unknown> => diagram !== null)
  return {
    sequence_diagrams: sequenceDiagrams,
    source_doc_ids: [...sourceDocIds].sort(),
  }
}

function designSequenceDiagramFromSubmittedItem(item: BusinessDocsSubmittedDocumentItem): Record<string, unknown> | null {
  const title = trimmedString(item.title) || trimmedString(item.content.component)
  if (!title) return null
  const flow = Array.isArray(item.content.flow)
    ? item.content.flow.filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
    : []
  return {
    id: item.stableKey,
    title,
    uc_hint: trimmedString(item.summary) || trimmedString(item.content.responsibility) || title,
    mermaid: mermaidFromFlow(flow),
  }
}

function hasUsableDesignSequenceDiagrams(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((diagram) =>
    isRecord(diagram) &&
    typeof diagram.title === 'string' &&
    diagram.title.trim().length > 0 &&
    typeof diagram.mermaid === 'string' &&
    diagram.mermaid.trim().length > 0)
}

function mermaidFromFlow(flow: string[]): string {
  if (flow.length === 0) return 'sequenceDiagram\n  participant User\n  participant System\n  User->>System: Execute documented flow'
  return [
    'sequenceDiagram',
    '  participant User',
    '  participant System',
    ...flow.map((step) => `  User->>System: ${step.trim().replace(/\n/g, ' ')}`),
  ].join('\n')
}

function glossaryTermsFromSubmittedItems(
  items: BusinessDocsSubmittedDocumentItem[],
  context: SubmitContext,
): Record<string, unknown>[] {
  const sourceTargets = readSourceEvidenceTargets(context.pages)
  return items
    .filter((item) => isGlossaryTermItemType(item.itemType))
    .map((item) => glossaryTermFromSubmittedItem(item, context, sourceTargets))
    .filter((term): term is Record<string, unknown> => term !== null)
}

function glossaryTermFromSubmittedItem(
  item: BusinessDocsSubmittedDocumentItem,
  context: SubmitContext,
  sourceTargets: ReturnType<typeof readSourceEvidenceTargets>,
): Record<string, unknown> | null {
  const content = item.content
  const term = trimmedString(content.term) || trimmedString(item.title)
  const canonicalTerm = trimmedString(content.canonical_term) || term
  const definition = trimmedString(content.definition) || trimmedString(item.summary)
  if (!term || !canonicalTerm || !definition) return null
  const sourceDocIds = resolveItemSourceTargets(item, sourceTargets).map((target) => target.documentId)
  return {
    term,
    canonical_term: canonicalTerm,
    definition,
    type: trimmedString(content.termType) || trimmedString(content.type) || glossaryTypeFromItemType(item.itemType) || 'domain',
    aliases: asStringArray(content.aliases),
    synonyms: asStringArray(content.synonyms),
    candidate_aliases: asStringArray(content.candidate_aliases),
    antonyms: asStringArray(content.antonyms),
    contrast_terms: asStringArray(content.contrast_terms),
    related_terms: asStringArray(content.related_terms),
    signals: asStringArray(content.signals),
    epic_ids: context.task.epicId ? [context.task.epicId] : [],
    source_doc_ids: [...new Set(sourceDocIds)].sort(),
    ambiguity: isRecord(content.ambiguity)
      ? content.ambiguity
      : { status: 'none', candidates: [] },
  }
}

function hasUsableGlossaryTerms(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((term) =>
    isRecord(term) &&
    typeof term.term === 'string' &&
    term.term.trim().length > 0 &&
    typeof term.definition === 'string' &&
    term.definition.trim().length > 0)
}

function isGlossaryTermItemType(value: string): boolean {
  return value === 'glossary_term' ||
    value === 'term' ||
    value === 'glossary_item' ||
    glossaryTypeFromItemType(value) !== null
}

function glossaryTypeFromItemType(value: string): string | null {
  return ['domain', 'role', 'process', 'status', 'forbidden', 'ambiguous'].includes(value) ? value : null
}

function dataDictionaryEntitiesFromSubmittedItems(items: BusinessDocsSubmittedDocumentItem[]): Record<string, unknown>[] {
  const entities = new Map<string, Record<string, unknown>>()
  for (const item of items) {
    const entity = dataDictionaryEntityFromSubmittedItem(item)
    if (!entity) continue
    const name = String(entity.name)
    const existing = entities.get(name)
    if (!existing) {
      entities.set(name, entity)
      continue
    }
    const existingFields = Array.isArray(existing.fields) ? existing.fields : []
    const nextFields = Array.isArray(entity.fields) ? entity.fields : []
    existing.fields = [...existingFields, ...nextFields]
    existing.source_refs = [...new Set([
      ...asStringArray(existing.source_refs),
      ...asStringArray(entity.source_refs),
    ])].sort()
  }
  return [...entities.values()]
}

function dataDictionaryEntityFromSubmittedItem(item: BusinessDocsSubmittedDocumentItem): Record<string, unknown> | null {
  const content = item.content
  const entityName = typeof content.entity === 'string' && content.entity.trim()
    ? content.entity.trim()
    : item.title?.trim()
  if (!entityName || !Array.isArray(content.fields)) return null

  const fields = content.fields
    .map(dataDictionaryFieldFromSubmittedItem)
    .filter((field): field is Record<string, unknown> => field !== null)
  if (fields.length === 0) return null

  return {
    name: entityName,
    table_name: typeof content.table_name === 'string' && content.table_name.trim()
      ? content.table_name.trim()
      : stableKeyPart(entityName),
    fields,
    source_refs: sourceRefsFromMapping(content.source_mapping),
  }
}

function dataDictionaryFieldFromSubmittedItem(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : ''
  const description = typeof value.meaning === 'string' && value.meaning.trim()
    ? value.meaning.trim()
    : typeof value.description === 'string' && value.description.trim()
      ? value.description.trim()
      : ''
  if (!name || !description) return null
  return {
    name,
    ...(typeof value.type === 'string' && value.type.trim() ? { type: value.type.trim() } : {}),
    description,
    description_source: 'explicit_source',
    source_refs: [...new Set([
      ...asStringArray(value.source_refs),
      ...sourceRefsFromMapping(value.source_mapping),
    ])].sort(),
  }
}

function hasUsableDataDictionaryEntities(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((entity) => {
    if (!isRecord(entity) || typeof entity.name !== 'string' || !entity.name.trim()) return false
    if (!Array.isArray(entity.fields)) return false
    return entity.fields.every((field) => isRecord(field) && typeof field.name === 'string' && field.name.trim())
  })
}

function sourceRefsFromMapping(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((entry): string[] => {
    if (typeof entry === 'string' && entry.trim()) return [entry.trim()]
    if (isRecord(entry) && typeof entry.sourceRef === 'string' && entry.sourceRef.trim()) return [entry.sourceRef.trim()]
    return []
  }))].sort()
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readLooseSubmittedItems(value: unknown): BusinessDocsSubmittedDocumentItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): BusinessDocsSubmittedDocumentItem[] => {
    if (!isRecord(item) || !isRecord(item.content)) return []
    if (typeof item.itemType !== 'string' || typeof item.stableKey !== 'string') return []
    return [{
      itemType: item.itemType,
      stableKey: item.stableKey,
      ordinal: typeof item.ordinal === 'number' ? item.ordinal : undefined,
      title: typeof item.title === 'string' ? item.title : item.stableKey,
      summary: typeof item.summary === 'string' ? item.summary : undefined,
      content: item.content,
      evidenceIds: asStringArray(item.evidenceIds),
    }]
  })
}

function ruleFromSubmittedItem(item: BusinessDocsSubmittedDocumentItem, context: SubmitContext): Record<string, unknown> | null {
  const content = item.content
  const statement = typeof content.rule === 'string' && content.rule.trim()
    ? content.rule.trim()
    : item.title?.trim()
  if (!statement) return null

  const sourceTargets = readSourceEvidenceTargets(context.pages)
  const sourceRefs = resolveItemSourceTargets(item, sourceTargets)
    .map((target) => target.documentId)
  return {
    id: item.stableKey,
    statement,
    source_refs: [...new Set(sourceRefs)].sort(),
    pattern: normalizeRulePattern(content.earsPattern),
    rationale: ruleRationale(content),
    status: 'confirmed',
  }
}

function normalizeRulePattern(value: unknown): string {
  if (value === 'unwanted') return 'unwanted_behavior'
  return typeof value === 'string' && value.trim() ? value.trim() : 'event_driven'
}

function ruleRationale(content: Record<string, unknown>): string | undefined {
  const parts = [
    typeof content.condition === 'string' ? content.condition.trim() : '',
    typeof content.outcome === 'string' ? content.outcome.trim() : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : undefined
}

function validateSubmittedDocument(
  raw: Record<string, unknown>,
  context: SubmitContext,
): ValidatedSubmit {
  const errors: BusinessDocsValidationError[] = []
  const schemaVersion = readString(raw.schemaVersion, '$.schemaVersion', errors)
  const documentType = readDocumentType(raw.documentType, '$.documentType', errors)
  const scope = readScope(raw.scope, '$.scope', errors)
  const scopeId = readString(raw.scopeId, '$.scopeId', errors)
  const title = readString(raw.title, '$.title', errors)
  const summary = readString(raw.summary, '$.summary', errors)
  const content = readObject(raw.content, '$.content', errors)
  const evidenceIds = readStringArray(raw.evidenceIds, '$.evidenceIds', errors)
  const items = readItems(raw.items, errors)
  const submittedBaseContentHash = raw.baseContentHash === undefined || raw.baseContentHash === null
    ? raw.baseContentHash as undefined | null
    : readString(raw.baseContentHash, '$.baseContentHash', errors)
  const baseContentHash = submittedBaseContentHash ?? existingCanonicalContentHash(context)

  if (schemaVersion && schemaVersion !== 'business-doc.v1') {
    errors.push({
      code: 'SCHEMA_INVALID',
      path: '$.schemaVersion',
      message: 'schemaVersion must be business-doc.v1.',
    })
  }

  if (documentType && scope && scopeId) {
    validateTarget({ documentType, scope, scopeId, context, errors })
  }

  if (context.task.taskType === 'use_case_list_refine') {
    const useCaseItems = (items ?? []).filter((item) => item.itemType === 'use_case')
    if (useCaseItems.length === 0) {
      errors.push({
        code: 'MISSING_FINAL_UCL_ITEMS',
        path: '$.items',
        message: 'Final UCL must include at least one use_case item.',
      })
    }
    validateFinalUclSourceCoverage({ useCaseItems, context, errors })
  }
  if (documentType) {
    const qualityItems = itemsForSotQualityValidation({
      documentType,
      scope,
      scopeId,
      title,
      summary,
      content,
      evidenceIds,
      baseContentHash,
      items,
    })
    validateBusinessDocumentSotQuality({ documentType, content: content ?? undefined, items: qualityItems, pages: context.pages, errors })
  }

  validateEvidence({ evidenceIds, items, context, errors })

  if (
    errors.length > 0 ||
    schemaVersion !== 'business-doc.v1' ||
    !documentType ||
    !scope ||
    !scopeId ||
    !title ||
    !summary ||
    !content ||
    !evidenceIds
  ) {
    return { document: null, errors }
  }

  return {
    document: {
      schemaVersion: 'business-doc.v1',
      documentType,
      scope,
      scopeId,
      title,
      summary,
      content,
      evidenceIds,
      baseContentHash,
      items,
    },
    errors,
  }
}

function existingCanonicalContentHash(context: SubmitContext): string | null {
  const page = context.pages.find((candidate) => candidate.pageToken === 'existing_canonical')
  const document = isRecord(page?.contentJson.document) ? page.contentJson.document : null
  const contentHash = typeof document?.contentHash === 'string' ? document.contentHash.trim() : ''
  return contentHash || null
}

function applyValidationFailure(
  db: RuntimeDb,
  input: {
    context: SubmitContext
    submitRecord: BusinessDocsNormalizedSubmitRecord
    errors: BusinessDocsValidationError[]
    now: string
    contentHash: string
  },
): BusinessDocsSubmitResult {
  const nextAttemptNo = input.context.task.attemptNo + 1
  const status = nextAttemptNo <= input.context.task.maxRepairAttempts ? 'repair_requested' : 'failed'
  upsertValidationErrorsPage(db, {
    context: input.context,
    errors: input.errors,
    attemptNo: input.context.task.attemptNo,
    now: input.now,
  })
  db.update(businessDocGenerationTasks)
    .set({
      status,
      attemptNo: nextAttemptNo,
      submittedJson: asJsonRecord(input.submitRecord),
      validationErrors: asJsonRecordArray(input.errors),
      savedDocumentId: null,
      updatedAt: input.now,
    })
    .where(eq(businessDocGenerationTasks.id, input.context.task.id))
    .run()
  db.update(businessDocGenerationRuns)
    .set({
      status: status === 'failed' ? 'failed' : 'repair_requested',
      updatedAt: input.now,
      finishedAt: status === 'failed' ? input.now : input.context.run.finishedAt,
    })
    .where(eq(businessDocGenerationRuns.id, input.context.run.id))
    .run()

  return buildSubmitResult({
    context: input.context,
    status,
    attemptNo: nextAttemptNo,
    contentHash: input.contentHash,
    idempotent: false,
    validationErrorCount: input.errors.length,
    savedDocumentId: null,
    proposalId: null,
    operation: null,
    baseDocumentId: null,
    repairValidationPageToken: 'validation_errors',
    nextRepairAttemptNo: status === 'repair_requested' ? nextAttemptNo : null,
    downstream: emptyDownstream(),
  })
}

function saveCheckpointOnly(
  db: RuntimeDb,
  input: {
    context: SubmitContext
    submitRecord: BusinessDocsNormalizedSubmitRecord
    now: string
    contentHash: string
  },
): BusinessDocsSubmitResult {
  db.update(businessDocGenerationTasks)
    .set({
      status: 'saved',
      submittedJson: asJsonRecord(input.submitRecord),
      validationErrors: [],
      savedDocumentId: null,
      updatedAt: input.now,
    })
    .where(eq(businessDocGenerationTasks.id, input.context.task.id))
    .run()

  const downstream = unlockDependentContexts(db, input.context, input.now)
  return buildSubmitResult({
    context: input.context,
    status: 'saved',
    attemptNo: input.context.task.attemptNo,
    contentHash: input.contentHash,
    idempotent: false,
    validationErrorCount: 0,
    savedDocumentId: null,
    proposalId: null,
    operation: 'checkpoint_only',
    baseDocumentId: null,
    repairValidationPageToken: null,
    nextRepairAttemptNo: null,
    downstream,
  })
}

function persistValidDocument(
  db: RuntimeDb,
  input: {
    context: SubmitContext
    submitRecord: BusinessDocsNormalizedSubmitRecord
    document: BusinessDocsSubmittedDocument
    now: string
    makeId: () => string
    contentHash: string
  },
): BusinessDocsSubmitResult {
  const syncMetadata = recoverSyncMetadata(input.context)
  const existing = findCanonicalDocument(db, input.context.task.projectId, input.document)
  const saveTarget = decidePersistenceTarget(existing, input.document, input.contentHash, syncMetadata)

  if (saveTarget.kind === 'proposal') {
    const proposalId = prefixedId('proposal', input.makeId)
    db.insert(documentProposals).values({
      id: proposalId,
      baseDocumentId: existing?.id ?? null,
      projectId: input.context.task.projectId,
      type: input.document.documentType,
      scope: input.document.scope,
      scopeId: input.document.scopeId,
      operation: existing ? 'update' : 'create',
      proposedContent: asJsonRecord(input.document),
      baseContentHash: existing?.contentHash ?? null,
      summary: input.document.summary,
      reason: existing
        ? 'Worker submit was based on a stale canonical document hash.'
        : 'Worker submit targets a canonical document that appeared during generation.',
      sourceRunId: input.context.run.id,
      sourceCommit: input.context.run.sourceCommit,
      status: 'pending',
      validity: 'fresh',
      createdBy: 'llm',
      createdAt: input.now,
    }).run()
    db.update(businessDocGenerationTasks)
      .set({
        status: 'proposal_created',
        submittedJson: asJsonRecord(input.submitRecord),
        validationErrors: [],
        savedDocumentId: null,
        updatedAt: input.now,
      })
      .where(eq(businessDocGenerationTasks.id, input.context.task.id))
      .run()

    const downstream = unlockDependentContexts(db, input.context, input.now)
    return buildSubmitResult({
      context: input.context,
      status: 'proposal_created',
      attemptNo: input.context.task.attemptNo,
      contentHash: input.contentHash,
      idempotent: false,
      validationErrorCount: 0,
      savedDocumentId: null,
      proposalId,
      operation: existing ? 'proposal_update' : 'proposal_create',
      baseDocumentId: existing?.id ?? null,
      repairValidationPageToken: null,
      nextRepairAttemptNo: null,
      downstream,
    })
  }

  const savedDocumentId = existing?.id ?? prefixedId('doc', input.makeId)
  if (existing) {
    if (existing.contentHash !== input.contentHash || shouldRefreshExistingDocument(existing, syncMetadata)) {
      db.update(documents)
        .set(toDocumentUpdate({ ...input, syncMetadata }))
        .where(eq(documents.id, existing.id))
        .run()
    }
  } else {
    db.insert(documents).values({
      id: savedDocumentId,
      projectId: input.context.task.projectId,
      type: input.document.documentType,
      track: 'business',
      scope: input.document.scope,
      scopeId: input.document.scopeId,
      status: 'active',
      validity: 'fresh',
      summary: input.document.summary,
      content: asJsonRecord(input.document),
      rawLlmOutput: JSON.stringify(input.document),
      contentHash: input.contentHash,
      staticSnapshotId: syncMetadata?.staticSnapshotId ?? null,
      documentSourceHash: syncMetadata?.sourceHash ?? null,
      sourceRunId: input.context.run.id,
      sourceCommit: input.context.run.sourceCommit,
      updatedBy: 'llm',
      updatedAt: input.now,
    }).run()
  }

  const businessDocument = adaptSubmittedToBusinessDocument(input.document)
  const itemsForPersistence = itemsForPersistenceFromDocument(input.document, businessDocument)
  const persistedItems = itemsForPersistence
    ? persistDocumentItems(db, {
      documentId: savedDocumentId,
      projectId: input.context.task.projectId,
      items: itemsForPersistence,
      now: input.now,
      makeId: input.makeId,
    })
    : null

  // Phase C — materialize the SOT output graph for the canonical document we just
  // wrote. Runs in the same tx, only on the canonical-save branch (never for the
  // proposal branch above, which returns early). Fueled by the EPIC's
  // systemSourceDocIds (Phase A): derives_from doc links, per-item links + the FTS
  // index, and the +1 version snapshot (no-op-skipped when content is unchanged).
  const systemSourceDocIds = recoverSystemSourceDocIds(input.context)
  appendVersion(
    db,
    savedDocumentId,
    asJsonRecord(input.document),
    input.document.summary,
    input.context.run.id,
    input.context.run.sourceCommit ?? undefined,
  )
  replaceDocumentLinks(db, savedDocumentId, businessDocument, systemSourceDocIds)
  replaceDocumentItemSatellites(db, savedDocumentId, input.context.task.projectId, systemSourceDocIds)
  if (persistedItems) {
    materializeItemSourceDocumentLinks(db, {
      pages: input.context.pages,
      items: persistedItems,
    })
  }

  db.update(businessDocGenerationTasks)
    .set({
      status: 'saved',
      submittedJson: asJsonRecord(input.submitRecord),
      validationErrors: [],
      savedDocumentId,
      updatedAt: input.now,
    })
    .where(eq(businessDocGenerationTasks.id, input.context.task.id))
    .run()

  const downstream = unlockDependentContexts(db, input.context, input.now)
  if (input.context.task.taskType === 'use_case_list_refine') {
    downstream.ucsTasksCreated += createUseCaseSpecTasks(db, {
      context: input.context,
      document: input.document,
      now: input.now,
      makeId: input.makeId,
    })
  }

  return buildSubmitResult({
    context: input.context,
    status: 'saved',
    attemptNo: input.context.task.attemptNo,
    contentHash: input.contentHash,
    idempotent: false,
    validationErrorCount: 0,
    savedDocumentId,
    proposalId: null,
    operation: existing ? 'update' : 'create',
    baseDocumentId: existing?.id ?? null,
    repairValidationPageToken: null,
    nextRepairAttemptNo: null,
    downstream,
  })
}

function itemsForPersistenceFromDocument(
  document: BusinessDocsSubmittedDocument,
  businessDocument: BusinessDocument,
): BusinessDocsSubmittedDocumentItem[] | undefined {
  if (!document.items) return undefined
  if (document.documentType !== 'glossary' || businessDocument.type !== 'glossary') return document.items

  const termContentByStableKey = new Map<string, Record<string, unknown>>()
  for (const term of businessDocument.terms) {
    if (!isRecord(term)) continue
    const explicitCanonicalTerm = typeof term.canonical_term === 'string' ? term.canonical_term.trim() : ''
    const hasExplicitCanonicalTerm = explicitCanonicalTerm.length > 0
    const canonicalTerm = hasExplicitCanonicalTerm
      ? explicitCanonicalTerm
      : term.term
    if (typeof canonicalTerm !== 'string' || canonicalTerm.trim() === '') continue
    const canonicalTermMissing =
      (term as unknown as { _canonical_term_missing?: boolean })._canonical_term_missing === true ||
      !hasExplicitCanonicalTerm
    termContentByStableKey.set(`term:${stableKeyPart(canonicalTerm)}`, {
      term: term.term,
      canonical_term: canonicalTerm,
      ...(canonicalTermMissing ? { _canonical_term_missing: true } : {}),
      definition: term.definition,
      aliases: asStringArray(term.aliases),
      synonyms: asStringArray(term.synonyms),
      candidate_aliases: asStringArray(term.candidate_aliases),
      antonyms: asStringArray(term.antonyms),
      contrast_terms: asStringArray(term.contrast_terms),
      related_terms: asStringArray(term.related_terms),
      signals: asStringArray(term.signals),
      code_term: typeof term.code_term === 'string' && term.code_term.trim() ? term.code_term : null,
      trigger: typeof term.trigger === 'string' && term.trigger.trim() ? term.trigger : null,
      caution: typeof term.caution === 'string' && term.caution.trim() ? term.caution : null,
      ambiguity: term.ambiguity ?? null,
    })
  }
  if (termContentByStableKey.size === 0) return document.items

  return document.items.map((item) => {
    if (!isGlossaryTermItemType(item.itemType)) return item
    const termContent = termContentByStableKey.get(item.stableKey)
    if (!termContent) return item
    return {
      ...item,
      content: {
        ...item.content,
        ...termContent,
      },
    }
  })
}

function buildIdempotentResult(
  db: RuntimeReadDb,
  context: SubmitContext,
  storedSubmit: BusinessDocsNormalizedSubmitRecord,
  contentHash: string,
): BusinessDocsSubmitResult {
  const task = context.task
  const validationErrorCount = task.validationErrors?.length ?? 0
  const proposal = task.status === 'proposal_created'
    ? findMatchingProposal(db, context, storedSubmit.document)
    : null
  return buildSubmitResult({
    context,
    status: summarizeSubmitStatus(task.status),
    attemptNo: task.attemptNo,
    contentHash,
    idempotent: true,
    validationErrorCount,
    savedDocumentId: task.savedDocumentId,
    proposalId: proposal?.id ?? null,
    operation: task.status === 'saved' && !task.savedDocumentId ? 'checkpoint_only' : null,
    baseDocumentId: proposal?.baseDocumentId ?? null,
    repairValidationPageToken: validationErrorCount > 0 ? 'validation_errors' : null,
    nextRepairAttemptNo: task.status === 'repair_requested' ? task.attemptNo : null,
    downstream: emptyDownstream(),
  })
}

function unlockDependentContexts(db: RuntimeDb, context: SubmitContext, now: string): DownstreamResult {
  const tasks = db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.runId, context.run.id))
    .all()
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  let contextsUnlocked = 0
  let contextPagesUpserted = 0

  for (const task of tasks) {
    if (!task.dependsOnTaskIdsJson.includes(context.task.id)) continue
    if (!task.dependsOnTaskIdsJson.every((dependencyId) => {
      const dependency = taskById.get(dependencyId)
      return dependency && DEPENDENCY_SUCCESS_STATUSES.has(dependency.status)
    })) continue

    const bundle = db.select().from(businessDocContextBundles)
      .where(eq(businessDocContextBundles.taskId, task.id))
      .get()
    if (!bundle) continue
    const wasReady = bundle.manifestJson.dependencyPagesReady === true
    upsertUpstreamBusinessDocsPage(db, {
      run: context.run,
      dependentTask: task,
      dependencyTasks: task.dependsOnTaskIdsJson
        .map((dependencyId) => taskById.get(dependencyId))
        .filter((dependency): dependency is BusinessDocGenerationTask => Boolean(dependency)),
      bundle,
      now,
    })
    updateBundleManifest(db, bundle, {
      dependencyPagesReady: true,
      addPageTokens: ['upstream_business_docs'],
      removeDeferredPages: ['upstream_business_docs'],
    })
    contextPagesUpserted += 1
    if (!wasReady) contextsUnlocked += 1
  }

  return {
    contextsUnlocked,
    contextPagesUpserted,
    ucsTasksCreated: 0,
  }
}

function createUseCaseSpecTasks(
  db: RuntimeDb,
  input: {
    context: SubmitContext
    document: BusinessDocsSubmittedDocument
    now: string
    makeId: () => string
  },
): number {
  const epicId = input.context.task.epicId
  if (!epicId) return 0
  const useCaseItems = (input.document.items ?? []).filter((item) => item.itemType === 'use_case')
  let created = 0

  for (const item of useCaseItems) {
    const targetKey = `epic:${epicId}:use_case_spec:${item.stableKey}`
    const scopeId = useCaseDocumentScopeId(epicId, item.stableKey)
    const existing = db.select().from(businessDocGenerationTasks)
      .where(and(
        eq(businessDocGenerationTasks.runId, input.context.run.id),
        eq(businessDocGenerationTasks.targetKey, targetKey),
      ))
      .get()
    if (existing) continue

    const taskId = prefixedId('task', input.makeId)
    const contextHandle = prefixedId('context', input.makeId)
    const taskRow = {
      id: taskId,
      runId: input.context.run.id,
      projectId: input.context.task.projectId,
      epicId,
      taskType: 'use_case_spec',
      documentType: 'ucs',
      scope: 'use_case',
      scopeId,
      targetKey,
      status: 'pending',
      dependsOnTaskIdsJson: [input.context.task.id],
      attemptNo: 0,
      maxRepairAttempts: input.context.run.policyJson.maxRepairAttempts,
      contextHandle,
      createdAt: input.now,
      updatedAt: input.now,
    } satisfies NewBusinessDocGenerationTask
    db.insert(businessDocGenerationTasks).values(taskRow).run()

    const sourceGraphProjection = buildUseCaseSourceGraphProjection({
      pages: input.context.pages,
      item,
      runId: input.context.run.id,
      taskId,
    })
    const existingCanonical = findActiveCanonicalSnapshot(db, {
      projectId: input.context.task.projectId,
      documentType: 'ucs',
      scope: 'use_case',
      scopeId,
    })
    const pageTokens: BusinessDocsContextManifest['pageTokens'] = [
      'target',
      'schema',
      'upstream_business_docs',
      'source_graph_projection',
    ]
    if (existingCanonical) pageTokens.push('existing_canonical')
    const manifest = {
      runId: input.context.run.id,
      taskId,
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      sourceCommit: input.context.run.sourceCommit,
      generatedAt: input.now,
      evidenceIdNamespace: `${input.context.run.id}:${taskId}`,
      pageTokens,
      dependencyTaskIds: [input.context.task.id],
      dependencyPagesReady: true,
      deferredPages: [],
    } satisfies BusinessDocsContextManifest
    db.insert(businessDocContextBundles).values({
      contextHandle,
      runId: input.context.run.id,
      taskId,
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      sourceCommit: input.context.run.sourceCommit,
      manifestJson: manifest,
      contentHash: hashJson(manifest),
      createdAt: input.now,
    } satisfies NewBusinessDocContextBundle).run()

    const targetContent = {
      runId: input.context.run.id,
      taskId,
      taskType: 'use_case_spec',
      documentType: 'ucs',
      scope: 'use_case',
      scopeId,
      epicId,
      useCaseId: item.stableKey,
      useCaseKey: item.stableKey,
      outputLanguage: input.context.run.policyJson.outputLanguage,
      sourceCommit: input.context.run.sourceCommit,
      dependencyTaskIds: [input.context.task.id],
    }
    const upstreamEvidenceId = makeEvidenceId({
      runId: input.context.run.id,
      taskId,
      kind: 'upstream_business_docs',
      ordinal: 1,
    })
    const pages = [
      makeContextPage({
        contextHandle,
        pageToken: 'target',
        pageKind: 'target',
        pageOrder: 0,
        summary: 'Task target',
        content: targetContent,
        now: input.now,
      }),
      makeContextPage({
        contextHandle,
        pageToken: 'schema',
        pageKind: 'schema',
        pageOrder: 1,
        summary: 'Output schema summary',
        content: {
          schemaVersion: CONTEXT_SCHEMA_VERSION,
          expectedJson: {
            type: 'ucs',
            scope: 'use_case',
            scopeId,
            evidenceRefs: 'must reference evidence ids from this context only',
            expectedItemContent: {
              actor: 'string',
              trigger: 'string',
              preconditions: 'string[]',
              main_success_flow: 'string[]',
              alternatives: 'string[]',
              exceptions: 'string[]',
              business_rules: 'string[]',
              source_mapping: 'Array<{ sourceRef: string; role: string; reason: string }>',
              uncertainty: 'string[]',
            },
          },
        },
        now: input.now,
      }),
      makeContextPage({
        contextHandle,
        pageToken: 'upstream_business_docs',
        pageKind: 'upstream_business_docs',
        pageOrder: 2,
        summary: 'Final UCL use case context',
        content: {
          dependencies: [dependencyProjection(input.context.task)],
          useCase: item,
        },
        now: input.now,
        evidenceIds: [upstreamEvidenceId],
      }),
      makeContextPage({
        contextHandle,
        pageToken: 'source_graph_projection',
        pageKind: 'source_graph_projection',
        pageOrder: 3,
        summary: 'Use case source coverage subset',
        content: sourceGraphProjection.content,
        now: input.now,
        evidenceIds: sourceGraphProjection.evidenceIds,
      }),
    ]
    if (existingCanonical) {
      const evidenceId = makeEvidenceId({
        runId: input.context.run.id,
        taskId,
        kind: 'existing_canonical',
        ordinal: 1,
      })
      pages.push(makeContextPage({
        contextHandle,
        pageToken: 'existing_canonical',
        pageKind: 'existing_canonical',
        pageOrder: 4,
        summary: 'Existing canonical document metadata',
        content: {
          document: {
            evidenceId,
            documentType: existingCanonical.type,
            contentHash: existingCanonical.contentHash,
            updatedAt: existingCanonical.updatedAt,
            contentProjection: 'metadata_only',
          },
        },
        now: input.now,
        evidenceIds: [evidenceId],
      }))
    }
    for (const page of pages) {
      db.insert(businessDocContextPages).values(page).run()
    }
    created += 1
  }

  return created
}

function useCaseDocumentScopeId(epicId: string, useCaseKey: string): string {
  return `epic:${epicId}:use_case:${useCaseKey}`
}

function findActiveCanonicalSnapshot(
  db: RuntimeReadDb,
  input: {
    projectId: string
    documentType: BusinessDocsStoredDocumentType
    scope: 'epic' | 'project' | 'use_case'
    scopeId: string
  },
): Document | null {
  return db.select().from(documents)
    .where(and(
      eq(documents.projectId, input.projectId),
      eq(documents.track, 'business'),
      eq(documents.status, 'active'),
      eq(documents.type, input.documentType),
      eq(documents.scope, input.scope),
      eq(documents.scopeId, input.scopeId),
    ))
    .get() ?? null
}

function buildUseCaseSourceGraphProjection(input: {
  pages: BusinessDocContextPage[]
  item: BusinessDocsSubmittedDocumentItem
  runId: string
  taskId: string
}): { content: Record<string, unknown>; evidenceIds: string[] } {
  const sourceGraphPage = input.pages.find((page) => page.pageToken === 'source_graph_projection')
  const outline = isRecord(sourceGraphPage?.contentJson.coverageOutline)
    ? sourceGraphPage?.contentJson.coverageOutline
    : null
  const clusterIds = new Set(readStringArrayFromRecord(input.item.content, 'sourceClusterIds'))
  const rawClusters = Array.isArray(outline?.clusters) ? outline.clusters : []
  const selectedClusters = rawClusters.filter((cluster) =>
    isRecord(cluster) &&
    typeof cluster.clusterId === 'string' &&
    (clusterIds.size === 0 || clusterIds.has(cluster.clusterId)))
  const evidenceIds = selectedClusters.map((_, index) => makeEvidenceId({
    runId: input.runId,
    taskId: input.taskId,
    kind: 'source_graph_projection',
    ordinal: index + 1,
  }))
  const clusters = selectedClusters.map((cluster, index) => ({
    ...cluster,
    upstreamEvidenceIds: readStringArrayFromRecord(cluster, 'evidenceIds'),
    evidenceIds: [evidenceIds[index]],
  }))

  return {
    evidenceIds,
    content: {
      coverageOutline: {
        schemaVersion: 'business-docs-source-coverage.v1',
        sourceDocumentCount: clusters.reduce((count, cluster) => {
          const documentIds = Array.isArray(cluster.documentIds) ? cluster.documentIds : []
          return count + documentIds.length
        }, 0),
        clusterCount: clusters.length,
        selectedUseCase: {
          stableKey: input.item.stableKey,
          title: input.item.title,
          summary: input.item.summary,
        },
        clusters,
      },
    },
  }
}

function persistDocumentItems(
  db: RuntimeDb,
  input: {
    documentId: string
    projectId: string
    items: BusinessDocsSubmittedDocumentItem[]
    now: string
    makeId: () => string
  },
): Map<string, {
  itemId: string
  itemType: string
  stableKey: string
  content: Record<string, unknown>
  evidenceIds: string[]
}> {
  const activeItemKeys = new Set<string>()
  const persistedItems = new Map<string, {
    itemId: string
    itemType: string
    stableKey: string
    content: Record<string, unknown>
    evidenceIds: string[]
  }>()

  for (const item of input.items) {
    activeItemKeys.add(`${item.itemType}:${item.stableKey}`)
    const contentHash = hashJson(item.content)
    db.insert(documentItems)
      .values({
        id: prefixedId('item', input.makeId),
        documentId: input.documentId,
        projectId: input.projectId,
        itemType: item.itemType,
        stableKey: item.stableKey,
        ordinal: item.ordinal ?? input.items.indexOf(item) + 1,
        title: item.title,
        summary: item.summary,
        content: item.content,
        contentHash,
        status: 'active',
        createdBy: 'llm',
        updatedBy: 'llm',
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [documentItems.documentId, documentItems.itemType, documentItems.stableKey],
        set: {
          ordinal: item.ordinal ?? input.items.indexOf(item) + 1,
          title: item.title,
          summary: item.summary,
          content: item.content,
          contentHash,
          status: 'active',
          updatedBy: 'llm',
          updatedAt: input.now,
        },
      })
      .run()
    const saved = db.select().from(documentItems)
      .where(and(
        eq(documentItems.documentId, input.documentId),
        eq(documentItems.itemType, item.itemType),
        eq(documentItems.stableKey, item.stableKey),
      ))
      .get()
    if (saved) {
      persistedItems.set(`${item.itemType}:${item.stableKey}`, {
        itemId: saved.id,
        itemType: item.itemType,
        stableKey: item.stableKey,
        content: item.content,
        evidenceIds: item.evidenceIds ?? [],
      })
    }
  }

  const existing = db.select().from(documentItems)
    .where(eq(documentItems.documentId, input.documentId))
    .all()
  for (const row of existing) {
    if (activeItemKeys.has(`${row.itemType}:${row.stableKey}`)) continue
    db.update(documentItems)
      .set({ status: 'stale', updatedBy: 'llm', updatedAt: input.now })
      .where(eq(documentItems.id, row.id))
      .run()
  }

  return persistedItems
}

function materializeItemSourceDocumentLinks(
  db: RuntimeDb,
  input: {
    pages: BusinessDocContextPage[]
    items: Map<string, {
      itemId: string
      content: Record<string, unknown>
      evidenceIds: string[]
    }>
  },
): void {
  const sourceTargets = readSourceEvidenceTargets(input.pages)
  if (sourceTargets.byEvidenceId.size === 0 && sourceTargets.bySourceRef.size === 0) return

  for (const item of input.items.values()) {
    db.delete(documentItemDocumentLinks)
      .where(and(
        eq(documentItemDocumentLinks.fromItemId, item.itemId),
        eq(documentItemDocumentLinks.linkType, 'source_document'),
      ))
      .run()

    for (const target of resolveItemSourceTargets(item, sourceTargets)) {
      db.insert(documentItemDocumentLinks).values({
        fromItemId: item.itemId,
        toDocumentId: target.documentId,
        linkType: 'source_document',
        role: target.role,
        createdBy: 'llm',
      }).onConflictDoNothing().run()
    }
  }
}

function upsertValidationErrorsPage(
  db: RuntimeDb,
  input: {
    context: SubmitContext
    errors: BusinessDocsValidationError[]
    attemptNo: number
    now: string
  },
): void {
  const content = {
    runId: input.context.run.id,
    taskId: input.context.task.id,
    attemptNo: input.attemptNo,
    validationErrors: input.errors,
  }
  upsertContextPage(db, makeContextPage({
    contextHandle: input.context.bundle.contextHandle,
    pageToken: 'validation_errors',
    pageKind: 'validation_errors',
    pageOrder: 90,
    summary: 'Validation errors for repair',
    content,
    now: input.now,
  }))
  updateBundleManifest(db, input.context.bundle, {
    dependencyPagesReady: input.context.bundle.manifestJson.dependencyPagesReady,
    addPageTokens: ['validation_errors'],
    removeDeferredPages: ['validation_errors'],
  })
}

function upsertUpstreamBusinessDocsPage(
  db: RuntimeDb,
  input: {
    run: BusinessDocGenerationRun
    dependentTask: BusinessDocGenerationTask
    dependencyTasks: BusinessDocGenerationTask[]
    bundle: BusinessDocContextBundle
    now: string
  },
): void {
  const evidenceIds = input.dependencyTasks.map((_, index) => makeEvidenceId({
    runId: input.run.id,
    taskId: input.dependentTask.id,
    kind: 'upstream_business_docs',
    ordinal: index + 1,
  }))
  const content = {
    runId: input.run.id,
    taskId: input.dependentTask.id,
    dependencies: input.dependencyTasks.map(dependencyProjection),
  }
  upsertContextPage(db, makeContextPage({
    contextHandle: input.bundle.contextHandle,
    pageToken: 'upstream_business_docs',
    pageKind: 'upstream_business_docs',
    pageOrder: 20,
    summary: 'Upstream business docs',
    content,
    now: input.now,
    evidenceIds,
  }))
}

function upsertContextPage(db: RuntimeDb, page: NewBusinessDocContextPage): void {
  const existing = db.select().from(businessDocContextPages)
    .where(and(
      eq(businessDocContextPages.contextHandle, page.contextHandle),
      eq(businessDocContextPages.pageToken, page.pageToken),
    ))
    .get()
  if (existing) {
    db.update(businessDocContextPages)
      .set({
        pageKind: page.pageKind,
        pageOrder: page.pageOrder,
        summary: page.summary,
        evidenceIdsJson: page.evidenceIdsJson,
        contentJson: page.contentJson,
        contentHash: page.contentHash,
        createdAt: page.createdAt,
      })
      .where(and(
        eq(businessDocContextPages.contextHandle, page.contextHandle),
        eq(businessDocContextPages.pageToken, page.pageToken),
      ))
      .run()
    return
  }
  db.insert(businessDocContextPages).values(page).run()
}

function updateBundleManifest(
  db: RuntimeDb,
  bundle: BusinessDocContextBundle,
  patch: {
    dependencyPagesReady: boolean
    addPageTokens: BusinessDocsContextPageKind[]
    removeDeferredPages: BusinessDocsContextPageKind[]
  },
): void {
  const pageTokens = uniqueStrings([...bundle.manifestJson.pageTokens, ...patch.addPageTokens])
  const deferredPages = bundle.manifestJson.deferredPages
    .filter((pageKind) => !patch.removeDeferredPages.includes(pageKind))
  const manifest = {
    ...bundle.manifestJson,
    dependencyPagesReady: patch.dependencyPagesReady,
    pageTokens,
    deferredPages,
  }
  db.update(businessDocContextBundles)
    .set({
      manifestJson: manifest,
      contentHash: hashJson(manifest),
    })
    .where(eq(businessDocContextBundles.contextHandle, bundle.contextHandle))
    .run()
}

function makeContextPage(input: {
  contextHandle: string
  pageToken: string
  pageKind: BusinessDocsContextPageKind
  pageOrder: number
  summary: string
  content: Record<string, unknown>
  now: string
  evidenceIds?: string[]
}): NewBusinessDocContextPage {
  return {
    contextHandle: input.contextHandle,
    pageToken: input.pageToken,
    pageKind: input.pageKind,
    pageOrder: input.pageOrder,
    summary: input.summary,
    evidenceIdsJson: input.evidenceIds ?? [],
    contentJson: input.content,
    contentHash: hashJson(input.content),
    createdAt: input.now,
  }
}

function validateTarget(input: {
  documentType: BusinessDocsStoredDocumentType
  scope: 'epic' | 'project' | 'use_case'
  scopeId: string
  context: SubmitContext
  errors: BusinessDocsValidationError[]
}): void {
  if (input.context.task.taskType === 'use_case_spec') {
    const useCaseScopeId = targetUseCaseScopeId(input.context.pages)
    if (input.documentType !== 'ucs' || input.scope !== 'use_case' || input.scopeId !== useCaseScopeId) {
      input.errors.push({
        code: 'TARGET_MISMATCH',
        path: '$',
        message: 'Submitted use case spec target does not match task target.',
      })
    }
    return
  }

  if (
    input.documentType !== input.context.task.documentType ||
    input.scope !== input.context.task.scope ||
    input.scopeId !== input.context.task.scopeId
  ) {
    input.errors.push({
      code: 'TARGET_MISMATCH',
      path: '$',
      message: 'Submitted document target does not match task target.',
    })
  }
}

function validateEvidence(input: {
  evidenceIds: string[] | null
  items: BusinessDocsSubmittedDocumentItem[] | undefined
  context: SubmitContext
  errors: BusinessDocsValidationError[]
}): void {
  const allowed = new Set(input.context.pages.flatMap((page) => page.evidenceIdsJson))
  const namespace = input.context.bundle.manifestJson.evidenceIdNamespace
  const submitted = [
    ...(input.evidenceIds ?? []),
    ...(input.items ?? []).flatMap((item) => item.evidenceIds ?? []),
  ]
  for (const evidenceId of submitted) {
    if (!allowed.has(evidenceId) || !evidenceId.startsWith(namespace)) {
      input.errors.push({
        code: 'UNKNOWN_EVIDENCE_ID',
        path: '$.evidenceIds',
        message: `Evidence id is not present in the task context: ${evidenceId}`,
      })
    }
  }
}

function validateFinalUclSourceCoverage(input: {
  useCaseItems: BusinessDocsSubmittedDocumentItem[]
  context: SubmitContext
  errors: BusinessDocsValidationError[]
}): void {
  const outline = readSourceCoverageOutline(input.context.pages)
  if (!outline || outline.clusters.length === 0) return

  const expectedMin = Number.isFinite(outline.expectedMinUseCaseCount)
    ? Math.max(1, Math.trunc(outline.expectedMinUseCaseCount))
    : 1
  if (input.useCaseItems.length < expectedMin) {
    input.errors.push({
      code: 'SOURCE_COVERAGE_MISSING',
      path: '$.items',
      message: `Final UCL has ${input.useCaseItems.length} use cases, but source coverage outline expects at least ${expectedMin}.`,
    })
  }

  const coveredClusterIds = new Set<string>()
  const submittedEvidenceIds = new Set(input.useCaseItems.flatMap((item) => item.evidenceIds ?? []))
  for (const item of input.useCaseItems) {
    for (const clusterId of readStringArrayFromRecord(item.content, 'sourceClusterIds')) {
      coveredClusterIds.add(clusterId)
    }
  }
  for (const cluster of outline.clusters) {
    if (cluster.evidenceIds.some((evidenceId) => submittedEvidenceIds.has(evidenceId))) {
      coveredClusterIds.add(cluster.clusterId)
    }
  }

  const missing = outline.clusters
    .filter((cluster) => !coveredClusterIds.has(cluster.clusterId))
    .map((cluster) => cluster.clusterId)
  if (missing.length > 0) {
    input.errors.push({
      code: 'SOURCE_COVERAGE_MISSING',
      path: '$.items',
      message: `Final UCL does not cover source coverage clusters: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', ...' : ''}.`,
    })
  }
}

function readSourceCoverageOutline(pages: BusinessDocContextPage[]): {
  expectedMinUseCaseCount: number
  clusters: Array<{
    clusterId: string
    evidenceIds: string[]
  }>
} | null {
  const page = pages.find((candidate) => candidate.pageToken === 'source_graph_projection')
  const outline = page?.contentJson.coverageOutline
  if (!isRecord(outline)) return null
  const clustersRaw = outline.clusters
  if (!Array.isArray(clustersRaw)) return null
  const clusters = clustersRaw.flatMap((cluster) => {
    if (!isRecord(cluster) || typeof cluster.clusterId !== 'string') return []
    return [{
      clusterId: cluster.clusterId,
      evidenceIds: readStringArrayFromRecord(cluster, 'evidenceIds'),
    }]
  })
  const expectedUseCaseCount = isRecord(outline.expectedUseCaseCount)
    ? outline.expectedUseCaseCount.min
    : undefined
  return {
    expectedMinUseCaseCount: typeof expectedUseCaseCount === 'number' ? expectedUseCaseCount : 1,
    clusters,
  }
}

function readStringArrayFromRecord(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown, path: string, errors: BusinessDocsValidationError[]): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push({
      code: 'SCHEMA_INVALID',
      path,
      message: `${path} must be a non-empty string.`,
    })
    return null
  }
  return value
}

function readDocumentType(
  value: unknown,
  path: string,
  errors: BusinessDocsValidationError[],
): BusinessDocsStoredDocumentType | null {
  const stringValue = readString(value, path, errors)
  if (!stringValue) return null
  if (!(STORED_DOCUMENT_TYPES as readonly string[]).includes(stringValue)) {
    errors.push({
      code: 'SCHEMA_INVALID',
      path,
      message: `${path} is not a supported business document type.`,
    })
    return null
  }
  return stringValue as BusinessDocsStoredDocumentType
}

function readScope(
  value: unknown,
  path: string,
  errors: BusinessDocsValidationError[],
): 'epic' | 'project' | 'use_case' | null {
  const stringValue = readString(value, path, errors)
  if (!stringValue) return null
  if (stringValue !== 'epic' && stringValue !== 'project' && stringValue !== 'use_case') {
    errors.push({
      code: 'SCHEMA_INVALID',
      path,
      message: `${path} is not a supported business document scope.`,
    })
    return null
  }
  return stringValue
}

function readObject(value: unknown, path: string, errors: BusinessDocsValidationError[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push({
      code: 'SCHEMA_INVALID',
      path,
      message: `${path} must be a JSON object.`,
    })
    return null
  }
  return value as Record<string, unknown>
}

function readStringArray(value: unknown, path: string, errors: BusinessDocsValidationError[]): string[] | null {
  if (!Array.isArray(value)) {
    errors.push({
      code: 'SCHEMA_INVALID',
      path,
      message: `${path} must be an array of strings.`,
    })
    return null
  }
  const result: string[] = []
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim() === '') {
      errors.push({
        code: 'SCHEMA_INVALID',
        path: `${path}[${index}]`,
        message: `${path}[${index}] must be a non-empty string.`,
      })
      continue
    }
    result.push(item)
  }
  return result
}

function readItems(value: unknown, errors: BusinessDocsValidationError[]): BusinessDocsSubmittedDocumentItem[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    errors.push({
      code: 'SCHEMA_INVALID',
      path: '$.items',
      message: '$.items must be an array.',
    })
    return undefined
  }
  const seen = new Set<string>()
  const items: BusinessDocsSubmittedDocumentItem[] = []
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push({
        code: 'SCHEMA_INVALID',
        path: `$.items[${index}]`,
        message: 'Item must be a JSON object.',
      })
      continue
    }
    const row = item as Record<string, unknown>
    const itemType = readString(row.itemType, `$.items[${index}].itemType`, errors)
    const stableKey = readString(row.stableKey, `$.items[${index}].stableKey`, errors)
    const content = readObject(row.content, `$.items[${index}].content`, errors)
    const evidenceIds = row.evidenceIds === undefined
      ? undefined
      : readStringArray(row.evidenceIds, `$.items[${index}].evidenceIds`, errors) ?? undefined
    const ordinal = typeof row.ordinal === 'number' && Number.isInteger(row.ordinal) ? row.ordinal : undefined
    const title = typeof row.title === 'string' ? row.title : undefined
    const summary = typeof row.summary === 'string' ? row.summary : undefined
    if (!itemType || !stableKey || !content) continue
    const key = `${itemType}:${stableKey}`
    if (seen.has(key)) {
      errors.push({
        code: 'DUPLICATE_ITEM_KEY',
        path: `$.items[${index}].stableKey`,
        message: `Duplicate item key: ${key}`,
      })
      continue
    }
    seen.add(key)
    items.push({ itemType, stableKey, ordinal, title, summary, content, evidenceIds })
  }
  return items
}

function findCanonicalDocument(
  db: RuntimeReadDb,
  projectId: string,
  document: BusinessDocsSubmittedDocument,
): Document | null {
  return db.select().from(documents)
    .where(and(
      eq(documents.projectId, projectId),
      eq(documents.track, 'business'),
      eq(documents.type, document.documentType),
      eq(documents.scope, document.scope),
      eq(documents.scopeId, document.scopeId),
    ))
    .get() ?? null
}

function decidePersistenceTarget(
  existing: Document | null,
  document: BusinessDocsSubmittedDocument,
  contentHash: string,
  syncMetadata: SubmitSyncMetadata | null,
): { kind: 'save' } | { kind: 'proposal' } {
  if (!existing) return { kind: 'save' }
  if (syncMetadata && existing.updatedBy === 'user') return { kind: 'proposal' }
  if (existing.status === 'deleted' || existing.validity === 'orphaned') return { kind: 'save' }
  if (syncMetadata) return { kind: 'save' }
  if (existing.contentHash === contentHash) return { kind: 'save' }
  if (document.baseContentHash && document.baseContentHash === existing.contentHash) return { kind: 'save' }
  return { kind: 'proposal' }
}

function shouldRefreshExistingDocument(existing: Document, syncMetadata: SubmitSyncMetadata | null): boolean {
  return syncMetadata !== null || existing.status === 'deleted' || existing.validity === 'orphaned'
}

function toDocumentUpdate(input: {
  context: SubmitContext
  document: BusinessDocsSubmittedDocument
  now: string
  contentHash: string
  syncMetadata?: SubmitSyncMetadata | null
}) {
  const update = {
    status: 'active',
    validity: 'fresh',
    summary: input.document.summary,
    content: asJsonRecord(input.document),
    rawLlmOutput: JSON.stringify(input.document),
    contentHash: input.contentHash,
    sourceRunId: input.context.run.id,
    sourceCommit: input.context.run.sourceCommit,
    updatedBy: 'llm',
    updatedAt: input.now,
  } as const
  if (!input.syncMetadata) return update
  return {
    ...update,
    staticSnapshotId: input.syncMetadata.staticSnapshotId,
    documentSourceHash: input.syncMetadata.sourceHash,
  }
}

function buildSubmitResult(input: {
  context: SubmitContext
  status: 'saved' | 'proposal_created' | 'repair_requested' | 'failed'
  attemptNo: number
  contentHash: string
  idempotent: boolean
  validationErrorCount: number
  savedDocumentId: string | null
  proposalId: string | null
  operation: BusinessDocsSubmitResult['document']['operation']
  baseDocumentId: string | null
  repairValidationPageToken: 'validation_errors' | null
  nextRepairAttemptNo: number | null
  downstream: DownstreamResult
}): BusinessDocsSubmitResult {
  return {
    task: {
      id: input.context.task.id,
      runId: input.context.task.runId,
      taskType: input.context.task.taskType,
      documentType: input.context.task.documentType,
      scope: input.context.task.scope,
      scopeId: input.context.task.scopeId,
      status: input.status,
      attemptNo: input.attemptNo,
      contextHandle: input.context.task.contextHandle ?? '',
    },
    submit: {
      contentHash: input.contentHash,
      idempotent: input.idempotent,
      validationErrorCount: input.validationErrorCount,
    },
    document: {
      savedDocumentId: input.savedDocumentId,
      proposalId: input.proposalId,
      operation: input.operation,
      baseDocumentId: input.baseDocumentId,
    },
    repair: {
      validationPageToken: input.repairValidationPageToken,
      nextAttemptNo: input.nextRepairAttemptNo,
      maxRepairAttempts: input.context.task.maxRepairAttempts,
    },
    downstream: input.downstream,
    nextAction: {
      type: input.status === 'failed'
        ? 'stop_failed'
        : input.status === 'repair_requested'
          ? 'repair_task'
          : 'lease_more',
    },
  }
}

function dependencyProjection(task: BusinessDocGenerationTask): Record<string, unknown> {
  const submitted = parseSubmitRecord(task.submittedJson)
  return {
    taskId: task.id,
    taskType: task.taskType,
    documentType: task.documentType,
    status: task.status,
    savedDocumentId: task.savedDocumentId,
    summary: submitted?.document.summary,
    document: submitted?.document,
  }
}

function targetUseCaseScopeId(pages: BusinessDocContextPage[]): string | null {
  const target = pages.find((page) => page.pageToken === 'target')
  const value = target?.contentJson.scopeId
  return typeof value === 'string' ? value : null
}

function findMatchingProposal(
  db: RuntimeReadDb,
  context: SubmitContext,
  document: BusinessDocsSubmittedDocument,
) {
  return db.select().from(documentProposals)
    .where(and(
      eq(documentProposals.projectId, context.task.projectId),
      eq(documentProposals.type, document.documentType),
      eq(documentProposals.scope, document.scope),
      eq(documentProposals.scopeId, document.scopeId),
      eq(documentProposals.sourceRunId, context.run.id),
      eq(documentProposals.status, 'pending'),
    ))
    .all()
    .find((proposal) => hashJson(proposal.proposedContent) === hashJson(document)) ?? null
}

function summarizeSubmitStatus(status: BusinessDocGenerationTask['status']): BusinessDocsSubmitResult['task']['status'] {
  if (
    status === 'saved' ||
    status === 'proposal_created' ||
    status === 'repair_requested' ||
    status === 'failed'
  ) {
    return status
  }
  return 'failed'
}

function parseSubmitRecord(value: Record<string, unknown> | null): BusinessDocsNormalizedSubmitRecord | null {
  if (!value || value.schemaVersion !== SUBMIT_RECORD_SCHEMA_VERSION) return null
  if (
    typeof value.taskId !== 'string' ||
    typeof value.leaseToken !== 'string' ||
    typeof value.attemptNo !== 'number' ||
    typeof value.contentHash !== 'string' ||
    !value.document ||
    typeof value.document !== 'object' ||
    Array.isArray(value.document)
  ) {
    return null
  }
  return value as unknown as BusinessDocsNormalizedSubmitRecord
}

function failure(
  code: Exclude<BusinessDocsSubmitServiceResult, { ok: true }>['code'],
  message: string,
): BusinessDocsSubmitServiceResult {
  return { ok: false, code, message }
}

function emptyDownstream(): DownstreamResult {
  return {
    contextsUnlocked: 0,
    contextPagesUpserted: 0,
    ucsTasksCreated: 0,
  }
}

function prefixedId(prefix: string, makeId: () => string): string {
  const id = makeId()
  return id.startsWith(`${prefix}:`) ? id : `${prefix}:${id}`
}

function makeEvidenceId(input: { runId: string; taskId: string; kind: string; ordinal: number }): string {
  return `${input.runId}:${input.taskId}:${input.kind}:${input.ordinal}`
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function asJsonRecord<T extends object>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>
}

function asJsonRecordArray<T extends object>(value: T[]): Array<Record<string, unknown>> {
  return value as unknown as Array<Record<string, unknown>>
}

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJsonStringify(value)).digest('hex')}`
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`
  )).join(',')}}`
}
