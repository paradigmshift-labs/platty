import type {
  BuildEpicsCrossDomainKind,
  BuildEpicsCrossDomainRole,
  Confidence,
  EpicDependencyKind,
  ReviewableEpic,
  ReviewableEpicPlan,
  ValidationIssue,
} from '@/pipeline_modules/build_epics_core/types.js'

export interface EpicSyncCrossSubmission {
  links: Array<{
    sourceDocumentId: string
    targetEpicStableKey: string
    kind: BuildEpicsCrossDomainKind
    role: BuildEpicsCrossDomainRole
    confidence: Confidence
    reason: string
  }>
}

export interface EpicSyncCrossPatchResult {
  plan: ReviewableEpicPlan
  appliedLinkCount: number
  validationIssues: ValidationIssue[]
}

export function applyEpicSyncCrossPatch(input: {
  plan: ReviewableEpicPlan
  affectedDocumentIds: string[]
  submission: EpicSyncCrossSubmission
}): EpicSyncCrossPatchResult {
  const plan = clonePlan(input.plan)
  const affectedDocumentIds = new Set(input.affectedDocumentIds)
  const ownerByDocumentId = buildOwnerByDocumentId(plan.epics)
  const epicById = new Map(plan.epics.map((epic) => [epic.tempEpicId, epic]))
  const epicByStableKey = new Map(plan.epics.map((epic) => [epic.stableKey, epic]))
  const touchedEpicIds = new Set<string>()
  const validationIssues: ValidationIssue[] = []
  let appliedLinkCount = 0

  for (const documentId of affectedDocumentIds) {
    const ownerEpicId = ownerByDocumentId.get(documentId)
    if (ownerEpicId) touchedEpicIds.add(ownerEpicId)
  }

  for (const epic of plan.epics) {
    const before = epic.crossLinks.length
    epic.crossLinks = epic.crossLinks.filter((link) => !affectedDocumentIds.has(link.sourceDocumentId))
    if (epic.crossLinks.length !== before) touchedEpicIds.add(epic.tempEpicId)
  }

  const seenLinks = new Set(plan.epics.flatMap((epic) => epic.crossLinks.map((link) => crossLinkKey(link))))
  for (const link of input.submission.links) {
    if (!affectedDocumentIds.has(link.sourceDocumentId)) {
      validationIssues.push({
        severity: 'fatal',
        code: 'UNEXPECTED_SYNC_CROSS_SOURCE',
        message: `Sync cross link references unaffected document ${link.sourceDocumentId}`,
        documentId: link.sourceDocumentId,
      })
      continue
    }

    const ownerEpicId = ownerByDocumentId.get(link.sourceDocumentId)
    const ownerEpic = ownerEpicId ? epicById.get(ownerEpicId) : undefined
    if (!ownerEpic) {
      validationIssues.push({
        severity: 'fatal',
        code: 'UNKNOWN_SYNC_CROSS_SOURCE',
        message: `Sync cross link source has no owner EPIC ${link.sourceDocumentId}`,
        documentId: link.sourceDocumentId,
      })
      continue
    }

    const targetEpic = epicByStableKey.get(link.targetEpicStableKey)
    if (!targetEpic) {
      validationIssues.push({
        severity: 'fatal',
        code: 'UNKNOWN_SYNC_CROSS_TARGET',
        message: `Sync cross link references unknown target EPIC ${link.targetEpicStableKey}`,
        documentId: link.sourceDocumentId,
      })
      continue
    }

    if (ownerEpic.tempEpicId === targetEpic.tempEpicId) {
      validationIssues.push({
        severity: 'fatal',
        code: 'SELF_SYNC_CROSS_LINK',
        message: `Sync cross link target is the owner EPIC for ${link.sourceDocumentId}`,
        documentId: link.sourceDocumentId,
        tempEpicId: targetEpic.tempEpicId,
      })
      continue
    }

    const normalized = {
      sourceDocumentId: link.sourceDocumentId,
      targetTempEpicId: targetEpic.tempEpicId,
      kind: link.kind,
      role: link.role,
      confidence: link.confidence,
      reason: link.reason,
    }
    const key = crossLinkKey(normalized)
    if (seenLinks.has(key)) continue
    seenLinks.add(key)
    ownerEpic.crossLinks.push(normalized)
    touchedEpicIds.add(ownerEpic.tempEpicId)
    appliedLinkCount += 1
  }

  for (const epicId of touchedEpicIds) {
    const epic = epicById.get(epicId)
    if (epic) epic.dependencies = dependenciesFromCrossLinks(epic.crossLinks)
  }

  return {
    plan: { ...plan, validationIssues: [...plan.validationIssues, ...validationIssues] },
    appliedLinkCount,
    validationIssues,
  }
}

