import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * `git rev-parse HEAD` — 분석 시점 commit hash 추출 (산출물 stale 추적용).
 *
 * 실패 시 `null` 반환:
 *   - .git 디렉토리 없음
 *   - 빈 git directory 또는 invalid worktree (commit 없음)
 *   - git 명령 실패
 */
export function getHeadCommit(repoPath: string): string | null {
  const gitPath = join(repoPath, '.git')
  if (!existsSync(gitPath)) return null
  try {
    const stat = statSync(gitPath)
    if (!stat.isDirectory() && !stat.isFile()) return null
  } catch {
    return null
  }

  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 5_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (resolve(root) !== resolve(repoPath)) return null

    const result = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 5_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const trimmed = result.trim()
    return /^[0-9a-f]{40}$/.test(trimmed) ? trimmed : null
  } catch {
    return null
  }
}
