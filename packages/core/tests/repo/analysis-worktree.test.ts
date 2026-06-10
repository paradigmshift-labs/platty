import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getAnalysisWorktreeRoot, prepareAnalysisWorktree } from '../../src/repo/analysis-worktree.js'

describe('analysis worktree root', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to the user-global Platty worktrees directory', () => {
    vi.stubEnv('PLATTY_HOME', '/tmp/platty-home')
    vi.stubEnv('PLATTY_WORKTREE_ROOT', undefined)

    expect(getAnalysisWorktreeRoot()).toBe(join('/tmp/platty-home', 'worktrees'))
  })

  it('allows PLATTY_WORKTREE_ROOT to override the global default', () => {
    vi.stubEnv('PLATTY_HOME', '/tmp/platty-home')
    vi.stubEnv('PLATTY_WORKTREE_ROOT', '/tmp/custom-worktrees')

    expect(getAnalysisWorktreeRoot()).toBe('/tmp/custom-worktrees')
  })
})

describe('prepareAnalysisWorktree', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fetches and checks out the latest origin branch commit without moving the local branch', () => {
    const root = mkdtempSync(join(tmpdir(), 'platty-analysis-worktree-'))
    tempDirs.push(root)
    const sourceRepo = join(root, 'source')
    const originRepo = join(root, 'origin.git')
    const worktreeRoot = join(root, 'worktrees')

    git(root, ['init', '-q', '-b', 'main', sourceRepo])
    git(sourceRepo, ['config', 'user.email', 'platty@example.test'])
    git(sourceRepo, ['config', 'user.name', 'Platty Test'])
    writeFileSync(join(sourceRepo, 'app.txt'), 'old\n')
    git(sourceRepo, ['add', 'app.txt'])
    git(sourceRepo, ['commit', '-q', '-m', 'old'])
    const oldCommit = git(sourceRepo, ['rev-parse', 'HEAD'])

    git(root, ['init', '-q', '--bare', '-b', 'main', originRepo])
    git(sourceRepo, ['remote', 'add', 'origin', originRepo])
    git(sourceRepo, ['push', '-q', '-u', 'origin', 'main'])

    writeFileSync(join(sourceRepo, 'app.txt'), 'new\n')
    git(sourceRepo, ['commit', '-q', '-am', 'new'])
    const newCommit = git(sourceRepo, ['rev-parse', 'HEAD'])
    git(sourceRepo, ['push', '-q', 'origin', 'main'])
    git(sourceRepo, ['reset', '--hard', oldCommit])

    const prepared = prepareAnalysisWorktree({
      sourceRepoPath: sourceRepo,
      repositoryId: 'repo_1',
      branch: 'main',
      worktreeRoot,
    })

    expect(prepared.headCommit).toBe(newCommit)
    expect(git(sourceRepo, ['rev-parse', 'main'])).toBe(oldCommit)
    expect(readFileSync(join(prepared.path, 'app.txt'), 'utf8')).toBe('new\n')
  })
})

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  }).trim()
}
