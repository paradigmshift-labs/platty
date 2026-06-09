import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validateRepo, ValidateRepoError } from '@/pipeline_modules/analyze_repo/f1_validate_repo.js'

/**
 * f1_validate_repo TDD 시나리오 enumerate.
 *
 * 검증 우선순위 순서대로 (V1 동작 따름):
 *   1. 타입/빈값
 *   2. null byte
 *   3. path traversal
 *   4. 존재 X (ENOENT)
 *   5. 권한 없음 (EACCES) — 테스트 어려움, skip
 *   6. 파일 (디렉토리 아님)
 *   7. .git 없음
 *   8. .git이 파일 (git worktree)
 *   9. 정상 → RepoInfo
 *  10. 정규화: 상대경로 → 절대경로
 *  11. 정규화: trailing slash 제거
 *  12. 정규화: backslash → forward slash (POSIX에선 미발생, 검증 X)
 */

const TMP_ROOT = resolve(process.cwd(), '.tmp-test-validate-repo')

function mkRepo(name: string): string {
  const repoPath = join(TMP_ROOT, name)
  mkdirSync(join(repoPath, '.git'), { recursive: true })
  return repoPath
}

describe('validateRepo', () => {
  beforeAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true })
    mkdirSync(TMP_ROOT, { recursive: true })
  })

  afterAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true })
  })

  // ── 1. 타입/빈값 ──
  it('throws INVALID_INPUT for empty string', () => {
    expect(() => validateRepo('')).toThrow(ValidateRepoError)
    expect(() => validateRepo('')).toThrow(/INVALID_INPUT|비어/)
  })

  it('throws INVALID_INPUT for whitespace-only', () => {
    expect(() => validateRepo('   ')).toThrow(ValidateRepoError)
  })

  // ── 2. null byte ──
  it('throws NULL_BYTE for path containing null character', () => {
    expect(() => validateRepo('foo\0bar')).toThrow(/NULL_BYTE|null|유효하지 않/)
  })

  // ── 3. path traversal ──
  it('throws OUT_OF_SCOPE for path outside cwd', () => {
    expect(() => validateRepo('/etc')).toThrow(/OUT_OF_SCOPE|허용 범위/)
  })

  it('throws OUT_OF_SCOPE for ".." going above cwd', () => {
    expect(() => validateRepo('../../../tmp')).toThrow(/OUT_OF_SCOPE/)
  })

  // ── 4. 존재 X ──
  it('throws NOT_FOUND for non-existing path', () => {
    expect(() => validateRepo('.tmp-test-validate-repo/does-not-exist')).toThrow(/NOT_FOUND|존재하지/)
  })

  // ── 6. 파일 ──
  it('throws NOT_A_DIRECTORY for a file path', () => {
    const filePath = join(TMP_ROOT, 'a-file.txt')
    writeFileSync(filePath, 'hello')
    const rel = '.tmp-test-validate-repo/a-file.txt'
    expect(() => validateRepo(rel)).toThrow(/NOT_A_DIRECTORY|디렉토리/)
  })

  // ── 7. .git 없음 ──
  it('throws NOT_A_GIT_REPO when .git is missing', () => {
    const dir = join(TMP_ROOT, 'no-git')
    mkdirSync(dir, { recursive: true })
    const rel = '.tmp-test-validate-repo/no-git'
    expect(() => validateRepo(rel)).toThrow(/NOT_A_GIT_REPO|Git/)
  })

  // ── 8. .git이 파일 (git worktree) ──
  it('accepts .git file for git worktree checkouts', () => {
    const dir = join(TMP_ROOT, 'git-as-file')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.git'), 'gitdir: ../some/where')
    const rel = '.tmp-test-validate-repo/git-as-file'
    const result = validateRepo(rel)
    expect(result.source).toBe('local')
    expect(result.name).toBe('git-as-file')
  })

  // ── 9. 정상 ──
  it('returns RepoInfo for valid repo', () => {
    const repoPath = mkRepo('valid-repo')
    const rel = '.tmp-test-validate-repo/valid-repo'
    const result = validateRepo(rel)
    expect(result.source).toBe('local')
    expect(result.name).toBe('valid-repo')
    expect(result.path).toBe(repoPath.replace(/\\/g, '/'))
  })

  // ── 10. 상대 → 절대 ──
  it('normalizes relative path to absolute', () => {
    mkRepo('rel-test')
    const result = validateRepo('.tmp-test-validate-repo/rel-test')
    expect(result.path).toBe(resolve(TMP_ROOT, 'rel-test').replace(/\\/g, '/'))
    expect(result.path.startsWith(process.cwd().replace(/\\/g, '/'))).toBe(true)
  })

  // ── 11. trailing slash 제거 ──
  it('strips trailing slash', () => {
    mkRepo('trailing-slash')
    const result = validateRepo('.tmp-test-validate-repo/trailing-slash/')
    expect(result.path.endsWith('/')).toBe(false)
  })

  // ── S7. symlink → 내부 디렉토리 (정상) ──
  it('S7: resolves symlink pointing to internal repo (within cwd)', () => {
    const realRepo = mkRepo('real-repo-for-symlink')
    const linkPath = join(TMP_ROOT, 'link-to-real')
    symlinkSync(realRepo, linkPath, 'dir')
    const rel = '.tmp-test-validate-repo/link-to-real'
    const result = validateRepo(rel)
    // realpath로 해소된 path 반환 — symlink 자체가 아닌 실제 위치
    expect(result.path).toBe(realRepo.replace(/\\/g, '/'))
    expect(result.source).toBe('local')
  })

  // ── S8. symlink → 외부 (throw, 단일 정책) ──
  it('S8: throws OUT_OF_SCOPE for symlink pointing outside cwd', () => {
    // /tmp/<random>/external-target — cwd 외부
    const externalDir = '/tmp/.test-validate-repo-external-' + Date.now()
    mkdirSync(join(externalDir, '.git'), { recursive: true })
    try {
      const linkPath = join(TMP_ROOT, 'evil-link')
      symlinkSync(externalDir, linkPath, 'dir')
      const rel = '.tmp-test-validate-repo/evil-link'
      expect(() => validateRepo(rel)).toThrow(/OUT_OF_SCOPE|symlink|허용 범위/)
    } finally {
      rmSync(externalDir, { recursive: true, force: true })
    }
  })
})
