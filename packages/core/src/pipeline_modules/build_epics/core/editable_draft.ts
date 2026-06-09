import { abbrFromName, makeEpicStableKey } from './stable_keys.js'
import { BuildEpicsError, type Confidence, type JudgeResult, type ReviewableEpic, type ReviewableDomain, type ReviewableEpicPlan, type ScreenApiResolution, type ValidationIssue } from './types.js'

export type EditableDraftSource = 'generated' | 'repair' | 'user' | 'agent'

export interface EpicDomainDraft {
  domainId: string
  stableKey: string
  name: string
  summary: string
  epicIds: string[]
  source: EditableDraftSource
}

export interface EditableEpicDraft extends ReviewableEpic {
  domainId: string
  source: EditableDraftSource
}

export interface EditableEpicDraftPlan {
  draftId: string
  projectId: string
  version: number
  strategy: 'capability_seed' | 'import' | 'manual'
  domains: EpicDomainDraft[]
  epics: EditableEpicDraft[]
  reviewBuckets: ReviewableEpicPlan['reviewBuckets']
  validationIssues: ValidationIssue[]
  judgeResults: JudgeResult[]
}

export type EpicDraftCommand =
  | { type: 'move_epic'; epicId: string; targetDomainId: string; reason: string }
  | { type: 'rename_epic'; epicId: string; name: string; reason: string }
  | { type: 'rename_domain'; domainId: string; name: string; summary?: string; reason: string }
  | { type: 'move_documents'; documentIds: string[]; targetEpicId: string; reason: string }
  | { type: 'merge_epics'; sourceEpicIds: string[]; targetEpicId: string; reason: string }
  | { type: 'create_epic'; tempEpicId: string; domainId: string; stableKey: string; name: string; abbr: string; summary: string; reason: string }
  | { type: 'create_domain'; domainId: string; stableKey: string; name: string; summary: string; reason: string }

export interface ApplyEpicDraftCommandsOptions {
  expectedVersion: number
}

export function applyEpicDraftCommands(
  draft: EditableEpicDraftPlan,
  commands: EpicDraftCommand[],
  opts: ApplyEpicDraftCommandsOptions,
): EditableEpicDraftPlan {
  if (draft.version !== opts.expectedVersion) throw new BuildEpicsError('DRAFT_VERSION_CONFLICT')
  const next: EditableEpicDraftPlan = cloneDraft(draft)
  for (const command of commands) applyCommand(next, command)
  next.version += 1
  next.validationIssues = validateEditableEpicDraftPlan(next)
  return next
}

