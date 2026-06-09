import path from 'node:path'
import type { TechnicalDocumentType } from '@/db/schema/build_docs.js'
import { buildDocsAgentWorkPacket, type BuildDocsAgentWorkPacket } from '../source/agent_packet.js'
import type { BuildDocsGenerationContextResponse, LeasedGenerationTask, LeaseTasksResult, SubmitTaskResult, TaskStatusCounts } from '../runtime/types.js'
import { invokeCodexCliJson, safeName, type CodexCliEffort } from '@/pipeline_modules/cli_agent_runner/codex_cli.js'
import type { BuildDocsCliRuntime } from '../runtime/cli_runtime.js'

export type BuildDocsRunnerProvider = 'codex_cli' | 'claude_code'
export type BuildDocsRunnerPreset = 'final-mixed' | 'balanced'
export type BuildDocsRunnerEffort = CodexCliEffort
export type BuildDocsRunnerStartMode = 'incremental' | 'full'

export interface BuildDocsRunnerModel {
  provider: BuildDocsRunnerProvider
  model: string
  effort?: BuildDocsRunnerEffort
}

export type BuildDocsRunnerModelPolicy = Record<TechnicalDocumentType, BuildDocsRunnerModel>

export interface BuildDocsTaskInvokerInput {
  taskId: string
  targetKey: string
  documentType: TechnicalDocumentType
  context: BuildDocsGenerationContextResponse
  model: BuildDocsRunnerModel
  prompt: string
  schema: Record<string, unknown>
  workDir: string
  timeoutMs: number
}

export type BuildDocsTaskInvoker = (input: BuildDocsTaskInvokerInput) => Promise<unknown>

export interface RunBuildDocsWorkerQueueInput {
  runtime: BuildDocsCliRuntime
  projectId: string
  runId?: string
  provider?: BuildDocsRunnerProvider
  preset?: BuildDocsRunnerPreset
  workers?: number
  maxConcurrentTasks?: number
  requestedBy?: string
  approvedBy?: string
  outputLanguage?: 'ko' | 'en'
  mode?: BuildDocsRunnerStartMode
  syncPlanId?: string
  includeStaleCandidates?: boolean
  documentTypes?: TechnicalDocumentType[]
  workDir: string
  taskInvoker?: BuildDocsTaskInvoker
}

interface DocsRunStatus {
  run_id: string
  run_status: string
  task_counts_by_status: Partial<TaskStatusCounts>
  failed_tasks: Array<{ task_id: string; document_type: TechnicalDocumentType; target_key: string }>
  saved_document_count: number
}

const technicalDocumentTypes: TechnicalDocumentType[] = ['api_spec', 'screen_spec', 'event_spec', 'schedule_spec']
const idleWaitMs = 250
const activeLeaseWaitMs = 2_000

