import type { TechnicalDocumentType } from '@/db/schema/build_docs.js'
import type {
  BuildDocsGenerationContextResponse,
  DraftSchemaContext,
  LeasedGenerationTask,
  LeaseTaskResult,
} from '../runtime/types.js'
import { outputLanguageInstruction, type OutputLanguage } from '@/pipeline_modules/shared/output_language.js'

export interface BuildDocsAgentWorkPacket {
  type: 'task'
  task: {
    taskId: string
    leaseToken: string
    taskType: TechnicalDocumentType
    targetSummary: string
    leaseExpiresAt: string
  }
  agentInput: {
    modelHint: { provider: 'claude_code'; model: 'haiku'; effort: 'low' }
    prompt: string
    outputSchema: Record<string, unknown>
    context: BuildDocsGenerationContextResponse
    rules: string[]
    forbiddenFields: string[]
  }
  submit: {
    command: string[]
  }
}

export type BuildDocsAgentNextResult =
  | BuildDocsAgentWorkPacket
  | Extract<LeaseTaskResult, { type: 'not_approved' | 'no_task_available' }>

export function buildDocsAgentWorkPacket(input: {
  task: LeasedGenerationTask
  context: BuildDocsGenerationContextResponse
}): BuildDocsAgentWorkPacket {
  const schema = input.context.content.schema
  return {
    type: 'task',
    task: {
      taskId: input.task.task_id,
      leaseToken: input.task.lease_token,
      taskType: input.task.document_type,
      targetSummary: input.task.target_summary,
      leaseExpiresAt: input.task.lease_expires_at,
    },
    agentInput: {
      modelHint: { provider: 'claude_code', model: 'haiku', effort: 'low' },
      prompt: promptForDocsContext(input.context),
      outputSchema: jsonSchemaForDraft(schema, input.context),
      context: agentFacingContext(input.context),
      rules: [...schema.output_rules, ...schema.quality_rules],
      forbiddenFields: schema.system_injected_fields,
    },
    submit: {
      command: [
        'platty',
        'docs',
        'tasks',
        'submit',
        '--task-id',
        input.task.task_id,
        '--lease-token',
        input.task.lease_token,
        '--input',
        'result.json',
        '--json',
      ],
    },
  }
}

// Relation facts (build_relations) and service-map facts (build_service_map) are system-owned: Platty
// attaches them to the saved document after validation, the LLM never authors them. Keep them out of the
// agent-facing context so the model reasons only over code chunks + route info. The runtime still holds the
// full context (with these facts) for quality auditing and relation attachment, so this only changes what
// the LLM sees.
function agentFacingContext(context: BuildDocsGenerationContextResponse): BuildDocsGenerationContextResponse {
  const hiddenPages = new Set(['code_relation_facts', 'service_map_facts', 'related_edges'])
  return {
    ...context,
    manifest: {
      ...context.manifest,
      optional_pages: (context.manifest.optional_pages ?? []).filter((page) => !hiddenPages.has(page)),
    },
    content: {
      ...context.content,
      code_relation_facts: [],
      service_map_facts: [],
      related_edges: [],
    },
  }
}

function promptForDocsContext(context: BuildDocsGenerationContextResponse): string {
  const schema = context.content.schema
  const outputFields = Object.keys(propertiesFor(schema.schema_name))
  const repair = context.content.repair
  const repairBlock = repair?.validationErrors?.length
    ? [
        'Repair these validation errors first:',
        JSON.stringify(repair.validationErrors, null, 2),
        'If a validation error mentions source_link_selection, choose ids only from content.source_link_candidates[].candidate_id.',
        '',
      ]
    : []
  return [
    `Generate one Platty ${schema.schema_name} draft JSON object from the provided CLI context.`,
    ...repairBlock,
    outputLanguageInstruction(outputLanguageForContext(context)),
    'Use only agentInput.context. Do not inspect local files, databases, or other artifacts.',
    'Return exactly one JSON object matching agentInput.outputSchema.',
    'Do not include system-owned fields listed in agentInput.forbiddenFields.',
    'Write only source-backed explanation fields. Use [] or {} when exact evidence is unclear.',
    '',
    'Required output fields:',
    outputFields.join(', '),
    '',
    'Output rules:',
    ...schema.output_rules.map((rule) => `- ${rule}`),
    '',
    'Quality rules:',
    ...schema.quality_rules.map((rule) => `- ${rule}`),
  ].join('\n')
}

function outputLanguageForContext(context: BuildDocsGenerationContextResponse): OutputLanguage {
  return context.metadata.outputLanguage === 'ko' ? 'ko' : 'en'
}

function jsonSchemaForDraft(schema: DraftSchemaContext, context: BuildDocsGenerationContextResponse): Record<string, unknown> {
  const properties = propertiesFor(schema.schema_name, context)
  const required = Object.keys(properties)
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  }
}

function propertiesFor(documentType: TechnicalDocumentType, context?: BuildDocsGenerationContextResponse): Record<string, unknown> {
  if (documentType === 'api_spec') {
    const candidateIds = unique((context?.content.source_link_candidates ?? []).map((candidate) => candidate.candidate_id))
    return {
      title: { type: 'string' },
      summary: { type: 'string' },
      access: { type: 'string' },
      flow: arrayOfStrings(),
      rules: arrayOfStrings(),
      source_link_selection: {
        type: 'object',
        additionalProperties: false,
        required: ['access', 'input', 'response'],
        properties: {
          access: arrayOfCandidateIds(candidateIds),
          input: arrayOfCandidateIds(candidateIds),
          response: arrayOfCandidateIds(candidateIds),
        },
      },
    }
  }
  if (documentType === 'screen_spec') {
    return {
      title: { type: 'string' },
      summary: { type: 'string' },
      ascii_ui: { type: 'string' },
      layout: {
        type: 'array',
        items: closedObject({
          name: { type: 'string' },
          type: { type: 'string' },
          fields: arrayOfStrings(),
        }),
      },
      state: {
        type: 'array',
        items: closedObject({
          name: { type: 'string' },
          source: { type: 'string' },
        }),
      },
      flow: arrayOfStrings(),
      rules: arrayOfStrings(),
    }
  }
  if (documentType === 'event_spec') {
    return {
      title: { type: 'string' },
      summary: { type: 'string' },
      payload: { type: 'object' },
      consumers: { type: 'array', items: { type: 'object' } },
    }
  }
  return {
    title: { type: 'string' },
    summary: { type: 'string' },
    trigger: { type: 'object' },
    input: { type: 'object' },
    flow: arrayOfStrings(),
    rules: arrayOfStrings(),
  }
}

function arrayOfStrings(): Record<string, unknown> {
  return { type: 'array', items: { type: 'string' } }
}

function arrayOfCandidateIds(candidateIds: string[]): Record<string, unknown> {
  return {
    type: 'array',
    items: candidateIds.length > 0
      ? { type: 'string', enum: candidateIds }
      : { type: 'string' },
  }
}

function closedObject(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}
