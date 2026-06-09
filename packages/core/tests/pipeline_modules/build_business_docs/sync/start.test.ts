import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../../server/helpers.js'
import { documentItemDocumentLinks, documentItems, documentLinks, documents, generationRuns } from '../../../../src/db/schema/build_docs.js'
import { epicDocumentLinks } from '../../../../src/db/schema/build_epics.js'
import { epics, projects, repositories } from '../../../../src/db/schema/core.js'
import { staticMerkleSnapshots } from '../../../../src/db/schema/sync.js'
import {
  businessDocContextPages,
  businessDocGenerationRuns,
  businessDocGenerationTasks,
} from '../../../../src/db/schema/build_business_docs_generation.js'
import { cancelBusinessDocsRun } from '../../../../src/pipeline_modules/build_business_docs_cli/lifecycle.js'
import { startBusinessDocsGeneration } from '../../../../src/pipeline_modules/build_business_docs_cli/start.js'
import { startBusinessDocsSync } from '../../../../src/pipeline_modules/build_business_docs/sync/start.js'

const projectId = 'project:platty'
const now = '2026-06-08T00:00:00.000Z'

type TestDb = ReturnType<typeof createTestDb>

describe('build_business_docs/sync start', () => {
  it('marks stale business documents before any task is leased', () => {
    const db = createSyncStartFixture()
    seedLowerDocument(db, {
      id: 'doc:deleted-api',
      type: 'api_spec',
      documentSourceHash: 'deleted-source',
      contentHash: 'deleted-content',
      status: 'deleted',
      validity: 'orphaned',
      content: {
        id: 'doc:deleted-api',
        title: 'Deleted API',
      },
    })
    seedBusinessItem(db, {
      id: 'item:orders-old-rule',
      documentId: 'doc:orders-br',
      itemType: 'business_rule',
      stableKey: 'rule:orders-old',
    })
    db.insert(documentLinks).values({
      fromDocumentId: 'doc:orders-br',
      toDocumentId: 'doc:deleted-api',
      linkType: 'derives_from',
      createdBy: 'system',
    }).run()
    db.insert(documentItemDocumentLinks).values({
      fromItemId: 'item:orders-old-rule',
      toDocumentId: 'doc:deleted-api',
      linkType: 'derives_from',
      role: 'primary',
      createdBy: 'system',
    }).run()

    const result = startBusinessDocsSync(db, {
      projectId,
      now: fixedNow,
      makeId: sequentialIds(),
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        mode: 'created',
        run: {
          projectId,
          status: 'running',
        },
      },
    })
    const staleDoc = db.select().from(documents).where(eq(documents.id, 'doc:orders-br')).get()
    expect(staleDoc).toMatchObject({
      status: 'active',
      validity: 'stale',
      updatedBy: 'system',
      documentSourceHash: 'old-business-source',
      staticSnapshotId: 'snapshot:old',
    })
    expect(db.select().from(documentItems).where(eq(documentItems.id, 'item:orders-old-rule')).get()).toMatchObject({
      status: 'active',
    })
    expect(db.select().from(documentLinks).where(eq(documentLinks.fromDocumentId, 'doc:orders-br')).all()).toEqual([])
    expect(db.select().from(documentItemDocumentLinks).where(eq(documentItemDocumentLinks.fromItemId, 'item:orders-old-rule')).all()).toEqual([])

    const tasks = db.select().from(businessDocGenerationTasks).all()
    expect(tasks.length).toBeGreaterThan(0)
    expect(tasks.every((task) => task.status === 'pending')).toBe(true)

    const targetPage = db.select().from(businessDocContextPages)
      .where(eq(businessDocContextPages.pageKind, 'target'))
      .all()
      .find((page) => page.contentJson.taskType === 'business_rules')
    expect(targetPage?.contentJson).toMatchObject({
      sync: {
        sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        staticSnapshotId: 'snapshot:new',
        reason: 'source_changed',
      },
    })
  })

  it('resumes an existing running sync run unless a new run is requested', () => {
    const db = createSyncStartFixture()
    const first = startBusinessDocsSync(db, {
      projectId,
      now: fixedNow,
      makeId: sequentialIds(),
    })
    const second = startBusinessDocsSync(db, {
      projectId,
      now: fixedNow,
      makeId: sequentialIdsFrom(100),
    })
    const third = startBusinessDocsSync(db, {
      projectId,
      newRun: true,
      now: fixedNow,
      makeId: sequentialIdsFrom(200),
    })

    expect(first.ok).toBe(true)
    expect(second).toMatchObject({
      ok: true,
      data: {
        mode: 'resumed',
        run: {
          id: first.ok ? first.data.run.id : '',
        },
      },
    })
    expect(third).toMatchObject({
      ok: true,
      data: {
        mode: 'created',
      },
    })
    expect(third.ok && first.ok ? third.data.run.id === first.data.run.id : false).toBe(false)
    expect(db.select().from(businessDocGenerationRuns).all()).toHaveLength(2)
  })

  it('blocks while build_epics sync is still running and leaves business documents unchanged', () => {
    const db = createSyncStartFixture()
    db.insert(generationRuns).values({
      id: 'run:epics',
      projectId,
      stage: 'build_epics',
      status: 'running',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
      sourceCommit: 'commit:new',
      maxConcurrentTasks: 1,
      createdAt: now,
      updatedAt: now,
    }).run()

    const result = startBusinessDocsSync(db, {
      projectId,
      now: fixedNow,
      makeId: sequentialIds(),
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'BUSINESS_DOCS_SYNC_START_BLOCKED',
      message: 'Business docs sync cannot start until build_epics sync is confirmed.',
    })
    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders-br')).get()).toMatchObject({
      status: 'active',
      validity: 'fresh',
    })
    expect(db.select().from(businessDocGenerationRuns).all()).toHaveLength(0)
  })

  it('blocks without a static snapshot and leaves business documents unchanged', () => {
    const db = createSyncStartFixtureWithoutSnapshot()

    const result = startBusinessDocsSync(db, {
      projectId,
      now: fixedNow,
      makeId: sequentialIds(),
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'BUSINESS_DOCS_SYNC_START_BLOCKED',
      message: 'Business docs sync cannot start without a static snapshot.',
    })
    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders-br')).get()).toMatchObject({
      status: 'active',
      validity: 'fresh',
    })
    expect(db.select().from(businessDocGenerationRuns).all()).toHaveLength(0)
  })

  it('does not let normal business-docs start resume a running sync run', () => {
    const db = createSyncStartFixture()
    const sync = startBusinessDocsSync(db, {
      projectId,
      now: fixedNow,
      makeId: sequentialIds(),
    })
    expect(sync.ok).toBe(true)

    const normal = startBusinessDocsGeneration(db, {
      projectId,
      now: fixedNow,
      makeId: sequentialIdsFrom(100),
    })

    expect(normal).toMatchObject({
      ok: true,
      data: {
        mode: 'created',
      },
    })
    expect(normal.ok && sync.ok ? normal.data.run.id === sync.data.run.id : true).toBe(false)
  })

  it('leaves stale validity visible when a sync run is cancelled', () => {
    const db = createSyncStartFixture()
    const started = startBusinessDocsSync(db, {
      projectId,
      now: fixedNow,
      makeId: sequentialIds(),
    })
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error('sync start failed')

    cancelBusinessDocsRun(db, {
      projectId,
      runId: started.data.run.id,
      now: () => new Date('2026-06-08T00:05:00.000Z'),
    })

    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders-br')).get()).toMatchObject({
      status: 'active',
      validity: 'stale',
    })
  })

  it('preserves user edit ownership while marking a stale business document', () => {
    const db = createSyncStartFixture()
    db.update(documents)
      .set({ updatedBy: 'user' })
      .where(eq(documents.id, 'doc:orders-br'))
      .run()

    const result = startBusinessDocsSync(db, {
      projectId,
      now: fixedNow,
      makeId: sequentialIds(),
    })

    expect(result.ok).toBe(true)
    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders-br')).get()).toMatchObject({
      status: 'active',
      validity: 'stale',
      updatedBy: 'user',
    })
  })

  it('marks deleted or unconfirmed EPIC business documents deleted and orphaned without LLM tasks', () => {
    const db = createOrphanedEpicFixture()
    seedBusinessItem(db, {
      id: 'item:old-epic-rule',
      documentId: 'doc:old-epic-br',
      itemType: 'business_rule',
      stableKey: 'rule:old',
    })
    db.insert(documentLinks).values({
      fromDocumentId: 'doc:old-epic-br',
      toDocumentId: 'doc:old-epic-br',
      linkType: 'derives_from',
      createdBy: 'system',
    }).run()
    db.insert(documentItemDocumentLinks).values({
      fromItemId: 'item:old-epic-rule',
      toDocumentId: 'doc:old-epic-br',
      linkType: 'derives_from',
      role: 'primary',
      createdBy: 'system',
    }).run()
    db.run(sql`
      INSERT INTO document_items_fts (item_id, project_id, item_type, title, summary, content)
      VALUES ('item:old-epic-rule', ${projectId}, 'business_rule', 'Old rule', 'Old summary', '{}')
    `)

    const result = startBusinessDocsSync(db, {
      projectId,
      now: fixedNow,
      makeId: sequentialIds(),
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        preview: {
          summary: {
            orphaned: 1,
          },
        },
      },
    })
    expect(db.select().from(documents).where(eq(documents.id, 'doc:old-epic-br')).get()).toMatchObject({
      status: 'deleted',
      validity: 'orphaned',
      updatedBy: 'system',
    })
    expect(db.select().from(documentItems).where(eq(documentItems.documentId, 'doc:old-epic-br')).all())
      .toEqual([expect.objectContaining({ status: 'stale' })])
    expect(db.select().from(documentLinks).where(eq(documentLinks.fromDocumentId, 'doc:old-epic-br')).all()).toEqual([])
    expect(db.select().from(documentItemDocumentLinks).where(eq(documentItemDocumentLinks.fromItemId, 'item:old-epic-rule')).all()).toEqual([])
    expect(db.all(sql`SELECT * FROM document_items_fts WHERE item_id = 'item:old-epic-rule'`)).toEqual([])
    expect(db.select().from(businessDocGenerationRuns).all()).toHaveLength(0)
    expect(db.select().from(businessDocGenerationTasks).all()).toHaveLength(0)
  })

  it('marks confirmed EPIC business documents orphaned when active technical sources disappear', () => {
    const db = createConfirmedEpicWithoutSourcesFixture()

    const result = startBusinessDocsSync(db, {
      projectId,
      now: fixedNow,
      makeId: sequentialIds(),
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'BUSINESS_DOCS_SYNC_START_BLOCKED',
      preview: {
        summary: {
          blocked: 5,
          orphaned: 1,
        },
      },
    })
    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders-br')).get()).toMatchObject({
      status: 'deleted',
      validity: 'orphaned',
    })
    expect(db.select().from(businessDocGenerationTasks).all()).toHaveLength(0)
  })
})

