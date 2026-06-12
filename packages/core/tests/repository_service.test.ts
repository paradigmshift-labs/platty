import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createTestPlattyDb } from '../src/db/testing.js'
import { documents } from '../src/db/schema/build_docs.js'
import { projectPhaseStatus, repositoryPhaseStatus, repositories } from '../src/db/schema/core.js'
import { createProject } from '../src/project_service.js'
import {
  addRepository,
  listRepositories,
  removeRepository,
  resolveRepositorySelector,
  updateRepository,
} from '../src/repository_service.js'

const STATIC_REPO_PHASES = [
  'analyze_repo',
  'build_graph',
  'build_pattern_profile',
  'build_models',
  'build_route',
  'build_relations',
] as const

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'platty-cli-repo-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  return dir
}

describe('repository_service', () => {
  it('adds a git repository to a project with normalized sourceRoot', () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'My App' })
    const repoPath = gitRepo()

    const repo = addRepository(client.db, {
      projectId: project.id,
      path: repoPath,
      name: 'api',
      sourceRoot: '.',
      cwd: repoPath,
    })

    expect(repo.repoPath).toBe(realpathSync.native(repoPath))
    expect(repo.sourceRoot).toBeNull()
    expect(listRepositories(client.db, project.id)).toHaveLength(1)

    client.close()
  })

  it('resolves, updates, and removes repositories by selector', () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'My App' })
    const repoPath = gitRepo()

    const repo = addRepository(client.db, {
      projectId: project.id,
      path: repoPath,
      name: 'api',
      cwd: repoPath,
    })

    expect(resolveRepositorySelector(client.db, project.id, repo.id, repoPath).repository?.id).toBe(repo.id)
    expect(resolveRepositorySelector(client.db, project.id, 'api', repoPath).repository?.id).toBe(repo.id)

    const updated = updateRepository(client.db, {
      projectId: project.id,
      selector: repo.id,
      name: 'api-renamed',
      cwd: repoPath,
    })
    expect(updated.kind).toBe('found')
    expect(updated.kind === 'found' ? updated.repository.name : null).toBe('api-renamed')

    const removed = removeRepository(client.db, project.id, 'api-renamed', repoPath)
    expect(removed.kind).toBe('found')
    expect(listRepositories(client.db, project.id)).toHaveLength(0)

    client.close()
  })

  it('marks project-level phases pending without blanket-staling documents when the repository inventory changes', () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'My App' })
    const repoPath = gitRepo()
    addRepository(client.db, { projectId: project.id, path: repoPath, name: 'api', cwd: repoPath })

    client.db.insert(projectPhaseStatus).values([
      'build_service_map',
      'build_docs',
      'build_epics',
      'build_business_docs',
    ].map((phase) => ({
      projectId: project.id,
      phase,
      status: 'passed',
      updatedAt: Date.parse('2026-06-10T00:00:00.000Z'),
    }))).run()
    client.db.insert(documents).values([
      {
        id: 'doc:api',
        projectId: project.id,
        type: 'api_spec',
        track: 'technical',
        scope: 'route',
        scopeId: 'GET /orders',
        status: 'passed',
        validity: 'fresh',
        content: { summary: 'Order API' },
        rawLlmOutput: '',
      },
      {
        id: 'doc:business',
        projectId: project.id,
        type: 'ucl',
        track: 'business',
        scope: 'epic',
        scopeId: 'epic:orders',
        status: 'active',
        validity: 'fresh',
        content: { summary: 'Order business use cases' },
        rawLlmOutput: '',
      },
    ]).run()

    const webPath = gitRepo()
    const web = addRepository(client.db, { projectId: project.id, path: webPath, name: 'web', cwd: webPath })

    const phasesAfterAdd = client.db.select().from(projectPhaseStatus)
      .where(eq(projectPhaseStatus.projectId, project.id))
      .all()
    const docsAfterAdd = client.db.select().from(documents)
      .where(eq(documents.projectId, project.id))
      .all()

    expect(phasesAfterAdd.map((phase) => `${phase.phase}:${phase.status}`).sort()).toEqual([
      'build_business_docs:pending',
      'build_docs:pending',
      'build_epics:pending',
      'build_service_map:pending',
    ])
    expect(docsAfterAdd.map((doc) => `${doc.id}:${doc.validity}`).sort()).toEqual([
      'doc:api:fresh',
      'doc:business:fresh',
    ])

    client.db.update(projectPhaseStatus)
      .set({ status: 'passed', updatedAt: Date.parse('2026-06-10T01:00:00.000Z') })
      .where(eq(projectPhaseStatus.projectId, project.id))
      .run()
    client.db.update(documents)
      .set({ validity: 'fresh' })
      .where(eq(documents.projectId, project.id))
      .run()

    const removed = removeRepository(client.db, project.id, web.id, webPath)
    expect(removed.kind).toBe('found')

    const phasesAfterRemove = client.db.select().from(projectPhaseStatus)
      .where(eq(projectPhaseStatus.projectId, project.id))
      .all()
    const docsAfterRemove = client.db.select().from(documents)
      .where(eq(documents.projectId, project.id))
      .all()

    expect(phasesAfterRemove.map((phase) => `${phase.phase}:${phase.status}`).sort()).toEqual([
      'build_business_docs:pending',
      'build_docs:pending',
      'build_epics:pending',
      'build_service_map:pending',
    ])
    expect(docsAfterRemove.map((doc) => `${doc.id}:${doc.validity}`).sort()).toEqual([
      'doc:api:fresh',
      'doc:business:fresh',
    ])
    client.close()
  })

  describe('updateRepository branch change invalidation', () => {
    function seedAnalyzedRepo(db: ReturnType<typeof createTestPlattyDb>['db'], repoId: string) {
      db.update(repositories)
        .set({
          analysisBranch: 'feature/x',
          lastSyncedCommit: 'aaa111',
          analysisWorktreePath: '/worktrees/feature-x',
        })
        .where(eq(repositories.id, repoId))
        .run()

      db.insert(repositoryPhaseStatus).values(
        STATIC_REPO_PHASES.map((phase) => ({
          repositoryId: repoId,
          phase,
          status: 'passed' as const,
          validity: 'fresh' as const,
          sourceCommit: 'aaa111',
        })),
      ).run()
    }

    it('marks static phases stale and clears commit/worktree when branch changes', () => {
      const client = createTestPlattyDb()
      const project = createProject(client.db, { name: 'app' })
      const repoPath = gitRepo()
      const repo = addRepository(client.db, { projectId: project.id, path: repoPath, cwd: repoPath })
      seedAnalyzedRepo(client.db, repo.id)

      const result = updateRepository(client.db, {
        projectId: project.id,
        selector: repo.id,
        analysisBranch: 'main',
        cwd: repoPath,
      })

      expect(result.kind).toBe('found')
      if (result.kind !== 'found') return

      expect(result.repository.analysisBranch).toBe('main')
      expect(result.repository.lastSyncedCommit).toBeNull()
      expect(result.repository.analysisWorktreePath).toBeNull()

      const phases = client.db
        .select()
        .from(repositoryPhaseStatus)
        .where(eq(repositoryPhaseStatus.repositoryId, repo.id))
        .all()

      expect(phases).toHaveLength(STATIC_REPO_PHASES.length)
      expect(phases.every((p) => p.validity === 'stale')).toBe(true)

      client.close()
    })

    it('does not touch phase status when branch is unchanged', () => {
      const client = createTestPlattyDb()
      const project = createProject(client.db, { name: 'app' })
      const repoPath = gitRepo()
      const repo = addRepository(client.db, { projectId: project.id, path: repoPath, cwd: repoPath })
      seedAnalyzedRepo(client.db, repo.id)

      updateRepository(client.db, {
        projectId: project.id,
        selector: repo.id,
        analysisBranch: 'feature/x',
        cwd: repoPath,
      })

      const updated = client.db
        .select()
        .from(repositories)
        .where(eq(repositories.id, repo.id))
        .get()

      expect(updated?.lastSyncedCommit).toBe('aaa111')
      expect(updated?.analysisWorktreePath).toBe('/worktrees/feature-x')

      const phases = client.db
        .select()
        .from(repositoryPhaseStatus)
        .where(eq(repositoryPhaseStatus.repositoryId, repo.id))
        .all()

      expect(phases.every((p) => p.validity === 'fresh')).toBe(true)

      client.close()
    })

    it('does not touch phase status when non-branch fields change', () => {
      const client = createTestPlattyDb()
      const project = createProject(client.db, { name: 'app' })
      const repoPath = gitRepo()
      const repo = addRepository(client.db, { projectId: project.id, path: repoPath, cwd: repoPath })
      seedAnalyzedRepo(client.db, repo.id)

      updateRepository(client.db, {
        projectId: project.id,
        selector: repo.id,
        name: 'api-renamed',
        cwd: repoPath,
      })

      const updated = client.db
        .select()
        .from(repositories)
        .where(eq(repositories.id, repo.id))
        .get()

      expect(updated?.lastSyncedCommit).toBe('aaa111')

      const phases = client.db
        .select()
        .from(repositoryPhaseStatus)
        .where(eq(repositoryPhaseStatus.repositoryId, repo.id))
        .all()

      expect(phases.every((p) => p.validity === 'fresh')).toBe(true)

      client.close()
    })

    it('marks phases stale when branch is set to null', () => {
      const client = createTestPlattyDb()
      const project = createProject(client.db, { name: 'app' })
      const repoPath = gitRepo()
      const repo = addRepository(client.db, { projectId: project.id, path: repoPath, cwd: repoPath })
      seedAnalyzedRepo(client.db, repo.id)

      updateRepository(client.db, {
        projectId: project.id,
        selector: repo.id,
        analysisBranch: null,
        cwd: repoPath,
      })

      const updated = client.db
        .select()
        .from(repositories)
        .where(eq(repositories.id, repo.id))
        .get()

      expect(updated?.lastSyncedCommit).toBeNull()

      const phases = client.db
        .select()
        .from(repositoryPhaseStatus)
        .where(eq(repositoryPhaseStatus.repositoryId, repo.id))
        .all()

      expect(phases.every((p) => p.validity === 'stale')).toBe(true)

      client.close()
    })

    it('handles branch change with no existing phase rows without error', () => {
      const client = createTestPlattyDb()
      const project = createProject(client.db, { name: 'app' })
      const repoPath = gitRepo()
      const repo = addRepository(client.db, { projectId: project.id, path: repoPath, cwd: repoPath })

      expect(() =>
        updateRepository(client.db, {
          projectId: project.id,
          selector: repo.id,
          analysisBranch: 'main',
          cwd: repoPath,
        }),
      ).not.toThrow()

      client.close()
    })
  })

  it('reactivates a soft-deleted repository instead of creating a duplicate', () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'My App' })
    const repoPath = gitRepo()

    const first = addRepository(client.db, { projectId: project.id, path: repoPath, name: 'api', cwd: repoPath })
    const removed = removeRepository(client.db, project.id, first.id, repoPath)
    expect(removed.kind).toBe('found')

    const second = addRepository(client.db, { projectId: project.id, path: repoPath, name: 'api', cwd: repoPath })

    expect(second.id).toBe(first.id)
    expect(second.deletedAt).toBeNull()
    expect(listRepositories(client.db, project.id).map((repo) => repo.id)).toEqual([first.id])
    client.close()
  })
})
