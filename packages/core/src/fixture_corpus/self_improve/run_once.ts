import { copyFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CorpusStageId, FixtureCorpusEntry } from '../registry.js'
import { loadFixture } from '../load.js'
import { appendRunLogRecord, readRunLog, type RunLogRecord } from '../run_log.js'
import { classifySelfImproveDecision } from './decision.js'
import { requestOracleCandidate, type OracleCandidateResult, type OracleProvider } from './oracle.js'
import { createCodexOracleProvider } from './codex_oracle_provider.js'
import { writeSelfImproveReport } from './reports.js'
import { SELF_IMPROVE_FAILURE_LIMIT, type OracleCandidate, type SelfImproveDecisionResult, type SelfImproveStage } from './types.js'
import { resolveSelfImproveStages, stagesWithDependencies } from './stage_order.js'

export interface SelfImproveOnceOptions {
  id?: string
  next?: boolean
  stage?: SelfImproveStage
  reuseCandidate?: boolean
  contractChangeSuspected?: boolean
  adapterGapSuspected?: boolean
  oracleProvider?: OracleProvider
  rootDir?: string
}

export interface SelfImproveOnceOutput {
  exitCode: 0 | 1 | 2
  lines: string[]
  fixtureId?: string
  reportPath?: string
  requestPath?: string
}

export interface RunFixtureOutput {
  exitCode: 0 | 1
  lines: string[]
}

export interface CompareOutput {
  exitCode: 0 | 1
  scenario: 'A_new' | 'B_regression' | 'C_recheck' | 'incomplete'
  lines: string[]
  facts?: {
    expectedMatchesActual?: boolean
    candidateMatchesActual?: boolean
    candidateMatchesExpected?: boolean
  }
}

export interface SelfImproveOnceDeps {
  loadFixture: (id: string) => FixtureCorpusEntry | null
  runFixture: (input: { id: string; stages: SelfImproveStage[] }) => Promise<RunFixtureOutput>
  compare: (input: { id: string; stage: SelfImproveStage }) => Promise<CompareOutput>
  requestOracle: typeof requestOracleCandidate
  createOracleProvider: () => OracleProvider
  writeReport: typeof writeSelfImproveReport
  appendLog: typeof appendRunLogRecord
  readLog: typeof readRunLog
  promoteCandidate: (input: {
    candidatePath: string
    expectedPath: string
    allowOverwrite: boolean
    sourceEvidence: string[]
    fixtureScope: FixtureCorpusEntry['layout']['scope']
  }) => Promise<void>
  now: () => Date
}