function createSyncStartFixture(): TestDb {
  const db = createTestDb()
  seedProject(db)
  seedRepository(db)
  seedStaticSnapshot(db, 'snapshot:old', 'old-root', '2026-06-07T00:00:00.000Z')
  seedStaticSnapshot(db, 'snapshot:new', 'new-root', now)
  seedEpic(db, {
    id: 'epic:orders',
    name: 'Orders',
    stableKey: 'orders',
    summary: 'Order checkout and fulfillment.',
  })
  seedLowerDocument(db, {
    id: 'doc:orders-api',
    type: 'api_spec',
    documentSourceHash: 'api-source-v2',
    contentHash: 'api-content-v2',
    content: {
      id: 'doc:orders-api',
      title: 'Create order API',
      flow: ['Validate cart', 'Persist order'],
      rules: ['Orders require at least one item.'],
    },
  })
  linkEpicDocument(db, {
    epicId: 'epic:orders',
    documentId: 'doc:orders-api',
    documentType: 'api_spec',
  })
  seedBusinessDocument(db, {
    id: 'doc:orders-br',
    type: 'br',
    scope: 'epic',
    scopeId: 'epic:orders',
    documentSourceHash: 'old-business-source',
    staticSnapshotId: 'snapshot:old',
  })
  return db
}

