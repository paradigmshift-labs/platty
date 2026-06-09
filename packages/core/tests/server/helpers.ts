import { createTestPlattyDb, type DbClient } from '../../src/db/testing.js'

export type DB = DbClient['db']

export function createTestDb(): DB {
  return createTestPlattyDb().db
}
