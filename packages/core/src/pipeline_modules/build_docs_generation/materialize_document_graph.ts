import { and, eq, inArray } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import {
  docDeps,
  documentLinkEvidence,
  documentLinks,
  documents,
  type Document,
  type DocDep,
  type NewDocumentLinkEvidence,
} from '@/db/schema/build_docs.js'
import { serviceMapEdges, type ServiceMapEdge, type ServiceMapEdgeKind, type ServiceMapEdgeSource, type ServiceMapNodeType } from '@/db/schema/build_service_map.js'
import { isDeprecatedDocumentScope, listDeprecatedEntryPointIds } from '@/project_analysis_v2/review_decisions.js'

export const DOCUMENT_GRAPH_MATERIALIZER_CREATED_BY = 'build_docs_materializer_v1'

const generatedLinkTypes = ['calls_api', 'navigates_to', 'publishes_event', 'triggers'] as const
const defaultIncludedSources: ServiceMapEdgeSource[] = ['deterministic', 'suffix_match', 'merged']

export type GeneratedDocumentLinkType = typeof generatedLinkTypes[number]
export type Confidence = 'high' | 'medium' | 'low'

export interface DocumentGraphMaterializerConfig {
  minConfidence: Confidence
  includeSources: ServiceMapEdgeSource[]
  linkTypes: GeneratedDocumentLinkType[]
  dryRun: boolean
}

export interface MaterializeDocumentGraphInput {
  db: DB
  projectId: string
  repoId: string
  runId: string
  config?: Partial<DocumentGraphMaterializerConfig>
}

export interface MaterializedDocumentLinkCandidate {
  fromDocumentId: string
  toDocumentId: string
  linkType: GeneratedDocumentLinkType
  sourceEdgeId: string
  repoId: string
  confidence: Confidence
  source: ServiceMapEdgeSource
  reason: string
  runId: string | null
}

export interface MaterializedDocumentLinkRow {
  fromDocumentId: string
  toDocumentId: string
  linkType: GeneratedDocumentLinkType
}

export interface MaterializeDocumentGraphResult {
  scannedEdges: number
  candidateCount: number
  insertedCount: number
  existingCount: number
  evidenceInsertedCount: number
  deletedGeneratedCount: number
  skippedCount: number
  skippedReasons: Record<string, number>
}

interface DocumentGraphInputs {
  documents: Document[]
  docDeps: DocDep[]
  serviceMapEdges: ServiceMapEdge[]
}

export interface DocumentLookup {
  byScopeId: Map<string, Document[]>
  byCodeNodeId: Map<string, Document[]>
}

type EdgeResolution =
  | { fromDocumentId: string; toDocumentId: string }
  | { reason: string }

export function resolveMaterializerConfig(config: Partial<DocumentGraphMaterializerConfig> = {}): DocumentGraphMaterializerConfig {
  return {
    minConfidence: config.minConfidence ?? readConfidenceEnv('BUILD_DOCS_DOCUMENT_GRAPH_MIN_CONFIDENCE') ?? 'medium',
    includeSources: config.includeSources ?? readSourceListEnv('BUILD_DOCS_DOCUMENT_GRAPH_INCLUDE_SOURCES') ?? defaultIncludedSources,
    linkTypes: config.linkTypes ?? readLinkTypeListEnv('BUILD_DOCS_DOCUMENT_GRAPH_LINK_TYPES') ?? [...generatedLinkTypes],
    dryRun: config.dryRun ?? process.env.BUILD_DOCS_DOCUMENT_GRAPH_DRY_RUN === '1',
  }
}

export function serviceMapKindToDocumentLinkType(kind: ServiceMapEdgeKind): GeneratedDocumentLinkType | null {
  if (kind === 'calls_api') return 'calls_api'
  if (kind === 'navigates') return 'navigates_to'
  if (kind === 'publishes_event') return 'publishes_event'
  if (kind === 'triggers') return 'triggers'
  return null
}

