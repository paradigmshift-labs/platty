import { and, asc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DB } from '@/db/client.js'
import {
  businessDocContextBundles,
  businessDocContextPages,
  businessDocGenerationRuns,
  businessDocGenerationTasks,
  type BusinessDocContextBundle,
  type BusinessDocGenerationRun,
  type BusinessDocGenerationTask,
} from '@/db/schema/build_business_docs_generation.js'
import type {
  BusinessDocsContextBundleResult,
  BusinessDocsContextBundleServiceResult,
  BusinessDocsContextPageResult,
  BusinessDocsContextPageServiceResult,
  BusinessDocsHeartbeatResult,
  BusinessDocsHeartbeatServiceResult,
  BusinessDocsLeaseResult,
  BusinessDocsLeaseServiceResult,
  BusinessDocsLeasedTask,
} from './types.js'

const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000
const LEASEABLE_RUN_STATUSES = new Set(['running', 'repair_requested'])
const LEASEABLE_TASK_STATUSES = new Set(['pending', 'repair_requested'])
const DEPENDENCY_SUCCESS_STATUSES = new Set(['saved', 'proposal_created'])

interface LeaseInput {
  projectId: string
  runId: string
  workerId: string
  limit?: number
  leaseTtlMs?: number
  now?: () => Date
  makeLeaseToken?: () => string
}

interface HeartbeatInput {
  projectId: string
  taskId: string
  leaseToken: string
  leaseTtlMs?: number
  now?: () => Date
}

interface ContextBundleInput {
  contextHandle: string
  leaseToken: string
  now?: () => Date
}

interface ContextPageInput extends ContextBundleInput {
  pageToken: string
}

interface AuthorizedContext {
  run: BusinessDocGenerationRun
  task: BusinessDocGenerationTask
  bundle: BusinessDocContextBundle
}

type RuntimeReadDb = Pick<DB, 'select'>
type RuntimeLeaseDb = Pick<DB, 'select' | 'update'>

