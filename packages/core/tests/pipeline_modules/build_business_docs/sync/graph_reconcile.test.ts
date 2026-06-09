import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { documentItemDocumentLinks, documentItemItemLinks, documentItemRelationLinks, documentItems, documentLinkEvidence, documentLinks, documents } from '../../../../src/db/schema/build_docs.js'
import { epicDocumentLinks } from '../../../../src/db/schema/build_epics.js'
import { epics, projects } from '../../../../src/db/schema/core.js'
import {
  checkBusinessDocGraphInvariants,
  cleanupOrphanedBusinessDocumentGraph,
  cleanupStaleBusinessDocumentSourceLinks,
} from '../../../../src/pipeline_modules/build_business_docs/sync/graph_reconcile.js'
import { createTestDb } from '../../../server/helpers.js'

const projectId = 'project:platty'
const now = '2026-06-09T00:00:00.000Z'

type TestDb = ReturnType<typeof createTestDb>

describe('business docs graph reconcile', () => {
  it('detaches searchable graph for orphaned business documents', () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, 'epic:old')
    seedTechnicalDoc(db, 'doc:api')
    seedBusinessDoc(db, 'doc:business', 'epic:old')
    seedBusinessItem(db, 'item:business', 'doc:business')
    seedBusinessItem(db, 'item:related', 'doc:business')

    db.insert(documentLinks).values({
      fromDocumentId: 'doc:business',
      toDocumentId: 'doc:api',
      linkType: 'derives_from',
      createdBy: 'system',
    }).run()
    db.insert(documentLinkEvidence).values({
      projectId,
      fromDocumentId: 'doc:business',
      toDocumentId: 'doc:api',
      linkType: 'derives_from',
      sourceEdgeId: 'edge:1',
      repoId: 'repo:1',
      confidence: 'high',
      source: 'test',
      reason: 'test edge',
      createdBy: 'test',
    }).run()
    db.insert(documentItemDocumentLinks).values({
      fromItemId: 'item:business',
      toDocumentId: 'doc:api',
      linkType: 'derives_from',
      role: 'primary',
      createdBy: 'system',
    }).run()
    db.insert(documentItemItemLinks).values({
      fromItemId: 'item:business',
      toItemId: 'item:related',
      linkType: 'supports',
      role: 'supporting',
      createdBy: 'system',
    }).run()
    db.insert(documentItemRelationLinks).values({
      id: 'relation-link:1',
      itemId: 'item:business',
      relationKey: 'relation:test',
      repoId: 'repo:1',
      sourceNodeId: 'node:1',
      kind: 'calls',
      evidenceNodeIdsJson: [],
      confidence: 'high',
    }).run()
    db.insert(epicDocumentLinks).values({
      epicId: 'epic:old',
      documentId: 'doc:business',
      documentType: 'br',
      role: 'primary',
      reason: 'test',
      confidence: 'high',
    }).run()
    db.run(sql`
      INSERT INTO document_items_fts (item_id, project_id, item_type, title, summary, content)
      VALUES ('item:business', ${projectId}, 'business_rule', 'Rule', 'Summary', '{}')
    `)

    cleanupOrphanedBusinessDocumentGraph(db, {
      projectId,
      documentIds: ['doc:business'],
      now,
    })

    expect(db.select().from(documentItems).all().map((item) => item.status)).toEqual(['stale', 'stale'])
    expect(db.select().from(documentLinks).all()).toEqual([])
    expect(db.select().from(documentLinkEvidence).all()).toEqual([])
    expect(db.select().from(documentItemDocumentLinks).all()).toEqual([])
    expect(db.select().from(documentItemItemLinks).all()).toEqual([])
    expect(db.select().from(documentItemRelationLinks).all()).toEqual([])
    expect(db.select().from(epicDocumentLinks).all()).toEqual([])
    expect(db.all(sql`SELECT * FROM document_items_fts WHERE item_id = 'item:business'`)).toEqual([])
  })

  it('reports active items under deleted business documents', () => {
    const db = createTestDb()
    seedProject(db)
    seedBusinessDoc(db, 'doc:business', 'epic:old', { status: 'deleted', validity: 'orphaned' })
    seedBusinessItem(db, 'item:business', 'doc:business')

    const result = checkBusinessDocGraphInvariants(db, { projectId })

    expect(result.violations).toContainEqual(expect.objectContaining({
      code: 'ACTIVE_ITEM_UNDER_ORPHANED_BUSINESS_DOC',
      documentId: 'doc:business',
      itemId: 'item:business',
    }))
  })

  it('detaches stale business document links to deleted source documents', () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, 'epic:orders')
    seedTechnicalDoc(db, 'doc:deleted-api', { status: 'deleted', validity: 'orphaned' })
    seedBusinessDoc(db, 'doc:orders-br', 'epic:orders', { validity: 'stale' })
    seedBusinessItem(db, 'item:orders-rule', 'doc:orders-br')

    db.insert(documentLinks).values({
      fromDocumentId: 'doc:orders-br',
      toDocumentId: 'doc:deleted-api',
      linkType: 'derives_from',
      createdBy: 'system',
    }).run()
    db.insert(documentLinkEvidence).values({
      projectId,
      fromDocumentId: 'doc:orders-br',
      toDocumentId: 'doc:deleted-api',
      linkType: 'derives_from',
      sourceEdgeId: 'edge:deleted',
      repoId: 'repo:1',
      confidence: 'high',
      source: 'test',
      reason: 'deleted source',
      createdBy: 'test',
    }).run()
    db.insert(documentItemDocumentLinks).values({
      fromItemId: 'item:orders-rule',
      toDocumentId: 'doc:deleted-api',
      linkType: 'derives_from',
      role: 'primary',
      createdBy: 'system',
    }).run()

    cleanupStaleBusinessDocumentSourceLinks(db, {
      projectId,
      documentIds: ['doc:orders-br'],
    })

    expect(db.select().from(documentItems).where(eq(documentItems.id, 'item:orders-rule')).get()).toMatchObject({
      status: 'active',
    })
    expect(db.select().from(documentLinks).all()).toEqual([])
    expect(db.select().from(documentLinkEvidence).all()).toEqual([])
    expect(db.select().from(documentItemDocumentLinks).all()).toEqual([])
  })

  it('reports FTS rows under orphaned business documents and item links to deleted source documents', () => {
    const db = createTestDb()
    seedProject(db)
    seedTechnicalDoc(db, 'doc:deleted-api', { status: 'deleted', validity: 'orphaned' })
    seedBusinessDoc(db, 'doc:deleted-br', 'epic:old', { status: 'deleted', validity: 'orphaned' })
    seedBusinessDoc(db, 'doc:active-br', 'epic:orders')
    seedBusinessItem(db, 'item:deleted-rule', 'doc:deleted-br')
    seedBusinessItem(db, 'item:active-rule', 'doc:active-br')
    db.update(documentItems)
      .set({ status: 'stale' })
      .where(eq(documentItems.id, 'item:deleted-rule'))
      .run()
    db.insert(documentItemDocumentLinks).values({
      fromItemId: 'item:active-rule',
      toDocumentId: 'doc:deleted-api',
      linkType: 'derives_from',
      role: 'primary',
      createdBy: 'system',
    }).run()
    db.run(sql`
      INSERT INTO document_items_fts (item_id, project_id, item_type, title, summary, content)
      VALUES ('item:deleted-rule', ${projectId}, 'business_rule', 'Deleted rule', 'Deleted summary', '{}')
    `)

    const result = checkBusinessDocGraphInvariants(db, { projectId })

    expect(result.violations).toContainEqual(expect.objectContaining({
      code: 'FTS_ROW_UNDER_ORPHANED_BUSINESS_DOC',
      documentId: 'doc:deleted-br',
      itemId: 'item:deleted-rule',
    }))
    expect(result.violations).toContainEqual(expect.objectContaining({
      code: 'ACTIVE_ITEM_LINK_TO_ORPHANED_SOURCE_DOC',
      documentId: 'doc:active-br',
      itemId: 'item:active-rule',
      linkedDocumentId: 'doc:deleted-api',
    }))
  })
})

