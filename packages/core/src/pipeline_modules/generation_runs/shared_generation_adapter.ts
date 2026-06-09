import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { DB } from '@/db/client.js'
import {
  generationEvents,
  generationRuns,
  generationTasks,
  type GenerationRun,
  type GenerationTaskKind,
  type GenerationTask,
  type GenerationTaskStatus,
} from '@/db/schema/build_docs.js'
import { createSharedGenerationLeaseEngine } from './lease_engine.js'
import type {
  UnifiedGenerationRunKind,
  UnifiedRunNextAction,
  UnifiedRunReleaseLeasesResult,
  UnifiedRunResumeResult,
  UnifiedRunRetryInput,
  UnifiedRunRetryResult,
  UnifiedRunStatusResult,
  UnifiedTaskCountKey,
} from './types.js'

const RETRYABLE_SHARED_TASK_STATUSES = new Set<GenerationTaskStatus>(['pending', 'leased', 'expired', 'failed', 'repair_requested'])
const SUCCESS_SHARED_TASK_STATUSES = new Set<GenerationTaskStatus>(['saved', 'completed'])
const LEASEABLE_SHARED_TASK_STATUSES = new Set<GenerationTaskStatus>(['pending', 'expired'])
const SHARED_TASK_KINDS = new Set<GenerationTaskKind>([
  'api_spec',
  'screen_spec',
  'event_spec',
  'schedule_spec',
  'taxonomy_candidate',
  'taxonomy_consolidation',
  'document_assignment',
  'cross_domain_link',
])

type SharedRunKind = Extract<UnifiedGenerationRunKind, 'build_docs' | 'build_epics'>
type SharedDb = Pick<DB, 'select' | 'update'>
type SharedRecoveryDb = Pick<DB, 'select' | 'update' | 'insert'>

interface SharedRunInput {
  kind: SharedRunKind
  projectId: string
  runId: string
}

interface SharedRetryOptions {
  beforeReset?: (
    db: SharedDb,
    input: {
      run: GenerationRun
      tasks: GenerationTask[]
      matchedTasks: GenerationTask[]
      retryableMatchedTasks: GenerationTask[]
    },
  ) => void
}

export async function statusForSharedGenerationRun(
  db: DB,
  input: SharedRunInput,
): Promise<UnifiedRunStatusResult> {
  return db.transaction((tx): UnifiedRunStatusResult => {
    const run = requireSharedRun(tx, input)
    const now = timestamp()
    const staleRecovered = recoverSharedStaleLeases(tx, run.id, now)
    const tasks = tasksForRun(tx, run.id)

    return {
      runId: run.id,
      kind: input.kind,
      projectId: run.projectId,
      status: run.status,
      taskCountsByStatus: countByStatus(tasks),
      nextAction: nextActionForShared(run, tasks),
      stage: run.stage,
      recovered: {
        staleLeases: staleRecovered,
      },
    }
  })
}

