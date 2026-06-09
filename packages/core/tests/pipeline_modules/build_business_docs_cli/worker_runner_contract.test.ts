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

function contextPages(): BusinessDocsContextPageResult[] {
  return []
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
