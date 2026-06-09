/**
 * git_helpers — repository_phase_status.built_from_commit 기록용 helper.
 * M2 analyze_repo/git_helpers.ts와 동일 로직 (M5+에서 _shared로 공통화 결정 — Q8).
 *
 * 안전장치:
 *   - GIT_DIR 환경변수 강제 (외부 .git traversal 차단)
 *   - existsSync 사전 체크
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export function getHeadCommit(repoPath: string): string | null {
  const gitPath = resolve(repoPath, '.git')
  if (!existsSync(gitPath)) return null
  try {
    const stat = statSync(gitPath)
    if (!stat.isDirectory() && !stat.isFile()) return null
  } catch {
    return null
  }
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    /* v8 ignore next -- successful `git rev-parse HEAD` returns a non-empty SHA; empty output is a defensive fallback. */
    return out || null
  } catch {
    return null
  }
}
