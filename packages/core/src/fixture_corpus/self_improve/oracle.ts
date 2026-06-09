import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { OracleCandidate, SelfImproveStage } from './types.js'

export interface OracleCandidatePaths {
  actual?: string
  candidate?: string
  expected?: string
}

export interface OracleCandidateRequest {
  fixtureDir: string
  fixtureId: string
  stage: SelfImproveStage
  actualPath: string
  candidatePath: string
  expectedPath: string
}

export interface OracleProvider {
  createCandidate(request: OracleCandidateRequest): Promise<OracleCandidate> | OracleCandidate
}

export type OracleCandidateResult =
  | { status: 'ready'; candidate: OracleCandidate; source: 'provider' | 'existing' }
  | { status: 'required'; requestPath: string }

export interface RequestOracleCandidateInput {
  fixtureDir: string
  fixtureId: string
  stage: SelfImproveStage
  paths?: OracleCandidatePaths
  provider?: OracleProvider
  reuseExistingCandidate?: boolean
  timestamp?: string
}

export async function requestOracleCandidate(input: RequestOracleCandidateInput): Promise<OracleCandidateResult> {
  const fixtureDir = resolve(input.fixtureDir)
  const paths = {
    actualPath: resolveFixturePath(fixtureDir, input.paths?.actual, 'actual', input.stage),
    candidatePath: resolveFixturePath(fixtureDir, input.paths?.candidate, 'candidate', input.stage),
    expectedPath: resolveFixturePath(fixtureDir, input.paths?.expected, 'expected', input.stage),
  }

  if (input.reuseExistingCandidate === true && existsSync(paths.candidatePath)) {
    return {
      status: 'ready',
      source: 'existing',
      candidate: {
        fixtureId: input.fixtureId,
        stage: input.stage,
        candidatePath: paths.candidatePath,
        confidence: 'medium',
        evidence: [],
      },
    }
  }

  if (input.provider) {
    const candidate = await input.provider.createCandidate({
      fixtureDir,
      fixtureId: input.fixtureId,
      stage: input.stage,
      ...paths,
    })
    return {
      status: 'ready',
      source: 'provider',
      candidate: {
        ...candidate,
        candidatePath: resolve(fixtureDir, candidate.candidatePath),
      },
    }
  }

  const requestDir = join(fixtureDir, 'reports/self-improve/oracle-requests')
  const requestPath = join(requestDir, `${sanitize(input.timestamp ?? new Date().toISOString())}-${sanitize(input.stage)}.md`)
  mkdirSync(requestDir, { recursive: true })
  writeFileSync(requestPath, renderOracleRequest(input, fixtureDir, paths), 'utf-8')
  return { status: 'required', requestPath }
}

function renderOracleRequest(
  input: RequestOracleCandidateInput,
  fixtureDir: string,
  paths: { actualPath: string; candidatePath: string; expectedPath: string },
): string {
  return [
    '# Oracle Candidate Request',
    '',
    `- Fixture id: ${input.fixtureId}`,
    `- Stage: ${input.stage}`,
    `- Fixture dir: ${fixtureDir}`,
    `- Actual path: ${paths.actualPath}`,
    `- Candidate path: ${paths.candidatePath}`,
    `- Expected path: ${paths.expectedPath}`,
    '',
    'Use fixture source files and metadata as the primary evidence.',
    'Do not copy the actual pipeline output as the candidate.',
    '',
  ].join('\n')
}

function resolveFixturePath(fixtureDir: string, path: string | undefined, kind: string, stage: SelfImproveStage): string {
  return path === undefined ? join(fixtureDir, kind, `${stage}.json`) : resolve(fixtureDir, path)
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}
