// V2 DB 진입점.
// 클라이언트 + schema + helpers를 한 곳에서 export.

export {
  createDbClient,
  openPlattyDb,
  type DB,
  type DbClientOptions,
  type OpenPlattyDbOptions,
  type OpenPlattyDbResult,
} from './client.js'
export { getDefaultDatabasePath, getMigrationsPath, getPlattyHomeDir, type PlattyHomeOptions } from './paths.js'
export { migrateDb } from './migrate.js'
export { createTestPlattyDb, type TestPlattyDb } from './testing.js'
export * as schema from './schema/index.js'
export { notDeleted } from './helpers/soft-delete.js'