export async function resumeSharedGenerationRun(
  db: DB,
  input: SharedRunInput,
): Promise<UnifiedRunResumeResult> {
  return db.transaction((tx): UnifiedRunResumeResult => {
    const run = requireSharedRun(tx, input)
    if (run.status === 'cancelled') throw codeError('RUNS_RUN_CANCELLED', 'Generation run is cancelled.')

    const now = timestamp()
    const staleRecovered = recoverSharedStaleLeases(tx, run.id, now)
    const tasks = tasksForRun(tx, run.id)

    let expiredRecovered = 0
    for (const task of tasks) {
      if (task.status !== 'expired') continue
      expiredRecovered += 1
      tx.update(generationTasks)
        .set({
          status: 'pending',
          leaseToken: null,
          leasedBy: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(generationTasks.id, task.id))
        .run()
    }

    const refreshedTasks = expiredRecovered > 0 ? tasksForRun(tx, run.id) : tasks
    const shouldReopenRun =
      (run.status === 'failed' || run.status === 'completed') &&
      refreshedTasks.some((task) => task.status === 'repair_requested' || task.status === 'pending')

    const refreshedRun = shouldReopenRun
      ? reopenRun(tx, run, now)
      : run

    return {
      runId: refreshedRun.id,
      kind: input.kind,
      projectId: refreshedRun.projectId,
      status: refreshedRun.status,
      taskCountsByStatus: countByStatus(refreshedTasks),
      nextAction: nextActionForShared(refreshedRun, refreshedTasks),
      stage: refreshedRun.stage,
      recovered: {
        staleLeases: staleRecovered,
        expiredLeases: expiredRecovered,
        repairTasksReady: refreshedTasks.filter((task) => task.status === 'repair_requested').length,
        failedTasksReady: refreshedTasks.filter((task) => task.status === 'failed').length,
      },
    }
  })
}

export async function releaseSharedGenerationLeases(
  db: DB,
  input: SharedRunInput & { reason?: string },
): Promise<UnifiedRunReleaseLeasesResult> {
  const run = requireSharedRun(db, input)
  const released = createSharedGenerationLeaseEngine({
    db,
    stage: input.kind,
  }).releaseActiveLeases(input.runId, input.reason)
  const tasks = tasksForRun(db, input.runId)

  return {
    runId: input.runId,
    kind: input.kind,
    projectId: input.projectId,
    status: released.runStatus as UnifiedRunReleaseLeasesResult['status'],
    releasedLeaseCount: released.releasedLeaseCount,
    nextAction: nextActionForShared(run, tasks),
  }
}

export async function retrySharedGenerationTasks(
  db: DB,
  input: UnifiedRunRetryInput & { kind: SharedRunKind },
  options: SharedRetryOptions = {},
): Promise<UnifiedRunRetryResult> {
  return db.transaction((tx): UnifiedRunRetryResult => {
    const run = requireSharedRun(tx, input)
    if (run.status === 'cancelled') throw codeError('RUNS_RUN_CANCELLED', 'Generation run is cancelled.')

    const tasks = tasksForRun(tx, run.id)
    const matchedTasks = selectSharedTasks(tasks, input)
    const retryableMatchedTasks = matchedTasks.filter((task) => RETRYABLE_SHARED_TASK_STATUSES.has(task.status))
    options.beforeReset?.(tx, { run, tasks, matchedTasks, retryableMatchedTasks })
    const now = timestamp()
    const resetTasks: UnifiedRunRetryResult['tasks'] = []
    const skippedTasks: UnifiedRunRetryResult['skippedTasks'] = []

    for (const task of matchedTasks) {
      if (!RETRYABLE_SHARED_TASK_STATUSES.has(task.status)) {
        skippedTasks.push({
          taskId: task.id,
          taskType: task.documentType,
          status: task.status,
          reason: 'not_retryable_status',
        })
        continue
      }

      const nextStatus = nextRetryStatus(task)
      resetTasks.push({
        taskId: task.id,
        taskType: task.documentType,
        previousStatus: task.status,
        nextStatus,
      })

      if (input.dryRun) continue

      tx.update(generationTasks)
        .set({
          status: nextStatus,
          leaseToken: null,
          leasedBy: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(generationTasks.id, task.id))
        .run()
    }

    const hasResets = resetTasks.length > 0
    const finalRun = hasResets && !input.dryRun
      ? reopenRun(tx, run, now)
      : run
    const finalTasks = tasksForRun(tx, run.id)

    return {
      runId: run.id,
      kind: input.kind,
      projectId: run.projectId,
      matchedTaskCount: matchedTasks.length,
      resetTaskCount: resetTasks.length,
      skippedTaskCount: skippedTasks.length,
      dryRun: Boolean(input.dryRun),
      tasks: resetTasks,
      skippedTasks,
      nextAction: nextActionForShared(finalRun, finalTasks),
    }
  })
}

function requireSharedRun(db: SharedDb, input: SharedRunInput): GenerationRun {
  const run = db.select().from(generationRuns)
    .where(and(
      eq(generationRuns.id, input.runId),
      eq(generationRuns.projectId, input.projectId),
    ))
    .get()

  if (!run) throw codeError('RUN_NOT_FOUND', 'Generation run not found.')
  if (run.stage !== input.kind) throw codeError('RUN_STAGE_MISMATCH', 'Generation run stage mismatch.')
  return run
}

function tasksForRun(db: SharedDb, runId: string): GenerationTask[] {
  return db.select().from(generationTasks).where(eq(generationTasks.runId, runId)).all()
}

function selectSharedTasks(
  tasks: GenerationTask[],
  input: UnifiedRunRetryInput,
): GenerationTask[] {
  if (input.taskType && !isSharedTaskKind(input.taskType)) return []

  return tasks.filter((task) => {
    if (input.taskId && task.id !== input.taskId) return false
    if (input.taskType && task.documentType !== input.taskType) return false
    if (input.failed && task.status !== 'failed') return false
    if (input.repairRequested && task.status !== 'repair_requested') return false
    return true
  })
}

function nextRetryStatus(task: GenerationTask): GenerationTaskStatus {
  if (task.status === 'repair_requested') return 'repair_requested'
  if (task.status !== 'failed') return 'pending'
  return hasUsefulValidationErrors(task) ? 'repair_requested' : 'pending'
}

function hasUsefulValidationErrors(task: GenerationTask): boolean {
  return Array.isArray(task.lastValidationErrors) && task.lastValidationErrors.length > 0
}

function countByStatus(tasks: GenerationTask[]): Partial<Record<UnifiedTaskCountKey, number>> {
  const counts: Partial<Record<UnifiedTaskCountKey, number>> = { total: tasks.length }
  for (const task of tasks) {
    counts[task.status] = (counts[task.status] ?? 0) + 1
  }
  return counts
}

function nextActionForShared(run: GenerationRun, tasks: GenerationTask[]): UnifiedRunNextAction {
  if (run.status === 'cancelled') return { type: 'cancelled' }
  if (tasks.some((task) => task.status === 'repair_requested')) return { type: 'repair_task' }
  if (tasks.some((task) => LEASEABLE_SHARED_TASK_STATUSES.has(task.status))) return { type: 'lease_tasks' }
  if (tasks.some((task) => task.status === 'failed')) return { type: 'retry_failed_tasks' }
  if (tasks.length > 0 && tasks.every((task) => SUCCESS_SHARED_TASK_STATUSES.has(task.status))) return { type: 'done' }
  if (run.status === 'completed') return { type: 'done' }
  return { type: 'lease_tasks' }
}

function recoverSharedStaleLeases(db: SharedRecoveryDb, runId: string, now: string): number {
  const staleTasks = tasksForRun(db, runId)
    .filter((task) => task.status === 'leased' && task.leaseExpiresAt && task.leaseExpiresAt <= now)

  let recovered = 0
  for (const task of staleTasks) {
    const leaseToken = task.leaseToken
    const leaseExpiresAt = task.leaseExpiresAt
    if (!leaseExpiresAt) continue
    const updateResult = db.update(generationTasks)
      .set({
        status: 'expired',
        leaseToken: null,
        leasedBy: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(and(
        eq(generationTasks.id, task.id),
        eq(generationTasks.status, 'leased'),
        eq(generationTasks.leaseExpiresAt, leaseExpiresAt),
      ))
      .run() as { changes: number }
    if (updateResult.changes !== 1) continue
    recovered += 1

    db.insert(generationEvents).values({
      id: `event:${randomUUID()}`,
      runId,
      taskId: task.id,
      eventType: 'task_expired',
      payloadJson: {
        reason: 'lease_ttl_expired_recovered',
        previous_status: 'leased',
        next_status: 'expired',
        lease_expires_at: leaseExpiresAt,
        recovered_at: now,
      },
      createdAt: now,
    }).run()
  }

  return recovered
}

function reopenRun(db: SharedDb, run: GenerationRun, now: string): GenerationRun {
  db.update(generationRuns)
    .set({
      status: 'running',
      finishedAt: null,
      updatedAt: now,
    })
    .where(eq(generationRuns.id, run.id))
    .run()

  return {
    ...run,
    status: 'running',
    finishedAt: null,
    updatedAt: now,
  }
}

function codeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

function isSharedTaskKind(taskType: UnifiedRunRetryInput['taskType']): taskType is GenerationTaskKind {
  return taskType !== undefined && SHARED_TASK_KINDS.has(taskType as GenerationTaskKind)
}

function timestamp(): string {
  return new Date().toISOString()
}
