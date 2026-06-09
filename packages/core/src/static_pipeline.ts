import type { DB } from './db/client.js'
import { runAnalyzeRepo } from './pipeline_modules/analyze_repo/index.js'
import { runBuildGraph } from './pipeline_modules/build_graph/index.js'
import { runBuildPatternProfile } from './pipeline_modules/build_pattern_profile/index.js'
import { runBuildModels } from './pipeline_modules/build_models/index.js'
import { runBuildRoute } from './pipeline_modules/build_route/index.js'
import { runBuildRelations } from './pipeline_modules/build_relations/index.js'
import { runBuildServiceMap } from './pipeline_modules/build_service_map/index.js'

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
