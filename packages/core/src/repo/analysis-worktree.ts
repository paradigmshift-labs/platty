import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { getPlattyHomeDir } from '@/db/paths.js'

export interface PrepareAnalysisWorktreeInput {
  sourceRepoPath: string
  repositoryId: string
  branch: string
  worktreeRoot?: string
}

export interface PreparedAnalysisWorktree {
  path: string
  branch: string
  headCommit: string
}

export class AnalysisWorktreeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_BRANCH'
      | 'INVALID_REPOSITORY_ID'
      | 'SOURCE_NOT_GIT'
      | 'BRANCH_NOT_FOUND'
      | 'REMOTE_FETCH_FAILED'
      | 'WORKTREE_FAILED',
    options?: { cause?: unknown },
  ) {
    super(message)
    this.name = 'AnalysisWorktreeError'
    if (options?.cause !== undefined) {
      ;(this as { cause?: unknown }).cause = options.cause
    }
  }
}

export function getAnalysisWorktreeRoot(): string {
  return resolve(process.env.PLATTY_WORKTREE_ROOT ?? join(getPlattyHomeDir(), 'worktrees'))
}

export function cleanupAnalysisWorktree(input: {
  sourceRepoPath: string
  worktreePath: string | null | undefined
  worktreeRoot?: string
}): void {
  if (!input.worktreePath) return

  const worktreePath = resolve(input.worktreePath)
  const root = resolve(input.worktreeRoot ?? getAnalysisWorktreeRoot())
  if (worktreePath !== root && !worktreePath.startsWith(root + '/')) {
    throw new AnalysisWorktreeError('refusing to delete worktree outside Platty worktree root', 'WORKTREE_FAILED')
  }

  if (!existsSync(worktreePath)) return

  try {
    runGit(input.sourceRepoPath, ['worktree', 'remove', '--force', worktreePath])
    runGit(input.sourceRepoPath, ['worktree', 'prune'])
  } finally {
    rmSync(worktreePath, { recursive: true, force: true })
  }
}

