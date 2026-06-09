import { describe, expect, it } from 'vitest'
import { applyEpicSyncCrossPatch } from '@/pipeline_modules/build_epics/sync/cross_patch.js'
import type { ReviewableEpic, ReviewableEpicPlan } from '@/pipeline_modules/build_epics/core/types.js'

describe('applyEpicSyncCrossPatch', () => {
  it('replaces cross links for affected source documents and removes dependency links that lose evidence', () => {
    const plan = basePlan()
    plan.epics[0]!.crossLinks.push({
      sourceDocumentId: 'doc:orders',
      targetTempEpicId: 'epic:billing',
      kind: 'operational_dependency',
      role: 'impact',
      confidence: 'medium',
      reason: 'Old billing dependency.',
    })
    plan.epics[0]!.dependencies.push({ targetTempEpicId: 'epic:billing', kind: 'external_call', reason: 'Old billing dependency.' })

    const result = applyEpicSyncCrossPatch({
      plan,
      affectedDocumentIds: ['doc:orders'],
      submission: {
        links: [
          {
            sourceDocumentId: 'doc:orders',
            targetEpicStableKey: 'returns',
            kind: 'shared_user_journey',
            role: 'impact',
            confidence: 'medium',
            reason: 'Orders now starts returns journey.',
          },
        ],
      },
    })

    expect(result.validationIssues).toEqual([])
    expect(result.plan.epics.find((epic) => epic.stableKey === 'orders')).toMatchObject({
      crossLinks: [expect.objectContaining({ targetTempEpicId: 'epic:returns', kind: 'shared_user_journey' })],
      dependencies: [expect.objectContaining({ targetTempEpicId: 'epic:returns', kind: 'cross_screen' })],
    })
  })

  it('keeps unrelated cross links for the same owner EPIC while rebuilding dependencies', () => {
    const plan = basePlan()
    plan.epics[0]!.crossLinks.push(
      {
        sourceDocumentId: 'doc:orders',
        targetTempEpicId: 'epic:billing',
        kind: 'operational_dependency',
        role: 'impact',
        confidence: 'medium',
        reason: 'Old billing dependency.',
      },
      {
        sourceDocumentId: 'doc:orders-screen',
        targetTempEpicId: 'epic:returns',
        kind: 'shared_user_journey',
        role: 'reference',
        confidence: 'low',
        reason: 'Screen links to returns.',
      },
    )
    plan.epics[0]!.dependencies.push(
      { targetTempEpicId: 'epic:billing', kind: 'external_call', reason: 'Old billing dependency.' },
      { targetTempEpicId: 'epic:returns', kind: 'cross_screen', reason: 'Screen links to returns.' },
    )

    const result = applyEpicSyncCrossPatch({
      plan,
      affectedDocumentIds: ['doc:orders'],
      submission: { links: [] },
    })

    const orders = result.plan.epics.find((epic) => epic.stableKey === 'orders')
    expect(orders?.crossLinks).toEqual([
      expect.objectContaining({ sourceDocumentId: 'doc:orders-screen', targetTempEpicId: 'epic:returns' }),
    ])
    expect(orders?.dependencies).toEqual([
      expect.objectContaining({ targetTempEpicId: 'epic:returns', kind: 'cross_screen' }),
    ])
  })

  it('records validation issues for unknown targets without adding false cross links', () => {
    const result = applyEpicSyncCrossPatch({
      plan: basePlan(),
      affectedDocumentIds: ['doc:orders'],
      submission: {
        links: [
          {
            sourceDocumentId: 'doc:orders',
            targetEpicStableKey: 'missing',
            kind: 'state_change',
            role: 'impact',
            confidence: 'medium',
            reason: 'Unknown targets should be rejected.',
          },
        ],
      },
    })

    expect(result.appliedLinkCount).toBe(0)
    expect(result.validationIssues).toEqual([
      expect.objectContaining({
        severity: 'fatal',
        code: 'UNKNOWN_SYNC_CROSS_TARGET',
        documentId: 'doc:orders',
      }),
    ])
    expect(result.plan.epics.find((epic) => epic.stableKey === 'orders')?.crossLinks).toEqual([])
  })
})

function basePlan(): ReviewableEpicPlan {
  return {
    projectId: 'p1',
    domains: [],
    epics: [
      epic('epic:orders', 'orders', 'doc:orders', 'doc:orders-screen'),
      epic('epic:billing', 'billing', 'doc:billing'),
      epic('epic:returns', 'returns', 'doc:returns'),
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
    coverage: { assignedApiDocs: 3, totalApiDocs: 3 },
    validationIssues: [],
    judgeResults: [],
  }
}

function epic(tempEpicId: string, stableKey: string, apiDocId: string, screenDocId?: string): ReviewableEpic {
  return {
    tempEpicId,
    stableKey,
    name: stableKey,
    abbr: stableKey.slice(0, 3).toUpperCase(),
    summary: `${stableKey} summary`,
    status: 'reviewable',
    confidence: 'high',
    apiLinks: [{ apiDocId, role: 'owner', confidence: 'high', reason: `${stableKey} owner.` }],
    screenLinks: screenDocId ? [{ screenDocId, role: 'primary', confidence: 'high', reason: `${stableKey} screen.` }] : [],
    eventLinks: [],
    scheduleLinks: [],
    crossLinks: [],
    dependencies: [],
    sourceCandidateKeys: [],
  }
}
