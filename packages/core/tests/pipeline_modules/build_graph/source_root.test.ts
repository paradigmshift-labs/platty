import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { codeNodes } from '@/db/schema/code_graph.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { runBuildGraph } from '@/pipeline_modules/build_graph/index.js'
import { createTestDb } from '../../server/helpers.js'

describe('build_graph sourceRoot', () => {
  it('collects files only under the repository sourceRoot', async () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'p1', name: 'P' }).run()
    const root = mkdtempSync(join(tmpdir(), 'platty-mono-'))
    mkdirSync(join(root, 'apps/api/src'), { recursive: true })
    mkdirSync(join(root, 'apps/web/src'), { recursive: true })
    writeFileSync(join(root, 'apps/api/src/main.ts'), 'export function apiMain() { return 1 }\n')
    writeFileSync(join(root, 'apps/web/src/main.tsx'), 'export function webMain() { return 2 }\n')

    db.insert(repositories).values({
      id: 'r1',
      projectId: 'p1',
      name: 'api',
      repoPath: root,
      sourceRoot: 'apps/api',
      language: 'typescript',
      framework: 'nestjs',
    }).run()
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'r1',
      phase: 'analyze_repo',
      builtAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      status: 'passed',
    }).run()

    await runBuildGraph({ repoId: 'r1' }, db).completion

    const files = db.select().from(codeNodes)
      .where(and(eq(codeNodes.repoId, 'r1'), eq(codeNodes.type, 'file')))
      .all()
      .map((node) => node.filePath)

    expect(files).toContain('src/main.ts')
    expect(files).not.toContain('apps/api/src/main.ts')
    expect(files).not.toContain('../web/src/main.tsx')
    expect(files).not.toContain('apps/web/src/main.tsx')
  })
})
