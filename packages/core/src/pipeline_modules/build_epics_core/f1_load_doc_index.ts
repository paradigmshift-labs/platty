import { eq, inArray } from 'drizzle-orm'
import { docRelationLinks, documents } from '@/db/schema/build_docs.js'
import type { DB } from '@/db/client.js'
import { isDeprecatedDocumentScope, listDeprecatedEntryPointIds } from '@/pipeline_modules/build_route/review_decisions.js'
import { BuildEpicsError, type ApiDocIndexItem, type BuildEpicsDocIndex, type BuildEpicsDocumentScope, type BuildEpicsDocumentType, type EpicRelationEvidence, type EventDocIndexItem, type ScheduleDocIndexItem, type ScreenDocIndexItem } from './types.js'

export interface LoadDocIndexInput {
  db: DB
  projectId: string
  documentScope?: BuildEpicsDocumentScope
  includeDocumentTypes?: BuildEpicsDocumentType[]
}

const defaultTypes: BuildEpicsDocumentType[] = ['api_spec', 'screen_spec', 'event_spec', 'schedule_spec']
const backendTypes: BuildEpicsDocumentType[] = ['api_spec', 'event_spec', 'schedule_spec']
const frontendTypes: BuildEpicsDocumentType[] = ['screen_spec']

function isFreshPassedDocument(row: typeof documents.$inferSelect): boolean {
  return row.status === 'passed' && row.validity === 'fresh'
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function objectArray<T extends Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((item): item is T => item !== null && typeof item === 'object' && !Array.isArray(item)) : []
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function relationSummary(content: Record<string, unknown>): Record<string, unknown> {
  return record(content.relations)
}

function identity(content: Record<string, unknown>): Record<string, unknown> {
  return record(content.identity)
}

function compactEvents(value: unknown): Array<{ event: string; broker?: string; topic?: string }> {
  return objectArray(value)
    .map((item) => ({
      event: String(item.event ?? item.name ?? ''),
      broker: typeof item.broker === 'string' ? item.broker : undefined,
      topic: typeof item.topic === 'string' ? item.topic : undefined,
    }))
    .filter((item) => item.event.length > 0)
}

function compactNavigation(value: unknown): Array<{ targetPath: string; trigger: string }> {
  return objectArray(value)
    .map((item) => ({
      targetPath: String(item.targetPath ?? item.target_path ?? ''),
      trigger: String(item.trigger ?? ''),
    }))
    .filter((item) => item.targetPath.length > 0)
}

function compactEventListeners(value: unknown): EventDocIndexItem['listeners'] {
  return objectArray(value).map((item) => ({
    name: String(item.name ?? item.handler ?? ''),
    handler: String(item.handler ?? ''),
    filePath: String(item.filePath ?? item.file_path ?? ''),
    businessLogic: stringArray(item.businessLogic ?? item.business_logic ?? item.flow),
    tables: objectArray(item.tables),
    externalCalls: objectArray(item.externalCalls ?? item.external_calls),
    emitsEvents: compactEvents(item.emitsEvents ?? item.emits_events ?? item.events_published),
  }))
}

function readSummary(content: Record<string, unknown> | null): string {
  const summary = typeof content?.summary === 'string' ? content.summary.trim() : ''
  if (!summary) throw new BuildEpicsError('MISSING_SUMMARY', 'documents.content.summary is required')
  return summary
}

function base<T extends BuildEpicsDocumentType>(row: typeof documents.$inferSelect, type: T, evidence: EpicRelationEvidence[] | null) {
  /* v8 ignore next -- summary validation rejects null content before fallback use */
  const content = row.content ?? {}
  return {
    documentId: row.id,
    projectId: row.projectId,
    type,
    status: 'passed' as const,
    filePath: typeof content.file_path === 'string'
      ? content.file_path
      : typeof record(content.identity).file_path === 'string'
        ? record(content.identity).file_path as string
        : null,
    /* v8 ignore next -- canonical build_docs rows carry either title or scope id */
    title: typeof content.title === 'string' ? content.title : row.scopeId ?? row.id,
    summary: readSummary(row.content),
    evidenceGaps: stringArray(content.evidence_gaps),
    relationEvidence: evidence,
    actorHints: stringArray(content.actor_hints),
    domainHints: stringArray(content.domain_hints),
    operationKey: typeof content.operation_key === 'string' ? content.operation_key : null,
    routePattern: typeof content.route_pattern === 'string' ? content.route_pattern : null,
  }
}

function relationEvidenceFor(row: typeof documents.$inferSelect, links: Array<typeof docRelationLinks.$inferSelect>): EpicRelationEvidence[] | null {
  if (links.length === 0 && row.content?.relation_evidence_checked !== true) return null
  return links.map((link) => ({
    relationId: link.relationId,
    repoId: link.repoId,
    sourceNodeId: link.sourceNodeId,
    kind: link.kind as EpicRelationEvidence['kind'],
    target: link.target,
    operation: link.operation,
    canonicalTarget: link.canonicalTarget,
    payload: link.payloadJson,
    evidenceNodeIds: link.evidenceNodeIdsJson,
    confidence: link.confidence,
    unresolvedReason: link.unresolvedReason,
  }))
}

function accessSummary(content: Record<string, unknown>): string | null {
  return typeof content.access === 'string' ? content.access : null
}

function authRequired(content: Record<string, unknown>): boolean | null {
  if (typeof content.auth_required === 'boolean') return content.auth_required
  const legacyAccess = record(content.access)
  if (typeof legacyAccess.required === 'boolean') return legacyAccess.required as boolean
  if (typeof content.access !== 'string') return null
  if (/^no access evidence\b/i.test(content.access)) return null
  if (/^public api\b/i.test(content.access)) return false
  if (/^(admin-only|login required)\b/i.test(content.access)) return true
  return null
}

export async function loadDocIndex(input: LoadDocIndexInput): Promise<BuildEpicsDocIndex> {
  /* v8 ignore next -- invalid input is covered via public orchestrator and direct tests */
  if (!input.projectId) throw new BuildEpicsError('INVALID_INPUT', 'projectId is required')
  const rows = input.db.select().from(documents).where(eq(documents.projectId, input.projectId)).all()
  const deprecatedEntryPointIds = listDeprecatedEntryPointIds(input.db, { projectId: input.projectId })
  const effectiveRows = rows.filter((row) => !isDeprecatedDocumentScope(row, deprecatedEntryPointIds))
  const allowed = input.includeDocumentTypes ?? resolveDocumentTypes(effectiveRows, input.documentScope ?? 'auto')
  const selectedRows = rows.filter((row) =>
    isFreshPassedDocument(row)
    && allowed.includes(row.type as BuildEpicsDocumentType)
    && !isDeprecatedDocumentScope(row, deprecatedEntryPointIds)
  )
  /* v8 ignore next -- no-docs behavior is covered by error tests */
  if (selectedRows.length === 0) throw new BuildEpicsError('NO_DOCS', 'no passed build_docs documents')
  const links = input.db.select().from(docRelationLinks).where(inArray(docRelationLinks.documentId, selectedRows.map((row) => row.id))).all()
  const linksByDoc = new Map<string, Array<typeof docRelationLinks.$inferSelect>>()
  for (const link of links) linksByDoc.set(link.documentId, [...(linksByDoc.get(link.documentId) ?? []), link])

  const index: BuildEpicsDocIndex = { projectId: input.projectId, apis: [], screens: [], events: [], schedules: [] }
  for (const row of selectedRows) {
    /* v8 ignore next -- passed build_docs rows are expected to carry JSON content */
    const content = row.content ?? {}
    const evidence = relationEvidenceFor(row, linksByDoc.get(row.id) ?? [])
    if (row.type === 'api_spec') {
      const id = identity(content)
      const relations = relationSummary(content)
      index.apis.push({
        ...base(row, 'api_spec', evidence),
        method: String(id.method ?? content.method ?? 'GET').toUpperCase(),
        /* v8 ignore next -- defensive fallback chain for malformed legacy rows */
        path: String(id.path ?? content.path ?? content.route_path ?? row.scopeId ?? '/'),
        handler: String(id.handler ?? content.handler ?? ''),
        sourceFilePath: String(content.source_file_path ?? id.file_path ?? content.file_path ?? ''),
        access: accessSummary(content),
        /* v8 ignore next -- boolean/null normalization is exercised through API fixtures */
        authRequired: authRequired(content),
        tables: objectArray(relations.tables ?? content.tables),
        eventsPublished: compactEvents(relations.events ?? content.events_published),
        externalCalls: objectArray(relations.external_calls ?? content.external_calls),
        businessLogic: stringArray(content.flow ?? content.business_logic),
        businessRules: stringArray(content.rules ?? content.business_rules),
      } satisfies ApiDocIndexItem)
    } else if (row.type === 'screen_spec') {
      const id = identity(content)
      const relations = relationSummary(content)
      index.screens.push({
        ...base(row, 'screen_spec', evidence),
        /* v8 ignore next -- defensive fallback chain for malformed legacy rows */
        routePath: String(id.route_path ?? content.route_path ?? row.scopeId ?? '/'),
        /* v8 ignore next -- defensive fallback chain for malformed legacy rows */
        screenName: String(id.screen_name ?? content.screen_name ?? content.title ?? row.scopeId ?? row.id),
        component: String(id.component ?? content.component ?? ''),
        sourceFilePath: String(content.source_file_path ?? id.file_path ?? content.file_path ?? ''),
        apiCalls: objectArray(relations.api_calls ?? content.api_calls),
        navigation: compactNavigation(relations.navigation ?? content.navigation),
        actions: objectArray(content.actions),
        businessLogic: stringArray(content.flow ?? content.business_logic),
      } satisfies ScreenDocIndexItem)
    } else if (row.type === 'event_spec') {
      const id = identity(content)
      index.events.push({
        ...base(row, 'event_spec', evidence),
        /* v8 ignore next -- defensive fallback chain for malformed legacy rows */
        eventKey: String(id.name ?? content.event_key ?? content.name ?? row.scopeId ?? row.id),
        broker: typeof id.broker === 'string' ? id.broker : typeof content.broker === 'string' ? content.broker : undefined,
        topic: typeof id.topic === 'string' ? id.topic : typeof content.topic === 'string' ? content.topic : undefined,
        listeners: compactEventListeners(content.listeners ?? content.consumers),
      } satisfies EventDocIndexItem)
    } else if (row.type === 'schedule_spec') {
      const schedule = content.schedule && typeof content.schedule === 'object' && !Array.isArray(content.schedule) ? content.schedule as Record<string, unknown> : {}
      const id = identity(content)
      const trigger = record(content.trigger)
      const relations = relationSummary(content)
      index.schedules.push({
        ...base(row, 'schedule_spec', evidence),
        /* v8 ignore next -- defensive fallback chain for malformed legacy rows */
        jobName: String(id.name ?? content.job_name ?? content.name ?? row.scopeId ?? row.id),
        schedule: {
          trigger: (trigger.type as ScheduleDocIndexItem['schedule']['trigger']) ?? (schedule.trigger as ScheduleDocIndexItem['schedule']['trigger']) ?? 'unknown',
          cron: (trigger.cron ?? schedule.cron) as string | undefined,
          timezone: (trigger.timezone ?? schedule.timezone) as string | undefined,
          frequency: (trigger.frequency ?? schedule.frequency) as string | undefined,
        },
        handler: String(id.handler ?? content.handler ?? ''),
        sourceFilePath: String(content.source_file_path ?? id.file_path ?? content.file_path ?? ''),
        tables: objectArray(relations.tables ?? content.tables),
        eventsPublished: compactEvents(relations.events ?? content.events_published),
        externalCalls: objectArray(relations.external_calls ?? content.external_calls),
        businessLogic: stringArray(content.flow ?? content.business_logic),
      } satisfies ScheduleDocIndexItem)
    }
  }
  return index
}

function resolveDocumentTypes(
  rows: Array<typeof documents.$inferSelect>,
  scope: BuildEpicsDocumentScope,
): BuildEpicsDocumentType[] {
  if (scope === 'backend_only') return backendTypes
  if (scope === 'frontend_only') return frontendTypes
  if (scope === 'all') return defaultTypes
  return rows.some((row) => isFreshPassedDocument(row) && backendTypes.includes(row.type as BuildEpicsDocumentType))
    ? backendTypes
    : frontendTypes
}
