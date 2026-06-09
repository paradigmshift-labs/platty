import { isAbsolute, join, normalize, resolve, sep } from 'node:path'

export interface RepositoryLike {
  repoPath: string
  analysisWorktreePath?: string | null
  sourceRoot?: string | null
}

export interface RepositoryPaths {
  gitRoot: string
  worktreeRoot: string
  sourceRoot: string | null
  analysisRoot: string
  displayRoot: string
}

export function normalizeSourceRoot(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null

  const trimmed = input.trim()
  if (trimmed === '' || trimmed === '.') return null

  const raw = trimmed.replace(/\\/g, '/')
  if (isAbsolute(raw)) {
    throw new Error('sourceRoot must be relative')
  }
  if (raw === '..' || raw.startsWith('../')) {
    throw new Error('sourceRoot must not escape repository root')
  }
  if (raw.split('/').includes('..')) {
    throw new Error('sourceRoot must not contain parent traversal')
  }

  const normalized = normalize(raw).replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized === '' || normalized === '.') return null
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('sourceRoot must not escape repository root')
  }

  return normalized
}

export function getRepositoryPaths(repo: RepositoryLike): RepositoryPaths {
  const gitRoot = resolve(repo.repoPath)
  const worktreeRoot = resolve(repo.analysisWorktreePath ?? repo.repoPath)
  const sourceRoot = normalizeSourceRoot(repo.sourceRoot)
  const analysisRoot = sourceRoot ? join(worktreeRoot, sourceRoot) : worktreeRoot
  const displayRoot = sourceRoot ? join(gitRoot, sourceRoot) : gitRoot

  return {
    gitRoot,
    worktreeRoot,
    sourceRoot,
    analysisRoot,
    displayRoot: displayRoot.split(sep).join('/').replace(/^([A-Za-z]:)\//, '$1/'),
  }
}
