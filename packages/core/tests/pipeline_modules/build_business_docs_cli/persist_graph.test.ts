import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../server/helpers.js'
import {
  documentItemDocumentLinks,
  documentItems,
  documentLinks,
  documentVersions,
  documents,
} from '../../../src/db/schema/build_docs.js'
import { projects } from '../../../src/db/schema/core.js'
import {
  appendVersion,
  linkedDocumentIds,
  replaceDocumentItemSatellites,
  replaceDocumentLinks,
} from '../../../src/pipeline_modules/build_business_docs_cli/sot/persist_graph.js'
import type { BusinessDocument } from '../../../src/pipeline_modules/build_business_docs_cli/sot/types.js'

const projectId = 'project:platty'
const now = '2026-06-04T00:00:00.000Z'

type TestDb = ReturnType<typeof createTestDb>

describe('build_business_docs_cli sot/persist_graph', () => {
  it('appendVersion inserts +1 and skips a no-op when content is unchanged', () => {
    const db = seeded()
    const docId = seedBusinessDoc(db, 'doc:br:orders')

    appendVersion(db, docId, { a: 1 }, 'first', 'run:1', 'commit:1')
    appendVersion(db, docId, { a: 1 }, 'first again', 'run:2', 'commit:2') // unchanged => skip
    appendVersion(db, docId, { a: 2 }, 'second', 'run:3', 'commit:3') // changed => bump

    const versions = db.select().from(documentVersions)
      .where(eq(documentVersions.documentId, docId))
      .all()
    expect(versions.map((row) => row.versionNo).sort()).toEqual([1, 2])
    const latest = versions.find((row) => row.versionNo === 2)
    expect(latest?.content).toEqual({ a: 2 })
  })

  it('replaceDocumentLinks emits derives_from edges to existing source docs only and is idempotent', () => {
    const db = seeded()
    const docId = seedBusinessDoc(db, 'doc:br:orders')
    seedSourceDoc(db, 'doc:orders-api')
    const document = { type: 'br', source_doc_ids: [] } as unknown as BusinessDocument

    replaceDocumentLinks(db, docId, document, ['doc:orders-api', 'doc:missing'])
    replaceDocumentLinks(db, docId, document, ['doc:orders-api', 'doc:missing'])

    const links = db.select().from(documentLinks)
      .where(eq(documentLinks.fromDocumentId, docId))
      .all()
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      toDocumentId: 'doc:orders-api',
      linkType: 'derives_from',
      createdBy: 'system',
    })
  })

  it('replaceDocumentItemSatellites links each item to source docs + indexes FTS, idempotently', () => {
    const db = seeded()
    const docId = seedBusinessDoc(db, 'doc:br:orders')
    seedSourceDoc(db, 'doc:orders-api')
    seedItem(db, { id: 'item:a', documentId: docId, itemType: 'br_rule', stableKey: 'rule:a', title: 'Payment rule' })
    seedItem(db, { id: 'item:b', documentId: docId, itemType: 'br_rule', stableKey: 'rule:b', title: 'Fulfillment rule' })

    replaceDocumentItemSatellites(db, docId, projectId, ['doc:orders-api'])
    replaceDocumentItemSatellites(db, docId, projectId, ['doc:orders-api'])

    const itemLinks = db.select().from(documentItemDocumentLinks).all()
    expect(itemLinks).toHaveLength(2)
    expect(itemLinks.every((row) => row.linkType === 'derives_from' && row.role === 'supporting')).toBe(true)
    expect(itemLinks.map((row) => row.fromItemId).sort()).toEqual(['item:a', 'item:b'])
    expect(itemLinks.every((row) => row.toDocumentId === 'doc:orders-api')).toBe(true)

    const ftsRows = db.all(sql`SELECT item_id FROM document_items_fts WHERE project_id = ${projectId}`) as Array<{ item_id: string }>
    expect(ftsRows.map((row) => row.item_id).sort()).toEqual(['item:a', 'item:b'])
    const hit = db.all(sql`SELECT item_id FROM document_items_fts WHERE document_items_fts MATCH ${'fulfillment'}`) as Array<{ item_id: string }>
    expect(hit.map((row) => row.item_id)).toEqual(['item:b'])
  })

  it('linkedDocumentIds prefers systemSourceDocIds, else falls back to source_doc_ids + non-model refs', () => {
    expect(linkedDocumentIds({ type: 'br', source_doc_ids: ['doc:x'] } as unknown as BusinessDocument, ['doc:sys'])).toEqual(['doc:sys'])
    expect(linkedDocumentIds({ type: 'br', source_doc_ids: ['doc:b', 'doc:a'] } as unknown as BusinessDocument, [])).toEqual(['doc:a', 'doc:b'])
    const dd = {
      type: 'data_dictionary',
      source_doc_ids: ['doc:a'],
      entities: [{ source_refs: ['doc:c', 'model:Orders'] }],
    } as unknown as BusinessDocument
    expect(linkedDocumentIds(dd, [])).toEqual(['doc:a', 'doc:c'])
  })
})

function seeded(): TestDb {
  const db = createTestDb()
  db.insert(projects).values({ id: projectId, name: 'Platty', createdAt: now, updatedAt: now }).run()
  return db
}

function seedBusinessDoc(db: TestDb, id: string): string {
  db.insert(documents).values({
    id,
    projectId,
    type: 'br',
    track: 'business',
    scope: 'epic',
    scopeId: 'epic:orders',
    status: 'active',
    validity: 'fresh',
    summary: id,
    content: { id },
    rawLlmOutput: '',
    contentHash: `hash:${id}`,
    updatedBy: 'llm',
    updatedAt: now,
  }).run()
  return id
}

function seedSourceDoc(db: TestDb, id: string): void {
  db.insert(documents).values({
    id,
    projectId,
    type: 'api_spec',
    track: 'technical',
    scope: 'api_spec',
    scopeId: id,
    status: 'active',
    validity: 'fresh',
    summary: id,
    content: { id },
    rawLlmOutput: '',
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function seedItem(
  db: TestDb,
  input: { id: string; documentId: string; itemType: string; stableKey: string; title: string },
): void {
  db.insert(documentItems).values({
    id: input.id,
    documentId: input.documentId,
    projectId,
    itemType: input.itemType,
    stableKey: input.stableKey,
    ordinal: 1,
    title: input.title,
    summary: `${input.title} summary`,
    content: { stableKey: input.stableKey },
    contentHash: `hash:${input.stableKey}`,
    status: 'active',
    createdBy: 'llm',
    updatedBy: 'llm',
    updatedAt: now,
  }).run()
}
