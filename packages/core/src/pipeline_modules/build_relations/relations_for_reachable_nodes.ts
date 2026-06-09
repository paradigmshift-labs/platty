// build_docs가 사용하는 reachable relation 조회 헬퍼
// SOT: specs/build_relations/architecture.md §1 (후속 의존)

import { eq } from 'drizzle-orm'
import { codeEdges, codeNodes } from '@/db/schema/code_graph.js'
import { codeRelations } from '@/db/schema/build_relations.js'
import type { DB } from '@/db/client.js'
import { shouldTraverseReachabilityEdge, type ReachabilityNode } from '@/pipeline_modules/shared/reachability.js'

export async function relationsForReachableNodes(params: {
  db: DB
  repoId: string
  seedIds: string[]
  maxHops?: number
}): Promise<typeof codeRelations.$inferSelect[]> {
  const { db, repoId, seedIds, maxHops = 3 } = params

  const edges = db.select({
    sourceId: codeEdges.sourceId,
    targetId: codeEdges.targetId,
    relation: codeEdges.relation,
  }).from(codeEdges).where(eq(codeEdges.repoId, repoId)).all()
  const nodes = db.select({
    id: codeNodes.id,
    type: codeNodes.type,
    filePath: codeNodes.filePath,
    lineStart: codeNodes.lineStart,
    lineEnd: codeNodes.lineEnd,
  }).from(codeNodes).where(eq(codeNodes.repoId, repoId)).all()

  const reachable = reachableNodeIds(seedIds, edges, maxHops, new Map(nodes.map((node) => [node.id, node])))

  return db.select()
    .from(codeRelations)
    .where(eq(codeRelations.repoId, repoId))
    .all()
    .filter((rel) => reachable.has(rel.sourceNodeId))
}

function reachableNodeIds(
  seeds: string[],
  edges: Array<{ sourceId: string; targetId: string | null; relation: string }>,
  maxHops: number,
  nodesById: ReadonlyMap<string, ReachabilityNode>,
): Set<string> {
  const visited = new Set(seeds)
  let frontier = new Set(seeds)
  const seedSet = new Set(seeds)
  const traceableRelations = new Set(['calls', 'type_resolved', 'contains'])

  for (let hop = 0; hop < maxHops && frontier.size > 0; hop++) {
    const next = new Set<string>()
    for (const edge of edges) {
      if (!frontier.has(edge.sourceId)) continue
      if (!edge.targetId) continue
      if (!shouldTraverseReachabilityEdge(edge, nodesById, traceableRelations, { seedIds: seedSet })) continue
      const targetId = edge.targetId
      if (visited.has(targetId)) continue
      visited.add(targetId)
      next.add(targetId)
    }
    frontier = next
  }

  return visited
}
