import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeFixtureLane,
  type CorpusStageId,
  type FixtureCorpus,
  type FixtureCorpusEntry,
  type FixtureLane,
  type FixtureSourceGroup,
  type FixtureTier,
  type FixtureVisibility,
  type StageExpectedStatus,
} from './registry.js'

export type FixtureExecutionStatus = 'passed' | 'failed' | 'blocked' | 'skipped'
export type FixtureFailureReason =
  | 'pipeline_bug'
  | 'expected_bug'
  | 'llm_candidate_bug'
  | 'unsupported_pattern'
  | 'fixture_invalid'
  | 'environment_issue'
  | 'prompt_or_cache_drift'
  | 'known_gap'
  | 'missing_expected'
  | 'unknown'
export type FixtureNextAction =
  | 'none'
  | 'fix_adapter'
  | 'review_expected'
  | 'complete_fixture'
  | 'refresh_llm_cache'
  | 'mark_known_gap'
  | 'check_environment'

export interface FixtureCorpusSelection {
  sourceGroup?: FixtureSourceGroup
  framework?: string
  stage?: CorpusStageId
  lane?: FixtureLane
  tier?: FixtureTier
  visibility?: FixtureVisibility
  limit?: number
}

export interface FixtureExecutionPlanOptions {
  lane: FixtureLane
  stages?: CorpusStageId[]
  allowLiveLlm?: boolean
}

export interface FixtureStagePlan {
  stageId: CorpusStageId
  expectedStatus: StageExpectedStatus
  executionTarget: 'full_stage' | 'pre_llm'
  canRun: boolean
  promotionEligible: boolean
  skipReason: string | null
}

export interface FixtureExecutionPlan {
  fixtureId: string
  sourcePath: string
  lane: FixtureLane
  writePolicy: 'report_only'
  llmPolicy: {
    mode: 'forbidden' | 'replay_only' | 'live_candidate_flag_required'
    allowLive: boolean
  }
  stagePlans: FixtureStagePlan[]
}

export interface FixtureExecutionResult {
  fixtureId: string
  sourcePath: string
  lane: FixtureLane
  stageId: CorpusStageId
  status: FixtureExecutionStatus
  expectedStatus: StageExpectedStatus
  failureReason: FixtureFailureReason | null
  nextAction: FixtureNextAction
  reasons: string[]
}

export interface FixtureCorpusReport {
  generatedAt: string
  lane: FixtureLane
  normalizedLane: 'deterministic' | 'llm_discovery' | 'live_candidate'
  writePolicy: 'report_only'
  selection: FixtureCorpusSelection
  acceptedCandidates: string[]
  score: FixtureCorpusScore
  promotionCandidates: FixturePromotionCandidate[]
  results: FixtureExecutionResult[]
  summary: Record<FixtureExecutionStatus, number>
  failureSummary: Partial<Record<FixtureFailureReason, number>>
}

export interface FixtureCorpusScore {
  totalStages: number
  passedStages: number
  failedStages: number
  blockedStages: number
  skippedStages: number
  passRate: number
  runnablePassRate: number
}

export interface FixturePromotionCandidate {
  fixtureId: string
  sourcePath: string
  lane: FixtureLane
  stageId: CorpusStageId
  candidateRelativePath: string
  expectedRelativePath: string
  reason: 'missing_expected' | 'accepted_candidate'
  requiredReview: true
}

export function selectFixtureCorpusEntries(
  corpus: FixtureCorpus,
  selection: FixtureCorpusSelection,
): FixtureCorpusEntry[] {
  const selected = corpus.entries.filter((entry) => {
    if (selection.sourceGroup && entry.sourceGroup !== selection.sourceGroup) return false
    if (selection.framework && entry.framework !== selection.framework) return false
    if (selection.stage && entry.stageExpected[selection.stage] !== 'present') return false
    if (selection.lane && !entry.lanes.some((lane) => normalizeFixtureLane(lane) === normalizeFixtureLane(selection.lane!))) {
      return false
    }
    if (selection.tier && entry.tier !== selection.tier) return false
    if (selection.visibility && entry.visibility !== selection.visibility) return false
    return true
  }).sort((a, b) => a.id.localeCompare(b.id))

  return typeof selection.limit === 'number' ? selected.slice(0, selection.limit) : selected
}

