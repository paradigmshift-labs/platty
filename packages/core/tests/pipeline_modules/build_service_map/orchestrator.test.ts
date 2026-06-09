/**
 * build_service_map orchestrator + F1~F9 통합 단위 테스트
 * 시나리오 MAP-01~MAP-34, MAP-N01~MAP-N09 커버
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { and, eq } from 'drizzle-orm'
import * as schema from '@/db/schema/index.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { entryPoints, codeBundles } from '@/db/schema/build_route.js'
import { codeRelations } from '@/db/schema/build_relations.js'
import { documents, docDeps } from '@/db/schema/build_docs.js'
import { serviceMapEdges, serviceMapNodes } from '@/db/schema/build_service_map.js'
import { runBuildServiceMap } from '@/pipeline_modules/build_service_map/index.js'

type DB = ReturnType<typeof drizzle<typeof schema>>

function createTestDb(): DB {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './src/db/migrations' })
  return db
}

// ────────────────────────────────────────
// Seed helpers
// ────────────────────────────────────────

let db: DB
let projectId: string
let repoId: string

beforeEach(() => {
  db = createTestDb()
  projectId = 'proj-1'
  repoId = 'repo-1'
  db.insert(projects).values({ id: projectId, name: 'Test Project' }).run()
  db.insert(repositories).values({ id: repoId, projectId, name: 'repo', repoPath: '/repo', isPublic: false }).run()
})

function gitRepoWithCommit(label: string) {
  const dir = mkdtempSync(join(tmpdir(), `platty-service-map-${label}-`))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(join(dir, 'file.txt'), label)
  execFileSync('git', ['add', 'file.txt'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', `init ${label}`], { cwd: dir })
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  return { dir, commit }
}

function seedRepo(id: string, name: string) {
  db.insert(repositories).values({ id, projectId, name, repoPath: `/repos/${name}` }).run()
}

function seedNode(id: string, filePath: string, name: string, type = 'function', nodeRepoId = repoId) {
  db.insert(codeNodes).values({ id, repoId: nodeRepoId, filePath, name, type, isExported: false, isDefaultExport: false }).run()
}

function seedEP(id: string, opts: {
  kind: 'api' | 'page' | 'job' | 'event'
  path?: string | null
  httpMethod?: string | null
  handlerNodeId: string
  framework?: string
  metadata?: Record<string, unknown>
  repoId?: string
}) {
  db.insert(entryPoints).values({
    id,
    repoId: opts.repoId ?? repoId,
    framework: opts.framework ?? 'nestjs',
    kind: opts.kind,
    httpMethod: opts.httpMethod ?? null,
    path: opts.path ?? null,
    fullPath: opts.path ?? null,
    handlerNodeId: opts.handlerNodeId,
    confidence: 'high',
    detectionSource: 'rule:test',
  }).run()
  if (opts.metadata) {
    db.update(entryPoints)
      .set({ metadata: opts.metadata })
      .where(eq(entryPoints.id, id))
      .run()
  }
}

function seedBundle(entryPointId: string, nodeId: string, depth = 0) {
  db.insert(codeBundles).values({ entryPointId, nodeId, depth }).run()
}

function seedRelation(id: string, opts: {
  sourceNodeId: string
  kind: string
  target?: string | null
  operation?: string | null
  canonicalTarget?: string | null
  payload?: Record<string, unknown>
  confidence?: string
  repoId?: string
}) {
  db.insert(codeRelations).values({
    id,
    repoId: opts.repoId ?? repoId,
    sourceNodeId: opts.sourceNodeId,
    kind: opts.kind,
    target: opts.target ?? null,
    operation: opts.operation ?? null,
    canonicalTarget: opts.canonicalTarget ?? null,
    payload: opts.payload ?? {},
    evidenceNodeIds: [],
    confidence: opts.confidence ?? 'high',
  }).run()
}

function seedDocument(id: string, opts: {
  scopeId?: string | null
  relationFacts?: unknown[]
}) {
  db.insert(documents).values({
    id,
    projectId,
    type: 'api_doc',
    track: 'api',
    scope: 'entry_point',
    scopeId: opts.scopeId ?? null,
    status: 'passed',
    validity: 'fresh',
    content: { relation_facts: opts.relationFacts ?? [] },
    rawLlmOutput: '',
  }).run()
}

function getEdges() {
  return db.select().from(serviceMapEdges).all()
}

function getServiceMapNodes() {
  return db.select().from(serviceMapNodes).all()
}

describe('service_map_edges logical uniqueness', () => {
  it('DB constraint rejects duplicate logical edges with different ids', () => {
    const row = {
      repoId,
      runId: 'run-1',
      sourceType: 'screen' as const,
      sourceId: 'ep-screen',
      targetType: 'api' as const,
      targetId: 'ep-api',
      kind: 'calls_api' as const,
      canonicalTarget: 'GET /api/me',
      confidence: 'high' as const,
      source: 'deterministic' as const,
      evidence: {},
    }

    db.insert(serviceMapEdges).values({ id: 'edge-1', ...row }).run()

    expect(() => {
      db.insert(serviceMapEdges).values({ id: 'edge-2', ...row }).run()
    }).toThrow()
  })
})

describe('service map phase metadata', () => {
  it('records the analysis worktree commit instead of the source repo working branch commit', async () => {
    const sourceRepo = gitRepoWithCommit('source-branch')
    const analysisWorktree = gitRepoWithCommit('analysis-main')

    db.update(repositories)
      .set({
        repoPath: sourceRepo.dir,
        analysisWorktreePath: analysisWorktree.dir,
        lastSyncedCommit: analysisWorktree.commit,
      })
      .where(eq(repositories.id, repoId))
      .run()

    await runBuildServiceMap({ db, repoId })

    const phase = db.select().from(repositoryPhaseStatus)
      .where(and(
        eq(repositoryPhaseStatus.repositoryId, repoId),
        eq(repositoryPhaseStatus.phase, 'build_service_map'),
      ))
      .get()

    expect(phase?.sourceCommit).toBe(analysisWorktree.commit)
    expect(phase?.builtFromCommit).toBe(analysisWorktree.commit)
    expect(phase?.sourceCommit).not.toBe(sourceRepo.commit)
  })
})

describe('project-level service map graph persistence', () => {
  it('connects a source entrypoint in one repo to a target entrypoint in another repo', async () => {
    const uiRepoId = 'repo-ui'
    const apiRepoId = 'repo-api'
    seedRepo(uiRepoId, 'ui')
    seedRepo(apiRepoId, 'api')
    seedNode('node-checkout', 'apps/ui/pages/checkout.tsx', 'CheckoutPage', 'function', uiRepoId)
    seedNode('node-orders-api', 'apps/api/routes/orders.ts', 'OrdersController', 'function', apiRepoId)
    seedEP('ep-checkout', { repoId: uiRepoId, kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout', framework: 'react' })
    seedEP('ep-orders', { repoId: apiRepoId, kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders-api', framework: 'nestjs' })
    seedBundle('ep-checkout', 'node-checkout')
    seedRelation('rel-cross-repo', {
      repoId: uiRepoId,
      sourceNodeId: 'node-checkout',
      kind: 'api_call',
      canonicalTarget: 'POST /api/orders',
      operation: 'POST',
    })

    const result = await runBuildServiceMap({ db, projectId })
    const edges = getEdges()

    expect(result.insertedEdges).toBe(1)
    expect(edges).toHaveLength(1)
    expect(edges[0].projectId).toBe(projectId)
    expect(edges[0].repoId).toBe(uiRepoId)
    expect(edges[0].sourceRepoId).toBe(uiRepoId)
    expect(edges[0].targetRepoId).toBe(apiRepoId)
    expect(edges[0].sourceType).toBe('screen')
    expect(edges[0].sourceId).toBe('ep-checkout')
    expect(edges[0].targetType).toBe('api')
    expect(edges[0].targetId).toBe('ep-orders')
    expect(edges[0].sourceNodeId).toBeTruthy()
    expect(edges[0].targetNodeId).toBeTruthy()
  })

  it('persists service_map_nodes for source and target nodes while preserving legacy edge columns', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders-api', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders-api' })
    seedBundle('ep-checkout', 'node-checkout')
    seedRelation('rel-1', {
      sourceNodeId: 'node-checkout',
      kind: 'api_call',
      canonicalTarget: 'POST /api/orders',
      operation: 'POST',
    })

    await runBuildServiceMap({ db, projectId })
    const edges = getEdges()
    const nodes = getServiceMapNodes()

    expect(edges).toHaveLength(1)
    expect(nodes).toHaveLength(2)
    expect(edges[0].sourceType).toBe('screen')
    expect(edges[0].sourceId).toBe('ep-checkout')
    expect(edges[0].targetType).toBe('api')
    expect(edges[0].targetId).toBe('ep-orders')
    expect(nodes.map((node) => node.id)).toEqual(expect.arrayContaining([edges[0].sourceNodeId, edges[0].targetNodeId]))
    expect(nodes.find((node) => node.id === edges[0].sourceNodeId)).toMatchObject({
      projectId,
      repoId,
      type: 'screen',
      sourceKind: 'entry_point',
      sourceId: 'ep-checkout',
      canonicalKey: 'screen:ep-checkout',
      label: 'Checkout',
    })
    expect(nodes.find((node) => node.id === edges[0].targetNodeId)).toMatchObject({
      projectId,
      repoId,
      type: 'api',
      sourceKind: 'entry_point',
      sourceId: 'ep-orders',
      canonicalKey: 'api:ep-orders',
      label: 'OrdersController',
    })
  })

  it('reuses the same service_map_node for duplicate logical nodes across multiple edges', async () => {
    seedNode('node-orders-api', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders-api' })
    seedBundle('ep-orders', 'node-orders-api')
    seedRelation('rel-db', {
      sourceNodeId: 'node-orders-api',
      kind: 'db_access',
      canonicalTarget: 'db:orders:insert',
      operation: 'insert',
    })
    seedRelation('rel-event', {
      sourceNodeId: 'node-orders-api',
      kind: 'event_publish',
      canonicalTarget: 'node_event:order.created',
      operation: 'publish',
    })

    await runBuildServiceMap({ db, projectId })
    const edges = getEdges()
    const nodes = getServiceMapNodes()
    const sourceNodeIds = new Set(edges.map((edge) => edge.sourceNodeId))

    expect(edges).toHaveLength(2)
    expect(sourceNodeIds.size).toBe(1)
    expect(nodes).toHaveLength(3)
    expect(nodes.find((node) => node.type === 'db')).toMatchObject({
      repoId: null,
      sourceKind: 'synthetic',
      sourceId: 'db:orders',
      canonicalKey: 'db:db:orders',
    })
    expect(nodes.find((node) => node.type === 'event')).toMatchObject({
      repoId: null,
      sourceKind: 'synthetic',
    })
  })

  it('removes stale service_map_nodes that are no longer referenced after rerun', async () => {
    seedNode('node-orders-api', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders-api' })
    seedBundle('ep-orders', 'node-orders-api')
    seedRelation('rel-db', {
      sourceNodeId: 'node-orders-api',
      kind: 'db_access',
      canonicalTarget: 'db:orders:insert',
      operation: 'insert',
    })

    await runBuildServiceMap({ db, projectId })
    expect(getEdges()).toHaveLength(1)
    expect(getServiceMapNodes()).toHaveLength(2)

    db.delete(codeRelations).where(eq(codeRelations.id, 'rel-db')).run()

    await runBuildServiceMap({ db, projectId })
    expect(getEdges()).toHaveLength(0)
    expect(getServiceMapNodes()).toHaveLength(0)
  })
})

// ────────────────────────────────────────
// MAP-01: screen -> api deterministic
// ────────────────────────────────────────
describe('MAP-01 screen -> api deterministic', () => {
  it('should create calls_api edge with source=deterministic confidence=high', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders-api', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders-api' })
    seedBundle('ep-checkout', 'node-checkout')
    seedRelation('rel-1', {
      sourceNodeId: 'node-checkout',
      kind: 'api_call',
      canonicalTarget: 'POST /api/orders',
      operation: 'POST',
      confidence: 'high',
    })

    const result = await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(result.insertedEdges).toBe(1)
    const edge = edges[0]
    expect(edge.sourceType).toBe('screen')
    expect(edge.sourceId).toBe('ep-checkout')
    expect(edge.targetType).toBe('api')
    expect(edge.targetId).toBe('ep-orders')
    expect(edge.kind).toBe('calls_api')
    expect(edge.source).toBe('deterministic')
    expect(edge.confidence).toBe('high')
    expect((edge.evidence as { relation_ids?: string[] }).relation_ids).toContain('rel-1')
  })
})

// ────────────────────────────────────────
// MAP-02: screen -> api doc_llm
// ────────────────────────────────────────
describe('MAP-02 screen -> api doc_llm', () => {
  it('should create calls_api edge with source=doc_llm confidence=medium', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders-api', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders-api' })
    seedDocument('doc-1', {
      scopeId: 'ep-checkout',
      relationFacts: [{ kind: 'api_call', canonical_target: 'POST /api/orders', source: 'llm', confidence: 'medium', target: '/api/orders', operation: 'POST', payload: {} }],
    })

    const result = await runBuildServiceMap({ db, repoId, opts: { includeDocumentFacts: true } })
    const edges = getEdges()

    expect(result.insertedEdges).toBe(1)
    const edge = edges[0]
    expect(edge.source).toBe('doc_llm')
    expect(edge.confidence).toBe('medium')
    expect((edge.evidence as { document_ids?: string[] }).document_ids).toContain('doc-1')
  })
})

// ────────────────────────────────────────
// MAP-03: deterministic + doc merge
// ────────────────────────────────────────
describe('MAP-03 deterministic + doc merge', () => {
  it('one edge, source=merged, confidence=high', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders-api', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders-api' })
    seedBundle('ep-checkout', 'node-checkout')
    seedRelation('rel-1', { sourceNodeId: 'node-checkout', kind: 'api_call', canonicalTarget: 'POST /api/orders', operation: 'POST' })
    seedDocument('doc-1', {
      scopeId: 'ep-checkout',
      relationFacts: [{ kind: 'api_call', canonical_target: 'POST /api/orders', source: 'llm', confidence: 'medium', target: '/api/orders', operation: 'POST', payload: {} }],
    })

    const result = await runBuildServiceMap({ db, repoId, opts: { includeDocumentFacts: true } })
    const edges = getEdges()

    expect(result.insertedEdges).toBe(1)
    expect(edges[0].source).toBe('merged')
    expect(edges[0].confidence).toBe('high')
    const evidence = edges[0].evidence as { relation_ids?: string[]; document_ids?: string[] }
    expect(evidence.relation_ids).toContain('rel-1')
    expect(evidence.document_ids).toContain('doc-1')
  })
})

// ────────────────────────────────────────
// MAP-04: api -> db
// ────────────────────────────────────────
describe('MAP-04 api -> db', () => {
  it('accesses_db edge with db:orders target node', async () => {
    seedNode('node-api', 'src/orders.ts', 'OrdersService')
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-api' })
    seedBundle('ep-orders', 'node-api')
    seedRelation('rel-1', { sourceNodeId: 'node-api', kind: 'db_access', canonicalTarget: 'db:orders:insert', operation: 'insert' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges).toHaveLength(1)
    expect(edges[0].kind).toBe('accesses_db')
    expect(edges[0].targetType).toBe('db')
    expect(edges[0].targetId).toBe('db:orders')
  })

  it('allows page-owned Supabase client DB access without allowing generic server DB access from pages', async () => {
    seedNode('node-screen', 'lib/screens/dashboard_screen.dart', 'DashboardScreen')
    seedEP('ep-dashboard', { kind: 'page', framework: 'flutter', path: '/dashboard', handlerNodeId: 'node-screen' })
    seedBundle('ep-dashboard', 'node-screen')
    seedRelation('rel-supabase', {
      sourceNodeId: 'node-screen',
      kind: 'db_access',
      canonicalTarget: 'db:profiles:select',
      operation: 'select',
      payload: { orm: 'supabase', adapter: 'supabase' },
    })
    seedRelation('rel-prisma', {
      sourceNodeId: 'node-screen',
      kind: 'db_access',
      canonicalTarget: 'db:orders:select',
      operation: 'select',
      payload: { orm: 'prisma', adapter: 'prisma' },
    })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges.map((edge) => edge.canonicalTarget)).toEqual(['db:profiles:select'])
    expect(edges[0].kind).toBe('accesses_db')
    expect(edges[0].targetId).toBe('db:profiles')
  })
})

// ────────────────────────────────────────
// MAP-05: api -> event -> listener
// ────────────────────────────────────────
describe('MAP-05 api -> event -> listener', () => {
  it('publishes_event + triggers edges', async () => {
    seedNode('node-api', 'src/orders.ts', 'OrdersService')
    seedNode('node-listener', 'src/listeners/order.ts', 'OrderListener')
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-api' })
    seedEP('ep-listener', {
      kind: 'event',
      handlerNodeId: 'node-listener',
      metadata: { canonicalTarget: 'node_event:order.created' },
    })
    seedBundle('ep-orders', 'node-api')
    seedBundle('ep-listener', 'node-listener')
    // api publishes
    seedRelation('rel-publish', { sourceNodeId: 'node-api', kind: 'event_publish', canonicalTarget: 'node_event:order.created' })
    // listener listens
    seedRelation('rel-listen', { sourceNodeId: 'node-listener', kind: 'event_listen', canonicalTarget: 'node_event:order.created' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    const publishEdge = edges.find((e) => e.kind === 'publishes_event')
    expect(publishEdge).toBeTruthy()
    expect(publishEdge!.sourceType).toBe('api')
    expect(publishEdge!.targetType).toBe('event')

    const triggerEdge = edges.find((e) => e.kind === 'triggers')
    expect(triggerEdge).toBeTruthy()
    expect(triggerEdge!.sourceType).toBe('event')
    expect(triggerEdge!.targetType).toBe('event')
    expect(triggerEdge!.targetId).toBe('ep-listener')
  })
})

// ────────────────────────────────────────
// MAP-08: screen -> screen
// ────────────────────────────────────────
describe('MAP-08 screen -> screen', () => {
  it('navigates edge', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-profile', 'pages/profile.tsx', 'Profile')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-profile', { kind: 'page', path: '/profile', handlerNodeId: 'node-profile' })
    seedBundle('ep-checkout', 'node-checkout')
    seedRelation('rel-1', { sourceNodeId: 'node-checkout', kind: 'navigation', canonicalTarget: 'screen:/profile' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges).toHaveLength(1)
    expect(edges[0].kind).toBe('navigates')
    expect(edges[0].sourceType).toBe('screen')
    expect(edges[0].targetType).toBe('screen')
  })
})

// ────────────────────────────────────────
// MAP-09: external URL/service
// ────────────────────────────────────────
describe('MAP-09 external link/service', () => {
  it('screen -> external_link', async () => {
    seedNode('node-settings', 'pages/settings.tsx', 'Settings')
    seedEP('ep-settings', { kind: 'page', path: '/settings', handlerNodeId: 'node-settings' })
    seedBundle('ep-settings', 'node-settings')
    seedRelation('rel-1', { sourceNodeId: 'node-settings', kind: 'navigation', canonicalTarget: 'external:https://docs.example.com' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges[0].kind).toBe('opens_external_link')
    expect(edges[0].targetType).toBe('external_link')
  })

  it('api -> external_service — MAP-14', async () => {
    seedNode('node-api', 'src/orders.ts', 'OrdersService')
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-api' })
    seedBundle('ep-orders', 'node-api')
    seedRelation('rel-1', { sourceNodeId: 'node-api', kind: 'api_call', canonicalTarget: 'external_service:stripe:v1/customers', operation: 'GET' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges[0].kind).toBe('uses_external_service')
    expect(edges[0].targetType).toBe('external_service')
    expect(edges[0].source).toBe('deterministic')
  })
})

// ────────────────────────────────────────
// MAP-10: api -> api
// ────────────────────────────────────────
describe('MAP-10 api -> api', () => {
  it('calls_api edge between two APIs', async () => {
    seedNode('node-orders', 'src/orders.ts', 'OrdersService')
    seedNode('node-users', 'src/users.ts', 'UsersService')
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedEP('ep-users', { kind: 'api', httpMethod: 'GET', path: '/api/users', handlerNodeId: 'node-users' })
    seedBundle('ep-orders', 'node-orders')
    seedRelation('rel-1', { sourceNodeId: 'node-orders', kind: 'api_call', canonicalTarget: 'GET /api/users', operation: 'GET' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges[0].kind).toBe('calls_api')
    expect(edges[0].sourceId).toBe('ep-orders')
    expect(edges[0].targetId).toBe('ep-users')
  })
})

// ────────────────────────────────────────
// MAP-12: job -> event -> job
// ────────────────────────────────────────
describe('MAP-12 job -> event -> job', () => {
  it('job->event->job chain', async () => {
    seedNode('node-cron', 'src/cron.ts', 'CronSettlementJob')
    seedNode('node-processor', 'src/processor.ts', 'SettlementProcessor')
    seedEP('ep-cron', { kind: 'job', handlerNodeId: 'node-cron' })
    seedEP('ep-processor', { kind: 'job', handlerNodeId: 'node-processor', metadata: { canonicalTarget: 'bull:settlement/process' } })
    seedBundle('ep-cron', 'node-cron')
    seedBundle('ep-processor', 'node-processor')
    seedRelation('rel-publish', { sourceNodeId: 'node-cron', kind: 'event_publish', canonicalTarget: 'bull:settlement/process' })
    seedRelation('rel-listen', { sourceNodeId: 'node-processor', kind: 'event_listen', canonicalTarget: 'bull:settlement/process' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    const publishEdge = edges.find((e) => e.kind === 'publishes_event')
    expect(publishEdge?.sourceType).toBe('job')

    const triggerEdge = edges.find((e) => e.kind === 'triggers')
    expect(triggerEdge?.sourceType).toBe('event')
    expect(triggerEdge?.targetType).toBe('job')
    expect(triggerEdge?.targetId).toBe('ep-processor')
  })
})

// ────────────────────────────────────────
// MAP-13: conflict (deterministic vs doc_llm different targets)
// ────────────────────────────────────────
describe('MAP-13 conflict', () => {
  it('two separate edges with conflict evidence', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedNode('node-cart', 'routes/cart.ts', 'CartController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedEP('ep-cart', { kind: 'api', httpMethod: 'POST', path: '/api/cart', handlerNodeId: 'node-cart' })
    seedBundle('ep-checkout', 'node-checkout')
    // deterministic says /api/orders
    seedRelation('rel-1', { sourceNodeId: 'node-checkout', kind: 'api_call', canonicalTarget: 'POST /api/orders', operation: 'POST' })
    // doc says /api/cart
    seedDocument('doc-1', {
      scopeId: 'ep-checkout',
      relationFacts: [{ kind: 'api_call', canonical_target: 'POST /api/cart', source: 'llm', confidence: 'medium', target: '/api/cart', operation: 'POST', payload: {} }],
    })

    await runBuildServiceMap({ db, repoId, opts: { includeDocumentFacts: true } })
    const edges = getEdges()

    expect(edges).toHaveLength(2)
    const detEdge = edges.find((e) => e.source === 'deterministic')
    const docEdge = edges.find((e) => e.source === 'doc_llm')
    expect(detEdge?.confidence).toBe('high')
    expect(docEdge?.confidence).toBe('medium')
  })
})

// ────────────────────────────────────────
// MAP-19: F3 source_node in multiple bundles → multiple edges
// ────────────────────────────────────────
describe('MAP-19 source_node in multiple bundles', () => {
  it('creates one edge per entrypoint', async () => {
    seedNode('node-helper', 'src/shared/helper.ts', 'SharedHelper')
    seedNode('node-api-a', 'src/a.ts', 'ApiA')
    seedNode('node-api-b', 'src/b.ts', 'ApiB')
    seedEP('ep-a', { kind: 'api', httpMethod: 'GET', path: '/api/a', handlerNodeId: 'node-api-a' })
    seedEP('ep-b', { kind: 'api', httpMethod: 'GET', path: '/api/b', handlerNodeId: 'node-api-b' })
    seedBundle('ep-a', 'node-helper')
    seedBundle('ep-b', 'node-helper')
    seedRelation('rel-1', { sourceNodeId: 'node-helper', kind: 'db_access', canonicalTarget: 'db:logs:insert' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges).toHaveLength(2)
    const sourceIds = edges.map((e) => e.sourceId).sort()
    expect(sourceIds).toContain('ep-a')
    expect(sourceIds).toContain('ep-b')
  })
})

// ────────────────────────────────────────
// MAP-20: F3 orphan source_node → no edge
// ────────────────────────────────────────
describe('MAP-20 orphan source_node', () => {
  it('no edge for orphan source node', async () => {
    seedNode('node-orphan', 'node_modules/lib.ts', 'LibHelper')
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orphan' })
    // orphanNodeId is NOT in any bundle
    seedRelation('rel-1', { sourceNodeId: 'orphanNodeId', kind: 'api_call', canonicalTarget: 'POST /api/orders' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges).toHaveLength(0)
  })
})

// ────────────────────────────────────────
// MAP-N01: dynamic suffix match
// ────────────────────────────────────────
describe('MAP-N01 suffix match', () => {
  it('source=suffix_match, confidence=medium', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedBundle('ep-checkout', 'node-checkout')
    seedRelation('rel-1', {
      sourceNodeId: 'node-checkout',
      kind: 'api_call',
      canonicalTarget: null,
      operation: 'POST',
      payload: { static_suffix: '/api/orders' },
    })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe('suffix_match')
    expect(edges[0].confidence).toBe('medium')
  })
})

// ────────────────────────────────────────
// MAP-N04: fully dynamic target → no edge
// ────────────────────────────────────────
describe('MAP-N04 fully dynamic target', () => {
  it('no edge created', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedBundle('ep-checkout', 'node-checkout')
    seedRelation('rel-1', {
      sourceNodeId: 'node-checkout',
      kind: 'api_call',
      canonicalTarget: null,
      payload: {},
    })

    const result = await runBuildServiceMap({ db, repoId })
    expect(result.insertedEdges).toBe(0)
    expect(result.unresolvedFacts).toBeGreaterThan(0)
  })
})

// ────────────────────────────────────────
// MAP-N05: low confidence exclusion
// ────────────────────────────────────────
describe('MAP-N05 low confidence exclusion', () => {
  it('low confidence not persisted by default', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedDocument('doc-1', {
      scopeId: 'ep-checkout',
      relationFacts: [{ kind: 'api_call', canonical_target: 'POST /api/orders', source: 'llm', confidence: 'low', target: '/api/orders', operation: 'POST', payload: {} }],
    })

    const result = await runBuildServiceMap({ db, repoId, opts: { includeLowConfidence: false, includeDocumentFacts: true } })
    expect(result.insertedEdges).toBe(0)
    expect(result.skippedLowConfidence).toBe(1)
  })

  it('low confidence persisted when includeLowConfidence=true', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedDocument('doc-1', {
      scopeId: 'ep-checkout',
      relationFacts: [{ kind: 'api_call', canonical_target: 'POST /api/orders', source: 'llm', confidence: 'low', target: '/api/orders', operation: 'POST', payload: {} }],
    })

    const result = await runBuildServiceMap({ db, repoId, opts: { includeLowConfidence: true, includeDocumentFacts: true } })
    expect(result.insertedEdges).toBe(1)
    expect(result.skippedLowConfidence).toBe(0)
  })
})

// ────────────────────────────────────────
// MAP-N06: event publish with no listener
// ────────────────────────────────────────
describe('MAP-N06 event publish no listener', () => {
  it('edge created, F9 warning present', async () => {
    seedNode('node-api', 'src/orders.ts', 'OrdersService')
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-api' })
    seedBundle('ep-orders', 'node-api')
    seedRelation('rel-1', { sourceNodeId: 'node-api', kind: 'event_publish', canonicalTarget: 'node_event:payment.completed' })

    const result = await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges).toHaveLength(1)
    expect(edges[0].kind).toBe('publishes_event')
    expect(result.warnings.some((w) => w.code === 'EVENT_NO_LISTENER')).toBe(true)
  })
})

// ────────────────────────────────────────
// MAP-N07: zero edges
// ────────────────────────────────────────
describe('MAP-N07 zero edges', () => {
  it('run does not fail, F9 warning emitted', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedBundle('ep-checkout', 'node-checkout')
    // all facts unresolved
    seedRelation('rel-1', { sourceNodeId: 'node-checkout', kind: 'api_call', canonicalTarget: null, payload: {} })
    seedDocument('doc-1', { scopeId: 'ep-checkout', relationFacts: [] })

    const result = await runBuildServiceMap({ db, repoId })
    expect(result.insertedEdges).toBe(0)
    expect(result.warnings.some((w) => w.code === 'ZERO_EDGES')).toBe(true)
  })
})

// ────────────────────────────────────────
// MAP-N08: duplicate/cycle → stable single edge
// ────────────────────────────────────────
describe('MAP-N08 duplicate/cycle', () => {
  it('one logical edge from duplicate facts', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedBundle('ep-checkout', 'node-checkout')
    seedRelation('rel-1', { sourceNodeId: 'node-checkout', kind: 'api_call', canonicalTarget: 'POST /api/orders' })
    seedRelation('rel-2', { sourceNodeId: 'node-checkout', kind: 'api_call', canonicalTarget: 'POST /api/orders' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges).toHaveLength(1)
  })
})

// ────────────────────────────────────────
// MAP-N09: event_listen 엣지 방향 역전
// ────────────────────────────────────────
describe('MAP-N09 event_listen edge direction', () => {
  it('sourceType=event, targetType=listener (not reversed)', async () => {
    seedNode('node-handler', 'src/order-handler.ts', 'OrderEventHandler')
    seedEP('ep-handler', { kind: 'event', handlerNodeId: 'node-handler', metadata: { canonicalTarget: 'node_event:order.created' } })
    seedBundle('ep-handler', 'node-handler')
    seedRelation('rel-listen', { sourceNodeId: 'node-handler', kind: 'event_listen', canonicalTarget: 'node_event:order.created' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges).toHaveLength(1)
    expect(edges[0].kind).toBe('triggers')
    expect(edges[0].sourceType).toBe('event')
    // targetType = the listener's entry_point type
    expect(edges[0].targetId).toBe('ep-handler')
    // Verify it's NOT listener→event (common mistake)
    expect(edges[0].sourceId).not.toBe('ep-handler')
  })
})

// ────────────────────────────────────────
// MAP-26: F8 re-run idempotency
// ────────────────────────────────────────
describe('MAP-26 re-run idempotency', () => {
  it('second run produces same edge count', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedBundle('ep-checkout', 'node-checkout')
    seedRelation('rel-1', { sourceNodeId: 'node-checkout', kind: 'api_call', canonicalTarget: 'POST /api/orders' })

    const r1 = await runBuildServiceMap({ db, repoId })
    const r2 = await runBuildServiceMap({ db, repoId })

    expect(r2.insertedEdges).toBe(r1.insertedEdges)
    expect(getEdges()).toHaveLength(r1.insertedEdges)
  })
})

// ────────────────────────────────────────
// MAP-28: F9 unresolved ratio > 50% → warning
// ────────────────────────────────────────
describe('MAP-28 high unresolved ratio', () => {
  it('warning emitted, run does not fail', async () => {
    seedNode('node-api', 'src/api.ts', 'Api')
    seedEP('ep-api', { kind: 'api', httpMethod: 'GET', path: '/api', handlerNodeId: 'node-api' })
    seedBundle('ep-api', 'node-api')
    // 1 resolved relation
    seedNode('node-db', 'src/db.ts', 'DbService')
    seedRelation('rel-resolved', { sourceNodeId: 'node-api', kind: 'db_access', canonicalTarget: 'db:orders:select' })
    // 6 unresolved (dynamic)
    for (let i = 0; i < 6; i++) {
      seedRelation(`rel-unresolved-${i}`, { sourceNodeId: 'node-api', kind: 'api_call', canonicalTarget: null, payload: {} })
    }

    const result = await runBuildServiceMap({ db, repoId })
    expect(result.warnings.some((w) => w.code === 'HIGH_UNRESOLVED_RATIO')).toBe(true)
  })
})

// ────────────────────────────────────────
// MAP-31: schedule_trigger → not unresolved
// ────────────────────────────────────────
describe('MAP-31 schedule_trigger canonical_target=null', () => {
  it('no unresolved warning for schedule_trigger', async () => {
    seedNode('node-cron', 'src/cron.ts', 'CronJob')
    seedEP('ep-cron', { kind: 'job', handlerNodeId: 'node-cron' })
    seedBundle('ep-cron', 'node-cron')
    seedRelation('rel-schedule', {
      sourceNodeId: 'node-cron',
      kind: 'schedule_trigger',
      canonicalTarget: null,
      payload: { cron: '0 0 * * *' },
    })

    const result = await runBuildServiceMap({ db, repoId })
    // schedule_trigger는 unresolved 카운트에 포함 안 됨
    expect(result.unresolvedFacts).toBe(0)
  })
})

// ────────────────────────────────────────
// MAP-33: GraphQL endpoint match
// ────────────────────────────────────────
describe('MAP-33 GraphQL endpoint match', () => {
  it('api -> api:graphql:GetUser', async () => {
    seedNode('node-resolver', 'src/resolver.ts', 'UserResolver')
    seedNode('node-api', 'src/gateway.ts', 'GatewayApi')
    // GraphQL entrypoint with canonical target
    seedEP('ep-graphql', { kind: 'api', handlerNodeId: 'node-resolver', metadata: { canonicalTarget: 'graphql:GetUser' }, path: '/graphql/GetUser' })
    seedEP('ep-gateway', { kind: 'api', httpMethod: 'POST', path: '/api/gateway', handlerNodeId: 'node-api' })
    seedBundle('ep-gateway', 'node-api')
    seedRelation('rel-1', { sourceNodeId: 'node-api', kind: 'api_call', canonicalTarget: 'graphql:GetUser', operation: 'POST' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges).toHaveLength(1)
    expect(edges[0].kind).toBe('calls_api')
    expect(edges[0].targetRepoId).toBe(repoId)
    expect(edges[0].canonicalTarget).toBe('graphql:GetUser')
  })
})

// ────────────────────────────────────────
// MAP-34: tRPC no entry_point → external_service
// ────────────────────────────────────────
describe('MAP-34 tRPC no entrypoint', () => {
  it('api -> external_service:trpc:user.list', async () => {
    seedNode('node-api', 'src/api.ts', 'Api')
    seedEP('ep-api', { kind: 'api', httpMethod: 'GET', path: '/api', handlerNodeId: 'node-api' })
    seedBundle('ep-api', 'node-api')
    seedRelation('rel-1', { sourceNodeId: 'node-api', kind: 'api_call', canonicalTarget: 'trpc:user.list' })

    await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges[0].kind).toBe('uses_external_service')
    expect(edges[0].targetType).toBe('external_service')
  })
})

// ────────────────────────────────────────
// MAP-16: F2 anchored via fact.relation_id
// ────────────────────────────────────────
describe('MAP-16 F2 doc fact anchored via relation_id', () => {
  it('sourceEntryPointId resolved via relation → bundle', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedBundle('ep-checkout', 'node-checkout')
    // code_relation exists so we can find its source_node_id → bundle → ep
    seedRelation('rel-001', { sourceNodeId: 'node-checkout', kind: 'api_call', canonicalTarget: 'POST /api/orders' })
    // doc fact references relation_id
    seedDocument('doc-1', {
      scopeId: null,
      relationFacts: [{
        kind: 'api_call',
        canonical_target: 'POST /api/orders',
        relation_id: 'rel-001',
        source: 'llm',
        confidence: 'medium',
        target: '/api/orders',
        operation: 'POST',
        payload: {},
      }],
    })

    await runBuildServiceMap({ db, repoId, opts: { includeDocumentFacts: true } })
    const edges = getEdges()

    // deterministic + doc_llm → merged
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe('merged')
  })
})

// ────────────────────────────────────────
// MAP-17: F2 anchored via scope_id
// ────────────────────────────────────────
describe('MAP-17 F2 doc fact anchored via scope_id', () => {
  it('sourceEntryPointId from documents.scope_id', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedDocument('doc-1', {
      scopeId: 'ep-checkout',
      relationFacts: [{
        kind: 'api_call',
        canonical_target: 'POST /api/orders',
        source: 'llm',
        confidence: 'medium',
        target: '/api/orders',
        operation: 'POST',
        payload: {},
      }],
    })

    await runBuildServiceMap({ db, repoId, opts: { includeDocumentFacts: true } })
    const edges = getEdges()

    expect(edges).toHaveLength(1)
    expect(edges[0].sourceId).toBe('ep-checkout')
    expect(edges[0].source).toBe('doc_llm')
  })
})

// ────────────────────────────────────────
// MAP-18: F2 anchored via doc_deps
// ────────────────────────────────────────
describe('MAP-18 F2 doc fact anchored via doc_deps', () => {
  it('sourceEntryPointId resolved via doc_deps → code_bundles', async () => {
    seedNode('node-handler', 'pages/checkout.tsx', 'CheckoutHandler')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-handler' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedBundle('ep-checkout', 'node-handler')
    seedDocument('doc-1', {
      scopeId: null,
      relationFacts: [{ kind: 'api_call', canonical_target: 'POST /api/orders', source: 'llm', confidence: 'medium', target: '/api/orders', operation: 'POST', payload: {} }],
    })
    // doc_deps: handlerNodeId → checkout entrypoint
    db.insert(docDeps).values({ documentId: 'doc-1', codeNodeId: 'node-handler', depType: 'entrypoint' }).run()

    await runBuildServiceMap({ db, repoId, opts: { includeDocumentFacts: true } })
    const edges = getEdges()

    expect(edges).toHaveLength(1)
    expect(edges[0].sourceId).toBe('ep-checkout')
  })
})

// ────────────────────────────────────────
// MAP-29: F9 doc fact with no entry_point → warning
// ────────────────────────────────────────
describe('MAP-29 doc fact no resolvable entry_point', () => {
  it('no edge, F9 warning', async () => {
    seedDocument('doc-1', {
      scopeId: null,
      relationFacts: [{ kind: 'api_call', canonical_target: 'POST /api/orders', source: 'llm', confidence: 'medium', target: '/api/orders', operation: 'POST', payload: {} }],
    })

    const result = await runBuildServiceMap({ db, repoId, opts: { includeDocumentFacts: true } })
    expect(result.insertedEdges).toBe(0)
    expect(result.warnings.some((w) => w.code === 'DOC_FACT_NO_ENTRY_POINT')).toBe(true)
  })
})

// ────────────────────────────────────────
// MAP-30: event broker prefix mismatch
// ────────────────────────────────────────
describe('MAP-30 event broker prefix mismatch', () => {
  it('no match between kafka and node_event prefixes', async () => {
    seedNode('node-api', 'src/api.ts', 'Api')
    seedNode('node-listener', 'src/listener.ts', 'Listener')
    seedEP('ep-api', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-api' })
    seedEP('ep-listener', { kind: 'event', handlerNodeId: 'node-listener', metadata: { canonicalTarget: 'node_event:order.created' } })
    seedBundle('ep-api', 'node-api')
    seedBundle('ep-listener', 'node-listener')
    seedRelation('rel-publish', { sourceNodeId: 'node-api', kind: 'event_publish', canonicalTarget: 'kafka:order.created' })
    seedRelation('rel-listen', { sourceNodeId: 'node-listener', kind: 'event_listen', canonicalTarget: 'node_event:order.created' })

    const result = await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    // api -> event:kafka:order.created created, but no trigger edge (different prefix)
    const publishEdge = edges.find((e) => e.kind === 'publishes_event')
    expect(publishEdge).toBeTruthy()
    const triggerEdge = edges.find((e) => e.kind === 'triggers' && e.sourceId.includes('kafka'))
    expect(triggerEdge).toBeUndefined()
    expect(result.warnings.some((w) => w.code === 'EVENT_NO_LISTENER')).toBe(true)
  })
})

// ────────────────────────────────────────
// MAP-MVP-01: includeDocumentFacts default false → F2 skipped
// ────────────────────────────────────────
describe('MAP-MVP-01 includeDocumentFacts default false skips F2', () => {
  it('ignores documents.relation_facts when option omitted (MVP default)', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedDocument('doc-1', {
      scopeId: 'ep-checkout',
      relationFacts: [{ kind: 'api_call', canonical_target: 'POST /api/orders', source: 'llm', confidence: 'medium', target: '/api/orders', operation: 'POST', payload: {} }],
    })

    const result = await runBuildServiceMap({ db, repoId })
    const edges = getEdges()

    expect(edges).toHaveLength(0)
    expect(result.insertedEdges).toBe(0)
  })

  it('does not emit DOC_FACT_NO_ENTRY_POINT warning when F2 skipped', async () => {
    seedDocument('doc-1', {
      scopeId: null,
      relationFacts: [{ kind: 'api_call', canonical_target: 'POST /api/orders', source: 'llm', confidence: 'medium', target: '/api/orders', operation: 'POST', payload: {} }],
    })

    const result = await runBuildServiceMap({ db, repoId })

    expect(result.warnings.some((w) => w.code === 'DOC_FACT_NO_ENTRY_POINT')).toBe(false)
  })

  it('deterministic-only path still works (F3 alone, F2 empty)', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedBundle('ep-checkout', 'node-checkout')
    seedRelation('rel-1', { sourceNodeId: 'node-checkout', kind: 'api_call', canonicalTarget: 'POST /api/orders', operation: 'POST' })

    const result = await runBuildServiceMap({ db, repoId })
    expect(result.insertedEdges).toBe(1)
  })
})

// ────────────────────────────────────────
// MAP-MVP-02: includeDocumentFacts true → F2 re-enabled
// ────────────────────────────────────────
describe('MAP-MVP-02 includeDocumentFacts true enables F2', () => {
  it('processes documents.relation_facts when option true', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedDocument('doc-1', {
      scopeId: 'ep-checkout',
      relationFacts: [{ kind: 'api_call', canonical_target: 'POST /api/orders', source: 'llm', confidence: 'medium', target: '/api/orders', operation: 'POST', payload: {} }],
    })

    const result = await runBuildServiceMap({ db, repoId, opts: { includeDocumentFacts: true } })
    const edges = getEdges()

    expect(result.insertedEdges).toBe(1)
    expect(edges[0].source).toBe('doc_llm')
  })
})

// ────────────────────────────────────────
// MAP-23: suffix_match 0 candidates → doc_llm fallback
// ────────────────────────────────────────
describe('MAP-23 suffix_match 0 candidates → doc_llm fallback', () => {
  it('uses doc_llm fact when suffix does not match', async () => {
    seedNode('node-checkout', 'pages/checkout.tsx', 'Checkout')
    seedNode('node-orders', 'routes/orders.ts', 'OrdersController')
    seedEP('ep-checkout', { kind: 'page', path: '/checkout', handlerNodeId: 'node-checkout' })
    seedEP('ep-orders', { kind: 'api', httpMethod: 'POST', path: '/api/orders', handlerNodeId: 'node-orders' })
    seedBundle('ep-checkout', 'node-checkout')
    // deterministic with unresolvable suffix
    seedRelation('rel-1', {
      sourceNodeId: 'node-checkout',
      kind: 'api_call',
      canonicalTarget: null,
      payload: { static_suffix: '/api/unknown-route' },
    })
    // doc_llm fallback for same entry_point
    seedDocument('doc-1', {
      scopeId: 'ep-checkout',
      relationFacts: [{ kind: 'api_call', canonical_target: 'POST /api/orders', source: 'llm', confidence: 'medium', target: '/api/orders', operation: 'POST', payload: {} }],
    })

    await runBuildServiceMap({ db, repoId, opts: { includeDocumentFacts: true } })
    const edges = getEdges()

    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe('doc_llm')
  })
})
