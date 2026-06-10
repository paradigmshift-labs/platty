import { createHash, randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import {
  generationContextBundles,
  generationContextPages,
  generationEvents,
  generationRuns,
  generationTasks,
  type GenerationEventType,
  type GenerationTask,
  type GenerationTaskStatus,
} from '@/db/schema/build_docs.js'
import { buildEpicsDrafts } from '@/db/schema/build_epics.js'
import { repositories } from '@/db/schema/core.js'
import { loadDocIndex } from '@/pipeline_modules/build_epics/core/f1_load_doc_index.js'
import { validateEpicPlan } from '@/pipeline_modules/build_epics/core/f9_validate_plan.js'
import { persistConfirmedEpics } from '@/pipeline_modules/build_epics/core/f10_persist_confirmed_epics.js'
import { BuildEpicsError, type BuildEpicsDocIndex, type ReviewableEpicPlan, type ValidationIssue } from '@/pipeline_modules/build_epics/core/types.js'
import { toConfirmedPlan, type PersistedEditablePlan } from '@/pipeline_modules/build_epics/runtime/editing.js'
import { packBuildEpicsDocumentCards } from '@/pipeline_modules/build_epics/source/cards.js'
import { validateBuildEpicsDraft } from '@/pipeline_modules/build_epics/runtime/draft.js'
import type { BuildEpicsDraftConfirmResult } from '@/pipeline_modules/build_epics/runtime/types.js'
import { applyEpicSyncAssignmentPatch, type EpicSyncAssignmentSubmission } from './assignment_patch.js'
import { findLatestResumableGenerationRun, reopenFailedGenerationRun } from '@/pipeline_modules/generation_runs/resumable_run_resolver.js'
import { applyEpicSyncCleanup } from './cleanup.js'
import { applyEpicSyncCrossPatch, type EpicSyncCrossSubmission } from './cross_patch.js'
import { deriveEpicSyncImpact, type EpicSyncDocumentImpact } from './impact.js'
import { loadPersistedBuildEpicsPlan } from './persisted_plan.js'

const SCHEMA_VERSION = 'build_epics_sync_runtime_v1'
const LEASE_TTL_MS = 15 * 60 * 1000
const DEFAULT_ASSIGNMENT_BATCH_SIZE = 10
const RELEASABLE_TASK_STATUSES: GenerationTaskStatus[] = ['pending', 'expired', 'repair_requested']
const FINAL_TASK_STATUSES: GenerationTaskStatus[] = ['completed', 'failed']
const SYNC_TASK_TYPES = new Set(['epic_sync_assignment', 'epic_sync_cross_links'])

export interface BuildEpicsSyncMetadata {
  docSyncPlanId: string
  impactCounts: Record<'new' | 'changed' | 'deleted', number>
  affectedDocumentIds: string[]
  removedDocumentIds: string[]
  removedEpicIds: string[]
}

export type BuildEpicsSyncDraftPlan = PersistedEditablePlan & { syncMetadata: BuildEpicsSyncMetadata }

export class BuildEpicsSyncRuntime {
  constructor(private readonly input: { db: DB }) {}

  async resumeLatestInterruptedRun(input: { projectId: string; docSyncPlanId: string }) {
    const run = findLatestResumableGenerationRun(this.input.db, {
      projectId: input.projectId,
      stage: 'build_epics',
      includeRun: (candidate) => this.isMatchingSyncRun(candidate.id, input.docSyncPlanId),
    })
    if (!run) return null
    const resumed = reopenFailedGenerationRun(this.input.db, run)
    return { runId: resumed.id, status: resumed.status as 'running' }
  }

  async preview(input: { projectId: string; docSyncPlanId: string }) {
    const impact = deriveEpicSyncImpact({ db: this.input.db, projectId: input.projectId, docSyncPlanId: input.docSyncPlanId })
    return {
      projectId: input.projectId,
      docSyncPlanId: input.docSyncPlanId,
      counts: impact.counts,
      impactedDocumentIds: impact.impacts.map((item) => item.documentId),
      warnings: [],
    }
  }

  async start(input: {
    projectId: string
    docSyncPlanId: string
    requestedBy: string
    policy?: { changedRatioFullRebuildThreshold?: number; maxWorkerCount?: number; maxRepairPasses?: number; maxAssignmentBatchSize?: number }
  }) {
    const repo = this.input.db.select().from(repositories).where(eq(repositories.projectId, input.projectId)).get()
    if (!repo) throw new Error('BUILD_EPICS_REPOSITORY_REQUIRED')

    const impact = deriveEpicSyncImpact({ db: this.input.db, projectId: input.projectId, docSyncPlanId: input.docSyncPlanId })
    const persistedPlan = loadPersistedBuildEpicsPlan({ db: this.input.db, projectId: input.projectId })
    const cleanup = applyEpicSyncCleanup({
      plan: persistedPlan,
      deletedDocumentIds: impact.impacts.filter((item) => item.kind === 'deleted').map((item) => item.documentId),
    })
    const assignableImpacts = impact.impacts.filter((item) => item.kind === 'new' || item.kind === 'changed')
    const runId = `gen:build_epics_sync:${randomUUID()}`
    const now = timestamp()
    const hasTasks = assignableImpacts.length > 0
    const plan: BuildEpicsSyncDraftPlan = {
      ...cleanup.plan,
      version: 1,
      syncMetadata: {
        docSyncPlanId: input.docSyncPlanId,
        impactCounts: impact.counts,
        affectedDocumentIds: assignableImpacts.map((item) => item.documentId),
        removedDocumentIds: cleanup.removedDocumentIds,
        removedEpicIds: cleanup.removedEpicIds,
      },
    }
    const validation = validateBuildEpicsDraft(plan, validationPolicy())
    const draftStatus = hasTasks ? 'building' : validation.fatal.length > 0 ? 'invalid' : 'ready'
    const runStatus = hasTasks ? 'running' : draftStatus === 'ready' ? 'completed' : 'failed'

    this.input.db.insert(generationRuns).values({
      id: runId,
      projectId: input.projectId,
      stage: 'build_epics',
      status: runStatus,
      outputLanguage: 'en',
      requestedBy: input.requestedBy,
      sourceCommit: repo.lastSyncedCommit ?? 'unknown',
      maxConcurrentTasks: Math.max(1, input.policy?.maxWorkerCount ?? 1),
      approvedBy: input.requestedBy,
      approvedAt: now,
      finishedAt: hasTasks ? null : now,
      createdAt: now,
      updatedAt: now,
    }).run()
    this.recordEvent(runId, null, 'run_started', { stage: 'build_epics_sync', doc_sync_plan_id: input.docSyncPlanId })

    this.input.db.insert(buildEpicsDrafts).values({
      id: `draft:${runId}`,
      runId,
      projectId: input.projectId,
      status: draftStatus,
      draftJson: plan as unknown as Record<string, unknown>,
      validationJson: validation as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    }).run()

    if (hasTasks) {
      const batches = chunkImpacts(assignableImpacts, input.policy?.maxAssignmentBatchSize ?? DEFAULT_ASSIGNMENT_BATCH_SIZE)
      batches.forEach((batch, index) => {
        this.insertAssignmentTask({
          runId,
          projectId: input.projectId,
          repositoryId: repo.id,
          impacts: batch,
          now,
          maxRetries: input.policy?.maxRepairPasses ?? 2,
          targetKey: batches.length === 1 ? 'sync:assignment:1' : `sync:assignment:${String(index + 1).padStart(3, '0')}`,
        })
      })
    }
    else this.recordEvent(runId, null, runStatus === 'completed' ? 'run_completed' : 'run_failed', { draft_status: draftStatus })

    return { runId, status: hasTasks ? 'running' as const : draftStatus, impact: impact.counts }
  }

  async leaseTasks(input: { runId: string; limit: number; workerId: string }) {
    const run = this.requireBuildEpicsRun(input.runId)
    this.recoverExpiredLeases(input.runId)
    if (run.status !== 'running') return { runId: input.runId, leasedTasks: [], remainingPendingTaskCount: 0 }

    const tasks = this.tasksForRun(input.runId)
    const activeLeaseCount = tasks.filter((task) => task.status === 'leased').length
    const openLeaseSlots = Math.max(0, run.maxConcurrentTasks - activeLeaseCount)
    const selected = tasks
      .filter((task) => RELEASABLE_TASK_STATUSES.includes(task.status))
      .slice(0, Math.min(Math.max(0, Math.floor(input.limit)), openLeaseSlots))
    const leaseExpiresAt = new Date(Date.now() + LEASE_TTL_MS).toISOString()

    const leasedTasks = selected.map((task) => {
      const leaseToken = `lease:${randomUUID()}`
      this.input.db.update(generationTasks)
        .set({ status: 'leased', leaseToken, leasedBy: input.workerId, leaseExpiresAt, updatedAt: timestamp() })
        .where(and(eq(generationTasks.id, task.id), inArray(generationTasks.status, RELEASABLE_TASK_STATUSES)))
        .run()
      this.recordEvent(input.runId, task.id, 'task_leased', { worker_id: input.workerId })
      return {
        type: 'task' as const,
        taskId: task.id,
        taskType: task.targetJson.task_type as string,
        targetKey: task.targetKey,
        leaseToken,
        leaseExpiresAt,
      }
    })

    return {
      runId: input.runId,
      leasedTasks,
      remainingPendingTaskCount: this.tasksForRun(input.runId).filter((task) => RELEASABLE_TASK_STATUSES.includes(task.status)).length,
    }
  }

  async getContext(input: { taskId: string; leaseToken: string }) {
    const task = this.requireTaskLease(input.taskId, input.leaseToken)
    const run = this.requireBuildEpicsRun(task.runId)
    const target = task.targetJson as { task_type?: string; impactedDocumentIds?: string[]; affectedDocumentIds?: string[] }
    const draft = this.requireDraft(task.runId)
    const docIndex = await loadDocIndexOrEmpty({ db: this.input.db, projectId: task.projectId })
    const taskDocumentIds = new Set(target.task_type === 'epic_sync_cross_links'
      ? target.affectedDocumentIds ?? []
      : target.impactedDocumentIds ?? [])
    const impactedCards = packBuildEpicsDocumentCards(docIndex).filter((card) => taskDocumentIds.has(card.documentId))
    const taskType = target.task_type ?? 'epic_sync_assignment'
    const content = {
      taskType,
      outputLanguage: run.outputLanguage,
      impactedCards,
      ...(taskType === 'epic_sync_cross_links' ? { affectedCards: impactedCards } : {}),
      existingEpics: (draft.draftJson as unknown as BuildEpicsSyncDraftPlan).epics.map((epic) => ({
        tempEpicId: epic.tempEpicId,
        stableKey: epic.stableKey,
        name: epic.name,
        abbr: epic.abbr,
        summary: epic.summary,
        apiDocIds: epic.apiLinks.map((link) => link.apiDocId),
        screenDocIds: epic.screenLinks.map((link) => link.screenDocId),
        eventDocIds: epic.eventLinks.map((link) => link.eventDocId),
        scheduleDocIds: epic.scheduleLinks.map((link) => link.scheduleDocId),
        crossLinks: epic.crossLinks.map((link) => ({ ...link })),
      })),
      repair: {
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
        validationErrors: task.lastValidationErrors ?? [],
      },
    }
    const contentHash = hashJson(content)
    const contextHandle = `ctx:${task.id}`
    const manifest = {
      runId: run.id,
      taskId: task.id,
      schemaVersion: SCHEMA_VERSION,
      evidenceNamespace: `platty:build_epics_sync:${run.id}:${task.id}`,
      requiredPages: ['main'],
      pages: [{ pageToken: 'main', pageKind: 'main' }],
    }
    const now = timestamp()

    this.input.db.insert(generationContextBundles).values({
      contextHandle,
      runId: run.id,
      taskId: task.id,
      sourceCommit: run.sourceCommit,
      schemaVersion: SCHEMA_VERSION,
      manifestJson: manifest,
      contentHash,
      createdAt: now,
    }).onConflictDoUpdate({
      target: generationContextBundles.contextHandle,
      set: { manifestJson: manifest, contentHash },
    }).run()

    this.input.db.insert(generationContextPages).values({
      contextHandle,
      pageId: 'main',
      pageKind: 'main',
      pageOrder: 0,
      summary: 'build_epics sync context',
      evidenceIdsJson: [],
      contentJson: content,
      contentHash,
      createdAt: now,
    }).onConflictDoUpdate({
      target: [generationContextPages.contextHandle, generationContextPages.pageId],
      set: { contentJson: content, contentHash },
    }).run()

    return { metadata: manifest, manifest, content }
  }

  async submitTask(input: { taskId: string; leaseToken: string; result: unknown }) {
    const task = this.requireTaskLease(input.taskId, input.leaseToken)
    const run = this.requireBuildEpicsRun(task.runId)
    const taskType = (task.targetJson as { task_type?: string }).task_type
    const result = asRecord(input.result)
    if (taskType === 'epic_sync_cross_links') return this.submitCrossLinksTask({ task, runId: run.id, result })

    if (!Array.isArray(result.assignments)) {
      return this.rejectTask(task, [{ severity: 'fatal', code: 'INVALID_SYNC_ASSIGNMENT_RESULT', message: 'assignments array is required' }])
    }
    const coverageErrors = validateAssignmentCoverage(task, result.assignments)
    if (coverageErrors.length > 0) return this.rejectTask(task, coverageErrors, result)

    const draft = this.requireDraft(run.id)
    const currentPlan = draft.draftJson as unknown as BuildEpicsSyncDraftPlan
    const patch = applyEpicSyncAssignmentPatch({
      plan: currentPlan,
      submission: result as unknown as EpicSyncAssignmentSubmission,
    })
    if (patch.validationIssues.some((issue) => issue.severity === 'fatal')) {
      return this.rejectTask(task, patch.validationIssues as unknown as Array<Record<string, unknown>>, result)
    }

    const nextPlan: BuildEpicsSyncDraftPlan = {
      ...patch.plan,
      version: currentPlan.version ?? 1,
      syncMetadata: currentPlan.syncMetadata,
    }
    const validation = validateBuildEpicsDraft(nextPlan, validationPolicy())
    const status = validation.fatal.length > 0 ? 'invalid' : 'building'
    const now = timestamp()

    this.input.db.update(generationTasks)
      .set({
        status: 'completed',
        submittedDocument: result,
        leaseToken: null,
        leasedBy: null,
        leaseExpiresAt: null,
        lastValidationErrors: [],
        updatedAt: now,
      })
      .where(eq(generationTasks.id, task.id))
      .run()
    if (status === 'building' && this.isAssignmentPhaseComplete(run.id)) {
      this.insertCrossLinksTask({
        runId: run.id,
        projectId: task.projectId,
        repositoryId: task.repositoryId,
        affectedDocumentIds: currentPlan.syncMetadata.affectedDocumentIds,
        now,
        maxRetries: task.maxRetries,
      })
    }
    this.input.db.update(buildEpicsDrafts)
      .set({
        status,
        draftJson: nextPlan as unknown as Record<string, unknown>,
        validationJson: validation as unknown as Record<string, unknown>,
        updatedAt: now,
      })
      .where(eq(buildEpicsDrafts.runId, run.id))
      .run()
    this.input.db.update(generationRuns)
      .set({ status: status === 'building' ? 'running' : 'failed', finishedAt: status === 'building' ? null : now, updatedAt: now })
      .where(eq(generationRuns.id, run.id))
      .run()
    this.recordEvent(run.id, task.id, 'task_completed', { task_type: 'epic_sync_assignment' })
    if (status !== 'building') this.recordEvent(run.id, null, 'run_failed', { draft_status: status })
    return { status: 'completed' as const, validationErrors: [] }
  }

  private submitCrossLinksTask(input: { task: GenerationTask; runId: string; result: Record<string, unknown> }) {
    const { task, runId, result } = input
    if (!Array.isArray(result.links)) {
      return this.rejectTask(task, [{ severity: 'fatal', code: 'INVALID_SYNC_CROSS_RESULT', message: 'links array is required' }])
    }
    const draft = this.requireDraft(runId)
    const currentPlan = draft.draftJson as unknown as BuildEpicsSyncDraftPlan
    const target = task.targetJson as { affectedDocumentIds?: string[] }
    const patch = applyEpicSyncCrossPatch({
      plan: currentPlan,
      affectedDocumentIds: target.affectedDocumentIds ?? [],
      submission: result as unknown as EpicSyncCrossSubmission,
    })
    if (patch.validationIssues.some((issue) => issue.severity === 'fatal')) {
      return this.rejectTask(task, patch.validationIssues as unknown as Array<Record<string, unknown>>, result)
    }

    const nextPlan: BuildEpicsSyncDraftPlan = {
      ...patch.plan,
      version: currentPlan.version ?? 1,
      syncMetadata: currentPlan.syncMetadata,
    }
    const validation = validateBuildEpicsDraft(nextPlan, validationPolicy())
    const status = validation.fatal.length > 0 ? 'invalid' : 'ready'
    const now = timestamp()

    this.input.db.update(generationTasks)
      .set({
        status: 'completed',
        submittedDocument: result,
        leaseToken: null,
        leasedBy: null,
        leaseExpiresAt: null,
        lastValidationErrors: [],
        updatedAt: now,
      })
      .where(eq(generationTasks.id, task.id))
      .run()
    this.input.db.update(buildEpicsDrafts)
      .set({
        status,
        draftJson: nextPlan as unknown as Record<string, unknown>,
        validationJson: validation as unknown as Record<string, unknown>,
        updatedAt: now,
      })
      .where(eq(buildEpicsDrafts.runId, runId))
      .run()
    this.input.db.update(generationRuns)
      .set({ status: status === 'ready' ? 'completed' : 'failed', finishedAt: now, updatedAt: now })
      .where(eq(generationRuns.id, runId))
      .run()
    this.recordEvent(runId, task.id, 'task_completed', { task_type: 'epic_sync_cross_links' })
    this.recordEvent(runId, null, status === 'ready' ? 'run_completed' : 'run_failed', { draft_status: status })
    return { status: 'completed' as const, validationErrors: [] }
  }

  async failTask(input: { taskId: string; leaseToken: string; reason: string }) {
    const task = this.requireTaskLease(input.taskId, input.leaseToken)
    const validationErrors = [{
      severity: 'fatal',
      code: 'SYNC_WORKER_INVOCATION_FAILED',
      message: input.reason,
    }]
    const now = timestamp()
    this.input.db.update(generationTasks)
      .set({
        status: 'failed',
        leaseToken: null,
        leasedBy: null,
        leaseExpiresAt: null,
        lastValidationErrors: validationErrors,
        updatedAt: now,
      })
      .where(eq(generationTasks.id, task.id))
      .run()
    this.input.db.update(buildEpicsDrafts)
      .set({
        status: 'invalid',
        validationJson: { fatal: validationErrors, warnings: [] },
        updatedAt: now,
      })
      .where(eq(buildEpicsDrafts.runId, task.runId))
      .run()
    this.input.db.update(generationRuns)
      .set({ status: 'failed', finishedAt: now, updatedAt: now })
      .where(eq(generationRuns.id, task.runId))
      .run()
    this.recordEvent(task.runId, task.id, 'task_failed', { validation_errors: validationErrors })
    this.recordEvent(task.runId, null, 'run_failed', { draft_status: 'invalid' })
    return { status: 'failed' as const, validationErrors }
  }

  async status(input: { runId: string }) {
    this.recoverExpiredLeases(input.runId)
    const run = this.requireBuildEpicsRun(input.runId)
    const draft = this.input.db.select().from(buildEpicsDrafts).where(eq(buildEpicsDrafts.runId, input.runId)).get()
    return {
      runId: input.runId,
      runStatus: run.status,
      draftStatus: draft?.status ?? 'building',
      taskCountsByStatus: countByStatus(this.tasksForRun(input.runId)),
    }
  }

  async showDraft(input: { runId: string }) {
    this.requireBuildEpicsRun(input.runId)
    const draft = this.input.db.select().from(buildEpicsDrafts).where(eq(buildEpicsDrafts.runId, input.runId)).get()
    if (!draft) return null
    return {
      status: draft.status,
      plan: draft.draftJson as unknown as BuildEpicsSyncDraftPlan,
      validation: draft.validationJson as { fatal: ValidationIssue[]; warnings: ValidationIssue[] },
    }
  }

  async confirmDraft(input: { runId: string; requestedBy: string }): Promise<BuildEpicsDraftConfirmResult> {
    const run = this.requireBuildEpicsRun(input.runId)
    const draft = this.requireDraft(input.runId)
    if (draft.status !== 'ready') throw new Error('BUILD_EPICS_DRAFT_NOT_READY')

    const plan = stripSyncMetadata(draft.draftJson as unknown as BuildEpicsSyncDraftPlan)
    const validation = validateBuildEpicsDraft(plan, validationPolicy())
    if (validation.fatal.length > 0) throw new Error('BUILD_EPICS_DRAFT_INVALID')

    const docIndex = await loadDocIndexOrEmpty({ db: this.input.db, projectId: run.projectId })
    const confirmedPlan = toConfirmedPlan(plan)
    const validatedPlan = validateEpicPlan(confirmedPlan, docIndex)
    const persistResult = await persistConfirmedEpics({ db: this.input.db, projectId: run.projectId, plan: validatedPlan })
    const draftVersion = plan.version ?? 1
    this.recordEvent(input.runId, null, 'run_confirmed', {
      requested_by: input.requestedBy,
      draft_version: draftVersion,
      confirm_log_id: persistResult.confirmLogId,
    })
    return {
      runId: input.runId,
      draftVersion,
      status: 'confirmed',
      persistResult,
    }
  }

  private insertAssignmentTask(input: {
    runId: string
    projectId: string
    repositoryId: string
    impacts: EpicSyncDocumentImpact[]
    now: string
    maxRetries: number
    targetKey: string
  }): void {
    this.input.db.insert(generationTasks).values({
      id: `task:${randomUUID()}`,
      runId: input.runId,
      projectId: input.projectId,
      repositoryId: input.repositoryId,
      documentType: 'document_assignment',
      targetKey: input.targetKey,
      targetDocumentId: input.targetKey,
      primaryEntryPointId: input.targetKey,
      targetJson: {
        task_type: 'epic_sync_assignment',
        impactedDocumentIds: input.impacts.map((item) => item.documentId),
        impacts: input.impacts,
      },
      status: 'pending',
      retryCount: 0,
      maxRetries: input.maxRetries,
      createdAt: input.now,
      updatedAt: input.now,
    }).run()
  }

  private insertCrossLinksTask(input: {
    runId: string
    projectId: string
    repositoryId: string
    affectedDocumentIds: string[]
    now: string
    maxRetries: number
  }): void {
    const targetKey = 'sync:cross_links:1'
    this.input.db.insert(generationTasks).values({
      id: `task:${randomUUID()}`,
      runId: input.runId,
      projectId: input.projectId,
      repositoryId: input.repositoryId,
      documentType: 'document_assignment',
      targetKey,
      targetDocumentId: targetKey,
      primaryEntryPointId: targetKey,
      targetJson: {
        task_type: 'epic_sync_cross_links',
        affectedDocumentIds: input.affectedDocumentIds,
      },
      status: 'pending',
      retryCount: 0,
      maxRetries: input.maxRetries,
      createdAt: input.now,
      updatedAt: input.now,
    }).run()
  }

  private rejectTask(task: GenerationTask, validationErrors: Array<Record<string, unknown>>, submittedDocument?: Record<string, unknown>) {
    const retryCount = task.retryCount + 1
    const status: GenerationTaskStatus = retryCount > task.maxRetries ? 'failed' : 'repair_requested'
    const now = timestamp()
    this.input.db.update(generationTasks)
      .set({
        status,
        retryCount,
        leaseToken: null,
        leasedBy: null,
        leaseExpiresAt: null,
        lastValidationErrors: validationErrors,
        submittedDocument: submittedDocument ?? null,
        updatedAt: now,
      })
      .where(eq(generationTasks.id, task.id))
      .run()
    if (status === 'failed') {
      this.input.db.update(buildEpicsDrafts)
        .set({
          status: 'invalid',
          validationJson: { fatal: validationErrors, warnings: [] },
          updatedAt: now,
        })
        .where(eq(buildEpicsDrafts.runId, task.runId))
        .run()
      this.input.db.update(generationRuns)
        .set({ status: 'failed', finishedAt: now, updatedAt: now })
        .where(eq(generationRuns.id, task.runId))
        .run()
    }
    this.recordEvent(task.runId, task.id, status === 'failed' ? 'task_failed' : 'task_repair_requested', { validation_errors: validationErrors })
    if (status === 'failed') this.recordEvent(task.runId, null, 'run_failed', { draft_status: 'invalid' })
    return { status, validationErrors }
  }

  private tasksForRun(runId: string): GenerationTask[] {
    return this.input.db.select()
      .from(generationTasks)
      .where(eq(generationTasks.runId, runId))
      .orderBy(asc(generationTasks.targetKey))
      .all()
  }

  private isAssignmentPhaseComplete(runId: string): boolean {
    const tasks = this.tasksForRun(runId)
    const assignmentTasks = tasks.filter((task) => (task.targetJson as { task_type?: string }).task_type === 'epic_sync_assignment')
    const hasCrossTask = tasks.some((task) => (task.targetJson as { task_type?: string }).task_type === 'epic_sync_cross_links')
    return !hasCrossTask && assignmentTasks.length > 0 && assignmentTasks.every((task) => task.status === 'completed')
  }

  private requireBuildEpicsRun(runId: string) {
    const run = this.input.db.select().from(generationRuns).where(eq(generationRuns.id, runId)).get()
    if (!run) throw new Error('BUILD_EPICS_RUN_NOT_FOUND')
    if (run.stage !== 'build_epics') throw new Error('BUILD_EPICS_RUN_STAGE_MISMATCH')
    return run
  }

  private requireDraft(runId: string) {
    const draft = this.input.db.select().from(buildEpicsDrafts).where(eq(buildEpicsDrafts.runId, runId)).get()
    if (!draft) throw new Error('BUILD_EPICS_DRAFT_NOT_FOUND')
    return draft
  }

  private isMatchingSyncRun(runId: string, docSyncPlanId: string): boolean {
    const draft = this.input.db.select().from(buildEpicsDrafts).where(eq(buildEpicsDrafts.runId, runId)).get()
    return (draft?.draftJson as { syncMetadata?: { docSyncPlanId?: string } } | undefined)?.syncMetadata?.docSyncPlanId === docSyncPlanId
  }

  private requireTaskLease(taskId: string, leaseToken: string): GenerationTask {
    const task = this.input.db.select().from(generationTasks).where(eq(generationTasks.id, taskId)).get()
    if (!task || task.leaseToken !== leaseToken || task.status !== 'leased') throw new Error('INVALID_LEASE_TOKEN')
    this.requireBuildEpicsRun(task.runId)
    if (task.documentType !== 'document_assignment' || !SYNC_TASK_TYPES.has((task.targetJson as { task_type?: string }).task_type ?? '')) {
      throw new Error('BUILD_EPICS_SYNC_TASK_TYPE_MISMATCH')
    }
    if (task.leaseExpiresAt && new Date(task.leaseExpiresAt).getTime() <= Date.now()) {
      this.input.db.update(generationTasks)
        .set({ status: 'expired', leaseToken: null, leasedBy: null, leaseExpiresAt: null, updatedAt: timestamp() })
        .where(eq(generationTasks.id, task.id))
        .run()
      throw new Error('LEASE_EXPIRED')
    }
    return task
  }

  private recoverExpiredLeases(runId: string): void {
    const now = Date.now()
    for (const task of this.tasksForRun(runId).filter((row) => row.status === 'leased' && row.leaseExpiresAt && new Date(row.leaseExpiresAt).getTime() <= now)) {
      this.input.db.update(generationTasks)
        .set({ status: 'expired', leaseToken: null, leasedBy: null, leaseExpiresAt: null, updatedAt: timestamp() })
        .where(eq(generationTasks.id, task.id))
        .run()
      this.recordEvent(runId, task.id, 'task_expired', { reason: 'lease_ttl_expired_recovered', lease_expires_at: task.leaseExpiresAt })
    }
  }

  private recordEvent(runId: string, taskId: string | null, eventType: GenerationEventType, payload: Record<string, unknown>): void {
    this.input.db.insert(generationEvents).values({
      id: `event:${randomUUID()}`,
      runId,
      taskId,
      eventType,
      payloadJson: payload,
      createdAt: timestamp(),
    }).run()
  }
}

async function loadDocIndexOrEmpty(input: { db: DB; projectId: string }): Promise<BuildEpicsDocIndex> {
  try {
    return await loadDocIndex({ db: input.db, projectId: input.projectId, documentScope: 'all' })
  } catch (error) {
    if (error instanceof BuildEpicsError && error.code === 'NO_DOCS') {
      return { projectId: input.projectId, apis: [], screens: [], events: [], schedules: [] }
    }
    throw error
  }
}

function stripSyncMetadata(plan: BuildEpicsSyncDraftPlan): PersistedEditablePlan {
  const { syncMetadata: _syncMetadata, ...stripped } = plan
  return stripped
}

function validationPolicy() {
  return { maxReviewRatioWarning: 0.2, maxReviewRatioFatal: 0.35 }
}

function validateAssignmentCoverage(task: GenerationTask, assignments: unknown[]): Array<Record<string, unknown>> {
  const target = task.targetJson as { impactedDocumentIds?: string[] }
  const expectedDocumentIds = new Set(target.impactedDocumentIds ?? [])
  if (expectedDocumentIds.size === 0) return []

  const errors: Array<Record<string, unknown>> = []
  const seenDocumentIds = new Set<string>()
  for (const assignment of assignments) {
    const record = asRecord(assignment)
    const documentId = typeof record.documentId === 'string' ? record.documentId.trim() : ''
    if (!documentId) {
      errors.push({
        severity: 'fatal',
        code: 'INVALID_SYNC_ASSIGNMENT_DOCUMENT',
        message: 'Sync assignment documentId is required.',
      })
      continue
    }
    if (!expectedDocumentIds.has(documentId)) {
      errors.push({
        severity: 'fatal',
        code: 'UNKNOWN_SYNC_ASSIGNMENT_DOCUMENT',
        message: `Sync assignment references non-impacted document ${documentId}`,
        documentId,
      })
    }
    if (seenDocumentIds.has(documentId)) {
      errors.push({
        severity: 'fatal',
        code: 'DUPLICATE_SYNC_ASSIGNMENT_DOCUMENT',
        message: `Sync assignment duplicates impacted document ${documentId}`,
        documentId,
      })
    }
    seenDocumentIds.add(documentId)
  }

  for (const documentId of expectedDocumentIds) {
    if (!seenDocumentIds.has(documentId)) {
      errors.push({
        severity: 'fatal',
        code: 'MISSING_SYNC_ASSIGNMENT_DOCUMENT',
        message: `Missing sync assignment for impacted document ${documentId}`,
        documentId,
      })
    }
  }
  return errors
}

function chunkImpacts(impacts: EpicSyncDocumentImpact[], batchSize: number): EpicSyncDocumentImpact[][] {
  const size = Math.max(1, Math.floor(batchSize))
  const chunks: EpicSyncDocumentImpact[][] = []
  for (let index = 0; index < impacts.length; index += size) {
    chunks.push(impacts.slice(index, index + size))
  }
  return chunks
}

function countByStatus(tasks: GenerationTask[]): Partial<Record<GenerationTaskStatus, number>> {
  return tasks.reduce<Partial<Record<GenerationTaskStatus, number>>>((counts, task) => {
    counts[task.status] = (counts[task.status] ?? 0) + 1
    return counts
  }, {})
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function timestamp(): string {
  return new Date().toISOString()
}
