import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { DB } from './client.js'
import { getMigrationsPath } from './paths.js'

export function migrateDb(database: DB, migrationsFolder = getMigrationsPath()) {
  migrate(database, { migrationsFolder })
}
