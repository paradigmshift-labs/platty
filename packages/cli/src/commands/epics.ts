import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  BuildEpicsCliRuntime,
  BuildEpicsSyncRuntime,
  buildBuildEpicsAgentWorkPacket,
  buildBuildEpicsSyncAgentWorkPacket,
  type BuildEpicsDraftEditInput,
  type BuildEpicsRuntimePolicyInput,
  type BuildEpicsRunnerPreset,
  type BuildEpicsRunnerProvider,
  type BuildEpicsTaskInvoker,
  type DB,
  runBuildEpicsSyncWorkerQueue,
  runBuildEpicsWorkerQueue,
  type OpenPlattyDbResult,
  projectPointer,
  resolveProjectSelector,
  schema,
} from '@platty/core'
import { readProjectConfig } from '../config-store.js'
import { openCliDb } from '../db.js'
import { failure, success, type PlattyCommandResponse } from '../output.js'
import { requirePlattyRoot } from '../project-root.js'

export interface EpicsCommandOptions {
  cwd: string
  db?: DB
  openDb?: () => OpenPlattyDbResult
  project?: string
  epicsTaskInvoker?: BuildEpicsTaskInvoker
}

type ProjectRow = typeof schema.projects.$inferSelect
type EpicRow = typeof schema.epics.$inferSelect
type DocumentRow = typeof schema.documents.$inferSelect
type EpicDocumentLinkRow = typeof schema.epicDocumentLinks.$inferSelect

const EPICS_HELP = `\
Usage: platty epics <command> [options]

Run and inspect epic generation workflows.

Commands:
  list                              List epics for the current project
  search                            Search epics
  show --epic <id>                  Show epic details
  related --epic <id>               Show related epics
  preview                           Preview the epic generation plan
  start                             Start an epic generation run
  run                               Run the epics worker queue
  status --run-id <id>              Check run status
  validate --run-id <id>            Validate a run
  cancel --run-id <id>              Cancel an active run
  draft show --run-id <id>          Show the draft output
  draft edit --run-id <id>          Edit the draft output
  draft confirm --run-id <id>       Confirm and commit the draft
  tasks lease --run-id <id>         Lease tasks for a worker
  tasks submit                      Submit task results
  worker next --run-id <id>         Get next work packet for a worker
  context get                       Get task context bundle
  sync start --doc-sync-plan-id <id>  Start an epic sync run
  sync preview --doc-sync-plan-id <id> Preview an epic sync plan
  sync run --doc-sync-plan-id <id>  Run the sync worker queue
  sync status --run-id <id>         Check sync run status
  sync draft show --run-id <id>     Show the sync draft
  sync draft confirm --run-id <id>  Confirm the sync draft
  sync tasks lease --run-id <id>    Lease sync tasks for a worker
  sync tasks submit                 Submit sync task results
  sync worker next --run-id <id>    Get next sync work packet
  sync context get                  Get sync task context

Options:
  --json                            Machine-readable JSON output
  --project <selector>              Target project (id, name, or current)
  -h, --help                        Display help for command
`

