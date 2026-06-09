import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { buildEpicsDrafts } from '@/db/schema/build_epics.js'
import { generationRuns, generationTasks } from '@/db/schema/build_docs.js'
import { projects, repositories } from '@/db/schema/core.js'
import {
  resumeBuildEpicsRun,
  retryBuildEpicsRunTasks,
  statusBuildEpicsRun,
} from '@/pipeline_modules/generation_runs/build_epics_adapter.js'
import { createTestDb } from '../../server/helpers.js'

describe('build_epics run adapter', () => {
  it('resets a failed cross_domain_link task, preserves completed work, and reopens a completed run', async () => {
    const db = createTestDb()
    seedBuildEpicsRun(db, {
      runStatus: 'completed',
      draftVersion: 1,
      taxonomyStatus: 'completed',
      assignmentStatus: 'completed',
      crossStatus: 'failed',
    })

    const result = await retryBuildEpicsRunTasks(db, {
      projectId: 'project:test',
      runId: 'gen:epics:test',
      taskType: 'cross_domain_link',
      failed: true,
    })

    expect(result).toMatchObject({
      runId: 'gen:epics:test',
      kind: 'build_epics',
      projectId: 'project:test',
      matchedTaskCount: 1,
      resetTaskCount: 1,
      skippedTaskCount: 0,
      dryRun: false,
      nextAction: { type: 'repair_task' },
      tasks: [{
        taskId: 'task:cross:1',
        taskType: 'cross_domain_link',
        previousStatus: 'failed',
        nextStatus: 'repair_requested',
      }],
      skippedTasks: [],
    })

    expect(db.select().from(generationRuns).where(eq(generationRuns.id, 'gen:epics:test')).get()).toMatchObject({
      status: 'running',
      finishedAt: null,
    })
    expect(db.select().from(generationTasks).where(eq(generationTasks.id, 'task:cross:1')).get()).toMatchObject({
      status: 'repair_requested',
      leaseToken: null,
      leasedBy: null,
      leaseExpiresAt: null,
      lastValidationErrors: [{ code: 'LINK_ERROR' }],
      submittedDocument: { id: 'doc:cross:1' },
    })
    expect(db.select().from(generationTasks).where(eq(generationTasks.id, 'task:taxonomy:1')).get()).toMatchObject({
      status: 'completed',
      submittedDocument: { id: 'doc:taxonomy:1' },
    })
    expect(db.select().from(generationTasks).where(eq(generationTasks.id, 'task:assignment:1')).get()).toMatchObject({
      status: 'completed',
      submittedDocument: { id: 'doc:assignment:1' },
    })
  })

  it('blocks taxonomy_candidate retries with RUNS_RETRY_CASCADE_REQUIRED', async () => {
    const db = createTestDb()
    seedBuildEpicsRun(db, {
      runStatus: 'completed',
      draftVersion: 1,
      taxonomyStatus: 'failed',
      assignmentStatus: 'completed',
      crossStatus: 'completed',
    })

    await expect(retryBuildEpicsRunTasks(db, {
      projectId: 'project:test',
      runId: 'gen:epics:test',
      taskType: 'taxonomy_candidate',
      failed: true,
    })).rejects.toMatchObject({ code: 'RUNS_RETRY_CASCADE_REQUIRED' })
  })

  it('blocks taxonomy_consolidation retries with RUNS_RETRY_CASCADE_REQUIRED', async () => {
    const db = createTestDb()
    seedBuildEpicsRun(db, {
      runStatus: 'completed',
      draftVersion: 1,
      taxonomyStatus: 'completed',
      consolidationStatus: 'failed',
      assignmentStatus: 'completed',
      crossStatus: 'completed',
    })

    await expect(retryBuildEpicsRunTasks(db, {
      projectId: 'project:test',
      runId: 'gen:epics:test',
      taskType: 'taxonomy_consolidation',
      failed: true,
    })).rejects.toMatchObject({ code: 'RUNS_RETRY_CASCADE_REQUIRED' })
  })

  it('blocks cross_domain_link retries when the editable draft has been edited', async () => {
    const db = createTestDb()
    seedBuildEpicsRun(db, {
      runStatus: 'completed',
      draftVersion: 2,
      taxonomyStatus: 'completed',
      assignmentStatus: 'completed',
      crossStatus: 'failed',
    })

    await expect(retryBuildEpicsRunTasks(db, {
      projectId: 'project:test',
      runId: 'gen:epics:test',
      taskType: 'cross_domain_link',
      failed: true,
    })).rejects.toMatchObject({ code: 'RUNS_RETRY_DRAFT_EDITED' })
  })

  it('blocks edited drafts even while the draft is still building', async () => {
    const db = createTestDb()
    seedBuildEpicsRun(db, {
      runStatus: 'completed',
      draftVersion: 2,
      taxonomyStatus: 'completed',
      assignmentStatus: 'completed',
      crossStatus: 'failed',
    })
    db.update(buildEpicsDrafts)
      .set({ status: 'building' })
      .where(eq(buildEpicsDrafts.runId, 'gen:epics:test'))
      .run()

    await expect(retryBuildEpicsRunTasks(db, {
      projectId: 'project:test',
      runId: 'gen:epics:test',
      taskType: 'cross_domain_link',
      failed: true,
    })).rejects.toMatchObject({ code: 'RUNS_RETRY_DRAFT_EDITED' })
  })

  it('blocks cross_domain_link retries until taxonomy and assignment tasks are completed', async () => {
    const db = createTestDb()
    seedBuildEpicsRun(db, {
      runStatus: 'completed',
      draftVersion: 1,
      taxonomyStatus: 'completed',
      assignmentStatus: 'pending',
      crossStatus: 'failed',
    })

    await expect(retryBuildEpicsRunTasks(db, {
      projectId: 'project:test',
      runId: 'gen:epics:test',
      taskType: 'cross_domain_link',
      failed: true,
    })).rejects.toMatchObject({ code: 'RUNS_RETRY_PREREQUISITE_NOT_READY' })
  })

  it('blocks cross_domain_link retries until taxonomy consolidation tasks are completed', async () => {
    const db = createTestDb()
    seedBuildEpicsRun(db, {
      runStatus: 'completed',
      draftVersion: 1,
      taxonomyStatus: 'completed',
      consolidationStatus: 'pending',
      assignmentStatus: 'completed',
      crossStatus: 'failed',
    })

    await expect(retryBuildEpicsRunTasks(db, {
      projectId: 'project:test',
      runId: 'gen:epics:test',
      taskType: 'cross_domain_link',
      failed: true,
    })).rejects.toMatchObject({ code: 'RUNS_RETRY_PREREQUISITE_NOT_READY' })
  })

  it('reports non-retryable cross_domain_link tasks without running draft or prerequisite guards', async () => {
    const db = createTestDb()
    seedBuildEpicsRun(db, {
      runStatus: 'completed',
      draftVersion: 2,
      taxonomyStatus: 'completed',
      assignmentStatus: 'pending',
      crossStatus: 'completed',
    })

    const retry = await retryBuildEpicsRunTasks(db, {
      projectId: 'project:test',
      runId: 'gen:epics:test',
      taskType: 'cross_domain_link',
      taskId: 'task:cross:1',
    })

    expect(retry).toMatchObject({
      matchedTaskCount: 1,
      resetTaskCount: 0,
      skippedTaskCount: 1,
      skippedTasks: [{
        taskId: 'task:cross:1',
        taskType: 'cross_domain_link',
        status: 'completed',
        reason: 'not_retryable_status',
      }],
    })
  })

  it('blocks document_assignment retries until taxonomy tasks are completed', async () => {
    const db = createTestDb()
    seedBuildEpicsRun(db, {
      runStatus: 'completed',
      draftVersion: 1,
      taxonomyStatus: 'pending',
      assignmentStatus: 'failed',
      crossStatus: 'completed',
    })

    await expect(retryBuildEpicsRunTasks(db, {
      projectId: 'project:test',
      runId: 'gen:epics:test',
      taskType: 'document_assignment',
      failed: true,
    })).rejects.toMatchObject({ code: 'RUNS_RETRY_PREREQUISITE_NOT_READY' })
  })

  it('blocks document_assignment retries until taxonomy consolidation tasks are completed', async () => {
    const db = createTestDb()
    seedBuildEpicsRun(db, {
      runStatus: 'completed',
      draftVersion: 1,
      taxonomyStatus: 'completed',
      consolidationStatus: 'pending',
      assignmentStatus: 'failed',
      crossStatus: 'completed',
    })

    await expect(retryBuildEpicsRunTasks(db, {
      projectId: 'project:test',
      runId: 'gen:epics:test',
      taskType: 'document_assignment',
      failed: true,
    })).rejects.toMatchObject({ code: 'RUNS_RETRY_PREREQUISITE_NOT_READY' })
  })

  it('delegates status and resume to the shared adapter with the build_epics kind', async () => {
    const db = createTestDb()
    seedBuildEpicsRun(db, {
      runStatus: 'failed',
      draftVersion: 1,
      taxonomyStatus: 'completed',
      assignmentStatus: 'completed',
      crossStatus: 'failed',
    })

    const status = await statusBuildEpicsRun(db, {
      projectId: 'project:test',
      runId: 'gen:epics:test',
    })
    expect(status).toMatchObject({
      kind: 'build_epics',
      status: 'failed',
      nextAction: { type: 'retry_failed_tasks' },
    })

    const resume = await resumeBuildEpicsRun(db, {
      projectId: 'project:test',
      runId: 'gen:epics:test',
    })
    expect(resume).toMatchObject({
      kind: 'build_epics',
      status: 'failed',
      recovered: {
        expiredLeases: 0,
        repairTasksReady: 0,
        failedTasksReady: 1,
      },
    })
  })
})

