import { BuildEpicsError, type BuildEpicsDocIndex, type BuildEpicsValidationOptions, type ConfirmedEpicPlan, type ValidatedConfirmedEpicPlan, type ValidationIssue } from './types.js'
import { makeEpicStableKey } from './stable_keys.js'

export function validateEpicPlan(input: ConfirmedEpicPlan, docIndex: BuildEpicsDocIndex, opts: BuildEpicsValidationOptions = {}): ValidatedConfirmedEpicPlan {
  const issues: ValidationIssue[] = []
  const docIds = new Set([...docIndex.apis, ...docIndex.screens, ...docIndex.events, ...docIndex.schedules].map((doc) => doc.documentId))
  const confirmed = input.epics.filter((epic) => epic.status === 'confirmed')
  const domains = input.domains ?? []
  const hasDomainPlan = input.domains !== undefined
  const domainIds = new Set(domains.map((domain) => domain.domainId))
  const domainStableKeys = new Set<string>()
  const domainNames = new Set<string>()

  for (const domain of domains) {
    if (!domain.stableKey || !domain.name) {
      issues.push({ severity: 'fatal', code: 'INVALID_DOMAIN', message: `Invalid domain ${domain.domainId}` })
    }
    const stableKey = domain.stableKey.trim().toLowerCase()
    const name = domain.name.trim().toLowerCase()
    if (domainStableKeys.has(stableKey)) issues.push({ severity: 'fatal', code: 'DUPLICATE_DOMAIN_STABLE_KEY', message: `Duplicate domain stable key ${domain.stableKey}` })
    if (domainNames.has(name)) issues.push({ severity: 'fatal', code: 'DUPLICATE_DOMAIN_NAME', message: `Duplicate domain name ${domain.name}` })
    domainStableKeys.add(stableKey)
    domainNames.add(name)
  }

  for (const epic of input.epics) {
    if (hasDomainPlan && epic.domainId && !domainIds.has(epic.domainId)) {
      issues.push({ severity: 'fatal', code: 'UNKNOWN_EPIC_DOMAIN', message: `EPIC ${epic.tempEpicId} references unknown domain ${epic.domainId ?? '<missing>'}`, tempEpicId: epic.tempEpicId })
    }
    for (const id of [...epic.apiLinks.map((l) => l.apiDocId), ...epic.screenLinks.map((l) => l.screenDocId), ...epic.eventLinks.map((l) => l.eventDocId), ...epic.scheduleLinks.map((l) => l.scheduleDocId)]) {
      if (!docIds.has(id)) issues.push({ severity: 'fatal', code: 'UNKNOWN_DOCUMENT', message: `Unknown document ${id}`, documentId: id, tempEpicId: epic.tempEpicId })
    }
  }
  const apiOwners = new Map<string, string[]>()
  for (const epic of confirmed) {
    for (const link of epic.apiLinks) apiOwners.set(link.apiDocId, [...(apiOwners.get(link.apiDocId) ?? []), epic.tempEpicId])
  }
  for (const api of docIndex.apis) {
    const owners = apiOwners.get(api.documentId) ?? []
    if (owners.length === 0) issues.push({ severity: 'fatal', code: 'MISSING_API_OWNER', message: `Missing API owner ${api.documentId}`, documentId: api.documentId })
    /* v8 ignore next -- duplicate API owner is covered by invalid confirm tests */
    if (owners.length > 1) issues.push({ severity: 'fatal', code: 'DUPLICATE_API_OWNER', message: `Duplicate API owner ${api.documentId}`, documentId: api.documentId })
  }
  for (const event of docIndex.events) {
    const hasOwner = confirmed.some((epic) => epic.eventLinks.some((link) => link.eventDocId === event.documentId && link.role === 'event_owner'))
    if (!hasOwner) issues.push({ severity: opts.requireEventOwners ? 'fatal' : 'warning', code: 'MISSING_EVENT_OWNER', message: `Missing event owner ${event.documentId}`, documentId: event.documentId })
  }
  for (const schedule of docIndex.schedules) {
    const hasOwner = confirmed.some((epic) => epic.scheduleLinks.some((link) => link.scheduleDocId === schedule.documentId && link.role === 'job_owner'))
    if (!hasOwner) issues.push({ severity: opts.requireScheduleOwners ? 'fatal' : 'warning', code: 'MISSING_SCHEDULE_OWNER', message: `Missing schedule owner ${schedule.documentId}`, documentId: schedule.documentId })
  }
  if (opts.requireScreenLinks) {
    for (const screen of docIndex.screens) {
      const linked = confirmed.some((epic) => epic.screenLinks.some((link) => link.screenDocId === screen.documentId))
      if (!linked) issues.push({ severity: 'fatal', code: 'MISSING_SCREEN_LINK', message: `Missing screen link ${screen.documentId}`, documentId: screen.documentId })
    }
  }
  const confirmedIds = new Set(confirmed.map((epic) => epic.tempEpicId))
  for (const epic of input.epics) {
    for (const dep of epic.dependencies) {
      if (epic.status !== 'confirmed') issues.push({ severity: 'fatal', code: 'DEPENDENCY_SOURCE_REJECTED', message: 'Dependency source is rejected', tempEpicId: epic.tempEpicId })
      if (!confirmedIds.has(dep.targetTempEpicId)) issues.push({ severity: 'fatal', code: 'DEPENDENCY_TARGET_INVALID', message: 'Dependency target is not confirmed', tempEpicId: epic.tempEpicId })
    }
  }
  if (issues.some((issue) => issue.severity === 'fatal')) throw new BuildEpicsError('VALIDATION_FAILED', 'confirmed EPIC plan validation failed', issues)
  const epics = input.epics.map((epic) => ({ ...epic, validatedStableKey: makeEpicStableKey(epic) }))
  const assignedApiDocs = new Set(confirmed.flatMap((epic) => epic.apiLinks.map((link) => link.apiDocId))).size
  return {
    ...input,
    epics,
    validationIssues: [...input.validationIssues, ...issues],
    coverage: { assignedApiDocs, totalApiDocs: docIndex.apis.length },
  }
}
