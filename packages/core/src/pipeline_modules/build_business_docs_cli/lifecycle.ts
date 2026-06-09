import { eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import {
  businessDocContextBundles,
  businessDocContextPages,
  businessDocGenerationRuns,
  businessDocGenerationTasks,
  type BusinessDocGenerationRun,
  type BusinessDocGenerationTask,
} from '@/db/schema/build_business_docs_generation.js'
import type {
  BusinessDocsCancelResult,
  BusinessDocsCancelServiceResult,
  BusinessDocsCleanupResult,
  BusinessDocsCleanupServiceResult,
  BusinessDocsGenerationRunStatus,
  BusinessDocsGenerationTaskStatus,
  BusinessDocsLifecycleNextAction,
  BusinessDocsLifecycleRunSummary,
  BusinessDocsResumeResult,
  BusinessDocsResumeServiceResult,
  BusinessDocsRetryResult,
  BusinessDocsRetryServiceResult,
  BusinessDocsStatusResult,
  BusinessDocsStatusServiceResult,
  BusinessDocsTaskStatusCounts,
} from './types.js'

const TASK_STATUSES = [
  'pending',
  'leased',
  'expired',
  'submitted',
  'saved',
  'proposal_created',
  'repair_requested',
  'blocked',
  'failed',
  'skipped',
] as const satisfies BusinessDocsGenerationTaskStatus[]

const SUCCESS_TASK_STATUSES = new Set<BusinessDocsGenerationTaskStatus>([
  'saved',
  'proposal_created',
  'skipped',
])
const RESUMABLE_RUN_STATUSES = new Set<BusinessDocsGenerationRunStatus>([
  'running',
  'repair_requested',
  'failed',
])
const CANCELLABLE_RUN_STATUSES = new Set<BusinessDocsGenerationRunStatus>([
  'running',
  'repair_requested',
  'failed',
])
const RETRYABLE_TASK_STATUSES = new Set<BusinessDocsGenerationTaskStatus>([
  'repair_requested',
  'failed',
  'expired',
])
const PRESERVED_CANCEL_TASK_STATUSES = new Set<BusinessDocsGenerationTaskStatus>([
  'saved',
  'proposal_created',
  'skipped',
])

type RuntimeDb = Pick<DB, 'select' | 'update' | 'delete'>
type RuntimeReadDb = Pick<DB, 'select'>

interface LifecycleInput {
  projectId: string
  runId: string
  now?: () => Date
}

interface RetryInput {
  projectId: string
  taskId: string
  now?: () => Date
}

interface ContextCounts {
  bundles: number
  pages: number
}

interface CleanupCounts {
  bundlesDeleted: number
  pagesDeleted: number
}

export function getBusinessDocsStatus(db: DB, input: LifecycleInput): BusinessDocsStatusServiceResult {
  const nowIso = (input.now ?? (() => new Date()))().toISOString()
  return db.transaction((tx): BusinessDocsStatusServiceResult => {
    const run = loadRun(tx, input.runId, input.projectId)
    if (!run) return runNotFound()

    const refreshed = refreshLifecycle(tx, run, nowIso)
    return {
      ok: true,
      data: buildStatusResult(tx, refreshed.run, refreshed.tasks, refreshed.expiredRecovered),
    }
  })
}

export function resumeBusinessDocsRun(db: DB, input: LifecycleInput): BusinessDocsResumeServiceResult {
  const nowIso = (input.now ?? (() => new Date()))().toISOString()
  return db.transaction((tx): BusinessDocsResumeServiceResult => {
    const run = loadRun(tx, input.runId, input.projectId)
    if (!run) return runNotFound()
    if (run.status === 'completed' || run.status === 'cancelled') {
      return {
        ok: false,
        code: 'BUSINESS_DOCS_RUN_NOT_RESUMABLE',
        message: 'Business docs generation run is not resumable.',
      }
    }

    const refreshed = refreshLifecycle(tx, run, nowIso)
    if (refreshed.run.status === 'completed') {
      return {
        ok: true,
        data: buildResumeResult(tx, refreshed.run, refreshed.tasks, refreshed.expiredRecovered),
      }
    }
    if (!RESUMABLE_RUN_STATUSES.has(refreshed.run.status)) {
      return {
        ok: false,
        code: 'BUSINESS_DOCS_RUN_NOT_RESUMABLE',
        message: 'Business docs generation run is not resumable.',
      }
    }

    const failedTasks = refreshed.tasks.filter((task) => task.status === 'failed')
    if (refreshed.run.status === 'failed' && failedTasks.length > 0) {
      tx.update(businessDocGenerationRuns)
        .set({
          status: 'running',
          finishedAt: null,
          updatedAt: nowIso,
        })
        .where(eq(businessDocGenerationRuns.id, refreshed.run.id))
        .run()
      return {
        ok: true,
        data: buildResumeResult(tx, {
          ...refreshed.run,
          status: 'running',
          finishedAt: null,
          updatedAt: nowIso,
        }, refreshed.tasks, refreshed.expiredRecovered),
      }
    }

    return {
      ok: true,
      data: buildResumeResult(tx, refreshed.run, refreshed.tasks, refreshed.expiredRecovered),
    }
  })
}

export function retryBusinessDocsTask(db: DB, input: RetryInput): BusinessDocsRetryServiceResult {
  const nowIso = (input.now ?? (() => new Date()))().toISOString()
  return db.transaction((tx): BusinessDocsRetryServiceResult => {
    const task = tx.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, input.taskId))
      .get()
    if (!task || task.projectId !== input.projectId) return taskNotFound()

    const run = loadRun(tx, task.runId, input.projectId)
    if (!run) return taskNotFound()
    if (!RETRYABLE_TASK_STATUSES.has(task.status)) {
      return {
        ok: false,
        code: 'BUSINESS_DOCS_TASK_NOT_RETRYABLE',
        message: 'Business docs task is not retryable.',
      }
    }

    tx.update(businessDocGenerationTasks)
      .set({
        status: 'pending',
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorJson: null,
        updatedAt: nowIso,
      })
      .where(eq(businessDocGenerationTasks.id, task.id))
      .run()
    tx.update(businessDocGenerationRuns)
      .set({
        status: 'running',
        finishedAt: null,
        updatedAt: nowIso,
      })
      .where(eq(businessDocGenerationRuns.id, run.id))
      .run()

    const resumedRun = {
      ...run,
      status: 'running',
      finishedAt: null,
      updatedAt: nowIso,
    } satisfies BusinessDocGenerationRun
    return {
      ok: true,
      data: {
        run: summarizeRun(resumedRun),
        task: {
          id: task.id,
          runId: task.runId,
          status: 'pending',
          previousStatus: task.status as 'repair_requested' | 'failed' | 'expired',
          attemptNo: task.attemptNo,
          contextHandle: task.contextHandle ?? '',
        },
        nextAction: { type: 'lease_tasks' },
      } satisfies BusinessDocsRetryResult,
    }
  })
}

