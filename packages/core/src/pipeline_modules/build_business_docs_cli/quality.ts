import type { BusinessDocContextPage } from '@/db/schema/build_business_docs_generation.js'
import type {
  BusinessDocsStoredDocumentType,
  BusinessDocsSubmittedDocumentItem,
  BusinessDocsValidationError,
} from './types.js'
import {
  readSourceEvidenceTargets,
  resolveItemSourceTargets,
} from './source_refs.js'

const SOURCE_CATALOG_ONLY_ITEM_KEYS = new Set([
  'sourceRef',
  'documentType',
  'sourceTitle',
  'sourceSummary',
  'sourceIdentity',
  'epicLink',
])

const VALID_EARS_PATTERNS = new Set(['ubiquitous', 'event_driven', 'state_driven', 'optional', 'unwanted'])
const VALID_RULE_OWNERSHIP = new Set(['owned_by_epic', 'handoff', 'reference'])
const VALID_RELATION_CONFIDENCE = new Set([
  'direct_call_proven',
  'relation_inferred',
  'topical_cluster',
  'cross_epic',
])
const VALID_GLOSSARY_AMBIGUITY_STATUS = new Set(['none', 'ambiguous', 'user_resolved'])

export interface BusinessDocsSotQualityInput {
  documentType: BusinessDocsStoredDocumentType
  content?: Record<string, unknown>
  items: BusinessDocsSubmittedDocumentItem[]
  pages: BusinessDocContextPage[]
  errors: BusinessDocsValidationError[]
}

export function validateBusinessDocumentSotQuality(input: BusinessDocsSotQualityInput): void {
  validateEvidenceGaps(input.content, input.errors)

  if (input.items.length === 0) {
    input.errors.push({
      code: 'DOCUMENT_QUALITY_INSUFFICIENT',
      path: '$.items',
      message: `${input.documentType} documents must include active items so they can serve as searchable SOT.`,
    })
    return
  }

  const sourceTargets = readSourceEvidenceTargets(input.pages)
  const unlinkedItems = input.items.filter((item) => resolveItemSourceTargets(item, sourceTargets).length === 0)
  if (unlinkedItems.length > 0) {
    input.errors.push({
      code: 'SOURCE_RELATION_UNSUPPORTED',
      path: '$.items',
      message: `${input.documentType} items must reference at least one sourceRef or evidence id that resolves to a lower source document.`,
    })
  }

  if (
    input.documentType === 'br' ||
    input.documentType === 'data_dictionary' ||
    input.documentType === 'design' ||
    input.documentType === 'glossary'
  ) {
    const sourceCatalogOnlyItems = input.items.filter((item) => isSourceCatalogOnlyItem(item))
    if (sourceCatalogOnlyItems.length === input.items.length) {
      input.errors.push({
        code: 'DOCUMENT_QUALITY_INSUFFICIENT',
        path: '$.items',
        message: `${input.documentType} items only restate source cards. Add document-type-specific business content instead of submitting a source catalog.`,
      })
    }
  }

  switch (input.documentType) {
    case 'ucl':
      validateUclSotQuality(input.items, input.errors)
      break
    case 'ucs':
      validateUcsSotQuality(input.items, input.errors)
      break
    case 'data_dictionary':
      validateDataDictionarySotQuality(input.items, input.errors)
      break
    case 'br':
      validateBusinessRulesSotQuality(input.items, input.errors)
      break
    case 'design':
      validateDesignSotQuality(input.items, input.errors)
      break
    case 'glossary':
      validateGlossarySotQuality(input.items, input.errors)
      break
  }
}

