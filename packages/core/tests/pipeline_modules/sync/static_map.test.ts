import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { models } from '@/db/schema/build_models.js'
import { codeRelations } from '@/db/schema/build_relations.js'
import { entryPoints, codeBundles } from '@/db/schema/build_route.js'
import { serviceMapEdges } from '@/db/schema/build_service_map.js'
import { codeEdges, codeNodes, fileCache } from '@/db/schema/code_graph.js'
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

  it('lets canonical assign fresh code edge ids during static-map apply', async () => {
    seedReadyRepo('r1')
    db.insert(repositories).values({
      id: 'r-old',
      projectId: 'p1',
      name: 'Old Repo',
      repoPath: '/repo/old',
      analysisBranch: 'main',
      analysisWorktreePath: '/analysis/old',
      deletedAt: '2026-01-01T00:00:00.000Z',
    }).run()
    db.insert(codeNodes).values({
      id: 'r-old:src/old.ts:oldFn',
      repoId: 'r-old',
      type: 'function',
      filePath: 'src/old.ts',
      name: 'oldFn',
      parseStatus: 'ok',
    }).run()
    db.insert(codeEdges).values({
      id: 1,
      repoId: 'r-old',
      sourceId: 'r-old:src/old.ts:oldFn',
      targetId: null,
      relation: 'imports',
      targetSpecifier: 'legacy-lib',
      resolveStatus: 'pending',
      source: 'static',
    }).run()

    const result = await syncStaticMap({
      db,
      projectId: 'p1',
      stagingRoot,
      hooks: {
        getRepoPin: async () => 'commit:r1',
        ...noopStaticStages(),
        initializeStagingDb: ({ stagingDb }) => {
          stagingDb.insert(codeNodes).values({
            id: 'r1:src/current.ts:currentFn',
            repoId: 'r1',
            type: 'function',
            filePath: 'src/current.ts',
            name: 'currentFn',
            parseStatus: 'ok',
          }).run()
          stagingDb.insert(codeEdges).values({
            id: 1,
            repoId: 'r1',
            sourceId: 'r1:src/current.ts:currentFn',
            targetId: null,
            relation: 'imports',
            targetSpecifier: 'current-lib',
            resolveStatus: 'pending',
            source: 'static',
          }).run()
        },
        buildMerkleSnapshot: async () => snapshotInput('root:edge-id-regenerated'),
      },
    })

    expect(result.status).toBe('applied')
    expect(db.select().from(codeEdges).where(eq(codeEdges.repoId, 'r-old')).all()).toEqual([
      expect.objectContaining({ id: 1, repoId: 'r-old', targetSpecifier: 'legacy-lib' }),
    ])

    const currentEdges = db.select().from(codeEdges).where(eq(codeEdges.repoId, 'r1')).all()
    expect(currentEdges).toEqual([
      expect.objectContaining({ repoId: 'r1', targetSpecifier: 'current-lib' }),
    ])
    expect(currentEdges[0]?.id).not.toBe(1)
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

  it('includes only relevant service-map edges in technical document hashes', async () => {
    seedReadyRepo('r-front')
    seedReadyRepo('r-back')

    const beforeResult = await syncStaticMap({
      db,
      projectId: 'p1',
      stagingRoot,
      hooks: {
        getRepoPin: async (repo) => `commit:${repo.id}:before`,
        ...noopStaticStages(),
        initializeStagingDb: ({ stagingDb }) => {
          seedServiceMapHashScenario(stagingDb, 'static_map_run:before', false)
        },
      },
    })
    const beforeSnapshot = db.select().from(staticMerkleSnapshots).where(eq(staticMerkleSnapshots.id, beforeResult.snapshotId)).get()

    const afterResult = await syncStaticMap({
      db,
      projectId: 'p1',
      stagingRoot,
      hooks: {
        getRepoPin: async (repo) => `commit:${repo.id}:after`,
        ...noopStaticStages(),
        initializeStagingDb: ({ stagingDb }) => {
          seedServiceMapHashScenario(stagingDb, 'static_map_run:after', true)
        },
      },
    })
    const afterSnapshot = db.select().from(staticMerkleSnapshots).where(eq(staticMerkleSnapshots.id, afterResult.snapshotId)).get()

    const beforeOrderScreenHash = technicalDocumentHash(beforeSnapshot?.hashSetJson, 'screen_spec', 'screen:orders', 'r-front')
    const beforeProfileScreenHash = technicalDocumentHash(beforeSnapshot?.hashSetJson, 'screen_spec', 'screen:profile', 'r-front')
    const beforeOrdersApiHash = technicalDocumentHash(beforeSnapshot?.hashSetJson, 'api_spec', 'api:orders', 'r-back')

    expect(technicalDocumentHash(afterSnapshot?.hashSetJson, 'screen_spec', 'screen:orders', 'r-front'))
      .not.toBe(beforeOrderScreenHash)
    expect(technicalDocumentHash(afterSnapshot?.hashSetJson, 'api_spec', 'api:orders', 'r-back'))
      .not.toBe(beforeOrdersApiHash)
    expect(technicalDocumentHash(afterSnapshot?.hashSetJson, 'screen_spec', 'screen:profile', 'r-front'))
      .toBe(beforeProfileScreenHash)
  })
})

