import { describe, expect, it } from 'vitest'
import {
  buildBusinessDocsPromptForTask,
  buildBusinessDocsSchemaForTask,
  shouldThrowBusinessDocsNoProgress,
} from '../../../src/pipeline_modules/build_business_docs_cli/worker_runner.js'
import { normalizeCodexOutputSchema } from '../../../src/pipeline_modules/cli_agent_runner/codex_cli.js'
import type {
  BusinessDocsContextBundleResult,
  BusinessDocsContextPageResult,
  BusinessDocsLeasedTask,
} from '../../../src/pipeline_modules/build_business_docs_cli/types.js'

describe('build_business_docs_cli worker output contract', () => {
  it('requires both canonical content arrays and searchable items for BR tasks', () => {
    const task = leasedTask({
      taskType: 'business_rules',
      documentType: 'br',
    })

    const schema = buildBusinessDocsSchemaForTask(task) as Record<string, unknown>
    const content = readSchemaObject(schema, 'content')

    expect(schema.required).toEqual(expect.arrayContaining(['content', 'items']))
    expect(content.required).toEqual(expect.arrayContaining(['evidence_gaps', 'rules']))
    expect(readSchemaObject(content, 'rules')).toMatchObject({ type: 'array', minItems: 1 })
    expect(readSchemaObject(schema, 'items')).toMatchObject({ type: 'array', minItems: 1 })
  })

  it.each([
    ['business_rules', 'br', ['earsPattern', 'condition', 'rule', 'outcome', 'ownership', 'source_mapping']],
    ['use_case_list', 'ucl', ['sourceClusterIds', 'coverageRelation', 'ownedByEpic', 'primarySourceRefs', 'supportingSourceRefs', 'crossEpicSourceRefs']],
    ['system_design', 'design', ['component', 'responsibility', 'flow', 'integration_points', 'source_mapping', 'relationConfidence']],
  ] as const)('requires quality-gate item content fields for %s tasks', (taskType, documentType, requiredFields) => {
    const task = leasedTask({ taskType, documentType })
    const schema = normalizeCodexOutputSchema(buildBusinessDocsSchemaForTask(task)) as Record<string, unknown>
    const itemContent = readArrayItemContentSchema(schema)

    expect(itemContent.required).toEqual(expect.arrayContaining(requiredFields))
  })

  it('allows data dictionary items to be either modeled entities or explicit missing-model gaps', () => {
    const task = leasedTask({
      taskType: 'data_dictionary',
      documentType: 'data_dictionary',
    })
    const schema = normalizeCodexOutputSchema(buildBusinessDocsSchemaForTask(task)) as Record<string, unknown>
    const itemContent = readArrayItemContentSchema(schema)
    const alternatives = itemContent.anyOf as Array<Record<string, unknown>>

    expect(alternatives).toEqual(expect.arrayContaining([
      expect.objectContaining({
        required: expect.arrayContaining(['entity', 'fields']),
      }),
      expect.objectContaining({
        required: expect.arrayContaining(['gapType', 'message', 'source_mapping']),
      }),
    ]))
  })

  it('requires data dictionary modeled entities to preserve backend storage identity', () => {
    const task = leasedTask({
      taskType: 'data_dictionary',
      documentType: 'data_dictionary',
    })
    const schema = normalizeCodexOutputSchema(buildBusinessDocsSchemaForTask(task)) as Record<string, unknown>
    const itemContent = readArrayItemContentSchema(schema)
    const alternatives = itemContent.anyOf as Array<Record<string, unknown>>
    const entityAlternative = alternatives.find((alternative) =>
      Array.isArray(alternative.required) && alternative.required.includes('entity'))
    const prompt = buildBusinessDocsPromptForTask(task, contextBundle(task), contextPages())

    expect(entityAlternative?.required).toEqual(expect.arrayContaining(['entity', 'storage', 'fields']))
    expect(prompt).toContain('model_evidence')
    expect(prompt).toContain('storage.model_id')
    expect(prompt).toContain('storage.model_name')
    expect(prompt).toContain('storage.table_name')
    expect(prompt).toContain('fields[].model_id')
    expect(prompt).toContain('fields[].column_name')
    expect(prompt).toContain('Do not translate model/table/column identifiers')
  })

  it('names the task-specific canonical content fields in the prompt', () => {
    const task = leasedTask({
      taskType: 'use_case_list_refine',
      documentType: 'ucl',
    })
    const prompt = buildBusinessDocsPromptForTask(task, contextBundle(task), contextPages())

    expect(prompt).toContain('content.use_cases')
    expect(prompt).toContain('items[]')
    expect(prompt).toContain('items[].content')
    expect(prompt).toContain('Avoid raw technical identifiers')
    expect(prompt).toContain('Do not return empty content')
  })

  it('defaults worker prompts to English user-facing natural language', () => {
    const task = leasedTask({
      taskType: 'business_rules',
      documentType: 'br',
    })
    const prompt = buildBusinessDocsPromptForTask(task, contextBundle(task), contextPages())

    expect(prompt).toContain('Write user-facing natural-language values in English.')
    expect(prompt).toContain('Do not translate JSON keys or source identifiers.')
  })

  it('uses Korean prompt instructions when the context target requests Korean', () => {
    const task = leasedTask({
      taskType: 'business_rules',
      documentType: 'br',
    })
    const prompt = buildBusinessDocsPromptForTask(task, contextBundle(task), contextPages('ko'))

    expect(prompt).toContain('Write user-facing natural-language values in Korean.')
  })

  it('compacts project glossary prompts that aggregate large upstream context', () => {
    const task = leasedTask({
      taskType: 'project_glossary',
      documentType: 'glossary',
      scope: 'project',
      scopeId: 'project:1',
      epicId: null,
    })
    const pages = largeProjectGlossaryPages()

    const prompt = buildBusinessDocsPromptForTask(task, contextBundle(task), pages)

    expect(prompt.length).toBeLessThan(1_048_576)
    expect(prompt).toContain('upstream_business_docs')
    expect(prompt).toContain('content.terms')
    expect(prompt).toContain('omittedForPrompt')
    expect(prompt).toContain('termRelationshipHints')
    expect(prompt).not.toContain('"pageToken": "source_document_cards"')
    expect(prompt).not.toContain('"pageToken": "source_graph_projection"')
    expect(prompt).not.toContain('"pageToken": "relation_evidence"')
    expect(prompt).not.toContain('x'.repeat(20_000))
  })

  it('does not treat idle workers as no-progress while other workers hold active leases', () => {
    expect(shouldThrowBusinessDocsNoProgress({
      idlePolls: 101,
      pending: 0,
      activeLeases: 2,
    })).toBe(false)
    expect(shouldThrowBusinessDocsNoProgress({
      idlePolls: 101,
      pending: 1,
      activeLeases: 0,
    })).toBe(true)
  })

  it('does not report no-progress when failed tasks are waiting for explicit retry', () => {
    expect(shouldThrowBusinessDocsNoProgress({
      idlePolls: 101,
      pending: 1,
      activeLeases: 0,
      failed: 1,
    })).toBe(false)
  })
})

