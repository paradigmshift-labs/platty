import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestPlattyDb } from '@platty/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlattyCommand } from '../src/main.js'

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'platty-cli-repo-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  return dir
}

describe('repo commands', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('adds, lists, updates, and removes a repository under the selected project', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'platty-repo-command-'))
    const repoPath = gitRepo()
    const db = createTestPlattyDb()
    vi.stubEnv('PLATTY_HOME', join(cwd, '.platty'))

    try {
      expect((await runPlattyCommand(['init'], { cwd, db: db.db })).exitCode).toBe(0)
      expect((await runPlattyCommand(['project', 'create', 'Demo'], { cwd, db: db.db })).exitCode).toBe(0)
      expect((await runPlattyCommand(['project', 'use', 'demo'], { cwd, db: db.db })).exitCode).toBe(0)

      const add = await runPlattyCommand(['--json', 'repo', 'add', repoPath, '--name', 'api', '--source-root', '.'], { cwd, db: db.db })
      expect(add.exitCode).toBe(0)
      expect(add.stdout).toMatch(/"name": "api"/)
      expect(add.stdout).toMatch(new RegExp(realpathSync.native(repoPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      const repoId = add.result.data && typeof add.result.data === 'object' && 'id' in add.result.data
        ? String(add.result.data.id)
        : ''
      expect(repoId).not.toBe('')

      const list = await runPlattyCommand(['--json', 'repo', 'list'], { cwd, db: db.db })
      expect(list.exitCode).toBe(0)
      expect(list.stdout).toMatch(/"repositories": \[/)
      expect(list.stdout).toMatch(/"name": "api"/)

      const update = await runPlattyCommand(['repo', 'update', repoId, '--name', 'api-renamed'], { cwd, db: db.db })
      expect(update.exitCode).toBe(0)

      const remove = await runPlattyCommand(['repo', 'remove', 'api-renamed'], { cwd, db: db.db })
      expect(remove.exitCode).toBe(0)

      const empty = await runPlattyCommand(['--json', 'repo', 'list'], { cwd, db: db.db })
      expect(empty.stdout).toMatch(/"repositories": \[\]/)
    } finally {
      await db.cleanup()
    }
  })
})