export function leaseBusinessDocsTasks(db: DB, input: LeaseInput): BusinessDocsLeaseServiceResult {
  const now = (input.now ?? (() => new Date()))()
  const nowIso = now.toISOString()
  const leaseTtlMs = input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS
  const makeLeaseToken = input.makeLeaseToken ?? nanoid
  const requested = input.limit ?? 1
  const expiresAt = new Date(now.getTime() + leaseTtlMs).toISOString()
  return db.transaction((tx): BusinessDocsLeaseServiceResult => {
    const run = tx.select().from(businessDocGenerationRuns)
      .where(eq(businessDocGenerationRuns.id, input.runId))
      .get()

    if (!run || run.projectId !== input.projectId) {
      return {
        ok: false,
        code: 'BUSINESS_DOCS_RUN_NOT_FOUND',
        message: 'Business docs generation run was not found for the selected project.',
      }
    }
    if (!LEASEABLE_RUN_STATUSES.has(run.status)) {
      return {
        ok: false,
        code: 'BUSINESS_DOCS_RUN_NOT_LEASEABLE',
        message: 'This business-docs run is not ready to assign more work. Check the run status before continuing.',
      }
    }

    const activeLeaseLimit = run.policyJson.approvedActiveLeases
    if (!Number.isInteger(requested) || requested < 1 || requested > activeLeaseLimit) {
      return {
        ok: false,
        code: 'BUSINESS_DOCS_INVALID_LIMIT',
        message: `Lease limit must be an integer from 1 to ${activeLeaseLimit}.`,
      }
    }

    recoverExpiredLeasesForLease(tx, run.id, nowIso)

    const activeLeasesBefore = countActiveLeases(tx, run.id, nowIso)
    const availableLeaseSlots = Math.max(0, activeLeaseLimit - activeLeasesBefore)
    const grantLimit = Math.min(requested, availableLeaseSlots)
    if (grantLimit === 0) {
      return {
        ok: true,
        data: emptyLeaseResult({
          run,
          workerId: input.workerId,
          requested,
          activeLeaseLimit,
          activeLeasesBefore,
          leaseTtlMs,
        }),
      }
    }

    const leaseableTasks = selectLeaseableTasks(tx, run.id).slice(0, grantLimit)
    if (leaseableTasks.length === 0) {
      return {
        ok: true,
        data: emptyLeaseResult({
          run,
          workerId: input.workerId,
          requested,
          activeLeaseLimit,
          activeLeasesBefore,
          leaseTtlMs,
        }),
      }
    }

    const tokenByTaskId = new Map<string, string>()
    for (const task of leaseableTasks) {
      const token = makeLeaseToken()
      if (tokenByTaskIdHasValue(tokenByTaskId, token)) {
        throw new Error(`Duplicate lease token generated for ${task.id}`)
      }
      tokenByTaskId.set(task.id, token)
    }

    const currentRun = tx.select().from(businessDocGenerationRuns)
      .where(eq(businessDocGenerationRuns.id, run.id))
      .get()
    if (!currentRun || currentRun.projectId !== input.projectId) {
      return {
        ok: false,
        code: 'BUSINESS_DOCS_RUN_NOT_FOUND',
        message: 'Business docs generation run was not found for the selected project.',
      }
    }
    if (!LEASEABLE_RUN_STATUSES.has(currentRun.status)) {
      return {
        ok: false,
        code: 'BUSINESS_DOCS_RUN_NOT_LEASEABLE',
        message: 'This business-docs run is not ready to assign more work. Check the run status before continuing.',
      }
    }

    for (const task of leaseableTasks) {
      const updateResult = tx.update(businessDocGenerationTasks)
        .set({
          status: 'leased',
          workerId: input.workerId,
          leaseToken: tokenByTaskId.get(task.id) ?? '',
          leaseExpiresAt: expiresAt,
          updatedAt: nowIso,
        })
        .where(and(
          eq(businessDocGenerationTasks.id, task.id),
          eq(businessDocGenerationTasks.runId, run.id),
          eq(businessDocGenerationTasks.status, task.status),
        ))
        .run() as { changes: number }
      if (updateResult.changes !== 1) {
        throw new Error(`Business docs task lease update lost race for ${task.id}`)
      }
    }

    return {
      ok: true,
      data: {
        run: {
          id: currentRun.id,
          projectId: currentRun.projectId,
          status: currentRun.status,
        },
        worker: {
          id: input.workerId,
        },
        lease: {
          requested,
          granted: leaseableTasks.length,
          activeLeaseLimit,
          activeLeasesBefore,
          leaseTtlMs,
        },
        tasks: leaseableTasks.map((task) => toLeasedTask(task, {
          leaseToken: tokenByTaskId.get(task.id) ?? '',
          leaseExpiresAt: expiresAt,
        })),
        nextAction: {
          type: 'read_context',
        },
      },
    }
  })
}

export function heartbeatBusinessDocsTask(db: DB, input: HeartbeatInput): BusinessDocsHeartbeatServiceResult {
  if (!input.leaseToken.trim()) {
    return {
      ok: false,
      code: 'BUSINESS_DOCS_LEASE_TOKEN_REQUIRED',
      message: 'A current task token is required. Get or resume the task before continuing.',
    }
  }

  const now = (input.now ?? (() => new Date()))()
  const nowIso = now.toISOString()
  const leaseTtlMs = input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS
  const task = db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.id, input.taskId))
    .get()

  if (!isCurrentLease(task, input.projectId, input.leaseToken, nowIso)) {
    return leaseConflict()
  }

  const expiresAt = new Date(now.getTime() + leaseTtlMs).toISOString()
  db.update(businessDocGenerationTasks)
    .set({
      leaseExpiresAt: expiresAt,
      updatedAt: nowIso,
    })
    .where(eq(businessDocGenerationTasks.id, task.id))
    .run()

  return {
    ok: true,
    data: {
      task: {
        id: task.id,
        runId: task.runId,
        status: 'leased',
        workerId: task.workerId ?? '',
        attemptNo: task.attemptNo,
        leaseExpiresAt: expiresAt,
        contextHandle: task.contextHandle ?? '',
      },
      lease: {
        leaseToken: input.leaseToken,
        leaseTtlMs,
      },
    } satisfies BusinessDocsHeartbeatResult,
  }
}

export function getBusinessDocsContextBundle(
  db: DB,
  input: ContextBundleInput,
): BusinessDocsContextBundleServiceResult {
  const authorized = authorizeContextRead(db, input)
  if (!authorized.ok) return authorized

  const pages = loadPages(db, authorized.data.bundle.contextHandle)
  return {
    ok: true,
    data: {
      run: summarizeRun(authorized.data.run),
      task: summarizeLeasedTask(authorized.data.task),
      manifest: authorized.data.bundle.manifestJson,
      pages: pages.map((page) => ({
        pageToken: page.pageToken,
        pageKind: page.pageKind,
        pageOrder: page.pageOrder,
        summary: page.summary,
        evidenceIds: page.evidenceIdsJson,
        contentHash: page.contentHash,
      })),
    } satisfies BusinessDocsContextBundleResult,
  }
}

