/**
 * build_relations cross-cutting 테스트
 * SOT: specs/build_relations/architecture.md §7, §8.3 Phase 0+1
 * 시나리오: REL-P01~P05, REL-N03, REL-N04
 */

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { and, eq } from 'drizzle-orm'
import * as schema from '@/db/schema/index.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/index.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { codeRelations } from '@/db/schema/build_relations.js'
import type { DB } from '@/db/client.js'
import { runBuildRelations } from '@/pipeline_modules/build_relations/index.js'
import { loadInputs } from '@/pipeline_modules/build_relations/load_inputs.js'
import type { CodeNodeLike, CodeEdgeLike, NormalizedCodeRelation } from '@/pipeline_modules/build_relations/types.js'
import { normalizeRelations, makeRelationId } from '@/pipeline_modules/build_relations/normalize_relations.js'
import { persistCodeRelations } from '@/pipeline_modules/build_relations/persist_code_relations.js'
import { relationsForReachableNodes } from '@/pipeline_modules/build_relations/relations_for_reachable_nodes.js'

// ── helpers ──────────────────────────────────────────────

function createTestDb(): DB {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './src/db/migrations' })
  return db
}

const PROJ_ID = 'proj_cr'
const REPO_ID = 'repo_cr'

function seed(db: DB): void {
  db.insert(projects).values({ id: PROJ_ID, name: 'CrossCutting' }).run()
  db.insert(repositories).values({ id: REPO_ID, projectId: PROJ_ID, name: 'repo', repoPath: '/repo' }).run()
}

function makeNode(partial: Partial<CodeNodeLike> & { id: string; filePath: string }): CodeNodeLike {
  return {
    repoId: REPO_ID,
    type: 'method',
    name: partial.id,
    lineStart: 1,
    lineEnd: 10,
    isTest: false,
    parseStatus: 'ok',
    ...partial,
  }
}

function makeEdge(partial: Partial<CodeEdgeLike> & { sourceId: string; relation: string }): CodeEdgeLike {
  return {
    id: Math.floor(Math.random() * 1e9),
    repoId: REPO_ID,
    targetId: null,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    argExpressions: null,
    resolveStatus: 'resolved',
    confidence: null,
    source: 'static',
    ...partial,
  }
}

// ── REL-P05: empty-set replace ────────────────────────────

describe('REL-P05: empty-set replace', () => {
  it('relation 0건 추출 시 기존 row 전부 삭제, stale row 없음', async () => {
    const db = createTestDb()
    seed(db)

    // 기존 row 삽입
    db.insert(codeRelations).values({
      id: 'stale-1',
      repoId: REPO_ID,
      sourceNodeId: 'node-1',
      kind: 'db_access',
      payload: {},
      evidenceNodeIds: [],
      confidence: 'high',
    }).run()

    expect(db.select().from(codeRelations).where(eq(codeRelations.repoId, REPO_ID)).all()).toHaveLength(1)

    await persistCodeRelations(db, REPO_ID, [])

    expect(db.select().from(codeRelations).where(eq(codeRelations.repoId, REPO_ID)).all()).toHaveLength(0)
  })
})

// ── REL-P01: repo current-set replace ────────────────────

describe('REL-P01: repo current-set replace', () => {
  it('새 relation set으로 기존 row 완전 교체, code_relation_links 등 미수정', async () => {
    const db = createTestDb()
    seed(db)

    // stale row 삽입
    db.insert(codeRelations).values({
      id: 'old-1',
      repoId: REPO_ID,
      sourceNodeId: 'old-node',
      kind: 'navigation',
      target: '/old',
      canonicalTarget: 'screen:/old',
      payload: {},
      evidenceNodeIds: [],
      confidence: 'high',
    }).run()

    const newRelations: NormalizedCodeRelation[] = [
      {
        sourceNodeId: 'node-a',
        kind: 'navigation',
        target: '/profile',
        operation: 'push',
        canonicalTarget: 'screen:/profile',
        payload: { router: 'nextjs' },
        evidenceNodeIds: ['edge:123'],
        confidence: 'high',
        dedupeKey: 'node-a:navigation:screen:/profile:push',
      },
    ]

    await persistCodeRelations(db, REPO_ID, newRelations)

    const rows = db.select().from(codeRelations).where(eq(codeRelations.repoId, REPO_ID)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].sourceNodeId).toBe('node-a')
    expect(rows[0].target).toBe('/profile')
    expect(rows[0].canonicalTarget).toBe('screen:/profile')
  })
})

