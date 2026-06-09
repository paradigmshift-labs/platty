// Flutter GoRouter F3 어댑터 — 실사례 시나리오 맥시멈
//
// 룰 1개 (go_route) — relation: calls, callee.symbol: GoRoute, first_arg: string_literal
//
// 실사례:
//   - GoRoute(path: '/home', builder: ...)
//   - GoRoute(path: '/users/:id', builder: ...)
//   - ShellRoute(...) — 매칭 X (GoRoute만)
//   - 중첩 GoRoute — 평면 emit (parent_path 합성은 build_graph 보강 후)
//   - StatefulShellRoute (newer) — 매칭 X (지원 룰 없음, gap)
//   - AppRoutes.home 상수 path → firstArg=null → 매칭 X (F4 영역)

import { describe, expect, it } from 'vitest'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { runRuleEngine } from '@/pipeline_modules/build_route/f3_run_rule_engine.js'
import { flutter_gorouter } from '@/pipeline_modules/build_route/adapters/flutter_gorouter.js'
import { TEST_REPO as REPO, n, e, loaded, resetEdgeId } from '../helpers/graph_builders.js'

function routerFn(name = 'buildRouter', filePath = 'lib/router.dart') {
  resetEdgeId()
  return n({ id: `r1:${filePath}:${name}`, type: 'function', filePath, name })
}

// ────────────────────────────────────────────────────────────
// 기본 GoRoute
// ────────────────────────────────────────────────────────────
describe('Flutter GoRouter — 기본 GoRoute', () => {
  it("GoRoute(path: '/home', builder: ...) → /home", async () => {
    const router = routerFn()
    const edge = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/home' })
    const graph = createGraphIndex({ nodes: [router], edges: [edge] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].path).toBe('/home')
    expect(r.entryPoints[0].handlerNodeId).toBe(router.id)
    expect(r.entryPoints[0].kind).toBe('page')
    expect(r.entryPoints[0].framework).toBe('flutter_gorouter')
  })

  it("GoRoute(path: '/') — root path", async () => {
    const router = routerFn()
    const edge = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/' })
    const graph = createGraphIndex({ nodes: [router], edges: [edge] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    expect(r.entryPoints[0].path).toBe('/')
  })

  it("GoRoute(path: '/users/:id')", async () => {
    const router = routerFn()
    const edge = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/users/:id' })
    const graph = createGraphIndex({ nodes: [router], edges: [edge] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    expect(r.entryPoints[0].path).toBe('/users/:id')
  })

  it("GoRoute(path: '/profile/:userId/settings')", async () => {
    const router = routerFn()
    const edge = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/profile/:userId/settings' })
    const graph = createGraphIndex({ nodes: [router], edges: [edge] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    expect(r.entryPoints[0].path).toBe('/profile/:userId/settings')
  })

  it("GoRoute with no leading slash: 'detail' (relative child)", async () => {
    const router = routerFn()
    const edge = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: 'detail' })
    const graph = createGraphIndex({ nodes: [router], edges: [edge] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    // GoRouter는 child path에 leading slash 없는 형식 (e.g., 'detail') 사용
    // F3는 normalize로 '/'를 prepend → '/detail'
    expect(r.entryPoints[0].path).toBe('/detail')
  })
})

// ────────────────────────────────────────────────────────────
// 거부 케이스 — firstArg null (AppRoutes.home 등 상수)
// ────────────────────────────────────────────────────────────
describe('Flutter GoRouter — 매칭 거부', () => {
  it('GoRoute(path: AppRoutes.home) — 상수 식별자 (firstArg=null) → 매칭 X', async () => {
    const router = routerFn()
    const edge = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: null })
    const graph = createGraphIndex({ nodes: [router], edges: [edge] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    // F3 룰은 first_arg.kind=string_literal만 매칭 → 상수는 F4 영역
    expect(r.entryPoints).toHaveLength(0)
  })

  it('ShellRoute(routes: [...]) — ShellRoute는 매칭 X', async () => {
    const router = routerFn()
    const edge = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'ShellRoute', firstArg: null })
    const graph = createGraphIndex({ nodes: [router], edges: [edge] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })

  it('StatefulShellRoute (newer pattern) → 매칭 X (gap — 향후 룰 추가 필요)', async () => {
    const router = routerFn()
    const edge = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'StatefulShellRoute', firstArg: null })
    const graph = createGraphIndex({ nodes: [router], edges: [edge] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })

  it('relation="decorates" — calls가 아니면 매칭 X', async () => {
    const router = routerFn()
    const edge = e({ sourceId: router.id, relation: 'decorates', targetSymbol: 'GoRoute', firstArg: '/home' })
    const graph = createGraphIndex({ nodes: [router], edges: [edge] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────
// 중첩 GoRoute (parent_path 합성은 build_graph 한계로 평면 emit)
// ────────────────────────────────────────────────────────────
describe('Flutter GoRouter — 중첩 (MVP: 평면 emit)', () => {
  it("부모 + 자식 GoRoute → 2건 독립", async () => {
    const router = routerFn()
    const parent = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/users' })
    const child = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: ':id' })
    const graph = createGraphIndex({ nodes: [router], edges: [parent, child] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(2)
    expect(r.entryPoints.map((ep) => ep.path).sort()).toEqual(['/:id', '/users'])
    // nested 룰 존재 확인 reason
    expect(r.skippedReasons['nested_pass_through:flutter_gorouter:go_route']).toBeGreaterThanOrEqual(1)
  })

  it("3-depth nesting → 3 entry 독립", async () => {
    const router = routerFn()
    const e1 = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/admin' })
    const e2 = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: 'users' })
    const e3 = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: ':id/edit' })
    const graph = createGraphIndex({ nodes: [router], edges: [e1, e2, e3] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(3)
  })
})

// ────────────────────────────────────────────────────────────
// 복합 시나리오
// ────────────────────────────────────────────────────────────
describe('Flutter GoRouter — 복합 앱', () => {
  it('전형적인 GoRouter 설정 (5 routes)', async () => {
    const router = routerFn()
    const home = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/' })
    const login = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/login' })
    const profile = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/profile/:userId' })
    const settings = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/settings' })
    const notFound = e({ sourceId: router.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/404' })
    const graph = createGraphIndex({ nodes: [router], edges: [home, login, profile, settings, notFound] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(5)
    expect(r.entryPoints.map((ep) => ep.path).sort()).toEqual([
      '/',
      '/404',
      '/login',
      '/profile/:userId',
      '/settings',
    ])
  })

  it('두 파일에 분산된 router 정의 → 둘 다 emit', async () => {
    const r1 = routerFn('buildPublicRouter', 'lib/public_router.dart')
    const r2 = n({ id: 'r1:lib/admin_router.dart:buildAdminRouter', type: 'function',
                   filePath: 'lib/admin_router.dart', name: 'buildAdminRouter' })
    const e1 = e({ sourceId: r1.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/home' })
    const e2 = e({ sourceId: r2.id, relation: 'calls', targetSymbol: 'GoRoute', firstArg: '/admin' })
    const graph = createGraphIndex({ nodes: [r1, r2], edges: [e1, e2] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_gorouter)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(2)
    expect(r.entryPoints.map((ep) => ep.handlerNodeId).sort()).toEqual([r2.id, r1.id].sort())
  })
})