export async function runEpicsCommand(argv: string[], options: EpicsCommandOptions): Promise<PlattyCommandResponse> {
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    return { exitCode: 0, result: success(), stdout: EPICS_HELP, stderr: '', skipDefaultRender: true }
  }

  const root = await requireProjectRoot(options.cwd, options)
  if ('exitCode' in root) return root

  const openedDb = options.db ? null : (options.openDb?.() ?? openCliDb())
  const db = options.db ?? openedDb!.db
  const runtime = new BuildEpicsCliRuntime({ db })

  try {
    const command = positional(argv)
    const projectId = options.project ?? root.config.currentProject?.id

    if (command[0] === 'list') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected
      return ok(listEpicsForRetrieval(db, selected.project, { compact: argv.includes('--compact') }))
    }
    if (command[0] === 'search') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected
      return ok(searchEpicsForRetrieval(db, selected.project, { terms: termsValue(argv) }))
    }
    if (command[0] === 'show' || command[0] === 'related') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected
      const epicId = required(argv, '--epic')
      const graph = showEpicRetrievalGraph(db, selected.project, epicId)
      if (!graph) {
        return {
          exitCode: 2,
          result: failure('EPIC_NOT_FOUND', `EPIC was not found: ${epicId}`),
          stdout: '',
          stderr: '',
        }
      }
      return ok(graph)
    }

    if (command[0] === 'sync') {
      if (!projectId) return projectNotSelected()
      const syncRuntime = new BuildEpicsSyncRuntime({ db })
      const syncCommand = command[1]
      if (syncCommand === 'preview') {
        return ok(await syncRuntime.preview({ projectId, docSyncPlanId: required(argv, '--doc-sync-plan-id') }))
      }
      if (syncCommand === 'start') {
        return ok(await syncRuntime.start({
          projectId,
          docSyncPlanId: required(argv, '--doc-sync-plan-id'),
          requestedBy: optionValue(argv, '--requested-by') ?? 'user',
        }))
      }
      if (syncCommand === 'run') {
        const provider = providerValue(argv)
        if (provider !== 'codex_cli' && !options.epicsTaskInvoker) {
          return {
            exitCode: 2,
            result: failure('CLAUDE_CODE_HEADLESS_UNSUPPORTED', 'Claude Code is not available as a headless build_epics sync worker runner. Use epics sync worker next with Claude Code skill workers.'),
            stdout: '',
            stderr: '',
          }
        }
        const workDir = optionValue(argv, '--work-dir') ?? join(root.config.projectRoot, '.platty', 'tmp', 'build_epics_sync_runs')
        return ok(await runBuildEpicsSyncWorkerQueue({
          runtime: syncRuntime,
          projectId,
          docSyncPlanId: required(argv, '--doc-sync-plan-id'),
          runId: optionValue(argv, '--run-id'),
          provider,
          workers: numberValue(argv, '--workers', 20),
          requestedBy: optionValue(argv, '--requested-by') ?? 'user',
          workDir: resolve(options.cwd, workDir),
          taskInvoker: options.epicsTaskInvoker as never,
        }))
      }
      if (syncCommand === 'tasks' && command[2] === 'lease') {
        return ok(await syncRuntime.leaseTasks({
          runId: required(argv, '--run-id'),
          limit: numberValue(argv, '--limit', 1),
          workerId: optionValue(argv, '--worker-id') ?? 'worker:epics-sync:cli',
        }))
      }
      if (syncCommand === 'worker' && command[2] === 'next') {
        const runId = required(argv, '--run-id')
        const lease = await syncRuntime.leaseTasks({
          runId,
          limit: 1,
          workerId: optionValue(argv, '--worker-id') ?? 'worker:epics-sync:cli',
        })
        const task = lease.leasedTasks[0]
        if (!task) {
          const status = await syncRuntime.status({ runId })
          return ok({
            type: 'no_task_available',
            runId,
            runStatus: status.runStatus,
            remainingPendingTaskCount: lease.remainingPendingTaskCount,
          })
        }
        const context = await syncRuntime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
        const packet = buildBuildEpicsSyncAgentWorkPacket({ task, context: context as unknown as Record<string, unknown> })
        return ok(await writePacketIfRequested(argv, options.cwd, packet))
      }
      if (syncCommand === 'context' && command[2] === 'get') {
        return ok(await syncRuntime.getContext({ taskId: required(argv, '--task-id'), leaseToken: required(argv, '--lease-token') }))
      }
      if (syncCommand === 'tasks' && command[2] === 'submit') {
        return ok(await syncRuntime.submitTask({
          taskId: required(argv, '--task-id'),
          leaseToken: required(argv, '--lease-token'),
          result: await readJsonFile(required(argv, '--input')),
        }))
      }
      if (syncCommand === 'status') return ok(await syncRuntime.status({ runId: required(argv, '--run-id') }))
      if (syncCommand === 'draft' && command[2] === 'show') return ok(await syncRuntime.showDraft({ runId: required(argv, '--run-id') }))
      if (syncCommand === 'draft' && command[2] === 'confirm') {
        return ok(await syncRuntime.confirmDraft({
          runId: required(argv, '--run-id'),
          requestedBy: optionValue(argv, '--requested-by') ?? 'user',
        }))
      }
      return { exitCode: 2, result: failure('UNKNOWN_COMMAND', `Unknown epics sync command: ${command.slice(1).join(' ')}`), stdout: '', stderr: '' }
    }

    if (command[0] === 'preview') {
      if (!projectId) return projectNotSelected()
      return ok(await runtime.preview({ projectId, outputLanguage: languageValue(argv) }))
    }
    if (command[0] === 'start') {
      if (!projectId) return projectNotSelected()
      const policy = await readJsonPolicy(optionValue(argv, '--policy'))
      return ok(await runtime.start({ projectId, policy, requestedBy: optionValue(argv, '--requested-by') ?? 'user' }))
    }
    if (command[0] === 'run') {
      if (!projectId) return projectNotSelected()
      const provider = providerValue(argv)
      if (provider !== 'codex_cli' && !options.epicsTaskInvoker) {
        return {
          exitCode: 2,
          result: failure('CLAUDE_CODE_HEADLESS_UNSUPPORTED', 'Claude Code is not available as a headless build_epics worker runner. Use codex_cli for epics run.'),
          stdout: '',
          stderr: '',
        }
      }
      const policy = await readJsonPolicy(optionValue(argv, '--policy'))
      const workDir = optionValue(argv, '--work-dir') ?? join(root.config.projectRoot, '.platty', 'tmp', 'build_epics_runs')
      return ok(await runBuildEpicsWorkerQueue({
        runtime,
        projectId,
        runId: optionValue(argv, '--run-id'),
        policy,
        provider,
        preset: presetValue(argv),
        workers: numberValue(argv, '--workers', 20),
        requestedBy: optionValue(argv, '--requested-by') ?? 'user',
        workDir: resolve(options.cwd, workDir),
        taskInvoker: options.epicsTaskInvoker,
      }))
    }
    if (command[0] === 'tasks' && command[1] === 'lease') {
      return ok(await runtime.leaseTasks({
        runId: required(argv, '--run-id'),
        limit: numberValue(argv, '--limit', 1),
        workerId: optionValue(argv, '--worker-id') ?? 'worker:cli',
      }))
    }
    if (command[0] === 'worker' && command[1] === 'next') {
      const runId = required(argv, '--run-id')
      const lease = await runtime.leaseTasks({
        runId,
        limit: 1,
        workerId: optionValue(argv, '--worker-id') ?? 'worker:epics:cli',
      })
      const task = lease.leasedTasks[0]
      if (!task) {
        const status = await runtime.status({ runId })
        return ok({
          type: 'no_task_available',
          runId,
          runStatus: status.runStatus,
          remainingPendingTaskCount: lease.remainingPendingTaskCount,
        })
      }
      const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
      const packet = buildBuildEpicsAgentWorkPacket({ task, context: context as unknown as Record<string, unknown> })
      return ok(await writePacketIfRequested(argv, options.cwd, packet))
    }
    if (command[0] === 'context' && command[1] === 'get') {
      return ok(await runtime.getContext({ taskId: required(argv, '--task-id'), leaseToken: required(argv, '--lease-token') }))
    }
    if (command[0] === 'tasks' && command[1] === 'submit') {
      return ok(await runtime.submitTask({
        taskId: required(argv, '--task-id'),
        leaseToken: required(argv, '--lease-token'),
        result: await readJsonFile(required(argv, '--input')),
      }))
    }
    if (command[0] === 'status') return ok(await runtime.status({ runId: required(argv, '--run-id') }))
    if (command[0] === 'draft' && command[1] === 'edit') {
      const input = await readJsonFile(required(argv, '--input')) as BuildEpicsDraftEditInput
      return ok(await runtime.editDraft({
        runId: required(argv, '--run-id'),
        expectedVersion: input.expectedVersion,
        commands: input.commands,
        requestedBy: optionValue(argv, '--requested-by') ?? 'user',
      }))
    }
    if (command[0] === 'draft' && command[1] === 'confirm') {
      return ok(await runtime.confirmDraft({
        runId: required(argv, '--run-id'),
        requestedBy: optionValue(argv, '--requested-by') ?? 'user',
      }))
    }
    if (command[0] === 'draft' && command[1] === 'show') return ok(await runtime.showDraft({ runId: required(argv, '--run-id') }))
    if (command[0] === 'validate') return ok(await runtime.validate({ runId: required(argv, '--run-id') }))
    if (command[0] === 'cancel') return ok(await runtime.cancel({ runId: required(argv, '--run-id'), reason: optionValue(argv, '--reason') }))

    return { exitCode: 2, result: failure('UNKNOWN_COMMAND', `Unknown epics command: ${command.join(' ')}`), stdout: '', stderr: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'epics command failed'
    return { exitCode: 1, result: failure('EPICS_COMMAND_FAILED', message), stdout: '', stderr: '' }
  } finally {
    openedDb?.close()
  }
}

