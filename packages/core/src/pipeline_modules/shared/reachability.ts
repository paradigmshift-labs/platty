import type { CodeNode } from '@/db/schema/code_graph.js'

export interface ReachabilityEdge {
  sourceId: string
  targetId: string | null
  relation: string
}
export type ReachabilityNode = Pick<CodeNode, 'id' | 'type' | 'filePath' | 'lineStart' | 'lineEnd'> &
  Partial<Pick<CodeNode, 'parentNodeId' | 'originKind' | 'role'>>

// 단일 도달성 정의 (single source of truth). build_route 번들 생성과 build_service_map anchor가
// **반드시 동일한 set**을 써야 한다 — 서로 다른 set으로 표류하면 화면발 관계가 누락된다(renders 버그의 근원).
//   실행(behavior): calls · renders · DI(type_resolved/resolves_to)
//   데이터(type):    type_ref · depends_on → 요청/응답 DTO·엔티티 (build_docs 명세용; service_map엔 무해)
//   스캐폴딩(대상 찾기): contains · extends · implements
// imports는 제외 — "import만 하고 호출 안 함"까지 끌어와 과수집한다(도달성 근거 아님). 호출되는 래퍼는
// build_graph가 cross-file resolves_to로 풀어주므로 imports 안전망이 더는 필요 없다.
export const ROUTE_REACHABILITY_RELATIONS: ReadonlySet<string> = new Set([
  'calls',
  'renders',
  'contains',
  'extends',
  'implements',
  'type_resolved',
  'resolves_to',
  'type_ref',
  'depends_on',
])

const LOCAL_EXECUTABLE_NODE_TYPES = new Set(['function', 'method', 'variable'])

export function shouldTraverseReachabilityEdge(
  edge: ReachabilityEdge,
  nodesById: Pick<ReadonlyMap<string, ReachabilityNode>, 'get'>,
  traceableRelations: ReadonlySet<string>,
  options: { seedIds?: ReadonlySet<string> } = {},
): boolean {
  if (!edge.targetId) return false
  if (!traceableRelations.has(edge.relation)) return false
  if (edge.relation !== 'contains') return true

  const source = nodesById.get(edge.sourceId)
  const target = nodesById.get(edge.targetId)
  if (options.seedIds?.has(edge.sourceId) && source && target && source.filePath === target.filePath) {
    return true
  }
  return shouldTraverseContains(source, target)
}

export function shouldTraverseContains(
  source: ReachabilityNode | undefined,
  target: ReachabilityNode | undefined,
): boolean {
  if (!source || !target) return false
  if (source.id === target.id) return false
  if (source.filePath !== target.filePath) return false
  if (!LOCAL_EXECUTABLE_NODE_TYPES.has(source.type)) return false
  if (!LOCAL_EXECUTABLE_NODE_TYPES.has(target.type)) return false
  if (target.parentNodeId === source.id) return true
  if (source.lineStart == null || source.lineEnd == null) return false
  if (target.lineStart == null || target.lineEnd == null) return false

  return source.lineStart <= target.lineStart && source.lineEnd >= target.lineEnd
}
