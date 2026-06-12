import { describe, expect, it } from 'vitest'
import {
  defaultEpicRestructureThresholds,
  deriveEpicRestructureAudit,
} from '@/pipeline_modules/build_epics/sync/restructure_audit.js'
import type { ReviewableEpicPlan } from '@/pipeline_modules/build_epics/core/types.js'
import type { EpicSyncDocumentImpact } from '@/pipeline_modules/build_epics/sync/impact.js'

describe('deriveEpicRestructureAudit', () => {
  it('returns no_change when new APIs do not exceed split thresholds', () => {
    const result = deriveEpicRestructureAudit({
      plan: planWithEpic({
        stableKey: 'orders',
        apiDocIds: ['doc:orders:create'],
        screenDocIds: ['doc:orders-screen'],
      }),
      impacts: [newApiImpact('doc:orders:create')],
      thresholds: defaultEpicRestructureThresholds(),
    })

    expect(result).toMatchObject({ action: 'no_change', taskRequired: false, reasons: [] })
  })

  it('requires restructure when one existing EPIC receives too many independent new owner APIs', () => {
    const result = deriveEpicRestructureAudit({
      plan: planWithEpic({
        stableKey: 'user_management',
        apiDocIds: ['doc:users', 'doc:roles', 'doc:permissions', 'doc:invitations'],
        screenDocIds: ['doc:user-admin-screen'],
      }),
      impacts: [
        newApiImpact('doc:users', ['users']),
        newApiImpact('doc:roles', ['roles']),
        newApiImpact('doc:permissions', ['permissions']),
        newApiImpact('doc:invitations', ['invitations']),
      ],
      thresholds: {
        newCoreDocsPerEpicTriggerAt: 5,
        totalCoreDocsPerEpicReviewAt: 13,
        newBackendApisPerEpicTriggerAt: 4,
        newPrimaryScreensPerEpicTriggerAt: 3,
        screenConnectedOwnerEpicsTriggerAt: 3,
        docConnectedOwnerEpicsTriggerAt: 3,
        newCrossRepoEdgesPerEpicTriggerAt: 6,
        minIndependentClusters: 2,
      },
    })

    expect(result).toMatchObject({
      action: 'restructure_required',
      taskRequired: true,
      reasons: expect.arrayContaining([
        expect.objectContaining({
          code: 'BACKEND_APIS_EXPAND_SINGLE_EPIC',
          epicStableKey: 'user_management',
        }),
      ]),
    })
  })

  it('requires restructure when too many new core docs are assigned to one EPIC, not only APIs', () => {
    const result = deriveEpicRestructureAudit({
      plan: planWithEpic({
        stableKey: 'admin_console',
        apiDocIds: ['doc:users-api'],
        screenDocIds: ['doc:user-admin', 'doc:role-admin', 'doc:permission-admin'],
        eventDocIds: ['doc:user-created-event'],
        scheduleDocIds: ['doc:invite-expiry-job'],
      }),
      impacts: [
        newScreenImpact('doc:user-admin', ['users']),
        newScreenImpact('doc:role-admin', ['roles']),
        newScreenImpact('doc:permission-admin', ['permissions']),
        newEventImpact('doc:user-created-event', ['users']),
        newScheduleImpact('doc:invite-expiry-job', ['invitations']),
      ],
      thresholds: {
        ...defaultEpicRestructureThresholds(),
        newCoreDocsPerEpicTriggerAt: 5,
      },
    })

    expect(result).toMatchObject({
      action: 'restructure_required',
      reasons: expect.arrayContaining([
        expect.objectContaining({
          code: 'TOO_MANY_NEW_CORE_DOCS',
          epicStableKey: 'admin_console',
          documentIds: expect.arrayContaining([
            'doc:user-admin',
            'doc:role-admin',
            'doc:permission-admin',
            'doc:user-created-event',
            'doc:invite-expiry-job',
          ]),
        }),
      ]),
    })
  })

  it('requires restructure when frontend screens expand a single EPIC', () => {
    const result = deriveEpicRestructureAudit({
      plan: planWithEpic({
        stableKey: 'admin_console',
        apiDocIds: ['doc:users-api'],
        screenDocIds: ['doc:user-admin', 'doc:role-admin', 'doc:permission-admin'],
      }),
      impacts: [
        newScreenImpact('doc:user-admin', ['users']),
        newScreenImpact('doc:role-admin', ['roles']),
        newScreenImpact('doc:permission-admin', ['permissions']),
      ],
      thresholds: {
        ...defaultEpicRestructureThresholds(),
        newPrimaryScreensPerEpicTriggerAt: 3,
      },
    })

    expect(result).toMatchObject({
      action: 'restructure_required',
      reasons: expect.arrayContaining([
        expect.objectContaining({
          code: 'FRONTEND_SCREENS_EXPAND_SINGLE_EPIC',
          epicStableKey: 'admin_console',
        }),
      ]),
    })
  })

  it('requires restructure when a new screen connects owner documents from multiple EPICs', () => {
    const result = deriveEpicRestructureAudit({
      plan: planWithEpics([
        { stableKey: 'users', apiDocIds: ['doc:users-api'], screenDocIds: [] },
        { stableKey: 'roles', apiDocIds: ['doc:roles-api'], screenDocIds: [] },
        { stableKey: 'permissions', apiDocIds: ['doc:permissions-api'], screenDocIds: [] },
      ]),
      impacts: [newScreenImpact('doc:admin-console', ['admin'])],
      topologyLinks: [
        topologyLink('doc:admin-console', 'doc:users-api', ['users']),
        topologyLink('doc:admin-console', 'doc:roles-api', ['roles']),
        topologyLink('doc:admin-console', 'doc:permissions-api', ['permissions']),
      ],
      thresholds: {
        ...defaultEpicRestructureThresholds(),
        screenConnectedOwnerEpicsTriggerAt: 3,
      },
    })

    expect(result).toMatchObject({
      action: 'restructure_required',
      reasons: expect.arrayContaining([
        expect.objectContaining({
          code: 'FRONTEND_SCREEN_SPANS_MULTIPLE_EPICS',
          documentId: 'doc:admin-console',
          connectedEpicStableKeys: ['permissions', 'roles', 'users'],
        }),
      ]),
    })
  })

  it('allows no_change even when audit opened a restructure task', () => {
    const result = deriveEpicRestructureAudit({
      plan: planWithEpic({
        stableKey: 'orders',
        apiDocIds: ['doc:orders:create', 'doc:orders:update'],
        screenDocIds: ['doc:orders-screen'],
      }),
      impacts: [
        newApiImpact('doc:orders:create', ['orders']),
        newApiImpact('doc:orders:update', ['orders']),
      ],
      topologyLinks: [],
      thresholds: defaultEpicRestructureThresholds(),
    })

    expect(result).toMatchObject({ action: 'no_change', taskRequired: false })
  })
})

