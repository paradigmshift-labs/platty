import { createTestPlattyDb, schema } from '@platty/core'
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPlattyCommand } from '../src/main.js'

describe('runs command', () => {
  it('lists, shows, and cancels selected project runs', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'platty-runs-command-'))
    const db = createTestPlattyDb()

    try {
      await runPlattyCommand(['init'], { cwd, db: db.db })
      const created = await runPlattyCommand(['project', 'create', 'Demo'], { cwd, db: db.db })
      await runPlattyCommand(['project', 'use', 'demo'], { cwd, db: db.db })
      const projectId = created.result.data && typeof created.result.data === 'object' && 'id' in created.result.data
        ? String(created.result.data.id)
        : ''

      db.db.insert(schema.pipelineRuns).values({
        id: 'run-cli-1',
        projectId,
        kind: 'analyze_repo',
        status: 'running',
        startedAt: '2026-06-09T00:00:00.000Z',
      }).run()

      const list = await runPlattyCommand(['--json', 'runs', 'list'], { cwd, db: db.db })
      expect(list.exitCode).toBe(0)
      expect(list.stdout).toMatch(/run-cli-1/)

      const show = await runPlattyCommand(['--json', 'runs', 'show', '--run-id', 'run-cli-1'], { cwd, db: db.db })
      expect(show.exitCode).toBe(0)
      expect(show.stdout).toMatch(/"status": "running"/)

      const cancel = await runPlattyCommand(['runs', 'cancel', '--run-id', 'run-cli-1'], { cwd, db: db.db })
      expect(cancel.exitCode).toBe(0)
    } finally {
      await db.cleanup()
    }
  })
})