function applyCommand(draft: EditableEpicDraftPlan, command: EpicDraftCommand): void {
  if (command.type === 'create_domain') {
    if (draft.domains.some((domain) => domain.domainId === command.domainId)) throw new BuildEpicsError('DUPLICATE_DOMAIN')
    draft.domains.push({
      domainId: command.domainId,
      stableKey: command.stableKey,
      name: command.name,
      summary: command.summary,
      epicIds: [],
      source: 'user',
    })
    return
  }

  if (command.type === 'create_epic') {
    const domain = draft.domains.find((item) => item.domainId === command.domainId)
    if (!domain) throw new BuildEpicsError('UNKNOWN_DOMAIN')
    if (draft.epics.some((epic) => epic.tempEpicId === command.tempEpicId || epic.stableKey === command.stableKey)) {
      throw new BuildEpicsError('DUPLICATE_EPIC')
    }
    draft.epics.push({
      tempEpicId: command.tempEpicId,
      domainId: command.domainId,
      stableKey: command.stableKey,
      name: command.name,
      abbr: command.abbr,
      summary: command.summary,
      status: 'reviewable',
      confidence: 'medium',
      apiLinks: [],
      screenLinks: [],
      eventLinks: [],
      scheduleLinks: [],
      crossLinks: [],
      dependencies: [],
      sourceCandidateKeys: [command.stableKey],
      source: 'user',
    })
    if (!domain.epicIds.includes(command.tempEpicId)) domain.epicIds.push(command.tempEpicId)
    return
  }

  if (command.type === 'rename_domain') {
    const domain = draft.domains.find((item) => item.domainId === command.domainId)
    if (!domain) throw new BuildEpicsError('UNKNOWN_DOMAIN')
    domain.name = command.name
    if (command.summary !== undefined) domain.summary = command.summary
    domain.source = 'user'
    return
  }

  if (command.type === 'move_documents') {
    const targetEpic = draft.epics.find((item) => item.tempEpicId === command.targetEpicId)
    if (!targetEpic) throw new BuildEpicsError('UNKNOWN_EPIC')
    for (const documentId of command.documentIds) moveDocumentToEpic(draft, documentId, targetEpic)
    targetEpic.source = 'user'
    return
  }

  if (command.type === 'merge_epics') {
    const targetEpic = draft.epics.find((item) => item.tempEpicId === command.targetEpicId)
    if (!targetEpic) throw new BuildEpicsError('UNKNOWN_EPIC')
    for (const sourceEpicId of command.sourceEpicIds) {
      if (sourceEpicId === targetEpic.tempEpicId) continue
      const sourceEpic = draft.epics.find((item) => item.tempEpicId === sourceEpicId)
      if (!sourceEpic) throw new BuildEpicsError('UNKNOWN_EPIC')
      targetEpic.apiLinks = mergeBy(targetEpic.apiLinks, sourceEpic.apiLinks, 'apiDocId')
      targetEpic.screenLinks = mergeBy(targetEpic.screenLinks, sourceEpic.screenLinks, 'screenDocId')
      targetEpic.eventLinks = mergeBy(targetEpic.eventLinks, sourceEpic.eventLinks, 'eventDocId')
      targetEpic.scheduleLinks = mergeBy(targetEpic.scheduleLinks, sourceEpic.scheduleLinks, 'scheduleDocId')
      targetEpic.sourceCandidateKeys = [...new Set([...targetEpic.sourceCandidateKeys, ...sourceEpic.sourceCandidateKeys])]
      const sourceDomain = draft.domains.find((domain) => domain.domainId === sourceEpic.domainId)
      if (sourceDomain) sourceDomain.epicIds = sourceDomain.epicIds.filter((id) => id !== sourceEpic.tempEpicId)
      draft.epics = draft.epics.filter((item) => item.tempEpicId !== sourceEpic.tempEpicId)
    }
    targetEpic.source = 'user'
    targetEpic.stableKey = makeEpicStableKey(targetEpic)
    return
  }

  const epic = draft.epics.find((item) => item.tempEpicId === command.epicId)
  if (!epic) throw new BuildEpicsError('UNKNOWN_EPIC')

  if (command.type === 'rename_epic') {
    epic.name = command.name
    epic.abbr = epic.abbr || abbrFromName(command.name)
    epic.stableKey = makeEpicStableKey(epic)
    epic.source = 'user'
    return
  }

  if (command.type === 'move_epic') {
    const targetDomain = draft.domains.find((domain) => domain.domainId === command.targetDomainId)
    if (!targetDomain) throw new BuildEpicsError('UNKNOWN_DOMAIN')
    const sourceDomain = draft.domains.find((domain) => domain.domainId === epic.domainId)
    if (sourceDomain) sourceDomain.epicIds = sourceDomain.epicIds.filter((id) => id !== epic.tempEpicId)
    if (!targetDomain.epicIds.includes(epic.tempEpicId)) targetDomain.epicIds.push(epic.tempEpicId)
    epic.domainId = targetDomain.domainId
    epic.source = 'user'
  }
}

export function validateEditableEpicDraftPlan(draft: EditableEpicDraftPlan): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const domainIds = new Set(draft.domains.map((domain) => domain.domainId))
  const apiOwners = new Map<string, string[]>()
  const knownEpicIds = new Set(draft.epics.map((epic) => epic.tempEpicId))

  for (const domain of draft.domains) {
    for (const epicId of domain.epicIds) {
      if (!knownEpicIds.has(epicId)) {
        issues.push({ severity: 'fatal', code: 'UNKNOWN_DOMAIN_EPIC', message: `Domain ${domain.domainId} references unknown EPIC ${epicId}`, tempEpicId: epicId })
      }
    }
    if (isEtcDomain(domain.name, domain.stableKey)) {
      issues.push({ severity: 'warning', code: 'ETC_REVIEW_DOMAIN_USED', message: `${domain.name} contains review items that should be acknowledged before confirm.` })
    }
  }

  for (const epic of draft.epics) {
    if (!domainIds.has(epic.domainId)) {
      issues.push({ severity: 'fatal', code: 'UNKNOWN_EPIC_DOMAIN', message: `EPIC ${epic.tempEpicId} references unknown domain ${epic.domainId}`, tempEpicId: epic.tempEpicId })
    }
    for (const link of epic.apiLinks) {
      apiOwners.set(link.apiDocId, [...(apiOwners.get(link.apiDocId) ?? []), epic.tempEpicId])
    }
  }

  for (const [apiDocId, owners] of apiOwners) {
    if (owners.length > 1) {
      issues.push({ severity: 'fatal', code: 'DUPLICATE_API_OWNER', message: `API ${apiDocId} is owned by multiple EPICs`, documentId: apiDocId })
    }
  }
  return issues
}

