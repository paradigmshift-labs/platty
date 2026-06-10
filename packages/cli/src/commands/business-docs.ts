import { resolve } from 'node:path'
import {
  cancelBusinessDocsRun,
  cleanupBusinessDocsRun,
  getBusinessDocsContextBundle,
  getBusinessDocsContextPage,
  getBusinessDocsStatus,
  heartbeatBusinessDocsTask,
  leaseBusinessDocsTasks,
  previewBusinessDocsGeneration,
  previewBusinessDocsSync,
  releaseActiveBusinessDocsLeases,
  materializeBusinessDocumentGraph,
  resolveProjectSelector,
  resumeBusinessDocsRun,
  reviewBusinessDocsRun,
  retryBusinessDocsTask,
  runBusinessDocsWorkerQueue,
  schema,
  showBusinessDoc,
  startBusinessDocsGeneration,
  startBusinessDocsSync,
  submitBusinessDocsTask,
  validateBusinessDocsRun,
  type DB,
  type BusinessDocsRunnerPreset,
  type BusinessDocsRunnerProvider,
  type BusinessDocsTaskInvoker,
  type OpenPlattyDbResult,
} from '@platty/core'
import { readProjectConfig } from '../config-store.js'
import { openCliDb } from '../db.js'
import { failure, success, type PlattyCommandResponse } from '../output.js'
import { requirePlattyRoot } from '../project-root.js'

export interface BusinessDocsCommandOptions {
  cwd: string
  db?: DB
  openDb?: () => OpenPlattyDbResult
  project?: string
  businessDocsTaskInvoker?: BusinessDocsTaskInvoker
}

type ProjectRow = typeof schema.projects.$inferSelect

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag)
}

function optionValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  return argv[index + 1]
}

function nonEmptyOption(argv: string[], flag: string): string | undefined {
  const value = optionValue(argv, flag)?.trim()
  return value ? value : undefined
}

function parseLimit(argv: string[]): number | undefined {
  const value = optionValue(argv, '--limit')
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : 0
}

function numberValue(argv: string[], flag: string, fallback: number): number {
  const value = optionValue(argv, flag)
  return value ? Number(value) : fallback
}

function languageValue(argv: string[]): 'ko' | 'en' {
  return optionValue(argv, '--language') === 'ko' ? 'ko' : 'en'
}

function providerValue(argv: string[]): BusinessDocsRunnerProvider {
  const provider = optionValue(argv, '--provider') ?? 'codex_cli'
  if (provider !== 'codex_cli' && provider !== 'claude_code') throw new Error(`Unsupported --provider: ${provider}`)
  return provider
}

function presetValue(argv: string[]): BusinessDocsRunnerPreset | undefined {
  const preset = optionValue(argv, '--preset')
  if (preset === undefined) return undefined
  if (preset !== 'final-mixed' && preset !== 'balanced') throw new Error(`Unsupported --preset: ${preset}`)
  return preset
}

