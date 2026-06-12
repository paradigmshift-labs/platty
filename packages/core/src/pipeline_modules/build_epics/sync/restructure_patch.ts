import type {
  BuildEpicsDocumentType,
  Confidence,
  ReviewableEpic,
  ReviewableEpicPlan,
  ValidationIssue,
} from '@/pipeline_modules/build_epics/core/types.js'

export interface EpicSyncRestructureNewEpic {
  stableKey: string
  name: string
  abbr: string
  summary: string
}

export interface EpicSyncRestructureMove {
  documentId: string
  documentType: BuildEpicsDocumentType
  fromEpicStableKey?: string
  toEpicStableKey: string
  role: string
  reason: string
}

export type EpicSyncRestructureAction =
  | { type: 'no_change'; reason: string }
  | { type: 'split_epic'; sourceEpicStableKey: string; newEpics: EpicSyncRestructureNewEpic[]; moves: EpicSyncRestructureMove[]; reason: string }
  | { type: 'merge_epics'; sourceEpicStableKeys: string[]; targetEpic: EpicSyncRestructureNewEpic; moves: EpicSyncRestructureMove[]; reason: string }
  | { type: 'move_document'; documentId: string; documentType: BuildEpicsDocumentType; fromEpicStableKey?: string; toEpicStableKey: string; role: string; reason: string }

export interface EpicSyncRestructureSubmission {
  actions: EpicSyncRestructureAction[]
}

export interface EpicSyncRestructurePatchResult {
  plan: ReviewableEpicPlan
  validationIssues: ValidationIssue[]
}

export function applyEpicSyncRestructurePatch(input: {
  plan: ReviewableEpicPlan
  submission: EpicSyncRestructureSubmission
}): EpicSyncRestructurePatchResult {
  const plan = clonePlan(input.plan)
  const validationIssues: ValidationIssue[] = []

  for (const action of input.submission.actions) {
    if (action.type === 'no_change') continue
    if (action.type === 'split_epic') {
      applyNewEpics(plan, action.newEpics, validationIssues)
      for (const move of action.moves) applyMove(plan, move, validationIssues)
      markSourceEpicsForReview(plan, [action.sourceEpicStableKey])
      continue
    }
    if (action.type === 'merge_epics') {
      applyNewEpics(plan, [action.targetEpic], validationIssues)
      for (const move of action.moves) applyMove(plan, move, validationIssues)
      markSourceEpicsForReview(plan, action.sourceEpicStableKeys)
      continue
    }
    applyMove(plan, action, validationIssues)
  }

  const nextPlan = {
    ...plan,
    coverage: recomputeCoverage(plan),
    validationIssues: [...plan.validationIssues, ...validationIssues],
  }
  return { plan: nextPlan, validationIssues }
}

function applyNewEpics(
  plan: ReviewableEpicPlan,
  newEpics: EpicSyncRestructureNewEpic[],
  validationIssues: ValidationIssue[],
): void {
  for (const newEpic of newEpics) {
    if (!newEpic.stableKey || !newEpic.name || !newEpic.abbr || !newEpic.summary) {
      validationIssues.push({
        severity: 'fatal',
        code: 'INVALID_SYNC_RESTRUCTURE_EPIC',
        message: 'Restructure EPIC metadata is incomplete.',
      })
      continue
    }
    if (plan.epics.some((epic) => epic.stableKey === newEpic.stableKey || epic.tempEpicId === `epic:sync:${newEpic.stableKey}`)) {
      validationIssues.push({
        severity: 'fatal',
        code: 'DUPLICATE_SYNC_RESTRUCTURE_EPIC',
        message: `Restructure would create duplicate EPIC ${newEpic.stableKey}`,
      })
      continue
    }
    plan.epics.push({
      tempEpicId: `epic:sync:${newEpic.stableKey}`,
      stableKey: newEpic.stableKey,
      name: newEpic.name,
      abbr: newEpic.abbr,
      summary: newEpic.summary,
      status: 'needs_review',
      confidence: 'medium',
      apiLinks: [],
      screenLinks: [],
      eventLinks: [],
      scheduleLinks: [],
      crossLinks: [],
      dependencies: [],
      sourceCandidateKeys: [newEpic.stableKey],
    })
  }
}

function applyMove(
  plan: ReviewableEpicPlan,
  move: EpicSyncRestructureMove,
  validationIssues: ValidationIssue[],
): void {
  const targetEpic = plan.epics.find((epic) => epic.stableKey === move.toEpicStableKey)
  if (!targetEpic) {
    validationIssues.push({
      severity: 'fatal',
      code: 'UNKNOWN_SYNC_RESTRUCTURE_TARGET_EPIC',
      message: `Restructure references unknown target EPIC ${move.toEpicStableKey}`,
      documentId: move.documentId,
    })
    return
  }
  if (!isValidRoleForDocumentType(move.documentType, move.role)) {
    validationIssues.push({
      severity: 'fatal',
      code: 'INVALID_SYNC_RESTRUCTURE_ROLE',
      message: `Invalid ${move.documentType} role ${move.role}`,
      documentId: move.documentId,
    })
    return
  }

  removeDocumentReferences(plan, move.documentId)
  addDocumentLink(targetEpic, move)
  targetEpic.status = 'needs_review'
  targetEpic.sourceCandidateKeys = [...new Set([...targetEpic.sourceCandidateKeys, move.documentId])]
}

function markSourceEpicsForReview(plan: ReviewableEpicPlan, stableKeys: string[]): void {
  for (const stableKey of stableKeys) {
    const epic = plan.epics.find((candidate) => candidate.stableKey === stableKey)
    if (epic) epic.status = 'needs_review'
  }
}

function addDocumentLink(epic: ReviewableEpic, move: EpicSyncRestructureMove): void {
  const link = { confidence: 'medium' as Confidence, reason: move.reason }
  if (move.documentType === 'api_spec') {
    epic.apiLinks.push({ ...link, apiDocId: move.documentId, role: 'owner' })
  } else if (move.documentType === 'screen_spec') {
    epic.screenLinks.push({
      ...link,
      screenDocId: move.documentId,
      role: move.role === 'supporting' ? 'supporting' : 'primary',
    })
  } else if (move.documentType === 'event_spec') {
    epic.eventLinks.push({ ...link, eventDocId: move.documentId, role: 'event_owner' })
  } else {
    epic.scheduleLinks.push({ ...link, scheduleDocId: move.documentId, role: 'job_owner' })
  }
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
}

function isValidRoleForDocumentType(documentType: BuildEpicsDocumentType, role: string): boolean {
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
