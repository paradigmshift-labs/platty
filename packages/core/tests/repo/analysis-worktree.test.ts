import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getAnalysisWorktreeRoot } from '../../src/repo/analysis-worktree.js'

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
