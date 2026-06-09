import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createTestPlattyDb } from '../src/db/testing.js'
import { createProject } from '../src/project_service.js'
import {
  addRepository,
  listRepositories,
  removeRepository,
  resolveRepositorySelector,
  updateRepository,
} from '../src/repository_service.js'

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
})