export function projectEditableDraftToReviewablePlan(draft: EditableEpicDraftPlan): ReviewableEpicPlan {
  const domains: ReviewableDomain[] = draft.domains.map((domain) => ({
    domainId: domain.domainId,
    stableKey: domain.stableKey,
    name: domain.name,
    summary: domain.summary,
    epicIds: [...domain.epicIds],
  }))
  const epics: ReviewableEpic[] = draft.epics.map(({ source: _source, ...epic }) => ({
    ...epic,
    stableKey: epic.stableKey || makeEpicStableKey(epic),
  }))
  const assignedApiDocs = new Set(epics.flatMap((epic) => epic.apiLinks.map((link) => link.apiDocId))).size
  return {
    projectId: draft.projectId,
    domains,
    epics,
    reviewBuckets: draft.reviewBuckets,
    coverage: { assignedApiDocs, totalApiDocs: assignedApiDocs + draft.reviewBuckets.unassignedApiDocIds.length },
    validationIssues: draft.validationIssues,
    judgeResults: draft.judgeResults,
  }
}

type MovedDocumentType = 'api' | 'screen' | 'event' | 'schedule'

function moveDocumentToEpic(draft: EditableEpicDraftPlan, documentId: string, targetEpic: EditableEpicDraft): void {
  const documentType = classifyMovedDocument(draft, documentId)
  let moved = false
  for (const epic of draft.epics) {
    const beforeApi = epic.apiLinks.length
    epic.apiLinks = epic.apiLinks.filter((link) => link.apiDocId !== documentId)
    moved = moved || epic.apiLinks.length !== beforeApi
    const beforeScreen = epic.screenLinks.length
    epic.screenLinks = epic.screenLinks.filter((link) => link.screenDocId !== documentId)
    moved = moved || epic.screenLinks.length !== beforeScreen
    const beforeEvent = epic.eventLinks.length
    epic.eventLinks = epic.eventLinks.filter((link) => link.eventDocId !== documentId)
    moved = moved || epic.eventLinks.length !== beforeEvent
    const beforeSchedule = epic.scheduleLinks.length
    epic.scheduleLinks = epic.scheduleLinks.filter((link) => link.scheduleDocId !== documentId)
    moved = moved || epic.scheduleLinks.length !== beforeSchedule
  }
  draft.reviewBuckets.unassignedApiDocIds = draft.reviewBuckets.unassignedApiDocIds.filter((id) => id !== documentId)
  draft.reviewBuckets.unassignedScreenDocIds = draft.reviewBuckets.unassignedScreenDocIds.filter((id) => id !== documentId)
  draft.reviewBuckets.unassignedEventDocIds = draft.reviewBuckets.unassignedEventDocIds.filter((id) => id !== documentId)
  draft.reviewBuckets.unassignedScheduleDocIds = draft.reviewBuckets.unassignedScheduleDocIds.filter((id) => id !== documentId)
  const confidence: Confidence = 'medium'
  if (documentType === 'screen') {
    targetEpic.screenLinks.push({ screenDocId: documentId, role: 'primary', confidence, reason: 'Moved by edit command.' })
  } else if (documentType === 'event') {
    targetEpic.eventLinks.push({ eventDocId: documentId, role: 'event_owner', confidence, reason: 'Moved by edit command.' })
  } else if (documentType === 'schedule') {
    targetEpic.scheduleLinks.push({ scheduleDocId: documentId, role: 'job_owner', confidence, reason: 'Moved by edit command.' })
  } else {
    targetEpic.apiLinks.push({ apiDocId: documentId, role: 'owner', confidence, reason: 'Moved by edit command.' })
  }
  if (!moved) targetEpic.sourceCandidateKeys = [...new Set([...targetEpic.sourceCandidateKeys, documentId])]
}

