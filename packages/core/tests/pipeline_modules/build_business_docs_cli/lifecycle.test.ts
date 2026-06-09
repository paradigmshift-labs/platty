import { and, count, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../server/helpers.js'
import { documents } from '../../../src/db/schema/build_docs.js'
import { epicDocumentLinks } from '../../../src/db/schema/build_epics.js'
import { epics, projects } from '../../../src/db/schema/core.js'
import {
  businessDocContextBundles,
  businessDocContextPages,
  businessDocGenerationRuns,
  businessDocGenerationTasks,
} from '../../../src/db/schema/build_business_docs_generation.js'
import { startBusinessDocsGeneration } from '../../../src/pipeline_modules/build_business_docs_cli/start.js'
import { getBusinessDocsContextBundle, leaseBusinessDocsTasks } from '../../../src/pipeline_modules/build_business_docs_cli/lease.js'
import { submitBusinessDocsTask } from '../../../src/pipeline_modules/build_business_docs_cli/submit.js'
import {
  cancelBusinessDocsRun,
  cleanupBusinessDocsRun,
  getBusinessDocsStatus,
  resumeBusinessDocsRun,
  retryBusinessDocsTask,
} from '../../../src/pipeline_modules/build_business_docs_cli/lifecycle.js'
import type {
  BusinessDocsLeasedTask,
  BusinessDocsStatusResult,
  BusinessDocsSubmittedDocument,
} from '../../../src/pipeline_modules/build_business_docs_cli/types.js'

const projectId = 'project:platty'
const now = '2026-06-04T00:00:00.000Z'

type TestDb = ReturnType<typeof createTestDb>

describe('build_business_docs_cli lifecycle status retry resume cancel cleanup', () => {
  it('reports status and recovers expired leases to pending', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    db.update(businessDocGenerationTasks)
      .set({ leaseExpiresAt: '2026-06-03T23:59:00.000Z' })
      .where(eq(businessDocGenerationTasks.id, task.id))
      .run()

    const status = mustStatus(getBusinessDocsStatus(db, {
      projectId,
      runId,
      now: fixedNow,
    }))

    expect(status).toMatchObject({
      run: {
        id: runId,
        status: 'running',
        sourceCommit: 'unknown',
      },
      tasks: {
        activeLeases: expect.any(Number),
        expiredRecovered: 1,
      },
      documents: {
        saved: 0,
        proposals: 0,
        failed: 0,
      },
      nextAction: {
        type: 'lease_tasks',
      },
    })
    expect(status.tasks.counts.pending).toBeGreaterThan(0)
    expect(Object.keys(status.tasks).sort()).toEqual(['activeLeases', 'counts', 'expiredRecovered'])
    expect(status.contexts.bundles).toBeGreaterThan(0)
    expect(status.recentEvents.length).toBeGreaterThan(0)
    expect(status.recentEvents[0]).toMatchObject({
      type: expect.any(String),
      at: expect.any(String),
    })

    const recovered = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, task.id))
      .get()
    expect(recovered).toMatchObject({
      status: 'pending',
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    })
    expect(recovered?.lastErrorJson).toMatchObject({ code: 'LEASE_EXPIRED' })
  })

  it('marks all-success runs completed and deletes context artifacts', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    markAllTasks(db, runId, 'saved')
    expect(countContextBundles(db, runId)).toBeGreaterThan(0)
    expect(countContextPages(db, runId)).toBeGreaterThan(0)

    const status = mustStatus(getBusinessDocsStatus(db, {
      projectId,
      runId,
      now: fixedNow,
    }))

    expect(status).toMatchObject({
      run: {
        status: 'completed',
        finishedAt: now,
      },
      contexts: {
        bundles: 0,
        pages: 0,
        cleaned: true,
      },
      nextAction: {
        type: 'done',
      },
    })
    expect(countContextBundles(db, runId)).toBe(0)
    expect(countContextPages(db, runId)).toBe(0)
  })

  it('keeps repair and failed context artifacts in status', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    mustSubmitRepair(db, task)

    const status = mustStatus(getBusinessDocsStatus(db, {
      projectId,
      runId,
      now: fixedNow,
    }))

    expect(status.run.status).toBe('repair_requested')
    expect(status.contexts.bundles).toBeGreaterThan(0)
    expect(status.contexts.pages).toBeGreaterThan(0)
    expect(status.contexts.cleaned).toBe(false)
    expect(status.nextAction.type).toBe('repair_task')
  })

  it('resumes recoverable runs without silently retrying failed tasks and rejects terminal runs', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    db.update(businessDocGenerationTasks)
      .set({
        status: 'failed',
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorJson: { code: 'VALIDATION_FAILED' },
      })
      .where(eq(businessDocGenerationTasks.id, task.id))
      .run()
    db.update(businessDocGenerationRuns)
      .set({ status: 'failed', updatedAt: now })
      .where(eq(businessDocGenerationRuns.id, runId))
      .run()

    const resumed = resumeBusinessDocsRun(db, {
      projectId,
      runId,
      now: fixedNow,
    })
    expect(resumed).toMatchObject({
      ok: true,
      data: {
        run: {
          status: 'running',
        },
        recovered: {
          repairTasksReady: 0,
          failedTasksReady: 1,
        },
        nextAction: {
          type: 'retry_failed',
        },
      },
    })
    expect(db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, task.id))
      .get()).toMatchObject({
      status: 'failed',
      lastErrorJson: { code: 'VALIDATION_FAILED' },
    })

    markAllTasks(db, runId, 'saved')
    mustStatus(getBusinessDocsStatus(db, { projectId, runId, now: fixedNow }))
    expect(resumeBusinessDocsRun(db, {
      projectId,
      runId,
      now: fixedNow,
    })).toMatchObject({
      ok: false,
      code: 'BUSINESS_DOCS_RUN_NOT_RESUMABLE',
    })
  })

  it('resume observes successful non-terminal runs as completed and cleans context', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    markAllTasks(db, runId, 'saved')
    expect(countContextBundles(db, runId)).toBeGreaterThan(0)

    const resumed = resumeBusinessDocsRun(db, {
      projectId,
      runId,
      now: fixedNow,
    })

    expect(resumed).toMatchObject({
      ok: true,
      data: {
        run: {
          status: 'completed',
          finishedAt: now,
        },
        recovered: {
          repairTasksReady: 0,
          failedTasksReady: 0,
        },
        nextAction: {
          type: 'done',
        },
      },
    })
    expect(countContextBundles(db, runId)).toBe(0)
    expect(countContextPages(db, runId)).toBe(0)
  })

  it('retries repair and failed tasks while preserving validation context', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    mustSubmitRepair(db, task)

    const retry = retryBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      now: fixedNow,
    })

    expect(retry).toMatchObject({
      ok: true,
      data: {
        task: {
          id: task.id,
          status: 'pending',
          previousStatus: 'repair_requested',
          contextHandle: task.contextHandle,
        },
        run: {
          status: 'running',
        },
      },
    })
    expect(db.select().from(businessDocContextPages)
      .where(and(
        eq(businessDocContextPages.contextHandle, task.contextHandle),
        eq(businessDocContextPages.pageToken, 'validation_errors'),
      ))
      .get()).toBeTruthy()

    const retried = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, task.id))
      .get()
    expect(retried).toMatchObject({
      status: 'pending',
      leaseToken: null,
      workerId: null,
      leaseExpiresAt: null,
    })
    expect(retried?.validationErrors?.length).toBeGreaterThan(0)
  })

  it('rejects retry for saved, proposal, and leased tasks', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const leased = leaseOne(db, runId, 'business_rules')
    expect(retryBusinessDocsTask(db, {
      projectId,
      taskId: leased.id,
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_TASK_NOT_RETRYABLE' })

    db.update(businessDocGenerationTasks)
      .set({ status: 'saved', updatedAt: now })
      .where(eq(businessDocGenerationTasks.id, leased.id))
      .run()
    expect(retryBusinessDocsTask(db, {
      projectId,
      taskId: leased.id,
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_TASK_NOT_RETRYABLE' })

    db.update(businessDocGenerationTasks)
      .set({ status: 'proposal_created', updatedAt: now })
      .where(eq(businessDocGenerationTasks.id, leased.id))
      .run()
    expect(retryBusinessDocsTask(db, {
      projectId,
      taskId: leased.id,
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_TASK_NOT_RETRYABLE' })
  })

  it('cancels a run, clears active leases, blocks unfinished tasks, and retains context', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const leased = leaseOne(db, runId, 'business_rules')
    db.update(businessDocGenerationTasks)
      .set({ status: 'saved', updatedAt: now })
      .where(eq(businessDocGenerationTasks.taskType, 'system_design'))
      .run()
    const bundlesBefore = countContextBundles(db, runId)

    const cancelled = cancelBusinessDocsRun(db, {
      projectId,
      runId,
      now: fixedNow,
    })

    expect(cancelled).toMatchObject({
      ok: true,
      data: {
        run: {
          status: 'cancelled',
          finishedAt: now,
        },
        cancelled: {
          pendingTasksBlocked: expect.any(Number),
          contextRetained: true,
        },
        nextAction: {
          type: 'cancelled',
        },
      },
    })
    expect(cancelled.ok ? cancelled.data.cancelled.activeLeasesCleared : 0).toBeGreaterThan(0)
    expect(db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, leased.id))
      .get()).toMatchObject({
      status: 'blocked',
      leaseToken: null,
      workerId: null,
      leaseExpiresAt: null,
    })
    expect(db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.taskType, 'system_design'))
      .get()?.status).toBe('saved')
    expect(countContextBundles(db, runId)).toBe(bundlesBefore)
    expect(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'after-cancel',
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_RUN_NOT_LEASEABLE' })
  })

  it('cancel observes successful non-terminal runs as completed instead of cancelling', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    markAllTasks(db, runId, 'saved')

    expect(cancelBusinessDocsRun(db, {
      projectId,
      runId,
      now: fixedNow,
    })).toMatchObject({
      ok: false,
      code: 'BUSINESS_DOCS_RUN_NOT_CANCELLABLE',
    })
    expect(db.select().from(businessDocGenerationRuns)
      .where(eq(businessDocGenerationRuns.id, runId))
      .get()).toMatchObject({
      status: 'completed',
      finishedAt: now,
    })
    expect(countContextBundles(db, runId)).toBe(0)
    expect(countContextPages(db, runId)).toBe(0)
  })

  it('cleans completed context idempotently and rejects non-completed cleanup', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    expect(cleanupBusinessDocsRun(db, {
      projectId,
      runId,
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_RUN_NOT_CLEANABLE' })

    markAllTasks(db, runId, 'saved')
    mustStatus(getBusinessDocsStatus(db, { projectId, runId, now: fixedNow }))

    const cleanup = cleanupBusinessDocsRun(db, {
      projectId,
      runId,
      now: fixedNow,
    })
    expect(cleanup).toMatchObject({
      ok: true,
      data: {
        cleanup: {
          bundlesDeleted: 0,
          pagesDeleted: 0,
          contextRetained: false,
        },
      },
    })

    const repeat = cleanupBusinessDocsRun(db, {
      projectId,
      runId,
      now: fixedNow,
    })
    expect(repeat).toMatchObject({
      ok: true,
      data: {
        cleanup: {
          bundlesDeleted: 0,
          pagesDeleted: 0,
        },
      },
    })
  })
})

function createRunnableProject(): TestDb {
  const db = createTestDb()
  seedProject(db)
  seedEpic(db, { id: 'epic:orders' })
  seedLowerDocument(db, { id: 'doc:orders-api', type: 'api_spec' })
  linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:orders-api', documentType: 'api_spec' })
  return db
}

function startRun(db: TestDb): string {
  const result = startBusinessDocsGeneration(db, {
    projectId,
    now: fixedNow,
    makeId: makeSequentialIds('start'),
  })
  if (!result.ok) throw new Error(`Expected start ok, got ${result.code}`)
  return result.data.run.id
}

function leaseOne(db: TestDb, runId: string, taskType: string): BusinessDocsLeasedTask {
  const result = leaseBusinessDocsTasks(db, {
    projectId,
    runId,
    workerId: `worker:${taskType}`,
    limit: 8,
    leaseTtlMs: 15 * 60 * 1000,
    now: fixedNow,
    makeLeaseToken: makeSequentialIds(`lease:${taskType}`),
  })
  if (!result.ok) throw new Error(`Expected lease ok, got ${result.code}`)
  const task = result.data.tasks.find((candidate) => candidate.taskType === taskType)
  if (!task) throw new Error(`Expected leased ${taskType}`)
  return task
}

function mustSubmitRepair(db: TestDb, task: BusinessDocsLeasedTask): void {
  const result = submitBusinessDocsTask(db, {
    projectId,
    taskId: task.id,
    leaseToken: task.leaseToken,
    attemptNo: task.attemptNo,
    document: {
      ...validDocumentFor(db, task),
      evidenceIds: ['invented:evidence'],
    },
    now: fixedNow,
    makeId: makeSequentialIds('repair'),
  })
  if (!result.ok) throw new Error(`Expected repair submit ok, got ${result.code}`)
  if (result.data.task.status !== 'repair_requested') {
    throw new Error(`Expected repair_requested, got ${result.data.task.status}`)
  }
}

function validDocumentFor(db: TestDb, task: BusinessDocsLeasedTask): BusinessDocsSubmittedDocument {
  const evidenceIds = allowedEvidenceIds(db, task)
  return {
    schemaVersion: 'business-doc.v1',
    documentType: task.documentType,
    scope: task.scope,
    scopeId: task.scopeId,
    title: `${task.taskType} title`,
    summary: `${task.taskType} summary`,
    content: {
      taskType: task.taskType,
    },
    evidenceIds: evidenceIds.slice(0, 1),
  }
}

function allowedEvidenceIds(db: TestDb, task: BusinessDocsLeasedTask): string[] {
  const result = getBusinessDocsContextBundle(db, {
    contextHandle: task.contextHandle,
    leaseToken: task.leaseToken,
    now: fixedNow,
  })
  if (!result.ok) throw new Error(`Expected context ok, got ${result.code}`)
  return result.data.pages.flatMap((page) => page.evidenceIds)
}

function mustStatus(result: { ok: true; data: BusinessDocsStatusResult } | { ok: false; code: string }): BusinessDocsStatusResult {
  if (!result.ok) throw new Error(`Expected status ok, got ${result.code}`)
  return result.data
}

function markAllTasks(
  db: TestDb,
  runId: string,
  status: 'saved' | 'proposal_created' | 'skipped',
): void {
  db.update(businessDocGenerationTasks)
    .set({ status, updatedAt: now })
    .where(eq(businessDocGenerationTasks.runId, runId))
    .run()
}

function countContextBundles(db: TestDb, runId: string): number {
  return Number(db.select({ value: count() }).from(businessDocContextBundles)
    .where(eq(businessDocContextBundles.runId, runId))
    .get()?.value ?? 0)
}

function countContextPages(db: TestDb, runId: string): number {
  const bundles = db.select().from(businessDocContextBundles)
    .where(eq(businessDocContextBundles.runId, runId))
    .all()
  return bundles.reduce((total, bundle) => total + Number(db.select({ value: count() }).from(businessDocContextPages)
    .where(eq(businessDocContextPages.contextHandle, bundle.contextHandle))
    .get()?.value ?? 0), 0)
}

function fixedNow(): Date {
  return new Date(now)
}

function makeSequentialIds(prefix: string): () => string {
  let next = 0
  return () => `${prefix}:${++next}`
}

function seedProject(db: TestDb): void {
  db.insert(projects).values({
    id: projectId,
    name: 'Platty',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedEpic(
  db: TestDb,
  overrides: { id: string; confirmedAt?: string | null },
): void {
  db.insert(epics).values({
    id: overrides.id,
    projectId,
    name: overrides.id.replace('epic:', ''),
    abbr: 'EP',
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: overrides.confirmedAt === undefined ? now : overrides.confirmedAt,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedLowerDocument(
  db: TestDb,
  input: {
    id: string
    type: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
  },
): void {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: 'technical',
    scope: input.type,
    scopeId: input.id,
    status: 'active',
    validity: 'fresh',
    summary: input.id,
    content: { id: input.id },
    rawLlmOutput: '',
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function linkEpicDocument(
  db: TestDb,
  input: { epicId: string; documentId: string; documentType: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec' },
): void {
  db.insert(epicDocumentLinks).values({
    epicId: input.epicId,
    documentId: input.documentId,
    documentType: input.documentType,
    role: 'primary',
    reason: 'test link',
    confidence: 'high',
    createdAt: now,
  }).run()
}
