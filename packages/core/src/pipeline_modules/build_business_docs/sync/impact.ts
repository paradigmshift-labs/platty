import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { documents } from '@/db/schema/build_docs.js'
import { epics } from '@/db/schema/core.js'
import type {
  BusinessDocsSourceHashResult,
  BusinessDocsSyncOrphanPreview,
  BusinessDocsSyncPreviewSummary,
  BusinessDocsSyncTargetDocType,
  BusinessDocsSyncTargetPreview,
} from './types.js'

const BUSINESS_SYNC_DOC_TYPES = ['design', 'data_dictionary', 'br', 'ucl', 'glossary'] as const satisfies BusinessDocsSyncTargetDocType[]
const SOURCE_FIRST_DOC_TYPES = ['design', 'data_dictionary', 'br', 'ucl'] as const satisfies BusinessDocsSyncTargetDocType[]

export interface BusinessDocsSyncImpactResult {
  summary: BusinessDocsSyncPreviewSummary
  targets: BusinessDocsSyncTargetPreview[]
  orphanedTargets: BusinessDocsSyncOrphanPreview[]
}

export function deriveBusinessDocsSyncImpact(
  db: DB,
  input: { projectId: string; sourceHashes: BusinessDocsSourceHashResult; targetScopeEpicIds?: string[]; orphanScopeEpicIds?: string[] },
): BusinessDocsSyncImpactResult {
  const existingBusinessDocs = db.select().from(documents).where(and(
    eq(documents.projectId, input.projectId),
    eq(documents.track, 'business'),
    eq(documents.status, 'active'),
    inArray(documents.type, BUSINESS_SYNC_DOC_TYPES),
  )).all()
  const confirmedEpicIds = new Set(db.select({ id: epics.id }).from(epics).where(and(
    eq(epics.projectId, input.projectId),
    isNotNull(epics.confirmedAt),
    isNull(epics.deletedAt),
  )).all().map((epic) => epic.id))

  const existingByKey = new Map(existingBusinessDocs
    .filter((document) => isBusinessSyncDocType(document.type) && isSyncScope(document.scope) && document.scopeId)
    .map((document) => [targetKey(document.scope as 'epic' | 'project', document.scopeId!, document.type), document]))
  const targetScopeEpicIds = input.targetScopeEpicIds
    ? new Set(input.targetScopeEpicIds)
    : null
  const visibleHashTargets = input.sourceHashes.targets.filter((target) => {
    if (!targetScopeEpicIds) return true
    if (target.scope === 'project') return targetScopeEpicIds.size > 0
    return target.epicId !== null && targetScopeEpicIds.has(target.epicId)
  })
  const computedTargetKeys = new Set(input.sourceHashes.targets.map((target) => target.key))
  const orphanScopeEpicIds = input.orphanScopeEpicIds
    ? new Set(input.orphanScopeEpicIds)
    : null

  const targets = visibleHashTargets.map((target): BusinessDocsSyncTargetPreview => {
    const existing = existingByKey.get(target.key)
    const sourceDocumentCount = Array.isArray(target.sourceInputs.sourceDocuments)
      ? target.sourceInputs.sourceDocuments.length
      : null
    if (target.scope === 'epic' && sourceDocumentCount === 0) {
      return {
        ...target,
        state: 'blocked',
        reason: 'no_source_documents',
        existingDocumentId: existing?.id ?? null,
        existingDocumentSourceHash: existing?.documentSourceHash ?? null,
        taskPlanned: false,
      }
    }
    if (!existing) {
      return {
        ...target,
        state: 'missing',
        reason: 'missing_document',
        existingDocumentId: null,
        existingDocumentSourceHash: null,
        taskPlanned: false,
      }
    }
    if (existing.documentSourceHash === target.sourceHash) {
      return {
        ...target,
        state: 'fresh',
        reason: 'source_hash_match',
        existingDocumentId: existing.id,
        existingDocumentSourceHash: existing.documentSourceHash,
        taskPlanned: false,
      }
    }
    return {
      ...target,
      state: 'stale',
      reason: 'source_changed',
      existingDocumentId: existing.id,
      existingDocumentSourceHash: existing.documentSourceHash,
      taskPlanned: false,
    }
  })

  markTaskPlan(targets)

  const orphanedTargets = existingBusinessDocs
    .filter((document) => isBusinessSyncDocType(document.type) && isSyncScope(document.scope) && document.scopeId)
    .filter((document) => document.scope !== 'epic' || orphanScopeEpicIds === null || orphanScopeEpicIds.has(document.scopeId!))
    .filter((document) => !computedTargetKeys.has(targetKey(document.scope as 'epic' | 'project', document.scopeId!, document.type)))
    .map((document): BusinessDocsSyncOrphanPreview => ({
      documentId: document.id,
      key: targetKey(document.scope as 'epic' | 'project', document.scopeId!, document.type as BusinessDocsSyncTargetDocType),
      documentType: document.type as BusinessDocsSyncTargetDocType,
      scope: document.scope as 'epic' | 'project',
      scopeId: document.scopeId!,
      epicId: document.scope === 'epic' ? document.scopeId! : null,
      state: 'orphaned',
      reason: document.scope === 'epic' && !confirmedEpicIds.has(document.scopeId!)
        ? 'epic_missing_or_unconfirmed'
        : 'source_target_missing',
    }))
    .sort((a, b) => a.key.localeCompare(b.key))

  for (const target of targets) {
    if (target.state !== 'blocked' || !target.existingDocumentId) continue
    orphanedTargets.push({
      documentId: target.existingDocumentId,
      key: target.key,
      documentType: target.documentType,
      scope: target.scope,
      scopeId: target.scopeId,
      epicId: target.epicId,
      state: 'orphaned',
      reason: 'source_target_missing',
    })
  }
  orphanedTargets.sort((a, b) => a.key.localeCompare(b.key))

  return {
    summary: {
      fresh: targets.filter((target) => target.state === 'fresh').length,
      missing: targets.filter((target) => target.state === 'missing').length,
      stale: targets.filter((target) => target.state === 'stale').length,
      orphaned: orphanedTargets.length,
      blocked: targets.filter((target) => target.state === 'blocked').length,
      tasksPlanned: targets.reduce((total, target) => total + taskCount(target), 0),
    },
    targets,
    orphanedTargets,
  }
}

