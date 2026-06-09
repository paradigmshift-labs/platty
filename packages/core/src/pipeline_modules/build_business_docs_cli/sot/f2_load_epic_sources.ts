import type { Document, DocumentLink, DocumentMemory, DocRelationLink } from '@/db/schema/build_docs.js'
import type { EpicDependency, EpicDocumentLink } from '@/db/schema/build_epics.js'
import type { Model } from '@/db/schema/build_models.js'
import type { ConfirmedEpic, EpicSourceBundle, ModelEvidence } from './types.js'
import { buildBusinessSourceGraph } from './source_graph.js'

const lowerSourceTypes = new Set(['api_spec', 'screen_spec', 'event_spec', 'schedule_spec'])

// The legacy pipeline persists documents with status 'passed'. The CLI persists
// live technical/business documents with status 'active'. Since this file is
// CLI-owned, the accepted status set is configurable so neither convention
// silently filters every source out. Default keeps the legacy 'passed' semantics.
const DEFAULT_ACCEPTED_STATUSES = ['passed'] as const

export function loadEpicSources(input: {
  projectId: string
  epic: ConfirmedEpic
  epics?: ConfirmedEpic[]
  documents: Document[]
  epicDocumentLinks: EpicDocumentLink[]
  epicDependencies?: EpicDependency[]
  docRelationLinks: DocRelationLink[]
  documentLinks?: DocumentLink[]
  models: Model[]
  memories: DocumentMemory[]
  existingBusinessDocs: Document[]
  acceptedStatuses?: readonly string[]
}): EpicSourceBundle {
  const acceptedStatuses = new Set(input.acceptedStatuses ?? DEFAULT_ACCEPTED_STATUSES)
  const linked = input.epicDocumentLinks.filter((link) => link.epicId === input.epic.id)
  const linkedIds = new Set(linked.map((link) => link.documentId))
  const sourceDocuments = input.documents
    .filter((doc) => linkedIds.has(doc.id))
    .filter((doc) => doc.projectId === input.projectId && acceptedStatuses.has(doc.status))
    .filter((doc) => lowerSourceTypes.has(doc.type))
    .sort((a, b) => a.id.localeCompare(b.id))

  if (sourceDocuments.length === 0) {
    throw Object.assign(new Error(`EPIC ${input.epic.id} has no linked passed source documents`), { code: 'NO_SOURCE_INPUTS' })
  }

  const sourceIds = new Set(sourceDocuments.map((doc) => doc.id))
  const docRelationLinks = input.docRelationLinks.filter((link) => sourceIds.has(link.documentId))
  const relatedScreenDocuments = findRelatedScreenDocuments(input.documents, input.docRelationLinks, sourceDocuments, sourceIds, input.documentLinks ?? [], acceptedStatuses)
  const crossEpicContext = buildCrossEpicContext(input.epic, input.epics ?? [input.epic], input.epicDependencies ?? [], input.documents, acceptedStatuses)
  const relatedTargets = new Map<string, { sourceDocumentIds: Set<string>; relationTargets: Set<string> }>()

  for (const link of docRelationLinks) {
    if (link.kind !== 'db_access') continue
    const targets = [link.canonicalTarget, link.target].filter((value): value is string => !!value)
    for (const target of targets) {
      const normalized = normalizeDbTarget(target)
      if (!normalized) continue
      const bucket = relatedTargets.get(normalized) ?? { sourceDocumentIds: new Set<string>(), relationTargets: new Set<string>() }
      bucket.sourceDocumentIds.add(link.documentId)
      bucket.relationTargets.add(target)
      relatedTargets.set(normalized, bucket)
    }
  }

  const modelEvidence: ModelEvidence[] = input.models
    .map((model) => {
      const names = [model.tableName, model.name].map(normalizeDbTarget).filter((value): value is string => !!value)
      const matches = names.map((name) => relatedTargets.get(name)).filter((value): value is NonNullable<typeof value> => !!value)
      if (matches.length === 0) return null
      return {
        model,
        sourceDocumentIds: [...new Set(matches.flatMap((match) => [...match.sourceDocumentIds]))].sort(),
        relationTargets: [...new Set(matches.flatMap((match) => [...match.relationTargets]))].sort(),
      }
    })
    .filter((value): value is ModelEvidence => value !== null)
    .sort((a, b) => a.model.name.localeCompare(b.model.name))

  const sourceGaps = modelEvidence.length === 0
    ? [{ code: 'missing_model_evidence', message: 'No db_access relation from EPIC-linked documents resolved to a model.' }]
    : []

  return {
    epic: input.epic,
    sourceDocuments,
    relatedScreenDocuments,
    crossEpicContext,
    epicDocumentLinks: linked,
    docRelationLinks,
    modelEvidence,
    sourceGraph: buildBusinessSourceGraph({
      epic: input.epic,
      sourceDocuments,
      epicDocumentLinks: linked,
      docRelationLinks,
      modelEvidence,
      crossEpicContext,
    }),
    memories: input.memories.filter((memory) => sourceIds.has(memory.documentId)),
    existingBusinessDocs: input.existingBusinessDocs
      .filter((doc) => doc.projectId === input.projectId)
      .filter((doc) => (doc.scope === 'epic' && doc.scopeId === input.epic.id) || doc.scope === 'uc')
      .sort((a, b) => a.id.localeCompare(b.id)),
    sourceGaps,
  }
}

