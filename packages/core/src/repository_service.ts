import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DB } from './db/client.js'
import { projectPhaseStatus, projects, repositories, repositoryPhaseStatus } from './db/schema/core.js'
import { normalizeSourceRoot } from './repo/repository-paths.js'

export interface AddRepositoryInput {
  projectId: string
  path: string
  cwd?: string
  name?: string
  sourceRoot?: string | null
  analysisBranch?: string | null
}

export interface UpdateRepositoryInput {
  projectId: string
  selector: string
  cwd?: string
  name?: string
  path?: string
  sourceRoot?: string | null
  analysisBranch?: string | null
}

export type RepositorySelectorResult =
  | { kind: 'found'; repository: typeof repositories.$inferSelect }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; selector: string; matches: Array<typeof repositories.$inferSelect> }

const PROJECT_REPOSITORY_INVENTORY_PHASES = [
  'build_service_map',
  'build_docs',
  'build_epics',
  'build_business_docs',
] as const

export function addRepository(db: DB, input: AddRepositoryInput) {
  const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get()
  if (!project) throw new Error(`Project not found: ${input.projectId}`)

  const repoPath = resolveGitRoot(input.cwd ?? process.cwd(), input.path)
  const now = new Date().toISOString()
  const sourceRoot = normalizeSourceRoot(input.sourceRoot)
  const analysisBranch = input.analysisBranch ?? detectAnalysisBranch(repoPath)
  const existingReposForPath = db
    .select()
    .from(repositories)
    .where(and(eq(repositories.projectId, input.projectId), eq(repositories.repoPath, repoPath)))
    .all()

  const activeRepoForPath = existingReposForPath.find((repo) => repo.deletedAt === null)
  if (activeRepoForPath) throw new Error(`Repository already registered: ${repoPath}`)

  const deletedRepoForPath = existingReposForPath.find((repo) => repo.deletedAt !== null)
  if (deletedRepoForPath) {
    db.update(repositories)
      .set({
        name: input.name?.trim() || deletedRepoForPath.name || basename(repoPath),
        repoPath,
        sourceRoot,
        analysisBranch,
        deletedAt: null,
        updatedAt: now,
      })
      .where(eq(repositories.id, deletedRepoForPath.id))
      .run()
    invalidateProjectRepositoryInventoryDependents(db, {
      projectId: input.projectId,
      repositoryId: deletedRepoForPath.id,
      reason: 'repository_reactivated',
      invalidatedAt: now,
    })
    const repo = db.select().from(repositories).where(eq(repositories.id, deletedRepoForPath.id)).get()
    if (!repo) throw new Error(`Repository reactivate failed: ${deletedRepoForPath.id}`)
    return repo
  }

  const id = nanoid()

  db.insert(repositories).values({
    id,
    projectId: input.projectId,
    name: input.name?.trim() || basename(repoPath),
    repoPath,
    sourceRoot,
    analysisBranch,
    createdAt: now,
    updatedAt: now,
  }).run()
  invalidateProjectRepositoryInventoryDependents(db, {
    projectId: input.projectId,
    repositoryId: id,
    reason: 'repository_added',
    invalidatedAt: now,
  })

  const repo = db.select().from(repositories).where(eq(repositories.id, id)).get()
  if (!repo) throw new Error(`Repository create failed: ${id}`)
  return repo
}

export function listRepositories(db: DB, projectId: string) {
  return db
    .select()
    .from(repositories)
    .where(and(eq(repositories.projectId, projectId), isNull(repositories.deletedAt)))
    .all()
}

export function resolveRepositorySelector(
  db: DB,
  projectId: string,
  selector: string,
  cwd = process.cwd(),
): RepositorySelectorResult {
  const trimmed = selector.trim()
  if (!trimmed) return { kind: 'missing' }

  const candidatePath = resolve(cwd, trimmed)
  const resolvedPath = existsSync(candidatePath) ? realpathSync.native(candidatePath) : candidatePath
  const matches = listRepositories(db, projectId)
    .filter((repo) =>
      repo.id === trimmed ||
      repo.name === trimmed ||
      repo.repoPath === resolvedPath ||
      basename(repo.repoPath) === trimmed)

  const uniqueMatches = Array.from(new Map(matches.map((repo) => [repo.id, repo])).values())
  if (uniqueMatches.length === 0) return { kind: 'missing' }
  if (uniqueMatches.length > 1) return { kind: 'ambiguous', selector: trimmed, matches: uniqueMatches }
  return { kind: 'found', repository: uniqueMatches[0] }
}