export async function runSelfImproveOnce(
  options: SelfImproveOnceOptions,
  deps: Partial<SelfImproveOnceDeps> = {},
): Promise<SelfImproveOnceOutput> {
  const fullDeps = createDeps(deps)
  const fixtureId = options.id ?? null
  if (fixtureId === null) return { exitCode: 1, lines: ['self-improve: no fixture selected'] }
  const entry = fullDeps.loadFixture(fixtureId)
  if (!entry) return { exitCode: 1, lines: [`fixture not found: ${fixtureId}`], fixtureId }

  const rootDir = options.rootDir ?? process.cwd()
  const stage = options.stage ?? 'build_models'
  const fixtureDir = join(rootDir, entry.sourcePath)
  const runLogPath = join(fixtureDir, 'run_log.jsonl')
  const cycle = await nextCycle(runLogPath, fullDeps)
  const timestamp = fullDeps.now().toISOString()
  const budgetStage = stage === 'all' ? resolveSelfImproveStages(entry.layout.scope).at(-1)! : stage
  const lines = [`self-improve fixture=${fixtureId} stage=${stage}`]

  if (await countRecentStageFailures(runLogPath, fullDeps, fixtureId, budgetStage) >= SELF_IMPROVE_FAILURE_LIMIT) {
    const decision = manualReviewDecision(`failure budget exceeded for fixture=${fixtureId} stage=${budgetStage}`)
    const reportPath = fullDeps.writeReport({
      fixtureDir,
      fixtureId,
      stage: budgetStage,
      decision,
      paths: pathsForStage(budgetStage),
      timestamp,
    })
    await appendDecisionLog(fullDeps, runLogPath, cycle, fixtureId, budgetStage, decision, reportPath)
    return { exitCode: 1, lines: [...lines, 'failure budget exceeded', `decision ${decision.decision} report=${reportPath}`], fixtureId, reportPath }
  }

  await fullDeps.appendLog(runLogPath, {
    timestamp,
    cycle,
    phase: 'select',
    status: 'advisory',
    fixtureId,
    stageId: stage,
    reason: 'explicit id',
  })

  const stagesToRun = stage === 'all' ? resolveSelfImproveStages(entry.layout.scope) : stagesWithDependencies(stage as CorpusStageId)
  const runOut = await fullDeps.runFixture({ id: fixtureId, stages: stagesToRun })
  lines.push(...runOut.lines.map((line) => `run ${line}`))
  await fullDeps.appendLog(runLogPath, {
    timestamp: fullDeps.now().toISOString(),
    cycle,
    phase: 'run',
    status: runOut.exitCode === 0 ? 'pass' : 'fail',
    fixtureId,
    stageId: stagesToRun.at(-1),
  })

  if (stage === 'all') {
    const decision = runOut.exitCode === 0
      ? passDecision('Fixture-wide self-improve stages completed successfully.')
      : manualReviewDecision('Fixture-wide self-improve stages did not complete successfully.')
    await appendDecisionLog(fullDeps, runLogPath, cycle, fixtureId, stagesToRun.at(-1)!, decision)
    return {
      exitCode: runOut.exitCode === 0 ? 0 : 1,
      lines: [...lines, `fixture-wide stages=${stagesToRun.join(',')}`, `decision ${decision.decision}`],
      fixtureId,
    }
  }

  const paths = pathsForStage(stage)
  if (runOut.exitCode !== 0 && !existsSync(join(fixtureDir, paths.actual))) {
    const decision = classifySelfImproveDecision({
      fixtureId,
      fixtureScope: entry.layout.scope,
      stage,
      compareScenario: 'incomplete',
      comparePassed: false,
      actualExists: false,
    })
    const reportPath = fullDeps.writeReport({ fixtureDir, fixtureId, stage, decision, paths, timestamp })
    await appendDecisionLog(fullDeps, runLogPath, cycle, fixtureId, stage, decision, reportPath)
    return { exitCode: 1, lines: [...lines, `decision ${decision.decision} report=${reportPath}`], fixtureId, reportPath }
  }

  let compare = await compareAndLog(fullDeps, runLogPath, cycle, fixtureId, stage, lines)
  let candidate: OracleCandidate | undefined
  if (shouldRequestOracle(compare, fixtureDir, paths, options, entry)) {
    const oracle = await fullDeps.requestOracle({
      fixtureDir,
      fixtureId,
      stage,
      provider: options.oracleProvider ?? fullDeps.createOracleProvider(),
      reuseExistingCandidate: options.reuseCandidate,
      timestamp: fullDeps.now().toISOString(),
    })
    if (oracle.status === 'required') {
      await fullDeps.appendLog(runLogPath, {
        timestamp: fullDeps.now().toISOString(),
        cycle,
        phase: 'oracle',
        status: 'advisory',
        fixtureId,
        stageId: stage,
        reportPath: oracle.requestPath,
      })
      return { exitCode: 2, lines: [...lines, `oracle required request=${oracle.requestPath}`], fixtureId, requestPath: oracle.requestPath }
    }
    candidate = oracle.candidate
    await appendOracleLog(fullDeps, runLogPath, cycle, fixtureId, stage, oracle)
    compare = await compareAndLog(fullDeps, runLogPath, cycle, fixtureId, stage, lines)
  }

  const decision = classifySelfImproveDecision({
    fixtureId,
    fixtureScope: entry.layout.scope,
    stage,
    compareScenario: compare.scenario,
    comparePassed: compare.exitCode === 0,
    expectedPath: join(fixtureDir, paths.expected),
    actualPath: join(fixtureDir, paths.actual),
    candidatePath: candidate?.candidatePath ?? join(fixtureDir, paths.candidate),
    expectedExists: existsSync(join(fixtureDir, paths.expected)),
    actualExists: existsSync(join(fixtureDir, paths.actual)),
    candidateExists: existsSync(candidate?.candidatePath ?? join(fixtureDir, paths.candidate)),
    actualMatchesExpected: compare.facts?.expectedMatchesActual,
    actualMatchesCandidate: compare.facts?.candidateMatchesActual,
    oracleConfidence: candidate?.confidence,
    contractChangeSuspected: options.contractChangeSuspected,
    adapterGapSuspected: options.adapterGapSuspected,
  })

  let reportPath: string | undefined
  if (decision.reportRequired) {
    reportPath = fullDeps.writeReport({
      fixtureDir,
      fixtureId,
      stage,
      decision,
      paths,
      ...(candidate ? { oracle: candidate } : {}),
      timestamp: fullDeps.now().toISOString(),
    })
  }
  if (decision.shouldPromoteCandidate) {
    await fullDeps.promoteCandidate({
      candidatePath: candidate?.candidatePath ?? join(fixtureDir, paths.candidate),
      expectedPath: join(fixtureDir, paths.expected),
      allowOverwrite: decision.shouldOverwriteExpected,
      sourceEvidence: candidate?.evidence.map((item) => `${item.path}: ${item.summary}`) ?? [],
      fixtureScope: entry.layout.scope,
    })
  }

  await appendDecisionLog(fullDeps, runLogPath, cycle, fixtureId, stage, decision, reportPath)
  lines.push(`decision ${decision.decision}${reportPath ? ` report=${reportPath}` : ''}`)
  return {
    exitCode: decision.decision === 'pass_existing_expected' || decision.shouldPromoteCandidate ? 0 : 1,
    lines,
    fixtureId,
    reportPath,
  }
}

