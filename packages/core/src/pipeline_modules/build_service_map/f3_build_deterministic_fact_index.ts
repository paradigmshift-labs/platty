import { nanoid } from 'nanoid'
import { posix as pathPosix } from 'node:path'
import type {
  ServiceMapInputIndex,
  DeterministicFactIndex,
  AnchoredRelationFact,
  UnresolvedServiceMapFact,
  RelationFactKind,
} from './types.js'
import { shouldTraverseReachabilityEdge, ROUTE_REACHABILITY_RELATIONS } from '@/pipeline_modules/shared/reachability.js'

// 단일 도달성 정의 (shared) — build_route 번들 생성과 **반드시 동일**해야 한다.
// 따로 관리하다 표류해서 renders/DI가 빠지면 화면발 관계가 orphan 된다(이 버그의 근원).
const TRACEABLE_FACT_ANCHOR_RELATIONS = ROUTE_REACHABILITY_RELATIONS
const MAX_FACT_ANCHOR_HOPS = 3

export function buildDeterministicFactIndex(input: ServiceMapInputIndex): DeterministicFactIndex {
  const anchoredFacts: AnchoredRelationFact[] = []
  const scheduleMarkers: AnchoredRelationFact[] = []
  const orphanFacts: UnresolvedServiceMapFact[] = []

  // 소속 = build_route 번들 멤버십(단일 출처, 직접 신뢰). 번들 밖이지만 그래프상 진입점에서
  // 닿는 노드는 재추적 결과를 fallback으로 둔다(번들 누락 보완용; 게이트 아님).
  const reachableNodeToEntryPoints = buildReachableNodeToEntryPoints(input)
  const fileHandlerNodeToEntryPoints = buildFileHandlerNodeToEntryPoints(input)
  const nodeToEntryPoints = buildBundleNodeToEntryPoints(input)

  for (const relation of input.codeRelations) {
    const epIds = nodeToEntryPoints.get(relation.sourceNodeId) ??
      reachableNodeToEntryPoints.get(relation.sourceNodeId) ??
      fileHandlerNodeToEntryPoints.get(relation.sourceNodeId) ??
      []

    if (epIds.length === 0) {
      orphanFacts.push({
        factId: nanoid(),
        kind: relation.kind,
        relationId: relation.id,
        reason: 'source_node_not_in_any_bundle',
        metadata: buildAnchorDebugMetadata({
          relation,
          input,
          nodeToEntryPoints,
          reachableNodeToEntryPoints,
          fileHandlerNodeToEntryPoints,
        }),
      })
      continue
    }

    // schedule_trigger → marker only (separate index, skip normal flow)
    if (relation.kind === 'schedule_trigger') {
      for (const epId of epIds) {
        scheduleMarkers.push({
          factId: nanoid(),
          sourceEntryPointId: epId,
          kind: relation.kind as RelationFactKind,
          target: relation.target,
          operation: relation.operation,
          canonicalTarget: relation.canonicalTarget,
          payload: relation.payload as Record<string, unknown>,
          confidence: relation.confidence as 'high' | 'medium' | 'low',
          source: 'deterministic',
          relationId: relation.id,
          evidenceNodeIds: relation.evidenceNodeIds as string[],
          unresolvedReason: relation.unresolvedReason,
        })
      }
      continue
    }

    // same source_node in multiple bundles → duplicate fact per entrypoint
    const metadata = relation.unresolvedReason
      ? buildAnchorDebugMetadata({
          relation,
          input,
          nodeToEntryPoints,
          reachableNodeToEntryPoints,
          fileHandlerNodeToEntryPoints,
        })
      : undefined
    for (const epId of epIds) {
      anchoredFacts.push({
        factId: nanoid(),
        sourceEntryPointId: epId,
        kind: relation.kind as RelationFactKind,
        target: relation.target,
        operation: relation.operation,
        canonicalTarget: relation.canonicalTarget,
        payload: relation.payload as Record<string, unknown>,
        confidence: relation.confidence as 'high' | 'medium' | 'low',
        source: 'deterministic',
        relationId: relation.id,
        evidenceNodeIds: relation.evidenceNodeIds as string[],
        unresolvedReason: relation.unresolvedReason,
        metadata,
      })
    }
  }

  return { anchoredFacts, scheduleMarkers, orphanFacts }
}

