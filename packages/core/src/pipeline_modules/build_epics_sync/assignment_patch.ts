import type {
  BuildEpicsDocumentType,
  Confidence,
  ReviewableEpic,
  ReviewableEpicPlan,
  ValidationIssue,
} from '@/pipeline_modules/build_epics_core/types.js'

export type EpicSyncAssignmentAction = 'assign_existing' | 'create_epic' | 'keep_unassigned'
export type EpicSyncAssignmentRole = 'owner' | 'primary' | 'supporting' | 'event_owner' | 'job_owner'

export interface EpicSyncAssignmentSubmission {
  assignments: Array<{
    documentId: string
    documentType: BuildEpicsDocumentType
    action: EpicSyncAssignmentAction
    epicStableKey?: string | null
    role: EpicSyncAssignmentRole
    confidence: Confidence
    reason: string
    newEpic?: { stableKey: string; name: string; abbr: string; summary: string } | null
  }>
}

export interface EpicSyncAssignmentPatchResult {
  plan: ReviewableEpicPlan
  appliedDocumentIds: string[]
  validationIssues: ValidationIssue[]
}

export function applyEpicSyncAssignmentPatch(input: {
  plan: ReviewableEpicPlan
  submission: EpicSyncAssignmentSubmission
}): EpicSyncAssignmentPatchResult {
  const plan = clonePlan(input.plan)
  const appliedDocumentIds: string[] = []
  const validationIssues: ValidationIssue[] = []

  for (const assignment of input.submission.assignments) {
    if (assignment.action === 'keep_unassigned') {
      removeDocumentReferences(plan, assignment.documentId)
      addUnassignedDocument(plan, assignment.documentType, assignment.documentId)
      appliedDocumentIds.push(assignment.documentId)
      continue
    }

    if (!isValidRoleForDocumentType(assignment.documentType, assignment.role)) {
      validationIssues.push({
        severity: 'fatal',
        code: 'INVALID_SYNC_ASSIGNMENT_ROLE',
        message: `Invalid ${assignment.documentType} role ${assignment.role}`,
        documentId: assignment.documentId,
      })
      continue
    }

    const targetEpic = assignment.action === 'assign_existing'
      ? findExistingEpic(plan, assignment, validationIssues)
      : createSyncEpic(plan, assignment, validationIssues)
    if (!targetEpic) continue

    removeDocumentReferences(plan, assignment.documentId)
    addDocumentLink(targetEpic, assignment)
    targetEpic.sourceCandidateKeys = [...new Set([...targetEpic.sourceCandidateKeys, assignment.documentId])]
    appliedDocumentIds.push(assignment.documentId)
  }

  const nextPlan = {
    ...plan,
    coverage: recomputeCoverage(plan),
    validationIssues: [...plan.validationIssues, ...validationIssues],
  }

  return { plan: nextPlan, appliedDocumentIds, validationIssues }
}

function findExistingEpic(
  plan: ReviewableEpicPlan,
  assignment: EpicSyncAssignmentSubmission['assignments'][number],
  validationIssues: ValidationIssue[],
): ReviewableEpic | null {
  const targetEpic = plan.epics.find((epic) => epic.stableKey === assignment.epicStableKey)
  if (targetEpic) return targetEpic
  validationIssues.push({
    severity: 'fatal',
    code: 'UNKNOWN_SYNC_ASSIGNMENT_EPIC',
    message: `Sync assignment references unknown EPIC ${assignment.epicStableKey ?? '<missing>'}`,
    documentId: assignment.documentId,
  })
  return null
}

function createSyncEpic(
  plan: ReviewableEpicPlan,
  assignment: EpicSyncAssignmentSubmission['assignments'][number],
  validationIssues: ValidationIssue[],
): ReviewableEpic | null {
  const newEpic = assignment.newEpic
  if (!newEpic?.stableKey || !newEpic.name || !newEpic.abbr || !newEpic.summary) {
    validationIssues.push({
      severity: 'fatal',
      code: 'INVALID_SYNC_NEW_EPIC',
      message: `Sync assignment for ${assignment.documentId} is missing new EPIC metadata`,
      documentId: assignment.documentId,
    })
    return null
  }

  const tempEpicId = `epic:sync:${newEpic.stableKey}`
  if (plan.epics.some((epic) => epic.tempEpicId === tempEpicId || epic.stableKey === newEpic.stableKey)) {
    validationIssues.push({
      severity: 'fatal',
      code: 'DUPLICATE_SYNC_EPIC',
      message: `Sync assignment would create duplicate EPIC ${newEpic.stableKey}`,
      documentId: assignment.documentId,
    })
    return null
  }

  const epic: ReviewableEpic = {
    tempEpicId,
    stableKey: newEpic.stableKey,
    name: newEpic.name,
    abbr: newEpic.abbr,
    summary: newEpic.summary,
    status: 'reviewable',
    confidence: assignment.confidence,
    apiLinks: [],
    screenLinks: [],
    eventLinks: [],
    scheduleLinks: [],
    crossLinks: [],
    dependencies: [],
    sourceCandidateKeys: [newEpic.stableKey],
  }
  plan.epics.push(epic)
  return epic
}

