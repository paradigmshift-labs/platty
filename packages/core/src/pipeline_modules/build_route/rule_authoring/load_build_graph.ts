// rule_authoring/load_build_graph — hydrate a persisted build_graph payload ({nodes, edges}) into a
// GraphIndex so the promote referee can run a candidate against REAL corpus graphs (not just
// hand-built ones). Fills CodeNode/CodeEdge defaults and assigns 1-based edge ids when absent.

import { createGraphIndex } from '../graph_index.js'
import type { GraphIndex } from '../graph_index.js'
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'

export interface BuildGraphPayload {
  nodes?: Record<string, unknown>[]
  edges?: Record<string, unknown>[]
}

export function graphFromBuildGraph(payload: BuildGraphPayload, repoId = 'r1'): GraphIndex {
  const nodes: CodeNode[] = (payload.nodes ?? []).map((nd) => ({
    repoId,
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
    createdAt: '2026-06-02',
    ...nd,
  }) as CodeNode)

  const edges: CodeEdge[] = (payload.edges ?? []).map((ed, i) => ({
    id: (ed.id as number) ?? i + 1,
    repoId,
    targetId: null,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    resolveStatus: 'resolved',
    confidence: null,
    source: 'static',
    createdAt: '2026-06-02',
    ...ed,
  }) as CodeEdge)

  return createGraphIndex({ nodes, edges })
}
