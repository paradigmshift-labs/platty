import { createHash } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { repositories } from '@/db/schema/core.js'
import { entryPoints } from '@/db/schema/build_route.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import { serviceMapEdges, serviceMapNodes, type ServiceMapEdge, type ServiceMapNode } from '@/db/schema/build_service_map.js'

export interface ServiceMapGraph {
  nodes: ServiceMapNode[]
  edges: ServiceMapEdge[]
}

export type ArtifactGraphView = 'repo_map' | 'all_nodes' | 'repo_summary' | 'node_focus'
export type ArtifactNodeStatus = 'active' | 'unresolved' | 'deprecated'

export interface ServiceMapArtifact {
  projectId: string
  generatedAt: string
  summary: {
    nodeCount: number
    edgeCount: number
    unresolvedEdgeCount: number
    nodeTypeCounts: Record<string, number>
    edgeKindCounts: Record<string, number>
  }
  views: {
    repoMap: ArtifactGraph
    allNodes: ArtifactGraph
    repoSummaries: Record<string, ArtifactGraph>
    nodeFocus: Record<string, ArtifactGraph>
  }
}

export interface ArtifactGraph {
  view: ArtifactGraphView
  title: string
  nodes: ArtifactNode[]
  edges: ArtifactEdge[]
}

export interface ArtifactNode {
  id: string
  label: string
  type: string
  repoId?: string | null
  repoLabel?: string
  detail?: string
  count?: number
  status?: ArtifactNodeStatus
}

export interface ArtifactEdge {
  id: string
  source: string
  target: string
  kind: string
  detail?: string
  count?: number
  unresolved?: boolean
  confidence?: string
}

export interface BuildServiceMapArtifactInput {
  projectId: string
  generatedAt: string
  graph: ServiceMapGraph
  repoLabels?: Record<string, string>
}

type ArtifactEntryPointRow = {
  id: string
  repoId: string
  kind: string
  httpMethod: string | null
  path: string | null
  fullPath: string | null
  handlerNodeId: string
  metadata: Record<string, unknown> | null
  filePath: string | null
  name: string | null
}

export function buildServiceMapArtifactFromDb(input: {
  db: DB
  projectId: string
  generatedAt: string
}): ServiceMapArtifact {
  const repoRows = input.db.select().from(repositories).where(eq(repositories.projectId, input.projectId)).all()
    .filter((repo) => !repo.deletedAt)
  const graph: ServiceMapGraph = {
    nodes: input.db.select().from(serviceMapNodes).where(eq(serviceMapNodes.projectId, input.projectId)).all(),
    edges: input.db.select().from(serviceMapEdges).where(eq(serviceMapEdges.projectId, input.projectId)).all(),
  }
  const generatedAt = input.generatedAt
  const repoIds = repoRows.map((repo) => repo.id)
  if (repoIds.length > 0) {
    const routeNodes = input.db.select({
      id: entryPoints.id,
      repoId: entryPoints.repoId,
      kind: entryPoints.kind,
      httpMethod: entryPoints.httpMethod,
      path: entryPoints.path,
      fullPath: entryPoints.fullPath,
      handlerNodeId: entryPoints.handlerNodeId,
      metadata: entryPoints.metadata,
      filePath: codeNodes.filePath,
      name: codeNodes.name,
    })
      .from(entryPoints)
      .leftJoin(codeNodes, eq(entryPoints.handlerNodeId, codeNodes.id))
      .where(inArray(entryPoints.repoId, repoIds))
      .all()
    graph.nodes = mergeServiceMapNodes(
      graph.nodes,
      routeNodes.map((entryPoint) => entryPointToServiceMapNode(input.projectId, generatedAt, entryPoint)),
    )
    graph.edges = mergeServiceMapEdges(
      graph.edges,
      buildSemanticRouteEdges(input.projectId, generatedAt, routeNodes),
    )
  }
  const repoLabels = Object.fromEntries(repoRows.map((repo) => [repo.id, displayRepositoryName(repo)]))
  return buildServiceMapArtifact({
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    graph,
    repoLabels,
  })
}

function mergeServiceMapNodes(nodes: ServiceMapNode[], routeNodes: ServiceMapNode[]): ServiceMapNode[] {
  const merged = new Map(nodes.map((node) => [node.id, node]))
  for (const node of routeNodes) {
    if (!merged.has(node.id)) merged.set(node.id, node)
  }
  return [...merged.values()]
}

