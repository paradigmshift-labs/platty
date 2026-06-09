import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createTestDb } from '../../server/helpers.js'
import { documents, docRelationLinks, documentLinks, generationRuns } from '../../../src/db/schema/build_docs.js'
import { buildEpicsDrafts, epicDocumentLinks } from '../../../src/db/schema/build_epics.js'
import { epics, projects, repositories } from '../../../src/db/schema/core.js'
import { docSyncCandidates, docSyncPlans, staticMerkleSnapshots } from '../../../src/db/schema/sync.js'
import { previewBusinessDocsSync } from '../../../src/pipeline_modules/build_business_docs_sync/preview.js'
import { computeBusinessDocSourceHashes } from '../../../src/pipeline_modules/build_business_docs_sync/source_hashes.js'

const projectId = 'project:platty'
const now = '2026-06-08T00:00:00.000Z'

type TestDb = ReturnType<typeof createTestDb>

describe('build_business_docs_sync preview', () => {
  it('reports fresh missing stale orphaned and taskPlanned counts from computed business source hashes', () => {
    const db = createPreviewFixture()
    const result = previewBusinessDocsSync(db, { projectId })

    expect(result.summary).toMatchObject({
      fresh: 1,
      missing: 4,
      stale: 1,
      orphaned: 1,
      blocked: 0,
      tasksPlanned: 6,
    })
    expect(result.targets.find((target) => target.key === 'epic:epic:orders:br')).toMatchObject({
      state: 'stale',
      taskPlanned: true,
      reason: 'source_changed',
    })
    expect(result.orphanedTargets[0]).toMatchObject({
      documentId: 'doc:orphan-br',
      state: 'orphaned',
    })
    expect(db.select().from(documents).all().find((document) => document.id === 'doc:orders-br')?.validity).toBe('fresh')
  })

  it('treats docSyncPlanId as an affected-EPIC narrowing hint without skipping source-hash comparison', () => {
    const db = createPreviewFixture()
    db.insert(docSyncPlans).values({
      id: 'plan:docs',
      projectId,
      fromSnapshotId: 'snapshot:old',
      toSnapshotId: 'snapshot:new',
      status: 'applied',
      countsJson: {},
      createdAt: now,
      updatedAt: now,
    }).run()
    db.insert(docSyncCandidates).values({
      id: 'candidate:orders',
      planId: 'plan:docs',
      phase: 'technical',
      kind: 'stale',
      status: 'staged',
      targetJson: { track: 'technical', type: 'api_spec', scope: 'api_spec', scopeId: 'doc:orders-api' },
      oldHash: 'old',
      newHash: 'new',
      reasonInputsJson: {},
      decision: null,
      rationale: 'source changed',
      createdAt: now,
      updatedAt: now,
    }).run()

    const result = previewBusinessDocsSync(db, { projectId, docSyncPlanId: 'plan:docs' })

    expect(result.docSyncPlanId).toBe('plan:docs')
    expect(result.targets.every((target) => target.epicId === 'epic:orders' || target.scope === 'project')).toBe(true)
    expect(result.targets.find((target) => target.key === 'epic:epic:orders:br')?.state).toBe('stale')
  })

  it('does not report confirmed but out-of-scope EPIC docs as orphaned when docSyncPlanId narrows preview', () => {
    const db = createPreviewFixture()
    seedAdditionalEpicSource(db)
    seedBusinessDocument(db, {
      id: 'doc:benefits-design',
      type: 'design',
      scopeId: 'epic:benefits',
      documentSourceHash: 'benefits-design-hash',
      staticSnapshotId: 'snapshot:new',
    })
    db.insert(docSyncPlans).values({
      id: 'plan:orders-only',
      projectId,
      fromSnapshotId: 'snapshot:old',
      toSnapshotId: 'snapshot:new',
      status: 'applied',
      countsJson: {},
      createdAt: now,
      updatedAt: now,
    }).run()
    db.insert(docSyncCandidates).values({
      id: 'candidate:orders-only',
      planId: 'plan:orders-only',
      phase: 'technical',
      kind: 'stale',
      status: 'staged',
      targetJson: { track: 'technical', type: 'api_spec', scope: 'api_spec', scopeId: 'doc:orders-api' },
      oldHash: 'old',
      newHash: 'new',
      reasonInputsJson: {},
      decision: null,
      rationale: 'source changed',
      createdAt: now,
      updatedAt: now,
    }).run()

    const result = previewBusinessDocsSync(db, { projectId, docSyncPlanId: 'plan:orders-only' })

    expect(result.targets.every((target) => target.epicId === 'epic:orders' || target.scope === 'project')).toBe(true)
    expect(result.orphanedTargets.map((target) => target.documentId)).not.toContain('doc:benefits-design')
  })

  it('includes confirmed deleted EPICs from the build_epics sync draft when docSyncPlanId narrows orphan preview', () => {
    const db = createPreviewFixture()
    db.insert(epics).values({
      id: 'epic:deleted',
      projectId,
      name: 'Deleted Epic',
      abbr: 'DEL',
      stableKey: 'deleted',
      summary: 'A deleted EPIC whose technical source was removed.',
      status: 'confirmed',
      source: 'build_epics',
      confidence: 'high',
      confirmedAt: now,
      deletedAt: now,
      createdAt: now,
      updatedAt: now,
    }).run()
    seedBusinessDocument(db, {
      id: 'doc:deleted-br',
      type: 'br',
      scopeId: 'epic:deleted',
      documentSourceHash: 'deleted-br-hash',
      staticSnapshotId: 'snapshot:old',
    })
    db.insert(docSyncPlans).values({
      id: 'plan:deleted-epic',
      projectId,
      fromSnapshotId: 'snapshot:old',
      toSnapshotId: 'snapshot:new',
      status: 'applied',
      countsJson: {},
      createdAt: now,
      updatedAt: now,
    }).run()
    db.insert(docSyncCandidates).values({
      id: 'candidate:deleted-route',
      planId: 'plan:deleted-epic',
      phase: 'technical',
      kind: 'orphan_document',
      status: 'resolved',
      targetJson: { track: 'technical', type: 'api_spec', scope: 'route', scopeId: 'route:deleted' },
      oldHash: 'old',
      newHash: null,
      reasonInputsJson: {},
      decision: 'orphan',
      rationale: 'technical target no longer exists',
      createdAt: now,
      updatedAt: now,
    }).run()
    db.insert(generationRuns).values({
      id: 'run:epics-sync',
      projectId,
      stage: 'build_epics',
      status: 'completed',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
      sourceCommit: 'commit:new',
      maxConcurrentTasks: 1,
      createdAt: now,
      updatedAt: now,
      finishedAt: now,
    }).run()
    db.insert(buildEpicsDrafts).values({
      id: 'draft:epics-sync',
      runId: 'run:epics-sync',
      projectId,
      status: 'ready',
      draftJson: {
        projectId,
        epics: [],
        syncMetadata: {
          docSyncPlanId: 'plan:deleted-epic',
          removedEpicIds: ['epic:deleted'],
        },
      },
      validationJson: { fatal: [], warnings: [] },
      createdAt: now,
      updatedAt: now,
    }).run()

    const result = previewBusinessDocsSync(db, { projectId, docSyncPlanId: 'plan:deleted-epic' })

    expect(result.summary.orphaned).toBe(1)
    expect(result.orphanedTargets).toContainEqual(expect.objectContaining({
      documentId: 'doc:deleted-br',
      key: 'epic:epic:deleted:br',
      reason: 'epic_missing_or_unconfirmed',
    }))
  })

  it('does not widen to the whole project when docSyncPlanId is unknown', () => {
    const db = createPreviewFixture()

    const result = previewBusinessDocsSync(db, { projectId, docSyncPlanId: 'plan:missing' })

    expect(result.docSyncPlanId).toBe('plan:missing')
    expect(result.summary).toMatchObject({
      fresh: 0,
      missing: 0,
      stale: 0,
      orphaned: 0,
      blocked: 0,
      tasksPlanned: 0,
    })
    expect(result.targets).toEqual([])
    expect(result.orphanedTargets).toEqual([])
  })

  it('keeps the project glossary hash full when docSyncPlanId narrows affected EPICs', () => {
    const db = createPreviewFixture()
    seedAdditionalEpicSource(db)
    const full = computeBusinessDocSourceHashes(db, { projectId })
    const fullProjectGlossary = full.targets.find((target) => target.key === 'project:project:platty:glossary')
    db.insert(docSyncPlans).values({
      id: 'plan:orders-only-full-project',
      projectId,
      fromSnapshotId: 'snapshot:old',
      toSnapshotId: 'snapshot:new',
      status: 'applied',
      countsJson: {},
      createdAt: now,
      updatedAt: now,
    }).run()
    db.insert(docSyncCandidates).values({
      id: 'candidate:orders-only-full-project',
      planId: 'plan:orders-only-full-project',
      phase: 'technical',
      kind: 'stale',
      status: 'staged',
      targetJson: { track: 'technical', type: 'api_spec', scope: 'api_spec', scopeId: 'doc:orders-api' },
      oldHash: 'old',
      newHash: 'new',
      reasonInputsJson: {},
      decision: null,
      rationale: 'source changed',
      createdAt: now,
      updatedAt: now,
    }).run()

    const result = previewBusinessDocsSync(db, { projectId, docSyncPlanId: 'plan:orders-only-full-project' })
    const narrowedProjectGlossary = result.targets.find((target) => target.key === 'project:project:platty:glossary')

    expect(narrowedProjectGlossary?.sourceHash).toBe(fullProjectGlossary?.sourceHash)
    expect(narrowedProjectGlossary?.sourceInputs).toMatchObject({
      epicTargetHashes: expect.arrayContaining([
        expect.objectContaining({ epicId: 'epic:benefits' }),
      ]),
    })
  })

  it('includes the old business-doc EPIC when a scoped sync source moves to another EPIC', () => {
    const db = createTestDb()
    seedSourceInputs(db)
    db.insert(epics).values({
      id: 'epic:benefits',
      projectId,
      name: 'Benefits',
      abbr: 'BEN',
      stableKey: 'benefits',
      summary: 'Benefit participation and missions.',
      status: 'confirmed',
      source: 'build_epics',
      confidence: 'high',
      confirmedAt: now,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }).run()
    db.delete(epicDocumentLinks)
      .where(and(
        eq(epicDocumentLinks.epicId, 'epic:orders'),
        eq(epicDocumentLinks.documentId, 'doc:orders-api'),
      ))
      .run()
    db.insert(epicDocumentLinks).values({
      epicId: 'epic:benefits',
      documentId: 'doc:orders-api',
      documentType: 'api_spec',
      role: 'primary',
      reason: 'moved source',
      confidence: 'high',
      createdAt: now,
    }).run()
    seedBusinessDocument(db, {
      id: 'doc:orders-br',
      type: 'br',
      scopeId: 'epic:orders',
      documentSourceHash: 'old-orders-br-hash',
      staticSnapshotId: 'snapshot:old',
    })
    db.insert(documentLinks).values({
      fromDocumentId: 'doc:orders-br',
      toDocumentId: 'doc:orders-api',
      linkType: 'derives_from',
      createdBy: 'system',
    }).run()
    db.insert(docSyncPlans).values({
      id: 'plan:moved-source',
      projectId,
      fromSnapshotId: 'snapshot:old',
      toSnapshotId: 'snapshot:new',
      status: 'applied',
      countsJson: {},
      createdAt: now,
      updatedAt: now,
    }).run()
    db.insert(docSyncCandidates).values({
      id: 'candidate:moved-source',
      planId: 'plan:moved-source',
      phase: 'technical',
      kind: 'stale',
      status: 'staged',
      targetJson: { track: 'technical', type: 'api_spec', scope: 'api_spec', scopeId: 'doc:orders-api' },
      oldHash: 'old',
      newHash: 'new',
      reasonInputsJson: {},
      decision: null,
      rationale: 'source moved to another EPIC',
      createdAt: now,
      updatedAt: now,
    }).run()

    const result = previewBusinessDocsSync(db, { projectId, docSyncPlanId: 'plan:moved-source' })

    expect(result.targets).toContainEqual(expect.objectContaining({
      key: 'epic:epic:benefits:br',
      state: 'missing',
    }))
    expect(result.orphanedTargets).toContainEqual(expect.objectContaining({
      documentId: 'doc:orders-br',
      key: 'epic:epic:orders:br',
      reason: 'source_target_missing',
    }))
  })

  it('plans a missing project glossary when EPIC glossary inputs are already fresh', () => {
    const db = createPreviewFixture()
    const hashes = computeBusinessDocSourceHashes(db, { projectId })
    const sourceHashByKey = new Map(hashes.targets.map((target) => [target.key, target.sourceHash]))
    for (const type of ['data_dictionary', 'ucl', 'glossary'] as const) {
      seedBusinessDocument(db, {
        id: `doc:orders-${type}`,
        type,
        scopeId: 'epic:orders',
        documentSourceHash: sourceHashByKey.get(`epic:epic:orders:${type}`) ?? null,
        staticSnapshotId: 'snapshot:new',
      })
    }
    db.update(documents)
      .set({
        documentSourceHash: sourceHashByKey.get('epic:epic:orders:br') ?? null,
        staticSnapshotId: 'snapshot:new',
      })
      .where(eq(documents.id, 'doc:orders-br'))
      .run()

    const result = previewBusinessDocsSync(db, { projectId })

    expect(result.targets.find((target) => target.key === 'project:project:platty:glossary')).toMatchObject({
      state: 'missing',
      taskPlanned: true,
    })
  })
})

