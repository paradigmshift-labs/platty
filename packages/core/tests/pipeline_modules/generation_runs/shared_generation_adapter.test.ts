import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { generationRuns, generationTasks, type GenerationRunStatus, type GenerationStage, type GenerationTaskStatus } from '@/db/schema/build_docs.js'
import { projects, repositories } from '@/db/schema/core.js'
import {
  resumeSharedGenerationRun,
  retrySharedGenerationTasks,
  statusForSharedGenerationRun,
} from '@/pipeline_modules/generation_runs/shared_generation_adapter.js'
import { createTestPlattyDb, type TestPlattyDb } from '@/db/testing.js'
import type { DB } from '@/db/client.js'

const clients: TestPlattyDb[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.cleanup()))
})

describe('shared generation run adapter', () => {
  it('resets failed validation tasks to repair_requested and reopens the run', async () => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_docs',
      runStatus: 'failed',
      taskStatus: 'failed',
    })

    const result = await retrySharedGenerationTasks(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
      failed: true,
    })

    expect(result).toMatchObject({
      runId: 'gen:docs:test',
      kind: 'build_docs',
      projectId: 'project:test',
      matchedTaskCount: 1,
      resetTaskCount: 1,
      skippedTaskCount: 0,
      dryRun: false,
      nextAction: { type: 'repair_task' },
      tasks: [{
        taskId: 'task:docs:failed',
        taskType: 'api_spec',
        previousStatus: 'failed',
        nextStatus: 'repair_requested',
      }],
      skippedTasks: [],
    })

    expect(db.select().from(generationRuns).where(eq(generationRuns.id, 'gen:docs:test')).get()).toMatchObject({
      status: 'running',
      finishedAt: null,
    })
    expect(db.select().from(generationTasks).where(eq(generationTasks.id, 'task:docs:failed')).get()).toMatchObject({
      status: 'repair_requested',
      leaseToken: null,
      leasedBy: null,
      leaseExpiresAt: null,
      lastValidationErrors: [{ code: 'SCHEMA_ERROR' }],
      submittedDocument: { id: 'doc:orders' },
    })
  })

  it('reports repair_task before retry_failed_tasks when reset work needs repair', async () => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_docs',
      runStatus: 'failed',
      taskStatus: 'failed',
    })
    db.insert(generationTasks).values({
      id: 'task:docs:other-failed',
      runId: 'gen:docs:test',
      projectId: 'project:test',
      repositoryId: 'repo:test',
      documentType: 'api_spec',
      targetKey: 'api:GET:/users',
      targetDocumentId: 'doc:users',
      primaryEntryPointId: 'ep:users',
      targetJson: {},
      status: 'failed',
      retryCount: 1,
      maxRetries: 1,
      createdAt: '2026-06-06T00:00:00.000Z',
      updatedAt: '2026-06-06T00:00:00.000Z',
    }).run()

    const result = await retrySharedGenerationTasks(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
      taskId: 'task:docs:failed',
    })

    expect(result).toMatchObject({
      resetTaskCount: 1,
      nextAction: { type: 'repair_task' },
    })
  })

  it('selects taxonomy_consolidation tasks for build_epics retries', async () => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_epics',
      runStatus: 'failed',
      taskStatus: 'failed',
      documentType: 'taxonomy_consolidation',
    })

    const result = await retrySharedGenerationTasks(db, {
      kind: 'build_epics',
      projectId: 'project:test',
      runId: 'gen:docs:test',
      taskType: 'taxonomy_consolidation',
      dryRun: true,
    })

    expect(result).toMatchObject({
      matchedTaskCount: 1,
      resetTaskCount: 1,
      dryRun: true,
      tasks: [{
        taskId: 'task:docs:failed',
        taskType: 'taxonomy_consolidation',
        previousStatus: 'failed',
        nextStatus: 'repair_requested',
      }],
    })
  })

  it.each([
    'pending' as const,
    'leased' as const,
  ])('retries selected %s tasks by clearing lease state and keeping them leaseable', async (taskStatus) => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_docs',
      runStatus: 'running',
      taskStatus,
    })

    const result = await retrySharedGenerationTasks(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
      taskId: 'task:docs:failed',
    })

    expect(result).toMatchObject({
      matchedTaskCount: 1,
      resetTaskCount: 1,
      tasks: [{
        taskId: 'task:docs:failed',
        previousStatus: taskStatus,
        nextStatus: 'pending',
      }],
      nextAction: { type: 'lease_tasks' },
    })
    expect(db.select().from(generationTasks).where(eq(generationTasks.id, 'task:docs:failed')).get()).toMatchObject({
      status: 'pending',
      leaseToken: null,
      leasedBy: null,
      leaseExpiresAt: null,
    })
  })

  it('does not reset saved tasks and reports not retryable', async () => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_docs',
      runStatus: 'completed',
      taskStatus: 'saved',
    })

    const result = await retrySharedGenerationTasks(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
      taskId: 'task:docs:failed',
    })

    expect(result).toMatchObject({
      runId: 'gen:docs:test',
      kind: 'build_docs',
      projectId: 'project:test',
      matchedTaskCount: 1,
      resetTaskCount: 0,
      skippedTaskCount: 1,
      dryRun: false,
      tasks: [],
      skippedTasks: [{
        taskId: 'task:docs:failed',
        taskType: 'api_spec',
        status: 'saved',
        reason: 'not_retryable_status',
      }],
      nextAction: { type: 'done' },
    })
  })

  it('returns normalized status with retry_failed_tasks next action', async () => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_docs',
      runStatus: 'failed',
      taskStatus: 'failed',
    })

    const status = await statusForSharedGenerationRun(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
    })

    expect(status).toMatchObject({
      runId: 'gen:docs:test',
      kind: 'build_docs',
      projectId: 'project:test',
      status: 'failed',
      taskCountsByStatus: { failed: 1 },
      nextAction: { type: 'retry_failed_tasks' },
    })
  })

  it('recovers stale leased tasks before reporting shared run status', async () => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_docs',
      runStatus: 'running',
      taskStatus: 'leased',
    })

    const status = await statusForSharedGenerationRun(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
    })

    expect(status).toMatchObject({
      taskCountsByStatus: { expired: 1 },
      nextAction: { type: 'lease_tasks' },
    })
    expect(db.select().from(generationTasks).where(eq(generationTasks.id, 'task:docs:failed')).get()).toMatchObject({
      status: 'expired',
      leaseToken: null,
      leasedBy: null,
      leaseExpiresAt: null,
      lastValidationErrors: [{ code: 'SCHEMA_ERROR' }],
      submittedDocument: { id: 'doc:orders' },
    })
  })

  it('recovers stale leased tasks even when the token is already missing', async () => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_docs',
      runStatus: 'running',
      taskStatus: 'leased',
    })
    db.update(generationTasks)
      .set({ leaseToken: null })
      .where(eq(generationTasks.id, 'task:docs:failed'))
      .run()

    const result = await statusForSharedGenerationRun(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
    })

    expect(result.recovered?.staleLeases).toBe(1)
    expect(db.select().from(generationTasks).where(eq(generationTasks.id, 'task:docs:failed')).get()).toMatchObject({
      status: 'expired',
      leaseToken: null,
      leasedBy: null,
      leaseExpiresAt: null,
    })
  })

  it('recovers stale leased tasks before resuming shared runs', async () => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_docs',
      runStatus: 'running',
      taskStatus: 'leased',
    })

    const result = await resumeSharedGenerationRun(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
    })

    expect(result).toMatchObject({
      taskCountsByStatus: { pending: 1 },
      nextAction: { type: 'lease_tasks' },
      recovered: {
        staleLeases: 1,
        expiredLeases: 1,
        repairTasksReady: 0,
        failedTasksReady: 0,
      },
    })
    expect(db.select().from(generationTasks).where(eq(generationTasks.id, 'task:docs:failed')).get()).toMatchObject({
      status: 'pending',
      leaseToken: null,
      leasedBy: null,
      leaseExpiresAt: null,
      lastValidationErrors: [{ code: 'SCHEMA_ERROR' }],
      submittedDocument: { id: 'doc:orders' },
    })
  })

  it('continues leaseable work before recommending failed task retries', async () => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_docs',
      runStatus: 'running',
      taskStatus: 'failed',
    })
    db.insert(generationTasks).values({
      id: 'task:docs:pending',
      runId: 'gen:docs:test',
      projectId: 'project:test',
      repositoryId: 'repo:test',
      documentType: 'api_spec',
      targetKey: 'api:GET:/users',
      targetDocumentId: 'doc:users',
      primaryEntryPointId: 'ep:users',
      targetJson: {},
      status: 'pending',
      retryCount: 0,
      maxRetries: 1,
      createdAt: '2026-06-06T00:00:00.000Z',
      updatedAt: '2026-06-06T00:00:00.000Z',
    }).run()

    const status = await statusForSharedGenerationRun(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
    })

    expect(status.nextAction).toEqual({ type: 'lease_tasks' })
  })

  it('does not promote awaiting_approval runs to running during resume', async () => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_docs',
      runStatus: 'awaiting_approval',
      taskStatus: 'pending',
    })

    const result = await resumeSharedGenerationRun(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
    })

    expect(result).toMatchObject({
      runId: 'gen:docs:test',
      kind: 'build_docs',
      status: 'awaiting_approval',
      recovered: {
        expiredLeases: 0,
        repairTasksReady: 0,
        failedTasksReady: 0,
      },
    })
    expect(db.select().from(generationRuns).where(eq(generationRuns.id, 'gen:docs:test')).get()).toMatchObject({
      status: 'awaiting_approval',
      finishedAt: null,
    })
  })

  it.each([
    {
      runStatus: 'failed' as const,
      taskStatus: 'repair_requested' as const,
      expectedTaskStatus: 'repair_requested' as const,
      expectedNextAction: 'repair_task' as const,
    },
    {
      runStatus: 'failed' as const,
      taskStatus: 'expired' as const,
      expectedTaskStatus: 'pending' as const,
      expectedNextAction: 'lease_tasks' as const,
    },
    {
      runStatus: 'completed' as const,
      taskStatus: 'repair_requested' as const,
      expectedTaskStatus: 'repair_requested' as const,
      expectedNextAction: 'repair_task' as const,
    },
    {
      runStatus: 'completed' as const,
      taskStatus: 'expired' as const,
      expectedTaskStatus: 'pending' as const,
      expectedNextAction: 'lease_tasks' as const,
    },
  ])('reopens $runStatus runs during resume when task status is $taskStatus', async ({ runStatus, taskStatus, expectedTaskStatus, expectedNextAction }) => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_docs',
      runStatus,
      taskStatus,
    })

    const result = await resumeSharedGenerationRun(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
    })

    expect(result).toMatchObject({
      runId: 'gen:docs:test',
      kind: 'build_docs',
      status: 'running',
      recovered: {
        expiredLeases: taskStatus === 'expired' ? 1 : 0,
        repairTasksReady: expectedTaskStatus === 'repair_requested' ? 1 : 0,
        failedTasksReady: 0,
      },
      nextAction: { type: expectedNextAction },
    })
    expect(db.select().from(generationRuns).where(eq(generationRuns.id, 'gen:docs:test')).get()).toMatchObject({
      status: 'running',
      finishedAt: null,
    })
    expect(db.select().from(generationTasks).where(eq(generationTasks.id, 'task:docs:failed')).get()).toMatchObject(
      taskStatus === 'expired'
        ? {
            status: expectedTaskStatus,
            leaseToken: null,
            leasedBy: null,
            leaseExpiresAt: null,
          }
        : {
            status: expectedTaskStatus,
          },
    )
  })

  it('rejects resume and retry for cancelled runs', async () => {
    const client = createTrackedTestDb()
    const db = client.db
    seedSharedRun(db, {
      stage: 'build_docs',
      runStatus: 'cancelled',
      taskStatus: 'failed',
    })

    await expect(resumeSharedGenerationRun(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
    })).rejects.toMatchObject({ code: 'RUNS_RUN_CANCELLED' })

    await expect(retrySharedGenerationTasks(db, {
      kind: 'build_docs',
      projectId: 'project:test',
      runId: 'gen:docs:test',
      failed: true,
    })).rejects.toMatchObject({ code: 'RUNS_RUN_CANCELLED' })
  })
})