function entryPointToServiceMapNode(
  projectId: string,
  generatedAt: string,
  entryPoint: ArtifactEntryPointRow,
): ServiceMapNode {
  const type = entryPointKindToNodeType(entryPoint.kind)
  const path = entryPoint.fullPath ?? entryPoint.path ?? entryPoint.id
  const label = type === 'api' && entryPoint.httpMethod
    ? `${entryPoint.httpMethod} ${path}`
    : (entryPoint.name ?? path)
  return {
    id: stableEntryPointServiceMapNodeId(projectId, type, entryPoint.id),
    projectId,
    repoId: entryPoint.repoId,
    type,
    nodeId: entryPoint.id,
    sourceKind: 'entry_point',
    sourceId: entryPoint.id,
    canonicalKey: `${type}:${path}`,
    label,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  }
}

function mergeServiceMapEdges(edges: ServiceMapEdge[], routeEdges: ServiceMapEdge[]): ServiceMapEdge[] {
  const merged = new Map(edges.map((edge) => [serviceMapEdgeLogicalKey(edge), edge]))
  for (const edge of routeEdges) {
    const key = serviceMapEdgeLogicalKey(edge)
    if (!merged.has(key)) merged.set(key, edge)
  }
  return [...merged.values()]
}

function buildSemanticRouteEdges(
  projectId: string,
  generatedAt: string,
  entryPointRows: ArtifactEntryPointRow[],
): ServiceMapEdge[] {
  const byRepoAndName = new Map<string, typeof entryPointRows>()
  for (const row of entryPointRows) {
    if (!row.name) continue
    const key = `${row.repoId}\0${row.name}`
    const rows = byRepoAndName.get(key) ?? []
    rows.push(row)
    byRepoAndName.set(key, rows)
  }

  const edges: ServiceMapEdge[] = []
  for (const target of entryPointRows) {
    const metadata = target.metadata ?? {}
    if (metadata.semanticEntry !== true) continue
    const parentPage = typeof metadata.parentPage === 'string' ? metadata.parentPage.trim() : ''
    if (!parentPage) continue
    const source = selectParentEntryPoint(byRepoAndName.get(`${target.repoId}\0${parentPage}`) ?? [])
    if (!source || source.id === target.id) continue

    const sourceType = entryPointKindToNodeType(source.kind)
    const targetType = entryPointKindToNodeType(target.kind)
    const sourceNodeId = stableEntryPointServiceMapNodeId(projectId, sourceType, source.id)
    const targetNodeId = stableEntryPointServiceMapNodeId(projectId, targetType, target.id)
    const canonicalTarget = target.fullPath ?? target.path ?? target.id
    const sourceLabel = source.name ?? source.fullPath ?? source.path ?? source.id
    const targetLabel = target.name ?? target.fullPath ?? target.path ?? target.id
    edges.push({
      id: stableSemanticRouteEdgeId(projectId, source.id, target.id, canonicalTarget),
      projectId,
      repoId: source.repoId,
      sourceRepoId: source.repoId,
      targetRepoId: target.repoId,
      runId: 'artifact:semantic-routes',
      sourceNodeId,
      sourceType,
      sourceId: source.id,
      sourceLabel,
      targetNodeId,
      targetType,
      targetId: target.id,
      targetLabel,
      kind: 'navigates',
      canonicalTarget,
      confidence: 'high',
      source: 'deterministic',
      evidence: {
        warnings: [`semantic_route:${String(metadata.navigationKind ?? 'internal')}`],
      },
      unresolvedReason: null,
      createdAt: generatedAt,
    })
  }
  return edges
}

function selectParentEntryPoint(rows: ArtifactEntryPointRow[]): ArtifactEntryPointRow | null {
  if (rows.length === 0) return null
  const external = rows.filter((row) => !(row.fullPath ?? row.path ?? '').startsWith('internal://'))
  return (external[0] ?? rows[0]) ?? null
}

function serviceMapEdgeLogicalKey(edge: ServiceMapEdge): string {
  return [
    edge.repoId,
    edge.sourceType,
    edge.sourceId,
    edge.targetType,
    edge.targetId,
    edge.kind,
    edge.canonicalTarget,
  ].join('\0')
}

