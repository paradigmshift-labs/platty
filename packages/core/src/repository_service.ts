import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DB } from './db/client.js'
import { projects, repositories } from './db/schema/core.js'
import { normalizeSourceRoot } from './repo/repository-paths.js'

export interface AddRepositoryInput {
  projectId: string
  path: string
  cwd?: string
  name?: string
  sourceRoot?: string | null
  analysisBranch?: string | null
}

export function addRepository(db: DB, input: AddRepositoryInput) {
  const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get()
  if (!project) throw new Error(`Project not found: ${input.projectId}`)

  const repoPath = resolveGitRoot(input.cwd ?? process.cwd(), input.path)
  const now = new Date().toISOString()
  const id = nanoid()
  const sourceRoot = normalizeSourceRoot(input.sourceRoot)
  const analysisBranch = input.analysisBranch ?? detectAnalysisBranch(repoPath)

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
