import type { ReviewableEpic, ReviewableEpicPlan } from '@/pipeline_modules/build_epics_core/types.js'

export interface EpicSyncCleanupResult {
  plan: ReviewableEpicPlan
  removedDocumentIds: string[]
  removedEpicIds: string[]
}

export function applyEpicSyncCleanup(input: { plan: ReviewableEpicPlan; deletedDocumentIds: string[] }): EpicSyncCleanupResult {
  const removedDocumentIds = [...new Set(input.deletedDocumentIds)]
  const removedDocumentIdSet = new Set(removedDocumentIds)
  const originalApiDocIds = new Set([
    ...input.plan.epics.flatMap((epic) => epic.apiLinks.map((link) => link.apiDocId)),
    ...input.plan.reviewBuckets.unassignedApiDocIds,
  ])

  const cleanedEpics = input.plan.epics.map((epic) => cleanEpicDocumentLinks(epic, removedDocumentIdSet))
  const removedEpicIds = cleanedEpics.filter((epic) => !hasOwnerAnchor(epic)).map((epic) => epic.tempEpicId)
  const removedEpicIdSet = new Set(removedEpicIds)
  const epics = cleanedEpics
    .filter((epic) => !removedEpicIdSet.has(epic.tempEpicId))
    .map((epic) => ({
      ...epic,
      crossLinks: epic.crossLinks.filter((link) => !removedEpicIdSet.has(link.targetTempEpicId)).map((link) => ({ ...link })),
      dependencies: epic.dependencies.filter((dependency) => !removedEpicIdSet.has(dependency.targetTempEpicId)).map((dependency) => ({ ...dependency })),
    }))

  const removedApiDocCount = removedDocumentIds.filter((documentId) => originalApiDocIds.has(documentId)).length
  const assignedApiDocs = new Set(
    epics.flatMap((epic) => epic.apiLinks.filter((link) => link.role === 'owner').map((link) => link.apiDocId)),
  ).size

  return {
    plan: {
      ...input.plan,
      domains: input.plan.domains
        ?.map((domain) => ({
          ...domain,
          epicIds: domain.epicIds.filter((epicId) => !removedEpicIdSet.has(epicId)),
        }))
        .filter((domain) => domain.epicIds.length > 0),
      epics,
      reviewBuckets: {
        unassignedApiDocIds: removeDeletedDocumentIds(input.plan.reviewBuckets.unassignedApiDocIds, removedDocumentIdSet),
        unassignedScreenDocIds: removeDeletedDocumentIds(input.plan.reviewBuckets.unassignedScreenDocIds, removedDocumentIdSet),
        unassignedEventDocIds: removeDeletedDocumentIds(input.plan.reviewBuckets.unassignedEventDocIds, removedDocumentIdSet),
        unassignedScheduleDocIds: removeDeletedDocumentIds(input.plan.reviewBuckets.unassignedScheduleDocIds, removedDocumentIdSet),
        orphanEventDocIds: removeDeletedDocumentIds(input.plan.reviewBuckets.orphanEventDocIds, removedDocumentIdSet),
        orphanScheduleDocIds: removeDeletedDocumentIds(input.plan.reviewBuckets.orphanScheduleDocIds, removedDocumentIdSet),
        unresolvedScreenApiCalls: input.plan.reviewBuckets.unresolvedScreenApiCalls
          // ScreenApiResolution has no source screen id, so null resolvedApiDocId calls cannot be tied to a deleted screen.
          .filter((call) => !call.resolvedApiDocId || !removedDocumentIdSet.has(call.resolvedApiDocId))
          .map((call) => ({ ...call })),
      },
      coverage: {
        assignedApiDocs,
        totalApiDocs: Math.max(0, input.plan.coverage.totalApiDocs - removedApiDocCount),
      },
      validationIssues: input.plan.validationIssues
        .filter((issue) =>
          (!issue.documentId || !removedDocumentIdSet.has(issue.documentId))
          && (!issue.tempEpicId || !removedEpicIdSet.has(issue.tempEpicId)))
        .map((issue) => ({ ...issue })),
      judgeResults: input.plan.judgeResults.map((result) => ({
        ...result,
        unsupportedClaims: result.unsupportedClaims ? [...result.unsupportedClaims] : undefined,
        critical_failures: result.critical_failures ? [...result.critical_failures] : undefined,
      })),
    },
    removedDocumentIds,
    removedEpicIds,
  }
}

function cleanEpicDocumentLinks(epic: ReviewableEpic, removedDocumentIdSet: Set<string>): ReviewableEpic {
  return {
    ...epic,
    apiLinks: epic.apiLinks.filter((link) => !removedDocumentIdSet.has(link.apiDocId)).map((link) => ({ ...link })),
    screenLinks: epic.screenLinks.filter((link) => !removedDocumentIdSet.has(link.screenDocId)).map((link) => ({ ...link })),
    eventLinks: epic.eventLinks.filter((link) => !removedDocumentIdSet.has(link.eventDocId)).map((link) => ({ ...link })),
    scheduleLinks: epic.scheduleLinks.filter((link) => !removedDocumentIdSet.has(link.scheduleDocId)).map((link) => ({ ...link })),
    crossLinks: epic.crossLinks.filter((link) => !removedDocumentIdSet.has(link.sourceDocumentId)).map((link) => ({ ...link })),
    dependencies: epic.dependencies.map((dependency) => ({ ...dependency })),
    sourceCandidateKeys: [...epic.sourceCandidateKeys],
  }
}

function hasOwnerAnchor(epic: ReviewableEpic) {
  return epic.apiLinks.some((link) => link.role === 'owner')
    || epic.screenLinks.some((link) => link.role === 'primary')
    || epic.eventLinks.some((link) => link.role === 'event_owner')
    || epic.scheduleLinks.some((link) => link.role === 'job_owner')
}

function removeDeletedDocumentIds(documentIds: string[], removedDocumentIdSet: Set<string>) {
  return documentIds.filter((documentId) => !removedDocumentIdSet.has(documentId))
}
