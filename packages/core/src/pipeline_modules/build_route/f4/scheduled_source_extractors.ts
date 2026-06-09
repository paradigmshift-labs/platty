import type { CodeNode } from '@/db/schema/code_graph.js'
import type { EntryPointDraft, SourceRouteContext } from '../types.js'

export function hasNodeCronScheduleSignal(ctx: SourceRouteContext): boolean {
  return ctx.graphEdges.some((edge) => edge.relation === 'imports' && edge.targetSpecifier === 'node-cron')
    && ctx.graphEdges.some((edge) => edge.relation === 'calls' && edge.targetSymbol === 'schedule' && edge.firstArg)
}

export function buildNodeCronFallbackEntries(ctx: SourceRouteContext): EntryPointDraft[] {
  const nodeById = new Map(ctx.graphNodes.map((node) => [node.id, node]))
  const importedNodeIds = new Set(ctx.graphEdges
    .filter((edge) => edge.relation === 'imports' && edge.targetSpecifier === 'node-cron')
    .map((edge) => edge.sourceId))
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()

  for (const edge of ctx.graphEdges) {
    if (edge.relation !== 'calls' || edge.targetSymbol !== 'schedule' || !edge.firstArg) continue
    const sourceNode = nodeById.get(edge.sourceId)
    if (!sourceNode || !fileImportsNodeCron(sourceNode, importedNodeIds, ctx.graphNodes)) continue

    const schedule = edge.firstArg
    const fullPath = `schedule:node-cron:${schedule}:${sourceNode.name}`
    const key = `${fullPath}:${sourceNode.id}`
    if (seen.has(key)) continue
    seen.add(key)

    out.push({
      framework: 'node',
      kind: 'job',
      httpMethod: 'SCHEDULE',
      path: fullPath,
      fullPath,
      handlerNodeId: sourceNode.id,
      metadata: {
        sourceFallback: 'node_cron_schedule',
        package: 'node-cron',
        schedule,
      },
      detectionSource: 'source:node_cron',
      confidence: 'high',
      detectionEvidence: {
        matchedRuleId: 'source_node_cron_schedule',
        matchedNodeIds: [sourceNode.id],
        matchedEdgeIds: typeof edge.id === 'number' ? [edge.id] : [],
      },
    })
  }

  return out
}

function fileImportsNodeCron(
  sourceNode: CodeNode,
  importedNodeIds: Set<string>,
  graphNodes: CodeNode[],
): boolean {
  if (importedNodeIds.has(sourceNode.id)) return true
  const sameFileNodeIds = graphNodes
    .filter((node) => node.filePath === sourceNode.filePath)
    .map((node) => node.id)
  return sameFileNodeIds.some((nodeId) => importedNodeIds.has(nodeId))
}
