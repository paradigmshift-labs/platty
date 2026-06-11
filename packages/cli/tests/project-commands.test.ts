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

  it('guides users from missing project context to project list before repo setup', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'platty-project-context-'))
    const db = createTestPlattyDb()
    vi.stubEnv('PLATTY_HOME', join(cwd, '.platty'))

    try {
      expect((await runPlattyCommand(['init'], { cwd, db: db.db })).exitCode).toBe(0)

      const response = await runPlattyCommand(['--json', 'status'], { cwd, db: db.db })

      expect(response.exitCode).toBe(2)
      expect(response.result.errors[0]?.code).toBe('PROJECT_NOT_SELECTED')
      expect(response.result.nextAction).toMatchObject({
        type: 'select_project',
        command: ['platty', 'project', 'list'],
        message: 'Create or select a Platty project, then register repositories inside that project.',
      })
    } finally {
      await db.cleanup()
    }
  })
})
