import { describe, expect, it } from 'vitest'
import { createTestPlattyDb } from '../src/db/testing.js'
import { createProject } from '../src/project_service.js'
import { addRepository } from '../src/repository_service.js'
import {
  runStaticPipelineForProject,
  runStaticPipelineForRepository,
  STATIC_PIPELINE_STAGES,
} from '../src/static_pipeline.js'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'platty-static-project-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  return dir
}

describe('static_pipeline', () => {
  it('keeps build_pattern_profile between build_graph and build_models', () => {
    expect(STATIC_PIPELINE_STAGES).toEqual([
      'analyze_repo',
      'build_graph',
      'build_pattern_profile',
      'build_models',
      'build_route',
      'build_relations',
      'build_service_map',
    ])
  })

  it('runs repository stages in static pipeline order with injected stages', async () => {
    const client = createTestPlattyDb()
    const calls: string[] = []

    await runStaticPipelineForRepository({
      db: client.db,
      repoId: 'repo-1',
      stages: Object.fromEntries(
        STATIC_PIPELINE_STAGES.map((stage) => [stage, async () => {
          calls.push(stage)
        }]),
      ),
    })

    expect(calls).toEqual(STATIC_PIPELINE_STAGES)
    client.close()
  })

  it('runs only one repository when project runner is step-only', async () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'Demo' })
    addRepository(client.db, { projectId: project.id, path: gitRepo(), name: 'api' })
    addRepository(client.db, { projectId: project.id, path: gitRepo(), name: 'web' })
    const calls: string[] = []

    const result = await runStaticPipelineForProject({
      db: client.db,
      projectId: project.id,
      stepOnly: true,
      stages: Object.fromEntries(
        STATIC_PIPELINE_STAGES.map((stage) => [stage, async ({ repoId }: { repoId: string }) => {
          calls.push(`${repoId}:${stage}`)
        }]),
      ),
    })

    expect(result.repositoryCount).toBe(2)
    expect(result.completedRepositoryIds).toHaveLength(1)
    expect(calls).toHaveLength(STATIC_PIPELINE_STAGES.length)
    client.close()
  })
})
