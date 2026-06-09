// 어댑터 시나리오 테스트용 공통 graph builder.
// 각 어댑터별 scenarios/<adapter>.test.ts에서 import해서 fixture를 빠르게 만든다.

import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import type { Adapter } from '@/pipeline_modules/build_route/types.js'
import type { LoadedAdapter } from '@/pipeline_modules/build_route/f2_load_adapters.js'

export const TEST_REPO = 'r1'

let edgeIdCounter = 1

export function nextEdgeId(): number {
  return edgeIdCounter++
}

export function resetEdgeId(): void {
  edgeIdCounter = 1
}

export function n(p: Partial<CodeNode> & Pick<CodeNode, 'id' | 'type' | 'filePath' | 'name'>): CodeNode {
  return {
    repoId: TEST_REPO,
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
    createdAt: '2026-05-15',
    ...p,
  } as CodeNode
}

export function e(p: Partial<CodeEdge> & Pick<CodeEdge, 'sourceId' | 'relation'>): CodeEdge {
  return {
    id: nextEdgeId(),
    repoId: TEST_REPO,
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
    createdAt: '2026-05-15',
    ...p,
  } as CodeEdge
}

export function loaded(adapter: Adapter, resolvedAliases: LoadedAdapter['resolvedAliases'] = {}): LoadedAdapter {
  return { ...adapter, resolvedAliases }
}
