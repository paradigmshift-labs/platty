import { describe, it, expect } from 'vitest'
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'

const REPO = 'r1'

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
    id: Math.floor(Math.random() * 1e9),
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

const fileNode = n({ id: 'r1:src/order.ts', type: 'file', filePath: 'src/order.ts', name: 'order.ts' })
const classNode = n({ id: 'r1:src/order.ts:OrderController', type: 'class', filePath: 'src/order.ts', name: 'OrderController' })
const methodNode = n({ id: 'r1:src/order.ts:OrderController.list', type: 'method', filePath: 'src/order.ts', name: 'list' })
const pageNode = n({ id: 'r1:app/dashboard/page.tsx', type: 'file', filePath: 'app/dashboard/page.tsx', name: 'page.tsx' })
const layoutNode = n({ id: 'r1:app/layout.tsx', type: 'file', filePath: 'app/layout.tsx', name: 'layout.tsx' })

const containsEdge = e({ sourceId: classNode.id, targetId: methodNode.id, relation: 'contains' })
const decoratesEdge = e({ sourceId: classNode.id, targetId: classNode.id, relation: 'decorates', targetSymbol: 'Controller' })
const callsEdge = e({ sourceId: methodNode.id, targetId: 'r1:ext:get', relation: 'calls', targetSymbol: 'get', chainPath: 'app' })

describe('createGraphIndex — basic lookup', () => {
  const idx = createGraphIndex({
    nodes: [fileNode, classNode, methodNode, pageNode, layoutNode],
    edges: [containsEdge, decoratesEdge, callsEdge],
  })

  it('getNode: 존재하는 id', () => {
    expect(idx.getNode(classNode.id)).toEqual(classNode)
  })

  it('getNode: 없는 id → undefined', () => {
    expect(idx.getNode('does-not-exist')).toBeUndefined()
  })

  it('getAllNodes / getAllEdges 길이', () => {
    expect(idx.getAllNodes()).toHaveLength(5)
    expect(idx.getAllEdges()).toHaveLength(3)
  })
})

describe('createGraphIndex — edge lookups', () => {
  const idx = createGraphIndex({
    nodes: [classNode, methodNode],
    edges: [containsEdge, decoratesEdge, callsEdge],
  })

  it('outgoingEdges: source 기준', () => {
    const out = idx.outgoingEdges(classNode.id)
    expect(out).toHaveLength(2) // contains + decorates(self)
    expect(out.map((edge) => edge.relation).sort()).toEqual(['contains', 'decorates'])
  })

  it('outgoingEdges: 없으면 빈 배열', () => {
    expect(idx.outgoingEdges('orphan')).toEqual([])
  })

  it('incomingEdges: target 기준', () => {
    const inc = idx.incomingEdges(methodNode.id)
    expect(inc).toHaveLength(1)
    expect(inc[0].relation).toBe('contains')
  })

  it('edgesByRelation', () => {
    expect(idx.edgesByRelation('calls')).toHaveLength(1)
    expect(idx.edgesByRelation('decorates')).toHaveLength(1)
    expect(idx.edgesByRelation('imports')).toEqual([])
  })
})

describe('createGraphIndex — node lookups', () => {
  const idx = createGraphIndex({
    nodes: [fileNode, classNode, methodNode, pageNode, layoutNode],
    edges: [],
  })

  it('nodesByType', () => {
    expect(idx.nodesByType('class')).toHaveLength(1)
    expect(idx.nodesByType('method')).toHaveLength(1)
    expect(idx.nodesByType('file')).toHaveLength(3)
    expect(idx.nodesByType('function')).toEqual([])
  })

  it('nodesByFile: 같은 file_path 의 모든 노드', () => {
    expect(idx.nodesByFile('src/order.ts').map((node) => node.id).sort()).toEqual([
      classNode.id,
      methodNode.id,
      fileNode.id,
    ].sort())
  })

  it('nodesByFile: 없는 파일 → 빈 배열', () => {
    expect(idx.nodesByFile('src/missing.ts')).toEqual([])
  })
})

describe('createGraphIndex — file glob', () => {
  const idx = createGraphIndex({
    nodes: [fileNode, classNode, methodNode, pageNode, layoutNode],
    edges: [],
  })

  it("'app/**/page.tsx' 매칭 (중첩 디렉터리)", () => {
    expect(idx.nodesByFileGlob(['app/**/page.tsx']).map((node) => node.id))
      .toEqual([pageNode.id])
  })

  it("'**/layout.*' 매칭 (확장자 와일드카드)", () => {
    expect(idx.nodesByFileGlob(['**/layout.*']).map((node) => node.id))
      .toEqual([layoutNode.id])
  })

  it('다중 glob OR 결합 (dedup)', () => {
    const ids = idx.nodesByFileGlob(['app/**/page.tsx', '**/layout.*']).map((node) => node.id).sort()
    expect(ids).toEqual([pageNode.id, layoutNode.id].sort())
  })

  it('다중 glob이 같은 파일을 반복 매칭해도 node는 중복 반환하지 않음', () => {
    const ids = idx.nodesByFileGlob(['src/*.ts', 'src/order.ts']).map((node) => node.id).sort()
    expect(ids).toEqual([classNode.id, methodNode.id, fileNode.id].sort())
  })

  it('입력 nodes에 같은 id가 반복되어도 glob 결과는 dedup', () => {
    const duplicateIdx = createGraphIndex({ nodes: [fileNode, fileNode], edges: [] })
    expect(duplicateIdx.nodesByFileGlob(['src/*.ts']).map((node) => node.id)).toEqual([fileNode.id])
  })

  it('매칭 0건 → 빈 배열', () => {
    expect(idx.nodesByFileGlob(['nonexistent/**/*.ts'])).toEqual([])
  })

  it('빈 glob 배열 → 빈 배열', () => {
    expect(idx.nodesByFileGlob([])).toEqual([])
  })

  it("'src/*.ts' 매칭 (단일 디렉터리)", () => {
    // src/order.ts 하나만 매칭 (중첩 구조 X)
    const ids = idx.nodesByFileGlob(['src/*.ts']).map((node) => node.id).sort()
    expect(ids).toEqual([classNode.id, methodNode.id, fileNode.id].sort())
  })

  it("'src/order.t?' 매칭 (? 단일 문자 wildcard)", () => {
    const ids = idx.nodesByFileGlob(['src/order.t?']).map((node) => node.id).sort()
    expect(ids).toEqual([classNode.id, methodNode.id, fileNode.id].sort())
  })
})

describe('createGraphIndex — empty input', () => {
  it('빈 그래프', () => {
    const idx = createGraphIndex({ nodes: [], edges: [] })
    expect(idx.getAllNodes()).toEqual([])
    expect(idx.getAllEdges()).toEqual([])
    expect(idx.getNode('x')).toBeUndefined()
    expect(idx.outgoingEdges('x')).toEqual([])
    expect(idx.incomingEdges('x')).toEqual([])
    expect(idx.edgesByRelation('calls')).toEqual([])
    expect(idx.nodesByType('class')).toEqual([])
    expect(idx.nodesByFile('x')).toEqual([])
    expect(idx.nodesByFileGlob(['**/*'])).toEqual([])
  })
})