export function detectDefaultAnalysisBranch(sourceRepoPath: string): string | null {
  const remoteDefault = runGit(sourceRepoPath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  if (remoteDefault?.startsWith('origin/')) return remoteDefault.slice('origin/'.length)

  if (hasBranch(sourceRepoPath, 'main')) return 'main'
  if (hasBranch(sourceRepoPath, 'master')) return 'master'
  return null
}

export function prepareAnalysisWorktree(input: PrepareAnalysisWorktreeInput): PreparedAnalysisWorktree {
  const sourceRepoPath = resolve(input.sourceRepoPath)
  const branch = input.branch.trim()
  validateRepositoryId(input.repositoryId)
  validateBranchName(sourceRepoPath, branch)

  const sourceRoot = runGitOrThrow(sourceRepoPath, ['rev-parse', '--show-toplevel'], 'SOURCE_NOT_GIT')
  if (realpathSync(resolve(sourceRoot)) !== realpathSync(sourceRepoPath)) {
    throw new AnalysisWorktreeError('source repository path must be a git root', 'SOURCE_NOT_GIT')
  }

  const commit = resolveBranchCommit(sourceRepoPath, branch)
  if (!commit) {
    throw new AnalysisWorktreeError(`analysis branch not found: ${branch}`, 'BRANCH_NOT_FOUND')
  }

  const root = resolve(input.worktreeRoot ?? getAnalysisWorktreeRoot())
  const sourceSlug = sourceRepoSlug(sourceRepoPath)
  const worktreePath = join(root, input.repositoryId, sourceSlug, branchSlug(branch))
  mkdirSync(join(root, input.repositoryId, sourceSlug), { recursive: true })

  if (existsSync(worktreePath)) {
    try {
      refreshExistingWorktree(worktreePath, commit)
    } catch {
      rmSync(worktreePath, { recursive: true, force: true })
      runGit(sourceRepoPath, ['worktree', 'prune'])
      addWorktree(sourceRepoPath, worktreePath, commit)
    }
  } else {
    addWorktree(sourceRepoPath, worktreePath, commit)
  }

  const headCommit = runGitOrThrow(worktreePath, ['rev-parse', 'HEAD'], 'WORKTREE_FAILED')
  return { path: worktreePath, branch, headCommit }
}

function hasBranch(repoPath: string, branch: string): boolean {
  return Boolean(
    runGit(repoPath, ['show-ref', '--verify', `refs/heads/${branch}`]) ||
    runGit(repoPath, ['show-ref', '--verify', `refs/remotes/origin/${branch}`]),
  )
}

function resolveBranchCommit(repoPath: string, branch: string): string | null {
  const remote = fetchRemoteBranchCommit(repoPath, branch)
  if (remote.kind === 'found') return remote.commit
  if (remote.kind === 'failed') {
    throw new AnalysisWorktreeError(`failed to fetch latest origin branch: ${branch}`, 'REMOTE_FETCH_FAILED', {
      cause: remote.error,
    })
  }

  const local = runGit(repoPath, ['rev-parse', '--verify', `${branch}^{commit}`])
  if (isCommit(local)) return local
  if (remote.kind === 'remote_missing') return null

  const remoteTracking = runGit(repoPath, ['rev-parse', '--verify', `origin/${branch}^{commit}`])
  return isCommit(remoteTracking) ? remoteTracking : null
}

function fetchRemoteBranchCommit(
  repoPath: string,
  branch: string,
): { kind: 'found'; commit: string } | { kind: 'no_origin' } | { kind: 'remote_missing' } | { kind: 'failed'; error: unknown } {
  if (!runGit(repoPath, ['remote', 'get-url', 'origin'])) return { kind: 'no_origin' }

  const refspec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`
  const fetched = runGitDetailed(repoPath, ['fetch', '--prune', 'origin', refspec])
  if (!fetched.ok) {
    if (isMissingRemoteBranchError(fetched.stderr)) return { kind: 'remote_missing' }
    return { kind: 'failed', error: fetched.error }
  }

  const remote = runGit(repoPath, ['rev-parse', '--verify', `origin/${branch}^{commit}`])
  return isCommit(remote) ? { kind: 'found', commit: remote } : { kind: 'remote_missing' }
}

function refreshExistingWorktree(worktreePath: string, commit: string): void {
  try {
    if (!statSync(worktreePath).isDirectory()) {
      throw new AnalysisWorktreeError('worktree path exists but is not a directory', 'WORKTREE_FAILED')
    }
    runGitOrThrow(worktreePath, ['checkout', '--detach', commit], 'WORKTREE_FAILED')
    runGitOrThrow(worktreePath, ['reset', '--hard', commit], 'WORKTREE_FAILED')
    runGitOrThrow(worktreePath, ['clean', '-fd'], 'WORKTREE_FAILED')
  } catch (err) {
    if (err instanceof AnalysisWorktreeError) throw err
    throw new AnalysisWorktreeError('failed to refresh analysis worktree', 'WORKTREE_FAILED', { cause: err })
  }
}

function addWorktree(sourceRepoPath: string, worktreePath: string, commit: string): void {
  try {
    runGitOrThrow(sourceRepoPath, ['worktree', 'add', '--detach', worktreePath, commit], 'WORKTREE_FAILED')
  } catch (err) {
    rmSync(worktreePath, { recursive: true, force: true })
    if (err instanceof AnalysisWorktreeError) throw err
    throw new AnalysisWorktreeError('failed to create analysis worktree', 'WORKTREE_FAILED', { cause: err })
  }
}

function validateRepositoryId(repositoryId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(repositoryId)) {
    throw new AnalysisWorktreeError('invalid repository id for worktree path', 'INVALID_REPOSITORY_ID')
  }
}

function validateBranchName(repoPath: string, branch: string): void {
  if (!branch || branch.startsWith('-') || branch.includes('\0')) {
    throw new AnalysisWorktreeError('invalid analysis branch', 'INVALID_BRANCH')
  }
  try {
    execFileSync('git', ['check-ref-format', '--branch', branch], gitOptions(repoPath))
  } catch (err) {
    throw new AnalysisWorktreeError('invalid analysis branch', 'INVALID_BRANCH', { cause: err })
  }
}

function branchSlug(branch: string): string {
  const safe = branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'branch'
  const hash = createHash('sha1').update(branch).digest('hex').slice(0, 8)
  return `${safe}-${hash}`
}

function sourceRepoSlug(sourceRepoPath: string): string {
  const name = sourceRepoPath.split('/').filter(Boolean).pop() ?? 'repo'
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo'
  const hash = createHash('sha1').update(resolve(sourceRepoPath)).digest('hex').slice(0, 8)
  return `${safe}-${hash}`
}

function runGit(repoPath: string, args: string[]): string | null {
  try {
    const result = execFileSync('git', args, gitOptions(repoPath))
    return result.trim() || null
  } catch {
    return null
  }
}

function runGitDetailed(repoPath: string, args: string[]): { ok: true; stdout: string } | { ok: false; stderr: string; error: unknown } {
  try {
    const stdout = execFileSync('git', args, gitOptions(repoPath))
    return { ok: true, stdout: stdout.trim() }
  } catch (error) {
    return {
      ok: false,
      stderr: error instanceof Error && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '')
        : '',
      error,
    }
  }
}

function runGitOrThrow(
  repoPath: string,
  args: string[],
  code: AnalysisWorktreeError['code'],
): string {
  try {
    const result = execFileSync('git', args, gitOptions(repoPath))
    const trimmed = result.trim()
    return trimmed
  } catch (err) {
    throw new AnalysisWorktreeError(`git command failed: git ${args.join(' ')}`, code, { cause: err })
  }
}

function gitOptions(repoPath: string) {
  const stdio: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe']
  return {
    cwd: repoPath,
    encoding: 'utf-8' as const,
    timeout: 10_000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
    stdio,
  }
}

function isCommit(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{40}$/.test(value))
}

function isMissingRemoteBranchError(stderr: string): boolean {
  return stderr.includes("couldn't find remote ref") || stderr.includes('could not find remote ref')
}
