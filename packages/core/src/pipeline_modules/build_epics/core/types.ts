import type { CriticalFailure } from '@/pipeline_modules/shared/judge_helpers.js'

export type Confidence = 'high' | 'medium' | 'low'
export type BuildEpicsDocumentType = 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
export type EpicRelationKind =
  | 'db_access'
  | 'navigation'
  | 'external_link'
  | 'external_service'
  | 'api_call'
  | 'event_publish'
  | 'event_listen'
  | 'schedule_trigger'

export class BuildEpicsError extends Error {
  constructor(public readonly code: string, message = code, public readonly details?: unknown) {
    super(message)
    this.name = 'BuildEpicsError'
  }
}

export interface BuildEpicsValidationOptions {
  requireEventOwners?: boolean
  requireScheduleOwners?: boolean
  requireScreenLinks?: boolean
  allowUnresolvedScreenApiCalls?: boolean
}

export type BuildEpicsDocumentScope = 'auto' | 'backend_only' | 'frontend_only' | 'all'
export type BuildEpicsAssignmentRole = 'owner' | 'primary' | 'supporting'
export type BuildEpicsCrossDomainKind =
  | 'cross_domain_policy'
  | 'reward_or_coupon_effect'
  | 'state_change'
  | 'event_flow'
  | 'shared_user_journey'
  | 'operational_dependency'
export type BuildEpicsCrossDomainRole = 'impact' | 'supporting' | 'reference'

export interface EpicRelationEvidence {
  relationId: string | null
  repoId: string
  sourceNodeId: string
  kind: EpicRelationKind
  target: string | null
  operation: string | null
  canonicalTarget: string | null
  payload: Record<string, unknown> | null
  evidenceNodeIds: string[]
  confidence: Confidence
  unresolvedReason: string | null
}

export interface BaseDocIndexItem {
  documentId: string
  projectId: string
  type: BuildEpicsDocumentType
  status: 'passed'
  filePath: string | null
  title: string
  summary: string
  evidenceGaps: string[]
  relationEvidence: EpicRelationEvidence[] | null
  actorHints: string[]
  domainHints: string[]
  operationKey: string | null
  routePattern: string | null
}

export interface ApiDocIndexItem extends BaseDocIndexItem {
  type: 'api_spec'
  method: string
  path: string
  handler: string
  sourceFilePath: string
  access: string | null
  authRequired: boolean | null
  tables: Array<{ table: string; operation: string }>
  eventsPublished: Array<{ event: string; broker?: string; topic?: string }>
  externalCalls: Array<{ system: string; operation?: string }>
  businessLogic: string[]
  businessRules: string[]
}

export interface ScreenDocIndexItem extends BaseDocIndexItem {
  type: 'screen_spec'
  routePath: string
  screenName: string
  component: string
  sourceFilePath: string
  apiCalls: Array<{ method?: string; path: string; trigger: string }>
  navigation: Array<{ targetPath: string; trigger: string }>
  actions: Array<{ name: string; trigger: string; result: string }>
  businessLogic: string[]
}

export interface EventDocIndexItem extends BaseDocIndexItem {
  type: 'event_spec'
  eventKey: string
  broker?: string
  topic?: string
  listeners: Array<{
    name: string
    handler: string
    filePath: string
    businessLogic: string[]
    tables: Array<{ table: string; operation: string }>
    externalCalls: Array<{ system: string; operation?: string }>
    emitsEvents: Array<{ event: string; topic?: string }>
  }>
}

export interface ScheduleDocIndexItem extends BaseDocIndexItem {
  type: 'schedule_spec'
  jobName: string
  schedule: { trigger: 'cron' | 'interval' | 'queue' | 'manual' | 'unknown'; cron?: string; timezone?: string; frequency?: string }
  handler: string
  sourceFilePath: string
  tables: Array<{ table: string; operation: string }>
  eventsPublished: Array<{ event: string; broker?: string; topic?: string }>
  externalCalls: Array<{ system: string; operation?: string }>
  businessLogic: string[]
}

