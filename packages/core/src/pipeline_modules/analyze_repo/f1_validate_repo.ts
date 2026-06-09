import { statSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, join, basename, sep } from 'node:path'
import type { RepoInfo } from './types.js'

/**
 * F1: validateRepo — 단일 repo 경로를 검증하고 RepoInfo를 반환한다 (순수 동기, no DB, no LLM).
 *
 * 검증 순서 (v2 — symlink escape 단일 정책):
 *   1. 타입체크 + 빈값/공백
 *   2. null byte
 *   3. path traversal (입력 path가 cwd 또는 명시 허용 root 안인지)
 *   4. statSync — 존재 여부 (ENOENT/EACCES)
 *   5. isDirectory
 *   6. realpathSync — symlink 해소 후 cwd 안인지 재검증 (S8: 외부 가리킴 → throw)
 *   7. lstatSync(.git) — 디렉토리 또는 git worktree file인지
 *
 * 정규화:
 *   - 상대경로 → 절대경로
 *   - trailing slash 제거 (resolve가 자동)
 *   - symlink → realpath 해소 후 path 사용 (S7: 내부 가리킴 → realpath 반환)
 *   - backslash → forward slash
 *
 * 실패 시 ValidateRepoError를 throw. warning fallback 없음 (단일 정책 — spec §3 S8).
 */
export interface ValidateRepoOptions {
  allowedRoots?: string[]
}

export function validateRepo(repoPath: string, options: ValidateRepoOptions = {}): RepoInfo {
  // 1. 타입체크 + 빈값/공백
  if (typeof repoPath !== 'string' || repoPath.trim() === '') {
    throw new ValidateRepoError('repo 경로가 비어 있거나 유효하지 않습니다 [INVALID_INPUT]', 'INVALID_INPUT')
  }

  // 2. null byte 검사
  if (repoPath.includes('\0')) {
    throw new ValidateRepoError('repo 경로에 유효하지 않은 문자가 포함되어 있습니다 [NULL_BYTE]', 'NULL_BYTE')
  }

  // 3. path traversal 방어 — cwd 또는 명시 허용 root 하위만 허용
  const cwd = process.cwd()
  const resolved = resolve(repoPath)
  const allowedRoots = normalizeAllowedRoots(options.allowedRoots)
  if (!isPathUnderAllowedRoot(resolved, cwd, allowedRoots)) {
    throw new ValidateRepoError('repo 경로가 허용 범위를 벗어났습니다 [OUT_OF_SCOPE]', 'OUT_OF_SCOPE')
  }

  // 4. 존재 여부
  let pathStat: ReturnType<typeof statSync>
  try {
    pathStat = statSync(resolved)
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new ValidateRepoError('repo 경로가 존재하지 않습니다 [NOT_FOUND]', 'NOT_FOUND', { cause: err })
      }
      if (code === 'EACCES') {
        throw new ValidateRepoError('repo 읽기 권한이 없습니다 [PERMISSION_DENIED]', 'PERMISSION_DENIED', { cause: err })
      }
    }
    throw new ValidateRepoError('repo 경로 검증 중 오류가 발생했습니다 [IO_ERROR]', 'IO_ERROR', { cause: err })
  }

  // 5. 디렉토리 여부
  if (!pathStat.isDirectory()) {
    throw new ValidateRepoError('repo 경로가 디렉토리가 아닙니다 [NOT_A_DIRECTORY]', 'NOT_A_DIRECTORY')
  }

  // 6. realpath — symlink 해소 후 허용 root 안인지 재검증 (symlink escape 방어)
  let realPath: string
  try {
    realPath = realpathSync(resolved)
  } catch (err: unknown) {
    throw new ValidateRepoError('repo 경로 검증 중 오류가 발생했습니다 [IO_ERROR]', 'IO_ERROR', { cause: err })
  }
  if (!isPathUnderAllowedRoot(realPath, cwd, allowedRoots)) {
    throw new ValidateRepoError('symlink가 허용 범위 밖을 가리킵니다 [OUT_OF_SCOPE]', 'OUT_OF_SCOPE')
  }

  // 7. .git 검증 (realpath 기준): 일반 checkout은 directory, git worktree는 file.
  const gitPath = join(realPath, '.git')
  let gitStat: ReturnType<typeof lstatSync>
  try {
    gitStat = lstatSync(gitPath)
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new ValidateRepoError('유효한 Git 저장소가 아닙니다 [NOT_A_GIT_REPO]', 'NOT_A_GIT_REPO', { cause: err })
      }
      if (code === 'EACCES') {
        throw new ValidateRepoError('repo 읽기 권한이 없습니다 [PERMISSION_DENIED]', 'PERMISSION_DENIED', { cause: err })
      }
    }
    throw new ValidateRepoError('repo 경로 검증 중 오류가 발생했습니다 [IO_ERROR]', 'IO_ERROR', { cause: err })
  }
  if (!gitStat.isDirectory() && !gitStat.isFile()) {
    throw new ValidateRepoError('유효한 Git 저장소가 아닙니다 [NOT_A_GIT_REPO]', 'NOT_A_GIT_REPO')
  }

  // 정규화 후 RepoInfo 반환 (realpath 기준)
  const normalizedPath = realPath.replace(/\\/g, '/')
  return {
    path: normalizedPath,
    name: basename(realPath),
    source: 'local',
  }
}

function normalizeAllowedRoots(roots: string[] | undefined): string[] {
  return [...new Set((roots ?? []).flatMap((root) => {
    const resolved = resolve(root)
    try {
      return [resolved, realpathSync(resolved)]
    } catch {
      return [resolved]
    }
  }))]
}

function isPathUnderAllowedRoot(path: string, cwd: string, allowedRoots: string[]): boolean {
  const roots = [cwd, ...allowedRoots]
  return roots.some((root) => path === root || path.startsWith(root + sep))
}

/**
 * validateRepo 전용 에러. 사용자에게 표시할 메시지 + 분류 코드.
 */
export class ValidateRepoError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_INPUT'
      | 'NULL_BYTE'
      | 'OUT_OF_SCOPE'
      | 'NOT_FOUND'
      | 'PERMISSION_DENIED'
      | 'NOT_A_DIRECTORY'
      | 'NOT_A_GIT_REPO'
      | 'IO_ERROR',
    options?: { cause?: unknown },
  ) {
    super(message)
    this.name = 'ValidateRepoError'
    if (options?.cause !== undefined) {
      ;(this as { cause?: unknown }).cause = options.cause
    }
  }
}
