import type { TechnicalDocumentType } from '@/db/schema/build_docs.js'
import { BUILD_DOCS_GENERATION_SCHEMA_VERSION, type DraftSchemaContext, type ValidationError } from './types.js'

const forbiddenDraftFields = [
  'id',
  'type',
  'identity',
  'relations',
  'relation_facts',
  'relation_evidence_checked',
  'contracts',
  'source_links',
  'evidence_refs',
  'raw_evidence_pages',
  'evidence_pages',
  'source_context',
  'source_excerpts',
  'source_link_candidates',
] as const

const apiSpecForbiddenDraftFields = ['input', 'response'] as const
const apiSpecAllowedDraftFields = ['title', 'summary', 'access', 'flow', 'rules', 'source_link_selection'] as const

export function draftSchemaFor(documentType: TechnicalDocumentType): DraftSchemaContext {
  return {
    schema_name: documentType,
    schema_version: BUILD_DOCS_GENERATION_SCHEMA_VERSION,
    output_rules: [
      'Return exactly one JSON object for this task.',
      'Use only Platty CLI context and allowed evidence ids.',
      'Write draft explanation fields only.',
      ...outputRulesFor(documentType),
    ],
    quality_rules: qualityRulesFor(documentType),
    required_fields: requiredFieldsFor(documentType),
    system_injected_fields: systemInjectedFieldsFor(documentType),
    llm_output_shape: outputShapeFor(documentType),
  }
}

export function validateDraft(document: unknown, documentType: TechnicalDocumentType): ValidationError[] {
  if (!isRecord(document)) return [{ code: 'INVALID_JSON_OBJECT', path: '$', message: 'document must be a JSON object' }]

  const errors: ValidationError[] = []
  for (const field of forbiddenDraftFields) {
    if (field in document) {
      errors.push({
        code: 'FORBIDDEN_SYSTEM_FIELD',
        path: `$.${field}`,
        message: `${field} is owned by Platty runtime and must not be included in the draft`,
      })
    }
  }
  if (documentType === 'api_spec') {
    const allowedFields = new Set<string>(apiSpecAllowedDraftFields)
    const systemFields = new Set<string>([...forbiddenDraftFields, ...apiSpecForbiddenDraftFields])
    for (const field of apiSpecForbiddenDraftFields) {
      if (field in document) {
        errors.push({
          code: 'FORBIDDEN_SYSTEM_FIELD',
          path: `$.${field}`,
          message: `${field} is owned by Platty runtime and must not be included in the draft`,
        })
      }
    }
    for (const field of Object.keys(document)) {
      if (!allowedFields.has(field) && !systemFields.has(field)) {
        errors.push({
          code: 'FORBIDDEN_DRAFT_FIELD',
          path: `$.${field}`,
          message: `api_spec drafts may only include ${apiSpecAllowedDraftFields.join(', ')}`,
        })
      }
    }
  }
  for (const field of requiredFieldsFor(documentType)) {
    if (!(field in document)) {
      errors.push({
        code: 'REQUIRED_FIELD_MISSING',
        path: `$.${field}`,
        message: `${field} is required`,
      })
    }
  }

  if (documentType === 'api_spec') validateApiDraft(document, errors)
  if (documentType === 'screen_spec') validateScreenDraft(document, errors)
  if (documentType === 'event_spec') validateEventDraft(document, errors)
  if (documentType === 'schedule_spec') validateScheduleDraft(document, errors)
  return errors
}

function validateApiDraft(document: Record<string, unknown>, errors: ValidationError[]): void {
  requireNonEmptyString(document.title, '$.title', 'title', errors)
  requireNonEmptyString(document.summary, '$.summary', 'summary', errors)
  requireSingleLineString(document.access, '$.access', 'access', errors)
  requireNonEmptyStringArray(document.flow, '$.flow', 'flow must include at least one source-backed execution step', errors)
  requireArray(document.rules, '$.rules', 'rules', errors)
  validateSourceLinkSelection(document.source_link_selection, errors)
}

function validateScreenDraft(document: Record<string, unknown>, errors: ValidationError[]): void {
  requireNonEmptyString(document.title, '$.title', 'title', errors)
  requireNonEmptyString(document.summary, '$.summary', 'summary', errors)
  requireNonEmptyString(document.ascii_ui, '$.ascii_ui', 'ascii_ui', errors)
  requireArray(document.layout, '$.layout', 'layout', errors)
  requireArray(document.state, '$.state', 'state', errors)
  requireNonEmptyStringArray(document.flow, '$.flow', 'flow must include at least one source-backed screen behavior step', errors)
  requireArray(document.rules, '$.rules', 'rules', errors)
}

