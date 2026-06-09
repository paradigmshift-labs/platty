import type { BusinessDocContextPage } from '@/db/schema/build_business_docs_generation.js'

export interface SourceEvidenceTarget {
  evidenceId: string
  sourceRef: string
  documentId: string
  role: 'primary' | 'supporting' | 'exception' | 'background'
}

export interface SourceEvidenceTargets {
  byEvidenceId: Map<string, SourceEvidenceTarget[]>
  bySourceRef: Map<string, SourceEvidenceTarget[]>
}

export function readSourceEvidenceTargets(pages: BusinessDocContextPage[]): SourceEvidenceTargets {
  const byEvidenceId = new Map<string, SourceEvidenceTarget[]>()
  const bySourceRef = new Map<string, SourceEvidenceTarget[]>()
  const page = pages.find((candidate) => candidate.pageToken === 'source_document_cards')
  const cards = page?.contentJson.cards

  if (Array.isArray(cards)) {
    for (const card of cards) {
      if (!isRecord(card)) continue
      const evidenceId = typeof card.evidenceId === 'string' ? card.evidenceId : null
      const sourceRef = typeof card.sourceRef === 'string' ? card.sourceRef : null
      const documentId = typeof card.documentId === 'string' ? card.documentId : null
      if (!evidenceId || !sourceRef || !documentId) continue
      const epicLink = isRecord(card.epicLink) ? card.epicLink : {}
      const target = {
        evidenceId,
        sourceRef,
        documentId,
        role: mapSourceLinkRole(typeof epicLink.role === 'string' ? epicLink.role : null),
      } satisfies SourceEvidenceTarget
      appendTarget(byEvidenceId, evidenceId, target)
      appendTarget(bySourceRef, sourceRef, target)
    }
  }

  const modelPage = pages.find((candidate) => candidate.pageToken === 'model_evidence')
  const models = modelPage?.contentJson.models
  if (Array.isArray(models)) {
    for (const model of models) {
      if (!isRecord(model)) continue
      const evidenceId = typeof model.evidenceId === 'string' ? model.evidenceId : null
      if (!evidenceId) continue
      const sourceDocumentIds = readStringArrayFromRecord(model, 'sourceDocumentIds')
      for (const documentId of sourceDocumentIds) {
        appendTarget(byEvidenceId, evidenceId, {
          evidenceId,
          sourceRef: evidenceId,
          documentId,
          role: 'supporting',
        })
      }
    }
  }

  const sourceGraphPage = pages.find((candidate) => candidate.pageToken === 'source_graph_projection')
  const outline = isRecord(sourceGraphPage?.contentJson.coverageOutline)
    ? sourceGraphPage?.contentJson.coverageOutline
    : null
  const clusters = Array.isArray(outline?.clusters) ? outline.clusters : []
  for (const cluster of clusters) {
    if (!isRecord(cluster)) continue
    const sourceRefs = readStringArrayFromRecord(cluster, 'sourceRefs')
    const documentIds = readStringArrayFromRecord(cluster, 'documentIds')
    const evidenceIds = readStringArrayFromRecord(cluster, 'evidenceIds')
    const sourceRefRoles = isRecord(cluster.sourceRefRoles) ? cluster.sourceRefRoles : {}
    const clusterRole = mapSourceGraphClusterRole(cluster)

    for (let index = 0; index < Math.max(sourceRefs.length, documentIds.length); index += 1) {
      const sourceRef = sourceRefs[index] ?? (sourceRefs.length === 1 ? sourceRefs[0] : null)
      const documentId = documentIds[index] ?? (documentIds.length === 1 ? documentIds[0] : null)
      if (!sourceRef || !documentId) continue
      if (bySourceRef.has(sourceRef)) continue
      const role = sourceGraphSourceRefRole(sourceRefRoles, sourceRef, clusterRole)
      appendTarget(bySourceRef, sourceRef, {
        evidenceId: evidenceIds[index] ?? evidenceIds[0] ?? sourceRef,
        sourceRef,
        documentId,
        role,
      })
    }

    for (const evidenceId of evidenceIds) {
      if (byEvidenceId.has(evidenceId)) continue
      for (const [index, documentId] of documentIds.entries()) {
        const sourceRef = sourceRefs[index] ?? sourceRefs[0] ?? evidenceId
        appendTarget(byEvidenceId, evidenceId, {
          evidenceId,
          sourceRef,
          documentId,
          role: sourceGraphSourceRefRole(sourceRefRoles, sourceRef, clusterRole),
        })
      }
    }
  }

  return { byEvidenceId, bySourceRef }
}