function addDocumentLink(
  epic: ReviewableEpic,
  assignment: EpicSyncAssignmentSubmission['assignments'][number],
): void {
  const link = { confidence: assignment.confidence, reason: assignment.reason }
  if (assignment.documentType === 'api_spec') {
    epic.apiLinks.push({ ...link, apiDocId: assignment.documentId, role: 'owner' })
    return
  }
  if (assignment.documentType === 'screen_spec') {
    epic.screenLinks.push({
      ...link,
      screenDocId: assignment.documentId,
      role: assignment.role === 'supporting' ? 'supporting' : 'primary',
    })
    return
  }
  if (assignment.documentType === 'event_spec') {
    epic.eventLinks.push({ ...link, eventDocId: assignment.documentId, role: 'event_owner' })
    return
  }
  epic.scheduleLinks.push({ ...link, scheduleDocId: assignment.documentId, role: 'job_owner' })
}

function removeDocumentReferences(plan: ReviewableEpicPlan, documentId: string): void {
  for (const epic of plan.epics) {
    epic.apiLinks = epic.apiLinks.filter((link) => link.apiDocId !== documentId)
    epic.screenLinks = epic.screenLinks.filter((link) => link.screenDocId !== documentId)
    epic.eventLinks = epic.eventLinks.filter((link) => link.eventDocId !== documentId)
    epic.scheduleLinks = epic.scheduleLinks.filter((link) => link.scheduleDocId !== documentId)
  }
  plan.reviewBuckets.unassignedApiDocIds = withoutDocumentId(plan.reviewBuckets.unassignedApiDocIds, documentId)
  plan.reviewBuckets.unassignedScreenDocIds = withoutDocumentId(plan.reviewBuckets.unassignedScreenDocIds, documentId)
  plan.reviewBuckets.unassignedEventDocIds = withoutDocumentId(plan.reviewBuckets.unassignedEventDocIds, documentId)
  plan.reviewBuckets.unassignedScheduleDocIds = withoutDocumentId(plan.reviewBuckets.unassignedScheduleDocIds, documentId)
  plan.reviewBuckets.orphanEventDocIds = withoutDocumentId(plan.reviewBuckets.orphanEventDocIds, documentId)
  plan.reviewBuckets.orphanScheduleDocIds = withoutDocumentId(plan.reviewBuckets.orphanScheduleDocIds, documentId)
}

function addUnassignedDocument(plan: ReviewableEpicPlan, documentType: BuildEpicsDocumentType, documentId: string): void {
  if (documentType === 'api_spec') {
    plan.reviewBuckets.unassignedApiDocIds = addUnique(plan.reviewBuckets.unassignedApiDocIds, documentId)
  } else if (documentType === 'screen_spec') {
    plan.reviewBuckets.unassignedScreenDocIds = addUnique(plan.reviewBuckets.unassignedScreenDocIds, documentId)
  } else if (documentType === 'event_spec') {
    plan.reviewBuckets.unassignedEventDocIds = addUnique(plan.reviewBuckets.unassignedEventDocIds, documentId)
  } else {
    plan.reviewBuckets.unassignedScheduleDocIds = addUnique(plan.reviewBuckets.unassignedScheduleDocIds, documentId)
  }
}

function isValidRoleForDocumentType(documentType: BuildEpicsDocumentType, role: EpicSyncAssignmentRole): boolean {
  if (documentType === 'api_spec') return role === 'owner'
  if (documentType === 'screen_spec') return role === 'owner' || role === 'primary' || role === 'supporting'
  if (documentType === 'event_spec') return role === 'owner' || role === 'event_owner'
  return role === 'owner' || role === 'job_owner'
}

function recomputeCoverage(plan: ReviewableEpicPlan): ReviewableEpicPlan['coverage'] {
  const assignedApiDocs = new Set(
    plan.epics.flatMap((epic) => epic.apiLinks.filter((link) => link.role === 'owner').map((link) => link.apiDocId)),
  ).size
  const visibleApiDocs = assignedApiDocs + new Set(plan.reviewBuckets.unassignedApiDocIds).size
  return {
    assignedApiDocs,
    totalApiDocs: Math.max(plan.coverage.totalApiDocs, visibleApiDocs),
  }
}

function withoutDocumentId(documentIds: string[], documentId: string): string[] {
  return documentIds.filter((candidate) => candidate !== documentId)
}

function addUnique(documentIds: string[], documentId: string): string[] {
  return documentIds.includes(documentId) ? documentIds : [...documentIds, documentId]
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
