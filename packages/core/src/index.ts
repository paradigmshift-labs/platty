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
