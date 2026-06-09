import { describe, it, expect } from 'vitest'
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { resolveReachability } from '@/pipeline_modules/build_route/f5_resolve_reachability.js'

const REPO = 'r1'
let edgeId = 1

function n(p: Partial<CodeNode> & Pick<CodeNode, 'id' | 'type' | 'filePath' | 'name'>): CodeNode {
  return {
    repoId: REPO, lineStart: null, lineEnd: null, signature: null,
    exported: false, isDefaultExport: false, isAsync: false, isTest: false,
    testType: null, docComment: null, parseStatus: 'ok',
    createdAt: '2026-05-08', ...p,
  } as CodeNode
}

function e(p: Partial<CodeEdge> & Pick<CodeEdge, 'sourceId' | 'targetId' | 'relation'>): CodeEdge {
  return {
    id: edgeId++, repoId: REPO, targetSpecifier: null, targetSymbol: null,
    typeRefSubtype: null, chainPath: null, firstArg: null, literalArgs: null,
    resolveStatus: 'pending', confidence: null, source: 'static',
    createdAt: '2026-05-08', ...p,
  } as CodeEdge
}

describe('f5 resolveReachability — 자연 종료', () => {
  it('chain 3개 → 4 노드 (handler 포함)', () => {
    const a = n({ id: 'a', type: 'method', filePath: 'a.ts', name: 'a' })
    const b = n({ id: 'b', type: 'method', filePath: 'a.ts', name: 'b' })
    const c = n({ id: 'c', type: 'method', filePath: 'a.ts', name: 'c' })
    const d = n({ id: 'd', type: 'method', filePath: 'a.ts', name: 'd' })

    const idx = createGraphIndex({
      nodes: [a, b, c, d],
      edges: [
        e({ sourceId: a.id, targetId: b.id, relation: 'calls' }),
        e({ sourceId: b.id, targetId: c.id, relation: 'calls' }),
        e({ sourceId: c.id, targetId: d.id, relation: 'calls' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: a.id, graph: idx })
    expect(r.bundle.map((b) => b.nodeId)).toEqual(['a', 'b', 'c', 'd'])
    expect(r.bundle.find((b) => b.nodeId === 'a')!.depth).toBe(0)
    expect(r.bundle.find((b) => b.nodeId === 'd')!.depth).toBe(3)
    expect(r.truncatedBy).toBeUndefined()
  })

  it('includes a node reached via type_resolved (DI/CHA) edge', () => {
    // 인터페이스 DI / CHA fan-out 등은 type_resolved 엣지로 표현됨. build_route 번들이
    // 단일 출처가 되려면 이 실행/타입 도달 경로도 따라가야 한다(누락 시 DI 호출이 번들에서 빠짐).
    const handler = n({ id: 'handler', type: 'method', filePath: 'ctrl.ts', name: 'OrderController.create' })
    const svc = n({ id: 'svc', type: 'method', filePath: 'svc.ts', name: 'OrderService.save' })
    const idx = createGraphIndex({
      nodes: [handler, svc],
      edges: [
        e({ sourceId: handler.id, targetId: svc.id, relation: 'type_resolved' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: handler.id, graph: idx })
    expect(r.bundle.map((b) => b.nodeId)).toContain('svc')
  })

  it('does not over-include an unconnected same-file sibling (precision is build_route\'s responsibility)', () => {
    // 핸들러 메서드와 같은 파일의 형제 메서드(도달 엣지 없음)는 번들에 들어오면 안 된다.
    // build_service_map이 번들을 그대로 신뢰하므로, "거짓말 안 하는 번들"(실행 경로 없는 노드 미포함)은
    // build_route의 책임이다. (구 build_service_map keystone 오염-가드가 여기로 이전됨.)
    const handler = n({ id: 'feedCount', type: 'method', filePath: 'ctrl.ts', name: 'getFeedCount' })
    const sibling = n({ id: 'boardUpdate', type: 'method', filePath: 'ctrl.ts', name: 'updateBoard' })
    const idx = createGraphIndex({ nodes: [handler, sibling], edges: [] })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: handler.id, graph: idx })
    expect(r.bundle.map((b) => b.nodeId)).not.toContain('boardUpdate')
  })

  it('start 노드 없음 → 빈 bundle', () => {
    const idx = createGraphIndex({ nodes: [], edges: [] })
    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: 'nonexistent', graph: idx })
    expect(r.bundle).toEqual([])
  })

  it('extra seed nodes are included as route evidence roots', () => {
    const handler = n({ id: 'handler', type: 'function', filePath: 'route.tsx', name: 'Page' })
    const routeDecl = n({ id: 'route-decl', type: 'variable', filePath: 'route.tsx', name: 'Route' })
    const guard = n({ id: 'guard', type: 'function', filePath: 'auth.ts', name: 'requireAuth' })
    const idx = createGraphIndex({
      nodes: [handler, routeDecl, guard],
      edges: [
        e({ sourceId: routeDecl.id, targetId: guard.id, relation: 'calls' }),
      ],
    })

    const r = resolveReachability({
      entryPointId: 'ep1',
      startNodeId: handler.id,
      seedNodeIds: [routeDecl.id, 'missing-seed'],
      graph: idx,
    })

    expect(r.bundle.map((x) => x.nodeId)).toEqual(['handler', 'route-decl', 'guard'])
  })
})

describe('cycle 방어', () => {
  it('A → B → A → C → A → ... 무한 루프 X', () => {
    const a = n({ id: 'a', type: 'method', filePath: 'a.ts', name: 'a' })
    const b = n({ id: 'b', type: 'method', filePath: 'a.ts', name: 'b' })
    const idx = createGraphIndex({
      nodes: [a, b],
      edges: [
        e({ sourceId: a.id, targetId: b.id, relation: 'calls' }),
        e({ sourceId: b.id, targetId: a.id, relation: 'calls' }),
      ],
    })
    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: a.id, graph: idx })
    expect(r.bundle.map((x) => x.nodeId).sort()).toEqual(['a', 'b'])
  })

  it('같은 target이 queue에 중복으로 들어와도 bundle에는 한 번만 포함', () => {
    const a = n({ id: 'a', type: 'method', filePath: 'a.ts', name: 'a' })
    const b = n({ id: 'b', type: 'method', filePath: 'a.ts', name: 'b' })
    const c = n({ id: 'c', type: 'method', filePath: 'a.ts', name: 'c' })
    const idx = createGraphIndex({
      nodes: [a, b, c],
      edges: [
        e({ sourceId: a.id, targetId: b.id, relation: 'calls' }),
        e({ sourceId: a.id, targetId: c.id, relation: 'calls' }),
        e({ sourceId: b.id, targetId: c.id, relation: 'calls' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: a.id, graph: idx })

    expect(r.bundle.filter((x) => x.nodeId === c.id)).toHaveLength(1)
  })
})

describe('caps', () => {
  it('maxDepth 도달 시 truncatedBy=depth', () => {
    const a = n({ id: 'a', type: 'method', filePath: 'a.ts', name: 'a' })
    const b = n({ id: 'b', type: 'method', filePath: 'a.ts', name: 'b' })
    const c = n({ id: 'c', type: 'method', filePath: 'a.ts', name: 'c' })
    const idx = createGraphIndex({
      nodes: [a, b, c],
      edges: [
        e({ sourceId: a.id, targetId: b.id, relation: 'calls' }),
        e({ sourceId: b.id, targetId: c.id, relation: 'calls' }),
      ],
    })
    const r = resolveReachability({
      entryPointId: 'ep1',
      startNodeId: a.id,
      graph: idx,
      caps: { maxDepth: 1 },
    })
    expect(r.truncatedBy).toBe('depth')
    expect(r.bundle.map((x) => x.nodeId).sort()).toEqual(['a', 'b'])
  })

  it('maxNodes 도달 시 truncatedBy=node_count', () => {
    const nodes = Array.from({ length: 5 }, (_, i) =>
      n({ id: `n${i}`, type: 'method', filePath: 'a.ts', name: `n${i}` }),
    )
    const edges = [
      e({ sourceId: 'n0', targetId: 'n1', relation: 'calls' }),
      e({ sourceId: 'n1', targetId: 'n2', relation: 'calls' }),
      e({ sourceId: 'n2', targetId: 'n3', relation: 'calls' }),
      e({ sourceId: 'n3', targetId: 'n4', relation: 'calls' }),
    ]
    const idx = createGraphIndex({ nodes, edges })
    const r = resolveReachability({
      entryPointId: 'ep1',
      startNodeId: 'n0',
      graph: idx,
      caps: { maxNodes: 3 },
    })
    expect(r.truncatedBy).toBe('node_count')
    expect(r.bundle).toHaveLength(3)
  })

  it('maxFanOut 초과 시 그 노드의 자식 추적 안 함', () => {
    const root = n({ id: 'root', type: 'method', filePath: 'a.ts', name: 'root' })
    const children = Array.from({ length: 5 }, (_, i) =>
      n({ id: `c${i}`, type: 'method', filePath: 'a.ts', name: `c${i}` }),
    )
    const idx = createGraphIndex({
      nodes: [root, ...children],
      edges: children.map((c) =>
        e({ sourceId: root.id, targetId: c.id, relation: 'calls' }),
      ),
    })
    const r = resolveReachability({
      entryPointId: 'ep1',
      startNodeId: root.id,
      graph: idx,
      caps: { maxFanOut: 3 },
    })
    expect(r.truncatedBy).toBe('fan_out')
    expect(r.bundle.map((x) => x.nodeId)).toEqual(['root']) // 자식 추적 X
  })
})

describe('relation 필터', () => {
  it('does NOT bundle an imported-but-uncalled local module (imports is not reachability — no over-collection)', () => {
    const a = n({ id: 'a', type: 'function', filePath: 'a.ts', name: 'a' })
    const b = n({ id: 'b', type: 'function', filePath: 'b.ts', name: 'b' })
    const idx = createGraphIndex({
      nodes: [a, b],
      edges: [e({ sourceId: a.id, targetId: b.id, relation: 'imports' })],
    })
    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: a.id, graph: idx })
    // `a`가 `b`를 import만 하고 호출 안 하면 `b`는 route 번들에 들어오면 안 된다.
    // (호출되는 래퍼는 build_graph가 resolves_to로 풀어주므로 별도 케이스에서 잡힌다.)
    expect(r.bundle.map((x) => x.nodeId)).toEqual(['a'])
  })

  it('targetId 없는 traceable edge는 bundle 확장에 사용하지 않음', () => {
    const a = n({ id: 'a', type: 'function', filePath: 'a.ts', name: 'a' })
    const idx = createGraphIndex({
      nodes: [a],
      edges: [e({ sourceId: a.id, targetId: null, relation: 'calls' })],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: a.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId)).toEqual(['a'])
  })

  it('target node가 없는 traceable edge는 bundle 확장에 사용하지 않음', () => {
    const a = n({ id: 'a', type: 'function', filePath: 'a.ts', name: 'a' })
    const idx = createGraphIndex({
      nodes: [a],
      edges: [e({ sourceId: a.id, targetId: 'ghost', relation: 'contains' })],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: a.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId)).toEqual(['a'])
  })

  it("calls + renders + local contains + extends + implements 는 추적", () => {
    const start = n({ id: 's', type: 'method', filePath: 'a.ts', name: 's' })
    const targets = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) =>
      n({ id, type: 'method', filePath: 'a.ts', name: id, lineStart: 2, lineEnd: 3 }),
    )
    const startWithRange = { ...start, lineStart: 1, lineEnd: 10 }
    const relations = ['calls', 'renders', 'contains', 'extends', 'implements'] as const
    const idx = createGraphIndex({
      nodes: [startWithRange, ...targets],
      edges: relations.map((relation, i) =>
        e({ sourceId: startWithRange.id, targetId: targets[i].id, relation }),
      ),
    })
    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: startWithRange.id, graph: idx })
    expect(r.bundle.map((x) => x.nodeId).sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 's'])
  })

  it('contains는 class/file 컨테이너의 sibling 멤버로 확장하지 않음', () => {
    const handler = n({ id: 'handler', type: 'method', filePath: 'a.ts', name: 'handler', lineStart: 10, lineEnd: 20 })
    const serviceClass = n({ id: 'service-class', type: 'class', filePath: 'svc.ts', name: 'Service', lineStart: 1, lineEnd: 100 })
    const used = n({ id: 'used', type: 'method', filePath: 'svc.ts', name: 'used', lineStart: 10, lineEnd: 20 })
    const sibling = n({ id: 'sibling', type: 'method', filePath: 'svc.ts', name: 'sibling', lineStart: 30, lineEnd: 40 })
    const idx = createGraphIndex({
      nodes: [handler, serviceClass, used, sibling],
      edges: [
        e({ sourceId: handler.id, targetId: used.id, relation: 'calls' }),
        e({ sourceId: serviceClass.id, targetId: used.id, relation: 'contains' }),
        e({ sourceId: serviceClass.id, targetId: sibling.id, relation: 'contains' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: handler.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId).sort()).toEqual(['handler', 'used'])
  })

  it('start 노드가 class 컨테이너면 직접 contains 자식은 route 코드로 포함함', () => {
    const page = n({ id: 'page', type: 'class', filePath: 'page.dart', name: 'Page', lineStart: 1, lineEnd: 100 })
    const build = n({ id: 'build', type: 'method', filePath: 'page.dart', name: 'build', lineStart: 20, lineEnd: 40 })
    const helper = n({ id: 'helper', type: 'method', filePath: 'page.dart', name: 'helper', lineStart: 50, lineEnd: 60 })
    const idx = createGraphIndex({
      nodes: [page, build, helper],
      edges: [
        e({ sourceId: page.id, targetId: build.id, relation: 'contains' }),
        e({ sourceId: page.id, targetId: helper.id, relation: 'contains' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: page.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId).sort()).toEqual(['build', 'helper', 'page'])
  })

  it('seed에서 contains만 타고 내려온 non-seed State class의 메서드는 자동 포함하지 않음', () => {
    const page = n({ id: 'page', type: 'class', filePath: 'page.dart', name: 'Page', lineStart: 1, lineEnd: 100 })
    const state = n({ id: 'state', type: 'class', filePath: 'page.dart', name: '_PageState', lineStart: 20, lineEnd: 90 })
    const build = n({ id: 'build', type: 'method', filePath: 'page.dart', name: 'build', lineStart: 30, lineEnd: 50 })
    const idx = createGraphIndex({
      nodes: [page, state, build],
      edges: [
        e({ sourceId: page.id, targetId: state.id, relation: 'contains' }),
        e({ sourceId: state.id, targetId: build.id, relation: 'contains' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: page.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId)).toEqual(['page', 'state'])
  })

  it('calls로 도달한 class 컨테이너는 contains sibling 멤버로 확장하지 않음', () => {
    const handler = n({ id: 'handler', type: 'method', filePath: 'handler.ts', name: 'handler', lineStart: 1, lineEnd: 10 })
    const service = n({ id: 'service', type: 'class', filePath: 'service.ts', name: 'Service', lineStart: 1, lineEnd: 100 })
    const run = n({ id: 'run', type: 'method', filePath: 'service.ts', name: 'run', lineStart: 10, lineEnd: 20 })
    const idx = createGraphIndex({
      nodes: [handler, service, run],
      edges: [
        e({ sourceId: handler.id, targetId: service.id, relation: 'calls' }),
        e({ sourceId: service.id, targetId: run.id, relation: 'contains' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: handler.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId)).toEqual(['handler', 'service'])
  })

  it('rendered Flutter component도 class fanout 없이 내부 렌더 트리를 계속 추적함', () => {
    const page = n({ id: 'page', type: 'class', filePath: 'page.dart', name: 'Page', lineStart: 1, lineEnd: 100 })
    const feature = n({ id: 'feature', type: 'class', filePath: 'feature.dart', name: 'Feature', lineStart: 1, lineEnd: 100 })
    const state = n({ id: 'state', type: 'class', filePath: 'feature.dart', name: '_FeatureState', lineStart: 20, lineEnd: 90 })
    const build = n({ id: 'build', type: 'method', filePath: 'feature.dart', name: 'build', lineStart: 30, lineEnd: 50 })
    const grandchild = n({ id: 'grandchild', type: 'class', filePath: 'grandchild.dart', name: 'Grandchild', lineStart: 1, lineEnd: 20 })
    const idx = createGraphIndex({
      nodes: [page, feature, state, build, grandchild],
      edges: [
        e({ sourceId: page.id, targetId: feature.id, relation: 'renders' }),
        e({ sourceId: feature.id, targetId: state.id, relation: 'contains' }),
        e({ sourceId: state.id, targetId: build.id, relation: 'contains' }),
        e({ sourceId: feature.id, targetId: grandchild.id, relation: 'renders' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: page.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId)).toEqual(['page', 'feature', 'state', 'grandchild'])
  })

  it('contains는 함수 내부 로컬 콜백으로는 확장함', () => {
    const handler = n({ id: 'handler', type: 'method', filePath: 'a.ts', name: 'handler', lineStart: 10, lineEnd: 40 })
    const callback = n({ id: 'callback', type: 'function', filePath: 'a.ts', name: 'handler.$callback_12_5', lineStart: 12, lineEnd: 18 })
    const idx = createGraphIndex({
      nodes: [handler, callback],
      edges: [
        e({ sourceId: handler.id, targetId: callback.id, relation: 'contains' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: handler.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId)).toEqual(['handler', 'callback'])
  })

  it('follows executable ownership from screen hook to query callback and repository call', () => {
    const page = n({ id: 'page', type: 'function', filePath: 'profile.tsx', name: 'ProfilePage', lineStart: 1, lineEnd: 60 })
    const hook = n({ id: 'hook', type: 'function', filePath: 'profile.tsx', name: 'useProfile', parentNodeId: page.id, originKind: 'function' })
    const queryFn = n({ id: 'query-fn', type: 'function', filePath: 'profile.tsx', name: 'useProfile.$queryFn_12_14', parentNodeId: hook.id, originKind: 'callback', role: 'queryFn' })
    const repository = n({ id: 'repo-get-profile', type: 'method', filePath: 'profileRepository.ts', name: 'getMyProfile' })
    const idx = createGraphIndex({
      nodes: [page, hook, queryFn, repository],
      edges: [
        e({ sourceId: page.id, targetId: hook.id, relation: 'contains' }),
        e({ sourceId: hook.id, targetId: queryFn.id, relation: 'contains' }),
        e({ sourceId: queryFn.id, targetId: repository.id, relation: 'calls' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep-profile', startNodeId: page.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId)).toEqual(['page', 'hook', 'query-fn', 'repo-get-profile'])
    expect(r.bundle.find((x) => x.nodeId === 'query-fn')?.edgePath).toEqual(['contains', 'contains'])
    expect(r.bundle.find((x) => x.nodeId === 'repo-get-profile')?.edgePath).toEqual(['contains', 'contains', 'calls'])
  })

  it('follows backend handler ownership to transaction callback and DB call target', () => {
    const handler = n({ id: 'handler', type: 'function', filePath: 'orders.route.ts', name: 'DELETE', lineStart: 5, lineEnd: 30 })
    const transactionCallback = n({ id: 'transaction-callback', type: 'function', filePath: 'orders.route.ts', name: 'DELETE.$transaction_12_20', parentNodeId: handler.id, originKind: 'callback', role: 'transactionCallback' })
    const deleteMany = n({ id: 'tx-order-delete-many', type: 'method', filePath: 'orders.route.ts', name: 'tx.order.deleteMany' })
    const idx = createGraphIndex({
      nodes: [handler, transactionCallback, deleteMany],
      edges: [
        e({ sourceId: handler.id, targetId: transactionCallback.id, relation: 'contains' }),
        e({ sourceId: transactionCallback.id, targetId: deleteMany.id, relation: 'calls', chainPath: 'tx.order.deleteMany' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep-delete-orders', startNodeId: handler.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId)).toEqual(['handler', 'transaction-callback', 'tx-order-delete-many'])
    expect(r.bundle.find((x) => x.nodeId === 'tx-order-delete-many')?.edgePath).toEqual(['contains', 'calls'])
  })

  it('follows Flutter build ownership to onPressed callback and controller submit call', () => {
    const build = n({ id: 'build', type: 'method', filePath: 'checkout.dart', name: 'build', lineStart: 20, lineEnd: 80 })
    const onPressed = n({ id: 'on-pressed', type: 'function', filePath: 'checkout.dart', name: 'build.$onPressed_42_21', parentNodeId: build.id, originKind: 'callback', role: 'onPressed' })
    const submit = n({ id: 'controller-submit', type: 'method', filePath: 'checkout_controller.dart', name: 'submit' })
    const idx = createGraphIndex({
      nodes: [build, onPressed, submit],
      edges: [
        e({ sourceId: build.id, targetId: onPressed.id, relation: 'contains' }),
        e({ sourceId: onPressed.id, targetId: submit.id, relation: 'calls', chainPath: 'controller.submit' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep-checkout', startNodeId: build.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId)).toEqual(['build', 'on-pressed', 'controller-submit'])
    expect(r.bundle.find((x) => x.nodeId === 'controller-submit')?.edgePath).toEqual(['contains', 'calls'])
  })

  it('does not fan out from a locally owned class to unrelated methods', () => {
    const handler = n({ id: 'handler', type: 'function', filePath: 'route.ts', name: 'POST', lineStart: 1, lineEnd: 80 })
    const localClass = n({ id: 'local-class', type: 'class', filePath: 'route.ts', name: 'LocalService', parentNodeId: handler.id })
    const used = n({ id: 'used', type: 'method', filePath: 'route.ts', name: 'used', parentNodeId: localClass.id })
    const unused = n({ id: 'unused', type: 'method', filePath: 'route.ts', name: 'unused', parentNodeId: localClass.id })
    const idx = createGraphIndex({
      nodes: [handler, localClass, used, unused],
      edges: [
        e({ sourceId: handler.id, targetId: localClass.id, relation: 'contains' }),
        e({ sourceId: handler.id, targetId: used.id, relation: 'calls' }),
        e({ sourceId: localClass.id, targetId: used.id, relation: 'contains' }),
        e({ sourceId: localClass.id, targetId: unused.id, relation: 'contains' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep-post', startNodeId: handler.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId).sort()).toEqual(['handler', 'local-class', 'used'])
  })

  it('renders로 도달한 컴포넌트도 내부 호출 체인은 계속 추적함', () => {
    const page = n({ id: 'page', type: 'function', filePath: 'page.tsx', name: 'Page' })
    const child = n({ id: 'child', type: 'function', filePath: 'child.tsx', name: 'Child' })
    const grandchild = n({ id: 'grandchild', type: 'function', filePath: 'grandchild.tsx', name: 'Grandchild' })
    const hook = n({ id: 'hook', type: 'function', filePath: 'useOrders.ts', name: 'useOrders' })
    const idx = createGraphIndex({
      nodes: [page, child, grandchild, hook],
      edges: [
        e({ sourceId: page.id, targetId: child.id, relation: 'renders' }),
        e({ sourceId: child.id, targetId: grandchild.id, relation: 'renders' }),
        e({ sourceId: child.id, targetId: hook.id, relation: 'calls' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: page.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId)).toEqual(['page', 'child', 'grandchild', 'hook'])
  })

  it('follows page to local API wrapper through render, hook, repository, and resolves_to (def-use, not imports)', () => {
    const page = n({ id: 'page', type: 'function', filePath: 'page.tsx', name: 'Page' })
    const screen = n({ id: 'screen', type: 'function', filePath: 'screen.tsx', name: 'OrderScreen' })
    const hook = n({ id: 'hook', type: 'function', filePath: 'useOrders.ts', name: 'useOrders' })
    const repository = n({ id: 'repo', type: 'function', filePath: 'orderRepository.ts', name: 'loadOrders' })
    const http = n({ id: 'http', type: 'variable', filePath: 'http.ts', name: 'http' })
    const idx = createGraphIndex({
      nodes: [page, screen, hook, repository, http],
      edges: [
        e({ sourceId: page.id, targetId: screen.id, relation: 'renders' }),
        e({ sourceId: screen.id, targetId: hook.id, relation: 'calls' }),
        e({ sourceId: hook.id, targetId: repository.id, relation: 'calls' }),
        // 레포가 http 래퍼를 호출 → build_graph가 cross-file resolves_to로 잇는다(imports 안전망 대체).
        e({ sourceId: repository.id, targetId: http.id, relation: 'resolves_to' }),
      ],
    })

    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: page.id, graph: idx })

    expect(r.bundle.map((x) => x.nodeId)).toEqual(['page', 'screen', 'hook', 'repo', 'http'])
  })
})

describe('edgePath 추적', () => {
  it('도달 경로 relation 누적', () => {
    const a = n({ id: 'a', type: 'method', filePath: 'a.ts', name: 'a' })
    const b = n({ id: 'b', type: 'method', filePath: 'a.ts', name: 'b' })
    const idx = createGraphIndex({
      nodes: [a, b],
      edges: [e({ sourceId: a.id, targetId: b.id, relation: 'calls' })],
    })
    const r = resolveReachability({ entryPointId: 'ep1', startNodeId: a.id, graph: idx })
    const bEntry = r.bundle.find((x) => x.nodeId === 'b')!
    expect(bEntry.edgePath).toEqual(['calls'])
  })
})