export function cancelBusinessDocsRun(db: DB, input: LifecycleInput): BusinessDocsCancelServiceResult {
  const nowIso = (input.now ?? (() => new Date()))().toISOString()
  return db.transaction((tx): BusinessDocsCancelServiceResult => {
    const run = loadRun(tx, input.runId, input.projectId)
    if (!run) return runNotFound()
    if (run.status === 'completed' || run.status === 'cancelled') {
      return {
        ok: false,
        code: 'BUSINESS_DOCS_RUN_NOT_CANCELLABLE',
        message: 'Business docs generation run is not cancellable.',
      }
    }

    const refreshed = refreshLifecycle(tx, run, nowIso)
    if (!CANCELLABLE_RUN_STATUSES.has(refreshed.run.status)) {
      return {
        ok: false,
        code: 'BUSINESS_DOCS_RUN_NOT_CANCELLABLE',
        message: 'Business docs generation run is not cancellable.',
      }
    }

    const tasks = refreshed.tasks
    const unfinished = tasks.filter((task) => !PRESERVED_CANCEL_TASK_STATUSES.has(task.status))
    const activeLeasesCleared = unfinished.filter((task) => task.status === 'leased' && task.leaseToken).length
    for (const task of unfinished) {
      tx.update(businessDocGenerationTasks)
        .set({
          status: 'blocked',
          workerId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: nowIso,
        })
        .where(eq(businessDocGenerationTasks.id, task.id))
        .run()
    }

    tx.update(businessDocGenerationRuns)
      .set({
        status: 'cancelled',
        finishedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(eq(businessDocGenerationRuns.id, refreshed.run.id))
      .run()

    const cancelledRun = {
      ...refreshed.run,
      status: 'cancelled',
      finishedAt: nowIso,
      updatedAt: nowIso,
    } satisfies BusinessDocGenerationRun
    const contexts = countContexts(tx, refreshed.run.id)
    return {
      ok: true,
      data: {
        run: summarizeRun(cancelledRun),
        cancelled: {
          activeLeasesCleared,
          pendingTasksBlocked: unfinished.length,
          contextRetained: contexts.bundles > 0 || contexts.pages > 0,
        },
        nextAction: { type: 'cancelled' },
      } satisfies BusinessDocsCancelResult,
    }
  })
}

export function cleanupBusinessDocsRun(db: DB, input: LifecycleInput): BusinessDocsCleanupServiceResult {
  const nowIso = (input.now ?? (() => new Date()))().toISOString()
  return db.transaction((tx): BusinessDocsCleanupServiceResult => {
    const run = loadRun(tx, input.runId, input.projectId)
    if (!run) return runNotFound()
    if (run.status !== 'completed') {
      return {
        ok: false,
        code: 'BUSINESS_DOCS_RUN_NOT_CLEANABLE',
        message: 'Business docs generation run context can only be cleaned after completion.',
      }
    }

    const cleanup = cleanupCompletedContext(tx, run.id)
    tx.update(businessDocGenerationRuns)
      .set({ updatedAt: nowIso })
      .where(eq(businessDocGenerationRuns.id, run.id))
      .run()
    const updatedRun = {
      ...run,
      updatedAt: nowIso,
    } satisfies BusinessDocGenerationRun
    return {
      ok: true,
      data: {
        run: summarizeRun(updatedRun),
        cleanup: {
          ...cleanup,
          contextRetained: false,
        },
        nextAction: { type: 'done' },
      } satisfies BusinessDocsCleanupResult,
    }
  })
}

function refreshLifecycle(
  db: RuntimeDb,
  run: BusinessDocGenerationRun,
  nowIso: string,
): { run: BusinessDocGenerationRun; tasks: BusinessDocGenerationTask[]; expiredRecovered: number } {
  const expiredRecovered = recoverExpiredLeases(db, run.id, nowIso)
  let tasks = loadTasks(db, run.id)
  let currentRun = run
  if (run.status === 'cancelled') {
    return { run: currentRun, tasks, expiredRecovered }
  }

  const nextStatus = inferRunStatus(tasks)
  if (nextStatus === 'completed') {
    const finishedAt = run.finishedAt ?? nowIso
    db.update(businessDocGenerationRuns)
      .set({
        status: 'completed',
        finishedAt,
        updatedAt: nowIso,
      })
      .where(eq(businessDocGenerationRuns.id, run.id))
      .run()
    cleanupCompletedContext(db, run.id)
    currentRun = {
      ...run,
      status: 'completed',
      finishedAt,
      updatedAt: nowIso,
    }
  } else if (nextStatus !== run.status) {
    db.update(businessDocGenerationRuns)
      .set({
        status: nextStatus,
        finishedAt: nextStatus === 'failed' ? (run.finishedAt ?? nowIso) : null,
        updatedAt: nowIso,
      })
      .where(eq(businessDocGenerationRuns.id, run.id))
      .run()
    currentRun = {
      ...run,
      status: nextStatus,
      finishedAt: nextStatus === 'failed' ? (run.finishedAt ?? nowIso) : null,
      updatedAt: nowIso,
    }
  }

  tasks = loadTasks(db, run.id)
  return { run: currentRun, tasks, expiredRecovered }
}

function recoverExpiredLeases(db: RuntimeDb, runId: string, nowIso: string): number {
  const expiredTasks = loadTasks(db, runId)
    .filter((task) => task.status === 'leased' && task.leaseExpiresAt && task.leaseExpiresAt <= nowIso)
  for (const task of expiredTasks) {
    db.update(businessDocGenerationTasks)
      .set({
        status: 'pending',
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorJson: {
          code: 'LEASE_EXPIRED',
          leaseExpiresAt: task.leaseExpiresAt,
          recoveredAt: nowIso,
        },
        updatedAt: nowIso,
      })
      .where(eq(businessDocGenerationTasks.id, task.id))
      .run()
  }
  return expiredTasks.length
}

function inferRunStatus(tasks: BusinessDocGenerationTask[]): BusinessDocsGenerationRunStatus {
  if (tasks.length > 0 && tasks.every((task) => SUCCESS_TASK_STATUSES.has(task.status))) return 'completed'
  if (tasks.some((task) => task.status === 'repair_requested')) return 'repair_requested'
  if (
    tasks.some((task) => task.status === 'failed') &&
    !tasks.some((task) => ['pending', 'leased', 'repair_requested', 'expired', 'submitted'].includes(task.status))
  ) {
    return 'failed'
  }
  return 'running'
}

function buildStatusResult(
  db: RuntimeReadDb,
  run: BusinessDocGenerationRun,
  tasks: BusinessDocGenerationTask[],
  expiredRecovered: number,
): BusinessDocsStatusResult {
  const counts = countTaskStatuses(tasks)
  const contexts = countContexts(db, run.id)
  return {
    run: summarizeRun(run),
    tasks: {
      counts,
      activeLeases: countActiveLeases(tasks),
      expiredRecovered,
    },
    documents: {
      saved: counts.saved,
      proposals: counts.proposal_created,
      failed: counts.failed,
    },
    contexts: {
      ...contexts,
      cleaned: isContextCleaned(run, contexts),
    },
    recentEvents: buildRecentEvents(run, tasks),
    nextAction: nextActionFor(run, counts, contexts),
  }
}

function buildResumeResult(
  db: RuntimeReadDb,
  run: BusinessDocGenerationRun,
  tasks: BusinessDocGenerationTask[],
  expiredRecovered: number,
): BusinessDocsResumeResult {
  const counts = countTaskStatuses(tasks)
  return {
    run: summarizeRun(run),
    recovered: {
      expiredLeases: expiredRecovered,
      repairTasksReady: counts.repair_requested,
      failedTasksReady: counts.failed,
    },
    nextAction: nextActionFor(run, counts, countContexts(db, run.id)),
  }
}

function nextActionFor(
  run: BusinessDocGenerationRun,
  counts: BusinessDocsTaskStatusCounts,
  contexts: ContextCounts,
): BusinessDocsLifecycleNextAction {
  if (run.status === 'completed') {
    return contexts.bundles > 0 || contexts.pages > 0 ? { type: 'cleanup_completed' } : { type: 'done' }
  }
  if (run.status === 'cancelled') return { type: 'cancelled' }
  if (counts.repair_requested > 0) return { type: 'repair_task' }
  if (counts.failed > 0) return { type: 'retry_failed' }
  if (counts.pending > 0 || counts.expired > 0) return { type: 'lease_tasks' }
  return { type: 'done' }
}

function countTaskStatuses(tasks: BusinessDocGenerationTask[]): BusinessDocsTaskStatusCounts {
  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as BusinessDocsTaskStatusCounts
  counts.total = tasks.length
  for (const task of tasks) {
    counts[task.status] += 1
  }
  return counts
}

function countActiveLeases(tasks: BusinessDocGenerationTask[]): number {
  return tasks.filter((task) => task.status === 'leased' && task.leaseToken).length
}

function buildRecentEvents(
  run: BusinessDocGenerationRun,
  tasks: BusinessDocGenerationTask[],
): BusinessDocsStatusResult['recentEvents'] {
  const events: BusinessDocsStatusResult['recentEvents'] = [
    {
      type: 'run_created',
      at: run.createdAt,
    },
  ]
  if (run.finishedAt && run.status === 'completed') events.push({ type: 'run_completed', at: run.finishedAt })
  if (run.finishedAt && run.status === 'failed') events.push({ type: 'run_failed', at: run.finishedAt })
  if (run.finishedAt && run.status === 'cancelled') events.push({ type: 'run_cancelled', at: run.finishedAt })

  for (const task of tasks) {
    const type = eventTypeForTask(task.status)
    if (!type) continue
    events.push({
      type,
      taskId: task.id,
      taskType: task.taskType,
      at: task.updatedAt,
    })
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
}

function eventTypeForTask(
  status: BusinessDocsGenerationTaskStatus,
): BusinessDocsStatusResult['recentEvents'][number]['type'] | null {
  if (status === 'pending') return 'task_pending'
  if (status === 'leased') return 'task_leased'
  if (status === 'saved') return 'task_saved'
  if (status === 'proposal_created') return 'task_proposal_created'
  if (status === 'repair_requested') return 'task_repair_requested'
  if (status === 'failed') return 'task_failed'
  if (status === 'expired') return 'task_expired'
  return null
}

function cleanupCompletedContext(db: RuntimeDb, runId: string): CleanupCounts {
  const bundles = db.select().from(businessDocContextBundles)
    .where(eq(businessDocContextBundles.runId, runId))
    .all()
  let pagesDeleted = 0
  for (const bundle of bundles) {
    pagesDeleted += db.select().from(businessDocContextPages)
      .where(eq(businessDocContextPages.contextHandle, bundle.contextHandle))
      .all().length
    db.delete(businessDocContextPages)
      .where(eq(businessDocContextPages.contextHandle, bundle.contextHandle))
      .run()
  }
  db.delete(businessDocContextBundles)
    .where(eq(businessDocContextBundles.runId, runId))
    .run()
  return {
    bundlesDeleted: bundles.length,
    pagesDeleted,
  }
}

function countContexts(db: RuntimeReadDb, runId: string): ContextCounts {
  const bundles = db.select().from(businessDocContextBundles)
    .where(eq(businessDocContextBundles.runId, runId))
    .all()
  return {
    bundles: bundles.length,
    pages: bundles.reduce((total, bundle) => total + db.select().from(businessDocContextPages)
      .where(eq(businessDocContextPages.contextHandle, bundle.contextHandle))
      .all().length, 0),
  }
}

function isContextCleaned(run: BusinessDocGenerationRun, contexts: ContextCounts): boolean {
  return run.status === 'completed' && contexts.bundles === 0 && contexts.pages === 0
}

function loadRun(db: RuntimeReadDb, runId: string, projectId: string): BusinessDocGenerationRun | null {
  const run = db.select().from(businessDocGenerationRuns)
    .where(eq(businessDocGenerationRuns.id, runId))
    .get()
  return run && run.projectId === projectId ? run : null
}

function loadTasks(db: RuntimeReadDb, runId: string): BusinessDocGenerationTask[] {
  return db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.runId, runId))
    .all()
}

function summarizeRun(run: BusinessDocGenerationRun): BusinessDocsLifecycleRunSummary {
  return {
    id: run.id,
    projectId: run.projectId,
    status: run.status,
    sourceCommit: run.sourceCommit,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
  }
}

function runNotFound(): { ok: false; code: 'BUSINESS_DOCS_RUN_NOT_FOUND'; message: string } {
  return {
    ok: false,
    code: 'BUSINESS_DOCS_RUN_NOT_FOUND',
    message: 'Business docs generation run was not found for the selected project.',
  }
}

function taskNotFound(): { ok: false; code: 'BUSINESS_DOCS_TASK_NOT_FOUND'; message: string } {
  return {
    ok: false,
    code: 'BUSINESS_DOCS_TASK_NOT_FOUND',
    message: 'Business docs task was not found for the selected project.',
  }
}
