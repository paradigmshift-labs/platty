import { migrateDb, openPlattyDb, type OpenPlattyDbResult } from '@platty/core'

export function openCliDb(): OpenPlattyDbResult {
  const opened = openPlattyDb()
  migrateDb(opened.db)
  return opened
}
