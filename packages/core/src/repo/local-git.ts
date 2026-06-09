/**
 * LocalGitSource — 로컬 git repo 기반 CodeSource 구현
 *
 * SOT: specs/phase0_foundation.md (S-4: createCodeSource)
 *
 * - git 실행: child_process.execFile 전용 (exec/execSync 금지)
 * - GIT_TERMINAL_PROMPT=0, timeout 60초
 * - Path Traversal 6단계 방어
 * - 파일 크기 5MB 상한 + 바이너리 감지
 * - 커밋 해시 정규식 검증
 * - 프로토콜 allowlist (https://, git@, 로컬 경로)
 */

import { execFile, execFileSync } from 'node:child_process'
import { readFile as fsReadFile, stat, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, sep, isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import type { CodeSource, DiffEntry } from './source.js'

const execFileAsync = promisify(execFile)

// ── 상수 ──

const MAX_FILE_SIZE = 5 * 1024 * 1024  // 5MB
const BINARY_CHECK_SIZE = 8 * 1024      // 8KB
const MAX_LINES = 10_000
const GIT_TIMEOUT = 60_000               // 60초
const COMMIT_HASH_RE = /^[0-9a-f]{6,40}$/i
const PROTOCOL_ALLOWLIST = ['https://', 'http://', 'git@', 'ssh://']

// ── 에러 ──

export class GitNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitNotFoundError'
  }
}

export class PathTraversalError extends Error {
  constructor() {
    super('Access denied')
    this.name = 'PathTraversalError'
  }
}

export class BinaryFileError extends Error {
  constructor(filePath: string) {
    super(`Binary file detected: ${filePath}`)
    this.name = 'BinaryFileError'
  }
}

// ── git 헬퍼 ──

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT,
    maxBuffer: 50 * 1024 * 1024, // 50MB diff 대응
    env: GIT_ENV,
  })
  return stdout
}

// ── 구현 ──

export class LocalGitSource implements CodeSource {
  /** repoRoot는 항상 resolve() + sep 종료 (startsWith 비교용) */
  public readonly repoRoot: string

  constructor(rawRoot: string) {
    // git 존재 확인 (동기 — 생성 시 1회)
    try {
      execFileSync('git', ['--version'], { timeout: 5000, env: GIT_ENV })
    } catch {
      throw new GitNotFoundError(
        'git is not installed or not found in PATH. Install git and try again.',
      )
    }

    const resolved = resolve(rawRoot)
    // sep 종료 보장 (startsWith 비교 시 /repo가 /repo-other에 매칭되는 것 방지)
    this.repoRoot = resolved.endsWith(sep) ? resolved : resolved + sep
  }

  // ── CodeSource 구현 ──

  async cloneOrPull(repoUrl: string, branch?: string): Promise<string> {
    // 프로토콜 검증
    if (this.isLocalPath(repoUrl)) {
      return this.handleLocalRepo(repoUrl)
    }

    this.validateProtocol(repoUrl)
    return this.handleRemoteRepo(repoUrl, branch)
  }

  async readFile(filePath: string): Promise<string> {
    const resolvedPath = await this.securePath(filePath)
    await this.checkFileSize(resolvedPath)
    const content = await fsReadFile(resolvedPath, 'utf-8')
    this.checkBinary(content, filePath)
    return content
  }

  async readLines(filePath: string, startLine: number, endLine: number): Promise<string> {
    if (startLine < 1) {
      throw new Error('startLine must be >= 1')
    }
    if (startLine > endLine) {
      throw new Error('startLine must be <= endLine')
    }
    if (endLine - startLine + 1 > MAX_LINES) {
      throw new Error(`Line range exceeds maximum of ${MAX_LINES} lines`)
    }

    const content = await this.readFile(filePath)
    const lines = content.split('\n')
    // 1-based, inclusive
    const slice = lines.slice(startLine - 1, endLine)
    return slice.join('\n')
  }

  async getDiff(fromCommit: string, toCommit: string): Promise<DiffEntry[]> {
    this.validateCommitHash(fromCommit)
    this.validateCommitHash(toCommit)

    const repoDir = this.repoRoot.endsWith(sep)
      ? this.repoRoot.slice(0, -1)
      : this.repoRoot

    const output = await runGit(
      ['diff', '--name-status', '-M', `${fromCommit}..${toCommit}`],
      repoDir,
    )

    return this.parseDiffOutput(output)
  }

  async dispose(): Promise<void> {
    // MVP: no-op
  }

  // ── Path Traversal 6단계 방어 ──

