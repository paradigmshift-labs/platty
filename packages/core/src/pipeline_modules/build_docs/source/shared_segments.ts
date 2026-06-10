import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import type { TechnicalDocumentType } from '@/db/schema/build_docs.js'
import { codeBundles, entryPoints } from '@/db/schema/build_route.js'
import { codeEdges, codeNodes } from '@/db/schema/code_graph.js'
import { repositories } from '@/db/schema/core.js'
import {
  sharedCodeSegmentEntryPoints,
  sharedCodeSegmentNodes,
  sharedCodeSegments,
} from '@/db/schema/shared_code_segments.js'
import { listDeprecatedEntryPointIds } from '../../build_route/review_decisions.js'
import type { SharedCodeSegmentContext, SourceContext } from '../runtime/types.js'

export const SHARED_CODE_SEGMENTS_DETECTOR_VERSION = 'shared_code_segments_v2'
export const SHARED_CODE_SUMMARY_SCHEMA_VERSION = 'shared_code_summary_v1'

export interface SharedSegmentEntryPointInput {
  id: string
  targetKey: string
  documentType: TechnicalDocumentType
}

export interface SharedSegmentBundleInput {
  entryPointId: string
  nodeId: string
  depth: number
}

export interface SharedSegmentNodeInput {
  id: string
  name: string | null
  filePath: string
  type: string
  lineStart: number | null
  lineEnd: number | null
  signature: string | null
  parentNodeId?: string | null
}

export interface DetectedSharedCodeSegment {
  id: string
  rootNodeId: string
  rootSymbol: string
  rootFilePath: string
  detectorVersion: typeof SHARED_CODE_SEGMENTS_DETECTOR_VERSION
  summarySchemaVersion: typeof SHARED_CODE_SUMMARY_SCHEMA_VERSION
  segmentHash: string
  sourceHash: string
  usedByEntryPointCount: number
  usedByEntryPoints: Array<{
    entryPointId: string
    targetKey: string
    documentType: TechnicalDocumentType
    depth: number
  }>
  coveredNodeIds: string[]
  deterministicSummary: SharedCodeSegmentContext['summary']
}

export interface SharedOwnershipIndex {
  targetRetainedNodeIds: Set<string>
}

export function detectSharedCodeSegments(input: {
  entryPoints: SharedSegmentEntryPointInput[]
  bundles: SharedSegmentBundleInput[]
  nodes: SharedSegmentNodeInput[]
  minUsageThreshold?: number
  maxSegments?: number
  maxCoveredNodesPerSegment?: number
}): DetectedSharedCodeSegment[] {
  const minUsage = input.minUsageThreshold ?? 3
  const maxSegments = input.maxSegments ?? 200
  const maxCoveredNodes = input.maxCoveredNodesPerSegment ?? 80
  const entryPointById = new Map(input.entryPoints.map((entry) => [entry.id, entry]))
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const usageByNode = new Map<string, SharedSegmentBundleInput[]>()

  for (const bundle of input.bundles) {
    if (bundle.depth <= 0) continue
    if (!entryPointById.has(bundle.entryPointId)) continue
    const usage = usageByNode.get(bundle.nodeId) ?? []
    usage.push(bundle)
    usageByNode.set(bundle.nodeId, usage)
  }

  const candidates = [...usageByNode.entries()]
    .map(([nodeId, usage]) => ({
      nodeId,
      usage,
      entryPointIds: uniqueSorted(usage.map((item) => item.entryPointId)),
    }))
    .filter((candidate) => candidate.entryPointIds.length >= minUsage)
    .filter((candidate) => {
      const node = nodeById.get(candidate.nodeId)
      return !!node && !isLowValueSharedRoot(node)
    })
    .sort((a, b) => {
      const byUsage = b.entryPointIds.length - a.entryPointIds.length
      if (byUsage !== 0) return byUsage
      const aDepth = minDepthFor(a.usage)
      const bDepth = minDepthFor(b.usage)
      return aDepth - bDepth || a.nodeId.localeCompare(b.nodeId)
    })

  const globallyCovered = new Set<string>()
  const segments: DetectedSharedCodeSegment[] = []

  for (const candidate of candidates) {
    if (globallyCovered.has(candidate.nodeId)) continue
    const root = nodeById.get(candidate.nodeId)
    if (!root) continue
    const usedByEntryPoints = candidate.entryPointIds.map((entryPointId) => {
      const entryPoint = entryPointById.get(entryPointId)!
      return {
        entryPointId,
        targetKey: entryPoint.targetKey,
        documentType: entryPoint.documentType,
        depth: minDepthFor(candidate.usage.filter((usage) => usage.entryPointId === entryPointId)),
      }
    })
    const coveredNodeIds = collectCoveredNodes(root, candidate.entryPointIds, usageByNode, nodeById, maxCoveredNodes)
    for (const nodeId of coveredNodeIds) globallyCovered.add(nodeId)
    const deterministicSummary = buildDeterministicSummary(root, coveredNodeIds, nodeById)
    const hashInput = {
      rootNodeId: candidate.nodeId,
      usedByEntryPoints: usedByEntryPoints.map((item) => item.entryPointId),
      coveredNodeIds,
      detectorVersion: SHARED_CODE_SEGMENTS_DETECTOR_VERSION,
    }
    segments.push({
      id: `shared:${hashStable(hashInput).slice(0, 24)}`,
      rootNodeId: candidate.nodeId,
      rootSymbol: displaySymbol(root),
      rootFilePath: root.filePath,
      detectorVersion: SHARED_CODE_SEGMENTS_DETECTOR_VERSION,
      summarySchemaVersion: SHARED_CODE_SUMMARY_SCHEMA_VERSION,
      segmentHash: hashStable(hashInput),
      sourceHash: hashStable({ root, coveredNodeIds }),
      usedByEntryPointCount: usedByEntryPoints.length,
      usedByEntryPoints,
      coveredNodeIds,
      deterministicSummary,
    })
    if (segments.length >= maxSegments) break
  }

  return segments
}

