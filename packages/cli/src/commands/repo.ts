import {
  addRepository,
  listRepositories,
  projectPointer,
  removeRepository,
  resolveProjectSelector,
  updateRepository,
  type DB,
  type OpenPlattyDbResult,
} from '@platty/core'
import { readProjectConfig } from '../config-store.js'
import { openCliDb } from '../db.js'
import { failure, success, type PlattyCommandResponse } from '../output.js'
import { requirePlattyRoot } from '../project-root.js'

export interface RepoCommandOptions {
  cwd: string
  db?: DB
  openDb?: () => OpenPlattyDbResult
  project?: string
}

const optionFlags = new Set(['--branch', '--name', '--path', '--project', '--source-root'])

function value(argv: string[], flag: string) {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  return argv[index + 1]
}

function optionValue(argv: string[], flag: string) {
  const option = value(argv, flag)
  if (option === undefined || option.startsWith('--')) return undefined
  return option
}

function positional(argv: string[]) {
  const values: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index]
    if (part === '--json') continue
    if (optionFlags.has(part)) {
      if (argv[index + 1] && !argv[index + 1].startsWith('--')) index += 1
      continue
    }
    values.push(part)
  }
  return values
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
      message: 'Create or select a Platty project, then register repositories inside that project.',
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

function missingRepo(): PlattyCommandResponse {
  const result = failure('REPO_NOT_FOUND', 'Platty repository was not found', {
    nextAction: {
      type: 'list_repositories',
      command: ['platty', 'repo', 'list'],
    },
  })
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function repoNotSelected(): PlattyCommandResponse {
  const result = failure('REPO_NOT_SELECTED', 'No Platty repository is selected', {
    nextAction: {
      type: 'list_repositories',
      command: ['platty', 'repo', 'list'],
    },
  })
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function ambiguousRepo(selector: string, projectId: string): PlattyCommandResponse {
  const result = failure('REPO_AMBIGUOUS', `Repository selector matched multiple repositories: ${selector}`, {
    nextAction: {
      type: 'list_repositories',
      command: ['platty', 'repo', 'list', '--project', projectId],
      message: 'Use a repository id or full path to disambiguate.',
    },
  })
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function requireSelectedProject(
  db: DB,
  options: RepoCommandOptions,
  config: Awaited<ReturnType<typeof readProjectConfig>>,
) {
  const selector = options.project?.trim() || config.currentProject?.id
  if (!selector) return projectNotSelected()

  const resolvedProject = resolveProjectSelector(db, selector, config.currentProject)
  if (resolvedProject.kind === 'missing') return missingProject()
  if (resolvedProject.kind === 'ambiguous') {
    const result = failure('PROJECT_AMBIGUOUS', `Project selector matched multiple projects: ${selector}`)
    return { exitCode: 2, result, stdout: '', stderr: '' }
  }
  return { project: resolvedProject.project }
}

function repoSelectionResponse(result: ReturnType<typeof updateRepository> | ReturnType<typeof removeRepository>, projectId: string, selector: string): PlattyCommandResponse | null {
  if (result.kind === 'found') return null
  if (result.kind === 'ambiguous') return ambiguousRepo(selector, projectId)
  return missingRepo()
}

const REPO_HELP = `\
Usage: platty repo <command> [options]

Register and manage local Git repositories.

Commands:
  add <path>                        Add a repository to the current project
  list                              List repositories in the current project
  update <selector>                 Update repository settings
  remove <selector>                 Remove a repository from the current project

Options for add / update:
  --name <name>                     Repository display name
  --branch <branch>                 Analysis branch (default: current branch)
  --path <path>                     New repository path (update only)
  --source-root <path>              Source root path within the repository

Options:
  --json                            Machine-readable JSON output
  --project <selector>              Target project (id, name, or current)
  -h, --help                        Display help for command
`

export async function runRepoCommand(argv: string[], options: RepoCommandOptions): Promise<PlattyCommandResponse> {
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    return { exitCode: 0, result: success(), stdout: REPO_HELP, stderr: '', skipDefaultRender: true }
  }

  const root = await requireProjectRoot(options.cwd)
  if ('exitCode' in root) return root

  const opened = options.db ? null : (options.openDb?.() ?? openCliDb())
  const db = options.db ?? opened!.db

  try {
    const [subcommand, ...rest] = positional(argv)
    const selected = requireSelectedProject(db, options, root.config)
    if ('exitCode' in selected) return selected
    const project = selected.project

    if (subcommand === 'add') {
      const requestedPath = rest[0]
      if (!requestedPath) {
        const result = failure('REPO_PATH_REQUIRED', 'repo add requires a repository path')
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const repository = addRepository(db, {
        projectId: project.id,
        path: requestedPath,
        cwd: options.cwd,
        name: optionValue(argv, '--name'),
        sourceRoot: argv.includes('--source-root') ? optionValue(argv, '--source-root') ?? null : undefined,
        analysisBranch: optionValue(argv, '--branch'),
      })

      const result = success(repository, {
        nextAction: {
          type: 'run_analysis',
          command: ['platty', 'run', '--project', project.id],
        },
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'list') {
      const result = success({
        project: projectPointer(project),
        repositories: listRepositories(db, project.id),
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'update') {
      const selector = rest.join(' ').trim()
      if (!selector) return repoNotSelected()

      if (!argv.includes('--name') && !argv.includes('--path') && !argv.includes('--source-root') && !argv.includes('--branch')) {
        const result = failure('REPO_UPDATE_NO_CHANGES', 'repo update requires --name, --path, --source-root, or --branch')
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const name = argv.includes('--name') ? optionValue(argv, '--name')?.trim() : undefined
      if (argv.includes('--name') && !name) {
        const result = failure('INVALID_REPO_NAME', 'repo update requires a non-empty --name')
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const updated = updateRepository(db, {
        projectId: project.id,
        selector,
        cwd: options.cwd,
        name,
        path: optionValue(argv, '--path'),
        sourceRoot: argv.includes('--source-root') ? optionValue(argv, '--source-root') ?? null : undefined,
        analysisBranch: argv.includes('--branch') ? optionValue(argv, '--branch') ?? null : undefined,
      })
      const selectionError = repoSelectionResponse(updated, project.id, selector)
      if (selectionError) return selectionError
      if (updated.kind !== 'found') return missingRepo()

      const result = success(updated.repository)
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'remove') {
      const selector = rest.join(' ').trim()
      if (!selector) return repoNotSelected()

      const removed = removeRepository(db, project.id, selector, options.cwd)
      const selectionError = repoSelectionResponse(removed, project.id, selector)
      if (selectionError) return selectionError
      if (removed.kind !== 'found') return missingRepo()

      const result = success(removed.repository, {
        nextAction: {
          type: 'list_repositories',
          command: ['platty', 'repo', 'list', '--project', project.id],
        },
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    const result = failure('UNKNOWN_COMMAND', `Unknown repo command: ${subcommand ?? ''}`)
    return { exitCode: 2, result, stdout: '', stderr: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const result = failure('REPO_COMMAND_FAILED', message)
    return { exitCode: 2, result, stdout: '', stderr: '' }
  } finally {
    opened?.close()
  }
}