export function buildDocumentLookup(input: {
  documents: Document[]
  docDeps: DocDep[]
  deprecatedEntryPointIds?: ReadonlySet<string>
}): DocumentLookup {
  const byScopeId = new Map<string, Document[]>()
  const byCodeNodeId = new Map<string, Document[]>()
  const deprecatedEntryPointIds = input.deprecatedEntryPointIds ?? new Set<string>()
  const lookupDocuments = input.documents.filter((doc) => !isDeprecatedDocumentScope(doc, deprecatedEntryPointIds))
  const documentById = new Map(lookupDocuments.map((doc) => [doc.id, doc]))

  for (const doc of lookupDocuments) {
    if (doc.status !== 'passed') continue
    if (doc.track !== 'technical') continue
    if (!doc.scopeId) continue
    const bucket = byScopeId.get(doc.scopeId) ?? []
    bucket.push(doc)
    byScopeId.set(doc.scopeId, bucket)
  }

  for (const dep of input.docDeps) {
    const doc = documentById.get(dep.documentId)
    if (!doc || doc.status !== 'passed' || doc.track !== 'technical') continue
    const bucket = byCodeNodeId.get(dep.codeNodeId) ?? []
    bucket.push(doc)
    byCodeNodeId.set(dep.codeNodeId, bucket)
  }

  return { byScopeId, byCodeNodeId }
}

export function resolveEdgeDocuments(edge: ServiceMapEdge, lookup: DocumentLookup): EdgeResolution {
  const fromType = documentTypeForServiceNode(edge.sourceType)
  const toType = documentTypeForServiceNode(edge.targetType)
  if (!fromType || !toType) return { reason: 'unsupported_node_type' }

  const from = resolveDocumentForEndpoint(edge.sourceId, fromType, lookup)
  if (!from) return { reason: 'missing_source_document' }
  const to = resolveDocumentForEndpoint(edge.targetId, toType, lookup)
  if (!to) return { reason: 'missing_target_document' }
  if (from.id === to.id) return { reason: 'self_link' }

  return {
    fromDocumentId: from.id,
    toDocumentId: to.id,
  }
}

export function passesConfidencePolicy(edge: ServiceMapEdge, config: DocumentGraphMaterializerConfig): boolean {
  return confidenceRank(edge.confidence) >= confidenceRank(config.minConfidence)
    && config.includeSources.includes(edge.source)
}

export function buildLinkCandidates(input: {
  edges: ServiceMapEdge[]
  lookup: DocumentLookup
  config: DocumentGraphMaterializerConfig
  runId: string
}): { candidates: MaterializedDocumentLinkCandidate[]; skippedReasons: Record<string, number> } {
  const candidates: MaterializedDocumentLinkCandidate[] = []
  const skippedReasons: Record<string, number> = {}

  for (const edge of input.edges) {
    const linkType = serviceMapKindToDocumentLinkType(edge.kind)
    if (!linkType) {
      increment(skippedReasons, 'unsupported_edge_kind')
      continue
    }
    if (!input.config.linkTypes.includes(linkType)) {
      increment(skippedReasons, 'disabled_link_type')
      continue
    }
    if (!passesConfidencePolicy(edge, input.config)) {
      increment(skippedReasons, edge.confidence === 'low' ? 'low_confidence' : 'excluded_source')
      continue
    }

    const resolved = resolveEdgeDocuments(edge, input.lookup)
    if ('reason' in resolved) {
      increment(skippedReasons, resolved.reason)
      continue
    }

    candidates.push({
      ...resolved,
      linkType,
      sourceEdgeId: edge.id,
      repoId: edge.repoId,
      confidence: edge.confidence,
      source: edge.source,
      reason: materializationReason(edge),
      runId: input.runId,
    })
  }

  return { candidates, skippedReasons }
}

export function dedupeLinkCandidates(candidates: MaterializedDocumentLinkCandidate[]): {
  links: MaterializedDocumentLinkRow[]
  evidence: MaterializedDocumentLinkCandidate[]
} {
  const links = new Map<string, MaterializedDocumentLinkRow>()
  const evidence = new Map<string, MaterializedDocumentLinkCandidate>()

  for (const candidate of candidates) {
    links.set(linkKey(candidate), {
      fromDocumentId: candidate.fromDocumentId,
      toDocumentId: candidate.toDocumentId,
      linkType: candidate.linkType,
    })
    evidence.set(`${linkKey(candidate)}:${candidate.sourceEdgeId}`, candidate)
  }

  return {
    links: [...links.values()].sort(compareLinkRows),
    evidence: [...evidence.values()].sort((a, b) => `${linkKey(a)}:${a.sourceEdgeId}`.localeCompare(`${linkKey(b)}:${b.sourceEdgeId}`)),
  }
}

