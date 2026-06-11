import { createTestPlattyDb, schema } from '@platty/core'
import { eq } from 'drizzle-orm'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlattyCommand } from '../src/main.js'

describe('confirm command', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('confirms pending analyze_repo gates for the selected project', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'platty-confirm-command-'))
    const db = createTestPlattyDb()
    vi.stubEnv('PLATTY_HOME', join(cwd, '.platty'))

    try {
      await runPlattyCommand(['init'], { cwd, db: db.db })
      const created = await runPlattyCommand(['project', 'create', 'Demo'], { cwd, db: db.db })
      await runPlattyCommand(['project', 'use', 'demo'], { cwd, db: db.db })
      const projectId = String((created.result.data as { id: string }).id)

      db.db.insert(schema.repositories).values({
        id: 'repo-confirm',
        projectId,
        name: 'api',
        repoPath: cwd,
      }).run()
      db.db.insert(schema.repositoryPhaseStatus).values({
        repositoryId: 'repo-confirm',
        phase: 'analyze_repo',
        status: 'passed',
        validity: 'fresh',
        builtAt: '2026-06-09T00:00:00.000Z',
        confirmedAt: null,
      }).run()

      const response = await runPlattyCommand(['--json', 'confirm'], { cwd, db: db.db })

      expect(response.exitCode).toBe(0)
      expect(response.result.data).toMatchObject({ confirmedCount: 1 })
      const phase = db.db.select().from(schema.repositoryPhaseStatus)
        .where(eq(schema.repositoryPhaseStatus.repositoryId, 'repo-confirm'))
        .get()
      expect(phase?.confirmedAt).toEqual(expect.any(String))
    } finally {
      await db.cleanup()
    }
  })
})
