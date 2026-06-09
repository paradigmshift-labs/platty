import { describe, expect, it } from 'vitest'
import { createTestPlattyDb } from '../src/db/testing.js'
import { projectPhaseStatus, repositories, repositoryPhaseStatus } from '../src/db/schema/core.js'
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
import { and, eq } from 'drizzle-orm'

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

  it('runs only one repository stage when project runner is step-only', async () => {
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
    expect(calls).toHaveLength(1)
    client.close()
  })

  it('runs only the next missing stage when project runner is step-only', async () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'Demo' })
    const repo = addRepository(client.db, { projectId: project.id, path: gitRepo(), name: 'api' })
    const calls: string[] = []

    const result = await runStaticPipelineForProject({
      db: client.db,
      projectId: project.id,
      stepOnly: true,
      stages: Object.fromEntries(
        STATIC_PIPELINE_STAGES.map((stage) => [stage, async () => {
          calls.push(stage)
        }]),
      ),
    })

    expect(result.repositoryCount).toBe(1)
    expect(result.completedRepositoryIds).toEqual([repo.id])
    expect(calls).toEqual(['analyze_repo'])
    client.close()
  })

  it('requires analyze_repo confirmation before build_graph', async () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'Demo' })
    const repo = addRepository(client.db, { projectId: project.id, path: gitRepo(), name: 'api' })
    const calls: string[] = []

    client.db.insert(repositoryPhaseStatus).values({
      repositoryId: repo.id,
      phase: 'analyze_repo',
      status: 'passed',
      validity: 'fresh',
      builtAt: '2026-06-09T00:00:00.000Z',
      confirmedAt: null,
    }).run()

    const result = await runStaticPipelineForProject({
      db: client.db,
      projectId: project.id,
      stepOnly: true,
      stages: Object.fromEntries(
        STATIC_PIPELINE_STAGES.map((stage) => [stage, async () => {
          calls.push(stage)
        }]),
      ),
    })

    expect(calls).toEqual([])
    expect(result.nextAction).toMatchObject({
      type: 'confirm_required',
      stage: 'analyze_repo',
      repoId: repo.id,
    })
    client.close()
  })

  it('reruns the first fresh phase whose source commit differs from the repository pin', async () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'Demo' })
    const repo = addRepository(client.db, { projectId: project.id, path: gitRepo(), name: 'api' })
    const calls: string[] = []

    client.db.update(repositories)
      .set({ lastSyncedCommit: 'commit:new' })
      .where(eq(repositories.id, repo.id))
      .run()

    for (const stage of STATIC_PIPELINE_STAGES) {
      client.db.insert(repositoryPhaseStatus).values({
        repositoryId: repo.id,
        phase: stage,
        status: 'passed',
        validity: 'fresh',
        sourceCommit: stage === 'build_service_map' ? 'commit:old' : 'commit:new',
        builtFromCommit: stage === 'build_service_map' ? 'commit:old' : 'commit:new',
        builtAt: '2026-06-09T00:00:00.000Z',
        confirmedAt: stage === 'analyze_repo' ? '2026-06-09T00:00:00.000Z' : null,
      }).run()
    }

    const result = await runStaticPipelineForProject({
      db: client.db,
      projectId: project.id,
      stepOnly: true,
      stages: Object.fromEntries(
        STATIC_PIPELINE_STAGES.map((stage) => [stage, async () => {
          calls.push(stage)
        }]),
      ),
    })

    expect(calls).toEqual(['build_service_map'])
    expect(result.nextAction).toMatchObject({
      type: 'run_static_analysis',
      stage: 'build_service_map',
      repoId: repo.id,
    })
    client.close()
  })

  it('runs the project-level service map before reporting build_docs', async () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'Demo' })
    const repo = addRepository(client.db, { projectId: project.id, path: gitRepo(), name: 'api' })

    for (const stage of STATIC_PIPELINE_STAGES) {
      client.db.insert(repositoryPhaseStatus).values({
        repositoryId: repo.id,
        phase: stage,
        status: 'passed',
        validity: 'fresh',
        builtAt: '2026-06-09T00:00:00.000Z',
        confirmedAt: stage === 'analyze_repo' ? '2026-06-09T00:00:00.000Z' : null,
      }).run()
    }

    const result = await runStaticPipelineForProject({
      db: client.db,
      projectId: project.id,
      stepOnly: true,
    })

    const servicePhase = client.db.select().from(projectPhaseStatus)
      .where(and(
        eq(projectPhaseStatus.projectId, project.id),
        eq(projectPhaseStatus.phase, 'build_service_map'),
      ))
      .get()

    expect(servicePhase?.status).toBe('passed')
    expect(result.nextAction).toMatchObject({
      type: 'build_docs',
    })
    client.close()
  })
})
