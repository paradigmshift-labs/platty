import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StageFailureReport } from './llm_policy.js'

export type ExportStageStatus = 'passed' | 'failed' | 'skipped'

export interface ExportStageStatusSummary {
  status: ExportStageStatus
  failureCount: number
  skippedReason?: string
}

export interface WriteStageReportArtifactsInput {
  outDir: string
  stageStatus: Record<string, ExportStageStatusSummary>
  failures: StageFailureReport[]
  resolvedConfig?: Record<string, unknown>
  modelUsage?: Record<string, unknown>
  partialSuccess?: boolean
  allowPartialSuccess?: boolean
}

export interface WriteStageReportArtifactsResult {
  status: 'passed' | 'failed'
  partialSuccess: boolean
  exitCode: 0 | 1
  runReportPath: string
  failuresPath: string
  failedDir: string
}

export function writeStageReportArtifacts(input: WriteStageReportArtifactsInput): WriteStageReportArtifactsResult {
  mkdirSync(input.outDir, { recursive: true })
  const failedDir = join(input.outDir, 'failed')
  if (input.failures.length > 0) mkdirSync(failedDir, { recursive: true })

  const status = Object.values(input.stageStatus).some((stage) => stage.status === 'failed') ? 'failed' : 'passed'
  const partialSuccess = input.partialSuccess ?? false
  const runReport = {
    status,
    partialSuccess,
    stageStatus: input.stageStatus,
    resolvedConfig: input.resolvedConfig ?? {},
    modelUsage: input.modelUsage ?? {},
    failureCount: input.failures.length,
  }
  const runReportPath = join(input.outDir, 'run_report.json')
  const failuresPath = join(input.outDir, 'failures.jsonl')

  writeFileSync(runReportPath, `${JSON.stringify(runReport, null, 2)}\n`, 'utf-8')
  writeFileSync(failuresPath, input.failures.map((failure) => JSON.stringify(failure)).join('\n') + (input.failures.length > 0 ? '\n' : ''), 'utf-8')
  for (const failure of input.failures) {
    writeFileSync(join(failedDir, `${safeFileName(`${failure.stage}-${failure.unitId}`)}.md`), renderFailureMarkdown(failure), 'utf-8')
  }

  return {
    status,
    partialSuccess,
    exitCode: status === 'failed' && !input.allowPartialSuccess ? 1 : 0,
    runReportPath,
    failuresPath,
    failedDir,
  }
}

export function readFailureUnitIdsFromJsonl(path: string): Set<string> {
  const unitIds = new Set<string>()
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const parsed = JSON.parse(line) as { unitId?: unknown; documentId?: unknown; primaryEntryPointId?: unknown }
    for (const value of [parsed.unitId, parsed.documentId, parsed.primaryEntryPointId]) {
      if (typeof value === 'string' && value.length > 0) unitIds.add(value)
    }
  }
  return unitIds
}

function renderFailureMarkdown(failure: StageFailureReport): string {
  return [
    `# Failed Unit: ${failure.unitId}`,
    '',
    `- stage: ${failure.stage}`,
    `- failureKind: ${failure.failureKind}`,
    `- message: ${failure.message}`,
    `- judgeAttemptCount: ${failure.judgeAttemptCount}`,
    failure.documentId ? `- documentId: ${failure.documentId}` : '',
    failure.primaryEntryPointId ? `- primaryEntryPointId: ${failure.primaryEntryPointId}` : '',
    failure.repoId ? `- repoId: ${failure.repoId}` : '',
    '',
    '## Attempts',
    '',
    '```json',
    JSON.stringify(failure.attempts, null, 2),
    '```',
    '',
  ].filter((line) => line !== '').join('\n')
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 180) || 'failure'
}