export async function materializeDocumentGraph(input: MaterializeDocumentGraphInput): Promise<MaterializeDocumentGraphResult> {
  const config = resolveMaterializerConfig(input.config)
  const graphInputs = loadDocumentGraphInputs(input.db, input.projectId)
  const deprecatedEntryPointIds = listDeprecatedEntryPointIds(input.db, { projectId: input.projectId })
  const lookup = buildDocumentLookup({
    documents: graphInputs.documents,
    docDeps: graphInputs.docDeps,
    deprecatedEntryPointIds,
  })
  const { candidates, skippedReasons } = buildLinkCandidates({
    edges: graphInputs.serviceMapEdges,
    lookup,
    config,
    runId: input.runId,
  })
  const { links, evidence } = dedupeLinkCandidates(candidates)

  if (config.dryRun) {
    return resultSummary({
      scannedEdges: graphInputs.serviceMapEdges.length,
      candidates,
      links,
      evidence,
      skippedReasons,
      deletedGeneratedCount: 0,
      insertedCount: 0,
      existingCount: 0,
      evidenceInsertedCount: 0,
    })
  }

  const writeResult = replaceGeneratedDocumentLinks(input.db, input.projectId, config.linkTypes, links, evidence)

  return resultSummary({
    scannedEdges: graphInputs.serviceMapEdges.length,
    candidates,
    links,
    evidence,
    skippedReasons,
    ...writeResult,
  })
}

function loadDocumentGraphInputs(db: DB, projectId: string): DocumentGraphInputs {
  const projectDocuments = db.select().from(documents).where(eq(documents.projectId, projectId)).all()
  const documentIds = projectDocuments.map((doc) => doc.id)
  return {
    documents: projectDocuments,
    docDeps: documentIds.length === 0
      ? []
      : db.select().from(docDeps).where(inArray(docDeps.documentId, documentIds)).all(),
    serviceMapEdges: db.select().from(serviceMapEdges).where(eq(serviceMapEdges.projectId, projectId)).all(),
  }
}

function replaceGeneratedDocumentLinks(
  db: DB,
  projectId: string,
  linkTypes: GeneratedDocumentLinkType[],
  links: MaterializedDocumentLinkRow[],
  evidence: MaterializedDocumentLinkCandidate[],
): {
  deletedGeneratedCount: number
  insertedCount: number
  existingCount: number
  evidenceInsertedCount: number
} {
  let deletedGeneratedCount = 0
  let insertedCount = 0
  let existingCount = 0
  let evidenceInsertedCount = 0
  const writableLinkKeys = new Set<string>()

  db.transaction((tx) => {
    const projectDocumentIds = new Set(tx.select({ id: documents.id })
      .from(documents)
      .where(eq(documents.projectId, projectId))
      .all()
      .map((doc) => doc.id))
    const existingGenerated = linkTypes.length === 0
      ? []
      : tx.select({
        fromDocumentId: documentLinks.fromDocumentId,
        toDocumentId: documentLinks.toDocumentId,
        linkType: documentLinks.linkType,
      })
        .from(documentLinks)
        .where(and(
          eq(documentLinks.createdBy, DOCUMENT_GRAPH_MATERIALIZER_CREATED_BY),
          inArray(documentLinks.linkType, linkTypes),
        ))
        .all()
        .filter((link) => projectDocumentIds.has(link.fromDocumentId) && projectDocumentIds.has(link.toDocumentId))

    deletedGeneratedCount = existingGenerated.length

    if (linkTypes.length > 0) {
      tx.delete(documentLinkEvidence).where(and(
        eq(documentLinkEvidence.projectId, projectId),
        eq(documentLinkEvidence.createdBy, DOCUMENT_GRAPH_MATERIALIZER_CREATED_BY),
        inArray(documentLinkEvidence.linkType, linkTypes),
      )).run()
      for (const link of existingGenerated) {
        tx.delete(documentLinks).where(and(
          eq(documentLinks.fromDocumentId, link.fromDocumentId),
          eq(documentLinks.toDocumentId, link.toDocumentId),
          eq(documentLinks.linkType, link.linkType),
        )).run()
      }
    }

    for (const link of links) {
      const existing = tx.select({ fromDocumentId: documentLinks.fromDocumentId })
        .from(documentLinks)
        .where(and(
          eq(documentLinks.fromDocumentId, link.fromDocumentId),
          eq(documentLinks.toDocumentId, link.toDocumentId),
          eq(documentLinks.linkType, link.linkType),
        ))
        .get()
      if (existing) {
        existingCount += 1
        continue
      }
      tx.insert(documentLinks).values({
        ...link,
        createdBy: DOCUMENT_GRAPH_MATERIALIZER_CREATED_BY,
      }).run()
      insertedCount += 1
      writableLinkKeys.add(linkKey(link))
    }

    for (const row of evidence.filter((item) => writableLinkKeys.has(linkKey(item))).map((item): NewDocumentLinkEvidence => ({
      projectId,
      fromDocumentId: item.fromDocumentId,
      toDocumentId: item.toDocumentId,
      linkType: item.linkType,
      sourceEdgeId: item.sourceEdgeId,
      repoId: item.repoId,
      confidence: item.confidence,
      source: item.source,
      reason: item.reason,
      runId: item.runId,
      createdBy: DOCUMENT_GRAPH_MATERIALIZER_CREATED_BY,
    }))) {
      tx.insert(documentLinkEvidence).values(row).onConflictDoNothing().run()
      evidenceInsertedCount += 1
    }
  })

  return { deletedGeneratedCount, insertedCount, existingCount, evidenceInsertedCount }
}

