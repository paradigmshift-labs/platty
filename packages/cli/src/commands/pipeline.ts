import {
  listRepositories,
  nextStaticPipelineStage,
  projectPointer,
  resolveProjectSelector,
  runStaticPipelineForProject,
  type DB,
  type OpenPlattyDbResult,
  type StaticPipelineNextAction,
} from '@platty/core'
import type { StaticPipelineRunner } from '../main.js'
import { readProjectConfig } from '../config-store.js'
import { openCliDb } from '../db.js'
import { failure, success, type PlattyCommandResponse } from '../output.js'
import { requirePlattyRoot } from '../project-root.js'

export type PipelineShortcutCommand = 'status' | 'run'

export interface PipelineShortcutCommandOptions {
  cwd: string
  db?: DB
  openDb?: () => OpenPlattyDbResult
  project?: string
  staticPipelineRunner?: StaticPipelineRunner
}

function hasFlag(argv: string[], flag: string) {
  return argv.includes(flag)
}

async function requireProjectRoot(cwd: string): Promise<{ projectRoot: string; config: Awaited<ReturnType<typeof readProjectConfig>> } | PlattyCommandResponse> {
  const projectRoot = await requirePlattyRoot(cwd)
  if (!projectRoot) {
    const result = failure('PROJECT_ROOT_NOT_FOUND', 'Platty project root was not found', {
      nextAction: {
        type: 'init_required',
        command: ['platty', 'init'],
      },
    })
    return { exitCode: 2, result, stdout: '', stderr: '' }
  }
  return { projectRoot, config: await readProjectConfig(projectRoot) }
}

function projectNotSelected(): PlattyCommandResponse {
  const result = failure('PROJECT_NOT_SELECTED', 'No Platty project is selected', {
    nextAction: {
      type: 'select_project',
      command: ['platty', 'project', 'list'],
    },
  })
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function missingProject(): PlattyCommandResponse {
  const result = failure('PROJECT_NOT_FOUND', 'Platty project was not found', {
    nextAction: {
      type: 'list_projects',
      command: ['platty', 'project', 'list'],
    },
  })
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function nextActionForStatus(
  db: DB,
  projectId: string,
  repositories: ReturnType<typeof listRepositories>,
): StaticPipelineNextAction | { type: 'add_repository'; command: string[] } {
  if (repositories.length === 0) return { type: 'add_repository', command: ['platty', 'repo', 'add', '.'] }

  for (const repository of repositories) {
    const next = nextStaticPipelineStage({
      db,
      repoId: repository.id,
      expectedCommit: repository.lastSyncedCommit,
    })
    if (typeof next === 'string') {
      return {
        type: 'run_static_analysis',
        repoId: repository.id,
        stage: next,
        command: ['platty', 'run', '--project', projectId],
      }
    }
    if (next.type !== 'completed') return next
  }

  return { type: 'build_docs', command: ['platty', 'docs', 'start', '--project', projectId] }
}

export async function runPipelineShortcutCommand(
  command: PipelineShortcutCommand,
  argv: string[],
  options: PipelineShortcutCommandOptions,
): Promise<PlattyCommandResponse> {
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

    const project = resolvedProject.project
    const repositories = listRepositories(db, project.id)

    if (command === 'status') {
      const result = success({
        project: projectPointer(project),
        repositories,
        nextAction: nextActionForStatus(db, project.id, repositories),
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    const runner = options.staticPipelineRunner ?? runStaticPipelineForProject
    const data = await runner({
      db,
      projectId: project.id,
      stepOnly: hasFlag(argv, '--step-only'),
    })
    const result = success(data)
    return { exitCode: 0, result, stdout: '', stderr: '' }
  } finally {
    opened?.close()
  }
}
