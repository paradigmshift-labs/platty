import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { codeEdges, codeNodes } from '@/db/schema/code_graph.js'
import { runBuildPatternProfile } from '@/pipeline_modules/build_pattern_profile/index.js'
import { loadFreshStaticAnalysisPatternProfile } from '@/pipeline_modules/shared/static_config/index.js'
import { createTestDb } from '../../server/helpers.js'

describe('runBuildPatternProfile', () => {
  it('stores the effective profile on the build_pattern_profile phase row', async () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values({
      id: 'repo-1',
      projectId: 'project-1',
      name: 'repo',
      repoPath: '/repo',
      language: 'typescript',
      framework: 'nestjs',
    }).run()
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'repo-1',
      phase: 'build_graph',
      builtAt: '2026-05-29T00:00:00.000Z',
      builtFromCommit: 'commit-a',
      validity: 'fresh',
    }).run()
    db.insert(codeNodes).values({
      id: 'repo-1:src/service.ts:service',
      repoId: 'repo-1',
      type: 'function',
      filePath: 'src/service.ts',
      name: 'service',
    }).run()
    db.insert(codeEdges).values({
      repoId: 'repo-1',
      sourceId: 'repo-1:src/service.ts:service',
      targetId: null,
      relation: 'imports',
      targetSpecifier: '@prisma/client',
    }).run()

    const result = await runBuildPatternProfile({ db, repoId: 'repo-1' })

    expect(result.ruleCount).toBeGreaterThan(0)
    expect(result.ruleTargets['relation.db_access']).toBeGreaterThan(0)

    const phase = db.select().from(repositoryPhaseStatus)
      .where(eq(repositoryPhaseStatus.phase, 'build_pattern_profile'))
      .get()
    expect(phase?.builtFromCommit).toBe('commit-a')
    expect(phase?.meta).toMatchObject({
      staticAnalysisPatternProfile: {
        builtFromCommit: 'commit-a',
        analysisMode: 'deterministic_with_pattern_profile',
        sources: { defaultConfigVersion: 'default-static-config-v1' },
      },
      summary: {
        ruleCount: result.ruleCount,
      },
    })

    const loaded = loadFreshStaticAnalysisPatternProfile({ db, repoId: 'repo-1' })
    expect(loaded?.builtFromCommit).toBe('commit-a')
    expect(loaded?.rules.map((rule) => rule.id)).toContain('db.prisma.direct')
  })
})
