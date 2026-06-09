import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { OracleCandidate, SelfImproveDecisionResult, SelfImproveStage, SourceEvidence } from './types.js'

export interface SelfImproveReportPaths {
  actual?: string
  candidate?: string
  expected?: string
}

export interface WriteSelfImproveReportInput {
  fixtureDir: string
  fixtureId: string
  stage: SelfImproveStage
  decision: SelfImproveDecisionResult
  paths?: SelfImproveReportPaths
  oracle?: OracleCandidate
  sourceEvidence?: SourceEvidence[]
  timestamp?: string
}

export function writeSelfImproveReport(input: WriteSelfImproveReportInput): string {
  const fixtureDir = resolve(input.fixtureDir)
  const reportDir = join(fixtureDir, 'reports/self-improve')
  const reportPath = join(
    reportDir,
    `${sanitize(input.timestamp ?? new Date().toISOString())}-${sanitize(input.stage)}-${sanitize(input.decision.decision)}.md`,
  )
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(reportPath, renderSelfImproveReport(input, fixtureDir), 'utf-8')
  return reportPath
}

function renderSelfImproveReport(input: WriteSelfImproveReportInput, fixtureDir: string): string {
  const evidence = input.oracle?.evidence ?? input.sourceEvidence ?? []
  return [
    '# Fixture Self-Improve Report',
    '',
    '## Decision',
    '',
    `- Fixture id: ${input.fixtureId}`,
    `- Stage: ${input.stage}`,
    `- Decision: ${input.decision.decision}`,
    `- Reason: ${input.decision.reason}`,
    `- Candidate promotion: ${input.decision.shouldPromoteCandidate ? 'yes' : 'no'}`,
    `- Pipeline fix allowed: ${input.decision.mayAutoFixPipeline ? 'yes' : 'no'}`,
    `- Adapter addition: ${input.decision.adapterAddition ? 'yes' : 'no'}`,
    `- Contract change: ${input.decision.contractChange ? 'yes' : 'no'}`,
    '',
    '## Paths',
    '',
    `- Actual: ${resolvePath(fixtureDir, input.paths?.actual, 'actual', input.stage)}`,
    `- Candidate: ${resolvePath(fixtureDir, input.paths?.candidate, 'candidate', input.stage)}`,
    `- Expected: ${resolvePath(fixtureDir, input.paths?.expected, 'expected', input.stage)}`,
    '',
    '## Evidence Summaries',
    '',
    ...(evidence.length > 0
      ? evidence.map((item) => `- ${item.path}: ${item.summary} (confidence=${item.confidence})`)
      : ['- None provided.']),
    '',
    '## Oracle Notes',
    '',
    ...(input.oracle?.notes?.length ? input.oracle.notes.map((note) => `- ${note}`) : ['- None provided.']),
    '',
  ].join('\n')
}

function resolvePath(fixtureDir: string, path: string | undefined, kind: string, stage: SelfImproveStage): string {
  return path === undefined ? join(fixtureDir, kind, `${stage}.json`) : resolve(fixtureDir, path)
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}