function seedBuildEpicsRun(
  db: ReturnType<typeof createTestDb>,
  input: {
    runStatus: 'planning' | 'awaiting_approval' | 'running' | 'completed' | 'failed' | 'cancelled'
    draftVersion: number
    taxonomyStatus: 'pending' | 'leased' | 'expired' | 'submitted' | 'repair_requested' | 'validated' | 'saved' | 'completed' | 'failed'
    consolidationStatus?: 'pending' | 'leased' | 'expired' | 'submitted' | 'repair_requested' | 'validated' | 'saved' | 'completed' | 'failed'
    assignmentStatus: 'pending' | 'leased' | 'expired' | 'submitted' | 'repair_requested' | 'validated' | 'saved' | 'completed' | 'failed'
    crossStatus: 'pending' | 'leased' | 'expired' | 'submitted' | 'repair_requested' | 'validated' | 'saved' | 'completed' | 'failed'
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
    id: 'gen:epics:test',
    projectId: 'project:test',
    stage: 'build_epics',
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

  db.insert(generationTasks).values([
    {
      id: 'task:taxonomy:1',
      runId: 'gen:epics:test',
      projectId: 'project:test',
      repositoryId: 'repo:test',
      documentType: 'taxonomy_candidate',
      targetKey: 'taxonomy:1',
      targetDocumentId: 'doc:taxonomy:1',
      primaryEntryPointId: 'doc:taxonomy:1',
      targetJson: { task_type: 'taxonomy_candidate' },
      status: input.taxonomyStatus,
      retryCount: 0,
      maxRetries: 2,
      submittedDocument: { id: 'doc:taxonomy:1' },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'task:taxonomy-consolidation:1',
      runId: 'gen:epics:test',
      projectId: 'project:test',
      repositoryId: 'repo:test',
      documentType: 'taxonomy_consolidation',
      targetKey: 'taxonomy:consolidated',
      targetDocumentId: 'doc:taxonomy:consolidated',
      primaryEntryPointId: 'doc:taxonomy:consolidated',
      targetJson: { task_type: 'taxonomy_consolidation' },
      status: input.consolidationStatus ?? 'completed',
      retryCount: 0,
      maxRetries: 2,
      submittedDocument: { id: 'doc:taxonomy:consolidated' },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'task:assignment:1',
      runId: 'gen:epics:test',
      projectId: 'project:test',
      repositoryId: 'repo:test',
      documentType: 'document_assignment',
      targetKey: 'assignment:1',
      targetDocumentId: 'doc:assignment:1',
      primaryEntryPointId: 'doc:assignment:1',
      targetJson: { task_type: 'document_assignment' },
      status: input.assignmentStatus,
      retryCount: 0,
      maxRetries: 2,
      submittedDocument: { id: 'doc:assignment:1' },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'task:cross:1',
      runId: 'gen:epics:test',
      projectId: 'project:test',
      repositoryId: 'repo:test',
      documentType: 'cross_domain_link',
      targetKey: 'cross:1',
      targetDocumentId: 'doc:cross:1',
      primaryEntryPointId: 'doc:cross:1',
      targetJson: { task_type: 'cross_domain_link' },
      status: input.crossStatus,
      retryCount: 1,
      maxRetries: 2,
      lastValidationErrors: input.crossStatus === 'failed' ? [{ code: 'LINK_ERROR' }] : [],
      submittedDocument: { id: 'doc:cross:1' },
      createdAt: now,
      updatedAt: now,
    },
  ]).run()

  db.insert(buildEpicsDrafts).values({
    id: 'draft:gen:epics:test',
    runId: 'gen:epics:test',
    projectId: 'project:test',
    status: 'ready',
    draftJson: {
      version: input.draftVersion,
      projectId: 'project:test',
      domains: [],
      epics: [],
      reviewBuckets: {
        unassignedApiDocIds: [],
        unassignedScreenDocIds: [],
        unassignedEventDocIds: [],
        unassignedScheduleDocIds: [],
        orphanEventDocIds: [],
        orphanScheduleDocIds: [],
        unresolvedScreenApiCalls: [],
      },
      coverage: { assignedApiDocs: 0, totalApiDocs: 0 },
      validationIssues: [],
      judgeResults: [],
    },
    validationJson: { fatal: [], warnings: [] },
    createdAt: now,
    updatedAt: now,
  }).run()
}
