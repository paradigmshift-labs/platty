import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestPlattyDb } from '@platty/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlattyCommand } from '../src/main.js'

describe('project commands', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('creates, lists, and selects a project', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'platty-project-'))
    const db = createTestPlattyDb()
    vi.stubEnv('PLATTY_HOME', join(cwd, '.platty'))

    try {
      expect((await runPlattyCommand(['init'], { cwd, db: db.db })).exitCode).toBe(0)
      expect((await runPlattyCommand(['project', 'create', 'Demo'], { cwd, db: db.db })).exitCode).toBe(0)

      const list = await runPlattyCommand(['--json', 'project', 'list'], { cwd, db: db.db })
      expect(list.stdout).toMatch(/Demo/)

      const use = await runPlattyCommand(['project', 'use', 'demo'], { cwd, db: db.db })
      expect(use.exitCode).toBe(0)
    } finally {
      await db.cleanup()
    }
  })
})
