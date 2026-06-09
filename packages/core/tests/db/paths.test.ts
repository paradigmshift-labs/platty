import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  getDefaultDatabasePath,
  getPlattyHomeDir,
  openPlattyDb,
} from '../../src/db/index.js'

describe('Platty DB path contract', () => {
  it('defaults to the user-global Platty home, not cwd or project-local state', () => {
    expect(getPlattyHomeDir({ env: {}, homeDir: '/tmp/home', platform: 'darwin' })).toBe('/tmp/home/.platty')
    expect(getDefaultDatabasePath({ env: {}, homeDir: '/tmp/home', platform: 'darwin' })).toBe('/tmp/home/.platty/platty.db')
  })

  it('allows PLATTY_HOME and PLATTY_DB_PATH overrides', () => {
    expect(getDefaultDatabasePath({ env: { PLATTY_HOME: '/tmp/platty-home' }, platform: 'darwin' })).toBe('/tmp/platty-home/platty.db')
    expect(getDefaultDatabasePath({ env: { PLATTY_DB_PATH: '/tmp/custom.sqlite' }, platform: 'darwin' })).toBe('/tmp/custom.sqlite')
  })

  it('creates the global DB only when explicitly opened', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'platty-core-db-'))
    const dbPath = getDefaultDatabasePath({ env: {}, homeDir, platform: 'darwin' })

    expect(existsSync(dbPath)).toBe(false)

    const opened = openPlattyDb({ env: {}, homeDir, platform: 'darwin' })
    try {
      expect(opened.path).toBe(dbPath)
      expect(existsSync(dbPath)).toBe(true)
    } finally {
      opened.close()
      await rm(homeDir, { recursive: true, force: true })
    }
  })
})