export function compactSourceContextWithSharedSegments(input: {
  sourceContext: SourceContext[]
  sharedSegments: SharedCodeSegmentContext[]
  protectedNodeIds?: Set<string>
  sharedOwnershipIndex?: SharedOwnershipIndex
}): {
  sourceContext: SourceContext[]
  metadata: {
    original_source_context_count: number
    compacted_source_context_count: number
    omitted_node_count: number
    segment_ids: string[]
  }
} {
  const protectedNodeIds = input.protectedNodeIds ?? new Set<string>()
  const coveredToSegment = new Map<string, string>()
  for (const segment of input.sharedSegments) {
    for (const nodeId of segment.covered_node_ids ?? []) coveredToSegment.set(nodeId, segment.segment_id)
  }

  const sourceContext = input.sourceContext.filter((source) => {
    if (!coveredToSegment.has(source.node_id)) return true
    if (source.hop === 0 || source.dep_type === 'entrypoint') return true
    if (protectedNodeIds.has(source.node_id)) return true
    if (input.sharedOwnershipIndex) return input.sharedOwnershipIndex.targetRetainedNodeIds.has(source.node_id)
    return isProtectedSourceContext(source)
  })

  return {
    sourceContext,
    metadata: {
      original_source_context_count: input.sourceContext.length,
      compacted_source_context_count: sourceContext.length,
      omitted_node_count: input.sourceContext.length - sourceContext.length,
      segment_ids: uniqueSorted([...coveredToSegment.values()]),
    },
  }
}

