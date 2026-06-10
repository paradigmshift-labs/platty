import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../server/helpers.js'
import {
  docRelationLinks,
  documentItemDocumentLinks,
  documentItemModelLinks,
  documentItemRelationLinks,
  documentItems,
  documents,
} from '../../../src/db/schema/build_docs.js'
import { models } from '../../../src/db/schema/build_models.js'
import { projects, repositories } from '../../../src/db/schema/core.js'
import {
  materializeBusinessDocumentGraph,
  materializeDocumentItemModelLinks,
  parseEpicIdFromScopeId,
} from '../../../src/pipeline_modules/build_business_docs_cli/sot/materialize_business_graph.js'

const projectId = 'project:platty'
const repoId = 'repo:app'
const now = '2026-06-04T00:00:00.000Z'

type TestDb = ReturnType<typeof createTestDb>

describe('build_business_docs_cli sot/materialize_business_graph', () => {
  it('materializes DD item links to matching model and field evidence', () => {
    const db = seeded()
    seedDataDictionaryItem(db)
    db.insert(models).values({
      id: `${repoId}:Order`,
      repositoryId: repoId,
      name: 'Order',
      tableName: 'orders',
      fields: [
        { name: 'id', type: 'String', nullable: false, primary: true, unique: true, line: 1 },
      ],
      relations: [],
      orm: 'prisma',
      validity: 'fresh',
      createdAt: now,
      updatedAt: now,
    }).run()

    const result = materializeDocumentItemModelLinks(db, { projectId, documentId: 'doc:dd:orders' })

    const links = db.select().from(documentItemModelLinks)
      .where(eq(documentItemModelLinks.itemId, 'item:dd:order'))
      .all()
    expect(result).toEqual({ deletedLinks: 0, createdLinks: 2 })
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        projectId,
        itemId: 'item:dd:order',
        modelId: `${repoId}:Order`,
        fieldName: null,
        linkType: 'describes_model',
        role: 'primary',
        createdBy: 'business_graph_materializer_v1',
      }),
      expect.objectContaining({
        projectId,
        itemId: 'item:dd:order',
        modelId: `${repoId}:Order`,
        fieldName: 'id',
        linkType: 'describes_field',
        role: 'supporting',
        createdBy: 'business_graph_materializer_v1',
      }),
    ]))
  })

  it('materializes UCL item to UCS document links idempotently', () => {
    const db = seeded()
    seedUseCaseListItem(db)
    seedUseCaseSpecDocument(db)
    seedDataDictionaryItem(db)
    seedOrderModel(db)

    const first = materializeBusinessDocumentGraph(db, { projectId, epicId: 'epic:orders' })
    const second = materializeBusinessDocumentGraph(db, { projectId, epicId: 'epic:orders' })

    const itemDocumentLinks = db.select().from(documentItemDocumentLinks)
      .where(eq(documentItemDocumentLinks.fromItemId, 'item:ucl:create-order'))
      .all()
    const modelLinks = db.select().from(documentItemModelLinks)
      .where(eq(documentItemModelLinks.itemId, 'item:dd:order'))
      .all()
    expect(first.createdLinks).toBe(1)
    expect(first.createdModelLinks).toBe(2)
    expect(second.createdLinks).toBe(1)
    expect(second.deletedLinks).toBe(1)
    expect(second.createdModelLinks).toBe(2)
    expect(second.deletedModelLinks).toBe(2)
    expect(itemDocumentLinks).toEqual([
      expect.objectContaining({
        fromItemId: 'item:ucl:create-order',
        toDocumentId: 'doc:ucs:create-order',
        linkType: 'expands_use_case',
        role: 'primary',
        createdBy: 'business_graph_materializer_v1',
      }),
    ])
    expect(modelLinks).toHaveLength(2)
  })

  it('backfills DD model links even when no UCL items exist', () => {
    const db = seeded()
    seedDataDictionaryItem(db)
    seedOrderModel(db)

    const result = materializeBusinessDocumentGraph(db, { projectId, epicId: 'epic:orders' })

    const links = db.select().from(documentItemModelLinks)
      .where(eq(documentItemModelLinks.itemId, 'item:dd:order'))
      .all()
    expect(result.createdLinks).toBe(0)
    expect(result.createdModelLinks).toBe(2)
    expect(links).toHaveLength(2)
  })

  it('materializes DD model links from explicit storage model identity when the entity title is business-language', () => {
    const db = seeded()
    seedStoreCurationModel(db)
    seedDataDictionaryItem(db, {
      id: 'item:dd:store-curation',
      title: '기획전',
      content: {
        entity: '기획전',
        storage: {
          kind: 'model',
          model_id: `${repoId}:StoreCuration`,
          model_name: 'StoreCuration',
          table_name: 'StoreCuration',
        },
        fields: [
          {
            name: '기획전 ID',
            column_name: 'id',
            model_id: `${repoId}:StoreCuration`,
          },
        ],
      },
    })

    const result = materializeDocumentItemModelLinks(db, { projectId, documentId: 'doc:dd:orders' })

    const links = db.select().from(documentItemModelLinks)
      .where(eq(documentItemModelLinks.itemId, 'item:dd:store-curation'))
      .all()
    expect(result.createdLinks).toBe(2)
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modelId: `${repoId}:StoreCuration`,
        fieldName: null,
        linkType: 'describes_model',
        role: 'primary',
      }),
      expect.objectContaining({
        modelId: `${repoId}:StoreCuration`,
        fieldName: 'id',
        linkType: 'describes_field',
        role: 'supporting',
      }),
    ]))
  })

  it('uses DD source db_access evidence as model and relation fallback', () => {
    const db = seeded()
    seedApiSourceDocument(db)
    seedStoreCurationModel(db)
    seedDataDictionaryItem(db, {
      id: 'item:dd:store-curation',
      title: '기획전',
      content: {
        entity: '기획전',
        fields: [
          {
            name: '기획전 ID',
            meaning: '기획전을 식별합니다.',
            source_mapping: ['source_document_1'],
          },
        ],
      },
    })
    db.insert(documentItemDocumentLinks).values({
      fromItemId: 'item:dd:store-curation',
      toDocumentId: 'doc:api:store-curation',
      linkType: 'source_document',
      role: 'primary',
      createdBy: 'system',
    }).run()
    db.insert(docRelationLinks).values({
      documentId: 'doc:api:store-curation',
      relationId: null,
      repoId,
      sourceNodeId: 'node:store-curation-controller',
      kind: 'db_access',
      target: 'StoreCuration',
      operation: 'select',
      canonicalTarget: 'db:StoreCuration:select',
      payloadJson: { model: 'StoreCuration' },
      evidenceNodeIdsJson: ['node:store-curation-service'],
      confidence: 'high',
      createdAt: now,
    }).run()

    const result = materializeDocumentItemModelLinks(db, { projectId, documentId: 'doc:dd:orders' })

    const modelLinks = db.select().from(documentItemModelLinks)
      .where(eq(documentItemModelLinks.itemId, 'item:dd:store-curation'))
      .all()
    const relationLinks = db.select().from(documentItemRelationLinks)
      .where(eq(documentItemRelationLinks.itemId, 'item:dd:store-curation'))
      .all()
    expect(result.createdLinks).toBe(1)
    expect(result.createdRelationLinks).toBe(1)
    expect(modelLinks).toEqual([
      expect.objectContaining({
        modelId: `${repoId}:StoreCuration`,
        fieldName: null,
        linkType: 'uses_model',
        role: 'supporting',
      }),
    ])
    expect(relationLinks).toEqual([
      expect.objectContaining({
        itemId: 'item:dd:store-curation',
        repoId,
        sourceNodeId: 'node:store-curation-controller',
        kind: 'db_access',
        target: 'StoreCuration',
        operation: 'select',
        canonicalTarget: 'db:StoreCuration:select',
        confidence: 'high',
      }),
    ])
  })

  it('does not link stale UCS documents', () => {
    const db = seeded()
    seedUseCaseListItem(db)
    seedUseCaseSpecDocument(db, { validity: 'stale' })

    const result = materializeBusinessDocumentGraph(db, { projectId, epicId: 'epic:orders' })

    const links = db.select().from(documentItemDocumentLinks)
      .where(eq(documentItemDocumentLinks.fromItemId, 'item:ucl:create-order'))
      .all()
    expect(result.createdLinks).toBe(0)
    expect(links).toHaveLength(0)
  })

  it('does not match via title containment when stableKey does not match', () => {
    const db = seeded()
    seedUseCaseListItem(db, { stableKey: 'uc:cancel-order', useCaseId: 'uc:cancel-order', title: 'Cancel order' })
    seedUseCaseSpecDocument(db)

    const result = materializeBusinessDocumentGraph(db, { projectId, epicId: 'epic:orders' })

    expect(result.createdLinks).toBe(0)
  })

  it('preserves existing non-materializer item document links', () => {
    const db = seeded()
    seedUseCaseListItem(db)
    seedUseCaseSpecDocument(db)
    seedApiSourceDocument(db)
    db.insert(documentItemDocumentLinks).values({
      fromItemId: 'item:ucl:create-order',
      toDocumentId: 'doc:api:store-curation',
      linkType: 'derives_from',
      role: 'supporting',
      createdBy: 'system',
    }).run()

    materializeBusinessDocumentGraph(db, { projectId, epicId: 'epic:orders' })

    const links = db.select().from(documentItemDocumentLinks)
      .where(eq(documentItemDocumentLinks.fromItemId, 'item:ucl:create-order'))
      .all()
    expect(links).toHaveLength(2)
    expect(links.map((l) => l.linkType).sort()).toEqual(['derives_from', 'expands_use_case'])
  })

  describe('parseEpicIdFromScopeId', () => {
    it('extracts epicId from UCS scopeId', () => {
      expect(parseEpicIdFromScopeId('epic:1bp3xui3ji7-BWv1cEcFh:use_case:ucl:cluster:store')).toBe('1bp3xui3ji7-BWv1cEcFh')
    })
    it('extracts epic:xxx style epicId', () => {
      expect(parseEpicIdFromScopeId('epic:epic:orders:use_case:uc:create-order')).toBe('epic:orders')
    })
    it('returns null for non-UCS scopeId', () => {
      expect(parseEpicIdFromScopeId('epic:orders')).toBeNull()
      expect(parseEpicIdFromScopeId(null)).toBeNull()
    })
  })
})