function classifyMovedDocument(draft: EditableEpicDraftPlan, documentId: string): MovedDocumentType {
  for (const epic of draft.epics) {
    if (epic.apiLinks.some((link) => link.apiDocId === documentId)) return 'api'
    if (epic.screenLinks.some((link) => link.screenDocId === documentId)) return 'screen'
    if (epic.eventLinks.some((link) => link.eventDocId === documentId)) return 'event'
    if (epic.scheduleLinks.some((link) => link.scheduleDocId === documentId)) return 'schedule'
  }
  if (draft.reviewBuckets.unassignedApiDocIds.includes(documentId)) return 'api'
  if (draft.reviewBuckets.unassignedScreenDocIds.includes(documentId)) return 'screen'
  if (draft.reviewBuckets.unassignedEventDocIds.includes(documentId)) return 'event'
  if (draft.reviewBuckets.unassignedScheduleDocIds.includes(documentId)) return 'schedule'
  if (documentId.includes(':screen_spec:') || documentId.startsWith('screen:')) return 'screen'
  if (documentId.includes(':event_spec:') || documentId.startsWith('event:')) return 'event'
  if (documentId.includes(':schedule_spec:') || documentId.startsWith('schedule:')) return 'schedule'
  return 'api'
}

function mergeBy<T extends Record<K, string>, K extends keyof T>(left: T[], right: T[], key: K): T[] {
  const seen = new Set(left.map((item) => item[key]))
  const output = [...left]
  for (const item of right) {
    if (seen.has(item[key])) continue
    seen.add(item[key])
    output.push(item)
  }
  return output
}

export function emptyReviewBuckets(): ReviewableEpicPlan['reviewBuckets'] {
  return {
    unassignedApiDocIds: [],
    unassignedScreenDocIds: [],
    unassignedEventDocIds: [],
    unassignedScheduleDocIds: [],
    orphanEventDocIds: [],
    orphanScheduleDocIds: [],
    unresolvedScreenApiCalls: [] as ScreenApiResolution[],
  }
}

export function isEtcDomain(name: string, stableKey: string): boolean {
  const normalized = `${name} ${stableKey}`.toLowerCase()
  return normalized.includes('etc') || normalized.includes('needs-review') || normalized.includes('needs review')
}

function cloneDraft(draft: EditableEpicDraftPlan): EditableEpicDraftPlan {
  return {
    ...draft,
    domains: draft.domains.map((domain) => ({ ...domain, epicIds: [...domain.epicIds] })),
    epics: draft.epics.map((epic) => ({
      ...epic,
      apiLinks: epic.apiLinks.map((link) => ({ ...link })),
      screenLinks: epic.screenLinks.map((link) => ({ ...link })),
      eventLinks: epic.eventLinks.map((link) => ({ ...link })),
      scheduleLinks: epic.scheduleLinks.map((link) => ({ ...link })),
      crossLinks: epic.crossLinks.map((link) => ({ ...link })),
      dependencies: epic.dependencies.map((dep) => ({ ...dep })),
      sourceCandidateKeys: [...epic.sourceCandidateKeys],
    })),
    reviewBuckets: {
      unassignedApiDocIds: [...draft.reviewBuckets.unassignedApiDocIds],
      unassignedScreenDocIds: [...draft.reviewBuckets.unassignedScreenDocIds],
      unassignedEventDocIds: [...draft.reviewBuckets.unassignedEventDocIds],
      unassignedScheduleDocIds: [...draft.reviewBuckets.unassignedScheduleDocIds],
      orphanEventDocIds: [...draft.reviewBuckets.orphanEventDocIds],
      orphanScheduleDocIds: [...draft.reviewBuckets.orphanScheduleDocIds],
      unresolvedScreenApiCalls: draft.reviewBuckets.unresolvedScreenApiCalls.map((item) => ({ ...item })),
    },
    validationIssues: draft.validationIssues.map((issue) => ({ ...issue })),
    judgeResults: draft.judgeResults.map((judge) => ({ ...judge, unsupportedClaims: judge.unsupportedClaims ? [...judge.unsupportedClaims] : undefined })),
  }
}
