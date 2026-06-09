/**
 * CodeSource — 코드 소스 추상화 인터페이스
 *
 * SOT: specs/phase0_foundation.md (S-4: createCodeSource)
 *
 * MVP: LocalGitSource (로컬 git repo)
 * 프로덕션: GitHubApiSource 등 — 인터페이스 동일, 구현체만 교체
 */

import { LocalGitSource } from './local-git.js'

// ── 타입 ──

export interface DiffEntry {
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  filePath: string
  oldPath?: string  // renamed 시
}

// ── 인터페이스 ──

export interface CodeSource {
  /** repo 준비 (clone or pull) -> 로컬 경로 반환 */
  cloneOrPull(repoUrl: string, branch?: string): Promise<string>

  /** 파일 전체 읽기 (repo root 기준 상대 경로, Path Traversal 검증) */
  readFile(filePath: string): Promise<string>

  /** 특정 라인 범위 읽기 (1-based, inclusive, Path Traversal 검증) */
  readLines(filePath: string, startLine: number, endLine: number): Promise<string>

  /** 두 커밋 사이 diff (커밋 해시 형식 검증) */
  getDiff(fromCommit: string, toCommit: string): Promise<DiffEntry[]>

  /** 리소스 정리 */
  dispose(): Promise<void>
}

// ── 팩토리 ──

export class CodeSourceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'CodeSourceError'
  }
}

/**
 * CodeSource 팩토리 — 환경변수 CODE_SOURCE 기반 (기본값: 'local-git')
 */
export function createCodeSource(repoRoot: string): CodeSource {
  const sourceType = process.env.CODE_SOURCE ?? 'local-git'

  if (sourceType !== 'local-git') {
    throw new CodeSourceError(
      `Unsupported CODE_SOURCE: '${sourceType}'. Expected 'local-git'.`,
      'INVALID_SOURCE',
    )
  }

  return new LocalGitSource(repoRoot)
}
