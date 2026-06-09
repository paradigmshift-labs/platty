import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { documentItemDocumentLinks, documentItems, documentLinks, documents } from '@/db/schema/build_docs.js'
import { buildEpicsDrafts, epicDocumentLinks } from '@/db/schema/build_epics.js'
import { epics, projects } from '@/db/schema/core.js'
import { docSyncCandidates, docSyncPlans } from '@/db/schema/sync.js'
import { deriveBusinessDocsSyncImpact } from './impact.js'
import { computeBusinessDocSourceHashes } from './source_hashes.js'
import type { BusinessDocsSyncPreviewResult } from './types.js'

export interface BusinessDocsSyncPreviewInput {
  projectId: string
  docSyncPlanId?: string
}

export function previewBusinessDocsSync(db: DB, input: BusinessDocsSyncPreviewInput): BusinessDocsSyncPreviewResult {
  const project = db.select({ id: projects.id, name: projects.name }).from(projects)
    .where(eq(projects.id, input.projectId))
    .get() ?? { id: input.projectId, name: input.projectId }
  const affectedEpicIds = input.docSyncPlanId
    ? loadAffectedEpicIds(db, input.projectId, input.docSyncPlanId)
    : null
  const sourceHashes = computeBusinessDocSourceHashes(db, { projectId: input.projectId })
  if (input.docSyncPlanId && affectedEpicIds?.length === 0) {
    return {
      projectId: input.projectId,
      project,
      docSyncPlanId: input.docSyncPlanId,
      latestStaticSnapshotId: sourceHashes.latestStaticSnapshotId,
      summary: emptySummary(),
      targets: [],
      orphanedTargets: [],
    }
  }
  const impact = deriveBusinessDocsSyncImpact(db, {
    projectId: input.projectId,
    sourceHashes,
    targetScopeEpicIds: affectedEpicIds ?? undefined,
    orphanScopeEpicIds: affectedEpicIds ?? undefined,
  })

  return {
    projectId: input.projectId,
    project,
    ...(input.docSyncPlanId ? { docSyncPlanId: input.docSyncPlanId } : {}),
    latestStaticSnapshotId: sourceHashes.latestStaticSnapshotId,
    summary: impact.summary,
    targets: impact.targets,
    orphanedTargets: impact.orphanedTargets,
  }
}

function emptySummary(): BusinessDocsSyncPreviewResult['summary'] {
  return {
    fresh: 0,
    missing: 0,
    stale: 0,
    orphaned: 0,
    blocked: 0,
    tasksPlanned: 0,
  }
}

function loadAffectedEpicIds(db: DB, projectId: string, docSyncPlanId: string): string[] {
  const plan = db.select().from(docSyncPlans)
    .where(and(
      eq(docSyncPlans.id, docSyncPlanId),
      eq(docSyncPlans.projectId, projectId),
    ))
    .get()
  if (!plan) return []
  const candidates = db.select().from(docSyncCandidates)
    .where(eq(docSyncCandidates.planId, docSyncPlanId))
    .all()
  const epicIds = new Set<string>()
  const documentIds = new Set<string>()
  for (const candidate of candidates) {
    const target = candidate.targetJson
    if (typeof target.epicId === 'string' && target.epicId.trim()) {
      epicIds.add(target.epicId)
    }
    if (typeof target.documentId === 'string' && target.documentId.trim()) {
      documentIds.add(target.documentId)
    }
    if (typeof target.scope === 'string' && target.scope === 'epic' && typeof target.scopeId === 'string' && target.scopeId.trim()) {
      epicIds.add(target.scopeId)
    }
    const targetDocumentIds = loadDocumentIdsForCandidateTarget(db, projectId, target)
    for (const documentId of targetDocumentIds) documentIds.add(documentId)
  }
  if (documentIds.size > 0) {
    const links = db.select().from(epicDocumentLinks)
      .where(inArray(epicDocumentLinks.documentId, [...documentIds]))
      .all()
    for (const link of links) epicIds.add(link.epicId)
    for (const epicId of loadBusinessDocEpicIdsLinkedToSourceDocuments(db, projectId, [...documentIds])) {
      epicIds.add(epicId)
    }
  }
  for (const epicId of loadConfirmedDeletedEpicIdsFromSyncDraft(db, projectId, docSyncPlanId)) {
    epicIds.add(epicId)
  }
  return [...epicIds].sort((a, b) => a.localeCompare(b))
}

