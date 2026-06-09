// Flutter Navigator F3 어댑터 — 실사례 시나리오 맥시멈
//
// 룰 2개:
// 1. routes_map (walk: map_entries, field: routes) — MaterialApp/CupertinoApp routes
// 2. on_generate_route (delegateTo: llm_fallback) — Navigator 2.0 dynamic routing
//
// 실사례:
//   - MaterialApp(routes: {'/': HomePage, '/about': AboutPage})
//   - CupertinoApp(routes: {...}) — iOS-style equivalent
//   - MaterialApp(home: HomePage()) — single-page (routes 없음)
//   - MaterialApp(onGenerateRoute: ...) → LLM fallback delegate
//   - MaterialApp(initialRoute: '/home', routes: {...})
//   - routes 값이 widget (literal로는 null) → handler_node_id는 self fallback

import { describe, expect, it } from 'vitest'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { runRuleEngine } from '@/pipeline_modules/build_route/f3_run_rule_engine.js'
import { flutter_navigator } from '@/pipeline_modules/build_route/adapters/flutter_navigator.js'
import { TEST_REPO as REPO, n, e, loaded, resetEdgeId } from '../helpers/graph_builders.js'

function mainFn(filePath = 'lib/main.dart', name = 'main') {
  resetEdgeId()
  return n({ id: `r1:${filePath}:${name}`, type: 'function', filePath, name })
}

// ────────────────────────────────────────────────────────────
// MaterialApp routes 변형 (walk: map_entries)
// ────────────────────────────────────────────────────────────
describe('Flutter Navigator — routes_map walk (MaterialApp.routes)', () => {
  it("MaterialApp(routes: {'/': HomePage, '/about': AboutPage}) → 2 entries", async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'MaterialApp',
      firstArg: null,
      literalArgs: JSON.stringify([
        { routes: { '/': null, '/about': null } },
      ]),
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    const pages = r.entryPoints.filter((ep) => ep.kind === 'page')
    expect(pages).toHaveLength(2)
    expect(pages.map((ep) => ep.path).sort()).toEqual(['/', '/about'])
    expect(pages.every((ep) => ep.handlerNodeId === main.id)).toBe(true)
  })

  it("CupertinoApp(routes: {...}) — iOS 버전도 동일 룰", async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'CupertinoApp',
      firstArg: null,
      literalArgs: JSON.stringify([
        { routes: { '/home': null, '/settings': null } },
      ]),
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    const pages = r.entryPoints.filter((ep) => ep.kind === 'page')
    expect(pages).toHaveLength(2)
    expect(pages.map((ep) => ep.path).sort()).toEqual(['/home', '/settings'])
  })

  it("routes에 5개 path (실제 앱 구조)", async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'MaterialApp',
      firstArg: null,
      literalArgs: JSON.stringify([
        { routes: {
          '/': null,
          '/login': null,
          '/signup': null,
          '/dashboard': null,
          '/settings': null,
        } },
      ]),
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    const pages = r.entryPoints.filter((ep) => ep.kind === 'page')
    expect(pages).toHaveLength(5)
  })

  it("entry.value가 nodeId 문자열이면 그대로 사용 (정적 추적 성공한 경우)", async () => {
    const main = mainFn()
    const homePage = n({ id: 'r1:lib/home.dart:HomePage', type: 'class',
                         filePath: 'lib/home.dart', name: 'HomePage' })
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'MaterialApp',
      firstArg: null,
      literalArgs: JSON.stringify([
        { routes: { '/home': 'r1:lib/home.dart:HomePage' } },
      ]),
    })
    const graph = createGraphIndex({ nodes: [main, homePage], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    expect(r.entryPoints[0].handlerNodeId).toBe(homePage.id)
  })

  it("entry.value가 null이면 self(edge sourceId) fallback", async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'MaterialApp',
      firstArg: null,
      literalArgs: JSON.stringify([
        { routes: { '/home': null } },
      ]),
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    expect(r.entryPoints[0].handlerNodeId).toBe(main.id)  // self fallback
  })
})

