import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { models } from '@/db/schema/build_models.js'
import { codeRelations } from '@/db/schema/build_relations.js'
import { entryPoints, codeBundles } from '@/db/schema/build_route.js'
import { codeNodes, fileCache } from '@/db/schema/code_graph.js'
import { projects, repositories } from '@/db/schema/core.js'
import { pipelineRuns } from '@/db/schema/pipeline_runs.js'
import { staticMerkleSnapshots, syncStaticMapRuns } from '@/db/schema/sync.js'
import { syncStaticMap } from '@/pipeline_modules/sync/static_map.js'
import type { DB } from '@/db/client.js'
import { createTestPlattyDb, type TestPlattyDb } from '@/db/testing.js'

let client: TestPlattyDb
let db: DB
let stagingRoot: string

beforeEach(() => {
  client = createTestPlattyDb()
  db = client.db
  stagingRoot = mkdtempSync(join(tmpdir(), 'platty-sync-static-map-'))
  db.insert(projects).values({ id: 'p1', name: 'Project' }).run()
})

afterEach(async () => {
  await client.cleanup()
})

describe('syncStaticMap', () => {
  it('refuses repos that are not pinned to an analysis branch and worktree', async () => {
    db.insert(repositories).values({
      id: 'r1',
      projectId: 'p1',
      name: 'Repo',
      repoPath: '/repo',
      analysisBranch: null,
      analysisWorktreePath: '/analysis/repo',
    }).run()

    await expect(syncStaticMap({ db, projectId: 'p1', stagingRoot })).rejects.toMatchObject({
      code: 'SYNC_STATIC_MAP_REPO_NOT_READY',
    })

    expect(db.select().from(syncStaticMapRuns).all()).toEqual([])
  })

  it('captures repo pins before static analysis stages and runs service maps after every repo relation stage', async () => {
    seedReadyRepo('r1')
    seedReadyRepo('r2')
    const events: string[] = []

    const result = await syncStaticMap({
      db,
      projectId: 'p1',
      stagingRoot,
      hooks: {
        getRepoPin: async (repo) => {
          events.push(`pin:${repo.id}`)
          return `commit:${repo.id}`
        },
        runBuildGraph: async ({ repoPin }) => {
          events.push(`graph:${repoPin.repoId}`)
        },
        runBuildModels: async ({ repoPin }) => {
          events.push(`models:${repoPin.repoId}`)
        },
        runBuildRoute: async ({ repoPin }) => {
          events.push(`route:${repoPin.repoId}`)
        },
        runBuildRelations: async ({ repoPin }) => {
          events.push(`relations:${repoPin.repoId}`)
        },
        runBuildServiceMap: async ({ repoPin }) => {
          events.push(`service:${repoPin.repoId}`)
        },
        buildMerkleSnapshot: async () => snapshotInput('root:ordered'),
        applyCanonicalStaticMap: () => {},
      },
    })

    expect(result.status).toBe('applied')
    expect(events).toEqual([
      'pin:r1',
      'pin:r2',
      'graph:r1',
      'graph:r2',
      'models:r1',
      'models:r2',
      'route:r1',
      'route:r2',
      'relations:r1',
      'relations:r2',
      'service:r1',
      'service:r2',
    ])
    expect(db.select().from(syncStaticMapRuns).where(eq(syncStaticMapRuns.id, result.runId)).get()).toMatchObject({
      status: 'applied',
    })
  })

  it('preserves classified repo pin failures instead of reporting them as apply failures', async () => {
    seedReadyRepo('r1')

    await expect(syncStaticMap({
      db,
      projectId: 'p1',
      stagingRoot,
      hooks: {
        getRepoPin: async () => null,
      },
    })).rejects.toMatchObject({
      code: 'SYNC_STATIC_MAP_REPO_PIN_FAILED',
    })

    expect(db.select().from(syncStaticMapRuns).all()).toEqual([
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('Could not capture source commit'),
      }),
    ])
  })

  it('rolls back canonical static changes and retains the staging DB when apply fails', async () => {
    seedReadyRepo('r1')
    db.insert(fileCache).values({ repoId: 'r1', filePath: 'src/a.ts', fileHash: 'old-hash' }).run()
    let stagingDbPath = ''

    await expect(syncStaticMap({
      db,
      projectId: 'p1',
      stagingRoot,
      hooks: {
        getRepoPin: async () => 'commit:r1',
        ...noopStaticStages(),
        buildMerkleSnapshot: async ({ stagingDbPath: path }) => {
          stagingDbPath = path
          return snapshotInput('root:failed')
        },
        applyCanonicalStaticMap: ({ tx }) => {
          tx.delete(fileCache).where(eq(fileCache.repoId, 'r1')).run()
          tx.insert(fileCache).values({ repoId: 'r1', filePath: 'src/a.ts', fileHash: 'new-hash' }).run()
          throw new Error('apply failed')
        },
      },
    })).rejects.toMatchObject({
      code: 'SYNC_STATIC_MAP_APPLY_FAILED',
    })

    expect(db.select().from(fileCache).where(eq(fileCache.repoId, 'r1')).all()).toEqual([
      expect.objectContaining({ filePath: 'src/a.ts', fileHash: 'old-hash' }),
    ])
    expect(db.select().from(syncStaticMapRuns).all()).toEqual([
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('apply failed'),
      }),
    ])
    expect(stagingDbPath).toBeTruthy()
    expect(existsSync(stagingDbPath)).toBe(true)
  })

  it('records a project Merkle snapshot and deletes the staging DB after a successful apply', async () => {
    seedReadyRepo('r1')
    db.insert(fileCache).values({ repoId: 'r1', filePath: 'src/a.ts', fileHash: 'old-hash' }).run()
    let stagingDbPath = ''

    const result = await syncStaticMap({
      db,
      projectId: 'p1',
      stagingRoot,
      hooks: {
        getRepoPin: async () => 'commit:r1',
        ...noopStaticStages(),
        buildMerkleSnapshot: async ({ stagingDbPath: path }) => {
          stagingDbPath = path
          return snapshotInput('root:success')
        },
        applyCanonicalStaticMap: ({ tx }) => {
          tx.delete(fileCache).where(eq(fileCache.repoId, 'r1')).run()
          tx.insert(fileCache).values({ repoId: 'r1', filePath: 'src/a.ts', fileHash: 'new-hash' }).run()
        },
      },
    })

    expect(result).toMatchObject({ status: 'applied', snapshotId: expect.any(String) })
    expect(db.select().from(fileCache).where(eq(fileCache.repoId, 'r1')).all()).toEqual([
      expect.objectContaining({ filePath: 'src/a.ts', fileHash: 'new-hash' }),
    ])
    expect(db.select().from(staticMerkleSnapshots).where(eq(staticMerkleSnapshots.id, result.snapshotId)).get()).toMatchObject({
      projectId: 'p1',
      snapshotKind: 'project',
      rootHash: 'root:success',
      createdByRunId: result.runId,
    })
    expect(db.select().from(syncStaticMapRuns).where(eq(syncStaticMapRuns.id, result.runId)).get()).toMatchObject({
      status: 'applied',
      snapshotId: result.snapshotId,
    })
    expect(stagingDbPath).toBeTruthy()
    expect(existsSync(stagingDbPath)).toBe(false)
  })

  it('seeds a pipeline parent run in staging before default static stages run', async () => {
    seedReadyRepo('r1')
    let parentRunVisibleInStaging = false

    await syncStaticMap({
      db,
      projectId: 'p1',
      stagingRoot,
      hooks: {
        getRepoPin: async () => 'commit:r1',
        runBuildGraph: async ({ stagingDb, runId }) => {
          parentRunVisibleInStaging = Boolean(
            stagingDb.select({ id: pipelineRuns.id }).from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get(),
          )
        },
        runBuildModels: async () => {},
        runBuildRoute: async () => {},
        runBuildRelations: async () => {},
        runBuildServiceMap: async () => {},
        buildMerkleSnapshot: async () => snapshotInput('root:parent-run'),
        applyCanonicalStaticMap: () => {},
      },
    })

    expect(parentRunVisibleInStaging).toBe(true)
  })

  it('builds default Merkle document hashes from staged graph, models, routes, and relations', async () => {
    seedReadyRepo('r1')

    const result = await syncStaticMap({
      db,
      projectId: 'p1',
      stagingRoot,
      hooks: {
        getRepoPin: async () => 'commit:r1',
        ...noopStaticStages(),
        initializeStagingDb: ({ stagingDb }) => {
          stagingDb.insert(fileCache).values({ repoId: 'r1', filePath: 'src/orders.ts', fileHash: 'file:v1' }).run()
          stagingDb.insert(codeNodes).values({
            id: 'node:orders-handler',
            repoId: 'r1',
            type: 'function',
            filePath: 'src/orders.ts',
            name: 'getOrders',
            normalizedCodeHash: 'handler:v1',
            parseStatus: 'ok',
          }).run()
          stagingDb.insert(models).values({
            id: 'r1:Order',
            repositoryId: 'r1',
            name: 'Order',
            tableName: 'orders',
            comment: 'Order table',
            fields: [{ name: 'id', type: 'String', nullable: false, primary: true, unique: true, line: 1 }],
            relations: [],
            sourceFile: 'prisma/schema.prisma',
            orm: 'prisma',
            validity: 'fresh',
          }).run()
          stagingDb.insert(entryPoints).values({
            id: 'entry:orders',
            repoId: 'r1',
            framework: 'nestjs',
            kind: 'api',
            httpMethod: 'GET',
            path: '/orders',
            fullPath: '/orders',
            handlerNodeId: 'node:orders-handler',
            detectionSource: 'rule:nestjs',
            confidence: 'high',
          }).run()
          stagingDb.insert(codeBundles).values({
            entryPointId: 'entry:orders',
            nodeId: 'node:orders-handler',
            depth: 0,
            edgePath: [],
          }).run()
          stagingDb.insert(codeRelations).values({
            id: 'relation:orders-db',
            repoId: 'r1',
            sourceNodeId: 'node:orders-handler',
            kind: 'db_access',
            target: 'Order',
            operation: 'findMany',
            canonicalTarget: 'Order',
            payload: { model: 'Order' },
            evidenceNodeIds: ['node:orders-handler'],
            confidence: 'high',
          }).run()
        },
      },
    })

    const snapshot = db.select().from(staticMerkleSnapshots).where(eq(staticMerkleSnapshots.id, result.snapshotId)).get()
    const hashSet = snapshot?.hashSetJson as Record<string, unknown>
    const technical = hashSet.technicalDocumentSourceHashes as Array<{ key: string; target: { scope: string; repoId: string } }>

    expect(snapshot?.rootHash).toEqual(expect.any(String))
    expect(technical.map((entry) => [entry.key, entry.target.scope, entry.target.repoId])).toEqual([
      ['model:r1:Order', 'model', 'r1'],
      ['route:entry:orders', 'route', 'r1'],
    ])
    expect(db.select().from(fileCache).where(eq(fileCache.repoId, 'r1')).all()).toEqual([
      expect.objectContaining({ filePath: 'src/orders.ts', fileHash: 'file:v1' }),
    ])
    expect(db.select().from(models).where(eq(models.repositoryId, 'r1')).all()).toEqual([
      expect.objectContaining({ id: 'r1:Order', tableName: 'orders' }),
    ])
  })
})

function seedReadyRepo(id: string): void {
  db.insert(repositories).values({
    id,
    projectId: 'p1',
    name: `Repo ${id}`,
    repoPath: `/repo/${id}`,
    analysisBranch: 'main',
    analysisWorktreePath: `/analysis/${id}`,
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

function snapshotInput(rootHash: string) {
  return {
    rootHash,
    hashSet: {
      routeDocumentSourceHashes: [
        {
          key: 'route:orders',
          hash: 'route:orders:v1',
          target: { track: 'technical', type: 'api_spec', scope: 'route', scopeId: 'route:orders' },
        },
      ],
    },
    reasonInputs: {
      byKey: {
        'route:orders': { changedNodes: ['node:orders'] },
      },
    },
  }
}
