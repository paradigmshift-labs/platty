import { and, eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import {
  businessDocGenerationRuns,
  businessDocGenerationTasks,
  type BusinessDocGenerationRun,
  type BusinessDocGenerationTask,
} from '@/db/schema/build_business_docs_generation.js'
import {
  getBusinessDocsStatus,
  resumeBusinessDocsRun,
  retryBusinessDocsTask,
} from '@/pipeline_modules/build_business_docs_cli/lifecycle.js'
import type {
  BusinessDocsLifecycleNextAction,
} from '@/pipeline_modules/build_business_docs_cli/types.js'
import type {
  UnifiedRunNextAction,
  UnifiedRunReleaseLeasesResult,
  UnifiedRunResumeResult,
  UnifiedRunRetryInput,
  UnifiedRunRetryResult,
  UnifiedRunStatusResult,
} from './types.js'

export async function statusBusinessDocsUnifiedRun(
  db: DB,
  input: { projectId: string; runId: string; now?: () => Date },
): Promise<UnifiedRunStatusResult> {
  const status = getBusinessDocsStatus(db, input)
  if (!status.ok) throw codeError(status.code, status.message)

  return {
    runId: status.data.run.id,
    kind: 'build_business_docs',
    projectId: input.projectId,
    status: status.data.run.status,
    taskCountsByStatus: status.data.tasks.counts,
    nextAction: normalizeBusinessNextAction(status.data.nextAction),
    stage: status.data,
  }
}

export async function resumeBusinessDocsUnifiedRun(
  db: DB,
  input: { projectId: string; runId: string; now?: () => Date },
): Promise<UnifiedRunResumeResult> {
  const resumed = resumeBusinessDocsRun(db, input)
  if (!resumed.ok) throw codeError(resumed.code, resumed.message)

  return {
    runId: resumed.data.run.id,
    kind: 'build_business_docs',
    projectId: input.projectId,
    status: resumed.data.run.status,
    taskCountsByStatus: countBusinessTaskStatuses(tasksForRun(db, input.runId)),
    nextAction: normalizeBusinessNextAction(resumed.data.nextAction),
    recovered: {
      expiredLeases: resumed.data.recovered.expiredLeases,
      repairTasksReady: resumed.data.recovered.repairTasksReady,
      failedTasksReady: resumed.data.recovered.failedTasksReady,
    },
    stage: resumed.data,
  }
}

export async function releaseBusinessDocsRunLeases(
  db: DB,
  input: { projectId: string; runId: string; reason?: string },
): Promise<UnifiedRunReleaseLeasesResult> {
  return db.transaction((tx): UnifiedRunReleaseLeasesResult => {
    const run = tx.select().from(businessDocGenerationRuns)
      .where(eq(businessDocGenerationRuns.id, input.runId))
      .get()
    if (!run || run.projectId !== input.projectId) {
      throw codeError('BUSINESS_DOCS_RUN_NOT_FOUND', 'Business docs generation run was not found for the selected project.')
    }
    if (run.status === 'cancelled') throw codeError('RUNS_RUN_CANCELLED', 'Business docs generation run is cancelled.')

    const now = new Date().toISOString()
    let releasedLeaseCount = 0
    for (const task of tx.select().from(businessDocGenerationTasks)
      .where(and(
        eq(businessDocGenerationTasks.runId, input.runId),
        eq(businessDocGenerationTasks.status, 'leased'),
      ))
      .all()) {
      const updated = tx.update(businessDocGenerationTasks)
        .set({
          status: 'expired',
          workerId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorJson: {
            code: 'LEASE_RELEASED',
            message: input.reason || 'manual_release',
          },
          updatedAt: now,
        })
        .where(and(
          eq(businessDocGenerationTasks.id, task.id),
          eq(businessDocGenerationTasks.status, 'leased'),
        ))
        .run()
      if (updated.changes === 1) releasedLeaseCount += 1
    }
    tx.update(businessDocGenerationRuns)
      .set({ updatedAt: now })
      .where(eq(businessDocGenerationRuns.id, input.runId))
      .run()

    const tasks = tasksForRun(tx, input.runId)
    return {
      runId: input.runId,
      kind: 'build_business_docs',
      projectId: input.projectId,
      status: run.status,
      releasedLeaseCount,
      nextAction: nextActionForBusinessDocsSnapshot(run.status, tasks),
    }
  })
}

export async function retryBusinessDocsRunTasks(
  db: DB,
  input: UnifiedRunRetryInput & { now?: () => Date },
): Promise<UnifiedRunRetryResult> {
  if (input.dryRun) return previewBusinessDocsRetry(db, input)

  const status = getBusinessDocsStatus(db, input)
  if (!status.ok) throw codeError(status.code, status.message)
  if (status.data.run.status === 'cancelled') throw codeError('RUNS_RUN_CANCELLED', 'Business docs generation run is cancelled.')

  const matchedTasks = selectBusinessDocsTasks(tasksForRun(db, input.runId), input)
  const resetTasks: UnifiedRunRetryResult['tasks'] = []
  const skippedTasks: UnifiedRunRetryResult['skippedTasks'] = []

  for (const task of matchedTasks) {
    const retried = retryBusinessDocsTask(db, {
      projectId: input.projectId,
      taskId: task.id,
      now: input.now,
    })
    if (!retried.ok) {
      skippedTasks.push({
        taskId: task.id,
        taskType: task.taskType,
        status: task.status,
        reason: retried.code === 'BUSINESS_DOCS_TASK_NOT_RETRYABLE' ? 'not_retryable_status' : retried.code,
      })
      continue
    }
    resetTasks.push({
      taskId: retried.data.task.id,
      taskType: task.taskType,
      previousStatus: retried.data.task.previousStatus,
      nextStatus: retried.data.task.status,
    })
  }

  return {
    runId: input.runId,
    kind: 'build_business_docs',
    projectId: input.projectId,
    matchedTaskCount: matchedTasks.length,
    resetTaskCount: resetTasks.length,
    skippedTaskCount: skippedTasks.length,
    dryRun: false,
    tasks: resetTasks,
    skippedTasks,
    nextAction: resetTasks.length > 0 ? { type: 'lease_tasks' } : normalizeBusinessNextAction(status.data.nextAction),
  }
}

function previewBusinessDocsRetry(
  db: DB,
  input: UnifiedRunRetryInput & { now?: () => Date },
): UnifiedRunRetryResult {
  const run = db.select().from(businessDocGenerationRuns)
    .where(eq(businessDocGenerationRuns.id, input.runId))
    .get()
  if (!run || run.projectId !== input.projectId) throw codeError('BUSINESS_DOCS_RUN_NOT_FOUND', 'Business docs generation run was not found for the selected project.')
  if (run.status === 'cancelled') throw codeError('RUNS_RUN_CANCELLED', 'Business docs generation run is cancelled.')

  const tasks = tasksForRun(db, input.runId)
  const matchedTasks = selectBusinessDocsTasks(tasks, input)
  const resetTasks: UnifiedRunRetryResult['tasks'] = []
  const skippedTasks: UnifiedRunRetryResult['skippedTasks'] = []

  for (const task of matchedTasks) {
    const retried = retryBusinessDocsTask(db, {
      projectId: input.projectId,
      taskId: task.id,
      now: input.now,
    })
    if (!retried.ok) {
      skippedTasks.push({
        taskId: task.id,
        taskType: task.taskType,
        status: task.status,
        reason: retried.code === 'BUSINESS_DOCS_TASK_NOT_RETRYABLE' ? 'not_retryable_status' : retried.code,
      })
      continue
    }
    resetTasks.push({
      taskId: retried.data.task.id,
      taskType: task.taskType,
      previousStatus: retried.data.task.previousStatus,
      nextStatus: retried.data.task.status,
    })
    rollbackDryRun(db, { run, task })
  }

  return {
    runId: input.runId,
    kind: 'build_business_docs',
    projectId: input.projectId,
    matchedTaskCount: matchedTasks.length,
    resetTaskCount: resetTasks.length,
    skippedTaskCount: skippedTasks.length,
    dryRun: true,
    tasks: resetTasks,
    skippedTasks,
    nextAction: nextActionForBusinessDocsSnapshot(run.status, tasks),
  }
}

function rollbackDryRun(
  db: Pick<DB, 'update'>,
  input: { run: BusinessDocGenerationRun; task: BusinessDocGenerationTask },
): void {
  db.update(businessDocGenerationTasks)
    .set({
      status: input.task.status,
      workerId: input.task.workerId,
      leaseToken: input.task.leaseToken,
      leaseExpiresAt: input.task.leaseExpiresAt,
      lastErrorJson: input.task.lastErrorJson,
      updatedAt: input.task.updatedAt,
    })
    .where(eq(businessDocGenerationTasks.id, input.task.id))
    .run()

  db.update(businessDocGenerationRuns)
    .set({
      status: input.run.status,
      finishedAt: input.run.finishedAt,
      updatedAt: input.run.updatedAt,
    })
    .where(eq(businessDocGenerationRuns.id, input.run.id))
    .run()
}

function tasksForRun(db: Pick<DB, 'select'>, runId: string): BusinessDocGenerationTask[] {
  return db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.runId, runId))
    .all()
}