export function resolveItemSourceTargets(
  item: { content: Record<string, unknown>; evidenceIds?: string[] },
  sourceTargets: SourceEvidenceTargets,
): SourceEvidenceTarget[] {
  const targets = new Map<string, SourceEvidenceTarget>()
  for (const evidenceId of item.evidenceIds ?? []) {
    const evidenceTargets = sourceTargets.byEvidenceId.get(evidenceId) ?? []
    for (const target of evidenceTargets) targets.set(target.documentId, target)
  }
  for (const sourceRef of readSourceRefsFromContent(item.content)) {
    const sourceRefTargets = sourceTargets.bySourceRef.get(sourceRef) ?? []
    for (const target of sourceRefTargets) targets.set(target.documentId, target)
    const evidenceTargets = sourceTargets.byEvidenceId.get(sourceRef) ?? []
    for (const target of evidenceTargets) targets.set(target.documentId, target)
  }
  return [...targets.values()]
}

export function readSourceRefsFromContent(content: Record<string, unknown>): string[] {
  const refs = new Set<string>()
  for (const key of ['sourceRef', 'primarySourceRefs', 'supportingSourceRefs', 'crossEpicSourceRefs']) {
    const value = content[key]
    if (typeof value === 'string' && value.trim()) refs.add(value.trim())
    if (Array.isArray(value)) addSourceRefArray(refs, value)
  }

  addSourceMappingRefs(refs, content.source_mapping)

  const fields = content.fields
  if (Array.isArray(fields)) {
    for (const field of fields) {
      if (!isRecord(field)) continue
      addSourceMappingRefs(refs, field.source_mapping)
    }
  }

  return [...refs]
}

function addSourceMappingRefs(refs: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      refs.add(entry.trim())
      continue
    }
    if (!isRecord(entry)) continue
    const sourceRef = entry.sourceRef
    if (typeof sourceRef === 'string' && sourceRef.trim()) refs.add(sourceRef.trim())
  }
}

function addSourceRefArray(refs: Set<string>, value: unknown[]): void {
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) refs.add(item.trim())
  }
}

function appendTarget(map: Map<string, SourceEvidenceTarget[]>, key: string, target: SourceEvidenceTarget): void {
  const existing = map.get(key) ?? []
  existing.push(target)
  map.set(key, existing)
}

function mapSourceLinkRole(role: string | null): SourceEvidenceTarget['role'] {
  if (role === 'primary' || role === 'owner') return 'primary'
  if (role === 'supporting' || role === 'cross_epic') return 'supporting'
  if (role === 'exception') return 'exception'
  return 'background'
}

function mapSourceGraphClusterRole(cluster: Record<string, unknown>): SourceEvidenceTarget['role'] {
  const sourceRoles = isRecord(cluster.sourceRoles) ? cluster.sourceRoles : {}
  if (hasPositiveRole(sourceRoles, ['primary', 'owner'])) return 'primary'
  if (hasPositiveRole(sourceRoles, ['supporting', 'cross_epic'])) return 'supporting'
  if (hasPositiveRole(sourceRoles, ['exception'])) return 'exception'
  return 'background'
}

function sourceGraphSourceRefRole(
  sourceRefRoles: Record<string, unknown>,
  sourceRef: string,
  fallback: SourceEvidenceTarget['role'],
): SourceEvidenceTarget['role'] {
  const role = sourceRefRoles[sourceRef]
  return typeof role === 'string' ? mapSourceLinkRole(role) : fallback
}

function hasPositiveRole(sourceRoles: Record<string, unknown>, roles: string[]): boolean {
  return roles.some((role) => {
    const count = sourceRoles[role]
    return typeof count === 'number' && count > 0
  })
}

function readStringArrayFromRecord(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