function markTaskPlan(targets: BusinessDocsSyncTargetPreview[]): void {
  for (const target of targets) {
    if (target.state === 'fresh' || target.state === 'blocked') continue
    if (SOURCE_FIRST_DOC_TYPES.includes(target.documentType as typeof SOURCE_FIRST_DOC_TYPES[number])) {
      target.taskPlanned = true
    }
  }

  for (const target of targets) {
    if (target.documentType !== 'glossary' || target.scope !== 'epic') continue
    if (target.state === 'fresh' || target.state === 'blocked') continue
    const hasUpstreamWorkOrDoc = targets.some((candidate) =>
      candidate.scope === 'epic' &&
      candidate.scopeId === target.scopeId &&
      candidate.documentType !== 'glossary' &&
      (candidate.taskPlanned || candidate.state === 'fresh'))
    target.taskPlanned = hasUpstreamWorkOrDoc
  }

  for (const target of targets) {
    if (target.documentType !== 'glossary' || target.scope !== 'project') continue
    if (target.state === 'fresh' || target.state === 'blocked') continue
    target.taskPlanned = targets.some((candidate) =>
      candidate.scope === 'epic' &&
      candidate.documentType === 'glossary' &&
      (candidate.taskPlanned || candidate.state === 'fresh'))
  }
}

function taskCount(target: BusinessDocsSyncTargetPreview): number {
  if (!target.taskPlanned) return 0
  return target.documentType === 'ucl' ? 2 : 1
}

function targetKey(scope: 'epic' | 'project', scopeId: string, documentType: string): string {
  return `${scope}:${scopeId}:${documentType}`
}

function isBusinessSyncDocType(value: string): value is BusinessDocsSyncTargetDocType {
  return BUSINESS_SYNC_DOC_TYPES.includes(value as BusinessDocsSyncTargetDocType)
}

function isSyncScope(value: string): value is 'epic' | 'project' {
  return value === 'epic' || value === 'project'
}
