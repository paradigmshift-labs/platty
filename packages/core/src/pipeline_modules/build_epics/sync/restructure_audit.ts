import type { BuildEpicsDocumentType, ReviewableEpic, ReviewableEpicPlan } from '@/pipeline_modules/build_epics/core/types.js'
import type { EpicSyncDocumentImpact } from './impact.js'

export interface EpicRestructureThresholds {
  newCoreDocsPerEpicTriggerAt: number
  totalCoreDocsPerEpicReviewAt: number
  newBackendApisPerEpicTriggerAt: number
  newPrimaryScreensPerEpicTriggerAt: number
  screenConnectedOwnerEpicsTriggerAt: number
  docConnectedOwnerEpicsTriggerAt: number
  newCrossRepoEdgesPerEpicTriggerAt: number
  minIndependentClusters: number
}

export type EpicRestructureReasonCode =
  | 'TOO_MANY_NEW_CORE_DOCS'
  | 'TOO_MANY_CORE_DOCS'
  | 'BACKEND_APIS_EXPAND_SINGLE_EPIC'
  | 'FRONTEND_SCREENS_EXPAND_SINGLE_EPIC'
  | 'FRONTEND_SCREEN_SPANS_MULTIPLE_EPICS'
  | 'DOC_CONNECTS_MULTIPLE_EPICS'
  | 'SERVICE_MAP_SUGGESTS_SPLIT'
  | 'SERVICE_MAP_SUGGESTS_MERGE'

export interface EpicRestructureTopologyLink {
  sourceDocumentId: string
  targetDocumentId: string
  kind: string
  clusterHints?: string[]
  sourceRepoId?: string | null
  targetRepoId?: string | null
}

export interface EpicRestructureReason {
  code: EpicRestructureReasonCode
  epicStableKey?: string
  documentId?: string
  documentIds: string[]
  count: number
  threshold: number
  independentClusterCount?: number
  connectedEpicStableKeys?: string[]
}

export type EpicRestructureAuditResult =
  | { action: 'no_change'; taskRequired: false; reasons: [] }
  | { action: 'restructure_required'; taskRequired: true; reasons: EpicRestructureReason[] }

export function defaultEpicRestructureThresholds(): EpicRestructureThresholds {
  return {
    newCoreDocsPerEpicTriggerAt: 5,
    totalCoreDocsPerEpicReviewAt: 13,
    newBackendApisPerEpicTriggerAt: 4,
    newPrimaryScreensPerEpicTriggerAt: 3,
    screenConnectedOwnerEpicsTriggerAt: 3,
    docConnectedOwnerEpicsTriggerAt: 3,
    newCrossRepoEdgesPerEpicTriggerAt: 6,
    minIndependentClusters: 2,
  }
}

