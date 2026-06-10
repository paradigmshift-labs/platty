import { resolve } from 'node:path'
import {
  buildBusinessMapArtifact,
  buildServiceMapArtifactFromDb,
  projectPointer,
  resolveProjectSelector,
  writeServiceMapArtifacts,
  type DB,
  type OpenPlattyDbResult,
} from '@platty/core'
import { plattyDir, readProjectConfig } from '../config-store.js'
import { openCliDb } from '../db.js'
import { failure, success, type PlattyCommandResponse } from '../output.js'
import { requirePlattyRoot } from '../project-root.js'

export interface ServiceMapCommandOptions {
  cwd: string
  db?: DB
  openDb?: () => OpenPlattyDbResult
  project?: string
  now?: () => Date
}

function value(argv: string[], flag: string) {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  return argv[index + 1]
}

function optionValue(argv: string[], flag: string) {
  const option = value(argv, flag)?.trim()
  if (!option || option.startsWith('--')) return undefined
  return option
}

function positional(argv: string[]) {
  const values: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index]
    if (part === '--json') continue
    if (part === '--project' || part === '--out') {
      index += 1
      continue
    }
    values.push(part)
  }
  return values
}

export async function runServiceMapCommand(argv: string[], options: ServiceMapCommandOptions): Promise<PlattyCommandResponse> {
  const projectRoot = await requirePlattyRoot(options.cwd)
  if (!projectRoot) {
    const result = failure('PROJECT_ROOT_NOT_FOUND', 'Platty project root was not found', {
      nextAction: {
        type: 'init_required',
        command: ['platty', 'init'],
      },
    })
    return { exitCode: 2, result, stdout: '', stderr: '' }
  }

  const config = await readProjectConfig(projectRoot)
  const opened = options.db ? null : (options.openDb?.() ?? openCliDb())
  const db = options.db ?? opened!.db

  try {
    const [subcommand] = positional(argv)
    if (subcommand !== 'export') {
      const result = failure('UNKNOWN_COMMAND', `Unknown service-map command: ${subcommand ?? ''}`)
      return { exitCode: 2, result, stdout: '', stderr: '' }
    }

    const selector = optionValue(argv, '--project') ?? options.project?.trim() ?? config.currentProject?.id
    if (!selector) {
      const result = failure('PROJECT_NOT_SELECTED', 'No Platty project is selected', {
        nextAction: {
          type: 'select_project',
          command: ['platty', 'project', 'list'],
        },
      })
      return { exitCode: 2, result, stdout: '', stderr: '' }
    }

    const resolvedProject = resolveProjectSelector(db, selector, config.currentProject)
    if (resolvedProject.kind === 'missing') {
      const result = failure('PROJECT_NOT_FOUND', 'Platty project was not found')
      return { exitCode: 2, result, stdout: '', stderr: '' }
    }
    if (resolvedProject.kind === 'ambiguous') {
      const result = failure('PROJECT_AMBIGUOUS', `Project selector matched multiple projects: ${selector}`)
      return { exitCode: 2, result, stdout: '', stderr: '' }
    }

    const project = resolvedProject.project
    const pointer = projectPointer(project)
    const generatedAt = (options.now?.() ?? new Date()).toISOString()
    const outDir = resolve(options.cwd, optionValue(argv, '--out') ?? defaultServiceMapOutDir(projectRoot, pointer.slug))

    const serviceMap = buildServiceMapArtifactFromDb({
      db,
      projectId: project.id,
      generatedAt,
    })
    const businessMap = buildBusinessMapArtifact({
      db,
      projectId: project.id,
      generatedAt,
    })
    const written = writeServiceMapArtifacts({ artifact: serviceMap, businessMap, outDir })

    const result = success({
      project: pointer,
      artifact: {
        summary: serviceMap.summary,
        businessSummary: businessMap.summary,
      },
      written,
    }, {
      evidenceRefs: [
        { label: 'service-map-json', path: written.jsonPath },
        { label: 'service-map-html', path: written.htmlPath },
        { label: 'service-map-report', path: written.reportPath },
      ],
    })
    return { exitCode: 0, result, stdout: '', stderr: '' }
  } finally {
    opened?.close()
  }
}

function defaultServiceMapOutDir(projectRoot: string, projectSlug: string) {
  return resolve(plattyDir(projectRoot), 'artifacts', 'projects', projectSlug, 'service-map')
}
