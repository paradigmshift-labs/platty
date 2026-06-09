import type {
  BuildEpicsDocIndex,
  Confidence,
  ReviewableDomain,
  ReviewableEpic,
  ReviewableEpicPlan,
  ValidationIssue,
} from '@/pipeline_modules/build_epics_core/types.js'
import { attachCrossDomainSubmissions, type CrossDomainSubmission } from './cross_domain.js'
import type { TaxonomyConsolidationSubmission } from './taxonomy_consolidation.js'
import type { BuildEpicsRuntimeValidation } from './types.js'

export interface TaxonomyCandidateSubmission {
  domains: Array<Omit<ReviewableDomain, 'epicIds'> & { epicIds?: string[] }>
  epics: Array<Pick<ReviewableEpic, 'tempEpicId' | 'domainId' | 'stableKey' | 'name' | 'abbr' | 'summary'>>
}

export interface AssignmentSubmission {
  assignments: Array<{
    documentId: string
    epicKey: string
    role: 'owner' | 'primary' | 'supporting' | 'review'
    confidence: Confidence
    reason: string
  }>
}

export interface BuildDraftFromRuntimeSubmissionsInput {
  projectId: string
  taxonomyResults: TaxonomyCandidateSubmission[]
  consolidatedTaxonomyResult?: TaxonomyConsolidationSubmission
  assignmentResults: AssignmentSubmission[]
  crossDomainResults?: CrossDomainSubmission[]
  docIndex: BuildEpicsDocIndex
  validationPolicy?: BuildEpicsRuntimeValidationPolicy
}

export interface BuildEpicsRuntimeValidationPolicy {
  maxReviewRatioWarning: number
  maxReviewRatioFatal: number
}

export function buildDraftFromRuntimeSubmissions(input: BuildDraftFromRuntimeSubmissionsInput): ReviewableEpicPlan {
  const taxonomySource = input.consolidatedTaxonomyResult
    ? [input.consolidatedTaxonomyResult]
    : input.taxonomyResults
  const domains = dedupeDomains(taxonomySource.flatMap((result) => result.domains))
  const epicSeeds = dedupeEpics(taxonomySource.flatMap((result) => result.epics))
  const aliasSourcesByTarget = new Map<string, string[]>()
  for (const alias of input.consolidatedTaxonomyResult?.aliases ?? []) {
    aliasSourcesByTarget.set(alias.toStableKey, [...(aliasSourcesByTarget.get(alias.toStableKey) ?? []), alias.fromStableKey])
  }
  const epics: ReviewableEpic[] = epicSeeds.map((seed) => ({
    ...seed,
    status: 'reviewable',
    confidence: 'medium',
    apiLinks: [],
    screenLinks: [],
    eventLinks: [],
    scheduleLinks: [],
    crossLinks: [],
    dependencies: [],
    sourceCandidateKeys: [...new Set([seed.stableKey, ...(aliasSourcesByTarget.get(seed.stableKey) ?? [])])],
  }))
  const epicsByKey = new Map(epics.map((epic) => [epic.stableKey, epic]))
  const docTypesById = buildDocTypesById(input.docIndex)

  for (const assignment of input.assignmentResults.flatMap((result) => result.assignments)) {
    const epic = epicsByKey.get(assignment.epicKey)
    const documentType = docTypesById.get(assignment.documentId)
    if (!epic || !documentType || assignment.role === 'review') continue

    if (documentType === 'api_spec') {
      epic.apiLinks.push({ apiDocId: assignment.documentId, role: 'owner', reason: assignment.reason, confidence: assignment.confidence })
    } else if (documentType === 'screen_spec') {
      epic.screenLinks.push({
        screenDocId: assignment.documentId,
        role: assignment.role === 'owner' ? 'primary' : assignment.role,
        reason: assignment.reason,
        confidence: assignment.confidence,
      })
    } else if (documentType === 'event_spec') {
      epic.eventLinks.push({
        eventDocId: assignment.documentId,
        role: assignment.role === 'owner' ? 'event_owner' : 'cross_epic',
        reason: assignment.reason,
        confidence: assignment.confidence,
      })
    } else {
      epic.scheduleLinks.push({
        scheduleDocId: assignment.documentId,
        role: assignment.role === 'owner' ? 'job_owner' : 'cross_epic',
        reason: assignment.reason,
        confidence: assignment.confidence,
      })
    }
  }

  const epicsWithCrossLinks = attachCrossDomainSubmissions(epics, input.crossDomainResults ?? [])
  const plan: ReviewableEpicPlan = {
    projectId: input.projectId,
    domains: attachEpicIds(domains, epicsWithCrossLinks),
    epics: epicsWithCrossLinks,
    reviewBuckets: {
      unassignedApiDocIds: unassignedDocIds(input.docIndex.apis, epicsWithCrossLinks.flatMap((epic) => epic.apiLinks.map((link) => link.apiDocId))),
      unassignedScreenDocIds: unassignedDocIds(input.docIndex.screens, epicsWithCrossLinks.flatMap((epic) => epic.screenLinks.map((link) => link.screenDocId))),
      unassignedEventDocIds: unassignedDocIds(input.docIndex.events, epicsWithCrossLinks.flatMap((epic) => epic.eventLinks.map((link) => link.eventDocId))),
      unassignedScheduleDocIds: unassignedDocIds(input.docIndex.schedules, epicsWithCrossLinks.flatMap((epic) => epic.scheduleLinks.map((link) => link.scheduleDocId))),
      orphanEventDocIds: [],
      orphanScheduleDocIds: [],
      unresolvedScreenApiCalls: [],
    },
    coverage: {
      assignedApiDocs: new Set(epicsWithCrossLinks.flatMap((epic) => epic.apiLinks.map((link) => link.apiDocId))).size,
      totalApiDocs: input.docIndex.apis.length,
    },
    validationIssues: [],
    judgeResults: [],
  }
  return {
    ...plan,
    validationIssues: validateBuildEpicsDraft(plan, input.validationPolicy ?? { maxReviewRatioWarning: 0.2, maxReviewRatioFatal: 0.35 }).fatal,
  }
}

