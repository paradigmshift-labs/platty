import { describe, it, expect, vi } from 'vitest'

const fsState = vi.hoisted(() => ({
  exists: true,
  statError: null as Error | null,
  isDirectory: true,
  execResult: 'not-a-hash\n',
  execError: null as Error | null,
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => fsState.exists),
  statSync: vi.fn(() => {
    if (fsState.statError) throw fsState.statError
    return { isDirectory: () => fsState.isDirectory }
  }),
}))

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => {
    if (fsState.execError) throw fsState.execError
    return fsState.execResult
  }),
}))

const { getHeadCommit } = await import('@/pipeline_modules/analyze_repo/git_helpers.js')

describe('getHeadCommit branch handling', () => {
  it('returns null when .git stat fails', () => {
    fsState.exists = true
    fsState.statError = new Error('stat failed')
    fsState.isDirectory = true
    fsState.execResult = '0'.repeat(40)
    fsState.execError = null

    expect(getHeadCommit('/repo')).toBeNull()
  })

  it('returns null when .git is not a directory', () => {
    fsState.exists = true
    fsState.statError = null
    fsState.isDirectory = false
    fsState.execResult = '0'.repeat(40)
    fsState.execError = null

    expect(getHeadCommit('/repo')).toBeNull()
  })

  it('returns null when git returns a non-hash value', () => {
    fsState.exists = true
    fsState.statError = null
    fsState.isDirectory = true
    fsState.execResult = 'HEAD\n'
    fsState.execError = null

    expect(getHeadCommit('/repo')).toBeNull()
  })

  it('returns null when git command throws', () => {
    fsState.exists = true
    fsState.statError = null
    fsState.isDirectory = true
    fsState.execResult = '0'.repeat(40)
    fsState.execError = new Error('git failed')

    expect(getHeadCommit('/repo')).toBeNull()
  })
})
