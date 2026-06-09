import {
  buildFixtureCorpusReport,
  classifyFixtureExecution,
  createFixtureExecutionPlan,
  discoverFixtureCorpus,
  getFixtureCorpusSummary,
  loadFixture,
  loadFixtureExpected,
  selectFixtureCorpusEntries,
  type CorpusStageId,
  type FixtureExecutionResult,
} from '@platty/core'
import { value } from '../argv.js'
import { failure, success, type PlattyCommandResponse } from '../output.js'

export interface RunCorpusCommandOptions {
  cwd: string
}

export async function runCorpusCommand(argv: string[], options: RunCorpusCommandOptions): Promise<PlattyCommandResponse> {
  const subcommand = argv[0]
  if (subcommand === 'run-fixture') return runFixture(argv, options)
  if (subcommand === 'batch-report') return batchReport(argv, options)
  if (subcommand === 'compare') return compare(argv, options)
  if (subcommand === 'gate-check') return gateCheck(argv, options)
  if (subcommand === 'next-candidate') return nextCandidate(argv, options)
  if (subcommand === 'audit-queue') return auditQueue(argv, options)

  return {
    exitCode: 2,
    result: failure('UNKNOWN_CORPUS_COMMAND', `Unknown corpus command: ${subcommand ?? ''}`),
    stdout: '',
    stderr: '',
  }
}

function runFixture(argv: string[], options: RunCorpusCommandOptions): PlattyCommandResponse {
  const id = value(argv, '--id')
  if (!id) return missingFlag('--id')
  const entry = loadFixture(id)
  if (!entry) return fixtureNotFound(id)

  const stage = parseStage(value(argv, '--stage') ?? value(argv, '--stages')?.split(',')[0])
  const plan = createFixtureExecutionPlan(entry, {
    lane: 'static',
    stages: stage ? [stage] : undefined,
  })

  return ok({
    command: 'run-fixture',
    fixtureId: entry.id,
    dryRun: true,
    plan,
  })
}

function batchReport(argv: string[], options: RunCorpusCommandOptions): PlattyCommandResponse {
  const corpus = discoverFixtureCorpus(options.cwd)
  const selection = {
    framework: value(argv, '--framework'),
    stage: parseStage(value(argv, '--stage')),
    lane: 'static' as const,
  }
  const entries = selectFixtureCorpusEntries(corpus, selection)
  const results = entries.flatMap((entry) =>
    (selection.stage ? [selection.stage] : ['build_pattern_profile' as const]).map((stageId) =>
      classifyFixtureExecution({
        fixtureId: entry.id,
        sourcePath: entry.sourcePath,
        lane: 'static',
        stageId,
        expectedStatus: entry.stageExpected[stageId],
      }),
    ),
  )
  const report = buildFixtureCorpusReport({
    lane: 'static',
    selection,
    results,
  })

  return ok({
    command: 'batch-report',
    summary: getFixtureCorpusSummary(corpus),
    selectedFixtureCount: entries.length,
    report,
  })
}

function compare(argv: string[], _options: RunCorpusCommandOptions): PlattyCommandResponse {
  const comparison = compareFixture(argv)
  if ('response' in comparison) return comparison.response
  return ok({
    command: 'compare',
    fixtureId: comparison.entry.id,
    stage: comparison.stage,
    status: comparison.expected === null ? 'missing_expected' : 'expected_present',
  })
}

function gateCheck(argv: string[], _options: RunCorpusCommandOptions): PlattyCommandResponse {
  const comparison = compareFixture(argv)
  if ('response' in comparison) return comparison.response
  const status = comparison.expected === null ? 'missing_expected' : 'pass'
  const data = {
    command: 'gate-check',
    fixtureId: comparison.entry.id,
    stage: comparison.stage,
    status,
  }
  if (status === 'pass') return ok(data)
  return {
    exitCode: 1,
    result: failure('FIXTURE_GATE_FAILED', `Fixture gate failed for ${comparison.entry.id}`, { data }),
    stdout: '',
    stderr: '',
  }
}

function nextCandidate(_argv: string[], options: RunCorpusCommandOptions): PlattyCommandResponse {
  const corpus = discoverFixtureCorpus(options.cwd)
  const fixture = corpus.entries.find((entry) => entry.tier === 'accepted' && entry.visibility === 'public') ?? null
  return ok({
    command: 'next-candidate',
    fixture,
  })
}

function auditQueue(_argv: string[], options: RunCorpusCommandOptions): PlattyCommandResponse {
  const corpus = discoverFixtureCorpus(options.cwd)
  return ok({
    command: 'audit-queue',
    fixtures: corpus.entries
      .filter((entry) => entry.tier === 'candidate' || entry.tier === 'blocked')
      .map((entry) => ({
        id: entry.id,
        tier: entry.tier,
        knownGaps: entry.knownGaps,
      })),
  })
}

function compareFixture(argv: string[]): {
  entry: NonNullable<ReturnType<typeof loadFixture>>
  stage: CorpusStageId
  expected: unknown
} | { response: PlattyCommandResponse } {
  const id = value(argv, '--id')
  if (!id) return { response: missingFlag('--id') }
  const entry = loadFixture(id)
  if (!entry) return { response: fixtureNotFound(id) }
  const stage = parseStage(value(argv, '--stage')) ?? 'build_graph'
  const expected = loadFixtureExpected(entry.id, stage)
  return { entry, stage, expected }
}

function ok(data: unknown): PlattyCommandResponse {
  return { exitCode: 0, result: success(data), stdout: '', stderr: '' }
}

function missingFlag(flag: string): PlattyCommandResponse {
  return {
    exitCode: 2,
    result: failure('MISSING_ARGUMENT', `${flag} is required`),
    stdout: '',
    stderr: '',
  }
}

function fixtureNotFound(id: string): PlattyCommandResponse {
  return {
    exitCode: 1,
    result: failure('FIXTURE_NOT_FOUND', `Fixture not found: ${id}`),
    stdout: '',
    stderr: '',
  }
}

function parseStage(value: string | undefined): CorpusStageId | undefined {
  if (!value) return undefined
  return value as CorpusStageId
}
