import { eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { serviceMapEdges, type ServiceMapEdge } from '@/db/schema/build_service_map.js'
import type { CodeRelationKind } from '@/db/schema/build_relations.js'
import type { RelatedServiceMapEdgeContext, RelationFactContext } from '../runtime/types.js'

const includedSources = new Set(['deterministic', 'suffix_match', 'merged'])
const includedConfidence = new Set(['high', 'medium'])

export function buildServiceMapContext(input: {
  db: DB
  projectId: string
  repoId: string
  documentType: string
  entryPointIds: string[]
  namespace: string
  evidenceOffset: number
}): { serviceMapFacts: RelationFactContext[]; relatedEdges: RelatedServiceMapEdgeContext[] } {
  if (input.entryPointIds.length === 0) return { serviceMapFacts: [], relatedEdges: [] }
  const entryPointIds = new Set(input.entryPointIds)
  const sourceType = serviceMapSourceTypeForDocument(input.documentType)
  const rows = input.db.select()
    .from(serviceMapEdges)
    .where(eq(serviceMapEdges.projectId, input.projectId))
    .all()
    .sort((a, b) => a.id.localeCompare(b.id))

  const outgoing = rows.filter((edge) =>
    edge.sourceType === sourceType
      && entryPointIds.has(edge.sourceId)
      && (edge.sourceRepoId === null || edge.sourceRepoId === input.repoId),
  )
  const incoming = rows.filter((edge) =>
    edge.targetType === sourceType
      && entryPointIds.has(edge.targetId)
      && (edge.targetRepoId === null || edge.targetRepoId === input.repoId),
  )

  const serviceMapFacts = outgoing
    .filter(includeDocumentRelationEdge)
    .flatMap((edge, index) => {
      const fact = serviceMapEdgeToRelationFact(edge, `${input.namespace}:service_map:${input.evidenceOffset + index + 1}`)
      return fact ? [fact] : []
    })
  const relatedEdges = [
    ...outgoing.map((edge, index) => serviceMapEdgeToRelatedContext(edge, 'outgoing', `${input.namespace}:related_edge:${index + 1}`)),
    ...incoming.map((edge, index) => serviceMapEdgeToRelatedContext(edge, 'incoming', `${input.namespace}:related_edge:${outgoing.length + index + 1}`)),
  ]

  return { serviceMapFacts, relatedEdges }
}

function includeDocumentRelationEdge(edge: ServiceMapEdge): boolean {
  return includedConfidence.has(edge.confidence)
    && includedSources.has(edge.source)
    && relationKindForServiceMapEdge(edge.kind) !== null
}

function serviceMapEdgeToRelationFact(edge: ServiceMapEdge, evidenceId: string): RelationFactContext | null {
  const kind = relationKindForServiceMapEdge(edge.kind)
  if (!kind) return null
  const target = serviceMapRelationTarget(edge)
  return {
    evidence_id: evidenceId,
    relation_id: edge.id,
    repo_id: edge.repoId,
    source_node_id: edge.sourceId,
    kind,
    target,
    canonical_target: edge.canonicalTarget,
    operation: serviceMapRelationOperation(edge),
    confidence: edge.confidence,
    source: 'service_map',
    evidence_node_ids: edge.evidence.relation_ids ?? [],
    payload: compactUndefined({
      ...edge.evidence,
      service_map_edge_id: edge.id,
      service_map_kind: edge.kind,
      service_map_source: edge.source,
      source_type: edge.sourceType,
      source_id: edge.sourceId,
      source_label: edge.sourceLabel,
      target_type: edge.targetType,
      target_id: edge.targetId,
      target_label: edge.targetLabel,
      target_repo_id: edge.targetRepoId,
      table: edge.targetType === 'db' ? stripKnownPrefix(edge.targetId, 'db:') : undefined,
      path: edge.targetType === 'api' || edge.targetType === 'screen' ? target : undefined,
      system: edge.targetType === 'external_service' ? target : undefined,
      url: edge.targetType === 'external_link' ? target : undefined,
      event: edge.targetType === 'event' ? target : undefined,
    }),
    unresolved_reason: edge.unresolvedReason,
  }
}

function serviceMapEdgeToRelatedContext(edge: ServiceMapEdge, direction: 'incoming' | 'outgoing', evidenceId: string): RelatedServiceMapEdgeContext {
  return {
    evidence_id: evidenceId,
    id: edge.id,
    direction,
    kind: edge.kind,
    confidence: edge.confidence,
    source: edge.source,
    source_type: edge.sourceType,
    source_id: edge.sourceId,
    source_label: edge.sourceLabel,
    target_type: edge.targetType,
    target_id: edge.targetId,
    target_label: edge.targetLabel,
    canonical_target: edge.canonicalTarget,
  }
}

function serviceMapSourceTypeForDocument(documentType: string) {
  if (documentType === 'screen_spec') return 'screen'
  if (documentType === 'event_spec') return 'event'
  if (documentType === 'schedule_spec') return 'job'
  return 'api'
}

function relationKindForServiceMapEdge(kind: ServiceMapEdge['kind']): CodeRelationKind | null {
  if (kind === 'accesses_db') return 'db_access'
  if (kind === 'calls_api') return 'api_call'
  if (kind === 'navigates') return 'navigation'
  if (kind === 'publishes_event') return 'event_publish'
  if (kind === 'uses_external_service') return 'external_service'
  if (kind === 'opens_external_link') return 'external_link'
  return null
}

function serviceMapRelationTarget(edge: ServiceMapEdge): string {
  if (edge.targetType === 'db') return stripKnownPrefix(edge.targetId, 'db:')
  if (edge.targetType === 'api') return pathFromCanonicalApi(edge.canonicalTarget) ?? edge.targetLabel ?? edge.canonicalTarget
  if (edge.targetType === 'screen') return stripKnownPrefix(edge.canonicalTarget, 'screen:')
  if (edge.targetType === 'external_service') return stripKnownPrefix(edge.targetId, 'external_service:')
  if (edge.targetType === 'external_link') return stripKnownPrefix(edge.targetId, 'external:')
  if (edge.targetType === 'event') return edge.targetLabel ?? edge.canonicalTarget
  return edge.targetLabel ?? edge.canonicalTarget
}

function serviceMapRelationOperation(edge: ServiceMapEdge): string | null {
  if (edge.targetType === 'api') return methodFromCanonicalApi(edge.canonicalTarget)
  if (edge.targetType === 'db') {
    return /^db:[^:]+:(select|insert|update|delete|unknown)$/.exec(edge.canonicalTarget)?.[1] ?? null
  }
  if (edge.targetType === 'external_service') {
    const operation = /^external_service:[^:]+:(.+)$/.exec(edge.canonicalTarget)?.[1]
    return operation ?? null
  }
  return null
}

function methodFromCanonicalApi(value: string): string | null {
  return /^([A-Z]+)\s+/.exec(value)?.[1] ?? null
}

function pathFromCanonicalApi(value: string): string | null {
  return /^[A-Z]+\s+(.+)$/.exec(value)?.[1] ?? null
}

function stripKnownPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

function compactUndefined(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== null))
}