export function createFixtureExecutionPlan(
  entry: FixtureCorpusEntry,
  options: FixtureExecutionPlanOptions,
): FixtureExecutionPlan {
  const lane = normalizeFixtureLane(options.lane)
  const stages = options.stages ?? defaultStagesForLane(options.lane)
  const llmPolicy = llmPolicyForLane(options.lane, options.allowLiveLlm === true)
  const blocked = entry.tier === 'blocked' || entry.visibility === 'local_only'
  const liveBlocked = lane === 'live_candidate' && !llmPolicy.allowLive

  return {
    fixtureId: entry.id,
    sourcePath: entry.sourcePath,
    lane: options.lane,
    writePolicy: 'report_only',
    llmPolicy,
    stagePlans: stages.map((stageId) => {
      const expectedStatus = entry.stageExpected[stageId]
      const executionTarget = (stageId === 'build_docs' || stageId === 'build_docs_sql') && lane === 'deterministic'
        ? 'pre_llm'
        : 'full_stage'
      const canRun = !blocked && !liveBlocked
      return {
        stageId,
        expectedStatus,
        executionTarget,
        canRun,
        promotionEligible: canRun && expectedStatus === 'present',
        skipReason: canRun
          ? null
          : liveBlocked
            ? 'live candidate lane requires explicit live LLM opt-in'
            : 'fixture is blocked or local-only',
      }
    }),
  }
}

export function classifyFixtureExecution(input: {
  fixtureId: string
  sourcePath: string
  lane: FixtureLane
  stageId: CorpusStageId
  expectedStatus: StageExpectedStatus
  assertion?: { passed: boolean; reasons: string[] } | null
  knownGaps?: string[]
  error?: Error
  blockedReason?: string
}): FixtureExecutionResult {
  if (input.blockedReason) {
    return result(input, 'blocked', 'fixture_invalid', 'complete_fixture', [input.blockedReason])
  }
  if (input.error) {
    const message = input.error.message
    if (/cache miss|missing cache|prompt hash/i.test(message)) {
      return result(input, 'failed', 'prompt_or_cache_drift', 'refresh_llm_cache', [message])
    }
    if (/enoent|permission|timeout|environment|flag required/i.test(message)) {
      return result(input, 'failed', 'environment_issue', 'check_environment', [message])
    }
    return result(input, 'failed', 'unknown', 'fix_adapter', [message])
  }
  if (input.expectedStatus === 'missing') {
    return result(input, 'skipped', 'missing_expected', 'review_expected', ['stage expected file is missing'])
  }
  if (!input.assertion) {
    return result(input, 'skipped', 'missing_expected', 'review_expected', ['stage assertion was not evaluated'])
  }
  if (input.assertion.passed) return result(input, 'passed', null, 'none', input.assertion.reasons)
  if ((input.knownGaps ?? []).some((gap) => input.assertion!.reasons.some((reason) => reason.includes(gap)))) {
    return result(input, 'failed', 'known_gap', 'mark_known_gap', input.assertion.reasons)
  }
  if (input.assertion.reasons.some((reason) => /expected|snapshot|oracle/i.test(reason))) {
    return result(input, 'failed', 'expected_bug', 'review_expected', input.assertion.reasons)
  }
  if (input.assertion.reasons.some((reason) => /llm|candidate|prompt/i.test(reason))) {
    return result(input, 'failed', 'llm_candidate_bug', 'refresh_llm_cache', input.assertion.reasons)
  }
  if (input.assertion.reasons.some((reason) => /unsupported|not supported|missing adapter/i.test(reason))) {
    return result(input, 'failed', 'unsupported_pattern', 'fix_adapter', input.assertion.reasons)
  }
  return result(input, 'failed', 'pipeline_bug', 'fix_adapter', input.assertion.reasons)
}