function createSyncStartFixtureWithoutSnapshot(): TestDb {
  const db = createTestDb()
  seedProject(db)
  seedRepository(db)
  seedEpic(db, {
    id: 'epic:orders',
    name: 'Orders',
    stableKey: 'orders',
    summary: 'Order checkout and fulfillment.',
  })
  seedLowerDocument(db, {
    id: 'doc:orders-api',
    type: 'api_spec',
    documentSourceHash: 'api-source-v2',
    contentHash: 'api-content-v2',
    content: {
      id: 'doc:orders-api',
      title: 'Create order API',
    },
  })
  linkEpicDocument(db, {
    epicId: 'epic:orders',
    documentId: 'doc:orders-api',
    documentType: 'api_spec',
  })
  seedBusinessDocument(db, {
    id: 'doc:orders-br',
    type: 'br',
    scope: 'epic',
    scopeId: 'epic:orders',
    documentSourceHash: 'old-business-source',
    staticSnapshotId: 'snapshot:old',
  })
  return db
}

function createOrphanedEpicFixture(): TestDb {
  const db = createTestDb()
  seedProject(db)
  seedRepository(db)
  seedStaticSnapshot(db, 'snapshot:new', 'new-root', now)
  seedEpic(db, {
    id: 'epic:old',
    name: 'Old Epic',
    stableKey: 'old',
    summary: 'No longer confirmed.',
    confirmedAt: null,
  })
  seedBusinessDocument(db, {
    id: 'doc:old-epic-br',
    type: 'br',
    scope: 'epic',
    scopeId: 'epic:old',
    documentSourceHash: 'old-business-source',
    staticSnapshotId: 'snapshot:old',
  })
  return db
}

