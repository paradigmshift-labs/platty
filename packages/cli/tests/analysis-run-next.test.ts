import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestPlattyDb, schema, STATIC_PIPELINE_STAGES } from '@platty/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlattyCommand, type StaticPipelineRunnerInput } from '../src/main.js'
import { eq } from 'drizzle-orm'

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'platty-cli-run-repo-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  return dir
}

describe('static analysis shortcuts', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reports selected project status and calls static runner for run --step-only', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'platty-run-next-'))
    const repoPath = gitRepo()
    const db = createTestPlattyDb()
    const calls: StaticPipelineRunnerInput[] = []
    vi.stubEnv('PLATTY_HOME', join(cwd, '.platty'))

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

  it('reports build_docs as the next status action after static analysis is fresh', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'platty-status-build-docs-'))
    const repoPath = gitRepo()
    const db = createTestPlattyDb()
    vi.stubEnv('PLATTY_HOME', join(cwd, '.platty'))

    try {
      await runPlattyCommand(['init'], { cwd, db: db.db })
      await runPlattyCommand(['--json', 'project', 'create', 'Demo'], { cwd, db: db.db })
      await runPlattyCommand(['project', 'use', 'demo'], { cwd, db: db.db })
      await runPlattyCommand(['repo', 'add', repoPath, '--name', 'api'], { cwd, db: db.db })

      const projectId = db.db.select().from(schema.projects).where(eq(schema.projects.name, 'Demo')).get()?.id
      expect(projectId).toBeTruthy()
      const repo = db.db.select().from(schema.repositories).where(eq(schema.repositories.projectId, projectId)).get()
      expect(repo).toBeTruthy()

      db.db.update(schema.repositories)
        .set({ lastSyncedCommit: 'commit:main' })
        .where(eq(schema.repositories.id, repo!.id))
        .run()

      for (const stage of STATIC_PIPELINE_STAGES) {
        db.db.insert(schema.repositoryPhaseStatus).values({
          repositoryId: repo!.id,
          phase: stage,
          status: 'passed',
          validity: 'fresh',
          sourceCommit: 'commit:main',
          builtFromCommit: 'commit:main',
          builtAt: '2026-06-09T00:00:00.000Z',
          confirmedAt: stage === 'analyze_repo' ? '2026-06-09T00:00:00.000Z' : null,
        }).run()
      }

      const status = await runPlattyCommand(['--json', 'status'], { cwd, db: db.db })
      const response = JSON.parse(status.stdout)

      expect(status.exitCode).toBe(0)
      expect(response.data.nextAction).toMatchObject({
        type: 'build_docs',
        command: ['platty', 'docs', 'start', '--project', projectId],
      })
    } finally {
      await db.cleanup()
    }
  })
})
