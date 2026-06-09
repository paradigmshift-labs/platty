// f5 resolveReachability — entry_point handler 에서 BFS 로 reachable 노드 수집.
// SOT: specs/build_route/specs/f5_resolve_reachability/spec.md
//
// caps 우선순위 (조기 종료):
//   1. maxNodes — 노드 수 폭증 방어
//   2. maxDepth — 호출 chain 길이
//   3. maxFanOut — 한 노드의 outgoing 폭 제한
// visited Set 으로 cycle 방어. shared traversal 캐시는 호출자 책임 (orchestrator).

import type { GraphIndex } from './graph_index.js'
import type { BundleEntry, ReachabilityCaps } from './types.js'
import { shouldTraverseReachabilityEdge, ROUTE_REACHABILITY_RELATIONS } from '@/pipeline_modules/shared/reachability.js'

// 단일 도달성 정의 (shared) — build_service_map anchor와 반드시 동일. drift 방지.
const TRACEABLE_RELATIONS = ROUTE_REACHABILITY_RELATIONS

const DEFAULT_CAPS: Required<ReachabilityCaps> = {
  maxNodes: 5000,
  maxDepth: 10,
  maxFanOut: 50,
}

export interface ResolveReachabilityInput {
  entryPointId: string
  startNodeId: string
  seedNodeIds?: string[]
  graph: GraphIndex
  caps?: ReachabilityCaps
}

export interface ResolveReachabilityResult {
  bundle: BundleEntry[]
  truncatedBy?: 'node_count' | 'depth' | 'fan_out'
}

export function resolveReachability(input: ResolveReachabilityInput): ResolveReachabilityResult {
  const caps = { ...DEFAULT_CAPS, ...input.caps }
  const visited = new Set<string>()
  const bundle: BundleEntry[] = []
  let truncatedBy: 'node_count' | 'depth' | 'fan_out' | undefined

  const start = input.graph.getNode(input.startNodeId)
  if (!start) return { bundle }
  const seedIds = new Set([
    input.startNodeId,
    ...(input.seedNodeIds ?? []).filter((nodeId) => input.graph.getNode(nodeId)),
  ])

  const queue: Array<{ nodeId: string; depth: number; edgePath: string[] }> = [...seedIds]
    .map((nodeId) => ({ nodeId, depth: 0, edgePath: [] }))

  while (queue.length > 0) {
    const { nodeId, depth, edgePath } = queue.shift()!
    if (visited.has(nodeId)) continue
    const current = input.graph.getNode(nodeId)
    if (!current) continue
    visited.add(nodeId)

    bundle.push({
      entryPointId: input.entryPointId,
      nodeId,
      depth,
      edgePath: edgePath.length > 0 ? edgePath : undefined,
    })

    if (bundle.length >= caps.maxNodes) {
      truncatedBy = 'node_count'
      break
    }
    if (depth >= caps.maxDepth) {
      // 더 이상 확장 안 함
      truncatedBy = truncatedBy ?? 'depth'
      continue
    }
    const outgoing = input.graph
      .outgoingEdges(nodeId)
      .filter((edge) =>
        shouldTraverseRouteEdge(edge, edgePath, input.graph, seedIds),
      )

    if (outgoing.length > caps.maxFanOut) {
      truncatedBy = truncatedBy ?? 'fan_out'
      continue
    }

    for (const edge of outgoing) {
      if (!edge.targetId) continue
      if (!input.graph.getNode(edge.targetId)) continue
      if (visited.has(edge.targetId)) continue
      queue.push({
        nodeId: edge.targetId,
        depth: depth + 1,
        edgePath: [...edgePath, edge.relation],
      })
    }
  }

  return { bundle, truncatedBy }
}

function shouldTraverseRouteEdge(
  edge: ReturnType<GraphIndex['outgoingEdges']>[number],
  edgePath: string[],
  graph: GraphIndex,
  seedIds: ReadonlySet<string>,
): boolean {
  if (edge.relation === 'contains' && edge.targetId && shouldExpandLocalContainer(edgePath)) {
    const source = graph.getNode(edge.sourceId)
    const target = graph.getNode(edge.targetId)
    if (
      source &&
      target &&
      source.filePath === target.filePath &&
      !isLocalClassMemberFanout(source, target, seedIds)
    ) {
      return true
    }
  }
  return shouldTraverseReachabilityEdge(edge, {
    get: (id: string) => graph.getNode(id),
  }, TRACEABLE_RELATIONS, { seedIds })
}

function shouldExpandLocalContainer(edgePath: string[]): boolean {
  return edgePath.length === 0 ||
    edgePath.every((relation) => relation === 'contains') ||
    edgePath.includes('contains') ||
    edgePath.includes('renders')
}

function isLocalClassMemberFanout(
  source: ReturnType<GraphIndex['getNode']>,
  target: ReturnType<GraphIndex['getNode']>,
  seedIds: ReadonlySet<string>,
): boolean {
  return source?.type === 'class' &&
    !seedIds.has(source.id) &&
    (target?.type === 'method' || target?.type === 'property')
}