function buildCrossEpicContext(
  epic: ConfirmedEpic,
  epics: ConfirmedEpic[],
  dependencies: EpicDependency[],
  documents: Document[],
  acceptedStatuses: Set<string>,
): EpicSourceBundle['crossEpicContext'] {
  const epicsById = new Map(epics.map((item) => [item.id, item]))
  const businessDocsByEpicId = new Map<string, Document[]>()
  for (const doc of documents) {
    if (doc.track !== 'business' || !acceptedStatuses.has(doc.status) || doc.scope !== 'epic' || !doc.scopeId) continue
    const bucket = businessDocsByEpicId.get(doc.scopeId) ?? []
    bucket.push(doc)
    businessDocsByEpicId.set(doc.scopeId, bucket)
  }

  return dependencies
    .map((dep) => {
      if (dep.sourceEpicId === epic.id) return { direction: 'outgoing' as const, relatedEpicId: dep.targetEpicId, dependency: dep }
      if (dep.targetEpicId === epic.id) return { direction: 'incoming' as const, relatedEpicId: dep.sourceEpicId, dependency: dep }
      return null
    })
    .filter((item): item is { direction: 'outgoing' | 'incoming'; relatedEpicId: string; dependency: EpicDependency } => item !== null)
    .map((item) => ({
      epic: epicsById.get(item.relatedEpicId) ?? { id: item.relatedEpicId, projectId: epic.projectId, name: item.relatedEpicId, abbr: null, summary: null, confirmedAt: '' },
      direction: item.direction,
      dependency: item.dependency,
      businessDocs: (businessDocsByEpicId.get(item.relatedEpicId) ?? [])
        .sort((a, b) => a.type.localeCompare(b.type))
        .map((doc) => ({
          id: doc.id,
          type: doc.type,
          summary: doc.summary,
          content: doc.content,
        })),
    }))
    .sort((a, b) => `${a.direction}:${a.epic.name}:${a.dependency.kind}`.localeCompare(`${b.direction}:${b.epic.name}:${b.dependency.kind}`))
}

function findRelatedScreenDocuments(
  documents: Document[],
  relationLinks: DocRelationLink[],
  sourceDocuments: Document[],
  sourceIds: Set<string>,
  documentLinks: DocumentLink[] = [],
  acceptedStatuses: Set<string>,
): EpicSourceBundle['relatedScreenDocuments'] {
  const linkedScreens = findRelatedScreenDocumentsFromDocumentLinks(documents, documentLinks, sourceDocuments, sourceIds, acceptedStatuses)

  const apiRoutes = sourceDocuments
    .filter((doc) => doc.type === 'api_spec')
    .map((doc) => ({ documentId: doc.id, route: apiRouteSignature(doc) }))
    .filter((item): item is { documentId: string; route: string } => item.route !== null)
  if (apiRoutes.length === 0) return []

  const routeToDocumentIds = new Map<string, Set<string>>()
  for (const item of apiRoutes) {
    const bucket = routeToDocumentIds.get(item.route) ?? new Set<string>()
    bucket.add(item.documentId)
    routeToDocumentIds.set(item.route, bucket)
  }

  const screenById = new Map(documents
    .filter((doc) => doc.type === 'screen_spec' && acceptedStatuses.has(doc.status) && !sourceIds.has(doc.id))
    .map((doc) => [doc.id, doc]))
  const matched = new Map<string, { document: Document; sourceIds: Set<string>; routes: Set<string> }>()

  for (const link of relationLinks) {
    if (link.kind !== 'api_call') continue
    const screen = screenById.get(link.documentId)
    if (!screen) continue
    const route = apiRelationSignature(link)
    if (!route) continue
    const matchedSourceIds = routeToDocumentIds.get(route)
    if (!matchedSourceIds) continue
    const bucket = matched.get(screen.id) ?? { document: screen, sourceIds: new Set<string>(), routes: new Set<string>() }
    for (const id of matchedSourceIds) bucket.sourceIds.add(id)
    bucket.routes.add(route)
    matched.set(screen.id, bucket)
  }

  const fallbackScreens = [...matched.values()]
    .map((item) => ({
      document: item.document,
      matchedSourceDocumentIds: [...item.sourceIds].sort(),
      reason: `Screen calls EPIC API route(s): ${[...item.routes].sort().join(', ')}`,
    }))
    .sort((a, b) => a.document.id.localeCompare(b.document.id))

  return mergeRelatedScreenDocuments(linkedScreens, fallbackScreens)
}