function validateEventDraft(document: Record<string, unknown>, errors: ValidationError[]): void {
  requireNonEmptyString(document.title, '$.title', 'title', errors)
  requireNonEmptyString(document.summary, '$.summary', 'summary', errors)
  requireRecord(document.payload, '$.payload', 'payload', errors)
  requireArray(document.consumers, '$.consumers', 'consumers', errors)
}

function validateScheduleDraft(document: Record<string, unknown>, errors: ValidationError[]): void {
  requireNonEmptyString(document.title, '$.title', 'title', errors)
  requireNonEmptyString(document.summary, '$.summary', 'summary', errors)
  requireRecord(document.trigger, '$.trigger', 'trigger', errors)
  requireRecord(document.input, '$.input', 'input', errors)
  requireNonEmptyStringArray(document.flow, '$.flow', 'flow must include at least one source-backed schedule execution step', errors)
  requireArray(document.rules, '$.rules', 'rules', errors)
}

function requiredFieldsFor(documentType: TechnicalDocumentType): string[] {
  if (documentType === 'api_spec') return ['title', 'summary', 'access', 'flow', 'rules']
  if (documentType === 'screen_spec') return ['title', 'summary', 'ascii_ui', 'layout', 'state', 'flow', 'rules']
  if (documentType === 'event_spec') return ['title', 'summary', 'payload', 'consumers']
  return ['title', 'summary', 'trigger', 'input', 'flow', 'rules']
}

function outputShapeFor(documentType: TechnicalDocumentType): Record<string, unknown> {
  if (documentType === 'api_spec') {
    return {
      title: 'string',
      summary: 'string',
      access: 'one-line access/auth summary from source-backed evidence',
      flow: ['source-backed execution step'],
      rules: ['source-backed durable rule; [] when none is explicit'],
      source_link_selection: {
        access: ['source_link_candidate id from content.source_link_candidates'],
        input: ['source_link_candidate id from content.source_link_candidates'],
        response: ['source_link_candidate id from content.source_link_candidates'],
      },
    }
  }
  if (documentType === 'screen_spec') {
    return {
      title: 'string',
      summary: 'string',
      ascii_ui: 'non-empty compact ASCII wireframe from source-backed visible UI/components/states',
      layout: [{ name: 'string', type: 'header|form|list|table|tab|modal|card|empty_state|footer|unknown', fields: ['string'] }],
      state: [{ name: 'string', source: 'local|provider|store|query|route_param|unknown' }],
      flow: ['source-backed screen behavior step'],
      rules: ['source-backed durable UI/business rule; [] when none is explicit'],
    }
  }
  if (documentType === 'event_spec') {
    return {
      title: 'string',
      summary: 'string',
      payload: 'object map of explicit payload field name to type/description; use {} when unclear',
      consumers: [{ handler: 'string', file_path: 'string?', flow: ['string'], rules: ['string'] }],
    }
  }
  return {
    title: 'string',
    summary: 'string',
    trigger: { type: 'cron|interval|manual|unknown', expression: 'string?' },
    input: 'object map of explicit input names to type/description; use {} when unclear',
    flow: ['source-backed schedule execution step'],
    rules: ['source-backed durable schedule/business rule; [] when none is explicit'],
  }
}

function qualityRulesFor(documentType: TechnicalDocumentType): string[] {
  if (documentType === 'api_spec') {
    return [
      'One api_spec is exactly one HTTP method/path from target.',
      'Write access as a single line that identifies observed auth, guard, role, or public access evidence.',
      'Do not write detailed input, response, or contracts schemas; select source_link_selection candidate ids instead when source-backed candidates exist.',
      'source_link_selection must only contain ids from content.source_link_candidates grouped under access, input, and response.',
      'Flow is observed execution sequence, not a generic handler summary.',
      'Rules are durable constraints or decisions. Do not duplicate flow steps as rules.',
      'Use code_relation_facts and service_map_facts as source-backed side-effect evidence.',
      'Relations are system-injected by Platty from build_relations and build_service_map; do not output relations.',
    ]
  }
  if (documentType === 'screen_spec') {
    return [
      'ascii_ui must be non-empty and source-backed.',
      'Copy visible literals exactly from source evidence.',
      'Include loading/empty/auth/tabs/conditional/error states when source-backed.',
      'Do not document child internals unless child source is included.',
      'Use relation facts for API calls, navigation, and external links in flow, but do not output relations.',
    ]
  }
  if (documentType === 'event_spec') return ['Document only explicit payload and consumer behavior evidence; event identity is system-owned.']
  return ['Document only explicit trigger, input, flow, and rule evidence; schedule identity is system-owned.']
}