function stableSemanticRouteEdgeId(
  projectId: string,
  sourceEntryPointId: string,
  targetEntryPointId: string,
  canonicalTarget: string,
): string {
  const seed = [projectId, 'semantic-route', sourceEntryPointId, targetEntryPointId, canonicalTarget].join(':')
  return createHash('sha256').update(seed).digest('hex').slice(0, 16)
}

function stableEntryPointServiceMapNodeId(projectId: string, type: string, entryPointId: string): string {
  const seed = [projectId, type, 'entry_point', entryPointId].join(':')
  return createHash('sha256').update(seed).digest('hex').slice(0, 16)
}

function entryPointKindToNodeType(kind: string): ServiceMapNode['type'] {
  if (kind === 'api') return 'api'
  if (kind === 'job') return 'job'
  if (kind === 'event') return 'event'
  return 'screen'
}

export function buildServiceMapArtifact(input: BuildServiceMapArtifactInput): ServiceMapArtifact {
  const nodeById = new Map(input.graph.nodes.map((node) => [node.id, node]))
  const repoLabels = input.repoLabels ?? {}
  return {
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    summary: {
      nodeCount: input.graph.nodes.length,
      edgeCount: input.graph.edges.length,
      unresolvedEdgeCount: input.graph.edges.filter((edge) => edge.unresolvedReason).length,
      nodeTypeCounts: countBy(input.graph.nodes.map((node) => node.type)),
      edgeKindCounts: countBy(input.graph.edges.map((edge) => edge.kind)),
    },
    views: {
      repoMap: buildRepoMap(input.graph, nodeById, repoLabels),
      allNodes: buildAllNodes(input.graph, nodeById, repoLabels),
      repoSummaries: buildRepoSummaries(input.graph, nodeById, repoLabels),
      nodeFocus: buildNodeFocusViews(input.graph, nodeById, repoLabels),
    },
  }
}

function buildRepoMap(
  graph: ServiceMapGraph,
  nodeById: Map<string, ServiceMapGraph['nodes'][number]>,
  repoLabels: Record<string, string>,
): ArtifactGraph {
  const repoCounts = new Map<string, number>()
  for (const node of graph.nodes) {
    const key = groupKey(node)
    repoCounts.set(key, (repoCounts.get(key) ?? 0) + 1)
  }

  const edgeCounts = new Map<string, { source: string; target: string; kind: string; count: number; unresolved: boolean }>()
  for (const edge of graph.edges) {
    const sourceRepo = groupKey(edge.sourceNodeId ? nodeById.get(edge.sourceNodeId) : undefined, edge.sourceType)
    const targetRepo = groupKey(edge.targetNodeId ? nodeById.get(edge.targetNodeId) : undefined, edge.targetType)
    if (sourceRepo === targetRepo) continue
    const key = `${sourceRepo}\t${targetRepo}\t${edge.kind}`
    const existing = edgeCounts.get(key)
    edgeCounts.set(key, {
      source: sourceRepo,
      target: targetRepo,
      kind: edge.kind,
      count: (existing?.count ?? 0) + 1,
      unresolved: Boolean(existing?.unresolved || edge.unresolvedReason),
    })
  }

  return {
    view: 'repo_map',
    title: 'Repository Map',
    nodes: [...repoCounts.entries()].sort(byFirst).map(([id, count]) => ({
      id,
      label: repoLabel(id, repoLabels),
      type: id === 'repo:external' ? 'external' : 'repo',
      count,
    })),
    edges: [...edgeCounts.values()].sort(byEdge).map((edge) => ({
      id: `repo-edge:${edge.source}:${edge.target}:${edge.kind}`,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      count: edge.count,
      unresolved: edge.unresolved,
    })),
  }
}

function buildAllNodes(
  graph: ServiceMapGraph,
  nodeById: Map<string, ServiceMapGraph['nodes'][number]>,
  repoLabels: Record<string, string>,
): ArtifactGraph {
  return {
    view: 'all_nodes',
    title: 'All Service Nodes',
    nodes: graph.nodes.map((node) => nodeToArtifact(node, repoLabels)).filter(isArtifactNode).sort(byNode),
    edges: graph.edges.map((edge) => edgeToArtifact(edge, nodeById)).sort(byEdge),
  }
}