export function validateBuildEpicsDraft(
  plan: ReviewableEpicPlan,
  policy: BuildEpicsRuntimeValidationPolicy,
): BuildEpicsRuntimeValidation {
  const fatal: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const apiOwners = new Map<string, string[]>()
  const domainIds = new Set((plan.domains ?? []).map((domain) => domain.domainId))

  for (const epic of plan.epics) {
    if (domainIds.size > 0 && epic.domainId && !domainIds.has(epic.domainId)) {
      fatal.push({ severity: 'fatal', code: 'UNKNOWN_EPIC_DOMAIN', message: `EPIC ${epic.tempEpicId} references unknown domain ${epic.domainId}`, tempEpicId: epic.tempEpicId })
    }
    for (const link of epic.apiLinks) {
      apiOwners.set(link.apiDocId, [...(apiOwners.get(link.apiDocId) ?? []), epic.tempEpicId])
    }
  }

  for (const apiDocId of plan.reviewBuckets.unassignedApiDocIds) {
    fatal.push({ severity: 'fatal', code: 'MISSING_API_OWNER', message: `Missing API owner ${apiDocId}`, documentId: apiDocId })
  }
  for (const [apiDocId, owners] of apiOwners) {
    if (owners.length > 1) {
      fatal.push({ severity: 'fatal', code: 'DUPLICATE_API_OWNER', message: `Duplicate API owner ${apiDocId}`, documentId: apiDocId })
    }
  }

  const reviewRatio = plan.coverage.totalApiDocs === 0 ? 0 : plan.reviewBuckets.unassignedApiDocIds.length / plan.coverage.totalApiDocs
  if (reviewRatio > policy.maxReviewRatioFatal) {
    fatal.push({ severity: 'fatal', code: 'REVIEW_RATIO_FATAL', message: `Review ratio ${reviewRatio.toFixed(2)} exceeds fatal threshold` })
  } else if (reviewRatio > policy.maxReviewRatioWarning) {
    warnings.push({ severity: 'warning', code: 'REVIEW_RATIO_WARNING', message: `Review ratio ${reviewRatio.toFixed(2)} exceeds warning threshold` })
  }

  return { fatal, warnings }
}

function dedupeDomains(domains: TaxonomyCandidateSubmission['domains']): ReviewableDomain[] {
  return [...new Map(domains.map((domain) => [domain.stableKey, { ...domain, epicIds: [...(domain.epicIds ?? [])] }])).values()]
}

function dedupeEpics(epics: TaxonomyCandidateSubmission['epics']): TaxonomyCandidateSubmission['epics'] {
  return [...new Map(epics.map((epic) => [epic.stableKey, epic])).values()]
}

function attachEpicIds(domains: ReviewableDomain[], epics: ReviewableEpic[]): ReviewableDomain[] {
  const epicIdsByDomain = new Map<string, string[]>()
  for (const epic of epics) {
    if (!epic.domainId) continue
    epicIdsByDomain.set(epic.domainId, [...(epicIdsByDomain.get(epic.domainId) ?? []), epic.tempEpicId])
  }
  return domains.map((domain) => ({ ...domain, epicIds: [...new Set([...domain.epicIds, ...(epicIdsByDomain.get(domain.domainId) ?? [])])] }))
}

function buildDocTypesById(docIndex: BuildEpicsDocIndex): Map<string, 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'> {
  return new Map([
    ...docIndex.apis.map((doc) => [doc.documentId, 'api_spec'] as const),
    ...docIndex.screens.map((doc) => [doc.documentId, 'screen_spec'] as const),
    ...docIndex.events.map((doc) => [doc.documentId, 'event_spec'] as const),
    ...docIndex.schedules.map((doc) => [doc.documentId, 'schedule_spec'] as const),
  ])
}

function unassignedDocIds(docs: Array<{ documentId: string }>, assignedDocIds: string[]): string[] {
  const assigned = new Set(assignedDocIds)
  return docs.map((doc) => doc.documentId).filter((documentId) => !assigned.has(documentId))
}