// ── REL-P02: logical dedupe ───────────────────────────────

describe('REL-P02: logical dedupe', () => {
  it('같은 logical relation은 1건만 저장', () => {
    const relations = [
      {
        sourceNodeId: 'node-1',
        kind: 'api_call' as const,
        target: '/api/orders',
        operation: 'POST',
        canonicalTarget: 'POST /api/orders',
        payload: { protocol: 'rest' },
        evidenceNodeIds: ['edge:1'],
        confidence: 'high' as const,
      },
      {
        sourceNodeId: 'node-1',
        kind: 'api_call' as const,
        target: '/api/orders',
        operation: 'POST',
        canonicalTarget: 'POST /api/orders',
        payload: { protocol: 'rest' },
        evidenceNodeIds: ['edge:2'],
        confidence: 'high' as const,
      },
    ]

    const normalized = normalizeRelations(relations)
    expect(normalized).toHaveLength(1)
    // evidence는 두 경로 모두 보존
    expect(normalized[0].evidenceNodeIds).toContain('edge:1')
    expect(normalized[0].evidenceNodeIds).toContain('edge:2')
  })
})

describe('F5 canonical normalization branches', () => {
  it('computes canonical targets for every relation kind when resolver omits them', () => {
    const normalized = normalizeRelations([
      {
        sourceNodeId: 'node-api',
        kind: 'api_call',
        target: '/api/users',
        operation: null,
        payload: {},
        evidenceNodeIds: ['edge:1'],
        confidence: 'medium',
      },
      {
        sourceNodeId: 'node-nav',
        kind: 'navigation',
        target: '/users/[id]',
        operation: 'push',
        payload: {},
        evidenceNodeIds: ['edge:2'],
        confidence: 'high',
      },
      {
        sourceNodeId: 'node-event',
        kind: 'event_publish',
        target: 'order.created',
        operation: 'publish',
        payload: {},
        evidenceNodeIds: ['edge:3'],
        confidence: 'high',
      },
      {
        sourceNodeId: 'node-link',
        kind: 'external_link',
        target: 'mailto:help@example.com',
        operation: 'open',
        payload: {},
        evidenceNodeIds: ['edge:4'],
        confidence: 'high',
      },
      {
        sourceNodeId: 'node-db',
        kind: 'db_access',
        target: 'orders',
        operation: 'insert',
        payload: {},
        evidenceNodeIds: ['edge:6'],
        confidence: 'high',
      },
      {
        sourceNodeId: 'node-service',
        kind: 'external_service',
        target: 'firebase:auth',
        operation: 'unknown',
        payload: {},
        evidenceNodeIds: ['edge:5'],
        confidence: 'high',
      },
    ])

    expect(normalized.map((r) => r.canonicalTarget)).toEqual([
      'UNKNOWN /api/users',
      'screen:/users/:id',
      'node_event:order.created',
      'external:mailto:help@example.com',
      'db:orders:insert',
      'external_service:firebase:auth',
    ])
  })

  it('returns null canonical target when required target/operation is missing', () => {
    const normalized = normalizeRelations([
      { sourceNodeId: 'api', kind: 'api_call', target: null, operation: 'GET', payload: {}, evidenceNodeIds: [], confidence: 'medium' },
      { sourceNodeId: 'nav', kind: 'navigation', target: null, operation: 'push', payload: {}, evidenceNodeIds: [], confidence: 'high' },
      { sourceNodeId: 'db-missing-target', kind: 'db_access', target: null, operation: 'select', payload: {}, evidenceNodeIds: [], confidence: 'high' },
      { sourceNodeId: 'db', kind: 'db_access', target: 'users', operation: null, payload: {}, evidenceNodeIds: [], confidence: 'high' },
      { sourceNodeId: 'event', kind: 'event_listen', target: null, operation: 'listen', payload: {}, evidenceNodeIds: [], confidence: 'high' },
      { sourceNodeId: 'link', kind: 'external_link', target: null, operation: 'open', payload: {}, evidenceNodeIds: [], confidence: 'high' },
      { sourceNodeId: 'svc', kind: 'external_service', target: null, operation: 'unknown', payload: {}, evidenceNodeIds: [], confidence: 'high' },
      { sourceNodeId: 'unknown', kind: 'unsupported_kind' as never, target: null, operation: null, payload: {}, evidenceNodeIds: [], confidence: 'high' },
    ])

    expect(normalized.every((r) => r.canonicalTarget === null)).toBe(true)
  })

  it('dedupes schedule triggers without concrete schedule values', () => {
    const normalized = normalizeRelations([
      {
        sourceNodeId: 'job',
        kind: 'schedule_trigger',
        target: null,
        operation: 'trigger',
        payload: { schedule_type: 'interval' },
        evidenceNodeIds: ['edge:1'],
        confidence: 'high',
      },
      {
        sourceNodeId: 'job',
        kind: 'schedule_trigger',
        target: null,
        operation: 'trigger',
        payload: { schedule_type: 'interval' },
        evidenceNodeIds: ['edge:2'],
        confidence: 'high',
      },
    ])

    expect(normalized).toHaveLength(1)
    expect(normalized[0].dedupeKey).toBe('job:schedule_trigger:interval:')
    expect(normalized[0].evidenceNodeIds).toEqual(['edge:1', 'edge:2'])
  })

  it('dedupes schedule triggers without schedule type metadata', () => {
    const [normalized] = normalizeRelations([
      {
        sourceNodeId: 'job',
        kind: 'schedule_trigger',
        target: null,
        operation: 'trigger',
        payload: {},
        evidenceNodeIds: ['edge:1'],
        confidence: 'high',
      },
    ])

    expect(normalized.dedupeKey).toBe('job:schedule_trigger::')
  })

  it('normalizes route parameter syntaxes and generates stable relation ids', () => {
    const [relation] = normalizeRelations([
      {
        sourceNodeId: 'node-nav',
        kind: 'navigation',
        target: '/users/${id}/posts/{postId}',
        operation: 'push',
        payload: {},
        evidenceNodeIds: ['edge:1'],
        confidence: 'high',
      },
    ])

    expect(relation.canonicalTarget).toBe('screen:/users/:param/posts/:postId')
    expect(makeRelationId(REPO_ID, relation)).toBe(makeRelationId(REPO_ID, relation))
    expect(makeRelationId(REPO_ID, relation)).toMatch(/^cr:/)
  })
})