function selectBusinessDocsTasks(
  tasks: BusinessDocGenerationTask[],
  input: UnifiedRunRetryInput,
): BusinessDocGenerationTask[] {
  return tasks.filter((task) => {
    if (task.projectId !== input.projectId) return false
    if (input.taskId && task.id !== input.taskId) return false
    if (input.taskType && task.taskType !== input.taskType) return false
    if (input.failed && task.status !== 'failed') return false
    if (input.repairRequested && task.status !== 'repair_requested') return false
    return true
  })
}

function countBusinessTaskStatuses(tasks: BusinessDocGenerationTask[]): UnifiedRunStatusResult['taskCountsByStatus'] {
  const counts: UnifiedRunStatusResult['taskCountsByStatus'] = { total: tasks.length }
  for (const task of tasks) {
    counts[task.status] = (counts[task.status] ?? 0) + 1
  }
  return counts
}

function nextActionForBusinessDocsSnapshot(
  runStatus: string,
  tasks: BusinessDocGenerationTask[],
): UnifiedRunNextAction {
  if (runStatus === 'cancelled') return { type: 'cancelled' }
  if (tasks.some((task) => task.status === 'repair_requested')) return { type: 'repair_task' }
  if (tasks.some((task) => task.status === 'failed')) return { type: 'retry_failed_tasks' }
  if (tasks.some((task) => task.status === 'pending' || task.status === 'expired')) return { type: 'lease_tasks' }
  return { type: 'done' }
}

function normalizeBusinessNextAction(action: BusinessDocsLifecycleNextAction): UnifiedRunNextAction {
  if (action.type === 'retry_failed') return { type: 'retry_failed_tasks' }
  if (action.type === 'repair_task') return { type: 'repair_task' }
  if (action.type === 'done' || action.type === 'cleanup_completed') return { type: 'done' }
  if (action.type === 'cancelled') return { type: 'cancelled' }
  return { type: 'lease_tasks' }
}

function codeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
