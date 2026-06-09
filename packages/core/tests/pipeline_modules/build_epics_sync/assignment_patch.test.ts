import { describe, expect, it } from 'vitest'
import { applyEpicSyncAssignmentPatch } from '@/pipeline_modules/build_epics_sync/assignment_patch.js'
import type { ReviewableEpicPlan } from '@/pipeline_modules/build_epics_core/types.js'

describe('applyEpicSyncAssignmentPatch', () => {
  it('assigns a changed API document to an existing EPIC and creates a new EPIC for a new API', () => {
    const result = applyEpicSyncAssignmentPatch({
      plan: basePlan(),
      submission: {
        assignments: [
          {
            documentId: 'doc:orders-v2',
            documentType: 'api_spec',
            action: 'assign_existing',
            epicStableKey: 'orders',
            role: 'owner',
            confidence: 'high',
            reason: 'Updated orders API still belongs to Orders.',
          },
          {
            documentId: 'doc:returns',
            documentType: 'api_spec',
            action: 'create_epic',
            role: 'owner',
            confidence: 'medium',
            reason: 'Returns is a separate customer capability.',
            newEpic: { stableKey: 'returns', name: 'Returns', abbr: 'RET', summary: 'Return request and refund initiation.' },
          },
        ],
      },
    })

    expect(result.validationIssues).toEqual([])
    expect(result.appliedDocumentIds).toEqual(['doc:orders-v2', 'doc:returns'])
    expect(result.plan.epics.find((epic) => epic.stableKey === 'orders')?.apiLinks).toEqual([
      expect.objectContaining({ apiDocId: 'doc:orders' }),
      expect.objectContaining({ apiDocId: 'doc:orders-v2', role: 'owner' }),
    ])
    expect(result.plan.epics.find((epic) => epic.stableKey === 'returns')).toMatchObject({
      tempEpicId: 'epic:sync:returns',
      apiLinks: [expect.objectContaining({ apiDocId: 'doc:returns', role: 'owner' })],
      sourceCandidateKeys: ['returns', 'doc:returns'],
    })
    expect(result.plan.coverage).toEqual({ assignedApiDocs: 4, totalApiDocs: 4 })
  })

  it('moves an already linked document to the selected EPIC without leaving duplicate links', () => {
    const result = applyEpicSyncAssignmentPatch({
      plan: basePlan(),
      submission: {
        assignments: [
          {
            documentId: 'doc:billing',
            documentType: 'api_spec',
            action: 'assign_existing',
            epicStableKey: 'orders',
            role: 'owner',
            confidence: 'medium',
            reason: 'Billing route changed and is now handled by Orders.',
          },
        ],
      },
    })

    const orders = result.plan.epics.find((epic) => epic.stableKey === 'orders')
    const billing = result.plan.epics.find((epic) => epic.stableKey === 'billing')
    expect(orders?.apiLinks.map((link) => link.apiDocId)).toEqual(['doc:orders', 'doc:billing'])
    expect(billing?.apiLinks).toEqual([])
    expect(result.plan.epics.flatMap((epic) => epic.apiLinks.filter((link) => link.apiDocId === 'doc:billing'))).toHaveLength(1)
  })

  it('keeps a document unassigned by removing existing links and placing it in the review bucket', () => {
    const result = applyEpicSyncAssignmentPatch({
      plan: basePlan(),
      submission: {
        assignments: [
          {
            documentId: 'doc:orders-screen',
            documentType: 'screen_spec',
            action: 'keep_unassigned',
            role: 'primary',
            confidence: 'low',
            reason: 'The changed screen needs a human EPIC decision.',
          },
        ],
      },
    })

    expect(result.appliedDocumentIds).toEqual(['doc:orders-screen'])
    expect(result.plan.epics.find((epic) => epic.stableKey === 'orders')?.screenLinks).toEqual([])
    expect(result.plan.reviewBuckets.unassignedScreenDocIds).toEqual(['doc:orders-screen'])
  })

  it('records validation issues instead of applying invalid assignment targets', () => {
    const result = applyEpicSyncAssignmentPatch({
      plan: basePlan(),
      submission: {
        assignments: [
          {
            documentId: 'doc:missing-target',
            documentType: 'api_spec',
            action: 'assign_existing',
            epicStableKey: 'missing',
            role: 'owner',
            confidence: 'high',
            reason: 'Unknown target should not be applied.',
          },
        ],
      },
    })

    expect(result.appliedDocumentIds).toEqual([])
    expect(result.validationIssues).toEqual([
      expect.objectContaining({
        severity: 'fatal',
        code: 'UNKNOWN_SYNC_ASSIGNMENT_EPIC',
        documentId: 'doc:missing-target',
      }),
    ])
    expect(result.plan.epics.flatMap((epic) => epic.apiLinks.map((link) => link.apiDocId))).not.toContain('doc:missing-target')
  })
})

function basePlan(): ReviewableEpicPlan {
  return {
    projectId: 'p1',
    domains: [],
    epics: [
      {
        tempEpicId: 'epic:orders',
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
        crossLinks: [],
        dependencies: [],
        sourceCandidateKeys: [],
      },
      {
        tempEpicId: 'epic:billing',
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
        dependencies: [],
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
