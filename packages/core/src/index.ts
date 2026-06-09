export interface PlattyEngineInfo {
  readonly name: '@platty/core'
  readonly role: 'analysis-engine'
}

export function getPlattyEngineInfo(): PlattyEngineInfo {
  return {
    name: '@platty/core',
    role: 'analysis-engine',
  }
}

export {
  createDbClient,
  createTestPlattyDb,
  getDefaultDatabasePath,
  getMigrationsPath,
  getPlattyHomeDir,
  migrateDb,
  notDeleted,
  openPlattyDb,
  schema,
  type DB,
  type DbClientOptions,
  type OpenPlattyDbOptions,
  type OpenPlattyDbResult,
  type PlattyHomeOptions,
  type TestPlattyDb,
} from './db/index.js'
export {
  PipelineRuntime,
  createPipelineRuntime,
  type FinishPipelineRunInput,
  type PipelineRuntimeOptions,
  type RecordPipelineEventInput,
  type StartPipelineRunInput,
} from './pipeline_infra/index.js'
export {
  AnalyzeRepoError,
  runAnalyzeRepo,
  type AnalyzeRepoOptions,
  type AnalyzeRepoStartResult,
} from './pipeline_modules/analyze_repo/index.js'
export {
  BuildGraphError,
  runBuildGraph,
  type BuildGraphOptions,
  type BuildGraphResult,
  type BuildGraphStartResult,
} from './pipeline_modules/build_graph/index.js'
export {
  BuildPatternProfileError,
  runBuildPatternProfile,
  type RunBuildPatternProfileResult,
} from './pipeline_modules/build_pattern_profile/index.js'
export {
  runBuildModels,
} from './pipeline_modules/build_models/index.js'
export {
  type BuildModelsResult,
} from './pipeline_modules/build_models/types.js'
export {
  runBuildRoute,
  type RunBuildRouteInput,
  type RunBuildRouteResult,
} from './pipeline_modules/build_route/index.js'
export {
  runBuildRelations,
  type BuildRelationsResult,
} from './pipeline_modules/build_relations/index.js'
export {
  runBuildServiceMap,
  type RunBuildServiceMapInput,
  type RunBuildServiceMapResult,
} from './pipeline_modules/build_service_map/index.js'
export * from './pipeline_modules/sync/index.js'
export * from './project_service.js'
export * from './repository_service.js'
export * from './run_service.js'
export * from './static_pipeline.js'
