import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type DB } from '../../server/helpers.js'
import { projects, repositories } from '@/db/schema/core.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import {
  codeBundles,
  entryPoints,
  frameworkDetections,
} from '@/db/schema/build_route.js'
import { selectDocumentTargets } from '@/pipeline_modules/build_docs/source/target_selector.js'
import { persistResults } from '@/pipeline_modules/build_route/f6_persist_results.js'
import type {
  EntryPointDraft,
  FrameworkDetectionResult,
} from '@/pipeline_modules/build_route/types.js'

const REPO = 'r1'
const PROJECT = 'p1'
const HANDLER = 'r1:src/handler.ts:list'
const RENAMED_HANDLER = 'r1:src/handler.ts:listRenamed'
const UTIL = 'r1:src/util.ts:format'

let db: DB

beforeEach(() => {
  db = createTestDb()
  db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
  db.insert(repositories).values({ id: REPO, projectId: PROJECT, name: 'r', repoPath: '.' }).run()
  db.insert(codeNodes).values({
    id: HANDLER, repoId: REPO, type: 'method', filePath: 'src/handler.ts', name: 'list',
  }).run()
  db.insert(codeNodes).values({
    id: RENAMED_HANDLER, repoId: REPO, type: 'method', filePath: 'src/handler.ts', name: 'listRenamed',
  }).run()
  db.insert(codeNodes).values({
    id: UTIL, repoId: REPO, type: 'function', filePath: 'src/util.ts', name: 'format',
  }).run()
})

function draft(overrides: Partial<EntryPointDraft> = {}): EntryPointDraft {
  return {
    framework: 'nestjs',
    kind: 'api',
    httpMethod: 'GET',
    path: '/list',
    fullPath: '/orders/list',
    handlerNodeId: HANDLER,
    metadata: {},
    detectionSource: 'rule:nestjs',
    confidence: 'high',
    detectionEvidence: { matchedRuleId: 'r1', matchedNodeIds: [HANDLER], matchedEdgeIds: [] },
    ...overrides,
  }
}

function det(overrides: Partial<FrameworkDetectionResult> = {}): FrameworkDetectionResult {
  return {
    framework: 'nestjs',
    detectedVia: 'manifest',
    evidence: { dep: '@nestjs/core' },
    active: true,
    priority: 50,
    exclusiveWith: [],
    ...overrides,
  }
}

describe('빈 입력', () => {
  it('변화 없음', async () => {
    await persistResults({ db, repoId: REPO, detections: [], entryPoints: [] })
    expect(db.select().from(entryPoints).all()).toEqual([])
    expect(db.select().from(frameworkDetections).all()).toEqual([])
  })
})

describe('replace-safe snapshot persistence', () => {
  it('현재 snapshot에서 사라진 entry_points와 code_bundles를 삭제한다', async () => {
    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [draft()],
      bundles: [
        { entryPointId: `${REPO}:nestjs:api:GET:/orders/list:${HANDLER}`, nodeId: HANDLER, depth: 0 },
        { entryPointId: `${REPO}:nestjs:api:GET:/orders/list:${HANDLER}`, nodeId: UTIL, depth: 1 },
      ],
    })

    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [],
      bundles: [],
    })

    expect(db.select().from(entryPoints).all()).toEqual([])
    expect(db.select().from(codeBundles).all()).toEqual([])
  })

  it('사라진 entry_point는 build_docs 대상에서도 제외한다', async () => {
    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [draft()],
    })
    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [],
      bundles: [],
    })

    await expect(selectDocumentTargets(REPO, db, PROJECT)).resolves.toEqual([])
  })

  it('핸들러 rename 시 이전 entry_point를 삭제하고 새 entry_point만 남긴다', async () => {
    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [draft()],
      bundles: [
        { entryPointId: `${REPO}:nestjs:api:GET:/orders/list:${HANDLER}`, nodeId: HANDLER, depth: 0 },
      ],
    })

    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [draft({ handlerNodeId: RENAMED_HANDLER })],
      bundles: [
        { entryPointId: `${REPO}:nestjs:api:GET:/orders/list:${RENAMED_HANDLER}`, nodeId: RENAMED_HANDLER, depth: 0 },
      ],
    })

    const rows = db.select().from(entryPoints).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: `${REPO}:nestjs:api:GET:/orders/list:${RENAMED_HANDLER}`,
      handlerNodeId: RENAMED_HANDLER,
    })
    expect(db.select().from(codeBundles).all()).toEqual([
      { entryPointId: `${REPO}:nestjs:api:GET:/orders/list:${RENAMED_HANDLER}`, nodeId: RENAMED_HANDLER, depth: 0, edgePath: null },
    ])
  })

  it('현재 entry_point의 사라진 code_bundles를 삭제한다', async () => {
    const entryPointId = `${REPO}:nestjs:api:GET:/orders/list:${HANDLER}`
    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [draft()],
      bundles: [
        { entryPointId, nodeId: HANDLER, depth: 0 },
        { entryPointId, nodeId: UTIL, depth: 1 },
      ],
    })

    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [draft()],
      bundles: [{ entryPointId, nodeId: HANDLER, depth: 0 }],
    })

    expect(db.select().from(codeBundles).all()).toEqual([
      { entryPointId, nodeId: HANDLER, depth: 0, edgePath: null },
    ])
  })
})

