import { openPlattyDb, type OpenPlattyDbResult } from '@platty/core'

export function openCliDb(): OpenPlattyDbResult {
  return openPlattyDb()
}
