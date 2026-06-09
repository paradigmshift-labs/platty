import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { getHeadCommit } from '@/pipeline_modules/analyze_repo/git_helpers.js'

const TMP = resolve(process.cwd(), '.tmp-test-git-helpers')

describe('getHeadCommit', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })
  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  it('returns null for non-existent path', () => {
    expect(getHeadCommit(join(TMP, 'does-not-exist'))).toBeNull()
  })

  it('returns null for non-git directory', () => {
    const dir = join(TMP, 'not-git')
    mkdirSync(dir, { recursive: true })
    expect(getHeadCommit(dir)).toBeNull()
  })

  it('returns null for git repo with no commits (just .git dir)', () => {
    const dir = join(TMP, 'empty-git')
    mkdirSync(join(dir, '.git'), { recursive: true })
    expect(getHeadCommit(dir)).toBeNull()
  })

  it('returns commit hash for valid git repo with one commit', () => {
    const dir = join(TMP, 'real-git')
    mkdirSync(dir, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
    writeFileSync(join(dir, 'a.txt'), 'x')
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })

    const hash = getHeadCommit(dir)
    expect(hash).toMatch(/^[0-9a-f]{40}$/)
  })
})
