import type { TechnicalDocumentType } from '@/db/schema/build_docs.js'
import type {
  BuildDocsGenerationContextResponse,
  DraftSchemaContext,
  LeasedGenerationTask,
  LeaseTaskResult,
} from './types.js'

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
      outputSchema: jsonSchemaForDraft(schema),
      context: input.context,
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

function promptForDocsContext(context: BuildDocsGenerationContextResponse): string {
  const schema = context.content.schema
  const outputFields = Object.keys(propertiesFor(schema.schema_name))
  return [
    `Generate one Platty ${schema.schema_name} draft JSON object from the provided CLI context.`,
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

function jsonSchemaForDraft(schema: DraftSchemaContext): Record<string, unknown> {
  const properties = propertiesFor(schema.schema_name)
  const required = Object.keys(properties)
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  }
}

function propertiesFor(documentType: TechnicalDocumentType): Record<string, unknown> {
  if (documentType === 'api_spec') {
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
          access: arrayOfStrings(),
          input: arrayOfStrings(),
          response: arrayOfStrings(),
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

function closedObject(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  }
}