function leasedTask(overrides: Partial<BusinessDocsLeasedTask>): BusinessDocsLeasedTask {
  return {
    id: 'task:1',
    runId: 'run:1',
    taskType: 'business_rules',
    documentType: 'br',
    scope: 'epic',
    scopeId: 'epic:orders',
    epicId: 'epic:orders',
    attemptNo: 0,
    leaseToken: 'lease:1',
    leaseExpiresAt: '2026-06-08T00:00:00.000Z',
    contextHandle: 'context:1',
    contextPageTokens: ['target', 'schema'],
    dependsOnTaskIds: [],
    ...overrides,
  }
}

function contextBundle(task: BusinessDocsLeasedTask): BusinessDocsContextBundleResult {
  return {
    run: {
      id: task.runId,
      projectId: 'project:1',
      status: 'running',
    },
    task: {
      id: task.id,
      runId: task.runId,
      status: 'leased',
      taskType: task.taskType,
      documentType: task.documentType,
      scope: task.scope,
      scopeId: task.scopeId,
      attemptNo: task.attemptNo,
      leaseExpiresAt: task.leaseExpiresAt,
      contextHandle: task.contextHandle,
    },
    manifest: {
      runId: task.runId,
      taskId: task.id,
      schemaVersion: 'business-docs-context.v1',
      sourceCommit: 'unknown',
      generatedAt: '2026-06-08T00:00:00.000Z',
      evidenceIdNamespace: `${task.runId}:${task.id}`,
      pageTokens: ['target', 'schema'],
      dependencyTaskIds: [],
      dependencyPagesReady: true,
      deferredPages: [],
    },
    pages: [],
  }
}

function contextPages(outputLanguage?: 'ko' | 'en'): BusinessDocsContextPageResult[] {
  if (!outputLanguage) return []
  return [{
    run: { id: 'run:1', projectId: 'project:1', status: 'running' },
    task: {
      id: 'task:1',
      runId: 'run:1',
      status: 'leased',
      taskType: 'business_rules',
      documentType: 'br',
      scope: 'epic',
      scopeId: 'epic:orders',
      attemptNo: 0,
      leaseExpiresAt: '2026-06-08T00:00:00.000Z',
      contextHandle: 'context:1',
    },
    page: {
      pageToken: 'target',
      pageKind: 'target',
      pageOrder: 0,
      summary: 'target',
      evidenceIds: [],
      contentHash: 'hash',
      content: { outputLanguage },
    },
    manifest: {
      schemaVersion: 'business-docs-context.v1',
      sourceCommit: 'unknown',
      generatedAt: '2026-06-08T00:00:00.000Z',
      evidenceIdNamespace: 'run:1:task:1',
    },
  } as any]
}

