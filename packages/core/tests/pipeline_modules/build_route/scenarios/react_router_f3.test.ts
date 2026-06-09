// React Router v6 F3 어댑터 — 실사례 시나리오 맥시멈
//
// 룰 1개 (route_jsx) — relation: renders, callee.symbol: Route, first_arg: string_literal
//
// 실사례:
//   - <Route path="/home" element={<Home/>}/> — 가장 흔한 형식
//   - <Route index/> — index route (firstArg null)
//   - <Route path="*"/> — catch-all
//   - <Route path="users/:id"/> — dynamic param
//   - Nested routes (각각 독립 emit, parent_path 합성은 nested 룰 미구현)
//   - <Route path=""/> — empty path
//   - 다양한 element 형식 (component prop vs element prop은 무시 — path만 본다)

import { describe, expect, it } from 'vitest'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { runRuleEngine } from '@/pipeline_modules/build_route/f3_run_rule_engine.js'
import { react_router_v6 } from '@/pipeline_modules/build_route/adapters/react_router_v6.js'
import { TEST_REPO as REPO, n, e, loaded, resetEdgeId } from '../helpers/graph_builders.js'

function appFn(filePath = 'src/App.tsx', name = 'App') {
  resetEdgeId()
  return n({ id: `r1:${filePath}:${name}`, type: 'function', filePath, name })
}

// ────────────────────────────────────────────────────────────
// 기본 Route 변형
// ────────────────────────────────────────────────────────────
describe('React Router v6 — 기본 Route', () => {
  it('<Route path="/home" element={<Home/>}/> → /home', async () => {
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/home' })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].path).toBe('/home')
    expect(r.entryPoints[0].handlerNodeId).toBe(app.id)
    expect(r.entryPoints[0].kind).toBe('page')
  })

  it('<Route path="/" element={<Layout/>}/> → / (root)', async () => {
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/' })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints[0].path).toBe('/')
  })

  it('<Route path="about"/> (no leading slash) → /about', async () => {
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: 'about' })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints[0].path).toBe('/about')
  })

  it('<Route path="/dashboard/overview"/> — multi-segment', async () => {
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/dashboard/overview' })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints[0].path).toBe('/dashboard/overview')
  })
})

// ────────────────────────────────────────────────────────────
// Dynamic params / Wildcards
// ────────────────────────────────────────────────────────────
describe('React Router v6 — Dynamic / Wildcard', () => {
  it('<Route path="users/:id"/> → /users/:id', async () => {
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: 'users/:id' })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints[0].path).toBe('/users/:id')
  })

  it('<Route path="users/:userId/posts/:postId"/> → multiple params (대소문자 유지)', async () => {
    // normalizer는 :colon params는 원본 case 유지, [bracket]만 lowercase
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route',
                      firstArg: 'users/:userId/posts/:postId' })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints[0].path).toBe('/users/:userId/posts/:postId')
  })

  it('<Route path="*"/> → /* (catch-all 404)', async () => {
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '*' })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints[0].path).toBe('/*')
  })

  it('<Route path="/files/*"/> → splat catch-all', async () => {
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/files/*' })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints[0].path).toBe('/files/*')
  })
})

// ────────────────────────────────────────────────────────────
// firstArg null 케이스 (index route, layout route)
// ────────────────────────────────────────────────────────────
describe('React Router v6 — firstArg null (index/layout)', () => {
  it('<Route index/> → 매칭 안 함 (first_arg.kind=string_literal 필요)', async () => {
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: null })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })

  it('<Route element={<Layout/>}/> (path 없음 — layout-only) → 매칭 X', async () => {
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: null })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────
// 거부 케이스 — 잘못된 element / relation
// ────────────────────────────────────────────────────────────
describe('React Router v6 — 매칭 거부', () => {
  it('relation="calls" — renders가 아니면 매칭 X', async () => {
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'calls', targetSymbol: 'Route', firstArg: '/home' })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })

  it('targetSymbol="Routes" (복수) — Route만 매칭', async () => {
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Routes', firstArg: '/home' })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })

  it('targetSymbol="Link" — Link는 nav이지 route 정의 아님', async () => {
    const app = appFn()
    const route = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Link', firstArg: '/home' })
    const graph = createGraphIndex({ nodes: [app], edges: [route] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────
// 중첩 Route (parent_path 합성 미구현 — 평면 emit)
// ────────────────────────────────────────────────────────────
describe('React Router v6 — 중첩 Route (MVP: 독립 emit)', () => {
  it('<Route path="/parent"><Route path="child"/></Route> → 두 entry 독립', async () => {
    const app = appFn()
    const parent = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/parent' })
    const child = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: 'child' })
    const graph = createGraphIndex({ nodes: [app], edges: [parent, child] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(2)
    expect(r.entryPoints.map((ep) => ep.path).sort()).toEqual(['/child', '/parent'])
    // nested pass-through reason 기록됨
    expect(r.skippedReasons['nested_pass_through:react_router_v6:route_jsx']).toBeGreaterThanOrEqual(1)
  })

  it('3-depth nesting → 3 entry 독립', async () => {
    const app = appFn()
    const e1 = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/admin' })
    const e2 = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: 'users' })
    const e3 = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: ':id' })
    const graph = createGraphIndex({ nodes: [app], edges: [e1, e2, e3] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(3)
  })
})

// ────────────────────────────────────────────────────────────
// 복합 시나리오
// ────────────────────────────────────────────────────────────
describe('React Router v6 — 복합 SPA', () => {
  it('일반적 SPA 구조 (5 routes)', async () => {
    const app = appFn()
    const home = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/' })
    const about = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/about' })
    const dashboard = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/dashboard' })
    const user = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/users/:id' })
    const notFound = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '*' })
    const graph = createGraphIndex({ nodes: [app], edges: [home, about, dashboard, user, notFound] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(5)
    expect(r.entryPoints.map((ep) => ep.path).sort()).toEqual([
      '/',
      '/*',
      '/about',
      '/dashboard',
      '/users/:id',
    ])
  })

  it('같은 path 중복 (실수) → dedup으로 1건', async () => {
    const app = appFn()
    const e1 = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/home' })
    const e2 = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/home' })
    const graph = createGraphIndex({ nodes: [app], edges: [e1, e2] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
  })

  it('두 컴포넌트가 동일 path를 각자 정의 → 별개 handler로 2건', async () => {
    const app1 = appFn('src/Routes.tsx', 'PublicRoutes')
    const app2 = n({ id: 'r1:src/Routes.tsx:AdminRoutes', type: 'function',
                     filePath: 'src/Routes.tsx', name: 'AdminRoutes' })
    const e1 = e({ sourceId: app1.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/dashboard' })
    const e2 = e({ sourceId: app2.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/dashboard' })
    const graph = createGraphIndex({ nodes: [app1, app2], edges: [e1, e2] })
    const r = await runRuleEngine({ adapters: [loaded(react_router_v6)], graph, repoId: REPO })
    // 다른 handler → 둘 다 emit (file fallback이 아니므로 dedup 안 됨)
    expect(r.entryPoints).toHaveLength(2)
  })
})
