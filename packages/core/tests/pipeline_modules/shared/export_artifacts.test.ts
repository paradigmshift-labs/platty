import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readFailureUnitIdsFromJsonl, writeStageReportArtifacts } from '@/pipeline_modules/shared/export_artifacts.js'
import type { StageFailureReport } from '@/pipeline_infra/index.js'

describe('export report artifacts', () => {
  it('writes run_report.json, failures.jsonl, and failed markdown files', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'sdd-export-report-'))
    try {
      const failure: StageFailureReport = {
        stage: 'build_docs',
        unitId: 'doc:orders',
        documentId: 'doc:orders',
        primaryEntryPointId: 'node:orders',
        repoId: 'repo:1',
        failureKind: 'judge',
        message: 'Judge failed',
        judgeAttemptCount: 2,
        attempts: [{
          attempt: 1,
          stage: 'build_docs',
          unitId: 'doc:orders',
          tier: 'medium',
          provider: 'claude_code',
          model: 'claude-sonnet-4-6',
          escalated: false,
          retryKind: 'initial',
          judgeScore: 0.72,
          judgePassed: false,
          startedAt: '2026-05-15T00:00:00.000Z',
          finishedAt: '2026-05-15T00:00:01.000Z',
          durationMs: 1000,
        }],
      }

      const result = writeStageReportArtifacts({
        outDir,
        stageStatus: {
          build_docs: { status: 'failed', failureCount: 1 },
          build_epics: { status: 'skipped', failureCount: 0, skippedReason: 'skipped_due_to_failed_build_docs' },
          build_business_docs: { status: 'skipped', failureCount: 0, skippedReason: 'skipped_due_to_failed_build_docs' },
        },
        failures: [failure],
        resolvedConfig: { build_docs: { judgeRetry: 1, failFast: false } },
        modelUsage: {
          totals: { calls: 1, transportRetries: 0, escalations: 0, estimatedUsd: 0 },
        },
        partialSuccess: true,
        allowPartialSuccess: false,
      })

      const runReport = JSON.parse(readFileSync(join(outDir, 'run_report.json'), 'utf-8'))
      const failuresJsonl = readFileSync(join(outDir, 'failures.jsonl'), 'utf-8').trim().split('\n')
      const failedMarkdown = readFileSync(join(outDir, 'failed', 'build_docs-doc_orders.md'), 'utf-8')

      expect(result.exitCode).toBe(1)
      expect(runReport).toMatchObject({
        status: 'failed',
        partialSuccess: true,
        stageStatus: {
          build_docs: { status: 'failed', failureCount: 1 },
          build_epics: { status: 'skipped', skippedReason: 'skipped_due_to_failed_build_docs' },
        },
        resolvedConfig: { build_docs: { judgeRetry: 1, failFast: false } },
        modelUsage: { totals: { calls: 1 } },
      })
      expect(JSON.parse(failuresJsonl[0]!)).toMatchObject({
        stage: 'build_docs',
        unitId: 'doc:orders',
        failureKind: 'judge',
        judgeAttemptCount: 2,
      })
      expect(failedMarkdown).toContain('# Failed Unit: doc:orders')
      expect(failedMarkdown).toContain('failureKind: judge')
      expect(failedMarkdown).toContain('judgeScore')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  it('reads failure unit ids from failures.jsonl', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'sdd-export-report-'))
    try {
      const failuresPath = join(outDir, 'failures.jsonl')
      writeFileSync(failuresPath, [
        JSON.stringify({ unitId: 'doc:a', stage: 'build_docs' }),
        JSON.stringify({ documentId: 'doc:b', stage: 'build_docs' }),
        JSON.stringify({ primaryEntryPointId: 'node:c', stage: 'build_docs' }),
        '',
      ].join('\n'), 'utf-8')

      expect(readFailureUnitIdsFromJsonl(failuresPath)).toEqual(new Set(['doc:a', 'doc:b', 'node:c']))
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})
