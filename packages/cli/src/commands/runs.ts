import {
  cancelRun,
  getRun,
  listRuns,
  resolveProjectSelector,
  type DB,
  type OpenPlattyDbResult,
} from '@platty/core'
import { readProjectConfig } from '../config-store.js'
import { openCliDb } from '../db.js'
import { failure, success, type PlattyCommandResponse } from '../output.js'
import { requirePlattyRoot } from '../project-root.js'

export interface RunsCommandOptions {
  cwd: string
  db?: DB
  openDb?: () => OpenPlattyDbResult
  project?: string
}

function optionValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  const value = index === -1 ? undefined : argv[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function positional(argv: string[]): string[] {
  const values: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index]
    if (part === '--json') continue
    if (part.startsWith('--')) {
      index += 1
      continue
    }
    values.push(part)
  }
  return values
}

async function requireProjectRoot(cwd: string): Promise<{ config: Awaited<ReturnType<typeof readProjectConfig>> } | PlattyCommandResponse> {
  const projectRoot = await requirePlattyRoot(cwd)
  if (!projectRoot) {
    return {
      exitCode: 2,
      result: failure('PROJECT_ROOT_NOT_FOUND', 'Platty project root was not found'),
      stdout: '',
      stderr: '',
    }
  }
  return { config: await readProjectConfig(projectRoot) }
}

function requiredRunId(argv: string[]): string | PlattyCommandResponse {
  const runId = optionValue(argv, '--run-id')
  if (runId) return runId
  return {
    exitCode: 2,
    result: failure('RUN_ID_REQUIRED', 'runs command requires --run-id'),
    stdout: '',
    stderr: '',
  }
}

function resolveSelectedProject(
  db: DB,
  selector: string | undefined,
  currentProject: Awaited<ReturnType<typeof readProjectConfig>>['currentProject'],
): { project: { id: string } } | PlattyCommandResponse {
  if (!selector) {
    return {
      exitCode: 2,
      result: failure('PROJECT_NOT_SELECTED', 'No Platty project is selected'),
      stdout: '',
      stderr: '',
    }
  }

  const resolved = resolveProjectSelector(db, selector, currentProject)
  if (resolved.kind === 'missing') {
    return {
      exitCode: 2,
      result: failure('PROJECT_NOT_FOUND', 'Platty project was not found'),
      stdout: '',
      stderr: '',
    }
  }
  if (resolved.kind === 'ambiguous') {
    return {
      exitCode: 2,
      result: failure('PROJECT_AMBIGUOUS', `Project selector matched multiple projects: ${selector}`),
      stdout: '',
      stderr: '',
    }
  }
  return { project: resolved.project }
}

function runNotFound(): PlattyCommandResponse {
  return {
    exitCode: 2,
    result: failure('RUN_NOT_FOUND', 'Pipeline run was not found'),
    stdout: '',
    stderr: '',
  }
}

export async function runRunsCommand(argv: string[], options: RunsCommandOptions): Promise<PlattyCommandResponse> {
  const root = await requireProjectRoot(options.cwd)
  if ('exitCode' in root) return root

  const opened = options.db ? null : (options.openDb?.() ?? openCliDb())
  const db = options.db ?? opened!.db

  try {
    const [command] = positional(argv)
    const selected = resolveSelectedProject(db, options.project?.trim() || root.config.currentProject?.id, root.config.currentProject)
    if ('exitCode' in selected) return selected

    if (command === 'list') {
      const result = success({
        projectId: selected.project.id,
        runs: listRuns(db, { projectId: selected.project.id }),
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (command === 'show') {
      const runId = requiredRunId(argv)
      if (typeof runId !== 'string') return runId

      const run = getRun(db, runId)
      if (!run || run.projectId !== selected.project.id) return runNotFound()

      const result = success(run)
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (command === 'cancel') {
      const runId = requiredRunId(argv)
      if (typeof runId !== 'string') return runId

      const run = getRun(db, runId)
      if (!run || run.projectId !== selected.project.id) return runNotFound()

      const cancelled = cancelRun(db, {
        runId,
        reason: optionValue(argv, '--reason') ?? 'Cancelled by user',
      })
      if (cancelled.kind === 'missing') return runNotFound()
      if (cancelled.kind === 'not_cancellable') {
        return {
          exitCode: 2,
          result: failure('RUN_NOT_CANCELLABLE', 'Only queued, running, or waiting_for_user runs can be cancelled'),
          stdout: '',
          stderr: '',
        }
      }

      const result = success(cancelled.run)
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    return {
      exitCode: 2,
      result: failure('UNKNOWN_COMMAND', `Unknown runs command: ${command ?? ''}`),
      stdout: '',
      stderr: '',
    }
  } finally {
    opened?.close()
  }
}
