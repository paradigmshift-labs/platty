import type { DB } from './db/client.js'
import { runAnalyzeRepo } from './pipeline_modules/analyze_repo/index.js'
import { runBuildGraph } from './pipeline_modules/build_graph/index.js'
import { runBuildPatternProfile } from './pipeline_modules/build_pattern_profile/index.js'
import { runBuildModels } from './pipeline_modules/build_models/index.js'
import { runBuildRoute } from './pipeline_modules/build_route/index.js'
import { runBuildRelations } from './pipeline_modules/build_relations/index.js'
import { runBuildServiceMap } from './pipeline_modules/build_service_map/index.js'
import { listRepositories } from './repository_service.js'
import { repositoryPhaseStatus } from './db/schema/core.js'
import { and, eq } from 'drizzle-orm'

export const STATIC_PIPELINE_STAGES = [
  'analyze_repo',
  'build_graph',
  'build_pattern_profile',
  'build_models',
  'build_route',
  'build_relations',
  'build_service_map',
] as const

export type StaticPipelineStage = typeof STATIC_PIPELINE_STAGES[number]

export interface StaticPipelineStageInput {
  db: DB
  repoId: string
  parentRunId?: string
  signal?: AbortSignal
}

export type StaticPipelineStageRunner = (input: StaticPipelineStageInput) => Promise<unknown>

export type StaticPipelineStageOverrides = Partial<Record<StaticPipelineStage, StaticPipelineStageRunner>>

export interface RunStaticPipelineForRepositoryInput extends StaticPipelineStageInput {
  stages?: StaticPipelineStageOverrides
}

const DEFAULT_STATIC_PIPELINE_STAGES: Record<StaticPipelineStage, StaticPipelineStageRunner> = {
  analyze_repo: async ({ db, repoId, parentRunId, signal }) => {
    await runAnalyzeRepo({ repoId, parentRunId, signal }, db).completion
  },
  build_graph: async ({ db, repoId, parentRunId, signal }) => {
    await runBuildGraph({ repoId, parentRunId, signal }, db).completion
  },
  build_pattern_profile: ({ db, repoId, parentRunId, signal }) =>
    runBuildPatternProfile({ db, repoId, parentRunId, signal }),
  build_models: ({ db, repoId, parentRunId, signal }) =>
    runBuildModels({ db, repoId, parentRunId, signal }),
  build_route: ({ db, repoId, parentRunId, signal }) =>
    runBuildRoute({ db, repoId, parentRunId, signal }),
  build_relations: ({ db, repoId, parentRunId, signal }) =>
    runBuildRelations({ db, repoId, parentRunId, signal }),
  build_service_map: ({ db, repoId, parentRunId, signal }) =>
    runBuildServiceMap({ db, repoId, parentRunId, signal }),
}

export async function runStaticPipelineForRepository(input: RunStaticPipelineForRepositoryInput): Promise<void> {
  const stages = { ...DEFAULT_STATIC_PIPELINE_STAGES, ...(input.stages ?? {}) }
  for (const stage of STATIC_PIPELINE_STAGES) {
    await stages[stage](input)
  }
}

export interface RunStaticPipelineForProjectInput {
  db: DB
  projectId: string
  stepOnly?: boolean
  parentRunId?: string
  signal?: AbortSignal
  stages?: StaticPipelineStageOverrides
}

export interface RunStaticPipelineForProjectResult {
  projectId: string
  repositoryCount: number
  completedRepositoryIds: string[]
  stepOnly: boolean
  nextAction?: StaticPipelineNextAction
}

export type StaticPipelineNextAction =
  | { type: 'confirm_required'; repoId: string; stage: 'analyze_repo'; command: string[] }
  | { type: 'run_static_analysis'; repoId: string; stage: StaticPipelineStage; command: string[] }
  | { type: 'build_docs'; command: string[] }
  | { type: 'completed' }

function phaseStatus(input: { db: DB; repoId: string; stage: StaticPipelineStage }) {
  return input.db.select().from(repositoryPhaseStatus)
    .where(and(
      eq(repositoryPhaseStatus.repositoryId, input.repoId),
      eq(repositoryPhaseStatus.phase, input.stage),
    ))
    .get()
}

function isFreshPassed(phase: ReturnType<typeof phaseStatus>) {
  return phase?.status === 'passed' && phase.validity === 'fresh'
}

export function nextStaticPipelineStage(input: { db: DB; repoId: string }): StaticPipelineStage | StaticPipelineNextAction {
  const analyzeRepo = phaseStatus({ ...input, stage: 'analyze_repo' })
  if (isFreshPassed(analyzeRepo) && !analyzeRepo?.confirmedAt) {
    return {
      type: 'confirm_required',
      repoId: input.repoId,
      stage: 'analyze_repo',
      command: ['platty', 'confirm'],
    }
  }

  for (const stage of STATIC_PIPELINE_STAGES) {
    const phase = phaseStatus({ ...input, stage })
    if (!isFreshPassed(phase)) return stage
  }

  return { type: 'completed' }
}

export async function runStaticPipelineForProject(input: RunStaticPipelineForProjectInput): Promise<RunStaticPipelineForProjectResult> {
  const repositories = listRepositories(input.db, input.projectId)
  const selectedRepositories = input.stepOnly ? repositories.slice(0, 1) : repositories
  const completedRepositoryIds: string[] = []
  const stages = { ...DEFAULT_STATIC_PIPELINE_STAGES, ...(input.stages ?? {}) }

  let nextAction: StaticPipelineNextAction | undefined

  for (const repository of selectedRepositories) {
    if (input.stepOnly) {
      const nextStage = nextStaticPipelineStage({ db: input.db, repoId: repository.id })
      if (typeof nextStage !== 'string') {
        nextAction = nextStage.type === 'completed'
          ? { type: 'build_docs', command: ['platty', 'docs', 'start', '--project', input.projectId] }
          : nextStage
        break
      }

      await stages[nextStage]({
        db: input.db,
        repoId: repository.id,
        parentRunId: input.parentRunId,
        signal: input.signal,
      })
      nextAction = { type: 'run_static_analysis', repoId: repository.id, stage: nextStage, command: ['platty', 'run', '--step-only', '--project', input.projectId] }
    } else {
      await runStaticPipelineForRepository({
        db: input.db,
        repoId: repository.id,
        parentRunId: input.parentRunId,
        signal: input.signal,
        stages: input.stages,
      })
    }
    completedRepositoryIds.push(repository.id)
  }

  return {
    projectId: input.projectId,
    repositoryCount: repositories.length,
    completedRepositoryIds,
    stepOnly: input.stepOnly ?? false,
    ...(nextAction ? { nextAction } : {}),
  }
}
