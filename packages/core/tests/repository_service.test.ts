import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createTestPlattyDb } from '../src/db/testing.js'
import { createProject } from '../src/project_service.js'
import { addRepository, listRepositories } from '../src/repository_service.js'

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
})