async function requireProjectRoot(
  cwd: string,
  _options: EpicsCommandOptions,
): Promise<{ config: Awaited<ReturnType<typeof readProjectConfig>> } | PlattyCommandResponse> {
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

function ok(data: unknown): PlattyCommandResponse {
  return { exitCode: 0, result: success(data), stdout: '', stderr: '' }
}

function projectNotSelected(): PlattyCommandResponse {
  return {
    exitCode: 2,
    result: failure('PROJECT_NOT_SELECTED', 'No Platty project is selected'),
    stdout: '',
    stderr: '',
  }
}

function missingProject(): PlattyCommandResponse {
  return {
    exitCode: 2,
    result: failure('PROJECT_NOT_FOUND', 'Platty project was not found'),
    stdout: '',
    stderr: '',
  }
}

function ambiguousProject(selector: string): PlattyCommandResponse {
  return {
    exitCode: 2,
    result: failure('PROJECT_AMBIGUOUS', `Project selector matched multiple projects: ${selector}`),
    stdout: '',
    stderr: '',
  }
}

function requireSelectedProject(
  db: DB,
  options: EpicsCommandOptions,
  config: Awaited<ReturnType<typeof readProjectConfig>>,
): { project: ProjectRow } | PlattyCommandResponse {
  const selector = options.project?.trim() || config.currentProject?.id
  if (!selector) return projectNotSelected()
  const resolvedProject = resolveProjectSelector(db, selector, config.currentProject)
  if (resolvedProject.kind === 'missing') return missingProject()
  if (resolvedProject.kind === 'ambiguous') return ambiguousProject(selector)
  return { project: resolvedProject.project }
}

function listEpicsForRetrieval(db: DB, project: ProjectRow, _input: { compact: boolean }) {
  const index = epicRetrievalIndex(db, project)

  return {
    project: projectPointer(project),
    epics: index.epics.map((epic) => compactEpicView(epic, documentsForEpic(epic, index.docs, index.links, index.docsById))),
  }
}

function searchEpicsForRetrieval(db: DB, project: ProjectRow, input: { terms: string[] }) {
  const index = epicRetrievalIndex(db, project)
  const scored = index.epics
    .map((epic) => {
      const docs = documentsForEpic(epic, index.docs, index.links, index.docsById)
      const searchable = searchableText([
        epic.id,
        epic.stableKey,
        epic.name,
        epic.abbr,
        epic.summary,
        epic.description,
        ...docs.flatMap((doc) => [doc.id, doc.type, doc.scope, doc.scopeId, doc.summary, contentTitle(doc.content), doc.content]),
      ])
      const matchedTerms = input.terms.filter((term) => searchable.includes(term.toLowerCase()))
      return {
        ...compactEpicView(epic, docs),
        score: matchedTerms.length,
        matchedTerms,
      }
    })
    .filter((epic) => epic.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
  return {
    project: projectPointer(project),
    query: { terms: input.terms },
    epics: scored,
  }
}

function showEpicRetrievalGraph(db: DB, project: ProjectRow, epicId: string) {
  const index = epicRetrievalIndex(db, project)
  const epic = index.epics.find((candidate) => candidate.id === epicId || candidate.stableKey === epicId)
  if (!epic) return null
  const docs = documentsForEpic(epic, index.docs, index.links, index.docsById)
  const links = index.links.filter((link) => link.epicId === epic.id && index.docsById.has(link.documentId))
  return {
    project: projectPointer(project),
    epic: compactEpicView(epic, docs),
    documents: groupDocumentsByType(docs),
    links: links.map((link) => ({
      epicId: link.epicId,
      documentId: link.documentId,
      documentType: link.documentType,
      role: link.role,
      reason: link.reason,
      confidence: link.confidence,
      target: documentMiniView(index.docsById.get(link.documentId)!),
    })),
  }
}

function epicRetrievalIndex(db: DB, project: ProjectRow) {
  const epics = db.select().from(schema.epics).all()
    .filter((epic) => epic.projectId === project.id && epic.deletedAt === null && epic.confirmedAt !== null)
    .sort((left, right) => (left.stableKey ?? left.name).localeCompare(right.stableKey ?? right.name))
  const docs = db.select().from(schema.documents).all()
    .filter((doc) => doc.projectId === project.id && (doc.status === 'active' || doc.status === 'passed'))
  const links = db.select().from(schema.epicDocumentLinks).all()
  const docsById = new Map(docs.map((doc) => [doc.id, doc]))
  return { epics, docs, links, docsById }
}

function documentsForEpic(
  epic: EpicRow,
  docs: DocumentRow[],
  links: EpicDocumentLinkRow[],
  docsById: Map<string, DocumentRow>,
) {
  const byId = new Map<string, DocumentRow>()
  for (const doc of docs) {
    if (doc.scope === 'epic' && doc.scopeId === epic.id) byId.set(doc.id, doc)
  }
  for (const link of links) {
    if (link.epicId !== epic.id) continue
    const doc = docsById.get(link.documentId)
    if (doc) byId.set(doc.id, doc)
  }
  return [...byId.values()].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`))
}

function compactEpicView(epic: EpicRow, docs: DocumentRow[]) {
  return {
    epicId: epic.id,
    stableKey: epic.stableKey,
    title: epic.name,
    summary: epic.summary ?? epic.description,
    status: epic.status,
    confirmedAt: epic.confirmedAt,
    documentCounts: documentCounts(docs),
    terms: termsForEpic(epic, docs),
    freshness: epicFreshness(docs),
  }
}

function groupDocumentsByType(docs: DocumentRow[]) {
  const groups: Record<string, ReturnType<typeof documentMiniView>[]> = {
    glossary: [],
    ucl: [],
    ucs: [],
    br: [],
    data_dictionary: [],
    design: [],
    api_spec: [],
    screen_spec: [],
    event_spec: [],
    schedule_spec: [],
  }
  for (const doc of docs) {
    const target = groups[doc.type] ?? []
    target.push(documentMiniView(doc))
    groups[doc.type] = target
  }
  return groups
}

function documentMiniView(doc: DocumentRow) {
  return {
    id: doc.id,
    type: doc.type,
    track: doc.track,
    scope: doc.scope,
    scopeId: doc.scopeId,
    status: doc.status,
    validity: doc.validity,
    title: contentTitle(doc.content),
    summary: doc.summary,
    freshness: documentFreshness(doc),
  }
}

function documentCounts(docs: DocumentRow[]) {
  const counts: Record<string, number> = {}
  for (const doc of docs) counts[doc.type] = (counts[doc.type] ?? 0) + 1
  return counts
}

function termsForEpic(epic: EpicRow, docs: DocumentRow[]) {
  const terms = new Set<string>()
  for (const value of [epic.stableKey, epic.name, epic.abbr, epic.summary, epic.description]) {
    if (value) terms.add(value)
  }
  for (const doc of docs) {
    for (const value of [contentTitle(doc.content), doc.summary, doc.type, doc.scopeId]) {
      if (value) terms.add(value)
    }
  }
  return [...terms].slice(0, 40)
}

function epicFreshness(docs: DocumentRow[]) {
  const staleDocumentCount = docs.filter((doc) => doc.validity === 'stale').length
  const orphanedDocumentCount = docs.filter((doc) => doc.validity === 'orphaned').length
  return {
    validity: staleDocumentCount > 0 ? 'stale' : orphanedDocumentCount > 0 ? 'orphaned' : 'fresh',
    isStale: staleDocumentCount > 0 || orphanedDocumentCount > 0,
    staleDocumentCount,
    orphanedDocumentCount,
  }
}

function documentFreshness(doc: DocumentRow) {
  return {
    validity: doc.validity,
    isStale: doc.validity !== 'fresh',
    sourceCommit: doc.sourceCommit ?? null,
    sourceRunId: doc.sourceRunId ?? null,
    staticSnapshotId: doc.staticSnapshotId ?? null,
    documentSourceHash: doc.documentSourceHash ?? null,
    updatedAt: doc.updatedAt,
  }
}

function termsValue(argv: string[]): string[] {
  return (optionValue(argv, '--terms') ?? '')
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean)
}

function searchableText(values: unknown[]) {
  return values
    .map((field) => {
      if (field === null || field === undefined) return ''
      if (typeof field === 'string') return field
      return JSON.stringify(field)
    })
    .join('\n')
    .toLowerCase()
}

function contentTitle(content: Record<string, unknown> | null) {
  return typeof content?.title === 'string' ? content.title : null
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

function optionValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  const value = index === -1 ? undefined : argv[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function required(argv: string[], flag: string): string {
  const value = optionValue(argv, flag)
  if (!value) throw new Error(`${flag} is required`)
  return value
}

function numberValue(argv: string[], flag: string, fallback: number): number {
  const value = optionValue(argv, flag)
  return value ? Number(value) : fallback
}

function languageValue(argv: string[]): 'ko' | 'en' {
  return optionValue(argv, '--language') === 'ko' ? 'ko' : 'en'
}

function providerValue(argv: string[]): BuildEpicsRunnerProvider {
  const provider = optionValue(argv, '--provider') ?? 'codex_cli'
  if (provider !== 'codex_cli' && provider !== 'claude_code') throw new Error(`Unsupported --provider: ${provider}`)
  return provider
}

function presetValue(argv: string[]): BuildEpicsRunnerPreset | undefined {
  const preset = optionValue(argv, '--preset')
  if (preset === undefined) return undefined
  if (preset !== 'final-mixed' && preset !== 'balanced') throw new Error(`Unsupported --preset: ${preset}`)
  return preset
}

async function readJsonPolicy(path: string | undefined): Promise<BuildEpicsRuntimePolicyInput> {
  if (!path) return {}
  return await readJsonFile(path) as BuildEpicsRuntimePolicyInput
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writePacketIfRequested(argv: string[], cwd: string, packet: unknown): Promise<unknown> {
  const outPath = optionValue(argv, '--out')
  if (!outPath) return packet
  const resolved = resolve(cwd, outPath)
  await mkdir(dirname(resolved), { recursive: true })
  await writeFile(resolved, `${JSON.stringify(packet, null, 2)}\n`, 'utf8')
  return typeof packet === 'object' && packet !== null && !Array.isArray(packet)
    ? { ...packet, packetPath: resolved }
    : { type: 'packet', packetPath: resolved }
}