export async function runBuildDocsWorkerQueue(input: RunBuildDocsWorkerQueueInput) {
  const provider = input.provider ?? 'codex_cli'
  const modelPolicy = resolveBuildDocsRunnerModelPolicy({ provider, preset: input.preset })
  const maxWorkers = Math.max(1, Math.floor(input.workers ?? 20))
  const approvedConcurrency = Math.max(1, Math.floor(input.maxConcurrentTasks ?? maxWorkers))
  const taskInvoker = input.taskInvoker ?? createBuildDocsTaskInvoker(provider)
  const startedAt = Date.now()
  const runId = await ensureRun(input, approvedConcurrency)
  const runDir = path.join(input.workDir, safeName(runId), 'tasks')
  const taskStats = {
    saved: 0,
    repairRequested: 0,
    failed: 0,
    codexErrors: 0,
    byType: {} as Record<string, { saved: number; repairRequested: number; failed: number; codexErrors: number; totalMs: number }>,
  }

  let stopping = false
  let statusPollPromise: Promise<DocsRunStatus> | null = null
  let leasePollPromise: Promise<LeaseTasksResult> | null = null

  const statusForRun = async () => {
    while (statusPollPromise) await statusPollPromise.catch(() => {})
    const current = input.runtime.status({ runId }) as Promise<DocsRunStatus>
    statusPollPromise = current
    try {
      return await current
    } finally {
      if (statusPollPromise === current) statusPollPromise = null
    }
  }

  const leaseForWorker = async (workerId: string) => {
    while (leasePollPromise) await leasePollPromise.catch(() => {})
    const current = input.runtime.leaseTasks({
      runId,
      workerGroupId: workerId,
      limit: 1,
      documentTypes: input.documentTypes,
    }) as Promise<LeaseTasksResult>
    leasePollPromise = current
    try {
      return await current
    } finally {
      if (leasePollPromise === current) leasePollPromise = null
    }
  }

  const processTask = async (task: LeasedGenerationTask) => {
    const taskStartedAt = Date.now()
    let context: BuildDocsGenerationContextResponse
    try {
      context = await input.runtime.getContext({
        taskId: task.task_id,
        leaseToken: task.lease_token,
      }) as BuildDocsGenerationContextResponse
    } catch (error) {
      if (isRecoverableLeaseError(error)) return
      throw error
    }
    const packet = buildDocsAgentWorkPacket({ task, context })
    const documentType = task.document_type
    taskStats.byType[documentType] ??= { saved: 0, repairRequested: 0, failed: 0, codexErrors: 0, totalMs: 0 }

    let result: unknown
    try {
      result = await withTimeout(taskInvoker({
        taskId: task.task_id,
        targetKey: task.target_summary,
        documentType,
        context,
        model: modelPolicy[documentType],
        prompt: promptForPacket(packet),
        schema: packet.agentInput.outputSchema,
        workDir: runDir,
        timeoutMs: timeoutForDocumentType(documentType),
      }), timeoutForDocumentType(documentType), `build_docs task timed out for ${task.task_id}`)
    } catch {
      taskStats.codexErrors += 1
      taskStats.byType[documentType]!.codexErrors += 1
      result = failedDraftFor(documentType)
    }

    let submit: SubmitTaskResult
    try {
      submit = await input.runtime.submitTask({
        taskId: task.task_id,
        leaseToken: task.lease_token,
        document: result,
      }) as SubmitTaskResult
    } catch (error) {
      if (isRecoverableLeaseError(error)) return
      throw error
    }
    const elapsedMs = Date.now() - taskStartedAt
    taskStats.byType[documentType]!.totalMs += elapsedMs
    if (submit.status === 'saved') {
      taskStats.saved += 1
      taskStats.byType[documentType]!.saved += 1
    } else if (submit.status === 'repair_requested') {
      taskStats.repairRequested += 1
      taskStats.byType[documentType]!.repairRequested += 1
    } else if (submit.status === 'failed') {
      taskStats.failed += 1
      taskStats.byType[documentType]!.failed += 1
    }
  }

  const workerLoop = async (workerNumber: number) => {
    const workerId = `worker:docs:${safeName(runId)}:${workerNumber}`
    let idlePolls = 0
    while (!stopping) {
      const lease = await leaseForWorker(workerId)
      if (lease.type === 'not_approved') {
        const status = await statusForRun()
        if (status.run_status !== 'running') stopping = true
        return
      }
      const task = lease.leased_tasks[0]
      if (!task) {
        const status = await statusForRun()
        if (status.run_status !== 'running') {
          stopping = true
          return
        }
        const pending = Number(status.task_counts_by_status.pending ?? 0)
          + Number(status.task_counts_by_status.repair_requested ?? 0)
          + Number(status.task_counts_by_status.expired ?? 0)
        const leased = Number(status.task_counts_by_status.leased ?? 0)
        if (leased > 0) {
          idlePolls = 0
          await sleep(activeLeaseWaitMs)
          continue
        }
        idlePolls += 1
        if (pending === 0 && leased === 0 && idlePolls > 5) {
          stopping = true
          return
        }
        if (idlePolls > 100) throw new Error(`build_docs run made no progress for run ${runId}`)
        await sleep(idleWaitMs)
        continue
      }

      idlePolls = 0
      await processTask(task)
    }
  }

  await Promise.all(Array.from({ length: maxWorkers }, (_, index) => workerLoop(index + 1)))

  const status = await statusForRun()
  return {
    runId,
    elapsedMs: Date.now() - startedAt,
    runStatus: status.run_status,
    taskCountsByStatus: status.task_counts_by_status,
    failedTasks: status.failed_tasks,
    savedDocumentCount: status.saved_document_count,
    taskStats,
    modelPolicy,
  }
}

