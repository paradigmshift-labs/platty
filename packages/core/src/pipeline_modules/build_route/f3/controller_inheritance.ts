// f3/controller_inheritance — class extends 처리 (architecture.md §4.3, spec §5.4).
// 자식 class에 부모의 decorated method 들을 inherited route 로 주입.
// override (이름 충돌) 시 자식 우선. cycle 방어.

import type { GraphIndex } from '../graph_index.js'
import type { InheritanceResult, InheritedMethod } from '../types.js'

export function resolveControllerInheritance(graph: GraphIndex): InheritanceResult {
  const inheritedByClass = new Map<string, InheritedMethod[]>()
  const classNodes = graph.nodesByType('class')

  for (const cls of classNodes) {
    const ownMethodNames = collectOwnMethodNames(cls.id, graph)
    const inherited = collectInherited(cls.id, graph, new Set([cls.id]), ownMethodNames, new Set())
    if (inherited.length > 0) {
      inheritedByClass.set(cls.id, inherited)
    }
  }

  return { inheritedByClass }
}

function collectOwnMethodNames(classId: string, graph: GraphIndex): Set<string> {
  const out = new Set<string>()
  for (const edge of graph.outgoingEdges(classId)) {
    if (edge.relation !== 'contains' || !edge.targetId) continue
    const node = graph.getNode(edge.targetId)
    if (node && node.type === 'method') out.add(node.name)
  }
  return out
}

/**
 * classId 의 부모 chain 을 BFS 로 탐색하여 inherited methods 수집.
 * - cycleVisited: 이미 방문한 class id (cycle 방어)
 * - skipNames: 이름 중복 제거 (override + 같은 이름 다중 상속)
 */
function collectInherited(
  classId: string,
  graph: GraphIndex,
  cycleVisited: Set<string>,
  skipNames: Set<string>,
  collectedSeen: Set<string>,
): InheritedMethod[] {
  const out: InheritedMethod[] = []
  const extendsEdges = graph
    .outgoingEdges(classId)
    .filter((edge) => edge.relation === 'extends' && edge.targetId)

  for (const ext of extendsEdges) {
    const parentId = ext.targetId!
    if (cycleVisited.has(parentId)) continue
    const parent = graph.getNode(parentId)
    if (!parent) continue // external — 추적 불가

    const nextVisited = new Set(cycleVisited)
    nextVisited.add(parentId)

    // 부모의 decorated methods
    for (const containEdge of graph.outgoingEdges(parentId)) {
      if (containEdge.relation !== 'contains' || !containEdge.targetId) continue
      const method = graph.getNode(containEdge.targetId)
      if (!method || method.type !== 'method') continue
      if (skipNames.has(method.name)) continue
      /* v8 ignore next -- skipNames removes duplicate inherited method names before this defensive id guard. */
      if (collectedSeen.has(method.id)) continue
      const decorEdges = graph
        .outgoingEdges(method.id)
        .filter((edge) => edge.relation === 'decorates')
      if (decorEdges.length === 0) continue
      out.push({ method, inheritedFrom: parent, decoratorEdges: decorEdges })
      collectedSeen.add(method.id)
    }

    // 재귀
    const newSkip = new Set(skipNames)
    for (const m of out) newSkip.add(m.method.name)
    out.push(...collectInherited(parentId, graph, nextVisited, newSkip, collectedSeen))
  }

  return out
}