export function deriveEpicRestructureAudit(input: {
  plan: ReviewableEpicPlan
  impacts: EpicSyncDocumentImpact[]
  topologyLinks?: EpicRestructureTopologyLink[]
  thresholds?: EpicRestructureThresholds
}): EpicRestructureAuditResult {
  const thresholds = input.thresholds ?? defaultEpicRestructureThresholds()
  const impactByDocumentId = new Map(input.impacts.map((impact) => [impact.documentId, impact]))
  const ownerByDocumentId = buildOwnerByDocumentId(input.plan.epics)
  const reasons: EpicRestructureReason[] = []

  for (const epic of input.plan.epics) {
    const coreDocs = coreDocumentsForEpic(epic)
    const newCoreDocs = coreDocs.filter((doc) => impactByDocumentId.get(doc.documentId)?.kind === 'new')
    const newBackendApis = newCoreDocs.filter((doc) => doc.documentType === 'api_spec')
    const newPrimaryScreens = newCoreDocs.filter((doc) => doc.documentType === 'screen_spec')
    const independentClusterCount = countIndependentClusters(newCoreDocs.map((doc) => impactByDocumentId.get(doc.documentId)))

    if (newCoreDocs.length >= thresholds.newCoreDocsPerEpicTriggerAt) {
      reasons.push(reason({
        code: 'TOO_MANY_NEW_CORE_DOCS',
        epicStableKey: epic.stableKey,
        docs: newCoreDocs.map((doc) => doc.documentId),
        threshold: thresholds.newCoreDocsPerEpicTriggerAt,
        independentClusterCount,
      }))
    }

    if (coreDocs.length >= thresholds.totalCoreDocsPerEpicReviewAt) {
      reasons.push(reason({
        code: 'TOO_MANY_CORE_DOCS',
        epicStableKey: epic.stableKey,
        docs: coreDocs.map((doc) => doc.documentId),
        threshold: thresholds.totalCoreDocsPerEpicReviewAt,
        independentClusterCount,
      }))
    }

    if (newBackendApis.length >= thresholds.newBackendApisPerEpicTriggerAt) {
      reasons.push(reason({
        code: 'BACKEND_APIS_EXPAND_SINGLE_EPIC',
        epicStableKey: epic.stableKey,
        docs: newBackendApis.map((doc) => doc.documentId),
        threshold: thresholds.newBackendApisPerEpicTriggerAt,
        independentClusterCount,
      }))
    }

    if (newPrimaryScreens.length >= thresholds.newPrimaryScreensPerEpicTriggerAt) {
      reasons.push(reason({
        code: 'FRONTEND_SCREENS_EXPAND_SINGLE_EPIC',
        epicStableKey: epic.stableKey,
        docs: newPrimaryScreens.map((doc) => doc.documentId),
        threshold: thresholds.newPrimaryScreensPerEpicTriggerAt,
        independentClusterCount,
      }))
    }

    const newCrossRepoEdges = (input.topologyLinks ?? []).filter((link) =>
      isCrossRepo(link)
      && coreDocs.some((doc) => doc.documentId === link.sourceDocumentId || doc.documentId === link.targetDocumentId)
      && newCoreDocs.some((doc) => doc.documentId === link.sourceDocumentId || doc.documentId === link.targetDocumentId),
    )
    if (newCrossRepoEdges.length >= thresholds.newCrossRepoEdgesPerEpicTriggerAt) {
      reasons.push(reason({
        code: 'SERVICE_MAP_SUGGESTS_SPLIT',
        epicStableKey: epic.stableKey,
        docs: uniqueStrings(newCrossRepoEdges.flatMap((link) => [link.sourceDocumentId, link.targetDocumentId])),
        threshold: thresholds.newCrossRepoEdgesPerEpicTriggerAt,
        independentClusterCount: countTopologyClusters(newCrossRepoEdges),
      }))
    }
  }

  for (const impact of input.impacts.filter((item) => item.kind === 'new')) {
    const connectedEpicStableKeys = connectedOwnerEpicsForDocument(impact.documentId, input.topologyLinks ?? [], ownerByDocumentId)
    if (connectedEpicStableKeys.length >= thresholds.docConnectedOwnerEpicsTriggerAt) {
      reasons.push(reason({
        code: impact.documentType === 'screen_spec' ? 'FRONTEND_SCREEN_SPANS_MULTIPLE_EPICS' : 'DOC_CONNECTS_MULTIPLE_EPICS',
        documentId: impact.documentId,
        docs: [impact.documentId],
        threshold: impact.documentType === 'screen_spec'
          ? thresholds.screenConnectedOwnerEpicsTriggerAt
          : thresholds.docConnectedOwnerEpicsTriggerAt,
        connectedEpicStableKeys,
        independentClusterCount: connectedEpicStableKeys.length,
      }))
    } else if (
      impact.documentType === 'screen_spec'
      && connectedEpicStableKeys.length >= thresholds.screenConnectedOwnerEpicsTriggerAt
    ) {
      reasons.push(reason({
        code: 'FRONTEND_SCREEN_SPANS_MULTIPLE_EPICS',
        documentId: impact.documentId,
        docs: [impact.documentId],
        threshold: thresholds.screenConnectedOwnerEpicsTriggerAt,
        connectedEpicStableKeys,
        independentClusterCount: connectedEpicStableKeys.length,
      }))
    }
  }

  const uniqueReasons = dedupeReasons(reasons)
  if (uniqueReasons.length === 0) return { action: 'no_change', taskRequired: false, reasons: [] }
  return { action: 'restructure_required', taskRequired: true, reasons: uniqueReasons }
}

