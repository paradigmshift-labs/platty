// f3/suspected_collector — 룰 매칭 안 된 routing_files / delegate 룰을 f4 입력으로.
// SOT: spec.md §5.7 (S34~S36)

import type { GraphIndex } from '../graph_index.js'
import type { SuspectedNode } from '../types.js'

export interface SuspectedCollectInput {
  routingFiles: string[]
  emittedHandlerNodeIds: Set<string>
  graph: GraphIndex
  adapter: string
}

/**
 * routing_files 안의 모든 노드 중 emitted 가 0건인 file 을 suspected 로 모은다.
 * (S35: routing_files 에 룰 매칭 0건 file → suspected 1건)
 */
export function collectUnmatchedRoutingFiles(
  input: SuspectedCollectInput,
): SuspectedNode[] {
  const out: SuspectedNode[] = []
  const seen = new Set<string>()

  for (const filePath of input.routingFiles) {
    const fileNodes = input.graph.nodesByFile(filePath)
    if (fileNodes.length === 0) continue

    const fileEmittedAny = fileNodes.some((node) => input.emittedHandlerNodeIds.has(node.id))
    if (fileEmittedAny) continue

    // file 노드 우선, 없으면 첫 노드
    const target = fileNodes.find((n) => n.type === 'file') ?? fileNodes[0]
    if (seen.has(target.id)) continue
    seen.add(target.id)

    out.push({
      nodeId: target.id,
      adapter: input.adapter,
      reason: 'unmatched_routing_file',
      contextHint: 'file',
    })
  }

  return out
}
