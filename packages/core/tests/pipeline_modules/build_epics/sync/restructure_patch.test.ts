import { describe, expect, it } from 'vitest'
import { applyEpicSyncRestructurePatch } from '@/pipeline_modules/build_epics/sync/restructure_patch.js'
import type { ReviewableEpicPlan } from '@/pipeline_modules/build_epics/core/types.js'

describe('applyEpicSyncRestructurePatch', () => {
  it('applies a split proposal to the reviewable draft only', () => {
    const result = applyEpicSyncRestructurePatch({
      plan: planWithEpic({
        stableKey: 'user_management',
        apiDocIds: ['doc:users', 'doc:roles'],
        screenDocIds: ['doc:user-admin-screen'],
      }),
      submission: {
        actions: [
          {
            type: 'split_epic',
            sourceEpicStableKey: 'user_management',
            newEpics: [
              { stableKey: 'user_profile_management', name: 'User Profile Management', abbr: 'UPM', summary: 'Manage user profile records.' },
              { stableKey: 'role_permission_management', name: 'Role Permission Management', abbr: 'RPM', summary: 'Manage roles and permissions.' },
            ],
            moves: [
              { documentId: 'doc:users', documentType: 'api_spec', toEpicStableKey: 'user_profile_management', role: 'owner', reason: 'User API owns profile management.' },
              { documentId: 'doc:roles', documentType: 'api_spec', toEpicStableKey: 'role_permission_management', role: 'owner', reason: 'Role API owns permissions management.' },
            ],
            reason: 'Backend APIs reveal two independent capabilities.',
          },
        ],
      },
    })

    expect(result.validationIssues).toEqual([])
    expect(result.plan.epics.map((epic) => epic.stableKey)).toEqual(expect.arrayContaining([
      'user_profile_management',
      'role_permission_management',
    ]))
    expect(result.plan.epics.find((epic) => epic.stableKey === 'user_profile_management')?.apiLinks)
      .toEqual(expect.arrayContaining([expect.objectContaining({ apiDocId: 'doc:users' })]))
    expect(result.plan.epics.find((epic) => epic.stableKey === 'role_permission_management')?.apiLinks)
      .toEqual(expect.arrayContaining([expect.objectContaining({ apiDocId: 'doc:roles' })]))
    expect(result.plan.epics.find((epic) => epic.stableKey === 'user_management')?.apiLinks).toEqual([])
  })
})

function planWithEpic(input: {
  stableKey: string
  apiDocIds: string[]
  screenDocIds: string[]
}): ReviewableEpicPlan {
  return {
    projectId: 'p1',
    domains: [],
    epics: [{
      tempEpicId: `epic:${input.stableKey}`,
      stableKey: input.stableKey,
      name: input.stableKey,
      abbr: input.stableKey.slice(0, 3).toUpperCase(),
      summary: `${input.stableKey} summary`,
      status: 'reviewable',
      confidence: 'high',
      apiLinks: input.apiDocIds.map((apiDocId) => ({ apiDocId, role: 'owner', confidence: 'high', reason: 'owner' })),
      screenLinks: input.screenDocIds.map((screenDocId) => ({ screenDocId, role: 'primary', confidence: 'high', reason: 'screen' })),
      eventLinks: [],
      scheduleLinks: [],
      crossLinks: [],
      dependencies: [],
      sourceCandidateKeys: [],
    }],
    reviewBuckets: {
      unassignedApiDocIds: [],
      unassignedScreenDocIds: [],
      unassignedEventDocIds: [],
      unassignedScheduleDocIds: [],
      orphanEventDocIds: [],
      orphanScheduleDocIds: [],
      unresolvedScreenApiCalls: [],
    },
    coverage: { assignedApiDocs: input.apiDocIds.length, totalApiDocs: input.apiDocIds.length },
    validationIssues: [],
    judgeResults: [],
  }
}
