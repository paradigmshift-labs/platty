import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildFixtureCorpusReport,
  classifyFixtureExecution,
  createFixtureExecutionPlan,
  discoverFixtureCorpus,
  selectFixtureCorpusEntries,
  writeFixtureCorpusReport,
} from '../../src/fixture_corpus/index.js'

let outputDir: string | null = null

afterEach(() => {
  if (outputDir) rmSync(outputDir, { recursive: true, force: true })
  outputDir = null
})

describe('fixture corpus execution smoke helpers', () => {
  it('selects fixtures, creates report-only execution plans, and writes a stable report', () => {
    const corpus = discoverFixtureCorpus()
    const selected = selectFixtureCorpusEntries(corpus, {
      sourceGroup: 'repo',
      framework: 'prisma',
      stage: 'build_models',
      lane: 'static',
      limit: 1,
    })

    expect(selected).toHaveLength(1)

    const [entry] = selected
    const plan = createFixtureExecutionPlan(entry!, {
      lane: 'static',
      stages: ['build_pattern_profile', 'build_models'],
    })

    expect(plan).toMatchObject({
      fixtureId: entry!.id,
      writePolicy: 'report_only',
      llmPolicy: {
        mode: 'forbidden',
        allowLive: false,
      },
    })
    expect(plan.stagePlans.map((stage) => stage.stageId)).toEqual(['build_pattern_profile', 'build_models'])
    expect(plan.stagePlans.every((stage) => stage.canRun)).toBe(true)

    const passed = classifyFixtureExecution({
      fixtureId: entry!.id,
      sourcePath: entry!.sourcePath,
      lane: 'static',
      stageId: 'build_models',
      expectedStatus: 'present',
      assertion: { passed: true, reasons: ['models matched'] },
    })
    const skipped = classifyFixtureExecution({
      fixtureId: entry!.id,
      sourcePath: entry!.sourcePath,
      lane: 'static',
      stageId: 'build_route',
      expectedStatus: 'missing',
    })

    const report = buildFixtureCorpusReport({
      lane: 'static',
      selection: { sourceGroup: 'repo', framework: 'prisma' },
      results: [passed, skipped],
      generatedAt: '2026-06-09T00:00:00.000Z',
    })

    expect(report.summary).toEqual({ passed: 1, failed: 0, blocked: 0, skipped: 1 })
    expect(report.failureSummary).toEqual({ missing_expected: 1 })
    expect(report.acceptedCandidates).toEqual([])
    expect(report.score).toMatchObject({
      totalStages: 2,
      passedStages: 1,
      skippedStages: 1,
      passRate: 0.5,
      runnablePassRate: 1,
    })

    outputDir = mkdtempSync(join(tmpdir(), 'platty-fixture-report-'))
    const reportPath = writeFixtureCorpusReport(report, outputDir)
    expect(JSON.parse(readFileSync(reportPath, 'utf-8'))).toMatchObject({
      lane: 'static',
      normalizedLane: 'deterministic',
      writePolicy: 'report_only',
      summary: report.summary,
    })
  })
})
