import { describe, expect, it } from 'vitest'
import { applyEpicSyncCleanup } from '@/pipeline_modules/build_epics_sync/cleanup.js'
import type { ReviewableEpicPlan } from '@/pipeline_modules/build_epics_core/types.js'

describe('applyEpicSyncCleanup', () => {
  it('removes deleted document links and removes EPICs that lose all owner anchors', () => {
    const plan = planWithOrdersAndBilling()

    const result = applyEpicSyncCleanup({
      plan,
      deletedDocumentIds: ['doc:orders', 'doc:orders-screen'],
    })

    expect(result.removedDocumentIds).toEqual(['doc:orders', 'doc:orders-screen'])
    expect(result.removedEpicIds).toEqual(['epic:orders'])
    expect(result.plan.epics.map((epic) => epic.tempEpicId)).toEqual(['epic:billing'])
    expect(result.plan.epics[0]!.dependencies).toEqual([])
    expect(result.plan.domains?.[0]!.epicIds).toEqual(['epic:billing'])
  })

  it('keeps an EPIC when an API owner is deleted but a primary screen remains', () => {
    const plan = planWithOrdersAndBilling()

    const result = applyEpicSyncCleanup({
      plan,
      deletedDocumentIds: ['doc:orders'],
    })

    expect(result.removedEpicIds).toEqual([])
    expect(result.plan.epics.find((epic) => epic.tempEpicId === 'epic:orders')).toMatchObject({
      apiLinks: [],
      screenLinks: [expect.objectContaining({ screenDocId: 'doc:orders-screen', role: 'primary' })],
    })
  })

  it('keeps an EPIC when a deleted primary screen is removed but an API owner remains', () => {
    const plan = planWithOrdersAndBilling()

    const result = applyEpicSyncCleanup({
      plan,
      deletedDocumentIds: ['doc:orders-screen'],
    })

    expect(result.removedEpicIds).toEqual([])
    expect(result.plan.epics.find((epic) => epic.tempEpicId === 'epic:orders')).toMatchObject({
      apiLinks: [expect.objectContaining({ apiDocId: 'doc:orders' })],
      screenLinks: [],
    })
  })

  it('dedupes deleted document ids while preserving first-seen order', () => {
    const plan = planWithOrdersAndBilling()

    const result = applyEpicSyncCleanup({
      plan,
      deletedDocumentIds: ['doc:orders-screen', 'doc:orders', 'doc:orders-screen'],
    })

    expect(result.removedDocumentIds).toEqual(['doc:orders-screen', 'doc:orders'])
  })

  it('removes deleted ids from all review bucket arrays', () => {
    const plan = planWithCleanupMetadata()

    const result = applyEpicSyncCleanup({
      plan,
      deletedDocumentIds: [
        'doc:unassigned-api',
        'doc:unassigned-screen',
        'doc:unassigned-event',
        'doc:unassigned-schedule',
        'doc:orphan-event',
        'doc:orphan-schedule',
      ],
    })

    expect(result.plan.reviewBuckets).toMatchObject({
      unassignedApiDocIds: ['doc:keep-api'],
      unassignedScreenDocIds: ['doc:keep-screen'],
      unassignedEventDocIds: ['doc:keep-event'],
      unassignedScheduleDocIds: ['doc:keep-schedule'],
      orphanEventDocIds: ['doc:keep-orphan-event'],
      orphanScheduleDocIds: ['doc:keep-orphan-schedule'],
    })
  })

  it('removes validation issues for deleted documents and removed EPICs while keeping unrelated issues', () => {
    const plan = planWithCleanupMetadata()

    const result = applyEpicSyncCleanup({
      plan,
      deletedDocumentIds: ['doc:orders', 'doc:orders-screen'],
    })

    expect(result.removedEpicIds).toEqual(['epic:orders'])
    expect(result.plan.validationIssues).toEqual([
      expect.objectContaining({ code: 'unrelated_document_issue', documentId: 'doc:billing' }),
      expect.objectContaining({ code: 'unrelated_epic_issue', tempEpicId: 'epic:billing' }),
    ])
  })

  it('removes resolved screen API calls for deleted API docs but keeps unresolved calls without a source screen id', () => {
    const plan = planWithCleanupMetadata()

    const result = applyEpicSyncCleanup({
      plan,
      deletedDocumentIds: ['doc:orders'],
    })

    expect(result.plan.reviewBuckets.unresolvedScreenApiCalls).toEqual([
      { path: '/unresolved', resolvedApiDocId: null, unresolvedReason: 'No API match.' },
    ])
  })

  it('does not mutate the input plan nested arrays or objects', () => {
    const plan = planWithOrdersAndBilling()
    const originalOrdersEpic = plan.epics[0]!
    const originalOrdersApiLink = originalOrdersEpic.apiLinks[0]!
    const originalDomainEpicIds = plan.domains![0]!.epicIds

    const result = applyEpicSyncCleanup({
      plan,
      deletedDocumentIds: ['doc:orders'],
    })

    expect(plan.epics[0]).toBe(originalOrdersEpic)
    expect(plan.epics[0]!.apiLinks[0]).toBe(originalOrdersApiLink)
    expect(plan.epics[0]!.apiLinks).toEqual([{ apiDocId: 'doc:orders', role: 'owner', confidence: 'high', reason: 'Orders owner.' }])
    expect(plan.domains![0]!.epicIds).toBe(originalDomainEpicIds)
    expect(plan.domains![0]!.epicIds).toEqual(['epic:orders', 'epic:billing'])
    expect(result.plan.epics[0]).not.toBe(originalOrdersEpic)
    expect(result.plan.epics[0]!.apiLinks).toEqual([])
  })

  it('subtracts deleted unassigned API doc ids from coverage total', () => {
    const plan = planWithCleanupMetadata()

    const result = applyEpicSyncCleanup({
      plan,
      deletedDocumentIds: ['doc:unassigned-api', 'doc:unassigned-api'],
    })

    expect(result.removedDocumentIds).toEqual(['doc:unassigned-api'])
    expect(result.plan.coverage).toEqual({ assignedApiDocs: 2, totalApiDocs: 2 })
  })
})

