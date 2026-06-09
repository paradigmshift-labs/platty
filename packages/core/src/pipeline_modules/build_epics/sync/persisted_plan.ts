import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { epicDependencies, epicDocumentLinks } from '@/db/schema/build_epics.js'
import { epicDomains, epics } from '@/db/schema/core.js'
import type {
  EpicEventLink,
  EpicScheduleLink,
  EpicScreenLink,
  ReviewableEpic,
  ReviewableEpicPlan,
} from '@/pipeline_modules/build_epics/core/types.js'

export function loadPersistedBuildEpicsPlan(input: { db: DB; projectId: string }): ReviewableEpicPlan {
  const epicRows = input.db.select().from(epics).where(and(
    eq(epics.projectId, input.projectId),
    eq(epics.source, 'build_epics'),
    isNull(epics.deletedAt),
  )).orderBy(epics.stableKey, epics.id).all()
  const domainRows = input.db.select().from(epicDomains).where(and(
    eq(epicDomains.projectId, input.projectId),
    eq(epicDomains.source, 'build_epics'),
    isNull(epicDomains.deletedAt),
  )).orderBy(epicDomains.sortOrder, epicDomains.stableKey, epicDomains.id).all()

  const liveEpicIds = new Set(epicRows.map((epic) => epic.id))
  const liveDomainIds = new Set(domainRows.map((domain) => domain.id))
  const planEpics: ReviewableEpic[] = epicRows.map((epic) => ({
    tempEpicId: epic.id,
    domainId: epic.domainId && liveDomainIds.has(epic.domainId) ? epic.domainId : undefined,
    stableKey: epic.stableKey ?? epic.name.toLowerCase(),
    name: epic.name,
    abbr: epic.abbr ?? '',
    summary: epic.summary ?? epic.description ?? '',
    status: 'reviewable',
    confidence: epic.confidence ?? 'medium',
    apiLinks: [],
    screenLinks: [],
    eventLinks: [],
    scheduleLinks: [],
    crossLinks: [],
    dependencies: [],
    sourceCandidateKeys: [epic.stableKey ?? epic.name.toLowerCase()],
  }))
  const epicsById = new Map(planEpics.map((epic) => [epic.tempEpicId, epic]))

  const linkRows = liveEpicIds.size === 0
    ? []
    : input.db.select().from(epicDocumentLinks).where(inArray(epicDocumentLinks.epicId, [...liveEpicIds]))
      .orderBy(epicDocumentLinks.epicId, epicDocumentLinks.documentType, epicDocumentLinks.documentId, epicDocumentLinks.role)
      .all()
  for (const link of linkRows) {
    const epic = epicsById.get(link.epicId)
    if (!epic) continue

    if (link.documentType === 'api_spec') {
      epic.apiLinks.push({ apiDocId: link.documentId, role: 'owner', reason: link.reason, confidence: link.confidence })
    } else if (link.documentType === 'screen_spec') {
      epic.screenLinks.push({ screenDocId: link.documentId, role: normalizeScreenRole(link.role), reason: link.reason, confidence: link.confidence })
    } else if (link.documentType === 'event_spec') {
      epic.eventLinks.push({ eventDocId: link.documentId, role: normalizeEventRole(link.role), reason: link.reason, confidence: link.confidence })
    } else if (link.documentType === 'schedule_spec') {
      epic.scheduleLinks.push({ scheduleDocId: link.documentId, role: normalizeScheduleRole(link.role), reason: link.reason, confidence: link.confidence })
    }
  }

  const dependencyRows = liveEpicIds.size === 0
    ? []
    : input.db.select().from(epicDependencies).where(and(
      inArray(epicDependencies.sourceEpicId, [...liveEpicIds]),
      inArray(epicDependencies.targetEpicId, [...liveEpicIds]),
    )).orderBy(epicDependencies.sourceEpicId, epicDependencies.targetEpicId, epicDependencies.kind).all()
  for (const dependency of dependencyRows) {
    const sourceEpic = epicsById.get(dependency.sourceEpicId)
    if (!sourceEpic) continue
    sourceEpic.dependencies.push({
      targetTempEpicId: dependency.targetEpicId,
      kind: dependency.kind,
      reason: dependency.reason,
    })
  }

  const assignedApiDocs = new Set(planEpics.flatMap((epic) => epic.apiLinks.map((link) => link.apiDocId))).size
  return {
    projectId: input.projectId,
    domains: domainRows.map((domain) => ({
      domainId: domain.id,
      stableKey: domain.stableKey ?? domain.name.toLowerCase(),
      name: domain.name,
      summary: domain.summary ?? '',
      epicIds: planEpics.filter((epic) => epic.domainId === domain.id).map((epic) => epic.tempEpicId),
    })),
    epics: planEpics,
    reviewBuckets: {
      unassignedApiDocIds: [],
      unassignedScreenDocIds: [],
      unassignedEventDocIds: [],
      unassignedScheduleDocIds: [],
      orphanEventDocIds: [],
      orphanScheduleDocIds: [],
      unresolvedScreenApiCalls: [],
    },
    coverage: { assignedApiDocs, totalApiDocs: assignedApiDocs },
    validationIssues: [],
    judgeResults: [],
  }
}

function normalizeScreenRole(role: string): EpicScreenLink['role'] {
  if (role === 'primary' || role === 'supporting' || role === 'cross_epic' || role === 'shell' || role === 'unknown') return role
  return 'unknown'
}

function normalizeEventRole(role: string): EpicEventLink['role'] {
  if (role === 'event_owner' || role === 'cross_epic' || role === 'unknown') return role
  return 'unknown'
}

function normalizeScheduleRole(role: string): EpicScheduleLink['role'] {
  if (role === 'job_owner' || role === 'cross_epic' || role === 'unknown') return role
  return 'unknown'
}