function isRecoverableLeaseError(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code)
    : error instanceof Error ? error.message : ''
  return code === 'INVALID_LEASE_TOKEN' || code === 'LEASE_EXPIRED'
}

async function ensureRun(input: RunBuildDocsWorkerQueueInput, approvedConcurrency: number): Promise<string> {
  const resumed = input.runId
    ? null
    : await input.runtime.resumeLatestInterruptedRun({ projectId: input.projectId })
  const start = input.runId || resumed
    ? null
    : await input.runtime.start({
      projectId: input.projectId,
      outputLanguage: input.outputLanguage,
      requestedBy: input.requestedBy ?? 'user',
      mode: input.mode,
      syncPlanId: input.syncPlanId,
      includeStaleCandidates: input.includeStaleCandidates,
    }) as { run_id: string; status: string }
  const runId = input.runId ?? resumed?.run_id ?? start!.run_id
  const status = await input.runtime.status({ runId }) as DocsRunStatus
  if (status.run_status === 'awaiting_approval') {
    await input.runtime.approve({
      runId,
      maxConcurrentTasks: approvedConcurrency,
      approvedBy: input.approvedBy ?? input.requestedBy ?? 'user',
    })
  }
  return runId
}

export function resolveBuildDocsRunnerModelPolicy(input: {
  provider: BuildDocsRunnerProvider
  preset?: BuildDocsRunnerPreset
}): BuildDocsRunnerModelPolicy {
  const preset = input.preset ?? (input.provider === 'codex_cli' ? 'final-mixed' : 'balanced')
  if (input.provider === 'codex_cli' && (preset === 'final-mixed' || preset === 'balanced')) {
    return Object.fromEntries(technicalDocumentTypes.map((documentType) => [
      documentType,
      { provider: 'codex_cli', model: 'gpt-5.4-mini', effort: 'low' },
    ])) as BuildDocsRunnerModelPolicy
  }
  if (input.provider === 'claude_code' && preset === 'balanced') {
    return Object.fromEntries(technicalDocumentTypes.map((documentType) => [
      documentType,
      { provider: 'claude_code', model: 'claude-haiku-4-5', effort: 'low' },
    ])) as BuildDocsRunnerModelPolicy
  }
  throw new Error(`Unsupported build_docs runner preset: ${input.provider}/${preset}`)
}

function createBuildDocsTaskInvoker(provider: BuildDocsRunnerProvider): BuildDocsTaskInvoker {
  if (provider !== 'codex_cli') throw new Error('CLAUDE_CODE_HEADLESS_UNSUPPORTED')
  return async (input) => {
    if (input.model.provider !== 'codex_cli') throw new Error(`Unsupported Codex CLI model provider: ${input.model.provider}`)
    return await invokeCodexCliJson({
      model: { provider: 'codex_cli', model: input.model.model, effort: input.model.effort },
      prompt: input.prompt,
      schema: input.schema,
      workDir: input.workDir,
      baseName: `${input.documentType}-${input.taskId}`,
      timeoutMs: input.timeoutMs,
    })
  }
}

function promptForPacket(packet: BuildDocsAgentWorkPacket): string {
  return [
    packet.agentInput.prompt,
    '',
    'agentInput.context JSON:',
    JSON.stringify(packet.agentInput.context, null, 2),
  ].join('\n')
}

function failedDraftFor(documentType: TechnicalDocumentType): Record<string, unknown> {
  return { title: '', summary: '', documentType }
}

function timeoutForDocumentType(documentType: TechnicalDocumentType): number {
  if (documentType === 'api_spec' || documentType === 'screen_spec') return 3 * 60_000
  return 2 * 60_000
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    timer.unref()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