function outputRulesFor(documentType: TechnicalDocumentType): string[] {
  if (documentType === 'api_spec') {
    return [
      'Do not output id, type, identity, input, response, contracts, source_links, relations, relation_facts, evidence_refs, relation_evidence_checked, direct source metadata, source_context, source_excerpts, or raw evidence pages.',
      'Write access as one line only; do not include detailed input or response schemas.',
      'Choose source_link_selection ids only from content.source_link_candidates.',
      'Never invent node_id, file_path, line_start, line_end, or evidence_id values.',
      'Platty injects identity, source_links, relations, evidence_refs, relation_evidence_checked, and persistence metadata after validation.',
    ]
  }

  return [
    'Do not output id, type, identity, contracts, relations, relation_facts, evidence_refs, relation_evidence_checked, source_link_candidates, or raw evidence pages.',
    'Platty injects identity, contracts, relations, evidence_refs, relation_evidence_checked, and persistence metadata after validation.',
  ]
}

function systemInjectedFieldsFor(documentType: TechnicalDocumentType): string[] {
  if (documentType === 'api_spec') {
    return ['id', 'type', 'identity', 'source_links', 'relations', 'evidence_refs', 'relation_evidence_checked']
  }

  return ['id', 'type', 'identity', 'relations', 'evidence_refs', 'relation_evidence_checked', 'contracts']
}

function requireNonEmptyString(value: unknown, path: string, field: string, errors: ValidationError[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push({ code: 'QUALITY_FIELD_EMPTY', path, message: `${field} must be a non-empty string` })
  }
}

function requireSingleLineString(value: unknown, path: string, field: string, errors: ValidationError[]): void {
  requireNonEmptyString(value, path, field, errors)
  if (typeof value === 'string' && /[\r\n]/.test(value)) {
    errors.push({ code: 'QUALITY_FIELD_SHAPE', path, message: `${field} must be a single line` })
  }
}

function requireRecord(value: unknown, path: string, field: string, errors: ValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({ code: 'QUALITY_FIELD_SHAPE', path, message: `${field} must be a JSON object` })
  }
}

function requireArray(value: unknown, path: string, field: string, errors: ValidationError[]): void {
  if (!Array.isArray(value)) {
    errors.push({ code: 'QUALITY_FIELD_SHAPE', path, message: `${field} must be an array` })
  }
}

function requireNonEmptyStringArray(value: unknown, path: string, message: string, errors: ValidationError[]): void {
  if (!Array.isArray(value) || !value.some((item) => typeof item === 'string' && item.trim().length > 0)) {
    errors.push({ code: 'QUALITY_FIELD_EMPTY', path, message })
  }
}

function validateSourceLinkSelection(value: unknown, errors: ValidationError[]): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    errors.push({
      code: 'QUALITY_FIELD_SHAPE',
      path: '$.source_link_selection',
      message: 'source_link_selection must be a JSON object',
    })
    return
  }

  const allowedSections = ['access', 'input', 'response']
  for (const key of Object.keys(value)) {
    if (!allowedSections.includes(key)) {
      errors.push({
        code: 'FORBIDDEN_DRAFT_FIELD',
        path: `$.source_link_selection.${key}`,
        message: `${key} is not an allowed source_link_selection role`,
      })
    }
  }

  for (const section of allowedSections) {
    const sectionValue = value[section]
    const sectionPath = `$.source_link_selection.${section}`
    if (sectionValue === undefined) continue
    if (!Array.isArray(sectionValue)) {
      errors.push({
        code: 'QUALITY_FIELD_SHAPE',
        path: sectionPath,
        message: `${section} source link selection must be an array of source_link_candidate ids`,
      })
      continue
    }
    sectionValue.forEach((item, index) => {
      if (typeof item !== 'string' || item.trim().length === 0) {
        errors.push({
          code: 'QUALITY_FIELD_SHAPE',
          path: `${sectionPath}[${index}]`,
          message: `${section} source link selection items must be non-empty source_link_candidate ids`,
        })
      }
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