function documentTypeForServiceNode(type: ServiceMapNodeType): string | null {
  if (type === 'screen') return 'screen_spec'
  if (type === 'api') return 'api_spec'
  if (type === 'event') return 'event_spec'
  if (type === 'job') return 'schedule_spec'
  return null
}

function resolveDocumentForEndpoint(id: string, documentType: string, lookup: DocumentLookup): Document | null {
  return firstDocumentOfType(lookup.byScopeId.get(id), documentType)
    ?? firstDocumentOfType(lookup.byCodeNodeId.get(id), documentType)
}

function firstDocumentOfType(docs: Document[] | undefined, documentType: string): Document | null {
  return docs?.filter((doc) => doc.type === documentType).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null
}

function materializationReason(edge: ServiceMapEdge): string {
  return `${edge.sourceType}:${edge.sourceId} ${edge.kind} ${edge.targetType}:${edge.targetId}`
}

function confidenceRank(confidence: Confidence): number {
  if (confidence === 'high') return 3
  if (confidence === 'medium') return 2
  return 1
}

function resultSummary(input: {
  scannedEdges: number
  candidates: MaterializedDocumentLinkCandidate[]
  links: MaterializedDocumentLinkRow[]
  evidence: MaterializedDocumentLinkCandidate[]
  skippedReasons: Record<string, number>
  deletedGeneratedCount: number
  insertedCount: number
  existingCount: number
  evidenceInsertedCount: number
}): MaterializeDocumentGraphResult {
  const skippedCount = Object.values(input.skippedReasons).reduce((sum, count) => sum + count, 0)
  return {
    scannedEdges: input.scannedEdges,
    candidateCount: input.links.length,
    insertedCount: input.insertedCount,
    existingCount: input.existingCount,
    evidenceInsertedCount: input.evidenceInsertedCount,
    deletedGeneratedCount: input.deletedGeneratedCount,
    skippedCount,
    skippedReasons: input.skippedReasons,
  }
}

function linkKey(link: { fromDocumentId: string; toDocumentId: string; linkType: string }): string {
  return `${link.fromDocumentId}\0${link.toDocumentId}\0${link.linkType}`
}

function compareLinkRows(a: MaterializedDocumentLinkRow, b: MaterializedDocumentLinkRow): number {
  return linkKey(a).localeCompare(linkKey(b))
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function readConfidenceEnv(name: string): Confidence | undefined {
  const value = process.env[name]
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined
}

function readSourceListEnv(name: string): ServiceMapEdgeSource[] | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const parsed = value.split(',').map((item) => item.trim()).filter(isServiceMapEdgeSource)
  return parsed.length > 0 ? parsed : undefined
}

function readLinkTypeListEnv(name: string): GeneratedDocumentLinkType[] | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const allowed = new Set<string>(generatedLinkTypes)
  const parsed = value.split(',').map((item) => item.trim()).filter((item): item is GeneratedDocumentLinkType => allowed.has(item))
  return parsed.length > 0 ? parsed : undefined
}

function isServiceMapEdgeSource(value: string): value is ServiceMapEdgeSource {
  return value === 'deterministic' || value === 'suffix_match' || value === 'doc_llm' || value === 'merged'
}