export function buildSharedOwnershipIndex(input: {
  db: DB
  repoId: string
  seedNodeIds: string[]
  sharedSegments: SharedCodeSegmentContext[]
  protectedNodeIds?: Set<string>
}): SharedOwnershipIndex {
  const coveredNodeIds = new Set<string>()
  const rootNodeIds = new Set<string>()
  for (const segment of input.sharedSegments) {
    rootNodeIds.add(segment.root_node_id)
    for (const nodeId of segment.covered_node_ids ?? []) coveredNodeIds.add(nodeId)
  }
  if (coveredNodeIds.size === 0 || input.seedNodeIds.length === 0) {
    return { targetRetainedNodeIds: new Set(input.protectedNodeIds ?? []) }
  }

  const adjacency = new Map<string, string[]>()
  const edges = input.db.select({
    sourceId: codeEdges.sourceId,
    targetId: codeEdges.targetId,
  }).from(codeEdges).where(eq(codeEdges.repoId, input.repoId)).all()
  for (const edge of edges) {
    if (!edge.targetId) continue
    const targets = adjacency.get(edge.sourceId) ?? []
    targets.push(edge.targetId)
    adjacency.set(edge.sourceId, targets)
  }

  const reachable = new Set(input.seedNodeIds)
  const queue = [...input.seedNodeIds]
  const targetRetainedNodeIds = new Set(input.protectedNodeIds ?? [])
  while (queue.length > 0) {
    const sourceId = queue.shift()!
    for (const targetId of adjacency.get(sourceId) ?? []) {
      if (coveredNodeIds.has(targetId)) {
        if (!rootNodeIds.has(targetId)) targetRetainedNodeIds.add(targetId)
        continue
      }
      if (reachable.has(targetId)) continue
      reachable.add(targetId)
      queue.push(targetId)
    }
  }

  return { targetRetainedNodeIds }
}

export async function rebuildSharedCodeSegmentsForProject(input: {
  db: DB
  projectId: string
  repoIds?: string[]
  minUsageThreshold?: number
}): Promise<{
  project_id: string
  rebuilt_repo_count: number
  segment_count: number
  detector_version: typeof SHARED_CODE_SEGMENTS_DETECTOR_VERSION
}> {
  const repoRows = input.repoIds
    ? input.db.select().from(repositories).where(inArray(repositories.id, input.repoIds)).all()
    : input.db.select()
      .from(repositories)
      .where(and(eq(repositories.projectId, input.projectId), isNull(repositories.deletedAt)))
      .all()
  let segmentCount = 0

  for (const repo of repoRows) {
    const deprecatedEntryPointIds = listDeprecatedEntryPointIds(input.db, {
      projectId: input.projectId,
      repoId: repo.id,
    })
    const entries = input.db.select().from(entryPoints).where(eq(entryPoints.repoId, repo.id)).all()
      .filter((entry) => !deprecatedEntryPointIds.has(entry.id))
    // 버전 필터 없이 삭제 — 구버전 detector 행이 잔류하면 loadSharedCodeSegmentsForEntryPoints가
    // 버전 구분 없이 읽어 중복 로드되기 때문.
    input.db.delete(sharedCodeSegments)
      .where(and(
        eq(sharedCodeSegments.projectId, input.projectId),
        eq(sharedCodeSegments.repoId, repo.id),
      ))
      .run()
    if (entries.length === 0) continue

    const entryIds = entries.map((entry) => entry.id)
    const bundles = input.db.select().from(codeBundles).where(inArray(codeBundles.entryPointId, entryIds)).all()
    const nodeIds = uniqueSorted(bundles.map((bundle) => bundle.nodeId))
    const nodes = nodeIds.length === 0
      ? []
      : input.db.select().from(codeNodes).where(inArray(codeNodes.id, nodeIds)).all()

    const detected = detectSharedCodeSegments({
      minUsageThreshold: input.minUsageThreshold,
      entryPoints: entries.map((entry) => ({
        id: entry.id,
        targetKey: entry.fullPath ?? entry.path ?? entry.id,
        documentType: documentTypeForEntryPointKind(entry.kind),
      })),
      bundles: bundles.map((bundle) => ({
        entryPointId: bundle.entryPointId,
        nodeId: bundle.nodeId,
        depth: bundle.depth,
      })),
      nodes: nodes.map((node) => ({
        id: node.id,
        name: node.name,
        filePath: node.filePath,
        type: node.type,
        lineStart: node.lineStart,
        lineEnd: node.lineEnd,
        signature: node.signature,
        parentNodeId: node.parentNodeId,
      })),
    })

    for (const segment of detected) {
      input.db.insert(sharedCodeSegments).values({
        id: segment.id,
        projectId: input.projectId,
        repoId: repo.id,
        rootNodeId: segment.rootNodeId,
        rootSymbol: segment.rootSymbol,
        rootFilePath: segment.rootFilePath,
        detectorVersion: segment.detectorVersion,
        summarySchemaVersion: segment.summarySchemaVersion,
        segmentHash: segment.segmentHash,
        sourceHash: segment.sourceHash,
        usedByEntryPointCount: segment.usedByEntryPointCount,
        coveredNodeIdsJson: segment.coveredNodeIds,
        deterministicSummaryJson: segment.deterministicSummary,
        llmSummaryJson: null,
        summaryStatus: 'deterministic',
        validity: 'fresh',
        updatedAt: new Date().toISOString(),
      }).run()
      input.db.insert(sharedCodeSegmentEntryPoints).values(segment.usedByEntryPoints.map((entry) => ({
        segmentId: segment.id,
        entryPointId: entry.entryPointId,
        targetKey: entry.targetKey,
        documentType: entry.documentType,
        rootDepth: entry.depth,
      }))).run()
      // subtree covered는 캡이 없어 행 수가 커질 수 있다 — SQLite bind 한도 보호 (f6_persist_results 관례).
      for (const chunk of chunked(segment.coveredNodeIds.map((nodeId, index) => ({
        segmentId: segment.id,
        nodeId,
        role: nodeId === segment.rootNodeId ? 'root' as const : 'covered' as const,
        depthFromRoot: index,
      })), 200)) {
        input.db.insert(sharedCodeSegmentNodes).values(chunk).run()
      }
    }

    segmentCount += detected.length
  }

  return {
    project_id: input.projectId,
    rebuilt_repo_count: repoRows.length,
    segment_count: segmentCount,
    detector_version: SHARED_CODE_SEGMENTS_DETECTOR_VERSION,
  }
}