// ── REL-P03: test source default exclusion ─────────────────

describe('REL-P03: test source default exclusion', () => {
  it('isTest=true 노드는 기본 제외됨 (loadInputs 책임)', async () => {
    const db = createTestDb()
    seed(db)

    // test node 삽입
    db.insert(codeNodes).values({
      id: `${REPO_ID}:src/api.test.ts`,
      repoId: REPO_ID,
      type: 'file',
      filePath: 'src/api.test.ts',
      name: 'api.test.ts',
      isTest: true,
      parseStatus: 'ok',
      exported: false,
      isDefaultExport: false,
      isAsync: false,
    }).run()

    // runBuildRelations는 includeTestSources=false이면 test source를 무시
    const result = await runBuildRelations({ repoId: REPO_ID, db })
    expect(result.relationsCount).toBe(0)
  })
})

// ── REL-P04: explicit test source inclusion ────────────────

describe('REL-P04: explicit test source inclusion', () => {
  it('includeTestSources=true이면 test source node도 입력에 포함됨', async () => {
    const db = createTestDb()
    seed(db)

    // test node 삽입 (DB/API call edge 없이 node만)
    db.insert(codeNodes).values({
      id: `${REPO_ID}:src/api.test.ts:testFn`,
      repoId: REPO_ID,
      type: 'function',
      filePath: 'src/api.test.ts',
      name: 'testFn',
      isTest: true,
      parseStatus: 'ok',
      exported: false,
      isDefaultExport: false,
      isAsync: false,
    }).run()

    // edge 없으면 relation 없음 — 단 입력에는 포함됨을 간접 확인 (결과 0건이지만 에러 없음)
    const result = await runBuildRelations({ repoId: REPO_ID, db, includeTestSources: true })
    expect(result.relationsCount).toBe(0) // edge 없으니 relation 없음
  })
})

// ── REL-N03: source regex only ────────────────────────────