function buildRepoSummaries(
  graph: ServiceMapGraph,
  nodeById: Map<string, ServiceMapGraph['nodes'][number]>,
  repoLabels: Record<string, string>,
): Record<string, ArtifactGraph> {
  const repoIds = new Set(graph.nodes.map((node) => node.repoId).filter((repoId): repoId is string => Boolean(repoId)))
  const summaries: Record<string, ArtifactGraph> = {}

  for (const repoId of [...repoIds].sort()) {
    const nodeIds = new Set(graph.nodes.filter((node) => node.repoId === repoId).map((node) => node.id))
    for (const edge of graph.edges) {
      if (edge.sourceNodeId && nodeIds.has(edge.sourceNodeId) && edge.targetNodeId) nodeIds.add(edge.targetNodeId)
      if (edge.targetNodeId && nodeIds.has(edge.targetNodeId) && edge.sourceNodeId) nodeIds.add(edge.sourceNodeId)
    }

    summaries[repoId] = {
      view: 'repo_summary',
      title: `${repoLabels[repoId] ?? repoId} Summary`,
      nodes: [...nodeIds].map((id) => nodeToArtifact(nodeById.get(id), repoLabels)).filter(isArtifactNode).sort(byNode),
      edges: graph.edges.filter((edge) =>
        (edge.sourceNodeId && nodeIds.has(edge.sourceNodeId)) ||
        (edge.targetNodeId && nodeIds.has(edge.targetNodeId)),
      ).map((edge) => edgeToArtifact(edge, nodeById)).sort(byEdge),
    }
  }

  return summaries
}

function buildNodeFocusViews(
  graph: ServiceMapGraph,
  nodeById: Map<string, ServiceMapGraph['nodes'][number]>,
  repoLabels: Record<string, string>,
): Record<string, ArtifactGraph> {
  const views: Record<string, ArtifactGraph> = {}
  for (const focus of graph.nodes) {
    const edgeSet = graph.edges.filter((edge) => edge.sourceNodeId === focus.id || edge.targetNodeId === focus.id)
    const nodeIds = new Set<string>([focus.id])
    for (const edge of edgeSet) {
      if (edge.sourceNodeId) nodeIds.add(edge.sourceNodeId)
      if (edge.targetNodeId) nodeIds.add(edge.targetNodeId)
    }
    views[focus.id] = {
      view: 'node_focus',
      title: humanNodeLabel(focus),
      nodes: [...nodeIds].map((id) => nodeToArtifact(nodeById.get(id), repoLabels)).filter(isArtifactNode).sort(byNode),
      edges: edgeSet.map((edge) => edgeToArtifact(edge, nodeById)).sort(byEdge),
    }
  }
  return views
}

function edgeToArtifact(
  edge: ServiceMapGraph['edges'][number],
  nodeById: Map<string, ServiceMapGraph['nodes'][number]>,
): ArtifactEdge {
  return {
    id: edge.id,
    source: edge.sourceNodeId ?? `unresolved-source:${edge.id}`,
    target: edge.targetNodeId ?? `unresolved:${edge.id}`,
    kind: edge.kind,
    unresolved: Boolean(edge.unresolvedReason),
    confidence: edge.confidence,
    detail: edgeLabel(edge, nodeById),
  }
}

function nodeToArtifact(
  node: ServiceMapGraph['nodes'][number] | undefined,
  repoLabels: Record<string, string>,
): ArtifactNode | null {
  if (!node) return null
  const label = humanNodeLabel(node)
  const fallbackDetail = node.label && node.label !== label ? node.label : node.canonicalKey
  return {
    id: node.id,
    label,
    type: node.type,
    repoId: node.repoId,
    repoLabel: node.repoId ? repoLabels[node.repoId] ?? node.repoId : nullGroupLabel(node.type),
    detail: fallbackDetail,
    status: 'active',
  }
}

function groupKey(node: ServiceMapGraph['nodes'][number] | undefined, fallbackType?: string) {
  if (node?.repoId) return `repo:${node.repoId}`
  return `group:${nullGroupId(node?.type ?? fallbackType)}`
}

function repoLabel(id: string, repoLabels: Record<string, string>) {
  if (id.startsWith('group:')) return nullGroupLabel(id.replace(/^group:/, ''))
  const repoId = id.replace(/^repo:/, '')
  return repoLabels[repoId] ?? repoId
}

