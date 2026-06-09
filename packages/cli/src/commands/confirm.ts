import { and, eq, isNull } from 'drizzle-orm'
import {
  listRepositories,
  projectPointer,
  resolveProjectSelector,
  schema,
  type DB,
  type OpenPlattyDbResult,
} from '@platty/core'
import { readProjectConfig } from '../config-store.js'
import { openCliDb } from '../db.js'
import { failure, success, type PlattyCommandResponse } from '../output.js'
import { requirePlattyRoot } from '../project-root.js'

export interface ConfirmCommandOptions {
  cwd: string
  db?: DB
  openDb?: () => OpenPlattyDbResult
  project?: string
}

async function requireProjectRoot(cwd: string): Promise<{ config: Awaited<ReturnType<typeof readProjectConfig>> } | PlattyCommandResponse> {
  const projectRoot = await requirePlattyRoot(cwd)
  if (!projectRoot) {
    const result = failure('PROJECT_ROOT_NOT_FOUND', 'Platty project root was not found', {
      nextAction: { type: 'init_required', command: ['platty', 'init'] },
    })
    return { exitCode: 2, result, stdout: '', stderr: '' }
  }
  return { config: await readProjectConfig(projectRoot) }
}

function projectNotSelected(): PlattyCommandResponse {
  const result = failure('PROJECT_NOT_SELECTED', 'No Platty project is selected', {
    nextAction: { type: 'select_project', command: ['platty', 'project', 'list'] },
  })
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function missingProject(): PlattyCommandResponse {
  const result = failure('PROJECT_NOT_FOUND', 'Platty project was not found', {
    nextAction: { type: 'list_projects', command: ['platty', 'project', 'list'] },
  })
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

export async function runConfirmCommand(_argv: string[], options: ConfirmCommandOptions): Promise<PlattyCommandResponse> {
  const root = await requireProjectRoot(options.cwd)
  if ('exitCode' in root) return root

  const opened = options.db ? null : (options.openDb?.() ?? openCliDb())
  const db = options.db ?? opened!.db

  try {
    const selector = options.project?.trim() || root.config.currentProject?.id
    if (!selector) return projectNotSelected()

    const resolvedProject = resolveProjectSelector(db, selector, root.config.currentProject)
    if (resolvedProject.kind === 'missing') return missingProject()
    if (resolvedProject.kind === 'ambiguous') {
      const result = failure('PROJECT_AMBIGUOUS', `Project selector matched multiple projects: ${selector}`)
      return { exitCode: 2, result, stdout: '', stderr: '' }
    }

    const now = new Date().toISOString()
    const repositories = listRepositories(db, resolvedProject.project.id)
    const confirmedRepoIds: string[] = []

    for (const repository of repositories) {
      const pending = db.select().from(schema.repositoryPhaseStatus)
        .where(and(
          eq(schema.repositoryPhaseStatus.repositoryId, repository.id),
          eq(schema.repositoryPhaseStatus.phase, 'analyze_repo'),
          eq(schema.repositoryPhaseStatus.status, 'passed'),
          isNull(schema.repositoryPhaseStatus.confirmedAt),
        ))
        .get()
      if (!pending) continue

      db.update(schema.repositoryPhaseStatus)
        .set({ confirmedAt: now, updatedAt: now })
        .where(and(
          eq(schema.repositoryPhaseStatus.repositoryId, repository.id),
          eq(schema.repositoryPhaseStatus.phase, 'analyze_repo'),
        ))
        .run()
      confirmedRepoIds.push(repository.id)
    }

    const result = success({
      project: projectPointer(resolvedProject.project),
      confirmedCount: confirmedRepoIds.length,
      confirmedRepoIds,
    }, {
      nextAction: {
        type: 'run_static_analysis',
        command: ['platty', 'run', '--step-only', '--project', resolvedProject.project.id],
      },
    })
    return { exitCode: 0, result, stdout: '', stderr: '' }
  } finally {
    opened?.close()
  }
}
