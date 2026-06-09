import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendRunLogRecord,
  readRunLog,
  runSelfImproveOnce,
  type FixtureCorpusEntry,
  type OracleProvider,
  type SelfImproveOnceDeps,
} from '../../../src/fixture_corpus/index.js'

describe('runSelfImproveOnce', () => {
  let rootDir: string
  let fixtureDir: string
  let entry: FixtureCorpusEntry

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'platty-self-improve-once-'))
    fixtureDir = join(rootDir, 'tests/fixtures/corpus/repo/orm-e2e/prisma-examples-express')
    mkdirSync(fixtureDir, { recursive: true })
    entry = {
      id: 'repo/orm-e2e/prisma-examples-express',
      sourcePath: 'tests/fixtures/corpus/repo/orm-e2e/prisma-examples-express',
      sourceGroup: 'repo',
      layout: { scope: 'repo', suite: 'orm-e2e', segments: ['prisma-examples-express'] },
      framework: 'prisma',
      language: 'prisma',
      stageExpected: {
        analyze_repo: 'missing',
        build_graph: 'missing',
        build_pattern_profile: 'missing',
        static_analysis_profile: 'missing',
        static_analysis_dsl_discovery: 'missing',
        build_models: 'present',
        build_route: 'missing',
        build_relations: 'missing',
        build_service_map: 'missing',
        build_epics: 'missing',
        build_docs: 'missing',
        build_docs_sql: 'missing',
        build_business_docs: 'missing',
      },
      hasLlmCache: false,
      lanes: ['static'],
      llmPolicy: 'none',
      tier: 'accepted',
      visibility: 'public',
      knownGaps: [],
    }
  })

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('promotes a new expected output when an injected oracle candidate matches actual output', async () => {
    writeJson('actual/build_models.json', { models: [] })
    const deps = depsFor({
      compare: vi
        .fn()
        .mockResolvedValueOnce({
          exitCode: 1,
          scenario: 'A_new',
          lines: ['missing expected'],
          facts: {},
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          scenario: 'A_new',
          lines: ['candidate matches actual'],
          facts: { candidateMatchesActual: true },
        }),
      createOracleProvider: () => evidenceProvider({ models: [] }),
    })

    const out = await runSelfImproveOnce({
      id: entry.id,
      stage: 'build_models',
      rootDir,
    }, deps)

    expect(out.exitCode).toBe(0)
    expect(JSON.parse(readFileSync(join(fixtureDir, 'expected/build_models.json'), 'utf-8'))).toEqual({ models: [] })
    expect((await readRunLog(join(fixtureDir, 'run_log.jsonl'))).map((record) => record.phase))
      .toEqual(['select', 'run', 'compare', 'oracle', 'compare', 'decision'])
  })

  it('passes existing expected output without requesting an oracle', async () => {
    writeJson('actual/build_models.json', { models: [] })
    writeJson('expected/build_models.json', { models: [] })
    const requestOracle = vi.fn()
    const out = await runSelfImproveOnce({
      id: entry.id,
      stage: 'build_models',
      rootDir,
    }, depsFor({
      requestOracle,
      compare: vi.fn(async () => ({
        exitCode: 0,
        scenario: 'B_regression',
        lines: ['expected matches actual'],
        facts: { expectedMatchesActual: true },
      })),
    }))

    expect(out.exitCode).toBe(0)
    expect(out.lines.join('\n')).toContain('decision pass_existing_expected')
    expect(requestOracle).not.toHaveBeenCalled()
  })

  it('stops before rerun when five failures exhausted the stage budget', async () => {
    const runLogPath = join(fixtureDir, 'run_log.jsonl')
    for (let cycle = 1; cycle <= 5; cycle += 1) {
      await appendRunLogRecord(runLogPath, {
        timestamp: `2026-06-09T00:00:0${cycle}.000Z`,
        cycle,
        phase: 'decision',
        status: 'fail',
        fixtureId: entry.id,
        stageId: 'build_models',
        reason: 'manual_review',
      })
    }
    const runFixture = vi.fn()

    const out = await runSelfImproveOnce({
      id: entry.id,
      stage: 'build_models',
      rootDir,
    }, depsFor({ runFixture }))

    expect(runFixture).not.toHaveBeenCalled()
    expect(out.exitCode).toBe(1)
    expect(out.reportPath).toMatch(/self-improve/)
    expect(existsSync(out.reportPath ?? '')).toBe(true)
  })

  function depsFor(overrides: Partial<SelfImproveOnceDeps> = {}): Partial<SelfImproveOnceDeps> {
    return {
      loadFixture: (id) => id === entry.id ? entry : null,
      runFixture: async () => ({ exitCode: 0, lines: [`PASS ${entry.id}`] }),
      compare: async () => ({
        exitCode: 0,
        scenario: 'B_regression',
        lines: ['expected matches actual'],
        facts: { expectedMatchesActual: true },
      }),
      now: () => new Date('2026-06-09T00:00:00.000Z'),
      ...overrides,
    }
  }

  function writeJson(relativePath: string, value: unknown): void {
    const path = join(fixtureDir, relativePath)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
  }

  function evidenceProvider(candidateValue: unknown): OracleProvider {
    return {
      createCandidate: async (request) => {
        mkdirSync(dirname(request.candidatePath), { recursive: true })
        writeFileSync(request.candidatePath, `${JSON.stringify(candidateValue, null, 2)}\n`, 'utf-8')
        return {
          fixtureId: request.fixtureId,
          stage: request.stage,
          candidatePath: request.candidatePath,
          confidence: 'high',
          evidence: [{ path: 'schema.prisma', summary: 'candidate reviewed against source', confidence: 'high' }],
        }
      },
    }
  }
})