function seeded(): TestDb {
  const db = createTestDb()
  db.insert(projects).values({ id: projectId, name: 'Platty', createdAt: now, updatedAt: now }).run()
  db.insert(repositories).values({
    id: repoId,
    projectId,
    name: 'app',
    repoPath: '/repo/app',
    analysisBranch: 'main',
    createdAt: now,
    updatedAt: now,
  }).run()
  return db
}

function seedDataDictionaryItem(
  db: TestDb,
  item: {
    id?: string
    title?: string
    content?: Record<string, unknown>
  } = {},
): void {
  const itemId = item.id ?? 'item:dd:order'
  const title = item.title ?? 'Order'
  const content = item.content ?? {
    entity: 'Order',
    table_name: 'orders',
    source_refs: ['model:Order'],
    fields: [
      {
        name: 'id',
        column_name: 'id',
        source_refs: ['model:Order'],
      },
    ],
  }
  db.insert(documents).values({
    id: 'doc:dd:orders',
    projectId,
    type: 'data_dictionary',
    track: 'business',
    scope: 'epic',
    scopeId: 'epic:orders',
    status: 'active',
    validity: 'fresh',
    summary: 'Order data dictionary',
    content: { id: 'doc:dd:orders' },
    rawLlmOutput: '',
    updatedBy: 'llm',
    updatedAt: now,
  }).run()
  db.insert(documentItems).values({
    id: itemId,
    documentId: 'doc:dd:orders',
    projectId,
    itemType: 'data_entity',
    stableKey: itemId,
    ordinal: 1,
    title,
    summary: `${title} model.`,
    content,
    contentHash: `hash:${itemId}`,
    status: 'active',
    createdBy: 'llm',
    updatedBy: 'llm',
    updatedAt: now,
  }).run()
}

