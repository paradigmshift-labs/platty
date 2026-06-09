import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateDb } from './migrate.js'
import { openPlattyDb, type OpenPlattyDbResult } from './client.js'

export interface TestPlattyDb extends OpenPlattyDbResult {
  readonly dir: string
  cleanup(): Promise<void>
}

export function createTestPlattyDb(): TestPlattyDb {
  const dir = mkdtempSync(join(tmpdir(), 'platty-core-test-db-'))
  const opened = openPlattyDb({ databasePath: join(dir, 'platty.db') })
  migrateDb(opened.db)

  return {
    ...opened,
    dir,
    async cleanup() {
      opened.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
