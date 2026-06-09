/**
 * git_helpers — V2 단위 테스트
 *
 * V1 로직 동일: getHeadCommit이 .git 없으면 null, execSync 실패 시 null.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { getHeadCommit } from '@/pipeline_modules/build_graph/git_helpers.js'

describe('getHeadCommit', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sdd-git-'))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('정상 git repo → SHA 반환', () => {
    execSync('git init -q && git config user.email t@t.t && git config user.name t', { cwd: tmp })
    writeFileSync(join(tmp, 'a.txt'), 'a')
    execSync('git add -A && git commit -q -m init', { cwd: tmp })

    const sha = getHeadCommit(tmp)
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('.git 디렉토리 없음 → null', () => {
    expect(getHeadCommit(tmp)).toBeNull()
  })

  it('.git만 있고 commit 없음 → execSync 실패 → null', () => {
    mkdirSync(join(tmp, '.git'))
    expect(getHeadCommit(tmp)).toBeNull()
  })

  it('존재하지 않는 경로 → null', () => {
    expect(getHeadCommit('/nonexistent/path/xyz')).toBeNull()
  })
})