export type BuildEpicsDoc = ApiDocIndexItem | ScreenDocIndexItem | EventDocIndexItem | ScheduleDocIndexItem

export interface BuildEpicsDocIndex {
  projectId: string
  apis: ApiDocIndexItem[]
  screens: ScreenDocIndexItem[]
  events: EventDocIndexItem[]
  schedules: ScheduleDocIndexItem[]
}

export interface ScreenApiResolution {
  method?: string
  path: string
  resolvedApiDocId: string | null
  unresolvedReason: string | null
}

export type EpicDependencyKind = 'cross_screen' | 'event_flow' | 'table_shared' | 'external_call' | 'cross_domain_state_change'
export interface EpicApiLink { apiDocId: string; role: 'owner'; reason?: string; confidence: Confidence }
export interface EpicScreenLink { screenDocId: string; role: 'primary' | 'supporting' | 'cross_epic' | 'shell' | 'unknown'; reason?: string; confidence: Confidence }
export interface EpicEventLink { eventDocId: string; role: 'event_owner' | 'cross_epic' | 'unknown'; reason?: string; confidence: Confidence }
export interface EpicScheduleLink { scheduleDocId: string; role: 'job_owner' | 'cross_epic' | 'unknown'; reason?: string; confidence: Confidence }
export interface EpicCrossDomainLink {
  sourceDocumentId: string
  targetTempEpicId: string
  kind: BuildEpicsCrossDomainKind
  role: BuildEpicsCrossDomainRole
  confidence: Confidence
  reason: string
}

export interface JudgeResult {
  batchId?: string
  passed: boolean
  reason: string
  unsupportedClaims?: string[]
  score?: number
  critical_failures?: CriticalFailure[]
}

export interface ReviewableDomain {
  domainId: string
  stableKey: string
  name: string
  summary: string
  epicIds: string[]
}

export interface ValidationIssue {
  severity: 'fatal' | 'warning'
  code: string
  message: string
  documentId?: string
  tempEpicId?: string
}

export interface ReviewableEpic {
  tempEpicId: string
  domainId?: string
  stableKey: string
  name: string
  abbr: string
  summary: string
  status: 'reviewable' | 'needs_review'
  confidence: Confidence
  apiLinks: EpicApiLink[]
  screenLinks: EpicScreenLink[]
  eventLinks: EpicEventLink[]
  scheduleLinks: EpicScheduleLink[]
  crossLinks: EpicCrossDomainLink[]
  dependencies: Array<{ targetTempEpicId: string; kind: EpicDependencyKind; reason: string }>
  sourceCandidateKeys: string[]
}

export interface ReviewableEpicPlan {
  projectId: string
  domains?: ReviewableDomain[]
  epics: ReviewableEpic[]
  reviewBuckets: {
    unassignedApiDocIds: string[]
    unassignedScreenDocIds: string[]
    unassignedEventDocIds: string[]
    unassignedScheduleDocIds: string[]
    orphanEventDocIds: string[]
    orphanScheduleDocIds: string[]
    unresolvedScreenApiCalls: ScreenApiResolution[]
  }
  coverage: { assignedApiDocs: number; totalApiDocs: number }
  validationIssues: ValidationIssue[]
  judgeResults: JudgeResult[]
}

export interface ConfirmedEpic extends Omit<ReviewableEpic, 'status'> {
  status: 'confirmed' | 'rejected'
}
export interface ConfirmedEpicPlan extends Omit<ReviewableEpicPlan, 'epics'> {
  epics: ConfirmedEpic[]
}
export interface ValidatedConfirmedEpic extends ConfirmedEpic {
  validatedStableKey: string
}
export interface ValidatedConfirmedEpicPlan extends Omit<ConfirmedEpicPlan, 'epics'> {
  epics: ValidatedConfirmedEpic[]
}
export interface PersistConfirmedEpicsResult {
  upsertedEpicIds: string[]
  confirmedCount: number
  rejectedCount: number
  softDeletedCount: number
  linkCount: number
  dependencyCount: number
  confirmLogId: string
}
