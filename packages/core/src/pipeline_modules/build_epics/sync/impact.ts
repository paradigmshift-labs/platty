import { eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { documents } from '@/db/schema/build_docs.js'
import type { EpicDocumentType } from '@/db/schema/build_epics.js'
import { docSyncCandidates } from '@/db/schema/sync.js'

export type EpicSyncImpactKind = 'new' | 'changed' | 'deleted'

export interface EpicSyncDocumentImpact {
  documentId: string
  documentType: EpicDocumentType
  scope: string
  scopeId: string | null
  kind: EpicSyncImpactKind
  oldHash: string | null
  newHash: string | null
  domainHints?: string[]
  relationTargets?: string[]
}

export interface EpicSyncImpactResult {
  projectId: string
  docSyncPlanId: string
  impacts: EpicSyncDocumentImpact[]
  counts: Record<EpicSyncImpactKind, number>
}

const BUILD_EPICS_DOCUMENT_TYPES = new Set<EpicDocumentType>(['api_spec', 'screen_spec', 'event_spec', 'schedule_spec'])

export function deriveEpicSyncImpact(input: { db: DB; projectId: string; docSyncPlanId: string }): EpicSyncImpactResult {
  const candidateRows = input.db.select().from(docSyncCandidates).where(eq(docSyncCandidates.planId, input.docSyncPlanId)).all()
  const documentRows = input.db.select().from(documents).where(eq(documents.projectId, input.projectId)).all()
  const documentsByTarget = new Map(documentRows.map((document) => [documentTargetKey(document), document]))
  const impacts: EpicSyncDocumentImpact[] = []

  for (const candidate of candidateRows) {
    const target = readCandidateTarget(candidate.targetJson)
    const kind = mapCandidateKind(candidate.kind)
    if (candidate.phase !== 'technical' || !target || target.track !== 'technical' || !kind || !isEpicDocumentType(target.type)) continue

    const document = documentsByTarget.get(targetKey(target))
    if (!document || !isEpicDocumentType(document.type)) continue

    impacts.push({
      documentId: document.id,
      documentType: document.type,
      scope: document.scope,
      scopeId: document.scopeId,
      kind,
      oldHash: candidate.oldHash,
      newHash: candidate.newHash,
    })
  }

  return {
    projectId: input.projectId,
    docSyncPlanId: input.docSyncPlanId,
    impacts,
    counts: {
      new: impacts.filter((impact) => impact.kind === 'new').length,
      changed: impacts.filter((impact) => impact.kind === 'changed').length,
      deleted: impacts.filter((impact) => impact.kind === 'deleted').length,
    },
  }
}

function mapCandidateKind(kind: string): EpicSyncImpactKind | null {
  if (kind === 'new_document') return 'new'
  if (kind === 'orphan_document') return 'deleted'
  if (kind === 'stale' || kind === 'stale_candidate') return 'changed'
  return null
}

function isEpicDocumentType(type: string): type is EpicDocumentType {
  return BUILD_EPICS_DOCUMENT_TYPES.has(type as EpicDocumentType)
}

function readCandidateTarget(targetJson: Record<string, unknown>) {
  const track = typeof targetJson.track === 'string' ? targetJson.track : null
  const type = typeof targetJson.type === 'string' ? targetJson.type : null
  const scope = typeof targetJson.scope === 'string' ? targetJson.scope : null
  const scopeId = typeof targetJson.scopeId === 'string' ? targetJson.scopeId : null

  if (!track || !type || !scope) return null
  return { track, type, scope, scopeId }
}

function documentTargetKey(document: { track: string; type: string; scope: string; scopeId: string | null }) {
  return targetKey(document)
}

function targetKey(target: { track: string; type: string; scope: string; scopeId: string | null }) {
  return `${target.track}:${target.type}:${target.scope}:${target.scopeId ?? ''}`
}