function seedSharedRun(
  db: DB,
  input: {
    stage: Extract<GenerationStage, 'build_docs' | 'build_epics'>
    runStatus: Extract<GenerationRunStatus, 'planning' | 'awaiting_approval' | 'running' | 'completed' | 'failed' | 'cancelled'>
    taskStatus: GenerationTaskStatus
    documentType?: 'api_spec' | 'taxonomy_consolidation'
  },
): void {
  const now = '2026-06-06T00:00:00.000Z'
  db.insert(projects).values({
    id: 'project:test',
    name: 'Project',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(repositories).values({
    id: 'repo:test',
    projectId: 'project:test',
    name: 'Repo',
    repoPath: '/repo',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(generationRuns).values({
    id: 'gen:docs:test',
    projectId: 'project:test',
    stage: input.stage,
    status: input.runStatus,
    outputLanguage: 'ko',
    requestedBy: 'user:test',
    sourceCommit: 'commit:test',
    maxConcurrentTasks: 1,
    finishedAt: input.runStatus === 'completed' || input.runStatus === 'failed' || input.runStatus === 'cancelled'
      ? now
      : null,
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(generationTasks).values({
    id: 'task:docs:failed',
    runId: 'gen:docs:test',
    projectId: 'project:test',
    repositoryId: 'repo:test',
    documentType: input.documentType ?? 'api_spec',
    targetKey: 'api:GET:/orders',
    targetDocumentId: 'doc:orders',
    primaryEntryPointId: 'ep:orders',
    targetJson: {},
    status: input.taskStatus,
    leaseToken: 'lease:old',
    leasedBy: 'worker:old',
    leaseExpiresAt: now,
    retryCount: 1,
    maxRetries: 1,
    lastValidationErrors: [{ code: 'SCHEMA_ERROR' }],
    submittedDocument: { id: 'doc:orders' },
    createdAt: now,
    updatedAt: now,
  }).run()
}

function createTrackedTestDb(): TestPlattyDb {
  const client = createTestPlattyDb()
  clients.push(client)
  return client
}
