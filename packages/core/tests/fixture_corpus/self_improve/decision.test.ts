import { describe, expect, it } from 'vitest'
import { classifySelfImproveDecision } from '../../../src/fixture_corpus/self_improve/index.js'
import type { SelfImproveDecisionInput } from '../../../src/fixture_corpus/self_improve/index.js'

const baseInput: SelfImproveDecisionInput = {
  fixtureId: 'repo/orm-e2e/prisma-examples-express',
  fixtureScope: 'repo',
  stage: 'build_models',
  compareScenario: 'C_recheck',
  comparePassed: false,
  expectedExists: true,
  actualExists: true,
  candidateExists: true,
  actualMatchesCandidate: true,
  oracleConfidence: 'high',
}

describe('classifySelfImproveDecision', () => {
  it('passes existing expected output when actual already matches it', () => {
    expect(classifySelfImproveDecision({
      ...baseInput,
      comparePassed: true,
      actualMatchesExpected: true,
      candidateExists: false,
      actualMatchesCandidate: false,
    })).toMatchObject({
      decision: 'pass_existing_expected',
      shouldPromoteCandidate: false,
      reportRequired: false,
    })
  })

  it('promotes a new expected output only with high-confidence candidate evidence', () => {
    expect(classifySelfImproveDecision({
      ...baseInput,
      compareScenario: 'A_new',
      comparePassed: true,
      expectedExists: false,
      actualMatchesCandidate: true,
    })).toMatchObject({
      decision: 'promote_new_expected',
      shouldPromoteCandidate: true,
      shouldOverwriteExpected: false,
      reportRequired: true,
    })
  })

  it('updates stale expected output when candidate and actual match with high confidence', () => {
    expect(classifySelfImproveDecision(baseInput)).toMatchObject({
      decision: 'update_stale_expected',
      shouldPromoteCandidate: true,
      shouldOverwriteExpected: true,
      reportRequired: true,
    })
  })

  it('keeps pipeline, adapter, contract, and service mismatches report-only', () => {
    expect(classifySelfImproveDecision({
      ...baseInput,
      compareScenario: 'incomplete',
      actualExists: false,
    })).toMatchObject({ decision: 'pipeline_fix_required', mayAutoFixPipeline: true })

    expect(classifySelfImproveDecision({ ...baseInput, adapterGapSuspected: true }))
      .toMatchObject({ decision: 'adapter_addition_required', adapterAddition: true })

    expect(classifySelfImproveDecision({ ...baseInput, contractChangeSuspected: true }))
      .toMatchObject({ decision: 'contract_change_reported', contractChange: true })

    expect(classifySelfImproveDecision({ ...baseInput, fixtureScope: 'service', stage: 'build_service_map' }))
      .toMatchObject({ decision: 'manual_review', shouldPromoteCandidate: false })
  })
})