  private async securePath(filePath: string): Promise<string> {
    // Step 0: null byte 체크
    if (filePath.includes('\0')) {
      throw new PathTraversalError()
    }

    // Step 1: 절대경로 거부
    if (isAbsolute(filePath)) {
      throw new PathTraversalError()
    }

    // Step 1b: '..' 세그먼트 거부 (segment 단위)
    const segments = filePath.split(/[/\\]/)
    if (segments.includes('..')) {
      throw new PathTraversalError()
    }

    // Step 2: resolve
    const resolved = resolve(this.repoRoot, filePath)

    // Step 3: startsWith 체크
    if (!resolved.startsWith(this.repoRoot)) {
      throw new PathTraversalError()
    }

    // Step 4: realpath (symlink 해석)
    let real: string
    try {
      real = await realpath(resolved)
    } catch {
      // 파일이 존재하지 않는 경우
      throw new Error(`File not found: ${filePath}`)
    }

    // Step 5: 재검증 (symlink가 repo 밖을 가리킬 수 있음)
    // repoRoot의 realpath도 구해서 비교
    let realRoot: string
    try {
      const rootWithoutSep = this.repoRoot.endsWith(sep)
        ? this.repoRoot.slice(0, -1)
        : this.repoRoot
      realRoot = await realpath(rootWithoutSep)
      if (!realRoot.endsWith(sep)) {
        realRoot = realRoot + sep
      }
    } catch {
      throw new PathTraversalError()
    }

    if (!real.startsWith(realRoot) && real !== realRoot.slice(0, -1)) {
      throw new PathTraversalError()
    }

    return resolved
  }

  // ── 파일 검증 ──

  private async checkFileSize(resolvedPath: string): Promise<void> {
    const fileStat = await stat(resolvedPath)
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error(`File exceeds maximum size of ${MAX_FILE_SIZE} bytes (${fileStat.size} bytes)`)
    }
  }

  private checkBinary(content: string, filePath: string): void {
    // 첫 8KB에서 null byte 감지
    const checkPortion = content.slice(0, BINARY_CHECK_SIZE)
    if (checkPortion.includes('\0')) {
      throw new BinaryFileError(filePath)
    }
  }

  // ── 커밋 해시 검증 ──

  private validateCommitHash(hash: string): void {
    if (!COMMIT_HASH_RE.test(hash)) {
      throw new Error(`Invalid commit hash format: must be 6-40 hex characters`)
    }
  }

  // ── cloneOrPull 헬퍼 ──

  private isLocalPath(repoUrl: string): boolean {
    // file:// 프로토콜 거부
    if (repoUrl.startsWith('file://')) {
      throw new Error('file:// protocol is not allowed. Use a local path or https/git@ URL.')
    }

    // 원격 URL이 아닌 경우 로컬 경로로 취급
    return !PROTOCOL_ALLOWLIST.some(p => repoUrl.startsWith(p))
  }

  private validateProtocol(repoUrl: string): void {
    if (!PROTOCOL_ALLOWLIST.some(p => repoUrl.startsWith(p))) {
      throw new Error(
        `Unsupported protocol in URL: ${repoUrl}. Allowed: ${PROTOCOL_ALLOWLIST.join(', ')} or local path.`,
      )
    }
  }

  private async handleLocalRepo(localPath: string): Promise<string> {
    const resolved = resolve(localPath)

    if (!existsSync(resolved)) {
      throw new Error(`Local path does not exist: ${localPath}`)
    }

    // git rev-parse로 유효한 git repo인지 확인 (bare/non-bare 모두 대응)
    try {
      await runGit(['rev-parse', '--git-dir'], resolved)
    } catch {
      throw new Error(`Not a git repository: ${localPath}`)
    }

    return resolved
  }

  private async handleRemoteRepo(repoUrl: string, branch?: string): Promise<string> {
    const repoDir = this.repoRoot.endsWith(sep)
      ? this.repoRoot.slice(0, -1)
      : this.repoRoot

    // 이미 clone 되어 있으면 pull
    if (existsSync(resolve(repoDir, '.git'))) {
      const pullArgs = ['pull', '--ff-only']
      await runGit(pullArgs, repoDir)
      return repoDir
    }

    // 새로 clone
    const cloneArgs = ['clone']
    if (branch) {
      cloneArgs.push('--branch', branch)
    }
    cloneArgs.push('--single-branch', repoUrl, repoDir)

    // clone은 repoDir의 부모에서 실행
    await runGit(cloneArgs)
    return repoDir
  }

  // ── diff 파싱 ──

  private parseDiffOutput(output: string): DiffEntry[] {
    const entries: DiffEntry[] = []

    for (const line of output.split('\n')) {
      if (!line.trim()) continue

      const parts = line.split('\t')
      if (parts.length < 2) continue

      const statusCode = parts[0].trim()
      const firstPath = parts[1]

      if (statusCode === 'A') {
        entries.push({ status: 'added', filePath: firstPath })
      } else if (statusCode === 'M') {
        entries.push({ status: 'modified', filePath: firstPath })
      } else if (statusCode === 'D') {
        entries.push({ status: 'deleted', filePath: firstPath })
      } else if (statusCode.startsWith('R')) {
        // Rename: R100\toldPath\tnewPath
        const newPath = parts[2] ?? firstPath
        entries.push({ status: 'renamed', filePath: newPath, oldPath: firstPath })
      }
    }

    return entries
  }
}