function buildBundleNodeToEntryPoints(
  input: ServiceMapInputIndex,
): Map<string, string[]> {
  // build_route 번들이 단일 출처 — 멤버십을 그대로 신뢰한다(재추적/게이트 없음).
  // 번들이 "거짓말"(실행 경로 없는 노드 포함)하지 않게 만드는 정밀화는 build_route의 책임.
  const result = new Map<string, string[]>()
  for (const bundle of input.codeBundles) {
    const existing = result.get(bundle.nodeId) ?? []
    existing.push(bundle.entryPointId)
    result.set(bundle.nodeId, existing)
  }

  return result
}

function buildAnchorDebugMetadata(input: {
  relation: ServiceMapInputIndex['codeRelations'][number]
  input: ServiceMapInputIndex
  nodeToEntryPoints: ReadonlyMap<string, readonly string[]>
  reachableNodeToEntryPoints: ReadonlyMap<string, readonly string[]>
  fileHandlerNodeToEntryPoints: ReadonlyMap<string, readonly string[]>
}): UnresolvedServiceMapFact['metadata'] {
  const nodesById = new Map(input.input.graphNodes.map((node) => [node.id, node]))
  const sourceNode = nodesById.get(input.relation.sourceNodeId)
  const evidenceNode = findDebugEvidenceNode(input.relation, nodesById)
  const debugNode = sourceNode ?? evidenceNode

  return {
    sourceNodeOriginKind: debugNode?.originKind ?? null,
    sourceNodeRole: debugNode?.role ?? null,
    parentNodeId: debugNode?.parentNodeId ?? null,
    anchorFailureReason: classifyAnchorFailure({
      relation: input.relation,
      sourceNode,
      graphEdges: input.input.graphEdges,
      isReachable: (nodeId) => isNodeReachable(nodeId, input),
    }),
  }
}

function findDebugEvidenceNode(
  relation: ServiceMapInputIndex['codeRelations'][number],
  nodesById: ReadonlyMap<string, ServiceMapInputIndex['graphNodes'][number]>,
): ServiceMapInputIndex['graphNodes'][number] | undefined {
  for (const nodeId of relation.evidenceNodeIds) {
    const node = nodesById.get(nodeId)
    if (node?.originKind === 'callback') return node
  }
  for (const nodeId of relation.evidenceNodeIds) {
    const node = nodesById.get(nodeId)
    if (node) return node
  }
  return undefined
}

function classifyAnchorFailure(input: {
  relation: ServiceMapInputIndex['codeRelations'][number]
  sourceNode?: ServiceMapInputIndex['graphNodes'][number]
  graphEdges: ServiceMapInputIndex['graphEdges']
  isReachable: (nodeId: string) => boolean
}): string {
  if (!input.sourceNode) return 'source_node_not_found'

  const parentNodeId = input.sourceNode.parentNodeId
  if (parentNodeId) {
    if (!input.isReachable(parentNodeId)) return 'parent_node_not_reachable'
    const hasContainsEdge = input.graphEdges.some((edge) =>
      edge.relation === 'contains' &&
      edge.sourceId === parentNodeId &&
      edge.targetId === input.sourceNode?.id)
    if (input.sourceNode.originKind === 'callback' && !hasContainsEdge) {
      return 'callback_not_connected_to_parent'
    }
  }

  if (input.relation.unresolvedReason === 'call_target_unresolved') {
    return 'call_target_unresolved'
  }

  return 'source_node_not_reachable'
}

function isNodeReachable(
  nodeId: string,
  input: {
    nodeToEntryPoints: ReadonlyMap<string, readonly string[]>
    reachableNodeToEntryPoints: ReadonlyMap<string, readonly string[]>
    fileHandlerNodeToEntryPoints: ReadonlyMap<string, readonly string[]>
  },
): boolean {
  return Boolean(
    input.nodeToEntryPoints.get(nodeId)?.length ||
    input.reachableNodeToEntryPoints.get(nodeId)?.length ||
    input.fileHandlerNodeToEntryPoints.get(nodeId)?.length,
  )
}