function newApiImpact(documentId: string, domainHints: string[] = []): EpicSyncDocumentImpact {
  return {
    documentId,
    documentType: 'api_spec',
    scope: 'route',
    scopeId: documentId.replace('doc:', 'route:'),
    kind: 'new',
    oldHash: null,
    newHash: `hash:${documentId}`,
    domainHints,
    relationTargets: [],
  }
}

function newScreenImpact(documentId: string, domainHints: string[] = []): EpicSyncDocumentImpact {
  return newImpact(documentId, 'screen_spec', 'screen', domainHints)
}

function newEventImpact(documentId: string, domainHints: string[] = []): EpicSyncDocumentImpact {
  return newImpact(documentId, 'event_spec', 'event', domainHints)
}

function newScheduleImpact(documentId: string, domainHints: string[] = []): EpicSyncDocumentImpact {
  return newImpact(documentId, 'schedule_spec', 'job', domainHints)
}

function newImpact(
  documentId: string,
  documentType: EpicSyncDocumentImpact['documentType'],
  scope: string,
  domainHints: string[],
): EpicSyncDocumentImpact {
  return {
    documentId,
    documentType,
    scope,
    scopeId: documentId.replace('doc:', `${scope}:`),
    kind: 'new',
    oldHash: null,
    newHash: `hash:${documentId}`,
    domainHints,
    relationTargets: [],
  }
}

function topologyLink(sourceDocumentId: string, targetDocumentId: string, clusterHints: string[]) {
  return {
    sourceDocumentId,
    targetDocumentId,
    kind: 'calls_api',
    clusterHints,
  }
}

function planWithEpic(input: {
  stableKey: string
  apiDocIds: string[]
  screenDocIds: string[]
  eventDocIds?: string[]
  scheduleDocIds?: string[]
}): ReviewableEpicPlan {
  return planWithEpics([input])
}

function planWithEpics(inputs: Array<{
  stableKey: string
  apiDocIds: string[]
  screenDocIds: string[]
  eventDocIds?: string[]
  scheduleDocIds?: string[]
}>): ReviewableEpicPlan {
  return {
    projectId: 'p1',
    domains: [],
    epics: inputs.map((input) => ({
      tempEpicId: `epic:${input.stableKey}`,
      stableKey: input.stableKey,
      name: input.stableKey,
      abbr: input.stableKey.slice(0, 3).toUpperCase(),
      summary: `${input.stableKey} summary`,
      status: 'reviewable',
      confidence: 'high',
      apiLinks: input.apiDocIds.map((apiDocId) => ({ apiDocId, role: 'owner', confidence: 'high', reason: 'owner' })),
      screenLinks: input.screenDocIds.map((screenDocId) => ({ screenDocId, role: 'primary', confidence: 'high', reason: 'screen' })),
      eventLinks: (input.eventDocIds ?? []).map((eventDocId) => ({ eventDocId, role: 'event_owner', confidence: 'high' as const, reason: 'event' })),
      scheduleLinks: (input.scheduleDocIds ?? []).map((scheduleDocId) => ({ scheduleDocId, role: 'job_owner', confidence: 'high' as const, reason: 'job' })),
      crossLinks: [],
      dependencies: [],
      sourceCandidateKeys: [],
    })),
    reviewBuckets: {
      unassignedApiDocIds: [],
      unassignedScreenDocIds: [],
      unassignedEventDocIds: [],
      unassignedScheduleDocIds: [],
      orphanEventDocIds: [],
      orphanScheduleDocIds: [],
      unresolvedScreenApiCalls: [],
    },
    coverage: {
      assignedApiDocs: inputs.reduce((sum, input) => sum + input.apiDocIds.length, 0),
      totalApiDocs: inputs.reduce((sum, input) => sum + input.apiDocIds.length, 0),
    },
    validationIssues: [],
    judgeResults: [],
  }
}
