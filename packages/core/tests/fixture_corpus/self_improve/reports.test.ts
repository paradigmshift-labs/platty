import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeSelfImproveReport } from '../../../src/fixture_corpus/self_improve/index.js'

describe('writeSelfImproveReport', () => {
  let fixtureDir: string

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'platty-self-improve-report-'))
  })

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('writes a fixture-local markdown report with decision and evidence', () => {
    const reportPath = writeSelfImproveReport({
      fixtureDir,
      fixtureId: 'repo/orm-e2e/prisma-examples-express',
      stage: 'build_models',
      decision: {
        decision: 'promote_new_expected',
        reason: 'No expected output exists and actual output matches the oracle candidate.',
        shouldPromoteCandidate: true,
        shouldOverwriteExpected: false,
        mayAutoFixPipeline: false,
        adapterAddition: false,
        contractChange: false,
        reportRequired: true,
      },
      sourceEvidence: [{ path: 'schema.prisma', summary: 'Candidate matches source models.', confidence: 'high' }],
      timestamp: '2026-06-09T00:00:00.000Z',
    })

    expect(existsSync(reportPath)).toBe(true)
    const report = readFileSync(reportPath, 'utf-8')
    expect(report).toContain('Fixture id: repo/orm-e2e/prisma-examples-express')
    expect(report).toContain('Decision: promote_new_expected')
    expect(report).toContain('Candidate promotion: yes')
    expect(report).toContain('Candidate matches source models.')
  })
})