describe('entry_points INSERT', () => {
  it('1개 INSERT + SELECT', async () => {
    await persistResults({
      db, repoId: REPO,
      detections: [],
      entryPoints: [draft()],
    })
    const rows = db.select().from(entryPoints).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      framework: 'nestjs',
      kind: 'api',
      httpMethod: 'GET',
      path: '/list',
      fullPath: '/orders/list',
      handlerNodeId: HANDLER,
      detectionSource: 'rule:nestjs',
      confidence: 'high',
    })
  })

  it('idempotent: 두 번 호출 → 1 row (UPSERT)', async () => {
    await persistResults({ db, repoId: REPO, detections: [], entryPoints: [draft()] })
    await persistResults({ db, repoId: REPO, detections: [], entryPoints: [draft()] })
    expect(db.select().from(entryPoints).all()).toHaveLength(1)
  })

  it('두 번째 호출 시 metadata 갱신 (UPSERT)', async () => {
    await persistResults({
      db, repoId: REPO, detections: [],
      entryPoints: [draft({ metadata: { v: 1 } })],
    })
    await persistResults({
      db, repoId: REPO, detections: [],
      entryPoints: [draft({ metadata: { v: 2 } })],
    })
    const rows = db.select().from(entryPoints).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].metadata).toEqual({ v: 2, source: 'adapter' })
  })

  it('normalizes route source attribution at the persistence boundary', async () => {
    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [
        draft({ detectionSource: 'rule:nestjs' }),
        draft({
          path: '/source',
          fullPath: '/source',
          detectionSource: 'source:nextjs',
        }),
        draft({
          path: '/fallback',
          fullPath: '/fallback',
          detectionSource: 'llm:haiku',
          metadata: { routeResolution: 'llm_fallback' },
        }),
      ],
    })

    const metadataByPath = new Map(
      db.select().from(entryPoints).all().map((row) => [row.fullPath, row.metadata]),
    )
    expect(metadataByPath.get('/orders/list')).toMatchObject({ source: 'adapter' })
    expect(metadataByPath.get('/source')).toMatchObject({ source: 'source_fallback' })
    expect(metadataByPath.get('/fallback')).toMatchObject({ source: 'route_llm_fallback' })
  })

  it('http_method 다르면 별 row', async () => {
    await persistResults({
      db, repoId: REPO, detections: [],
      entryPoints: [draft({ httpMethod: 'GET' }), draft({ httpMethod: 'POST' })],
    })
    expect(db.select().from(entryPoints).all()).toHaveLength(2)
  })

  it('fullPath 없으면 path 기반 id로 저장하고 nullable fields는 null 처리', async () => {
    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [draft({ fullPath: undefined, parentPath: undefined, httpMethod: undefined })],
    })

    const row = db.select().from(entryPoints).all()[0]!
    expect(row.id).toBe(`${REPO}:nestjs:api::/list:${HANDLER}`)
    expect(row.httpMethod).toBeNull()
    expect(row.parentPath).toBeNull()
    expect(row.fullPath).toBeNull()
  })

  it('fullPath와 path가 모두 없으면 빈 path segment 기반 id로 저장', async () => {
    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [draft({ kind: 'job', httpMethod: undefined, path: undefined, fullPath: undefined })],
    })

    const row = db.select().from(entryPoints).all()[0]!
    expect(row.id).toBe(`${REPO}:nestjs:job:::${HANDLER}`)
    expect(row.path).toBeNull()
  })
})

describe('framework_detections INSERT', () => {
  it('1건 INSERT', async () => {
    await persistResults({
      db, repoId: REPO,
      detections: [det()],
      entryPoints: [],
    })
    const rows = db.select().from(frameworkDetections).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      framework: 'nestjs',
      detectedVia: 'manifest',
      active: true,
    })
  })

  it('idempotent', async () => {
    await persistResults({ db, repoId: REPO, detections: [det()], entryPoints: [] })
    await persistResults({
      db, repoId: REPO,
      detections: [det({ active: false })],
      entryPoints: [],
    })
    const rows = db.select().from(frameworkDetections).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].active).toBe(false) // UPSERT
  })
})

describe('통합', () => {
  it('detections + entryPoints 동시 저장', async () => {
    await persistResults({
      db, repoId: REPO,
      detections: [det()],
      entryPoints: [draft(), draft({ httpMethod: 'POST', path: '/create' })],
    })
    expect(db.select().from(frameworkDetections).all()).toHaveLength(1)
    expect(db.select().from(entryPoints).all()).toHaveLength(2)
  })

  it('entry_point.id 형식 검증', async () => {
    await persistResults({ db, repoId: REPO, detections: [], entryPoints: [draft()] })
    const row = db.select().from(entryPoints).all()[0]
    // id = '{repoId}:{framework}:{kind}:{httpMethod}:{fullPath}:{handlerNodeId}'
    expect(row.id).toContain(REPO)
    expect(row.id).toContain('nestjs')
    expect(row.id).toContain('GET')
    expect(row.id).toContain('/orders/list')
    expect(row.id).toContain(HANDLER)
  })
})

describe('code_bundles UPSERT', () => {
  it('bundles가 있으면 depth/edgePath를 저장하고 재실행 시 갱신', async () => {
    const entry = draft()
    const entryPointId = `${REPO}:nestjs:api:GET:/orders/list:${HANDLER}`

    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [entry],
      bundles: [{ entryPointId, nodeId: HANDLER, depth: 1 }],
    })
    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [entry],
      bundles: [{ entryPointId, nodeId: HANDLER, depth: 2, edgePath: ['calls'] }],
    })

    const rows = db.select().from(codeBundles).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ entryPointId, nodeId: HANDLER, depth: 2, edgePath: ['calls'] })
  })
})