describe('REL-N03: source regex only', () => {
  it('graph anchor 없이 source code 패턴만 있으면 relation 저장 안 함', async () => {
    const db = createTestDb()
    seed(db)

    // 노드만 있고 edge 없음
    db.insert(codeNodes).values({
      id: `${REPO_ID}:src/app.ts:handler`,
      repoId: REPO_ID,
      type: 'function',
      filePath: 'src/app.ts',
      name: 'handler',
      isTest: false,
      parseStatus: 'ok',
      exported: false,
      isDefaultExport: false,
      isAsync: false,
    }).run()

    const result = await runBuildRelations({ repoId: REPO_ID, db })
    expect(result.relationsCount).toBe(0)
  })
})

describe('phase status', () => {
  it('runBuildRelations records a fresh build_relations phase status after success', async () => {
    const db = createTestDb()
    seed(db)

    await runBuildRelations({ repoId: REPO_ID, db })

    const status = db.select().from(repositoryPhaseStatus).where(and(
      eq(repositoryPhaseStatus.repositoryId, REPO_ID),
      eq(repositoryPhaseStatus.phase, 'build_relations'),
    )).get()

    expect(status).toMatchObject({
      repositoryId: REPO_ID,
      phase: 'build_relations',
      validity: 'fresh',
    })
    expect(status?.builtAt).toBeTruthy()
  })
})

describe('repository existence guards', () => {
  it('loadInputs fails when repository does not exist', async () => {
    const db = createTestDb()

    await expect(loadInputs({ repoId: 'missing-repo', db })).rejects.toThrow('Repository not found: missing-repo')
  })

  it('runBuildRelations fails when repository does not exist', async () => {
    const db = createTestDb()

    await expect(runBuildRelations({ repoId: 'missing-repo', db })).rejects.toThrow('Repository not found: missing-repo')
  })

  it('loadInputs tolerates legacy nullable repoPath/model orm rows', async () => {
    const rows = [
      { kind: 'get', value: { id: REPO_ID, repoPath: null } },
      { kind: 'all', value: [] },
      { kind: 'all', value: [] },
      { kind: 'all', value: [{ name: 'User', tableName: 'users', orm: null }] },
    ]
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            get: () => rows.shift()?.value,
            all: () => rows.shift()?.value,
          }),
        }),
      }),
    } as unknown as DB

    const result = await loadInputs({ repoId: REPO_ID, db: fakeDb })

    expect(result.repoPath).toBeNull()
    expect(result.models).toEqual([{ modelName: 'User', tableName: 'users', orm: 'unknown' }])
  })

  it('runBuildRelations marks the run failed when a step throws after run start', async () => {
    function fakeDbThatThrows(error: unknown): DB {
      let selectCount = 0
      return {
      select: () => {
        selectCount += 1
        if (selectCount === 1) {
          return { from: () => ({ where: () => ({ get: () => ({ projectId: PROJ_ID }) }) }) }
        }
        return { from: () => ({ where: () => ({ get: () => { throw error } }) }) }
      },
      insert: () => ({
        values: () => ({
          run: () => undefined,
          returning: () => ({ get: () => ({ id: 1 }) }),
          onConflictDoUpdate: () => ({ run: () => undefined }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({ run: () => undefined }),
        }),
      }),
      } as unknown as DB
    }

    await expect(runBuildRelations({ repoId: REPO_ID, db: fakeDbThatThrows('load failed') })).rejects.toBe('load failed')
    await expect(runBuildRelations({ repoId: REPO_ID, db: fakeDbThatThrows(new Error('load failed')) })).rejects.toThrow('load failed')
  })
})

// ── REL-P02 evidence id 정책: edge:<id> 우선 ─────────────

describe('evidence id 정책: edge:<id> prefix', () => {
  it('normalizeRelations: evidenceNodeIds에 edge:<id> prefix 보존', () => {
    const relations = [
      {
        sourceNodeId: 'node-1',
        kind: 'db_access' as const,
        target: 'users',
        operation: 'select',
        canonicalTarget: 'db:users:select',
        payload: { orm: 'prisma' },
        evidenceNodeIds: ['edge:42', 'edge:43'],
        confidence: 'high' as const,
      },
    ]

    const normalized = normalizeRelations(relations)
    expect(normalized[0].evidenceNodeIds).toEqual(['edge:42', 'edge:43'])
  })
})