function largeProjectGlossaryPages(): BusinessDocsContextPageResult[] {
  const largeText = 'x'.repeat(80_000)
  const dependencies = Array.from({ length: 30 }, (_, index) => ({
    taskId: `task:${index}`,
    taskType: 'epic_glossary',
    documentType: 'glossary',
    status: 'saved',
    savedDocumentId: `doc:${index}`,
    summary: `${largeText}-${index}`,
    document: {
      schemaVersion: 'business-doc.v1',
      documentType: 'glossary',
      scope: 'epic',
      scopeId: `epic:${index}`,
      title: `Glossary ${index}`,
      summary: `${largeText}-${index}`,
      content: {
        evidence_gaps: [largeText],
        terms: Array.from({ length: 12 }, (_, termIndex) => ({
          term: `term ${index}-${termIndex}`,
          canonical_term: `canonical ${index}-${termIndex}`,
          definition: largeText,
          termType: 'domain',
          source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: largeText }],
          aliases: [largeText],
          synonyms: [largeText],
          candidate_aliases: [largeText],
          antonyms: [],
          contrast_terms: [],
          related_terms: [],
          signals: [largeText],
          ambiguity: { status: 'none', candidates: [] },
        })),
      },
      evidenceIds: [],
      items: Array.from({ length: 12 }, (_, itemIndex) => ({
        itemType: 'glossary_term',
        stableKey: `term:${index}:${itemIndex}`,
        ordinal: itemIndex,
        title: `term ${index}-${itemIndex}`,
        summary: largeText,
        content: {
          term: `term ${index}-${itemIndex}`,
          canonical_term: `canonical ${index}-${itemIndex}`,
          definition: largeText,
          termType: 'domain',
          source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: largeText }],
          aliases: [largeText],
          synonyms: [largeText],
          candidate_aliases: [largeText],
          antonyms: [],
          contrast_terms: [],
          related_terms: [],
          signals: [largeText],
          ambiguity: { status: 'none', candidates: [] },
        },
        evidenceIds: [],
      })),
    },
  }))
  const base = {
    run: { id: 'run:1', projectId: 'project:1', status: 'running' },
    task: {
      id: 'task:1',
      runId: 'run:1',
      status: 'leased',
      taskType: 'project_glossary',
      documentType: 'glossary',
      scope: 'project',
      scopeId: 'project:1',
      attemptNo: 0,
      leaseExpiresAt: '2026-06-08T00:00:00.000Z',
      contextHandle: 'context:1',
    },
    page: {
      pageToken: 'upstream_business_docs',
      pageKind: 'upstream_business_docs',
      pageOrder: 20,
      summary: 'Upstream business docs',
      evidenceIds: [],
      contentHash: 'hash',
      content: { dependencies },
    },
    manifest: {
      schemaVersion: 'business-docs-context.v1',
      sourceCommit: 'unknown',
      generatedAt: '2026-06-08T00:00:00.000Z',
      evidenceIdNamespace: 'run:1:task:1',
    },
  } as any
  return [
    base,
    {
      ...base,
      page: {
        pageToken: 'source_document_cards',
        pageKind: 'source_document_cards',
        pageOrder: 2,
        summary: 'Source document cards',
        evidenceIds: [],
        contentHash: 'hash-source',
        content: {
          cards: [{ sourceRef: 'source_document_1', facts: { body: largeText } }],
        },
      },
    } as any,
    {
      ...base,
      page: {
        pageToken: 'source_graph_projection',
        pageKind: 'source_graph_projection',
        pageOrder: 3,
        summary: 'Source graph projection',
        evidenceIds: [],
        contentHash: 'hash-graph',
        content: {
          coverageOutline: {
            clusters: [{ clusterId: 'cluster:large', relationEvidence: [largeText] }],
          },
        },
      },
    } as any,
    {
      ...base,
      page: {
        pageToken: 'relation_evidence',
        pageKind: 'relation_evidence',
        pageOrder: 4,
        summary: 'Relation evidence',
        evidenceIds: [],
        contentHash: 'hash-relation',
        content: {
          relations: [{ detail: largeText }],
        },
      },
    } as any,
  ]
}

function readSchemaObject(schema: Record<string, unknown>, key: string): Record<string, unknown> {
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error('schema has no properties')
  }
  const value = (properties as Record<string, unknown>)[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`schema property ${key} is not an object`)
  }
  return value as Record<string, unknown>
}

function readArrayItemContentSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const itemsSchema = readSchemaObject(schema, 'items')
  const itemSchema = itemsSchema.items
  if (!itemSchema || typeof itemSchema !== 'object' || Array.isArray(itemSchema)) {
    throw new Error('items schema has no object item schema')
  }
  return readSchemaObject(itemSchema as Record<string, unknown>, 'content')
}