function loadBusinessDocEpicIdsLinkedToSourceDocuments(db: DB, projectId: string, sourceDocumentIds: string[]): string[] {
  if (sourceDocumentIds.length === 0) return []

  const directRows = db.select({ scopeId: documents.scopeId })
    .from(documentLinks)
    .innerJoin(documents, eq(documentLinks.fromDocumentId, documents.id))
    .where(and(
      eq(documents.projectId, projectId),
      eq(documents.track, 'business'),
      eq(documents.scope, 'epic'),
      isNotNull(documents.scopeId),
      inArray(documentLinks.toDocumentId, sourceDocumentIds),
    ))
    .all()
  const itemRows = db.select({ scopeId: documents.scopeId })
    .from(documentItemDocumentLinks)
    .innerJoin(documentItems, eq(documentItemDocumentLinks.fromItemId, documentItems.id))
    .innerJoin(documents, eq(documentItems.documentId, documents.id))
    .where(and(
      eq(documents.projectId, projectId),
      eq(documents.track, 'business'),
      eq(documents.scope, 'epic'),
      isNotNull(documents.scopeId),
      inArray(documentItemDocumentLinks.toDocumentId, sourceDocumentIds),
    ))
    .all()

  return [...directRows, ...itemRows]
    .map((row) => row.scopeId)
    .filter((scopeId): scopeId is string => typeof scopeId === 'string' && scopeId.trim().length > 0)
    .sort((a, b) => a.localeCompare(b))
}

function loadConfirmedDeletedEpicIdsFromSyncDraft(db: DB, projectId: string, docSyncPlanId: string): string[] {
  const drafts = db.select().from(buildEpicsDrafts)
    .where(eq(buildEpicsDrafts.projectId, projectId))
    .all()
  const removedEpicIds = new Set<string>()
  for (const draft of drafts) {
    const metadata = syncMetadata(draft.draftJson)
    if (metadata?.docSyncPlanId !== docSyncPlanId) continue
    for (const epicId of stringArray(metadata.removedEpicIds)) removedEpicIds.add(epicId)
  }
  if (removedEpicIds.size === 0) return []

  return db.select({ id: epics.id }).from(epics)
    .where(and(
      eq(epics.projectId, projectId),
      inArray(epics.id, [...removedEpicIds]),
      isNotNull(epics.deletedAt),
    ))
    .all()
    .map((epic) => epic.id)
}

function loadDocumentIdsForCandidateTarget(db: DB, projectId: string, target: Record<string, unknown>): string[] {
  const track = typeof target.track === 'string' ? target.track.trim() : ''
  const type = typeof target.type === 'string' ? target.type.trim() : ''
  const scope = typeof target.scope === 'string' ? target.scope.trim() : ''
  const scopeId = typeof target.scopeId === 'string' ? target.scopeId.trim() : ''
  if (!track || !type || !scope) return []

  const rows = db.select({ id: documents.id }).from(documents)
    .where(and(
      eq(documents.projectId, projectId),
      eq(documents.track, track),
      eq(documents.type, type),
      eq(documents.scope, scope),
      scopeId ? eq(documents.scopeId, scopeId) : isNull(documents.scopeId),
    ))
    .all()
  return rows.map((row) => row.id)
}

function syncMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const metadata = (value as Record<string, unknown>).syncMetadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  return metadata as Record<string, unknown>
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}