export function getBusinessDocsContextPage(
  db: DB,
  input: ContextPageInput,
): BusinessDocsContextPageServiceResult {
  const authorized = authorizeContextRead(db, input)
  if (!authorized.ok) return authorized

  const page = db.select().from(businessDocContextPages)
    .where(eq(businessDocContextPages.contextHandle, authorized.data.bundle.contextHandle))
    .all()
    .find((candidate) => candidate.pageToken === input.pageToken)
  if (!page) {
    return {
      ok: false,
      code: 'BUSINESS_DOCS_CONTEXT_PAGE_NOT_FOUND',
      message: 'Business docs context page was not found.',
    }
  }

  return {
    ok: true,
    data: {
      run: summarizeRun(authorized.data.run),
      task: summarizeLeasedTask(authorized.data.task),
      page: {
        pageToken: page.pageToken,
        pageKind: page.pageKind,
        pageOrder: page.pageOrder,
        summary: page.summary,
        evidenceIds: page.evidenceIdsJson,
        contentHash: page.contentHash,
        content: page.contentJson,
      },
      manifest: {
        schemaVersion: authorized.data.bundle.manifestJson.schemaVersion,
        sourceCommit: authorized.data.bundle.manifestJson.sourceCommit,
        generatedAt: authorized.data.bundle.manifestJson.generatedAt,
        evidenceIdNamespace: authorized.data.bundle.manifestJson.evidenceIdNamespace,
      },
    } satisfies BusinessDocsContextPageResult,
  }
}

function selectLeaseableTasks(db: RuntimeReadDb, runId: string): Array<BusinessDocGenerationTask & { contextPageTokens: string[] }> {
  const tasks = db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.runId, runId))
    .orderBy(
      asc(businessDocGenerationTasks.createdAt),
      asc(businessDocGenerationTasks.taskType),
      asc(businessDocGenerationTasks.id),
    )
    .all()
  const bundles = db.select().from(businessDocContextBundles)
    .where(eq(businessDocContextBundles.runId, runId))
    .all()
  const bundleByTaskId = new Map(bundles.map((bundle) => [bundle.taskId, bundle]))
  const taskById = new Map(tasks.map((task) => [task.id, task]))

  return tasks.flatMap((task) => {
    if (!LEASEABLE_TASK_STATUSES.has(task.status)) return []
    if (!task.contextHandle) return []
    const bundle = bundleByTaskId.get(task.id)
    if (!bundle) return []
    if (bundle.manifestJson.dependencyPagesReady !== true) return []
    if (!dependenciesSucceeded(task.dependsOnTaskIdsJson, taskById)) return []
    return [{ ...task, contextPageTokens: bundle.manifestJson.pageTokens }]
  })
}

function dependenciesSucceeded(dependencyTaskIds: string[], taskById: Map<string, BusinessDocGenerationTask>): boolean {
  for (const dependencyTaskId of dependencyTaskIds) {
    const dependency = taskById.get(dependencyTaskId)
    if (!dependency || !DEPENDENCY_SUCCESS_STATUSES.has(dependency.status)) return false
  }
  return true
}

function countActiveLeases(db: RuntimeReadDb, runId: string, nowIso: string): number {
  return db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.runId, runId))
    .all()
    .filter((task) => task.status === 'leased' && task.leaseExpiresAt && task.leaseExpiresAt > nowIso)
    .length
}

function recoverExpiredLeasesForLease(db: RuntimeLeaseDb, runId: string, nowIso: string): number {
  const expiredTasks = db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.runId, runId))
    .all()
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

function emptyLeaseResult(input: {
  run: BusinessDocGenerationRun
  workerId: string
  requested: number
  activeLeaseLimit: number
  activeLeasesBefore: number
  leaseTtlMs: number
}): BusinessDocsLeaseResult {
  return {
    run: {
      id: input.run.id,
      projectId: input.run.projectId,
      status: input.run.status,
    },
    worker: {
      id: input.workerId,
    },
    lease: {
      requested: input.requested,
      granted: 0,
      activeLeaseLimit: input.activeLeaseLimit,
      activeLeasesBefore: input.activeLeasesBefore,
      leaseTtlMs: input.leaseTtlMs,
    },
    tasks: [],
    nextAction: {
      type: 'no_ready_tasks',
    },
  }
}