function planWithOrdersAndBilling(): ReviewableEpicPlan {
  return {
    projectId: 'p1',
    domains: [{ domainId: 'domain:commerce', stableKey: 'commerce', name: 'Commerce', summary: 'Commerce domain', epicIds: ['epic:orders', 'epic:billing'] }],
    epics: [
      {
        tempEpicId: 'epic:orders',
        domainId: 'domain:commerce',
        stableKey: 'orders',
        name: 'Orders',
        abbr: 'ORD',
        summary: 'Orders summary',
        status: 'reviewable',
        confidence: 'high',
        apiLinks: [{ apiDocId: 'doc:orders', role: 'owner', confidence: 'high', reason: 'Orders owner.' }],
        screenLinks: [{ screenDocId: 'doc:orders-screen', role: 'primary', confidence: 'high', reason: 'Orders screen.' }],
        eventLinks: [],
        scheduleLinks: [],
        crossLinks: [{ sourceDocumentId: 'doc:orders', targetTempEpicId: 'epic:billing', kind: 'operational_dependency', role: 'impact', confidence: 'medium', reason: 'Orders affects billing.' }],
        dependencies: [{ targetTempEpicId: 'epic:billing', kind: 'external_call', reason: 'Orders calls billing.' }],
        sourceCandidateKeys: [],
      },
      {
        tempEpicId: 'epic:billing',
        domainId: 'domain:commerce',
        stableKey: 'billing',
        name: 'Billing',
        abbr: 'BIL',
        summary: 'Billing summary',
        status: 'reviewable',
        confidence: 'high',
        apiLinks: [{ apiDocId: 'doc:billing', role: 'owner', confidence: 'high', reason: 'Billing owner.' }],
        screenLinks: [],
        eventLinks: [],
        scheduleLinks: [],
        crossLinks: [],
        dependencies: [{ targetTempEpicId: 'epic:orders', kind: 'external_call', reason: 'Billing references orders.' }],
        sourceCandidateKeys: [],
      },
    ],
    reviewBuckets: {
      unassignedApiDocIds: [],
      unassignedScreenDocIds: [],
      unassignedEventDocIds: [],
      unassignedScheduleDocIds: [],
      orphanEventDocIds: [],
      orphanScheduleDocIds: [],
      unresolvedScreenApiCalls: [],
    },
    coverage: { assignedApiDocs: 2, totalApiDocs: 2 },
    validationIssues: [],
    judgeResults: [],
  }
}

function planWithCleanupMetadata(): ReviewableEpicPlan {
  return {
    ...planWithOrdersAndBilling(),
    reviewBuckets: {
      unassignedApiDocIds: ['doc:unassigned-api', 'doc:keep-api'],
      unassignedScreenDocIds: ['doc:unassigned-screen', 'doc:keep-screen'],
      unassignedEventDocIds: ['doc:unassigned-event', 'doc:keep-event'],
      unassignedScheduleDocIds: ['doc:unassigned-schedule', 'doc:keep-schedule'],
      orphanEventDocIds: ['doc:orphan-event', 'doc:keep-orphan-event'],
      orphanScheduleDocIds: ['doc:orphan-schedule', 'doc:keep-orphan-schedule'],
      unresolvedScreenApiCalls: [
        { path: '/orders', resolvedApiDocId: 'doc:orders', unresolvedReason: null },
        { path: '/unresolved', resolvedApiDocId: null, unresolvedReason: 'No API match.' },
      ],
    },
    coverage: { assignedApiDocs: 2, totalApiDocs: 3 },
    validationIssues: [
      { severity: 'warning', code: 'deleted_document_issue', message: 'Deleted document issue.', documentId: 'doc:orders' },
      { severity: 'warning', code: 'removed_epic_issue', message: 'Removed EPIC issue.', tempEpicId: 'epic:orders' },
      { severity: 'warning', code: 'unrelated_document_issue', message: 'Unrelated document issue.', documentId: 'doc:billing' },
      { severity: 'warning', code: 'unrelated_epic_issue', message: 'Unrelated EPIC issue.', tempEpicId: 'epic:billing' },
    ],
  }
}
