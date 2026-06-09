import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestPlattyDb } from '@platty/core'
import { describe, expect, it } from 'vitest'
import { runPlattyCommand, type StaticPipelineRunnerInput } from '../src/main.js'

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'platty-cli-run-repo-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  return dir
}

describe('static analysis shortcuts', () => {
  it('reports selected project status and calls static runner for run --step-only', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'platty-run-next-'))
    const repoPath = gitRepo()
    const db = createTestPlattyDb()
    const calls: StaticPipelineRunnerInput[] = []

    try {
      await runPlattyCommand(['init'], { cwd, db: db.db })
      await runPlattyCommand(['project', 'create', 'Demo'], { cwd, db: db.db })
      await runPlattyCommand(['project', 'use', 'demo'], { cwd, db: db.db })
      await runPlattyCommand(['repo', 'add', repoPath, '--name', 'api'], { cwd, db: db.db })

      const status = await runPlattyCommand(['--json', 'status'], { cwd, db: db.db })
      expect(status.exitCode).toBe(0)
      expect(status.stdout).toMatch(/"project"/)
      expect(status.stdout).toMatch(/"repositories"/)

      const run = await runPlattyCommand(['--json', 'run', '--step-only'], {
        cwd,
        db: db.db,
        staticPipelineRunner: async (input) => {
          calls.push(input)
          return { completedRepositoryIds: ['fake-repo'], stepOnly: input.stepOnly }
        },
      })

      expect(run.exitCode).toBe(0)
      expect(calls).toHaveLength(1)
      expect(calls[0].stepOnly).toBe(true)
      expect(calls[0].projectId).not.toBe('')
    } finally {
      await db.cleanup()
    }
  })
})
