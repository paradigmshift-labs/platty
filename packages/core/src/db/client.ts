import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema/index.js'
import { getDefaultDatabasePath, type PlattyHomeOptions } from './paths.js'

export interface DbClientOptions {
  readonly sqlite: Database.Database
}

export interface OpenPlattyDbOptions extends PlattyHomeOptions {
  readonly databasePath?: string
}

export interface OpenPlattyDbResult {
  readonly db: DB
  readonly path: string
  close(): void
}

export function createDbClient(options: DbClientOptions) {
  options.sqlite.pragma('journal_mode = WAL')
  options.sqlite.pragma('foreign_keys = ON')
  options.sqlite.pragma('busy_timeout = 5000')

  return drizzle(options.sqlite, { schema })
}

export function openPlattyDb(options: OpenPlattyDbOptions = {}): OpenPlattyDbResult {
  const databasePath = options.databasePath ?? getDefaultDatabasePath(options)
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true })
  }

  const sqlite = new Database(databasePath)
  const db = createDbClient({ sqlite })

  return {
    db,
    path: databasePath,
    close: () => sqlite.close(),
  }
}

export type DB = ReturnType<typeof createDbClient>