function createDeps(deps: Partial<SelfImproveOnceDeps>): SelfImproveOnceDeps {
  return {
    loadFixture,
    runFixture: async ({ id }) => ({ exitCode: 0, lines: [`PASS ${id}`] }),
    compare: compareFiles,
    requestOracle: requestOracleCandidate,
    createOracleProvider: () => createCodexOracleProvider(),
    writeReport: writeSelfImproveReport,
    appendLog: appendRunLogRecord,
    readLog: readRunLog,
    promoteCandidate: async ({ candidatePath, expectedPath, allowOverwrite, sourceEvidence, fixtureScope }) => {
      if (sourceEvidence.length === 0) throw new Error('source evidence is required before promoting fixture candidate output')
      if (fixtureScope === 'service') throw new Error('service scope fixtures require manual review before promotion')
      if (existsSync(expectedPath) && !allowOverwrite) throw new Error(`expected output already exists: ${expectedPath}`)
      mkdirSync(dirname(expectedPath), { recursive: true })
      await copyFile(candidatePath, expectedPath)
    },
    now: () => new Date(),
    ...deps,
  }
}

async function compareFiles({ id: fixtureId, stage }: { id: string; stage: SelfImproveStage }): Promise<CompareOutput> {
  const entry = loadFixture(fixtureId)
  if (!entry) return { exitCode: 1, scenario: 'incomplete', lines: ['fixture not found'] }
  const fixtureDir = join(process.cwd(), entry.sourcePath)
  const paths = pathsForStage(stage)
  const actual = readJsonIfExists(join(fixtureDir, paths.actual))
  const expected = readJsonIfExists(join(fixtureDir, paths.expected))
  const candidate = readJsonIfExists(join(fixtureDir, paths.candidate))
  if (actual === undefined) return { exitCode: 1, scenario: 'incomplete', lines: ['actual missing'] }
  const expectedMatchesActual = expected !== undefined && stableJson(expected) === stableJson(actual)
  const candidateMatchesActual = candidate !== undefined && stableJson(candidate) === stableJson(actual)
  if (expected === undefined) {
    return { exitCode: candidateMatchesActual ? 0 : 1, scenario: 'A_new', lines: ['expected missing'], facts: { candidateMatchesActual } }
  }
  return {
    exitCode: expectedMatchesActual ? 0 : 1,
    scenario: expectedMatchesActual ? 'B_regression' : 'C_recheck',
    lines: [expectedMatchesActual ? 'expected matches actual' : 'expected differs from actual'],
    facts: { expectedMatchesActual, candidateMatchesActual },
  }
}

function readJsonIfExists(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf-8')) as unknown
}

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}