function seedProject(db: TestDb): void {
  db.insert(projects).values({
    id: projectId,
    name: 'Platty',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedEpic(db: TestDb, id: string): void {
  db.insert(epics).values({
    id,
    projectId,
    name: id,
    abbr: 'EP',
    stableKey: id,
    summary: id,
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: now,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedTechnicalDoc(
  db: TestDb,
  id: string,
  overrides: { status?: string; validity?: string } = {},
): void {
  db.insert(documents).values({
    id,
    projectId,
    type: 'api_spec',
    track: 'technical',
    scope: 'api_spec',
    scopeId: id,
    status: overrides.status ?? 'passed',
    validity: overrides.validity ?? 'fresh',
    summary: id,
    content: { id },
    rawLlmOutput: '',
    contentHash: `${id}:content`,
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function seedBusinessDoc(
  db: TestDb,
  id: string,
  scopeId: string,
  overrides: { status?: string; validity?: string } = {},
): void {
  db.insert(documents).values({
    id,
    projectId,
    type: 'br',
    track: 'business',
    scope: 'epic',
    scopeId,
    status: overrides.status ?? 'active',
    validity: overrides.validity ?? 'fresh',
    summary: id,
    content: { id },
    rawLlmOutput: '',
    contentHash: `${id}:content`,
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function seedBusinessItem(db: TestDb, id: string, documentId: string): void {
  db.insert(documentItems).values({
    id,
    documentId,
    projectId,
    itemType: 'business_rule',
    stableKey: id,
    ordinal: 1,
    title: id,
    summary: id,
    content: { source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'test' }] },
    contentHash: `${id}:hash`,
    status: 'active',
    createdBy: 'system',
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}