function seedServiceMapHashScenario(stagingDb: DB, runId: string, includeServiceEdge: boolean): void {
  stagingDb.insert(codeNodes).values([
    {
      id: 'node:orders-screen',
      repoId: 'r-front',
      type: 'function',
      filePath: 'src/orders.tsx',
      name: 'OrdersScreen',
      normalizedCodeHash: 'orders-screen:v1',
      parseStatus: 'ok',
    },
    {
      id: 'node:profile-screen',
      repoId: 'r-front',
      type: 'function',
      filePath: 'src/profile.tsx',
      name: 'ProfileScreen',
      normalizedCodeHash: 'profile-screen:v1',
      parseStatus: 'ok',
    },
    {
      id: 'node:orders-api',
      repoId: 'r-back',
      type: 'function',
      filePath: 'src/orders.controller.ts',
      name: 'createOrder',
      normalizedCodeHash: 'orders-api:v1',
      parseStatus: 'ok',
    },
  ]).run()
  stagingDb.insert(entryPoints).values([
    {
      id: 'screen:orders',
      repoId: 'r-front',
      framework: 'nextjs',
      kind: 'page',
      path: '/orders',
      fullPath: '/orders',
      handlerNodeId: 'node:orders-screen',
      detectionSource: 'rule:nextjs',
      confidence: 'high',
    },
    {
      id: 'screen:profile',
      repoId: 'r-front',
      framework: 'nextjs',
      kind: 'page',
      path: '/profile',
      fullPath: '/profile',
      handlerNodeId: 'node:profile-screen',
      detectionSource: 'rule:nextjs',
      confidence: 'high',
    },
    {
      id: 'api:orders',
      repoId: 'r-back',
      framework: 'nestjs',
      kind: 'api',
      httpMethod: 'POST',
      path: '/api/orders',
      fullPath: '/api/orders',
      handlerNodeId: 'node:orders-api',
      detectionSource: 'rule:nestjs',
      confidence: 'high',
    },
  ]).run()
  stagingDb.insert(codeBundles).values([
    { entryPointId: 'screen:orders', nodeId: 'node:orders-screen', depth: 0, edgePath: [] },
    { entryPointId: 'screen:profile', nodeId: 'node:profile-screen', depth: 0, edgePath: [] },
    { entryPointId: 'api:orders', nodeId: 'node:orders-api', depth: 0, edgePath: [] },
  ]).run()

  if (!includeServiceEdge) return

  stagingDb.insert(serviceMapEdges).values({
    id: 'service-edge:orders-screen-api',
    projectId: 'p1',
    repoId: 'r-front',
    sourceRepoId: 'r-front',
    targetRepoId: 'r-back',
    runId,
    sourceType: 'screen',
    sourceId: 'screen:orders',
    targetType: 'api',
    targetId: 'api:orders',
    kind: 'calls_api',
    canonicalTarget: 'POST /api/orders',
    confidence: 'high',
    source: 'deterministic',
    evidence: { screen: 'screen:orders', api: 'api:orders' },
  }).run()
}

function technicalDocumentHash(
  hashSet: unknown,
  type: string,
  scopeId: string,
  repoId: string,
): string | undefined {
  const entries = (hashSet as { technicalDocumentSourceHashes?: Array<{
    hash: string
    target: { type: string; scopeId: string; repoId: string }
  }> } | undefined)?.technicalDocumentSourceHashes ?? []
  return entries.find((entry) => entry.target.type === type && entry.target.scopeId === scopeId && entry.target.repoId === repoId)?.hash
}

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
