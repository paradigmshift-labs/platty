import { and, eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { PipelineExecution, type PipelineFailure } from '@/pipeline_infra/index.js'
import {
  composeAndSaveStaticAnalysisPatternProfile,
  type StaticAnalysisPatternProfile,
} from '@/pipeline_modules/shared/static_config/index.js'

export class BuildPatternProfileError extends Error {
  constructor(
    public code: 'REPO_NOT_FOUND' | 'BUILD_GRAPH_NOT_READY' | 'PROFILE_NOT_COMPOSED',
    message: string,
  ) {
    super(message)
    this.name = 'BuildPatternProfileError'
  }
}

export interface RunBuildPatternProfileResult {
  runId: string
  profile: StaticAnalysisPatternProfile
  ruleCount: number
  ruleTargets: Record<string, number>
  candidateRuleCount: number
  diagnosticCount: number
}

export async function runBuildPatternProfile(input: {
  db: DB
  repoId: string
  parentRunId?: string
  signal?: AbortSignal
}): Promise<RunBuildPatternProfileResult> {
  const { db, repoId } = input
  const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
  if (!repo) {
    throw new BuildPatternProfileError('REPO_NOT_FOUND', `Repository '${repoId}' not found`)
  }
  const graphPhase = db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, repoId),
    eq(repositoryPhaseStatus.phase, 'build_graph'),
  )).get()
  if (!graphPhase?.builtAt || graphPhase.validity !== 'fresh') {
    throw new BuildPatternProfileError(
      'BUILD_GRAPH_NOT_READY',
      `build_graph must be fresh before build_pattern_profile for repository '${repoId}'`,
    )
  }

  const pipeline = new PipelineExecution({ db })
  const result = await pipeline.runStage(
    {
      projectId: repo.projectId,
      repoId,
      kind: 'build_pattern_profile',
      totalSteps: 1,
      sourceCommit: graphPhase.builtFromCommit ?? null,
      parentRunId: input.parentRunId,
      signal: input.signal,
    },
    async (ctx) => {
      const profile = await ctx.step(
        { step: 'F1:composePatternProfile', label: 'pattern profile 생성' },
        () => composeAndSaveStaticAnalysisPatternProfile({ db, repoId }),
      )
      if (!profile) {
        throw new BuildPatternProfileError(
          'PROFILE_NOT_COMPOSED',
          `Failed to compose static analysis pattern profile for repository '${repoId}'`,
        )
      }
      const summary = summarizeProfile(profile)
      ctx.commitOutcome(ctx.markPassed({
        sourceCommit: graphPhase.builtFromCommit ?? null,
        phaseMeta: {
          staticAnalysisPatternProfile: profile,
          diagnostics: profile.diagnostics,
        },
        summary,
      }))
      return {
        runId: ctx.runId,
        profile,
        ...summary,
      }
    },
  )

  if (!result.ok) throw toBuildPatternProfileError(result.failure)
  return result.value
}

function summarizeProfile(profile: StaticAnalysisPatternProfile): Omit<RunBuildPatternProfileResult, 'runId' | 'profile'> {
  const ruleTargets: Record<string, number> = {}
  for (const rule of profile.rules) {
    ruleTargets[rule.target] = (ruleTargets[rule.target] ?? 0) + 1
  }
  return {
    ruleCount: profile.rules.length,
    ruleTargets,
    candidateRuleCount: (profile.candidateConfig?.rules?.length ?? 0)
      + (profile.candidateConfig?.ruleEntries?.length ?? 0),
    diagnosticCount: profile.diagnostics.length,
  }
}

function toBuildPatternProfileError(failure: PipelineFailure): unknown {
  if (failure.causeName === 'BuildPatternProfileError') {
    return new BuildPatternProfileError(
      'PROFILE_NOT_COMPOSED',
      failure.message,
    )
  }
  return new Error(failure.message)
}