export function buildFixtureCorpusReport(input: {
  lane: FixtureLane
  selection: FixtureCorpusSelection
  results: FixtureExecutionResult[]
  generatedAt?: string
}): FixtureCorpusReport {
  const summary: Record<FixtureExecutionStatus, number> = { passed: 0, failed: 0, blocked: 0, skipped: 0 }
  const failureSummary: Partial<Record<FixtureFailureReason, number>> = {}
  const resultsByFixture = new Map<string, FixtureExecutionResult[]>()

  for (const item of input.results) {
    summary[item.status] += 1
    if (item.failureReason) failureSummary[item.failureReason] = (failureSummary[item.failureReason] ?? 0) + 1
    const fixtureResults = resultsByFixture.get(item.fixtureId) ?? []
    fixtureResults.push(item)
    resultsByFixture.set(item.fixtureId, fixtureResults)
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    lane: input.lane,
    normalizedLane: normalizeFixtureLane(input.lane),
    writePolicy: 'report_only',
    selection: input.selection,
    acceptedCandidates: [...resultsByFixture.entries()]
      .filter(([, fixtureResults]) => fixtureResults.every((item) => item.status === 'passed'))
      .map(([fixtureId]) => fixtureId)
      .sort(),
    score: buildScore(input.results),
    promotionCandidates: buildPromotionCandidates(input.lane, input.results),
    results: input.results,
    summary,
    failureSummary,
  }
}

export function writeFixtureCorpusReport(report: FixtureCorpusReport, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true })
  const reportPath = join(outputDir, `fixture-corpus-report-${report.lane}.json`)
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  return reportPath
}

function defaultStagesForLane(lane: FixtureLane): CorpusStageId[] {
  const normalized = normalizeFixtureLane(lane)
  if (normalized === 'deterministic') {
    return ['analyze_repo', 'build_graph', 'build_pattern_profile', 'build_models', 'build_route', 'build_relations', 'build_service_map', 'build_docs_sql']
  }
  if (normalized === 'llm_discovery') {
    return ['analyze_repo', 'build_graph', 'build_pattern_profile', 'static_analysis_dsl_discovery', 'build_models', 'build_route', 'build_relations', 'build_service_map', 'build_docs_sql']
  }
  return ['analyze_repo', 'build_graph', 'build_pattern_profile', 'static_analysis_dsl_discovery', 'build_models', 'build_route', 'build_relations', 'build_docs', 'build_docs_sql']
}

function llmPolicyForLane(lane: FixtureLane, allowLive: boolean): FixtureExecutionPlan['llmPolicy'] {
  const normalized = normalizeFixtureLane(lane)
  if (normalized === 'deterministic') return { mode: 'forbidden', allowLive: false }
  if (normalized === 'llm_discovery') return { mode: 'replay_only', allowLive: false }
  return { mode: 'live_candidate_flag_required', allowLive }
}

function buildScore(results: FixtureExecutionResult[]): FixtureCorpusScore {
  const totalStages = results.length
  const passedStages = results.filter((result) => result.status === 'passed').length
  const failedStages = results.filter((result) => result.status === 'failed').length
  const blockedStages = results.filter((result) => result.status === 'blocked').length
  const skippedStages = results.filter((result) => result.status === 'skipped').length
  const runnableStages = passedStages + failedStages
  return {
    totalStages,
    passedStages,
    failedStages,
    blockedStages,
    skippedStages,
    passRate: ratio(passedStages, totalStages),
    runnablePassRate: ratio(passedStages, runnableStages),
  }
}

function buildPromotionCandidates(lane: FixtureLane, results: FixtureExecutionResult[]): FixturePromotionCandidate[] {
  return results
    .filter((result) => result.nextAction === 'review_expected' && result.failureReason === 'missing_expected')
    .map((result) => ({
      fixtureId: result.fixtureId,
      sourcePath: result.sourcePath,
      lane,
      stageId: result.stageId,
      candidateRelativePath: join('candidate', `${result.stageId}.json`),
      expectedRelativePath: join('expected', `${result.stageId}.json`),
      reason: 'missing_expected',
      requiredReview: true,
    }))
}

function result(
  input: {
    fixtureId: string
    sourcePath: string
    lane: FixtureLane
    stageId: CorpusStageId
    expectedStatus: StageExpectedStatus
  },
  status: FixtureExecutionStatus,
  failureReason: FixtureFailureReason | null,
  nextAction: FixtureNextAction,
  reasons: string[],
): FixtureExecutionResult {
  return {
    fixtureId: input.fixtureId,
    sourcePath: input.sourcePath,
    lane: input.lane,
    stageId: input.stageId,
    status,
    expectedStatus: input.expectedStatus,
    failureReason,
    nextAction,
    reasons,
  }
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Number((numerator / denominator).toFixed(4))
}