function nullGroupId(type: string | undefined) {
  if (type === 'db') return 'database'
  if (type === 'external_service') return 'external-services'
  if (type === 'external_link') return 'external-links'
  if (type === 'event') return 'events'
  return 'unassigned'
}

function nullGroupLabel(typeOrGroup: string | undefined) {
  const group = typeOrGroup && ['database', 'external-services', 'external-links', 'events', 'unassigned'].includes(typeOrGroup)
    ? typeOrGroup
    : nullGroupId(typeOrGroup)
  if (group === 'database') return 'Database'
  if (group === 'external-services') return 'External Services'
  if (group === 'external-links') return 'External Links'
  if (group === 'events') return 'Events'
  return 'Unassigned'
}

function humanNodeLabel(node: ServiceMapGraph['nodes'][number]): string {
  const rawLabel = node.label ?? node.canonicalKey ?? node.nodeId ?? node.id
  if (node.type === 'api') {
    const route = routeFromKey(node.canonicalKey) ?? routeFromKey(rawLabel)
    if (route) return route
  }
  if (node.type === 'screen') {
    return humanEntryLabel(rawLabel) ?? humanEntryLabel(node.canonicalKey) ?? rawLabel
  }
  if (node.type === 'job' || node.type === 'event') {
    return humanEntryLabel(rawLabel) ?? humanEntryLabel(node.canonicalKey) ?? rawLabel
  }
  if (node.type === 'db') return rawLabel.replace(/^db:/, '')
  if (node.type === 'external_service') return rawLabel.replace(/^external_service:/, '')
  if (node.type === 'external_link') return rawLabel.replace(/^external:/, '')
  if (!looksLikeOpaqueId(rawLabel)) return rawLabel
  return node.canonicalKey
}

function routeFromKey(value: string) {
  const match = value.match(/:api:([A-Z]+):([^:]+):/)
  if (!match) return null
  return `${match[1]} ${match[2]}`
}

function humanEntryLabel(value: string) {
  if (!value.includes(':')) return looksLikeOpaqueId(value) ? null : value
  const parts = value.split(':').filter(Boolean)
  const last = parts.at(-1)
  if (!last || looksLikeOpaqueId(last)) return null
  if (last.includes('/') && parts.length > 1) return parts.at(-2) ?? last
  return last
}

function edgeLabel(edge: ServiceMapGraph['edges'][number], nodeById: Map<string, ServiceMapGraph['nodes'][number]>) {
  const source = edge.sourceNodeId ? nodeById.get(edge.sourceNodeId) : null
  const target = edge.targetNodeId ? nodeById.get(edge.targetNodeId) : null
  const sourceLabel = source ? humanNodeLabel(source) : edge.sourceLabel
  const targetLabel = target ? humanNodeLabel(target) : edge.targetLabel
  return `${sourceLabel} -> ${targetLabel}`
}

function looksLikeOpaqueId(value: string) {
  if (/^[A-Z][A-Za-z0-9]+$/.test(value) && /[a-z]/.test(value)) return false
  return /^[A-Za-z0-9_-]{16,}$/.test(value)
}

function countBy(values: string[]) {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

function isArtifactNode(node: ArtifactNode | null): node is ArtifactNode {
  return Boolean(node)
}

function byFirst(a: [string, unknown], b: [string, unknown]) {
  return a[0].localeCompare(b[0])
}

function byNode(a: ArtifactNode, b: ArtifactNode) {
  return a.id.localeCompare(b.id)
}

function byEdge(a: Pick<ArtifactEdge, 'source' | 'target' | 'kind'>, b: Pick<ArtifactEdge, 'source' | 'target' | 'kind'>) {
  return `${a.source}\t${a.target}\t${a.kind}`.localeCompare(`${b.source}\t${b.target}\t${b.kind}`)
}

function displayRepositoryName(repo: { id: string; name: string; repoPath: string }) {
  if (repo.name && !looksLikeGeneratedId(repo.name)) return repo.name
  return repo.repoPath.split('/').filter(Boolean).at(-1) || repo.name || repo.id
}

function looksLikeGeneratedId(value: string) {
  return value.length >= 16 && /[A-Z]/.test(value) && /[_-]/.test(value)
}