function parseAttempt(argv: string[]): number | undefined {
  const value = optionValue(argv, '--attempt')
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function parseEpicIds(argv: string[]): string[] | undefined {
  const value = nonEmptyOption(argv, '--epic') ?? nonEmptyOption(argv, '--epic-id')
  if (!value) return undefined
  const ids = value.split(',').map((part) => part.trim()).filter(Boolean)
  return ids.length > 0 ? ids : undefined
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

async function requireProjectRoot(
  cwd: string,
): Promise<{ projectRoot: string; config: Awaited<ReturnType<typeof readProjectConfig>> } | PlattyCommandResponse> {
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

function requireSelectedProject(
  db: DB,
  options: BusinessDocsCommandOptions,
  config: Awaited<ReturnType<typeof readProjectConfig>>,
): { project: ProjectRow } | PlattyCommandResponse {
  const selector = options.project?.trim() || config.currentProject?.id
  if (!selector) return projectNotSelected()

  const resolvedProject = resolveProjectSelector(db, selector, config.currentProject)
  if (resolvedProject.kind === 'missing') return missingProject()
  if (resolvedProject.kind === 'ambiguous') return ambiguousProject(selector)
  return { project: resolvedProject.project }
}

const BUSINESS_DOCS_HELP = `\
Usage: platty business-docs <command> [options]

Run and inspect business-document generation workflows.

Commands:
  preview                           Preview the business-docs generation plan
  start                             Start a business-docs generation run
  run                               Run the business-docs worker queue
  status --run <id>                 Check run status
  resume --run <id>                 Resume a paused run
  cancel --run <id>                 Cancel an active run
  cleanup --run <id>                Clean up a completed run
  validate --run <id>               Validate a run
  review --run <id>                 Review a run
  document show --document <id>     Show a business document
  sync preview                      Preview a business-docs sync plan
  sync start                        Start a business-docs sync run
  graph rebuild                     Rebuild the business document graph
  leases release --run <id>         Release active leases
  tasks lease --run <id>            Lease tasks for a worker
  tasks retry --task <id>           Retry a failed task
  tasks heartbeat --task <id>       Send task heartbeat
  tasks submit --task <id>          Submit task results
  context get --context <handle>    Get task context bundle
  context page --context <handle>   Get a context page

Options:
  --json                            Machine-readable JSON output
  --project <selector>              Target project (id, name, or current)
  -h, --help                        Display help for command
`

export async function runBusinessDocsCommand(
  argv: string[],
  options: BusinessDocsCommandOptions,
): Promise<PlattyCommandResponse> {
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    return { exitCode: 0, result: success(), stdout: BUSINESS_DOCS_HELP, stderr: '', skipDefaultRender: true }
  }

  const root = await requireProjectRoot(options.cwd)
  if ('exitCode' in root) return root

  const openedDb = options.db ? null : (options.openDb?.() ?? openCliDb())
  const db = options.db ?? openedDb!.db

  try {
    const [subcommand] = argv

    if (subcommand === 'preview') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected

      const project = selected.project
      const preview = previewBusinessDocsGeneration(db, {
        projectId: project.id,
        selectedEpicIds: parseEpicIds(argv),
      })
      const result = success(preview, {
        evidenceRefs: [{ label: 'business-docs-preview', path: `project:${project.id}` }],
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'start') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected

      const project = selected.project
      const started = startBusinessDocsGeneration(db, {
        projectId: project.id,
        selectedEpicIds: parseEpicIds(argv),
        newRun: hasFlag(argv, '--new-run'),
        forceRegenerate: hasFlag(argv, '--force-regenerate'),
        outputLanguage: languageValue(argv),
      })
      if (!started.ok) {
        const result = failure(started.code, started.message, {
          data: { preview: started.preview },
          nextAction: {
            type: 'fix_preview_blockers',
            command: ['platty', 'business-docs', 'preview', '--project', project.name, '--json'],
          },
          evidenceRefs: [{ label: 'business-docs-preview', path: `project:${project.id}` }],
        })
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const result = success(started.data, {
        evidenceRefs: [{ label: 'business-docs-start', path: `run:${started.data.run.id}` }],
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'run') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected
      const provider = providerValue(argv)
      if (provider !== 'codex_cli' && !options.businessDocsTaskInvoker) {
        return {
          exitCode: 2,
          result: failure('CLAUDE_CODE_HEADLESS_UNSUPPORTED', 'Claude Code is not available as a headless build_business_docs worker runner. Use codex_cli for business-docs run.'),
          stdout: '',
          stderr: '',
        }
      }
      const workDir = optionValue(argv, '--work-dir') ?? `${root.projectRoot}/.platty/tmp/build_business_docs_runs`
      let data: unknown
      try {
        data = await runBusinessDocsWorkerQueue({
          db,
          projectId: selected.project.id,
          runId: nonEmptyOption(argv, '--run'),
          provider,
          preset: presetValue(argv),
          workers: numberValue(argv, '--workers', 20),
          newRun: hasFlag(argv, '--new-run'),
          forceRegenerate: hasFlag(argv, '--force-regenerate'),
          outputLanguage: languageValue(argv),
          workDir: resolve(options.cwd, workDir),
          taskInvoker: options.businessDocsTaskInvoker,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'business-docs run failed'
        const result = failure('BUSINESS_DOCS_RUN_FAILED', message)
        return { exitCode: 1, result, stdout: '', stderr: '' }
      }
      return {
        exitCode: 0,
        result: success(data, {
          evidenceRefs: [{ label: 'business-docs-run', path: `project:${selected.project.id}` }],
        }),
        stdout: '',
        stderr: '',
      }
    }

    if (subcommand === 'sync') {
      const syncCommand = argv[1]
      if (syncCommand === 'preview' || syncCommand === 'start') {
        const selected = requireSelectedProject(db, options, root.config)
        if ('exitCode' in selected) return selected

        const project = selected.project
        const docSyncPlanId = nonEmptyOption(argv, '--doc-sync-plan-id')
        if (syncCommand === 'preview') {
          const preview = previewBusinessDocsSync(db, {
            projectId: project.id,
            docSyncPlanId,
          })
          const result = success(preview, {
            evidenceRefs: [{ label: 'business-docs-sync-preview', path: `project:${project.id}` }],
          })
          return { exitCode: 0, result, stdout: '', stderr: '' }
        }

        const started = startBusinessDocsSync(db, {
          projectId: project.id,
          docSyncPlanId,
          newRun: hasFlag(argv, '--new-run'),
        })
        if (!started.ok) {
          const result = failure(started.code, started.message, {
            data: { preview: started.preview },
            nextAction: {
              type: 'fix_preview_blockers',
              command: ['platty', 'business-docs', 'sync', 'preview', '--project', project.name, '--json'],
            },
            evidenceRefs: [{ label: 'business-docs-sync-preview', path: `project:${project.id}` }],
          })
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const result = success(started.data, {
          evidenceRefs: [{
            label: 'business-docs-sync-start',
            path: started.data.run.id ? `run:${started.data.run.id}` : `project:${project.id}`,
          }],
        })
        return { exitCode: 0, result, stdout: '', stderr: '' }
      }

      const result = failure(
        'BUSINESS_DOCS_UNKNOWN_COMMAND',
        `Unknown business-docs command: sync ${syncCommand ?? ''}`.trim(),
      )
      return { exitCode: 2, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'graph') {
      const graphCommand = argv[1]
      if (graphCommand === 'rebuild') {
        const selected = requireSelectedProject(db, options, root.config)
        if ('exitCode' in selected) return selected

        const epicIds = parseEpicIds(argv)
        const targets = epicIds && epicIds.length > 0 ? epicIds : [undefined]
        const rebuilt = targets.map((epicId) => ({
          epicId,
          ...materializeBusinessDocumentGraph(db, {
            projectId: selected.project.id,
            epicId,
          }),
        }))
        const data = {
          project: {
            id: selected.project.id,
            name: selected.project.name,
          },
          epicIds: epicIds ?? [],
          deletedLinks: rebuilt.reduce((sum, item) => sum + item.deletedLinks, 0),
          createdLinks: rebuilt.reduce((sum, item) => sum + item.createdLinks, 0),
          deletedModelLinks: rebuilt.reduce((sum, item) => sum + (item.deletedModelLinks ?? 0), 0),
          createdModelLinks: rebuilt.reduce((sum, item) => sum + (item.createdModelLinks ?? 0), 0),
          rebuilds: rebuilt,
        }
        const result = success(data, {
          evidenceRefs: [{ label: 'business-docs-graph-rebuild', path: `project:${selected.project.id}` }],
        })
        return { exitCode: 0, result, stdout: '', stderr: '' }
      }

      const result = failure(
        'BUSINESS_DOCS_UNKNOWN_COMMAND',
        `Unknown business-docs command: graph ${graphCommand ?? ''}`.trim(),
      )
      return { exitCode: 2, result, stdout: '', stderr: '' }
    }

    if (
      subcommand === 'status' ||
      subcommand === 'resume' ||
      subcommand === 'cancel' ||
      subcommand === 'cleanup'
    ) {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected

      const runId = nonEmptyOption(argv, '--run')
      if (!runId) {
        const result = failure('BUSINESS_DOCS_RUN_REQUIRED', 'Business docs run id is required.')
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const lifecycle = subcommand === 'status'
        ? getBusinessDocsStatus(db, { projectId: selected.project.id, runId })
        : subcommand === 'resume'
          ? resumeBusinessDocsRun(db, { projectId: selected.project.id, runId })
          : subcommand === 'cancel'
            ? cancelBusinessDocsRun(db, { projectId: selected.project.id, runId })
            : cleanupBusinessDocsRun(db, { projectId: selected.project.id, runId })
      if (!lifecycle.ok) {
        const result = failure(lifecycle.code, lifecycle.message)
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const result = success(lifecycle.data, {
        evidenceRefs: [{ label: `business-docs-${subcommand}`, path: `run:${lifecycle.data.run.id}` }],
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'leases' && argv[1] === 'release') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected

      const runId = nonEmptyOption(argv, '--run')
      if (!runId) {
        const result = failure('BUSINESS_DOCS_RUN_REQUIRED', 'Business docs run id is required.')
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const released = releaseActiveBusinessDocsLeases(db, {
        projectId: selected.project.id,
        runId,
        reason: nonEmptyOption(argv, '--reason') ?? 'manual_release',
      })
      if (!released.ok) {
        const result = failure(released.code, released.message)
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const result = success(released.data, {
        evidenceRefs: [{ label: 'business-docs-leases-release', path: `run:${runId}` }],
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'validate' || subcommand === 'review') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected

      const runId = nonEmptyOption(argv, '--run')
      if (!runId) {
        const result = failure('BUSINESS_DOCS_RUN_REQUIRED', 'Business docs run id is required.')
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const checked = subcommand === 'validate'
        ? validateBusinessDocsRun(db, { projectId: selected.project.id, runId })
        : reviewBusinessDocsRun(db, { projectId: selected.project.id, runId })
      if (!checked.ok) {
        const result = failure(checked.code, checked.message)
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const result = success(checked.data, {
        evidenceRefs: [{ label: `business-docs-${subcommand}`, path: `run:${runId}` }],
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'document' && argv[1] === 'show') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected

      const documentId = nonEmptyOption(argv, '--document')
      if (!documentId) {
        const result = failure('BUSINESS_DOCS_DOCUMENT_REQUIRED', 'Business docs document id is required.')
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const shown = showBusinessDoc(db, { projectId: selected.project.id, documentId })
      if (!shown.ok) {
        const result = failure(shown.code, shown.message)
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const result = success(shown.data, {
        evidenceRefs: [{ label: 'business-docs-document', path: `document:${documentId}` }],
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'tasks') {
      const taskCommand = argv[1]
      if (taskCommand === 'lease') {
        const selected = requireSelectedProject(db, options, root.config)
        if ('exitCode' in selected) return selected

        const runId = nonEmptyOption(argv, '--run')
        if (!runId) {
          const result = failure('BUSINESS_DOCS_RUN_REQUIRED', 'Business docs run id is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }
        const workerId = nonEmptyOption(argv, '--worker')
        if (!workerId) {
          const result = failure('BUSINESS_DOCS_WORKER_REQUIRED', 'Business docs worker id is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const leased = leaseBusinessDocsTasks(db, {
          projectId: selected.project.id,
          runId,
          workerId,
          limit: parseLimit(argv),
        })
        if (!leased.ok) {
          const result = failure(leased.code, leased.message)
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const result = success(leased.data, {
          evidenceRefs: [{ label: 'business-docs-lease', path: `run:${leased.data.run.id}` }],
        })
        return { exitCode: 0, result, stdout: '', stderr: '' }
      }

      if (taskCommand === 'retry') {
        const selected = requireSelectedProject(db, options, root.config)
        if ('exitCode' in selected) return selected

        const taskId = nonEmptyOption(argv, '--task')
        if (!taskId) {
          const result = failure('BUSINESS_DOCS_TASK_REQUIRED', 'Business docs task id is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const retry = retryBusinessDocsTask(db, {
          projectId: selected.project.id,
          taskId,
        })
        if (!retry.ok) {
          const result = failure(retry.code, retry.message)
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const result = success(retry.data, {
          evidenceRefs: [{ label: 'business-docs-task-retry', path: `task:${retry.data.task.id}` }],
        })
        return { exitCode: 0, result, stdout: '', stderr: '' }
      }

      if (taskCommand === 'heartbeat') {
        const selected = requireSelectedProject(db, options, root.config)
        if ('exitCode' in selected) return selected

        const taskId = nonEmptyOption(argv, '--task')
        if (!taskId) {
          const result = failure('BUSINESS_DOCS_TASK_REQUIRED', 'Business docs task id is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }
        const leaseToken = nonEmptyOption(argv, '--lease-token')
        if (!leaseToken) {
          const result = failure('BUSINESS_DOCS_LEASE_TOKEN_REQUIRED', 'Business docs lease token is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const heartbeat = heartbeatBusinessDocsTask(db, {
          projectId: selected.project.id,
          taskId,
          leaseToken,
        })
        if (!heartbeat.ok) {
          const result = failure(heartbeat.code, heartbeat.message)
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const result = success(heartbeat.data, {
          evidenceRefs: [{ label: 'business-docs-heartbeat', path: `task:${heartbeat.data.task.id}` }],
        })
        return { exitCode: 0, result, stdout: '', stderr: '' }
      }

      if (taskCommand === 'submit') {
        const selected = requireSelectedProject(db, options, root.config)
        if ('exitCode' in selected) return selected

        const taskId = nonEmptyOption(argv, '--task')
        if (!taskId) {
          const result = failure('BUSINESS_DOCS_TASK_REQUIRED', 'Business docs task id is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }
        const leaseToken = nonEmptyOption(argv, '--lease-token')
        if (!leaseToken) {
          const result = failure('BUSINESS_DOCS_LEASE_TOKEN_REQUIRED', 'Business docs lease token is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }
        const attemptNo = parseAttempt(argv)
        if (attemptNo === undefined) {
          const result = failure('BUSINESS_DOCS_ATTEMPT_REQUIRED', 'Business docs submit attempt is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }
        const documentJson = nonEmptyOption(argv, '--document-json')
        if (!documentJson) {
          const result = failure('BUSINESS_DOCS_SUBMIT_JSON_REQUIRED', 'Business docs submit JSON is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }
        const document = parseJsonObject(documentJson)
        if (!document) {
          const result = failure('BUSINESS_DOCS_SUBMIT_JSON_INVALID', 'Business docs submit JSON must be a JSON object.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const submitted = submitBusinessDocsTask(db, {
          projectId: selected.project.id,
          taskId,
          leaseToken,
          attemptNo,
          document,
        })
        if (!submitted.ok) {
          const result = failure(submitted.code, submitted.message)
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const result = success(submitted.data, {
          evidenceRefs: [{ label: 'business-docs-submit', path: `task:${submitted.data.task.id}` }],
        })
        return { exitCode: 0, result, stdout: '', stderr: '' }
      }

      const result = failure(
        'BUSINESS_DOCS_UNKNOWN_COMMAND',
        `Unknown business-docs command: tasks ${taskCommand ?? ''}`.trim(),
      )
      return { exitCode: 2, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'context') {
      const contextCommand = argv[1]
      if (contextCommand === 'get') {
        const contextHandle = nonEmptyOption(argv, '--context')
        if (!contextHandle) {
          const result = failure('BUSINESS_DOCS_CONTEXT_REQUIRED', 'Business docs context handle is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }
        const leaseToken = nonEmptyOption(argv, '--lease-token')
        if (!leaseToken) {
          const result = failure('BUSINESS_DOCS_LEASE_TOKEN_REQUIRED', 'Business docs lease token is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const context = getBusinessDocsContextBundle(db, {
          contextHandle,
          leaseToken,
        })
        if (!context.ok) {
          const result = failure(context.code, context.message)
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const result = success(context.data, {
          evidenceRefs: [{ label: 'business-docs-context', path: `context:${contextHandle}` }],
        })
        return { exitCode: 0, result, stdout: '', stderr: '' }
      }

      if (contextCommand === 'page') {
        const contextHandle = nonEmptyOption(argv, '--context')
        if (!contextHandle) {
          const result = failure('BUSINESS_DOCS_CONTEXT_REQUIRED', 'Business docs context handle is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }
        const pageToken = nonEmptyOption(argv, '--page')
        if (!pageToken) {
          const result = failure('BUSINESS_DOCS_CONTEXT_PAGE_REQUIRED', 'Business docs context page token is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }
        const leaseToken = nonEmptyOption(argv, '--lease-token')
        if (!leaseToken) {
          const result = failure('BUSINESS_DOCS_LEASE_TOKEN_REQUIRED', 'Business docs lease token is required.')
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const page = getBusinessDocsContextPage(db, {
          contextHandle,
          pageToken,
          leaseToken,
        })
        if (!page.ok) {
          const result = failure(page.code, page.message)
          return { exitCode: 2, result, stdout: '', stderr: '' }
        }

        const result = success(page.data, {
          evidenceRefs: [{ label: 'business-docs-context-page', path: `context:${contextHandle}:${pageToken}` }],
        })
        return { exitCode: 0, result, stdout: '', stderr: '' }
      }

      const result = failure(
        'BUSINESS_DOCS_UNKNOWN_COMMAND',
        `Unknown business-docs command: context ${contextCommand ?? ''}`.trim(),
      )
      return { exitCode: 2, result, stdout: '', stderr: '' }
    }

    const result = failure(
      'BUSINESS_DOCS_UNKNOWN_COMMAND',
      `Unknown business-docs command: ${subcommand ?? ''}`,
    )
    return { exitCode: 2, result, stdout: '', stderr: '' }
  } finally {
    openedDb?.close()
  }
}