function buildFileHandlerNodeToEntryPoints(input: ServiceMapInputIndex): Map<string, string[]> {
  const nodesById = new Map(input.graphNodes.map((node) => [node.id, node]))
  const fileEntryPointIdsByFile = new Map<string, string[]>()

  for (const entryPoint of input.entryPoints) {
    const handler = nodesById.get(entryPoint.handlerNodeId)
    if (!handler || handler.type !== 'file') continue
    const ids = fileEntryPointIdsByFile.get(handler.filePath) ?? []
    ids.push(entryPoint.id)
    fileEntryPointIdsByFile.set(handler.filePath, ids)
  }

  const result = new Map<string, string[]>()
  for (const node of input.graphNodes) {
    if (node.type === 'file') continue
    const entryPointIds = fileEntryPointIdsByFile.get(node.filePath)
    if (entryPointIds && entryPointIds.length > 0) {
      result.set(node.id, entryPointIds)
    }
  }
  return result
}

function buildReachableNodeToEntryPoints(input: ServiceMapInputIndex): Map<string, string[]> {
  if (input.graphEdges.length === 0 || input.graphNodes.length === 0 || input.entryPoints.length === 0) {
    return new Map()
  }

  const nodesById = new Map(input.graphNodes.map((node) => [node.id, node]))
  const outgoingBySource = new Map<string, typeof input.graphEdges>()
  for (const edge of input.graphEdges) {
    const edges = outgoingBySource.get(edge.sourceId) ?? []
    edges.push(edge)
    outgoingBySource.set(edge.sourceId, edges)
  }
  const bundleNodeIdsByEntryPoint = new Map<string, Set<string>>()
  for (const bundle of input.codeBundles) {
    const ids = bundleNodeIdsByEntryPoint.get(bundle.entryPointId) ?? new Set<string>()
    ids.add(bundle.nodeId)
    bundleNodeIdsByEntryPoint.set(bundle.entryPointId, ids)
  }

  const result = new Map<string, string[]>()
  for (const entryPoint of input.entryPoints) {
    const reachableIds = reachableNodeIdsFromEntryPoint({
      handlerNodeId: entryPoint.handlerNodeId,
      seedNodeIds: bundleNodeIdsByEntryPoint.get(entryPoint.id),
      nodesById,
      outgoingBySource,
    })
    for (const nodeId of reachableIds) {
      const entryPointIds = result.get(nodeId) ?? []
      if (!entryPointIds.includes(entryPoint.id)) entryPointIds.push(entryPoint.id)
      result.set(nodeId, entryPointIds)
    }
  }

  return result
}

function reachableNodeIdsFromEntryPoint(input: {
  handlerNodeId: string
  seedNodeIds?: ReadonlySet<string>
  nodesById: ReadonlyMap<string, ServiceMapInputIndex['graphNodes'][number]>
  outgoingBySource: ReadonlyMap<string, ServiceMapInputIndex['graphEdges']>
}): Set<string> {
  if (!input.nodesById.has(input.handlerNodeId)) return new Set()

  const visited = new Set<string>()
  const seedIds = input.outgoingBySource.size > 0
    ? new Set([input.handlerNodeId])
    : new Set([input.handlerNodeId, ...(input.seedNodeIds ?? [])])
  const importedFileIdsByFile = buildImportedFileIdsByFile(input.outgoingBySource)
  const containingFileByNode = buildContainingFileByNode(input.outgoingBySource, input.nodesById)
  const nodesByFileAndName = buildNodesByFileAndName(input.nodesById)
  const availableFilePaths = new Set([...input.nodesById.values()].map((node) => node.filePath))
  const queue: Array<{ nodeId: string; depth: number }> = [...seedIds].map((nodeId) => ({ nodeId, depth: 0 }))

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!
    if (visited.has(nodeId)) continue
    if (!input.nodesById.has(nodeId)) continue
    visited.add(nodeId)
    if (depth >= MAX_FACT_ANCHOR_HOPS) continue

    const outgoing = input.outgoingBySource.get(nodeId) ?? []
    for (const edge of outgoing) {
      const targetIds = resolveReachabilityTargets({
        edge,
        currentNodeId: nodeId,
        nodesById: input.nodesById,
        importedFileIdsByFile,
        containingFileByNode,
        nodesByFileAndName,
        availableFilePaths,
        seedIds,
      })
      for (const targetId of targetIds) {
        if (visited.has(targetId)) continue
        queue.push({ nodeId: targetId, depth: depth + 1 })
      }
    }
  }

  return visited
}