async function compareAndLog(
  deps: SelfImproveOnceDeps,
  runLogPath: string,
  cycle: number,
  fixtureId: string,
  stage: SelfImproveStage,
  lines: string[],
): Promise<CompareOutput> {
  const compare = await deps.compare({ id: fixtureId, stage })
  lines.push(...compare.lines.map((line) => `compare ${line}`))
  await deps.appendLog(runLogPath, {
    timestamp: deps.now().toISOString(),
    cycle,
    phase: 'compare',
    status: compare.exitCode === 0 ? 'pass' : 'fail',
    fixtureId,
    stageId: stage,
    scenario: compare.scenario,
  })
  return compare
}

async function appendOracleLog(
  deps: SelfImproveOnceDeps,
  runLogPath: string,
  cycle: number,
  fixtureId: string,
  stage: SelfImproveStage,
  oracle: Extract<OracleCandidateResult, { status: 'ready' }>,
): Promise<void> {
  await deps.appendLog(runLogPath, {
    timestamp: deps.now().toISOString(),
    cycle,
    phase: 'oracle',
    status: 'pass',
    fixtureId,
    stageId: stage,
    candidatePath: oracle.candidate.candidatePath,
  })
}

async function appendDecisionLog(
  deps: SelfImproveOnceDeps,
  runLogPath: string,
  cycle: number,
  fixtureId: string,
  stage: SelfImproveStage,
  decision: SelfImproveDecisionResult,
  reportPath?: string,
): Promise<void> {
  await deps.appendLog(runLogPath, {
    timestamp: deps.now().toISOString(),
    cycle,
    phase: 'decision',
    status: decision.decision === 'pass_existing_expected' || decision.shouldPromoteCandidate ? 'pass' : 'fail',
    fixtureId,
    stageId: stage,
    decision: decision.decision,
    ...(reportPath ? { reportPath } : {}),
  })
}

async function nextCycle(path: string, deps: SelfImproveOnceDeps): Promise<number> {
  const records = await deps.readLog(path)
  if (records.length === 0) return 1
  return Math.max(...records.map((record) => record.cycle)) + 1
}

async function countRecentStageFailures(
  path: string,
  deps: SelfImproveOnceDeps,
  fixtureId: string,
  stage: SelfImproveStage,
): Promise<number> {
  const records = await deps.readLog(path)
  return records.filter((record) =>
    record.phase === 'decision'
    && record.fixtureId === fixtureId
    && record.stageId === stage
    && record.status !== 'pass'
  ).length
}

function shouldRequestOracle(
  compare: CompareOutput,
  fixtureDir: string,
  paths: SelfImproveReportPaths,
  options: SelfImproveOnceOptions,
  entry: FixtureCorpusEntry,
): boolean {
  if (!existsSync(join(fixtureDir, paths.actual))) return false
  if (entry.layout.scope === 'service') return false
  if (options.contractChangeSuspected === true || options.adapterGapSuspected === true) return false
  if (compare.scenario === 'A_new' && compare.exitCode === 0) return true
  if (compare.exitCode === 0) return false
  return !existsSync(join(fixtureDir, paths.candidate)) || options.reuseCandidate === true || options.oracleProvider !== undefined
}

interface SelfImproveReportPaths {
  actual: string
  candidate: string
  expected: string
}

function pathsForStage(stage: SelfImproveStage): SelfImproveReportPaths {
  return {
    actual: join('actual', `${stage}.json`),
    candidate: join('candidate', `${stage}.json`),
    expected: join('expected', `${stage}.json`),
  }
}

function manualReviewDecision(reason: string): SelfImproveDecisionResult {
  return {
    decision: 'manual_review',
    reason,
    shouldPromoteCandidate: false,
    shouldOverwriteExpected: false,
    mayAutoFixPipeline: false,
    contractChange: false,
    adapterAddition: false,
    reportRequired: true,
  }
}

function passDecision(reason: string): SelfImproveDecisionResult {
  return {
    decision: 'pass_existing_expected',
    reason,
    shouldPromoteCandidate: false,
    shouldOverwriteExpected: false,
    mayAutoFixPipeline: false,
    contractChange: false,
    adapterAddition: false,
    reportRequired: false,
  }
}