export function loadSharedCodeSegmentsForEntryPoints(input: {
  db: DB
  projectId: string
  entryPointIds: string[]
}): SharedCodeSegmentContext[] {
  if (input.entryPointIds.length === 0) return []
  const links = input.db.select()
    .from(sharedCodeSegmentEntryPoints)
    .where(inArray(sharedCodeSegmentEntryPoints.entryPointId, input.entryPointIds))
    .all()
  const segmentIds = uniqueSorted(links.map((link) => link.segmentId))
  if (segmentIds.length === 0) return []
  const segments = input.db.select()
    .from(sharedCodeSegments)
    .where(and(
      eq(sharedCodeSegments.projectId, input.projectId),
      eq(sharedCodeSegments.validity, 'fresh'),
      inArray(sharedCodeSegments.id, segmentIds),
    ))
    .all()
  const linksBySegmentId = groupBy(links, (link) => link.segmentId)
  return segments.map((segment) => ({
    segment_id: segment.id,
    root_node_id: segment.rootNodeId,
    root_symbol: segment.rootSymbol,
    root_file_path: segment.rootFilePath,
    detector_version: segment.detectorVersion,
    summary_schema_version: segment.summarySchemaVersion,
    used_by_entrypoint_count: segment.usedByEntryPointCount,
    used_by_entrypoints: (linksBySegmentId.get(segment.id) ?? []).map((link) => ({
      entry_point_id: link.entryPointId,
      document_type: link.documentType,
      target_key: link.targetKey,
      depth: link.rootDepth,
    })),
    covered_node_ids: segment.coveredNodeIdsJson,
    summary: (segment.llmSummaryJson ?? segment.deterministicSummaryJson) as SharedCodeSegmentContext['summary'],
  }))
}

