import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { documents } from '@/db/schema/build_docs.js'
import { fileCache } from '@/db/schema/code_graph.js'
import { projects, repositories } from '@/db/schema/core.js'
import { staticMerkleSnapshots } from '@/db/schema/sync.js'
import { syncStaticMap } from '@/pipeline_modules/sync/static_map.js'
import {
  advanceDocSyncPlanPhase,
  applyDocSyncPlan,
  createDocSyncPlan,
  listDocSyncCandidates,
  stageDocSyncOutput,
} from '@/pipeline_modules/sync/doc_sync.js'
import type { DB } from '@/db/client.js'
import { createTestPlattyDb, type TestPlattyDb } from '@/db/testing.js'

let client: TestPlattyDb
let db: DB

beforeEach(() => {
  client = createTestPlattyDb()
  db = client.db
  db.insert(projects).values({ id: 'p1', name: 'Project' }).run()
  db.insert(repositories).values({
    id: 'r1',
    projectId: 'p1',
    name: 'Repo',
    repoPath: '/repo',
    analysisBranch: 'main',
    analysisWorktreePath: '/analysis/repo',
  }).run()
})

afterEach(async () => {
  await client.cleanup()
})

describe('sync static map to document sync integration', () => {
  it('applies a generated document against the static-map snapshot that created the plan', async () => {
    seedOldSnapshot()
    db.insert(documents).values({
      id: 'doc:orders',
      projectId: 'p1',
      type: 'api_spec',
      track: 'technical',
      scope: 'route',
      scopeId: 'route:orders',
      status: 'active',
      validity: 'fresh',
      summary: 'Orders API v1',
      content: { version: 1 },
      rawLlmOutput: '',
      contentHash: 'content:v1',
      documentSourceHash: 'hash:orders:v1',
      staticSnapshotId: 'snap:old',
      updatedBy: 'system',
    }).run()

    const staticMap = await syncStaticMap({
      db,
      projectId: 'p1',
      stagingRoot: mkdtempSync(join(tmpdir(), 'platty-sync-integration-')),
      hooks: {
        getRepoPin: async () => 'commit:r1:v2',
        ...noopStaticStages(),
        buildMerkleSnapshot: async () => ({
          rootHash: 'root:v2',
          hashSet: {
            routeDocumentSourceHashes: [
              {
                key: 'route:orders',
                hash: 'hash:orders:v2',
                target: { track: 'technical', type: 'api_spec', scope: 'route', scopeId: 'route:orders' },
              },
            ],
          },
          reasonInputs: {
            byKey: {
              'route:orders': { contractChanges: ['GET /orders response changed'] },
            },
          },
        }),
        applyCanonicalStaticMap: ({ tx }) => {
          tx.insert(fileCache).values({ repoId: 'r1', filePath: 'src/orders.ts', fileHash: 'file:v2' }).run()
        },
      },
    })

    const plan = createDocSyncPlan({
      db,
      projectId: 'p1',
      fromSnapshotId: 'snap:old',
      toSnapshotId: staticMap.snapshotId,
    })
    const [candidate] = listDocSyncCandidates({ db, planId: plan.planId }).candidates

    expect(candidate).toMatchObject({
      kind: 'stale',
      target: expect.objectContaining({ scopeId: 'route:orders' }),
      oldHash: 'hash:orders:v1',
      newHash: 'hash:orders:v2',
    })

    const staged = stageDocSyncOutput({
      db,
      planId: plan.planId,
      candidateId: candidate.candidateId,
      document: {
        summary: 'Orders API v2',
        content: { version: 2, source: 'sync' },
        rawOutput: 'skill output',
      },
      evidence: { codeNodeIds: ['node:orders'] },
    })
    advanceDocSyncPlanPhase({ db, planId: plan.planId, nextPhase: 'business' })

    expect(applyDocSyncPlan({ db, planId: plan.planId })).toEqual({
      planId: plan.planId,
      status: 'applied',
      appliedDocuments: 1,
    })

    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders')).get()).toMatchObject({
      summary: 'Orders API v2',
      content: { version: 2, source: 'sync' },
      contentHash: staged.contentHash,
      documentSourceHash: 'hash:orders:v2',
      staticSnapshotId: staticMap.snapshotId,
      validity: 'fresh',
    })
    expect(db.select().from(staticMerkleSnapshots).where(eq(staticMerkleSnapshots.id, staticMap.snapshotId)).get()).toMatchObject({
      rootHash: 'root:v2',
    })
    expect(db.select().from(fileCache).where(eq(fileCache.repoId, 'r1')).all()).toEqual([
      expect.objectContaining({ filePath: 'src/orders.ts', fileHash: 'file:v2' }),
    ])
  })
})

function seedOldSnapshot(): void {
  db.insert(staticMerkleSnapshots).values({
    id: 'snap:old',
    projectId: 'p1',
    snapshotKind: 'project',
    rootHash: 'root:v1',
    repoCommitPinsJson: [{ repoId: 'r1', analysisBranch: 'main', sourceCommit: 'commit:r1:v1', analysisWorktreePath: '/analysis/repo' }],
    hashSetJson: {
      routeDocumentSourceHashes: [
        {
          key: 'route:orders',
          hash: 'hash:orders:v1',
          target: { track: 'technical', type: 'api_spec', scope: 'route', scopeId: 'route:orders' },
        },
      ],
    },
    reasonInputsJson: {
      byKey: {
        'route:orders': { contractChanges: [] },
      },
    },
    createdByRunId: 'run:old',
  }).run()
}

function noopStaticStages() {
  return {
    runBuildGraph: async () => {},
    runBuildModels: async () => {},
    runBuildRoute: async () => {},
    runBuildRelations: async () => {},
    runBuildServiceMap: async () => {},
  }
}