function resolveReachabilityTargets(input: {
  edge: ServiceMapInputIndex['graphEdges'][number]
  currentNodeId: string
  nodesById: ReadonlyMap<string, ServiceMapInputIndex['graphNodes'][number]>
  importedFileIdsByFile: ReadonlyMap<string, ReadonlySet<string>>
  containingFileByNode: ReadonlyMap<string, string>
  nodesByFileAndName: ReadonlyMap<string, ReadonlyMap<string, string[]>>
  availableFilePaths: ReadonlySet<string>
  seedIds: ReadonlySet<string>
}): string[] {
  if (
    input.edge.targetId &&
    shouldTraverseReachabilityEdge(input.edge, input.nodesById, TRACEABLE_FACT_ANCHOR_RELATIONS, { seedIds: input.seedIds })
  ) {
    return [input.edge.targetId]
  }

  if (input.edge.relation !== 'calls' || !input.edge.targetSymbol) return []

  const currentNode = input.nodesById.get(input.currentNodeId)
  if (!currentNode) return []
  const candidateFilePaths = new Set<string>([currentNode.filePath])
  const specifierFilePath = resolveSpecifierFilePath(currentNode.filePath, input.edge.targetSpecifier, input.availableFilePaths)
  if (specifierFilePath) candidateFilePaths.add(specifierFilePath)
  const containingFileId = input.containingFileByNode.get(input.currentNodeId)
  if (containingFileId) {
    for (const importedFileId of input.importedFileIdsByFile.get(containingFileId) ?? []) {
      const importedFile = input.nodesById.get(importedFileId)
      if (importedFile) candidateFilePaths.add(importedFile.filePath)
    }
  }

  const resolved = new Set<string>()
  for (const filePath of candidateFilePaths) {
    const ids = input.nodesByFileAndName.get(filePath)?.get(input.edge.targetSymbol) ?? []
    ids.forEach((id) => resolved.add(id))
    const receiver = receiverFromChainPath(input.edge.chainPath)
    if (receiver && receiver !== input.edge.targetSymbol) {
      const receiverIds = input.nodesByFileAndName.get(filePath)?.get(receiver) ?? []
      receiverIds.forEach((id) => resolved.add(id))
    }
  }
  return [...resolved]
}

function receiverFromChainPath(chainPath: string | null | undefined): string | null {
  if (!chainPath) return null
  const receiver = chainPath.replace(/^this\./, '').split('.')[0]?.trim()
  return receiver || null
}

function resolveSpecifierFilePath(
  sourceFilePath: string,
  targetSpecifier: string | null,
  availableFilePaths: ReadonlySet<string>,
): string | null {
  if (!targetSpecifier?.startsWith('.')) return null
  const sourceDir = pathPosix.dirname(sourceFilePath)
  const base = pathPosix.normalize(pathPosix.join(sourceDir, targetSpecifier))
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    pathPosix.join(base, 'index.ts'),
    pathPosix.join(base, 'index.tsx'),
    pathPosix.join(base, 'index.js'),
    pathPosix.join(base, 'index.jsx'),
  ]
  return candidates.find((candidate) => availableFilePaths.has(candidate)) ?? null
}

function buildImportedFileIdsByFile(
  outgoingBySource: ReadonlyMap<string, ServiceMapInputIndex['graphEdges']>,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const [sourceId, edges] of outgoingBySource) {
    for (const edge of edges) {
      if (edge.relation !== 'imports' || !edge.targetId) continue
      const ids = result.get(sourceId) ?? new Set<string>()
      ids.add(edge.targetId)
      result.set(sourceId, ids)
    }
  }
  return result
}

function buildContainingFileByNode(
  outgoingBySource: ReadonlyMap<string, ServiceMapInputIndex['graphEdges']>,
  nodesById: ReadonlyMap<string, ServiceMapInputIndex['graphNodes'][number]>,
): Map<string, string> {
  const result = new Map<string, string>()
  for (const [sourceId, edges] of outgoingBySource) {
    const source = nodesById.get(sourceId)
    if (source?.type !== 'file') continue
    for (const edge of edges) {
      if (edge.relation === 'contains' && edge.targetId) result.set(edge.targetId, sourceId)
    }
  }
  return result
}

function buildNodesByFileAndName(
  nodesById: ReadonlyMap<string, ServiceMapInputIndex['graphNodes'][number]>,
): Map<string, Map<string, string[]>> {
  const result = new Map<string, Map<string, string[]>>()
  for (const node of nodesById.values()) {
    const names = result.get(node.filePath) ?? new Map<string, string[]>()
    const ids = names.get(node.name) ?? []
    ids.push(node.id)
    names.set(node.name, ids)
    result.set(node.filePath, names)
  }
  return result
}
