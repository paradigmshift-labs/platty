import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../../server/helpers.js'
import { documents, docRelationLinks } from '../../../../src/db/schema/build_docs.js'
import { epicDocumentLinks } from '../../../../src/db/schema/build_epics.js'
import { epics, projects, repositories } from '../../../../src/db/schema/core.js'
import { staticMerkleSnapshots } from '../../../../src/db/schema/sync.js'
import { computeBusinessDocSourceHashes } from '../../../../src/pipeline_modules/build_business_docs/sync/source_hashes.js'

const projectId = 'project:platty'
const now = '2026-06-08T00:00:00.000Z'

type TestDb = ReturnType<typeof createTestDb>

describe('build_business_docs/sync source hashes', () => {
  it('computes deterministic target hashes from sorted EPIC source inputs', () => {
    const db = createHashFixture()
    const first = computeBusinessDocSourceHashes(db, { projectId })
    const second = computeBusinessDocSourceHashes(db, { projectId })

    expect(first.latestStaticSnapshotId).toBe('snapshot:new')
    expect(first.targets.map((target) => target.key).sort()).toEqual([
      'epic:epic:orders:br',
      'epic:epic:orders:data_dictionary',
      'epic:epic:orders:design',
      'epic:epic:orders:glossary',
      'epic:epic:orders:ucl',
      'project:project:platty:glossary',
    ])
    expect(first.targets).toEqual(second.targets)
    expect(first.targets.every((target) => /^[a-f0-9]{64}$/.test(target.sourceHash))).toBe(true)
  })

  it('changes only affected EPIC target hashes when linked technical source hashes change', () => {
    const db = createHashFixture()
    const before = computeBusinessDocSourceHashes(db, { projectId })
    db.update(documents)
      .set({ documentSourceHash: 'api-source-v2', contentHash: 'api-content-v2' })
      .where(eq(documents.id, 'doc:orders-api'))
      .run()
    const after = computeBusinessDocSourceHashes(db, { projectId })

    const beforeByKey = new Map(before.targets.map((target) => [target.key, target.sourceHash]))
    const changed = after.targets
      .filter((target) => beforeByKey.get(target.key) !== target.sourceHash)
      .map((target) => target.key)
      .sort()

    expect(changed).toEqual([
      'epic:epic:orders:br',
      'epic:epic:orders:data_dictionary',
      'epic:epic:orders:design',
      'epic:epic:orders:glossary',
      'epic:epic:orders:ucl',
      'project:project:platty:glossary',
    ])
  })

  it('does not change target source hashes when only latest static snapshot metadata changes', () => {
    const db = createHashFixture()
    const before = computeBusinessDocSourceHashes(db, { projectId })
    db.insert(staticMerkleSnapshots).values({
      id: 'snapshot:metadata-only',
      projectId,
      snapshotKind: 'project',
      analysisBranch: 'main',
      sourceCommit: 'commit:metadata-only',
      repoCommitPinsJson: [{ repoId: 'repo:platty', commit: 'commit:metadata-only' }],
      rootHash: 'root:metadata-only',
      hashSetJson: { root: 'root:metadata-only' },
      reasonInputsJson: { reason: 'metadata-only' },
      createdByRunId: null,
      createdAt: '2026-06-08T00:10:00.000Z',
    }).run()

    const after = computeBusinessDocSourceHashes(db, { projectId })

    expect(after.latestStaticSnapshotId).toBe('snapshot:metadata-only')
    expect(new Map(after.targets.map((target) => [target.key, target.sourceHash]))).toEqual(
      new Map(before.targets.map((target) => [target.key, target.sourceHash])),
    )
  })
})

function createHashFixture(): TestDb {
  const db = createTestDb()
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
  return db
}
