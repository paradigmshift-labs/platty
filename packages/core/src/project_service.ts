import { desc, eq, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DB } from './db/client.js'
import { projects } from './db/schema/core.js'

export interface CurrentProjectPointer {
  id: string
  name: string
  slug: string
}

export type ProjectSelectorResult =
  | { kind: 'found'; project: typeof projects.$inferSelect }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; selector: string; matches: CurrentProjectPointer[] }

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'project'
}

export function projectPointer(project: typeof projects.$inferSelect): CurrentProjectPointer {
  return {
    id: project.id,
    name: project.name,
    slug: slugify(project.name),
  }
}

export function createProject(db: DB, input: { name: string; description?: string | null }) {
  const now = new Date().toISOString()
  const id = nanoid()
  const name = input.name.trim()
  const description = input.description?.trim() || null

  db.insert(projects).values({
    id,
    name,
    description,
    createdAt: now,
    updatedAt: now,
  }).run()

  const project = db.select().from(projects).where(eq(projects.id, id)).get()
  if (!project) throw new Error(`Project create failed: ${id}`)
  return project
}

export function listProjects(db: DB) {
  return db
    .select()
    .from(projects)
    .where(isNull(projects.deletedAt))
    .orderBy(desc(projects.updatedAt))
    .all()
}

export function resolveProjectSelector(
  db: DB,
  selector: string,
  currentProject?: CurrentProjectPointer | null,
): ProjectSelectorResult {
  const trimmed = selector.trim()
  if (!trimmed) return { kind: 'missing' }

  const resolved = trimmed === 'current' || trimmed === '@current'
    ? currentProject?.id
    : trimmed
  if (!resolved) return { kind: 'missing' }

  const matches = listProjects(db)
    .filter((project) =>
      project.id === resolved ||
      project.name === resolved ||
      slugify(project.name) === resolved)

  const uniqueMatches = Array.from(new Map(matches.map((project) => [project.id, project])).values())
  if (uniqueMatches.length === 0) return { kind: 'missing' }
  if (uniqueMatches.length > 1) {
    return {
      kind: 'ambiguous',
      selector: trimmed,
      matches: uniqueMatches.map(projectPointer),
    }
  }
  return { kind: 'found', project: uniqueMatches[0] }
}