function coreDocumentsForEpic(epic: ReviewableEpic): Array<{ documentId: string; documentType: BuildEpicsDocumentType }> {
  return [
    ...epic.apiLinks
      .filter((link) => link.role === 'owner')
      .map((link) => ({ documentId: link.apiDocId, documentType: 'api_spec' as const })),
    ...epic.screenLinks
      .filter((link) => link.role === 'primary')
      .map((link) => ({ documentId: link.screenDocId, documentType: 'screen_spec' as const })),
    ...epic.eventLinks
      .filter((link) => link.role === 'event_owner')
      .map((link) => ({ documentId: link.eventDocId, documentType: 'event_spec' as const })),
    ...epic.scheduleLinks
      .filter((link) => link.role === 'job_owner')
      .map((link) => ({ documentId: link.scheduleDocId, documentType: 'schedule_spec' as const })),
  ]
}

function buildOwnerByDocumentId(epics: ReviewableEpic[]): Map<string, string> {
  const ownerByDocumentId = new Map<string, string>()
  for (const epic of epics) {
    for (const doc of coreDocumentsForEpic(epic)) ownerByDocumentId.set(doc.documentId, epic.stableKey)
  }
  return ownerByDocumentId
}

function connectedOwnerEpicsForDocument(
  documentId: string,
  topologyLinks: EpicRestructureTopologyLink[],
  ownerByDocumentId: Map<string, string>,
): string[] {
  const stableKeys = new Set<string>()
  for (const link of topologyLinks) {
    const otherDocumentId = link.sourceDocumentId === documentId
      ? link.targetDocumentId
      : link.targetDocumentId === documentId ? link.sourceDocumentId : null
    if (!otherDocumentId) continue
    const stableKey = ownerByDocumentId.get(otherDocumentId)
    if (stableKey) stableKeys.add(stableKey)
  }
  return [...stableKeys].sort()
}

function countIndependentClusters(impacts: Array<EpicSyncDocumentImpact | undefined>): number {
  const clusters = new Set<string>()
  for (const impact of impacts) {
    if (!impact) continue
    for (const hint of [...(impact.domainHints ?? []), ...(impact.relationTargets ?? [])]) {
      const normalized = hint.trim().toLowerCase()
      if (normalized) clusters.add(normalized)
    }
  }
  return clusters.size
}

function countTopologyClusters(topologyLinks: EpicRestructureTopologyLink[]): number {
  const clusters = new Set<string>()
  for (const link of topologyLinks) {
    for (const hint of link.clusterHints ?? []) {
      const normalized = hint.trim().toLowerCase()
      if (normalized) clusters.add(normalized)
    }
  }
  return clusters.size
}

function isCrossRepo(link: EpicRestructureTopologyLink): boolean {
  return Boolean(link.sourceRepoId && link.targetRepoId && link.sourceRepoId !== link.targetRepoId)
}

function reason(input: {
  code: EpicRestructureReasonCode
  epicStableKey?: string
  documentId?: string
  docs: string[]
  threshold: number
  independentClusterCount?: number
  connectedEpicStableKeys?: string[]
}): EpicRestructureReason {
  return {
    code: input.code,
    ...(input.epicStableKey ? { epicStableKey: input.epicStableKey } : {}),
    ...(input.documentId ? { documentId: input.documentId } : {}),
    documentIds: input.docs,
    count: input.docs.length,
    threshold: input.threshold,
    ...(input.independentClusterCount != null ? { independentClusterCount: input.independentClusterCount } : {}),
    ...(input.connectedEpicStableKeys ? { connectedEpicStableKeys: input.connectedEpicStableKeys } : {}),
  }
}

function dedupeReasons(reasons: EpicRestructureReason[]): EpicRestructureReason[] {
  const seen = new Set<string>()
  const result: EpicRestructureReason[] = []
  for (const reason of reasons) {
    const key = `${reason.code}:${reason.epicStableKey ?? ''}:${reason.documentId ?? ''}:${reason.documentIds.join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(reason)
  }
  return result
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort()
}
