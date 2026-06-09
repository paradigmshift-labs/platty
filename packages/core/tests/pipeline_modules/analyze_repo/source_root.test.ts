import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { projects, repositories } from '@/db/schema/core.js'
import { runAnalyzeRepo } from '@/pipeline_modules/analyze_repo/index.js'
import { createTestDb } from '../../server/helpers.js'

describe('analyze_repo sourceRoot', () => {
  it('detects framework from the sourceRoot package instead of the workspace root package', async () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'p1', name: 'P' }).run()

    const root = mkdtempSync(join(tmpdir(), 'platty-mono-'))
    mkdirSync(join(root, 'apps/api/src'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['apps/*'] }))
    writeFileSync(join(root, 'apps/api/package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }))
    writeFileSync(join(root, 'apps/api/tsconfig.json'), '{}')
    writeFileSync(join(root, 'apps/api/src/main.ts'), 'export const main = 1\n')
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' })
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' })
    execFileSync('git', ['-c', 'user.name=Platty Test', '-c', 'user.email=platty@example.test', 'commit', '-m', 'init'], { cwd: root, stdio: 'ignore' })

    db.insert(repositories).values({
      id: 'r1',
      projectId: 'p1',
      name: 'api',
      repoPath: root,
      sourceRoot: 'apps/api',
      analysisBranch: 'main',
    }).run()

    await runAnalyzeRepo({ repoId: 'r1' }, db).completion

    const row = db.select().from(repositories).where(eq(repositories.id, 'r1')).get()
    expect(row?.framework).toBe('nestjs')
    expect(row?.language).toBe('typescript')
  })
})
