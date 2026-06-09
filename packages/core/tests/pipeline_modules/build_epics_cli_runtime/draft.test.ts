import { describe, expect, it } from 'vitest'
import { buildDraftFromRuntimeSubmissions, validateBuildEpicsDraft } from '@/pipeline_modules/build_epics_cli_runtime/draft.js'
import type { ApiDocIndexItem, BuildEpicsDocIndex } from '@/pipeline_modules/build_epics_core/types.js'

describe('build_epics CLI runtime draft helpers', () => {
  it('builds a reviewable draft from taxonomy and assignment submissions', () => {
    const draft = buildDraftFromRuntimeSubmissions({
      projectId: 'project:test',
      taxonomyResults: [{
        domains: [{ domainId: 'domain:commerce', stableKey: 'commerce', name: 'Commerce', summary: 'Commerce domain.' }],
        epics: [{ tempEpicId: 'epic:orders', domainId: 'domain:commerce', stableKey: 'orders', name: 'Orders', abbr: 'ORD', summary: 'Orders EPIC.' }],
      }],
      assignmentResults: [{
        assignments: [{ documentId: 'api:orders', epicKey: 'orders', role: 'owner', confidence: 'high', reason: 'Order API.' }],
      }],
      docIndex: docIndexForRuntime(['api:orders']),
    })

    expect(draft.domains).toEqual([
      { domainId: 'domain:commerce', stableKey: 'commerce', name: 'Commerce', summary: 'Commerce domain.', epicIds: ['epic:orders'] },
    ])
    expect(draft.epics).toHaveLength(1)
    expect(draft.epics[0]?.apiLinks).toEqual([{ apiDocId: 'api:orders', role: 'owner', confidence: 'high', reason: 'Order API.' }])
    expect(draft.coverage).toEqual({ assignedApiDocs: 1, totalApiDocs: 1 })
    expect(draft.validationIssues).toEqual([])
  })

  it('uses consolidated taxonomy instead of duplicate raw candidates and records alias sources', () => {
    const draft = buildDraftFromRuntimeSubmissions({
      projectId: 'project:test',
      taxonomyResults: [{
        domains: [{ domainId: 'domain:raw-commerce', stableKey: 'raw_commerce', name: 'Raw Commerce', summary: 'Raw commerce domain.' }],
        epics: [
          { tempEpicId: 'epic:orders_raw', domainId: 'domain:raw-commerce', stableKey: 'orders_raw', name: 'Orders Raw', abbr: 'OR1', summary: 'Raw orders candidate.' },
          { tempEpicId: 'epic:orders_duplicate', domainId: 'domain:raw-commerce', stableKey: 'orders_duplicate', name: 'Orders Duplicate', abbr: 'OR2', summary: 'Duplicate orders candidate.' },
        ],
      }],
      consolidatedTaxonomyResult: {
        domains: [{ domainId: 'domain:commerce', stableKey: 'commerce', name: 'Commerce', summary: 'Commerce domain.' }],
        epics: [{ tempEpicId: 'epic:orders', domainId: 'domain:commerce', stableKey: 'orders', name: 'Orders', abbr: 'ORD', summary: 'Consolidated orders EPIC.' }],
        aliases: [
          { fromStableKey: 'orders_raw', toStableKey: 'orders', reason: 'Same order management boundary.' },
          { fromStableKey: 'orders_duplicate', toStableKey: 'orders', reason: 'Duplicate order management candidate.' },
        ],
      },
      assignmentResults: [],
      docIndex: docIndexForRuntime([]),
    })

    expect(draft.domains).toEqual([
      { domainId: 'domain:commerce', stableKey: 'commerce', name: 'Commerce', summary: 'Commerce domain.', epicIds: ['epic:orders'] },
    ])
    expect(draft.epics.map((epic) => epic.stableKey)).toEqual(['orders'])
    expect(draft.epics[0]?.sourceCandidateKeys).toEqual(['orders', 'orders_raw', 'orders_duplicate'])
  })

  it('reports duplicate API owners as fatal validation issues', () => {
    const draft = buildDraftFromRuntimeSubmissions({
      projectId: 'project:test',
      taxonomyResults: [{
        domains: [{ domainId: 'domain:commerce', stableKey: 'commerce', name: 'Commerce', summary: 'Commerce domain.' }],
        epics: [
          { tempEpicId: 'epic:orders', domainId: 'domain:commerce', stableKey: 'orders', name: 'Orders', abbr: 'ORD', summary: 'Orders EPIC.' },
          { tempEpicId: 'epic:fulfillment', domainId: 'domain:commerce', stableKey: 'fulfillment', name: 'Fulfillment', abbr: 'FUL', summary: 'Fulfillment EPIC.' },
        ],
      }],
      assignmentResults: [{
        assignments: [
          { documentId: 'api:orders', epicKey: 'orders', role: 'owner', confidence: 'high', reason: 'Order API.' },
          { documentId: 'api:orders', epicKey: 'fulfillment', role: 'owner', confidence: 'medium', reason: 'Duplicate owner.' },
        ],
      }],
      docIndex: docIndexForRuntime(['api:orders']),
    })

    const validation = validateBuildEpicsDraft(draft, { maxReviewRatioWarning: 0.2, maxReviewRatioFatal: 0.35 })

    expect(validation.fatal).toEqual([expect.objectContaining({ code: 'DUPLICATE_API_OWNER', documentId: 'api:orders' })])
    expect(validation.warnings).toEqual([])
  })

  it('marks unassigned API documents as fatal and applies review ratio warnings', () => {
    const draft = buildDraftFromRuntimeSubmissions({
      projectId: 'project:test',
      taxonomyResults: [{
        domains: [{ domainId: 'domain:commerce', stableKey: 'commerce', name: 'Commerce', summary: 'Commerce domain.' }],
        epics: [{ tempEpicId: 'epic:orders', domainId: 'domain:commerce', stableKey: 'orders', name: 'Orders', abbr: 'ORD', summary: 'Orders EPIC.' }],
      }],
      assignmentResults: [{
        assignments: [
          { documentId: 'api:orders', epicKey: 'orders', role: 'owner', confidence: 'high', reason: 'Order API.' },
          { documentId: 'api:unassigned', epicKey: 'orders', role: 'review', confidence: 'low', reason: 'Needs manual review.' },
        ],
      }],
      docIndex: docIndexForRuntime(['api:orders', 'api:users', 'api:payments', 'api:unassigned']),
    })

    const validation = validateBuildEpicsDraft(draft, { maxReviewRatioWarning: 0.2, maxReviewRatioFatal: 0.8 })

    expect(validation.fatal).toEqual([
      expect.objectContaining({ code: 'MISSING_API_OWNER', documentId: 'api:users' }),
      expect.objectContaining({ code: 'MISSING_API_OWNER', documentId: 'api:payments' }),
      expect.objectContaining({ code: 'MISSING_API_OWNER', documentId: 'api:unassigned' }),
    ])
    expect(validation.warnings).toEqual([expect.objectContaining({ code: 'REVIEW_RATIO_WARNING' })])
  })

  it('attaches cross-domain links and dependencies to the source owner EPIC', () => {
    const draft = buildDraftFromRuntimeSubmissions({
      projectId: 'project:test',
      taxonomyResults: [{
        domains: [{ domainId: 'domain:service', stableKey: 'service', name: 'Service', summary: 'Service domain.' }],
        epics: [
          { tempEpicId: 'epic:diary', domainId: 'domain:service', stableKey: 'diary', name: 'Diary', abbr: 'DRY', summary: 'Diary writing.' },
          { tempEpicId: 'epic:point_rewards', domainId: 'domain:service', stableKey: 'point_rewards', name: 'Point Rewards', abbr: 'PNT', summary: 'Point rewards.' },
        ],
      }],
      assignmentResults: [{
        assignments: [{ documentId: 'api:diary:create', epicKey: 'diary', role: 'owner', confidence: 'high', reason: 'Diary write API.' }],
      }],
      crossDomainResults: [{
        links: [{
          sourceDocumentId: 'api:diary:create',
          targetTempEpicId: 'epic:point_rewards',
          kind: 'reward_or_coupon_effect',
          role: 'impact',
          confidence: 'high',
          reason: 'Diary writing grants reward points.',
        }],
      }],
      docIndex: docIndexForRuntime(['api:diary:create']),
    })

    const diaryEpic = draft.epics.find((epic) => epic.tempEpicId === 'epic:diary')
    expect(diaryEpic?.crossLinks).toEqual([expect.objectContaining({
      sourceDocumentId: 'api:diary:create',
      targetTempEpicId: 'epic:point_rewards',
      kind: 'reward_or_coupon_effect',
    })])
    expect(diaryEpic?.dependencies).toEqual([expect.objectContaining({
      targetTempEpicId: 'epic:point_rewards',
      kind: 'cross_domain_state_change',
    })])
  })
})

function docIndexForRuntime(apiDocIds: string[]): BuildEpicsDocIndex {
  return {
    projectId: 'project:test',
    apis: apiDocIds.map(apiDoc),
    screens: [],
    events: [],
    schedules: [],
  }
}

function apiDoc(documentId: string): ApiDocIndexItem {
  return {
    documentId,
    projectId: 'project:test',
    type: 'api_spec',
    status: 'passed',
    filePath: null,
    title: documentId,
    summary: `${documentId} summary.`,
    evidenceGaps: [],
    relationEvidence: null,
    actorHints: [],
    domainHints: [],
    operationKey: null,
    routePattern: null,
    method: 'GET',
    path: `/${documentId}`,
    handler: `${documentId}Handler`,
    sourceFilePath: '/repo/api.ts',
    access: null,
    authRequired: null,
    tables: [],
    eventsPublished: [],
    externalCalls: [],
    businessLogic: [],
    businessRules: [],
  }
}