function findRelatedScreenDocumentsFromDocumentLinks(
  documents: Document[],
  links: DocumentLink[],
  sourceDocuments: Document[],
  sourceIds: Set<string>,
  acceptedStatuses: Set<string>,
): EpicSourceBundle['relatedScreenDocuments'] {
  const apiDocumentIds = new Set(sourceDocuments.filter((doc) => doc.type === 'api_spec').map((doc) => doc.id))
  if (apiDocumentIds.size === 0) return []

  const screenById = new Map(documents
    .filter((doc) => doc.type === 'screen_spec' && acceptedStatuses.has(doc.status) && !sourceIds.has(doc.id))
    .map((doc) => [doc.id, doc]))
  const matched = new Map<string, { document: Document; sourceIds: Set<string> }>()

  for (const link of links) {
    if (link.linkType !== 'calls_api') continue
    if (!apiDocumentIds.has(link.toDocumentId)) continue
    const screen = screenById.get(link.fromDocumentId)
    if (!screen) continue
    const bucket = matched.get(screen.id) ?? { document: screen, sourceIds: new Set<string>() }
    bucket.sourceIds.add(link.toDocumentId)
    matched.set(screen.id, bucket)
  }

  return [...matched.values()]
    .map((item) => ({
      document: item.document,
      matchedSourceDocumentIds: [...item.sourceIds].sort(),
      reason: 'Screen is linked to EPIC API document(s) by document_links.calls_api',
    }))
    .sort((a, b) => a.document.id.localeCompare(b.document.id))
}

function mergeRelatedScreenDocuments(
  primary: EpicSourceBundle['relatedScreenDocuments'],
  fallback: EpicSourceBundle['relatedScreenDocuments'],
): EpicSourceBundle['relatedScreenDocuments'] {
  const merged = new Map<string, EpicSourceBundle['relatedScreenDocuments'][number]>()
  for (const item of [...fallback, ...primary]) {
    const existing = merged.get(item.document.id)
    if (!existing) {
      merged.set(item.document.id, item)
      continue
    }
    merged.set(item.document.id, {
      document: item.document,
      matchedSourceDocumentIds: [...new Set([...existing.matchedSourceDocumentIds, ...item.matchedSourceDocumentIds])].sort(),
      reason: item.reason,
    })
  }
  return [...merged.values()].sort((a, b) => a.document.id.localeCompare(b.document.id))
}

function apiRouteSignature(doc: Document): string | null {
  const content = doc.content ?? {}
  const identity = readRecord(content, 'identity') ?? content
  const method = readString(identity, 'method') ?? readString(identity, 'http_method')
  const path = readString(identity, 'path') ?? readString(identity, 'route_path')
  return normalizeApiSignature(method, path)
}

function apiRelationSignature(link: DocRelationLink): string | null {
  const payload = link.payloadJson ?? {}
  const canonical = link.canonicalTarget ?? ''
  const canonicalMatch = canonical.match(/^([A-Z]+)\s+(.+)$/)
  const canonicalSignature = normalizeApiSignature(canonicalMatch?.[1], canonicalMatch?.[2])
  if (canonicalSignature) return canonicalSignature

  const method = link.operation ?? readString(payload, 'method')
  const path = link.target ?? readString(payload, 'path')
  return normalizeApiSignature(method, path)
}

function normalizeApiSignature(method: unknown, path: unknown): string | null {
  if (typeof method !== 'string' || typeof path !== 'string') return null
  const normalizedMethod = method.trim().toUpperCase()
  const normalizedPath = normalizeApiPath(path)
  if (!normalizedMethod || !normalizedPath) return null
  return `${normalizedMethod} ${normalizedPath}`
}

function normalizeApiPath(path: string): string {
  const [withoutQuery] = path.trim().split('?')
  return withoutQuery
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .replace(/\[([^\]]+)\]/g, ':$1')
    || '/'
}

function readRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const nested = (value as Record<string, unknown>)[key]
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : null
}

function readString(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null
  const item = (value as Record<string, unknown>)[key]
  return typeof item === 'string' ? item : null
}

function normalizeDbTarget(target: string | null): string | null {
  if (!target) return null
  return target
    .replace(/^db:/, '')
    .split(':')[0]
    .trim()
    .toLowerCase()
    .replace(/^["'`]|["'`]$/g, '')
    || null
}