function createConfirmedEpicWithoutSourcesFixture(): TestDb {
  const db = createTestDb()
  seedProject(db)
  seedRepository(db)
  seedStaticSnapshot(db, 'snapshot:new', 'new-root', now)
  seedEpic(db, {
    id: 'epic:orders',
    name: 'Orders',
    stableKey: 'orders',
    summary: 'Order checkout and fulfillment.',
  })
  seedBusinessDocument(db, {
    id: 'doc:orders-br',
    type: 'br',
    scope: 'epic',
    scopeId: 'epic:orders',
    documentSourceHash: 'old-business-source',
    staticSnapshotId: 'snapshot:old',
  })
  return db
}

function fixedNow(): Date {
  return new Date(now)
}

function sequentialIds(): () => string {
  return sequentialIdsFrom(0)
}

function sequentialIdsFrom(start: number): () => string {
  let next = 0
  return () => `sync:${start + ++next}`
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
    id: 'repo:platty',
    projectId,
    name: 'platty',
    repoPath: '/repo/platty',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedStaticSnapshot(db: TestDb, id: string, rootHash: string, createdAt: string): void {
  db.insert(staticMerkleSnapshots).values({
    id,
    projectId,
    snapshotKind: 'project',
    analysisBranch: 'main',
    sourceCommit: 'commit:new',
    repoCommitPinsJson: [],
    rootHash,
    hashSetJson: {},
    reasonInputsJson: {},
    createdAt,
  }).run()
}

function seedEpic(
  db: TestDb,
  input: {
    id: string
    name: string
    stableKey: string
    summary: string
    confirmedAt?: string | null
  },
): void {
  db.insert(epics).values({
    id: input.id,
    projectId,
    name: input.name,
    abbr: 'EP',
    stableKey: input.stableKey,
    summary: input.summary,
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: input.confirmedAt === undefined ? now : input.confirmedAt,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedLowerDocument(
  db: TestDb,
  input: {
    id: string
    type: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
    documentSourceHash: string
    contentHash: string
    content: Record<string, unknown>
    status?: string
    validity?: string
  },
): void {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: 'technical',
    scope: input.type,
    scopeId: input.id,
    status: input.status ?? 'passed',
    validity: input.validity ?? 'fresh',
    summary: input.id,
    content: input.content,
    rawLlmOutput: '',
    contentHash: input.contentHash,
    documentSourceHash: input.documentSourceHash,
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function seedBusinessDocument(
  db: TestDb,
  input: {
    id: string
    type: 'design' | 'data_dictionary' | 'br' | 'ucl' | 'ucs' | 'glossary'
    scope: 'epic' | 'project'
    scopeId: string
    documentSourceHash: string
    staticSnapshotId: string
  },
): void {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: 'business',
    scope: input.scope,
    scopeId: input.scopeId,
    status: 'active',
    validity: 'fresh',
    summary: input.id,
    content: { id: input.id },
    rawLlmOutput: '',
    contentHash: `${input.id}:content`,
    staticSnapshotId: input.staticSnapshotId,
    documentSourceHash: input.documentSourceHash,
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function seedBusinessItem(
  db: TestDb,
  input: {
    id: string
    documentId: string
    itemType: string
    stableKey: string
  },
): void {
  db.insert(documentItems).values({
    id: input.id,
    documentId: input.documentId,
    projectId,
    itemType: input.itemType,
    stableKey: input.stableKey,
    ordinal: 1,
    title: input.stableKey,
    summary: input.stableKey,
    content: { source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'test' }] },
    contentHash: `${input.id}:hash`,
    status: 'active',
    createdBy: 'system',
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function linkEpicDocument(
  db: TestDb,
  input: {
    epicId: string
    documentId: string
    documentType: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
  },
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