// ── schedule_trigger canonicalTarget=null 허용 ────────────

describe('schedule_trigger canonicalTarget=null 정책', () => {
  it('schedule_trigger만 canonicalTarget=null 저장 허용', async () => {
    const db = createTestDb()
    seed(db)

    const markerRelations: NormalizedCodeRelation[] = [
      {
        sourceNodeId: 'node-sched',
        kind: 'schedule_trigger',
        target: null,
        operation: 'trigger',
        canonicalTarget: null,
        payload: { schedule_type: 'cron', cron: '0 * * * *', handler_node_id: 'node-sched' },
        evidenceNodeIds: ['edge:99'],
        confidence: 'high',
        dedupeKey: 'node-sched:schedule_trigger:cron:0 * * * *',
      },
    ]

    await persistCodeRelations(db, REPO_ID, markerRelations)

    const rows = db.select().from(codeRelations).where(eq(codeRelations.repoId, REPO_ID)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].canonicalTarget).toBeNull()
    expect(rows[0].unresolvedReason).toBeNull()
    expect(rows[0].kind).toBe('schedule_trigger')
  })
})

// ── idempotent rerun ──────────────────────────────────────

describe('idempotent rerun', () => {
  it('동일 입력으로 두 번 실행해도 결과 동일', async () => {
    const db = createTestDb()
    seed(db)

    const relations: NormalizedCodeRelation[] = [
      {
        sourceNodeId: 'node-x',
        kind: 'navigation',
        target: '/home',
        operation: 'push',
        canonicalTarget: 'screen:/home',
        payload: {},
        evidenceNodeIds: ['edge:1'],
        confidence: 'high',
        dedupeKey: 'node-x:navigation:screen:/home:push',
      },
    ]

    await persistCodeRelations(db, REPO_ID, relations)
    const first = db.select().from(codeRelations).where(eq(codeRelations.repoId, REPO_ID)).all()

    await persistCodeRelations(db, REPO_ID, relations)
    const second = db.select().from(codeRelations).where(eq(codeRelations.repoId, REPO_ID)).all()

    expect(second).toHaveLength(1)
    expect(second[0].id).toBe(first[0].id)
  })
})