// ────────────────────────────────────────────────────────────
// routes 누락 / 빈 케이스
// ────────────────────────────────────────────────────────────
describe('Flutter Navigator — routes 누락', () => {
  it("MaterialApp() — literalArgs 없음 → walk source missing", async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'MaterialApp',
      firstArg: null, literalArgs: null,
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    const pages = r.entryPoints.filter((ep) => ep.kind === 'page')
    expect(pages).toHaveLength(0)
    expect(r.skippedReasons['walk_source_missing:flutter_navigator:routes_map']).toBeGreaterThanOrEqual(1)
  })

  it("MaterialApp(home: HomePage()) — routes named arg 없음 (home만)", async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'MaterialApp',
      firstArg: null,
      literalArgs: JSON.stringify([
        { home: null },  // routes 없음, home만
      ]),
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    const pages = r.entryPoints.filter((ep) => ep.kind === 'page')
    expect(pages).toHaveLength(0)
  })

  it("MaterialApp(routes: {}) — 빈 routes", async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'MaterialApp',
      firstArg: null,
      literalArgs: JSON.stringify([{ routes: {} }]),
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    expect(r.entryPoints.filter((ep) => ep.kind === 'page')).toHaveLength(0)
    expect(r.skippedReasons['walk_empty:flutter_navigator:routes_map']).toBeGreaterThanOrEqual(1)
  })

  it("MaterialApp(initialRoute: '/home', routes: {...}) — initialRoute 부가 인자도 있음", async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'MaterialApp',
      firstArg: null,
      literalArgs: JSON.stringify([
        { initialRoute: '/home', routes: { '/home': null, '/about': null } },
      ]),
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    const pages = r.entryPoints.filter((ep) => ep.kind === 'page')
    expect(pages).toHaveLength(2)
  })
})

// ────────────────────────────────────────────────────────────
// on_generate_route — LLM fallback delegate
// ────────────────────────────────────────────────────────────
describe('Flutter Navigator — on_generate_route (delegate to LLM)', () => {
  it('on_generate_route 룰 → suspected에 adapter_delegate reason 추가', async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'MaterialApp',
      firstArg: null, literalArgs: null,
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    expect(r.suspected.some((s) => s.reason === 'adapter_delegate' && s.adapter === 'flutter_navigator')).toBe(true)
    expect(r.skippedReasons['delegate_to_llm_fallback']).toBeGreaterThanOrEqual(1)
  })
})

// ────────────────────────────────────────────────────────────
// 거부 케이스
// ────────────────────────────────────────────────────────────
describe('Flutter Navigator — 매칭 거부', () => {
  it('targetSymbol=Scaffold — MaterialApp이 아니면 매칭 X', async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'Scaffold',
      firstArg: null,
      literalArgs: JSON.stringify([{ routes: { '/x': null } }]),
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })

  it('relation="decorates" — calls가 아니면 매칭 X', async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'decorates', targetSymbol: 'MaterialApp',
      firstArg: null,
      literalArgs: JSON.stringify([{ routes: { '/x': null } }]),
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────
// literalArgs 변형 — 작성자별 인자 순서/형식 다양성
// ────────────────────────────────────────────────────────────
describe('Flutter Navigator — literalArgs 형식 변형', () => {
  it("named args 포함된 positional + named 혼합 형식", async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'MaterialApp',
      firstArg: null,
      // 실제 dart 파서가 생성할 수 있는 형식: 마지막 element가 named args 객체
      literalArgs: JSON.stringify([
        { title: 'My App', routes: { '/home': null }, theme: null },
      ]),
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    const pages = r.entryPoints.filter((ep) => ep.kind === 'page')
    expect(pages).toHaveLength(1)
    expect(pages[0].path).toBe('/home')
  })

  it("literalArgs가 invalid JSON → walk source missing (graceful)", async () => {
    const main = mainFn()
    const appCall = e({
      sourceId: main.id, relation: 'calls', targetSymbol: 'MaterialApp',
      firstArg: null,
      literalArgs: 'not valid json',
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })
    const r = await runRuleEngine({ adapters: [loaded(flutter_navigator)], graph, repoId: REPO })
    expect(r.entryPoints.filter((ep) => ep.kind === 'page')).toHaveLength(0)
    expect(r.skippedReasons['walk_source_missing:flutter_navigator:routes_map']).toBeGreaterThanOrEqual(1)
  })
})