const STATIC_REPO_PHASES = [
  'analyze_repo',
  'build_graph',
  'build_pattern_profile',
  'build_models',
  'build_route',
  'build_relations',
] as const

export function updateRepository(db: DB, input: UpdateRepositoryInput) {
  const resolved = resolveRepositorySelector(db, input.projectId, input.selector, input.cwd)
  if (resolved.kind !== 'found') return resolved

  const updates: Partial<typeof repositories.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  }

  if (input.name !== undefined) updates.name = input.name.trim()
  if (input.path !== undefined) updates.repoPath = resolveGitRoot(input.cwd ?? process.cwd(), input.path)
  if (input.sourceRoot !== undefined) updates.sourceRoot = normalizeSourceRoot(input.sourceRoot)

  const newBranch = input.analysisBranch !== undefined
    ? (input.analysisBranch?.trim() || null)
    : undefined
  const branchChanging = newBranch !== undefined && newBranch !== resolved.repository.analysisBranch

  if (newBranch !== undefined) updates.analysisBranch = newBranch
  if (branchChanging) {
    updates.lastSyncedCommit = null
    updates.analysisWorktreePath = null
  }

  db.update(repositories).set(updates).where(eq(repositories.id, resolved.repository.id)).run()

  if (branchChanging) {
    db.update(repositoryPhaseStatus)
      .set({ validity: 'stale', updatedAt: new Date().toISOString() })
      .where(and(
        eq(repositoryPhaseStatus.repositoryId, resolved.repository.id),
        inArray(repositoryPhaseStatus.phase, [...STATIC_REPO_PHASES]),
      ))
      .run()
  }

  const repository = db.select().from(repositories).where(eq(repositories.id, resolved.repository.id)).get()
  if (!repository) return { kind: 'missing' } satisfies RepositorySelectorResult
  return { kind: 'found', repository } satisfies RepositorySelectorResult
}

export function removeRepository(db: DB, projectId: string, selector: string, cwd = process.cwd()): RepositorySelectorResult {
  const resolved = resolveRepositorySelector(db, projectId, selector, cwd)
  if (resolved.kind !== 'found') return resolved

  const deletedAt = new Date().toISOString()
  db.update(repositories)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(eq(repositories.id, resolved.repository.id))
    .run()
  invalidateProjectRepositoryInventoryDependents(db, {
    projectId,
    repositoryId: resolved.repository.id,
    reason: 'repository_removed',
    invalidatedAt: deletedAt,
  })

  return {
    kind: 'found',
    repository: {
      ...resolved.repository,
      deletedAt,
      updatedAt: deletedAt,
    },
  }
}

function invalidateProjectRepositoryInventoryDependents(
  db: DB,
  input: {
    projectId: string
    repositoryId: string
    reason: 'repository_added' | 'repository_reactivated' | 'repository_removed'
    invalidatedAt: string
  },
) {
  db.update(projectPhaseStatus)
    .set({
      status: 'pending',
      updatedAt: Date.now(),
      meta: {
        invalidatedBy: input.reason,
        repositoryId: input.repositoryId,
        invalidatedAt: input.invalidatedAt,
      },
    })
    .where(and(
      eq(projectPhaseStatus.projectId, input.projectId),
      inArray(projectPhaseStatus.phase, [...PROJECT_REPOSITORY_INVENTORY_PHASES]),
    ))
    .run()
}

function resolveGitRoot(cwd: string, requestedPath: string): string {
  const absolutePath = resolve(cwd, requestedPath)
  if (!existsSync(absolutePath)) {
    throw new Error(`Repository path does not exist: ${absolutePath}`)
  }

  const realPath = realpathSync.native(absolutePath)
  const gitRoot = gitOutput(realPath, ['rev-parse', '--show-toplevel'])
  if (!gitRoot) {
    throw new Error(`Repository path is not a git repository: ${realPath}`)
  }

  return realpathSync.native(gitRoot)
}

function detectAnalysisBranch(repoPath: string): string | null {
  return gitOutput(repoPath, ['branch', '--show-current'])
    ?? gitOutput(repoPath, ['symbolic-ref', '--short', 'HEAD'])
}

function gitOutput(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null
  } catch {
    return null
  }
}