function validateEvidenceGaps(content: Record<string, unknown> | undefined, errors: BusinessDocsValidationError[]): void {
  const evidenceGaps = content?.evidence_gaps
  if (!Array.isArray(evidenceGaps)) return
  const hasSchemaFragment = evidenceGaps.some((gap) =>
    typeof gap === 'string' &&
    /"?(use_cases|rules|terms|entities|sequence_diagrams)"?\s*:\s*\[/.test(gap))
  if (!hasSchemaFragment) return
  errors.push({
    code: 'DOCUMENT_QUALITY_INSUFFICIENT',
    path: '$.content.evidence_gaps',
    message: 'evidence_gaps must be human-readable uncertainty statements, not JSON schema fragments.',
  })
}

function isSourceCatalogOnlyItem(item: BusinessDocsSubmittedDocumentItem): boolean {
  const keys = Object.keys(item.content)
  if (keys.length === 0) return false
  return keys.every((key) => SOURCE_CATALOG_ONLY_ITEM_KEYS.has(key))
}

function validateUclSotQuality(
  items: BusinessDocsSubmittedDocumentItem[],
  errors: BusinessDocsValidationError[],
): void {
  const useCaseItems = items.filter((item) => item.itemType === 'use_case')
  if (useCaseItems.some((item) =>
    !readStringArrayFromRecord(item.content, 'sourceClusterIds').length ||
    !hasNonEmptyString(item.content.coverageRelation) ||
    typeof item.content.ownedByEpic !== 'boolean' ||
    !hasArray(item.content.primarySourceRefs) ||
    !hasArray(item.content.supportingSourceRefs) ||
    !hasArray(item.content.crossEpicSourceRefs))) {
    errors.push({
      code: 'UCL_QUALITY_INSUFFICIENT',
      path: '$.items',
      message: 'UCL use cases must include sourceClusterIds, coverageRelation, ownedByEpic, and source reference buckets so source coverage is not mistaken for EPIC ownership.',
    })
  }
}

function validateUcsSotQuality(
  items: BusinessDocsSubmittedDocumentItem[],
  errors: BusinessDocsValidationError[],
): void {
  if (items.some((item) =>
    !hasNonEmptyString(item.content.actor) ||
    !hasNonEmptyString(item.content.trigger) ||
    !hasArray(item.content.preconditions) ||
    !hasNonEmptyArray(item.content.main_success_flow) ||
    !hasArray(item.content.alternatives) ||
    !hasArray(item.content.exceptions) ||
    !hasNonEmptyArray(item.content.business_rules) ||
    !hasNonEmptyArray(item.content.source_mapping))) {
    errors.push({
      code: 'UCS_QUALITY_INSUFFICIENT',
      path: '$.items',
      message: 'UCS items must include actor, trigger, preconditions, main_success_flow, alternatives, exceptions, business_rules, and source_mapping.',
    })
  }
}

function validateDataDictionarySotQuality(
  items: BusinessDocsSubmittedDocumentItem[],
  errors: BusinessDocsValidationError[],
): void {
  if (items.some((item) => !isDataDictionaryItem(item.content))) {
    errors.push({
      code: 'DD_QUALITY_INSUFFICIENT',
      path: '$.items',
      message: 'Data dictionary items must describe model/table entities, fields with source mapping, states, relationships, or an explicit missing_model_evidence gap.',
    })
  }
}

function isDataDictionaryItem(content: Record<string, unknown>): boolean {
  if (content.gapType === 'missing_model_evidence') {
    return hasNonEmptyString(content.message) && hasNonEmptyArray(content.source_mapping)
  }
  if (hasNonEmptyString(content.entity) && (hasNonEmptyArray(content.fields) || hasNonEmptyArray(content.states))) {
    return fieldsHaveSourceMapping(content.fields)
  }
  if (hasNonEmptyString(content.relationship) && hasNonEmptyString(content.from) && hasNonEmptyString(content.to)) return true
  if (hasNonEmptyString(content.from) && hasNonEmptyString(content.to) && hasNonEmptyString(content.meaning)) return true
  return false
}

function fieldsHaveSourceMapping(value: unknown): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value)) return false
  return value.every((field) => {
    if (!isRecord(field)) return false
    return hasNonEmptyString(field.name) &&
      hasNonEmptyString(field.meaning) &&
      hasNonEmptyArray(field.source_mapping)
  })
}

function validateBusinessRulesSotQuality(
  items: BusinessDocsSubmittedDocumentItem[],
  errors: BusinessDocsValidationError[],
): void {
  if (items.some((item) =>
    !VALID_EARS_PATTERNS.has(String(item.content.earsPattern)) ||
    !hasNonEmptyString(item.content.condition) ||
    !hasNonEmptyString(item.content.rule) ||
    !hasNonEmptyString(item.content.outcome) ||
    !VALID_RULE_OWNERSHIP.has(String(item.content.ownership)) ||
    !hasNonEmptyArray(item.content.source_mapping))) {
    errors.push({
      code: 'BR_QUALITY_INSUFFICIENT',
      path: '$.items',
      message: 'BR items must be EARS-style rules with earsPattern, condition, rule, outcome, ownership, and source_mapping.',
    })
  }
}

