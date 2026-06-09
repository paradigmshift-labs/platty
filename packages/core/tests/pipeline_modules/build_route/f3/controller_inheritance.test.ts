import { describe, it, expect } from 'vitest'
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { resolveControllerInheritance } from '@/pipeline_modules/build_route/f3/controller_inheritance.js'

const REPO = 'r1'
let edgeId = 1

function n(partial: Partial<CodeNode> & Pick<CodeNode, 'id' | 'type' | 'filePath' | 'name'>): CodeNode {
  return {
    repoId: REPO,
    lineStart: null,
    lineEnd: null,
    signature: null,
    exported: false,
    isDefaultExport: false,
    isAsync: false,
    isTest: false,
    testType: null,
    docComment: null,
    parseStatus: 'ok',
    createdAt: '2026-05-08',
    ...partial,
  } as CodeNode
}

function e(partial: Partial<CodeEdge> & Pick<CodeEdge, 'sourceId' | 'relation'>): CodeEdge {
  return {
    id: edgeId++,
    repoId: REPO,
    targetId: null,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    resolveStatus: 'pending',
    confidence: null,
    source: 'static',
    createdAt: '2026-05-08',
    ...partial,
  } as CodeEdge
}

describe('S21: 기본 상속 (BaseController → OrderController)', () => {
  it('Base.health(@Get) 가 OrderController 라우트로 상속됨', () => {
    const base = n({ id: 'r1:src/base.ts:BaseController', type: 'class', filePath: 'src/base.ts', name: 'BaseController' })
    const baseHealth = n({ id: 'r1:src/base.ts:BaseController.health', type: 'method', filePath: 'src/base.ts', name: 'health' })
    const ord = n({ id: 'r1:src/order.ts:OrderController', type: 'class', filePath: 'src/order.ts', name: 'OrderController' })
    const ordList = n({ id: 'r1:src/order.ts:OrderController.list', type: 'method', filePath: 'src/order.ts', name: 'list' })

    const containsBase = e({ sourceId: base.id, targetId: baseHealth.id, relation: 'contains' })
    const containsOrd = e({ sourceId: ord.id, targetId: ordList.id, relation: 'contains' })
    const extendsEdge = e({ sourceId: ord.id, targetId: base.id, relation: 'extends' })
    const decorBaseHealth = e({ sourceId: baseHealth.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/health' })
    const decorOrdList = e({ sourceId: ordList.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/list' })

    const idx = createGraphIndex({
      nodes: [base, baseHealth, ord, ordList],
      edges: [containsBase, containsOrd, extendsEdge, decorBaseHealth, decorOrdList],
    })

    const r = resolveControllerInheritance(idx)
    const ordInh = r.inheritedByClass.get(ord.id) ?? []
    expect(ordInh).toHaveLength(1)
    expect(ordInh[0].method.id).toBe(baseHealth.id)
    expect(ordInh[0].inheritedFrom.id).toBe(base.id)
    expect(ordInh[0].decoratorEdges.map((d) => d.firstArg)).toEqual(['/health'])
  })
})

describe('S22: 자식이 method override → 자식 우선', () => {
  it('이름이 같은 method가 자식에 있으면 부모 method 제외', () => {
    const base = n({ id: 'r1:src/base.ts:Base', type: 'class', filePath: 'src/base.ts', name: 'Base' })
    const baseHealth = n({ id: 'r1:src/base.ts:Base.health', type: 'method', filePath: 'src/base.ts', name: 'health' })
    const child = n({ id: 'r1:src/child.ts:Child', type: 'class', filePath: 'src/child.ts', name: 'Child' })
    const childHealth = n({ id: 'r1:src/child.ts:Child.health', type: 'method', filePath: 'src/child.ts', name: 'health' })

    const idx = createGraphIndex({
      nodes: [base, baseHealth, child, childHealth],
      edges: [
        e({ sourceId: base.id, targetId: baseHealth.id, relation: 'contains' }),
        e({ sourceId: child.id, targetId: childHealth.id, relation: 'contains' }),
        e({ sourceId: child.id, targetId: base.id, relation: 'extends' }),
        e({ sourceId: baseHealth.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/parent' }),
        e({ sourceId: childHealth.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/child' }),
      ],
    })

    const r = resolveControllerInheritance(idx)
    expect(r.inheritedByClass.get(child.id) ?? []).toEqual([])
  })
})

describe('S23: Base에 decorated method 없음 → 무시 (정상)', () => {
  it('abstract class 같은 케이스', () => {
    const base = n({ id: 'r1:src/base.ts:Abstract', type: 'class', filePath: 'src/base.ts', name: 'Abstract' })
    const child = n({ id: 'r1:src/child.ts:Child', type: 'class', filePath: 'src/child.ts', name: 'Child' })

    const idx = createGraphIndex({
      nodes: [base, child],
      edges: [e({ sourceId: child.id, targetId: base.id, relation: 'extends' })],
    })

    const r = resolveControllerInheritance(idx)
    expect(r.inheritedByClass.get(child.id) ?? []).toEqual([])
  })
})

describe('S24: 다중 상속 chain (A → B → C)', () => {
  it('모든 부모의 라우트가 합성됨', () => {
    const c = n({ id: 'r1:c.ts:C', type: 'class', filePath: 'c.ts', name: 'C' })
    const cFoo = n({ id: 'r1:c.ts:C.foo', type: 'method', filePath: 'c.ts', name: 'foo' })
    const b = n({ id: 'r1:b.ts:B', type: 'class', filePath: 'b.ts', name: 'B' })
    const bBar = n({ id: 'r1:b.ts:B.bar', type: 'method', filePath: 'b.ts', name: 'bar' })
    const a = n({ id: 'r1:a.ts:A', type: 'class', filePath: 'a.ts', name: 'A' })

    const idx = createGraphIndex({
      nodes: [c, cFoo, b, bBar, a],
      edges: [
        e({ sourceId: c.id, targetId: cFoo.id, relation: 'contains' }),
        e({ sourceId: b.id, targetId: bBar.id, relation: 'contains' }),
        e({ sourceId: a.id, targetId: b.id, relation: 'extends' }),
        e({ sourceId: b.id, targetId: c.id, relation: 'extends' }),
        e({ sourceId: cFoo.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/foo' }),
        e({ sourceId: bBar.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/bar' }),
      ],
    })

    const r = resolveControllerInheritance(idx)
    const aInh = r.inheritedByClass.get(a.id) ?? []
    const names = aInh.map((m) => m.method.name).sort()
    expect(names).toEqual(['bar', 'foo'])

    const bInh = r.inheritedByClass.get(b.id) ?? []
    expect(bInh.map((m) => m.method.name)).toEqual(['foo'])
  })
})

describe('추가 가드', () => {
  it('extends edge 0건 → 빈 결과', () => {
    const child = n({ id: 'r1:c.ts:Child', type: 'class', filePath: 'c.ts', name: 'Child' })
    const idx = createGraphIndex({ nodes: [child], edges: [] })
    expect(resolveControllerInheritance(idx).inheritedByClass.size).toBe(0)
  })

  it('extends target 가 graph에 없음 (external) → 무시', () => {
    const child = n({ id: 'r1:c.ts:Child', type: 'class', filePath: 'c.ts', name: 'Child' })
    const idx = createGraphIndex({
      nodes: [child],
      edges: [e({ sourceId: child.id, targetId: 'external:lib:Base', relation: 'extends' })],
    })
    expect(resolveControllerInheritance(idx).inheritedByClass.get(child.id) ?? []).toEqual([])
  })

  it('cycle 방어 (A extends B extends A)', () => {
    const a = n({ id: 'r1:A', type: 'class', filePath: 'a.ts', name: 'A' })
    const aFoo = n({ id: 'r1:A.foo', type: 'method', filePath: 'a.ts', name: 'foo' })
    const b = n({ id: 'r1:B', type: 'class', filePath: 'b.ts', name: 'B' })
    const idx = createGraphIndex({
      nodes: [a, aFoo, b],
      edges: [
        e({ sourceId: a.id, targetId: aFoo.id, relation: 'contains' }),
        e({ sourceId: a.id, targetId: b.id, relation: 'extends' }),
        e({ sourceId: b.id, targetId: a.id, relation: 'extends' }),
        e({ sourceId: aFoo.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/foo' }),
      ],
    })
    // 무한 루프 안 빠지면 통과 (1초 timeout 정도 충분)
    const r = resolveControllerInheritance(idx)
    expect(r.inheritedByClass).toBeInstanceOf(Map)
  })

  it('부모 contains target이 없거나 method가 아니면 상속 후보에서 제외', () => {
    const base = n({ id: 'r1:Base', type: 'class', filePath: 'base.ts', name: 'Base' })
    const child = n({ id: 'r1:Child', type: 'class', filePath: 'child.ts', name: 'Child' })
    const helper = n({ id: 'r1:Base.helper', type: 'function', filePath: 'base.ts', name: 'helper' })
    const idx = createGraphIndex({
      nodes: [base, child, helper],
      edges: [
        e({ sourceId: child.id, targetId: base.id, relation: 'extends' }),
        e({ sourceId: base.id, targetId: null, relation: 'contains' }),
        e({ sourceId: base.id, targetId: helper.id, relation: 'contains' }),
      ],
    })

    expect(resolveControllerInheritance(idx).inheritedByClass.get(child.id) ?? []).toEqual([])
  })

  it('부모 method에 decorator가 없으면 상속 라우트로 보지 않음', () => {
    const base = n({ id: 'r1:Base', type: 'class', filePath: 'base.ts', name: 'Base' })
    const plain = n({ id: 'r1:Base.plain', type: 'method', filePath: 'base.ts', name: 'plain' })
    const child = n({ id: 'r1:Child', type: 'class', filePath: 'child.ts', name: 'Child' })
    const idx = createGraphIndex({
      nodes: [base, plain, child],
      edges: [
        e({ sourceId: child.id, targetId: base.id, relation: 'extends' }),
        e({ sourceId: base.id, targetId: plain.id, relation: 'contains' }),
      ],
    })

    expect(resolveControllerInheritance(idx).inheritedByClass.get(child.id) ?? []).toEqual([])
  })

  it('다중 부모에서 이미 같은 method id가 수집되면 중복 추가하지 않음', () => {
    const shared = n({ id: 'r1:Shared', type: 'class', filePath: 'shared.ts', name: 'Shared' })
    const ping = n({ id: 'r1:Shared.ping', type: 'method', filePath: 'shared.ts', name: 'ping' })
    const parentA = n({ id: 'r1:ParentA', type: 'class', filePath: 'a.ts', name: 'ParentA' })
    const parentB = n({ id: 'r1:ParentB', type: 'class', filePath: 'b.ts', name: 'ParentB' })
    const child = n({ id: 'r1:Child', type: 'class', filePath: 'child.ts', name: 'Child' })
    const idx = createGraphIndex({
      nodes: [shared, ping, parentA, parentB, child],
      edges: [
        e({ sourceId: child.id, targetId: parentA.id, relation: 'extends' }),
        e({ sourceId: child.id, targetId: parentB.id, relation: 'extends' }),
        e({ sourceId: parentA.id, targetId: shared.id, relation: 'extends' }),
        e({ sourceId: parentB.id, targetId: shared.id, relation: 'extends' }),
        e({ sourceId: shared.id, targetId: ping.id, relation: 'contains' }),
        e({ sourceId: ping.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/ping' }),
      ],
    })

    const inherited = resolveControllerInheritance(idx).inheritedByClass.get(child.id) ?? []
    expect(inherited.map((entry) => entry.method.id)).toEqual([ping.id])
  })
})