function toLeasedTask(
  task: BusinessDocGenerationTask & { contextPageTokens: string[] },
  lease: { leaseToken: string; leaseExpiresAt: string },
): BusinessDocsLeasedTask {
  return {
    id: task.id,
    runId: task.runId,
    taskType: task.taskType,
    documentType: task.documentType,
    scope: task.scope,
    scopeId: task.scopeId,
    epicId: task.epicId,
    attemptNo: task.attemptNo,
    leaseToken: lease.leaseToken,
    leaseExpiresAt: lease.leaseExpiresAt,
    contextHandle: task.contextHandle ?? '',
    contextPageTokens: task.contextPageTokens,
    dependsOnTaskIds: task.dependsOnTaskIdsJson,
  }
}

function authorizeContextRead(
  db: DB,
  input: ContextBundleInput,
): { ok: true; data: AuthorizedContext } | Exclude<BusinessDocsContextBundleServiceResult, { ok: true }> {
  if (!input.leaseToken.trim()) {
    return {
      ok: false,
      code: 'BUSINESS_DOCS_LEASE_TOKEN_REQUIRED',
      message: 'A current task token is required. Get or resume the task before continuing.',
    }
  }

  const nowIso = (input.now ?? (() => new Date()))().toISOString()
  const bundle = db.select().from(businessDocContextBundles)
    .where(eq(businessDocContextBundles.contextHandle, input.contextHandle))
    .get()
  if (!bundle) {
    return {
      ok: false,
      code: 'BUSINESS_DOCS_CONTEXT_NOT_FOUND',
      message: 'Business docs context was not found.',
    }
  }
  const task = db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.id, bundle.taskId))
    .get()
  const run = db.select().from(businessDocGenerationRuns)
    .where(eq(businessDocGenerationRuns.id, bundle.runId))
    .get()
  if (!task || !run) {
    return {
      ok: false,
      code: 'BUSINESS_DOCS_CONTEXT_NOT_FOUND',
      message: 'Business docs context was not found.',
    }
  }
  if (!isCurrentLease(task, task.projectId, input.leaseToken, nowIso)) return leaseConflict()

  return {
    ok: true,
    data: { run, task, bundle },
  }
}

function isCurrentLease(
  task: BusinessDocGenerationTask | undefined,
  projectId: string,
  leaseToken: string,
  nowIso: string,
): task is BusinessDocGenerationTask {
  return Boolean(
    task &&
    task.projectId === projectId &&
    task.status === 'leased' &&
    task.leaseToken === leaseToken &&
    task.leaseExpiresAt &&
    task.leaseExpiresAt > nowIso,
  )
}

function loadPages(db: DB, contextHandle: string) {
  return db.select().from(businessDocContextPages)
    .where(eq(businessDocContextPages.contextHandle, contextHandle))
    .orderBy(asc(businessDocContextPages.pageOrder))
    .all()
}

function summarizeRun(run: BusinessDocGenerationRun): BusinessDocsContextBundleResult['run'] {
  return {
    id: run.id,
    projectId: run.projectId,
    status: run.status,
  }
}

function summarizeLeasedTask(task: BusinessDocGenerationTask): BusinessDocsContextBundleResult['task'] {
  return {
    id: task.id,
    runId: task.runId,
    status: 'leased',
    taskType: task.taskType,
    documentType: task.documentType,
    scope: task.scope,
    scopeId: task.scopeId,
    attemptNo: task.attemptNo,
    leaseExpiresAt: task.leaseExpiresAt ?? '',
    contextHandle: task.contextHandle ?? '',
  }
}

function leaseConflict(): { ok: false; code: 'BUSINESS_DOCS_LEASE_CONFLICT'; message: string } {
  return {
    ok: false,
    code: 'BUSINESS_DOCS_LEASE_CONFLICT',
    message: 'This task is no longer assigned to this worker. Get the task again to continue with a fresh token.',
  }
}

function tokenByTaskIdHasValue(tokenByTaskId: Map<string, string>, value: string): boolean {
  for (const token of tokenByTaskId.values()) {
    if (token === value) return true
  }
  return false
}
