import type { SelfImproveDecision, SelfImproveDecisionInput, SelfImproveDecisionResult } from './types.js'

export function classifySelfImproveDecision(input: SelfImproveDecisionInput): SelfImproveDecisionResult {
  if (input.compareScenario === 'incomplete' || input.actualExists === false) {
    return decision('pipeline_fix_required', {
      reason: 'The fixture did not produce complete actual output.',
      mayAutoFixPipeline: true,
      reportRequired: true,
    })
  }

  if (input.contractChangeSuspected === true) {
    return decision('contract_change_reported', {
      reason: 'A contracted pipeline interface change was detected or suspected.',
      contractChange: true,
      reportRequired: true,
    })
  }

  if (input.adapterGapSuspected === true) {
    return decision('adapter_addition_required', {
      reason: 'The mismatch appears to be covered by adding or extending an adapter.',
      adapterAddition: true,
      mayAutoFixPipeline: true,
      reportRequired: true,
    })
  }

  if (input.fixtureScope === 'service' && !input.comparePassed) {
    return decision('manual_review', {
      reason: 'Service fixtures cover multi-repo behavior and remain report-only.',
      reportRequired: true,
    })
  }

  if (input.oracleRequired === true || needsCandidate(input)) {
    return decision('oracle_required', {
      reason: 'An independent candidate from the oracle is required before deciding.',
      reportRequired: true,
    })
  }

  if (input.oracleConfidence === 'low') {
    return decision('manual_review', {
      reason: 'Oracle confidence is too low for automatic promotion.',
      reportRequired: true,
    })
  }

  if (input.expectedExists === true && (input.comparePassed || input.actualMatchesExpected === true)) {
    return decision('pass_existing_expected', {
      reason: 'Existing expected output matches actual output.',
    })
  }

  if (input.expectedExists !== true && input.actualMatchesCandidate === true && input.oracleConfidence !== 'high') {
    return decision('oracle_required', {
      reason: 'High-confidence oracle evidence is required before promoting a new expected output.',
      reportRequired: true,
    })
  }

  if (input.expectedExists !== true && input.actualMatchesCandidate === true) {
    return decision('promote_new_expected', {
      reason: 'No expected output exists and actual output matches the oracle candidate.',
      shouldPromoteCandidate: true,
      reportRequired: true,
    })
  }

  if (input.expectedExists === true && input.actualMatchesCandidate === true && input.oracleConfidence === 'high') {
    return decision('update_stale_expected', {
      reason: 'Existing expected output is stale; high-confidence candidate matches actual output.',
      shouldPromoteCandidate: true,
      shouldOverwriteExpected: true,
      reportRequired: true,
    })
  }

  return decision('manual_review', {
    reason: 'The compare result requires review before changing expected output or pipeline code.',
    reportRequired: true,
  })
}

function needsCandidate(input: SelfImproveDecisionInput): boolean {
  if (input.candidateExists === true || input.candidatePath !== undefined) return false
  if (input.compareScenario === 'A_new') return true
  if (input.expectedExists !== true) return true
  return input.compareScenario === 'C_recheck' && !input.comparePassed
}

function decision(
  decision: SelfImproveDecision,
  opts: Partial<Omit<SelfImproveDecisionResult, 'decision' | 'reason'>> & { reason: string },
): SelfImproveDecisionResult {
  return {
    decision,
    reason: opts.reason,
    shouldPromoteCandidate: opts.shouldPromoteCandidate === true,
    shouldOverwriteExpected: opts.shouldOverwriteExpected === true,
    mayAutoFixPipeline: opts.mayAutoFixPipeline === true,
    contractChange: opts.contractChange === true,
    adapterAddition: opts.adapterAddition === true,
    reportRequired: opts.reportRequired === true,
  }
}

export { SELF_IMPROVE_DECISIONS } from './types.js'