function collectCoveredNodes(
  root: SharedSegmentNodeInput,
  entryPointIds: string[],
  usageByNode: Map<string, SharedSegmentBundleInput[]>,
  nodeById: Map<string, SharedSegmentNodeInput>,
  maxCoveredNodes: number,
): string[] {
  const entryPointSet = new Set(entryPointIds)
  const intersection = [...usageByNode.entries()]
    .filter(([, usage]) => {
      const usedBy = new Set(usage.map((item) => item.entryPointId))
      return entryPointIds.every((entryPointId) => usedBy.has(entryPointId))
    })
    .map(([nodeId, usage]) => ({
      nodeId,
      minDepth: minDepthFor(usage.filter((item) => entryPointSet.has(item.entryPointId))),
    }))

  // 루트의 구조적 자식(subtree)은 캡 없이 covered에 포함한다 — 요약이 대신한다는 근거가
  // 구조적으로 확실하고, 번들 자체 캡(maxNodes)이 자연 상한이다. cross-file 동행자는
  // 동시출현 추정이라 기존 캡을 유지한다.
  const subtree: typeof intersection = []
  const general: typeof intersection = []
  for (const item of intersection) {
    const node = nodeById.get(item.nodeId)
    if (node && isDescendantOf(node, root, nodeById)) subtree.push(item)
    else general.push(item)
  }
  general.sort((a, b) => a.minDepth - b.minDepth || a.nodeId.localeCompare(b.nodeId))

  return [...subtree, ...general.slice(0, maxCoveredNodes)]
    .sort((a, b) => a.minDepth - b.minDepth || a.nodeId.localeCompare(b.nodeId))
    .map((item) => item.nodeId)
}

function isDescendantOf(
  node: SharedSegmentNodeInput,
  root: SharedSegmentNodeInput,
  nodeById: Map<string, SharedSegmentNodeInput>,
): boolean {
  if (node.id === root.id) return true
  let current = node
  for (let i = 0; i < 100; i++) {
    const parentId = current.parentNodeId
    if (!parentId) break
    if (parentId === root.id) return true
    const parent = nodeById.get(parentId)
    if (!parent) break
    current = parent
  }
  return node.filePath === root.filePath
    && root.lineStart != null && root.lineEnd != null
    && node.lineStart != null && node.lineEnd != null
    && root.lineStart <= node.lineStart && node.lineEnd <= root.lineEnd
}

function buildDeterministicSummary(
  root: SharedSegmentNodeInput,
  coveredNodeIds: string[],
  nodeById: Map<string, SharedSegmentNodeInput>,
): SharedCodeSegmentContext['summary'] {
  const sourceRefs = coveredNodeIds
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is SharedSegmentNodeInput => !!node)
    .slice(0, 12)
    .map((node) => ({
      node_id: node.id,
      symbol: displaySymbol(node),
      file_path: node.filePath,
      line_start: node.lineStart,
      line_end: node.lineEnd,
    }))
  const title = displaySymbol(root)
  return {
    title,
    natural_language_summary: `${title} is shared code used by multiple document targets. Treat it as reusable context and inspect target-specific source for route-specific behavior.`,
    public_contract: [root.signature ?? `${title} in ${root.filePath}`],
    business_relevance: [`Shared static-analysis segment rooted at ${title}.`],
    source_refs: sourceRefs,
  }
}

function isLowValueSharedRoot(node: SharedSegmentNodeInput): boolean {
  const symbol = displaySymbol(node).toLowerCase()
  const filePath = node.filePath.toLowerCase()
  if (symbol === 'index' || symbol === 'default') return true
  return filePath.endsWith('.css') || filePath.endsWith('.scss') || filePath.endsWith('.sass')
}

function isProtectedSourceContext(source: SourceContext): boolean {
  const haystack = `${source.node_type} ${source.symbol} ${source.file_path}`.toLowerCase()
  return [
    'dto',
    'schema',
    'model',
    'entity',
    'repository',
    'query',
    'mutation',
    'validation',
    'auth',
    'permission',
    'policy',
    'handler',
    'controller',
    'resolver',
    'job',
    'event',
    'producer',
    'consumer',
  ].some((keyword) => haystack.includes(keyword))
}

function displaySymbol(node: SharedSegmentNodeInput): string {
  return node.name || node.id
}

function minDepthFor(usage: SharedSegmentBundleInput[]): number {
  return Math.min(...usage.map((item) => item.depth))
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function hashStable(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortStable(value))).digest('hex')
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortStable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortStable(item)]),
  )
}

function documentTypeForEntryPointKind(kind: string): TechnicalDocumentType {
  if (kind === 'api') return 'api_spec'
  if (kind === 'event') return 'event_spec'
  if (kind === 'job') return 'schedule_spec'
  return 'screen_spec'
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFor(item)
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  return groups
}