describe('relationsForReachableNodes', () => {
  it('returns relations on seed and calls/type_resolved reachable nodes up to maxHops', async () => {
    const db = createTestDb()
    seed(db)

    for (const id of ['seed', 'callee', 'typeTarget', 'callback', 'ignoredRender', 'tooFar']) {
      db.insert(codeNodes).values({
        id,
        repoId: REPO_ID,
        type: 'function',
        filePath: id === 'callback' ? 'src/seed.ts' : `src/${id}.ts`,
        name: id,
        lineStart: id === 'callback' ? 2 : 1,
        lineEnd: id === 'callback' ? 3 : 10,
        isTest: false,
        parseStatus: 'ok',
        exported: false,
        isDefaultExport: false,
        isAsync: false,
      }).run()
    }

    db.insert(codeEdges).values([
      { repoId: REPO_ID, sourceId: 'seed', targetId: 'callee', relation: 'calls', resolveStatus: 'resolved', source: 'static' },
      { repoId: REPO_ID, sourceId: 'seed', targetId: 'callback', relation: 'contains', resolveStatus: 'resolved', source: 'static' },
      { repoId: REPO_ID, sourceId: 'callee', targetId: 'typeTarget', relation: 'type_resolved', resolveStatus: 'resolved', source: 'static' },
      { repoId: REPO_ID, sourceId: 'typeTarget', targetId: 'tooFar', relation: 'calls', resolveStatus: 'resolved', source: 'static' },
      { repoId: REPO_ID, sourceId: 'seed', targetId: 'ignoredRender', relation: 'renders', resolveStatus: 'resolved', source: 'static' },
      { repoId: REPO_ID, sourceId: 'seed', targetId: null, relation: 'calls', resolveStatus: 'unresolved', source: 'static' },
    ]).run()

    await persistCodeRelations(db, REPO_ID, [
      { sourceNodeId: 'seed', kind: 'navigation', target: '/home', operation: 'push', canonicalTarget: 'screen:/home', payload: {}, evidenceNodeIds: [], confidence: 'high', dedupeKey: 'seed:navigation:screen:/home:push' },
      { sourceNodeId: 'callee', kind: 'api_call', target: '/api', operation: 'GET', canonicalTarget: 'GET /api', payload: {}, evidenceNodeIds: [], confidence: 'high', dedupeKey: 'callee:api_call:GET /api:GET' },
      { sourceNodeId: 'callback', kind: 'api_call', target: '/api/callback', operation: 'GET', canonicalTarget: 'GET /api/callback', payload: {}, evidenceNodeIds: [], confidence: 'high', dedupeKey: 'callback:api_call:GET /api/callback:GET' },
      { sourceNodeId: 'typeTarget', kind: 'db_access', target: 'users', operation: 'select', canonicalTarget: 'db:users:select', payload: {}, evidenceNodeIds: [], confidence: 'high', dedupeKey: 'typeTarget:db_access:db:users:select:select' },
      { sourceNodeId: 'ignoredRender', kind: 'external_link', target: 'https://example.com', operation: 'open', canonicalTarget: 'external:https://example.com', payload: {}, evidenceNodeIds: [], confidence: 'high', dedupeKey: 'ignoredRender:external_link:external:https://example.com:open' },
      { sourceNodeId: 'tooFar', kind: 'event_publish', target: 'order.created', operation: 'publish', canonicalTarget: 'node_event:order.created', payload: {}, evidenceNodeIds: [], confidence: 'high', dedupeKey: 'tooFar:event_publish:node_event:order.created:publish' },
    ])

    const rows = await relationsForReachableNodes({ db, repoId: REPO_ID, seedIds: ['seed'], maxHops: 2 })

    expect(rows.map((row) => row.sourceNodeId).sort()).toEqual(['callback', 'callee', 'seed', 'typeTarget'])
  })

  it('with maxHops=0 returns only seed node relations', async () => {
    const db = createTestDb()
    seed(db)
    await persistCodeRelations(db, REPO_ID, [
      { sourceNodeId: 'seed', kind: 'navigation', target: '/home', operation: 'push', canonicalTarget: 'screen:/home', payload: {}, evidenceNodeIds: [], confidence: 'high', dedupeKey: 'seed:navigation:screen:/home:push' },
      { sourceNodeId: 'callee', kind: 'api_call', target: '/api', operation: 'GET', canonicalTarget: 'GET /api', payload: {}, evidenceNodeIds: [], confidence: 'high', dedupeKey: 'callee:api_call:GET /api:GET' },
    ])

    const rows = await relationsForReachableNodes({ db, repoId: REPO_ID, seedIds: ['seed'], maxHops: 0 })

    expect(rows.map((row) => row.sourceNodeId)).toEqual(['seed'])
  })

  it('does not loop or duplicate relations when reachable graph contains cycles', async () => {
    const db = createTestDb()
    seed(db)

    for (const id of ['seed', 'callee']) {
      db.insert(codeNodes).values({
        id,
        repoId: REPO_ID,
        type: 'function',
        filePath: `src/${id}.ts`,
        name: id,
        isTest: false,
        parseStatus: 'ok',
        exported: false,
        isDefaultExport: false,
        isAsync: false,
      }).run()
    }

    db.insert(codeEdges).values([
      { repoId: REPO_ID, sourceId: 'seed', targetId: 'callee', relation: 'calls', resolveStatus: 'resolved', source: 'static' },
      { repoId: REPO_ID, sourceId: 'callee', targetId: 'seed', relation: 'calls', resolveStatus: 'resolved', source: 'static' },
    ]).run()

    await persistCodeRelations(db, REPO_ID, [
      { sourceNodeId: 'seed', kind: 'navigation', target: '/home', operation: 'push', canonicalTarget: 'screen:/home', payload: {}, evidenceNodeIds: [], confidence: 'high', dedupeKey: 'seed:navigation:screen:/home:push' },
      { sourceNodeId: 'callee', kind: 'api_call', target: '/api', operation: 'GET', canonicalTarget: 'GET /api', payload: {}, evidenceNodeIds: [], confidence: 'high', dedupeKey: 'callee:api_call:GET /api:GET' },
    ])

    const rows = await relationsForReachableNodes({ db, repoId: REPO_ID, seedIds: ['seed'], maxHops: 4 })

    expect(rows.map((row) => row.sourceNodeId).sort()).toEqual(['callee', 'seed'])
  })
})
