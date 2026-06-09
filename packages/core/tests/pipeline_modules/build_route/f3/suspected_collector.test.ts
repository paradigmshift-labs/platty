import { describe, it, expect } from 'vitest'
import type { CodeNode } from '@/db/schema/code_graph.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { collectUnmatchedRoutingFiles } from '@/pipeline_modules/build_route/f3/suspected_collector.js'

const REPO = 'r1'

function n(p: Partial<CodeNode> & Pick<CodeNode, 'id' | 'type' | 'filePath' | 'name'>): CodeNode {
  return {
    repoId: REPO, lineStart: null, lineEnd: null, signature: null,
    exported: false, isDefaultExport: false, isAsync: false, isTest: false,
    testType: null, docComment: null, parseStatus: 'ok',
    createdAt: '2026-05-08', ...p,
  } as CodeNode
}

describe('S35: routing_files 에 룰 매칭 0건 → suspected', () => {
  it('전혀 매칭 안 된 routing_file → 1건', () => {
    const file = n({ id: 'r1:lib/router.dart', type: 'file', filePath: 'lib/router.dart', name: 'router.dart' })
    const graph = createGraphIndex({ nodes: [file], edges: [] })

    const out = collectUnmatchedRoutingFiles({
      routingFiles: ['lib/router.dart'],
      emittedHandlerNodeIds: new Set(),
      graph,
      adapter: 'flutter_navigator',
    })
    expect(out).toEqual([
      {
        nodeId: file.id,
        adapter: 'flutter_navigator',
        reason: 'unmatched_routing_file',
        contextHint: 'file',
      },
    ])
  })

  it('routing_file 안에 emitted handler 1건이라도 있으면 제외', () => {
    const file = n({ id: 'r1:lib/router.dart', type: 'file', filePath: 'lib/router.dart', name: 'router.dart' })
    const handler = n({ id: 'r1:lib/router.dart:goHome', type: 'function', filePath: 'lib/router.dart', name: 'goHome' })
    const graph = createGraphIndex({ nodes: [file, handler], edges: [] })

    const out = collectUnmatchedRoutingFiles({
      routingFiles: ['lib/router.dart'],
      emittedHandlerNodeIds: new Set([handler.id]),
      graph,
      adapter: 'flutter_navigator',
    })
    expect(out).toEqual([])
  })
})

describe('S36: 모두 룰로 매칭됨 → 빈 배열', () => {
  it('routing_files 비어있음', () => {
    const graph = createGraphIndex({ nodes: [], edges: [] })
    const out = collectUnmatchedRoutingFiles({
      routingFiles: [],
      emittedHandlerNodeIds: new Set(),
      graph,
      adapter: 'x',
    })
    expect(out).toEqual([])
  })

  it('graph 에 routing_file 노드 자체가 없음 → skip (analyze_repo 가 잘못 채움)', () => {
    const graph = createGraphIndex({ nodes: [], edges: [] })
    const out = collectUnmatchedRoutingFiles({
      routingFiles: ['lib/missing.dart'],
      emittedHandlerNodeIds: new Set(),
      graph,
      adapter: 'flutter_navigator',
    })
    expect(out).toEqual([])
  })

  it('file 노드가 없으면 같은 파일의 첫 코드 노드를 fallback target으로 사용', () => {
    const handler = n({ id: 'r1:lib/router.dart:goHome', type: 'function', filePath: 'lib/router.dart', name: 'goHome' })
    const graph = createGraphIndex({ nodes: [handler], edges: [] })
    const out = collectUnmatchedRoutingFiles({
      routingFiles: ['lib/router.dart'],
      emittedHandlerNodeIds: new Set(),
      graph,
      adapter: 'flutter_navigator',
    })

    expect(out).toEqual([
      expect.objectContaining({ nodeId: handler.id, contextHint: 'file' }),
    ])
  })
})

describe('dedup', () => {
  it('routing_files 에 같은 path 두 번 → suspected 1건', () => {
    const file = n({ id: 'r1:r.ts', type: 'file', filePath: 'r.ts', name: 'r.ts' })
    const graph = createGraphIndex({ nodes: [file], edges: [] })
    const out = collectUnmatchedRoutingFiles({
      routingFiles: ['r.ts', 'r.ts'],
      emittedHandlerNodeIds: new Set(),
      graph,
      adapter: 'x',
    })
    expect(out).toHaveLength(1)
  })
})