function validateDesignSotQuality(
  items: BusinessDocsSubmittedDocumentItem[],
  errors: BusinessDocsValidationError[],
): void {
  if (items.some((item) =>
    !hasNonEmptyString(item.content.component) ||
    !hasNonEmptyString(item.content.responsibility) ||
    !hasArray(item.content.flow) ||
    !hasArray(item.content.integration_points) ||
    !hasNonEmptyArray(item.content.source_mapping) ||
    !VALID_RELATION_CONFIDENCE.has(String(item.content.relationConfidence)))) {
    errors.push({
      code: 'DESIGN_QUALITY_INSUFFICIENT',
      path: '$.items',
      message: 'Design items must include component, responsibility, flow, integration_points, source_mapping, and relationConfidence.',
    })
  }
}

function validateGlossarySotQuality(
  items: BusinessDocsSubmittedDocumentItem[],
  errors: BusinessDocsValidationError[],
): void {
  const canonicalTerms = new Set<string>()
  const aliasOwner = new Map<string, string>()
  let insufficient = false
  let duplicateCanonical = false
  let aliasCollision = false

  for (const item of items) {
    const canonical = canonicalGlossaryTerm(item)
    if (canonical && canonicalTerms.has(canonical)) duplicateCanonical = true
    if (canonical) canonicalTerms.add(canonical)
    const canonicalOwner = canonical ? aliasOwner.get(canonical) : undefined
    if (canonicalOwner && canonicalOwner !== canonical) aliasCollision = true
    if (canonical && !canonicalOwner) aliasOwner.set(canonical, canonical)

    const searchableTerms = [
      ...readStringList(item.content.aliases),
      ...readStringList(item.content.synonyms),
      ...readStringList(item.content.candidate_aliases),
    ].map(normalizeTerm).filter(Boolean)

    for (const searchableTerm of searchableTerms) {
      const owner = aliasOwner.get(searchableTerm)
      if (owner && owner !== canonical) aliasCollision = true
      if (!owner && canonical) aliasOwner.set(searchableTerm, canonical)
    }

    if (
      !hasNonEmptyString(item.content.term) ||
      !hasNonEmptyString(item.content.canonical_term) ||
      item.content._canonical_term_missing === true ||
      !hasNonEmptyString(item.content.definition) ||
      !hasNonEmptyString(item.content.termType) ||
      !hasNonEmptyArray(item.content.source_mapping) ||
      !hasArray(item.content.aliases) ||
      !hasArray(item.content.synonyms) ||
      !hasArray(item.content.candidate_aliases) ||
      !hasArray(item.content.antonyms) ||
      !hasArray(item.content.contrast_terms) ||
      !hasArray(item.content.related_terms) ||
      !hasArray(item.content.signals) ||
      !hasValidGlossaryAmbiguity(item.content.ambiguity)
    ) {
      insufficient = true
    }
  }

  if (duplicateCanonical || insufficient) {
    errors.push({
      code: 'GLOSSARY_QUALITY_INSUFFICIENT',
      path: '$.items',
      message: 'Glossary items must include unique canonical terms, definition, termType, registry arrays, source_mapping, and valid ambiguity metadata.',
    })
  }

  if (aliasCollision) {
    errors.push({
      code: 'GLOSSARY_ALIAS_COLLISION',
      path: '$.items',
      message: 'A confirmed glossary alias or synonym is assigned to multiple canonical terms.',
    })
  }
}

function hasValidGlossaryAmbiguity(value: unknown): boolean {
  if (!isRecord(value)) return false
  const status = value.status
  const candidates = value.candidates
  if (typeof status !== 'string' || !VALID_GLOSSARY_AMBIGUITY_STATUS.has(status)) return false
  if (!Array.isArray(candidates)) return false
  if (value.resolution_note !== undefined && typeof value.resolution_note !== 'string') return false
  if (status === 'ambiguous' && candidates.length === 0) return false
  return candidates.every((candidate) =>
    isRecord(candidate) &&
    hasNonEmptyString(candidate.meaning) &&
    hasArray(candidate.epic_ids) &&
    hasArray(candidate.source_doc_ids))
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function hasArray(value: unknown): boolean {
  return Array.isArray(value)
}

function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function readStringArrayFromRecord(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

function normalizeTerm(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
    : []
}

function canonicalGlossaryTerm(item: BusinessDocsSubmittedDocumentItem): string {
  const canonical = typeof item.content.canonical_term === 'string' ? item.content.canonical_term : ''
  return normalizeTerm(canonical)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