function seedOrderModel(db: TestDb): void {
  db.insert(models).values({
    id: `${repoId}:Order`,
    repositoryId: repoId,
    name: 'Order',
    tableName: 'orders',
    fields: [
      { name: 'id', type: 'String', nullable: false, primary: true, unique: true, line: 1 },
    ],
    relations: [],
    orm: 'prisma',
    validity: 'fresh',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedStoreCurationModel(db: TestDb): void {
  db.insert(models).values({
    id: `${repoId}:StoreCuration`,
    repositoryId: repoId,
    name: 'StoreCuration',
    tableName: 'StoreCuration',
    fields: [
      { name: 'id', type: 'String', nullable: false, primary: true, unique: true, line: 1 },
      { name: 'title', type: 'String', nullable: false, primary: false, unique: false, line: 2 },
    ],
    relations: [],
    orm: 'prisma',
    validity: 'fresh',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedApiSourceDocument(db: TestDb): void {
  db.insert(documents).values({
    id: 'doc:api:store-curation',
    projectId,
    type: 'api_spec',
    track: 'technical',
    scope: 'route',
    scopeId: 'repo:app:nestjs:api:GET:/api/store-curation',
    status: 'passed',
    validity: 'fresh',
    summary: 'Store curation API',
    content: { method: 'GET', path: '/api/store-curation' },
    rawLlmOutput: '',
    updatedBy: 'llm',
    updatedAt: now,
  }).run()
}

function seedUseCaseListItem(
  db: TestDb,
  item: { stableKey?: string; useCaseId?: string; title?: string } = {},
): void {
  const stableKey = item.stableKey ?? 'uc:create-order'
  const useCaseId = item.useCaseId ?? 'uc:create-order'
  const title = item.title ?? 'Create order'
  db.insert(documents).values({
    id: 'doc:ucl:orders',
    projectId,
    type: 'ucl',
    track: 'business',
    scope: 'epic',
    scopeId: 'epic:orders',
    status: 'active',
    validity: 'fresh',
    summary: 'Order use cases',
    content: { use_cases: [] },
    rawLlmOutput: '',
    updatedBy: 'llm',
    updatedAt: now,
  }).run()
  db.insert(documentItems).values({
    id: 'item:ucl:create-order',
    documentId: 'doc:ucl:orders',
    projectId,
    itemType: 'use_case',
    stableKey,
    ordinal: 1,
    title,
    summary: `${title}.`,
    content: { use_case_id: useCaseId, title },
    contentHash: `hash:${stableKey}`,
    status: 'active',
    createdBy: 'llm',
    updatedBy: 'llm',
    updatedAt: now,
  }).run()
}

function seedUseCaseSpecDocument(
  db: TestDb,
  opts: { validity?: 'fresh' | 'stale' | 'orphaned' } = {},
): void {
  db.insert(documents).values({
    id: 'doc:ucs:create-order',
    projectId,
    type: 'ucs',
    track: 'business',
    scope: 'use_case',
    scopeId: 'epic:epic:orders:use_case:uc:create-order',
    status: 'active',
    validity: opts.validity ?? 'fresh',
    summary: 'Create order details',
    content: {
      use_case_id: 'uc:create-order',
      title: 'Create order',
    },
    rawLlmOutput: '',
    updatedBy: 'llm',
    updatedAt: now,
  }).run()
}
