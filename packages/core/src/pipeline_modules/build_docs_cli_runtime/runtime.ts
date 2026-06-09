import { eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { generationRuns, generationTasks, type TechnicalDocumentType } from '@/db/schema/build_docs.js'
import { buildDocsAgentWorkPacket, type BuildDocsAgentNextResult } from '@/pipeline_modules/build_docs_generation/agent_packet.js'
import { BuildDocsGenerationRuntime, BuildDocsGenerationRuntimeError } from '@/pipeline_modules/build_docs_generation/runtime.js'
import type { LeasedGenerationTask, LeaseTaskResult } from '@/pipeline_modules/build_docs_generation/types.js'
import { findLatestResumableGenerationRun, reopenFailedGenerationRun } from '@/pipeline_modules/generation_runs/resumable_run_resolver.js'

type BuildDocsStartMode = 'incremental' | 'full'

export class BuildDocsCliRuntime {
  constructor(private readonly input: { db: DB }) {}

  async start(input: {
    projectId: string
    outputLanguage?: 'ko' | 'en'
    requestedBy: string
    mode?: BuildDocsStartMode
    syncPlanId?: string
    includeStaleCandidates?: boolean
  }): Promise<unknown> {
    return this.runtime().start(input)
  }

  async resumeLatestInterruptedRun(input: { projectId: string }): Promise<{ run_id: string; status: string } | null> {
    const run = findLatestResumableGenerationRun(this.input.db, {
      projectId: input.projectId,
      stage: 'build_docs',
    })
    if (!run) return null
    const resumed = reopenFailedGenerationRun(this.input.db, run)
    return { run_id: resumed.id, status: resumed.status }
  }

  async preview(input: { runId: string }): Promise<unknown> {
    return this.runtimeForRun(input.runId).preview(input)
  }

  async approve(input: { runId: string; maxConcurrentTasks: number; approvedBy: string }): Promise<unknown> {
    return this.runtimeForRun(input.runId).approve(input)
  }

  async leaseTask(input: { runId: string; workerId: string; documentTypes?: TechnicalDocumentType[] }): Promise<unknown> {
    return this.runtimeForRun(input.runId).leaseTask(input)
  }

  async workerNext(input: { runId: string; workerId: string; documentTypes?: TechnicalDocumentType[] }): Promise<BuildDocsAgentNextResult> {
    const runtime = this.runtimeForRun(input.runId)
    const leased = await runtime.leaseTask(input) as LeaseTaskResult
    if (leased.type !== 'task') return leased
    const context = await runtime.getContext({ taskId: leased.task_id, leaseToken: leased.lease_token })
    return buildDocsAgentWorkPacket({ task: leased as LeasedGenerationTask, context })
  }

  async leaseTasks(input: { runId: string; workerGroupId: string; limit: number; documentTypes?: TechnicalDocumentType[] }): Promise<unknown> {
    return this.runtimeForRun(input.runId).leaseTasks(input)
  }

  async getContext(input: { taskId: string; leaseToken: string }): Promise<unknown> {
    return this.runtimeForTask(input.taskId).getContext(input)
  }

  async getContextPage(input: { contextHandle: string; pageToken: string; leaseToken: string }): Promise<unknown> {
    const taskId = input.contextHandle.replace(/^ctx:/, '')
    return this.runtimeForTask(taskId).getContextPage(input)
  }

  async submitTask(input: { taskId: string; leaseToken: string; document: unknown; workerNotes?: string }): Promise<unknown> {
    return this.runtimeForTask(input.taskId).submitTask(input)
  }

  async status(input: { runId: string }): Promise<unknown> {
    return this.runtimeForRun(input.runId).status(input)
  }

  async cancel(input: { runId: string; reason?: string }): Promise<unknown> {
    return this.runtimeForRun(input.runId).cancel(input)
  }

  async releaseActiveLeases(input: { runId: string; reason?: string }): Promise<unknown> {
    return this.runtimeForRun(input.runId).releaseActiveLeases(input)
  }

  private runtimeForRun(runId: string) {
    const run = this.input.db.select().from(generationRuns).where(eq(generationRuns.id, runId)).get()
    if (!run) throw new BuildDocsGenerationRuntimeError('BUILD_DOCS_RUN_NOT_FOUND', `Build docs generation run not found: ${runId}`)
    if (run.stage !== 'build_docs') throw new BuildDocsGenerationRuntimeError('BUILD_DOCS_RUN_STAGE_MISMATCH', `Build docs runtime cannot use stage: ${run.stage}`)
    return this.runtime()
  }

  private runtimeForTask(taskId: string) {
    const task = this.input.db.select().from(generationTasks).where(eq(generationTasks.id, taskId)).get()
    if (!task) throw new BuildDocsGenerationRuntimeError('BUILD_DOCS_TASK_NOT_FOUND', `Build docs generation task not found: ${taskId}`)
    return this.runtimeForRun(task.runId)
  }

  private runtime() {
    return new BuildDocsGenerationRuntime({ db: this.input.db })
  }
}
