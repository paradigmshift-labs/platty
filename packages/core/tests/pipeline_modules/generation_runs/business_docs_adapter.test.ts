import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  businessDocGenerationRuns,
  businessDocGenerationTasks,
} from '@/db/schema/build_business_docs_generation.js'
import { projects } from '@/db/schema/core.js'
import {
  resumeBusinessDocsUnifiedRun,
  retryBusinessDocsRunTasks,
  statusBusinessDocsUnifiedRun,
} from '@/pipeline_modules/generation_runs/business_docs_adapter.js'
import type {
  BusinessDocsEstimatedTasks,
  BusinessDocsPreview,
  BusinessDocsRuntimePolicy,
} from '@/pipeline_modules/build_business_docs_cli/types.js'
import { createTestDb } from '../../server/helpers.js'

const projectId = 'project:test'
const runId = 'gen:business-docs:test'
const now = '2026-06-06T00:00:00.000Z'
const fixedNow = () => new Date(now)

describe('business docs unified run adapter', () => {
  it('normalizes status from the existing business docs lifecycle', async () => {
    const db = createBusinessDocsRun()

    const status = await statusBusinessDocsUnifiedRun(db, { projectId, runId, now: fixedNow })

    expect(status).toMatchObject({
      kind: 'build_business_docs',
      runId,
      projectId,
      status: 'running',
      nextAction: { type: 'lease_tasks' },
    })
    expect(status.taskCountsByStatus.pending).toBe(1)
    expect(status.taskCountsByStatus.total).toBe(1)
  })

  it('bulk retries failed business-docs tasks using existing retry semantics', async () => {
    const db = createBusinessDocsRun()
    db.update(businessDocGenerationTasks)
      .set({ status: 'failed', lastErrorJson: { code: 'VALIDATION_FAILED' } })
      .where(eq(businessDocGenerationTasks.id, 'task:business:rules'))
      .run()

    const retry = await retryBusinessDocsRunTasks(db, {
      projectId,
      runId,
      failed: true,
      now: fixedNow,
    })

    expect(retry).toMatchObject({
      kind: 'build_business_docs',
      matchedTaskCount: 1,
      resetTaskCount: 1,
      skippedTaskCount: 0,
      tasks: [{
        taskId: 'task:business:rules',
        taskType: 'business_rules',
        previousStatus: 'failed',
        nextStatus: 'pending',
      }],
      nextAction: { type: 'lease_tasks' },
    })
    expect(db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, 'task:business:rules'))
      .get()).toMatchObject({
      status: 'pending',
      leaseToken: null,
      workerId: null,
      leaseExpiresAt: null,
      lastErrorJson: null,
    })
    expect(db.select().from(businessDocGenerationRuns)
      .where(eq(businessDocGenerationRuns.id, runId))
      .get()).toMatchObject({
      status: 'running',
      finishedAt: null,
    })
  })

  it('resumes failed business-docs runs with recovered counts and normalized action', async () => {
    const db = createBusinessDocsRun()
    db.update(businessDocGenerationTasks)
      .set({ status: 'failed', lastErrorJson: { code: 'VALIDATION_FAILED' } })
      .where(eq(businessDocGenerationTasks.id, 'task:business:rules'))
      .run()
    db.update(businessDocGenerationRuns)
      .set({ status: 'failed', finishedAt: now })
      .where(eq(businessDocGenerationRuns.id, runId))
      .run()

    const resumed = await resumeBusinessDocsUnifiedRun(db, { projectId, runId, now: fixedNow })

    expect(resumed).toMatchObject({
      kind: 'build_business_docs',
      runId,
      status: 'running',
      taskCountsByStatus: { failed: 1, total: 1 },
      nextAction: { type: 'retry_failed_tasks' },
      recovered: {
        expiredLeases: 0,
        repairTasksReady: 0,
        failedTasksReady: 1,
      },
    })
    expect(db.select().from(businessDocGenerationRuns)
      .where(eq(businessDocGenerationRuns.id, runId))
      .get()).toMatchObject({
      status: 'running',
      finishedAt: null,
    })
  })

  it('reports not-retryable business-docs tasks without mutating them', async () => {
    const db = createBusinessDocsRun()
    db.update(businessDocGenerationTasks)
      .set({ status: 'saved' })
      .where(eq(businessDocGenerationTasks.id, 'task:business:rules'))
      .run()

    const retry = await retryBusinessDocsRunTasks(db, {
      projectId,
      runId,
      taskId: 'task:business:rules',
      now: fixedNow,
    })

    expect(retry).toMatchObject({
      matchedTaskCount: 1,
      resetTaskCount: 0,
      skippedTaskCount: 1,
      skippedTasks: [{
        taskId: 'task:business:rules',
        taskType: 'business_rules',
        status: 'saved',
        reason: 'not_retryable_status',
      }],
    })
    expect(db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, 'task:business:rules'))
      .get()?.status).toBe('saved')
  })

  it('supports dry-run retry previews without mutating failed tasks', async () => {
    const db = createBusinessDocsRun()
    db.update(businessDocGenerationTasks)
      .set({ status: 'failed', lastErrorJson: { code: 'VALIDATION_FAILED' } })
      .where(eq(businessDocGenerationTasks.id, 'task:business:rules'))
      .run()
    db.insert(businessDocGenerationTasks).values({
      id: 'task:data:dictionary',
      runId,
      projectId,
      epicId: null,
      taskType: 'data_dictionary',
      documentType: 'data_dictionary',
      scope: 'project',
      scopeId: projectId,
      targetKey: 'project:data_dictionary',
      status: 'leased',
      dependsOnTaskIdsJson: [],
      attemptNo: 0,
      maxRepairAttempts: 1,
      workerId: 'worker:old',
      leaseToken: 'lease:old',
      leaseExpiresAt: '2026-06-05T23:59:00.000Z',
      createdAt: now,
      updatedAt: now,
    }).run()

    const retry = await retryBusinessDocsRunTasks(db, {
      projectId,
      runId,
      failed: true,
      dryRun: true,
      now: fixedNow,
    })

    expect(retry).toMatchObject({
      matchedTaskCount: 1,
      resetTaskCount: 1,
      dryRun: true,
      nextAction: { type: 'retry_failed_tasks' },
      tasks: [{
        taskId: 'task:business:rules',
        previousStatus: 'failed',
        nextStatus: 'pending',
      }],
    })
    expect(db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, 'task:business:rules'))
      .get()).toMatchObject({
      status: 'failed',
      lastErrorJson: { code: 'VALIDATION_FAILED' },
    })
    expect(db.select().from(businessDocGenerationRuns)
      .where(eq(businessDocGenerationRuns.id, runId))
      .get()?.status).toBe('running')
    expect(db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, 'task:data:dictionary'))
      .get()).toMatchObject({
      status: 'leased',
      workerId: 'worker:old',
      leaseToken: 'lease:old',
      leaseExpiresAt: '2026-06-05T23:59:00.000Z',
      lastErrorJson: null,
    })
  })
})

