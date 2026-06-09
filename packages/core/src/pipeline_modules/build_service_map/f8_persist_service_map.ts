import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import {
  serviceMapEdges,
  serviceMapNodes,
  type NewServiceMapEdge,
  type NewServiceMapNode,
  type ServiceMapNodeSourceKind,
} from '@/db/schema/build_service_map.js'
import { PipelineError } from '@/infra/errors.js'
import type { MergedServiceMapEdge, PersistServiceMapResult, ServiceMapNode } from './types.js'

export async function persistServiceMap(input: {
  db: DB
  projectId: string
  repoId?: string | null
  runId: string
  edges: MergedServiceMapEdge[]
  includeLowConfidence: boolean
}): Promise<PersistServiceMapResult> {
  const { db, projectId, repoId, runId, edges, includeLowConfidence } = input

  const toInsert = includeLowConfidence
    ? edges
    : edges.filter((e) => e.confidence !== 'low')
  const skippedLowConfidence = edges.length - toInsert.length

  try {
    db.transaction(() => {
      if (repoId) {
        db.delete(serviceMapEdges).where(eq(serviceMapEdges.repoId, repoId)).run()
      } else {
        db.delete(serviceMapEdges).where(eq(serviceMapEdges.projectId, projectId)).run()
      }

      const serviceNodes = buildServiceMapNodeRows(projectId, toInsert)
      for (const node of serviceNodes.values()) {
        db.insert(serviceMapNodes)
          .values(node)
          .onConflictDoUpdate({
            target: serviceMapNodes.id,
            set: {
              repoId: node.repoId,
              nodeId: node.nodeId,
              sourceKind: node.sourceKind,
              sourceId: node.sourceId,
              canonicalKey: node.canonicalKey,
              label: node.label,
              updatedAt: new Date().toISOString(),
            },
          })
          .run()
      }

      if (toInsert.length > 0) {
        const rows: NewServiceMapEdge[] = toInsert.map((edge) => ({
          id: edge.id,
          projectId: edge.projectId,
          repoId: edge.repoId,
          sourceRepoId: edge.sourceRepoId,
          targetRepoId: edge.targetRepoId ?? null,
          runId,
          sourceNodeId: stableServiceMapNodeId(projectId, edge.sourceNode),
          sourceType: edge.sourceNode.type,
          sourceId: edge.sourceNode.id,
          sourceLabel: edge.sourceNode.label,
          targetNodeId: stableServiceMapNodeId(projectId, edge.targetNode),
          targetType: edge.targetNode.type,
          targetId: edge.targetNode.id,
          targetLabel: edge.targetNode.label,
          kind: edge.kind,
          canonicalTarget: edge.canonicalTarget,
          confidence: edge.confidence,
          source: edge.source,
          evidence: edge.evidence,
          unresolvedReason: edge.unresolvedReason ?? null,
        }))
        for (const chunk of chunkRows(rows, 40)) {
          db.insert(serviceMapEdges).values(chunk).run()
        }
      }

      pruneUnreferencedServiceMapNodes(db, projectId)
    })
  } catch (err) {
    throw new PipelineError(
      `service_map persist failed: ${err instanceof Error ? err.message : String(err)}`,
      'ANALYSIS_FAILED',
      { cause: err },
    )
  }

  return { insertedEdges: toInsert.length, skippedLowConfidence }
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size))
  }
  return chunks
}

function buildServiceMapNodeRows(
  projectId: string,
  edges: MergedServiceMapEdge[],
): Map<string, NewServiceMapNode> {
  const nodes = new Map<string, NewServiceMapNode>()
  for (const edge of edges) {
    for (const node of [edge.sourceNode, edge.targetNode]) {
      const id = stableServiceMapNodeId(projectId, node)
      nodes.set(id, {
        id,
        projectId,
        repoId: node.repoId ?? null,
        type: node.type,
        nodeId: node.id,
        sourceKind: sourceKindForNode(node),
        sourceId: node.id,
        canonicalKey: canonicalNodeKey(node),
        label: node.label,
      })
    }
  }
  return nodes
}

function stableServiceMapNodeId(projectId: string, node: ServiceMapNode): string {
  const seed = [projectId, node.type, sourceKindForNode(node), node.id].join(':')
  return createHash('sha256').update(seed).digest('hex').slice(0, 16)
}

function canonicalNodeKey(node: ServiceMapNode): string {
  return `${node.type}:${node.id}`
}

function sourceKindForNode(node: ServiceMapNode): ServiceMapNodeSourceKind {
  if (node.type === 'db' || node.type === 'external_service' || node.type === 'external_link') {
    return 'synthetic'
  }
  if (node.type === 'event' && node.id.startsWith('event:')) {
    return 'synthetic'
  }
  return 'entry_point'
}

function pruneUnreferencedServiceMapNodes(db: DB, projectId: string): void {
  db.run(sql`
    DELETE FROM service_map_nodes
    WHERE project_id = ${projectId}
      AND id NOT IN (
        SELECT source_node_id
        FROM service_map_edges
        WHERE project_id = ${projectId}
          AND source_node_id IS NOT NULL
        UNION
        SELECT target_node_id
        FROM service_map_edges
        WHERE project_id = ${projectId}
          AND target_node_id IS NOT NULL
      )
  `)
}
