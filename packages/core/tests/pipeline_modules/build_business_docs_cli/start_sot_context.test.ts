import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../server/helpers.js'
import { documents, docRelationLinks } from '../../../src/db/schema/build_docs.js'
import { epicDocumentLinks } from '../../../src/db/schema/build_epics.js'
import { models } from '../../../src/db/schema/build_models.js'
import { epics, projects, repositories } from '../../../src/db/schema/core.js'
import {
  businessDocContextBundles,
  businessDocContextPages,
  businessDocGenerationTasks,
} from '../../../src/db/schema/build_business_docs_generation.js'
import { startBusinessDocsGeneration } from '../../../src/pipeline_modules/build_business_docs_cli/start.js'

const projectId = 'project:platty'
const repoId = 'repo:platty'
const epicId = 'epic:orders'
const now = '2026-06-04T00:00:00.000Z'

type TestDb = ReturnType<typeof createTestDb>

// Realistic source content the worker needs to write a high-quality business doc.
const ORDERS_API_CONTENT = {
  identity: {
    method: 'POST',
    path: '/orders',
    handler: 'OrdersController.createOrder',
  },
  request: {
    body: { customerId: 'string', items: 'OrderItem[]' },
  },
  response: { status: 201, body: { orderId: 'string' } },
  business_rules: ['An order must contain at least one item.'],
  relations: [{ kind: 'db_access', target: 'orders', operation: 'insert' }],
}

describe('build_business_docs_cli start — rich SOT context (Phase A)', () => {
  it('emits real source bodies, model_evidence, source_graph, and systemSourceDocIds', () => {
    const db = createRichRunnableProject()

    startBusinessDocsGeneration(db, {
      projectId,
      now: fixedNow,
      makeId: makeSequentialIds(),
    })

    const designTask = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.taskType, 'system_design'))
      .get()
    expect(designTask).toBeTruthy()

    const pages = db.select().from(businessDocContextPages)
      .where(eq(businessDocContextPages.contextHandle, designTask!.contextHandle!))
      .all()
    const bundle = db.select().from(businessDocContextBundles)
      .where(eq(businessDocContextBundles.contextHandle, designTask!.contextHandle!))
      .get()

    // (a) real source document content/body flows into context (not just metadata type).
    const sourcePage = pages.find((page) => page.pageKind === 'source_document_cards')
    expect(sourcePage).toBeTruthy()
    const sourceText = JSON.stringify(sourcePage!.contentJson)
    expect(sourceText).not.toContain('metadata_only')
    expect(sourceText).toContain('doc:orders-api')
    // key_facts / route projection must surface the real route + business rule.
    expect(sourceText).toContain('/orders')
    expect(sourceText).toContain('An order must contain at least one item.')

    // (b) model_evidence resolved from a db_access relation -> a model.
    const modelPage = pages.find((page) => page.pageKind === 'model_evidence')
    expect(modelPage).toBeTruthy()
    const modelText = JSON.stringify(modelPage!.contentJson)
    expect(modelText).toContain('Order')
    expect(modelText).toContain('orders')
    expect(modelText).toContain('doc:orders-api')

    // (c) the source graph is present.
    const graphPage = pages.find((page) => page.pageKind === 'source_graph_projection')
    expect(graphPage).toBeTruthy()
    const graphText = JSON.stringify(graphPage!.contentJson)
    expect(graphText).toContain('doc:orders-api')

    // (d) systemSourceDocIds persisted so submit can recover it later (Phases B/C).
    const systemSourceDocIds = readSystemSourceDocIds(pages, bundle?.manifestJson)
    expect(systemSourceDocIds).toEqual(['doc:orders-api'])

    // evidence ids must stay in the task's evidence namespace.
    expect(sourcePage!.evidenceIdsJson.length).toBeGreaterThan(0)
    expect(sourcePage!.evidenceIdsJson.every((id) =>
      id.startsWith(`${bundle?.manifestJson.evidenceIdNamespace}:`))).toBe(true)
  })
})

function readSystemSourceDocIds(
  pages: Array<{ pageKind: string; contentJson: Record<string, unknown> }>,
  manifest: Record<string, unknown> | undefined,
): string[] | undefined {
  if (manifest && Array.isArray((manifest as Record<string, unknown>).systemSourceDocIds)) {
    return (manifest as Record<string, unknown>).systemSourceDocIds as string[]
  }
  for (const page of pages) {
    const ids = (page.contentJson as Record<string, unknown>).systemSourceDocIds
    if (Array.isArray(ids)) return ids as string[]
  }
  return undefined
}

function createRichRunnableProject(): TestDb {
  const db = createTestDb()
  seedProject(db)
  seedRepository(db)
  seedEpic(db, epicId)
  seedSourceDocument(db, {
    id: 'doc:orders-api',
    type: 'api_spec',
    summary: 'Create an order',
    content: ORDERS_API_CONTENT,
  })
  linkEpicDocument(db, { epicId, documentId: 'doc:orders-api', documentType: 'api_spec' })
  // db_access relation: api_spec document -> orders table.
  db.insert(docRelationLinks).values({
    documentId: 'doc:orders-api',
    repoId,
    sourceNodeId: 'node:orders-controller',
    kind: 'db_access',
    target: 'orders',
    operation: 'insert',
    canonicalTarget: 'orders',
    payloadJson: { table: 'orders' },
    evidenceNodeIdsJson: ['node:orders-controller'],
    confidence: 'high',
    createdAt: now,
  }).run()
  // model whose table matches the db_access canonical target.
  db.insert(models).values({
    id: `${repoId}:Order`,
    repositoryId: repoId,
    name: 'Order',
    tableName: 'orders',
    fields: [
      { name: 'id', type: 'String', nullable: false, primary: true, unique: true, line: 1 },
      { name: 'customerId', type: 'String', nullable: false, primary: false, unique: false, line: 2 },
    ],
    relations: [],
    orm: 'prisma',
    validity: 'fresh',
    createdAt: now,
    updatedAt: now,
  }).run()
  return db
}

function fixedNow(): Date {
  return new Date(now)
}

function makeSequentialIds(): () => string {
  let next = 0
  return () => `id:${++next}`
}

function seedProject(db: TestDb): void {
  db.insert(projects).values({
    id: projectId,
    name: 'Platty',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedRepository(db: TestDb): void {
  db.insert(repositories).values({
    id: repoId,
    projectId,
    name: 'platty',
    repoPath: '/tmp/platty',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedEpic(db: TestDb, id: string): void {
  db.insert(epics).values({
    id,
    projectId,
    name: id.replace('epic:', ''),
    abbr: 'EP',
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: now,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedSourceDocument(
  db: TestDb,
  input: {
    id: string
    type: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
    summary?: string
    content?: Record<string, unknown>
  },
): void {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: 'technical',
    scope: input.type,
    scopeId: input.id,
    status: 'active',
    validity: 'fresh',
    summary: input.summary ?? input.id,
    content: input.content ?? { id: input.id },
    rawLlmOutput: '',
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function linkEpicDocument(
  db: TestDb,
  input: { epicId: string; documentId: string; documentType: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec' },
): void {
  db.insert(epicDocumentLinks).values({
    epicId: input.epicId,
    documentId: input.documentId,
    documentType: input.documentType,
    role: 'primary',
    reason: 'test link',
    confidence: 'high',
    createdAt: now,
  }).run()
}