function createBusinessDocsRun() {
  const db = createTestDb()
  db.insert(projects).values({
    id: projectId,
    name: 'Project',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(businessDocGenerationRuns).values({
    id: runId,
    projectId,
    status: 'running',
    policyJson: policy(),
    previewSnapshotJson: preview(),
    selectedEpicIdsJson: [],
    sourceCommit: 'commit:test',
    forceRegenerate: 0,
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(businessDocGenerationTasks).values({
    id: 'task:business:rules',
    runId,
    projectId,
    epicId: null,
    taskType: 'business_rules',
    documentType: 'br',
    scope: 'project',
    scopeId: projectId,
    targetKey: 'project:business_rules',
    status: 'pending',
    dependsOnTaskIdsJson: [],
    attemptNo: 0,
    maxRepairAttempts: 1,
    createdAt: now,
    updatedAt: now,
  }).run()
  return db
}

function policy(): BusinessDocsRuntimePolicy {
  return {
    workerProvider: 'codex',
    maxWorkerCount: 1,
    approvedActiveLeases: 1,
    epicSchedulingConcurrency: 1,
    writerSoftLimit: 1,
    ucsChunkSize: 1,
    ucsSchedulingConcurrency: 1,
    maxRepairAttempts: 1,
    persistMode: 'incremental',
    projectGlossaryMode: 'auto',
    judgeMode: 'off',
    outputLanguage: 'ko',
  }
}

function estimatedTasks(): BusinessDocsEstimatedTasks {
  return {
    system_design: 0,
    data_dictionary: 0,
    business_rules: 1,
    use_case_list: 0,
    use_case_list_refine: 0,
    use_case_spec: 0,
    epic_glossary: 0,
    project_glossary: 0,
    total: 1,
  }
}

function preview(): BusinessDocsPreview {
  return {
    project: { id: projectId, name: 'Project' },
    confirmedEpicCount: 0,
    selectedEpicCount: 0,
    blockers: [],
    documentPlan: {
      perEpic: [],
      projectGlossary: 'skipped',
    },
    recommendedPolicy: policy(),
    estimatedTasks: estimatedTasks(),
    warnings: [],
  }
}