function buildOwnerByDocumentId(epics: ReviewableEpic[]): Map<string, string> {
  const ownerByDocumentId = new Map<string, string>()
  for (const epic of epics) {
    for (const link of epic.apiLinks) ownerByDocumentId.set(link.apiDocId, epic.tempEpicId)
    for (const link of epic.screenLinks) ownerByDocumentId.set(link.screenDocId, epic.tempEpicId)
    for (const link of epic.eventLinks) ownerByDocumentId.set(link.eventDocId, epic.tempEpicId)
    for (const link of epic.scheduleLinks) ownerByDocumentId.set(link.scheduleDocId, epic.tempEpicId)
  }
  return ownerByDocumentId
}

function dependenciesFromCrossLinks(crossLinks: ReviewableEpic['crossLinks']): ReviewableEpic['dependencies'] {
  const dependencies: ReviewableEpic['dependencies'] = []
  const seen = new Set<string>()
  for (const link of crossLinks) {
    const dependency = {
      targetTempEpicId: link.targetTempEpicId,
      kind: toDependencyKind(link.kind),
      reason: link.reason,
    }
    const key = `${dependency.targetTempEpicId}:${dependency.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    dependencies.push(dependency)
  }
  return dependencies
}

function toDependencyKind(kind: BuildEpicsCrossDomainKind): EpicDependencyKind {
  if (kind === 'event_flow') return 'event_flow'
  if (kind === 'operational_dependency') return 'external_call'
  if (kind === 'shared_user_journey') return 'cross_screen'
  return 'cross_domain_state_change'
}

function crossLinkKey(link: {
  sourceDocumentId: string
  targetTempEpicId: string
  kind: BuildEpicsCrossDomainKind
  role: BuildEpicsCrossDomainRole
}): string {
  return `${link.sourceDocumentId}:${link.targetTempEpicId}:${link.kind}:${link.role}`
}

function clonePlan(plan: ReviewableEpicPlan): ReviewableEpicPlan {
  return {
    ...plan,
    domains: plan.domains?.map((domain) => ({ ...domain, epicIds: [...domain.epicIds] })),
    epics: plan.epics.map((epic) => ({
      ...epic,
      apiLinks: epic.apiLinks.map((link) => ({ ...link })),
      screenLinks: epic.screenLinks.map((link) => ({ ...link })),
      eventLinks: epic.eventLinks.map((link) => ({ ...link })),
      scheduleLinks: epic.scheduleLinks.map((link) => ({ ...link })),
      crossLinks: epic.crossLinks.map((link) => ({ ...link })),
      dependencies: epic.dependencies.map((dependency) => ({ ...dependency })),
      sourceCandidateKeys: [...epic.sourceCandidateKeys],
    })),
    reviewBuckets: {
      unassignedApiDocIds: [...plan.reviewBuckets.unassignedApiDocIds],
      unassignedScreenDocIds: [...plan.reviewBuckets.unassignedScreenDocIds],
      unassignedEventDocIds: [...plan.reviewBuckets.unassignedEventDocIds],
      unassignedScheduleDocIds: [...plan.reviewBuckets.unassignedScheduleDocIds],
      orphanEventDocIds: [...plan.reviewBuckets.orphanEventDocIds],
      orphanScheduleDocIds: [...plan.reviewBuckets.orphanScheduleDocIds],
      unresolvedScreenApiCalls: plan.reviewBuckets.unresolvedScreenApiCalls.map((call) => ({ ...call })),
    },
    validationIssues: plan.validationIssues.map((issue) => ({ ...issue })),
    judgeResults: plan.judgeResults.map((result) => ({
      ...result,
      unsupportedClaims: result.unsupportedClaims ? [...result.unsupportedClaims] : undefined,
      critical_failures: result.critical_failures ? [...result.critical_failures] : undefined,
    })),
  }
}
