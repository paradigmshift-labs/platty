import {
  createProject,
  listProjects,
  projectPointer,
  resolveProjectSelector,
  type DB,
  type OpenPlattyDbResult,
} from '@platty/core'
import { configPath, readProjectConfig, writeProjectConfig } from '../config-store.js'
import { openCliDb } from '../db.js'
import { failure, success, type PlattyCommandResponse } from '../output.js'
import { requirePlattyRoot } from '../project-root.js'

export interface ProjectCommandOptions {
  cwd: string
  db?: DB
  openDb?: () => OpenPlattyDbResult
  project?: string
}

function value(argv: string[], flag: string) {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  return argv[index + 1]
}

function positional(argv: string[]) {
  const values: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index]
    if (part === '--json') continue
    if (part === '--description' || part === '--project') {
      index += 1
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

function missingProject(): PlattyCommandResponse {
  const result = failure('PROJECT_NOT_FOUND', 'Platty project was not found', {
    nextAction: {
      type: 'list_projects',
      command: ['platty', 'project', 'list'],
      message: 'List available Platty projects.',
    },
  })
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function ambiguousProject(selector: string): PlattyCommandResponse {
  const result = failure('PROJECT_AMBIGUOUS', `Project selector matched multiple projects: ${selector}`, {
    nextAction: {
      type: 'list_projects',
      command: ['platty', 'project', 'list'],
      message: 'Use a project id to disambiguate.',
    },
  })
  return { exitCode: 2, result, stdout: '', stderr: '' }
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

const PROJECT_HELP = `\
Usage: platty project <command> [options]

Create and manage Platty projects.

Commands:
  create <name>                     Create a new project
  list                              List all projects
  use <selector>                    Select the current project
  status                            Show current project status

Options for create:
  --description <text>              Project description

Options:
  --json                            Machine-readable JSON output
  -h, --help                        Display help for command
`

export async function runProjectCommand(argv: string[], options: ProjectCommandOptions): Promise<PlattyCommandResponse> {
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    return { exitCode: 0, result: success(), stdout: PROJECT_HELP, stderr: '', skipDefaultRender: true }
  }

  const root = await requireProjectRoot(options.cwd)
  if ('exitCode' in root) return root

  const opened = options.db ? null : (options.openDb?.() ?? openCliDb())
  const db = options.db ?? opened!.db

  try {
    const [subcommand, ...rest] = positional(argv)

    if (subcommand === 'create') {
      const name = rest.join(' ').trim()
      if (!name) {
        const result = failure('INVALID_PROJECT_NAME', 'project create requires a project name')
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const project = createProject(db, {
        name,
        description: value(argv, '--description'),
      })

      const result = success(project, {
        nextAction: {
          type: 'select_project',
          command: ['platty', 'project', 'use', project.id],
          message: 'Select this project before adding repositories.',
        },
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'list') {
      const result = success({
        currentProject: root.config.currentProject ?? null,
        projects: listProjects(db),
      }, {
        evidenceRefs: [{ label: 'platty-config', path: configPath(root.projectRoot) }],
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'use') {
      const selector = rest.join(' ').trim()
      if (!selector) return projectNotSelected()

      const resolvedProject = resolveProjectSelector(db, selector, root.config.currentProject)
      if (resolvedProject.kind === 'missing') return missingProject()
      if (resolvedProject.kind === 'ambiguous') return ambiguousProject(selector)

      const currentProject = projectPointer(resolvedProject.project)
      await writeProjectConfig(root.projectRoot, {
        ...root.config,
        currentProject,
      })

      const result = success({ currentProject }, {
        nextAction: {
          type: 'list_repositories',
          command: ['platty', 'repo', 'list', '--project', resolvedProject.project.id],
          message: 'Inspect repositories registered inside this project before adding another one.',
        },
        evidenceRefs: [{ label: 'platty-config', path: configPath(root.projectRoot) }],
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'status') {
      const result = success({
        currentProject: root.config.currentProject ?? null,
        projectCount: listProjects(db).length,
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    const result = failure('UNKNOWN_COMMAND', `Unknown project command: ${subcommand ?? ''}`)
    return { exitCode: 2, result, stdout: '', stderr: '' }
  } finally {
    opened?.close()
  }
}