function createPreviewFixture(): TestDb {
  const db = createTestDb()
  seedSourceInputs(db)
  const hashes = computeBusinessDocSourceHashes(db, { projectId })
  const sourceHashByKey = new Map(hashes.targets.map((target) => [target.key, target.sourceHash]))
  seedBusinessDocument(db, {
    id: 'doc:orders-design',
    type: 'design',
    scopeId: 'epic:orders',
    documentSourceHash: sourceHashByKey.get('epic:epic:orders:design') ?? null,
    staticSnapshotId: 'snapshot:new',
  })
  seedBusinessDocument(db, {
    id: 'doc:orders-br',
    type: 'br',
    scopeId: 'epic:orders',
    documentSourceHash: 'old-br-hash',
    staticSnapshotId: 'snapshot:old',
  })
  seedBusinessDocument(db, {
    id: 'doc:orphan-br',
    type: 'br',
    scopeId: 'epic:missing',
    documentSourceHash: 'orphan-br-hash',
    staticSnapshotId: 'snapshot:old',
  })
  return db
}

function seedSourceInputs(db: TestDb): void {
  db.insert(projects).values({
    id: projectId,
    name: 'Platty',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(repositories).values({
    id: 'repo:platty',
    projectId,
    name: 'platty',
    repoPath: '/repo/platty',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(epics).values({
    id: 'epic:orders',
    projectId,
    name: 'Orders',
    abbr: 'ORD',
    stableKey: 'orders',
    summary: 'Order checkout and fulfillment.',
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: now,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(documents).values({
    id: 'doc:orders-api',
    projectId,
    type: 'api_spec',
    track: 'technical',
    scope: 'api_spec',
    scopeId: 'doc:orders-api',
    status: 'passed',
    validity: 'fresh',
    summary: 'Create an order from cart items.',
    content: {
      identity: {
        method: 'POST',
        path: '/orders',
        handler: 'OrdersController.create',
      },
      flow: ['Validate cart', 'Persist order'],
      rules: ['Orders require at least one item.'],
    },
    rawLlmOutput: '',
    contentHash: 'api-content-v1',
    staticSnapshotId: 'snapshot:new',
    documentSourceHash: 'api-source-v1',
    updatedBy: 'system',
    updatedAt: now,
  }).run()
  db.insert(epicDocumentLinks).values({
    epicId: 'epic:orders',
    documentId: 'doc:orders-api',
    documentType: 'api_spec',
    role: 'primary',
    reason: 'test link',
    confidence: 'high',
    createdAt: now,
  }).run()
  db.insert(docRelationLinks).values({
    documentId: 'doc:orders-api',
    relationId: null,
    repoId: 'repo:platty',
    sourceNodeId: 'node:orders',
    kind: 'db_access',
    target: 'Order',
    operation: 'insert',
    canonicalTarget: 'db:Order:insert',
    payloadJson: { table: 'Order', operation: 'insert' },
    evidenceNodeIdsJson: ['node:orders'],
    confidence: 'high',
    unresolvedReason: null,
    createdAt: now,
  }).run()
  db.insert(staticMerkleSnapshots).values({
    id: 'snapshot:new',
    projectId,
    snapshotKind: 'project',
    analysisBranch: 'main',
    sourceCommit: 'commit:new',
    repoCommitPinsJson: [{ repoId: 'repo:platty', commit: 'commit:new' }],
    rootHash: 'root:new',
    hashSetJson: { root: 'root:new' },
    reasonInputsJson: { reason: 'fixture' },
    createdByRunId: null,
    createdAt: now,
  }).run()
}

function seedAdditionalEpicSource(db: TestDb): void {
  db.insert(epics).values({
    id: 'epic:benefits',
    projectId,
    name: 'Benefits',
    abbr: 'BEN',
    stableKey: 'benefits',
    summary: 'Benefit participation and missions.',
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: now,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(documents).values({
    id: 'doc:benefits-api',
    projectId,
    type: 'api_spec',
    track: 'technical',
    scope: 'api_spec',
    scopeId: 'doc:benefits-api',
    status: 'passed',
    validity: 'fresh',
    summary: 'List available benefits.',
    content: {
      identity: {
        method: 'GET',
        path: '/benefits',
        handler: 'BenefitsController.list',
      },
    },
    rawLlmOutput: '',
    contentHash: 'benefits-content-v1',
    staticSnapshotId: 'snapshot:new',
    documentSourceHash: 'benefits-source-v1',
    updatedBy: 'system',
    updatedAt: now,
  }).run()
  db.insert(epicDocumentLinks).values({
    epicId: 'epic:benefits',
    documentId: 'doc:benefits-api',
    documentType: 'api_spec',
    role: 'primary',
    reason: 'test link',
    confidence: 'high',
    createdAt: now,
  }).run()
}

function seedBusinessDocument(
  db: TestDb,
  input: {
    id: string
    type: 'design' | 'data_dictionary' | 'br' | 'ucl' | 'glossary'
    scopeId: string
    scope?: 'epic' | 'project'
    documentSourceHash: string | null
    staticSnapshotId: string | null
  },
): void {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: 'business',
    scope: input.scope ?? 'epic',
    scopeId: input.scopeId,
    status: 'active',
    validity: 'fresh',
    summary: input.type,
    content: { type: input.type },
    rawLlmOutput: '',
    contentHash: `${input.id}:content`,
    staticSnapshotId: input.staticSnapshotId,
    documentSourceHash: input.documentSourceHash,
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}
