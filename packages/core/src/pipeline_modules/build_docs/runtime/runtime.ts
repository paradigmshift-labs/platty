import { createHash, randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import {
  docDeps,
  docRelationLinks,
  documents,
  generationContextBundles,
  generationContextPages,
  generationEvents,
  generationRuns,
  generationTasks,
  type GenerationEvent,
  type GenerationEventType,
  type GenerationRun,
  type GenerationRunStatus,
  type GenerationTask,
  type GenerationTaskStatus,
  type TechnicalDocumentType,
} from '@/db/schema/build_docs.js'
import { projectPhaseStatus, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { docSyncPlans, staticMerkleSnapshots } from '@/db/schema/sync.js'
import type { RunKind } from '@/db/schema/enums.js'
import { selectDocumentTargets } from '../source/target_selector.js'
import { buildCodeRelationFacts, buildSourceContext, normalizeTarget } from '../source/context_builder.js'
import { buildServiceMapContext } from '../source/service_map_facts.js'
import { materializeDocumentGraph } from './materialize_document_graph.js'
import { draftSchemaFor, validateDraft } from './draft_contract.js'
import { auditDraftQuality } from './quality_audit.js'
import { mergeSystemDocument, systemRelationFacts } from '../source/system_merge.js'
import { normalizeRelationOperation, relationTarget } from '../source/relation_compactor.js'
import { buildSourceLinkCandidates, resolveSourceLinkSelection } from '../source/source_links.js'
import {
  buildSharedOwnershipIndex,
  compactSourceContextWithSharedSegments,
  loadSharedCodeSegmentsForEntryPoints,
  rebuildSharedCodeSegmentsForProject,
} from '../source/shared_segments.js'
import {
  BUILD_DOCS_GENERATION_SCHEMA_VERSION,
  BUILD_DOCS_LEASE_TTL_MS,
  type BuildDocsGenerationContextResponse,
  type BuildDocsGenerationManifest,
  type BuildDocsGenerationRuntimeInput,
  type BuildDocsNextAction,
  type BuildDocsPreconditionDetails,
  type DocumentTarget,
  type LeasedGenerationTask,
  type LeaseTaskResult,
  type LeaseTasksResult,
  type RelationFactContext,
  type SourceContext,
  type SourceLinkCandidate,
  type SharedCodeSegmentContext,
  type SubmitTaskResult,
  type TaskStatusCounts,
  type ValidationError,
} from './types.js'
import { applyReviewDecisionsToDocumentTargets, listAnalysisReviewDecisions } from '@/pipeline_modules/build_route/review_decisions.js'
import { createDocSyncPlan, listDocSyncCandidates, markDocSyncCandidate } from '@/pipeline_modules/sync/doc_sync.js'
import { createSharedGenerationLeaseEngine } from '@/pipeline_modules/generation_runs/lease_engine.js'

type TechnicalGenerationTask = GenerationTask & { documentType: TechnicalDocumentType }
type WriteDb = DB | Parameters<Parameters<DB['transaction']>[0]>[0]
type BuildDocsStartMode = 'incremental' | 'full'
type DocSyncCandidateSummary = ReturnType<typeof listDocSyncCandidates>['candidates'][number]
type DocSyncTarget = DocSyncCandidateSummary['target']

const activeRunStatuses: GenerationRunStatus[] = ['planning', 'awaiting_approval', 'running']
const releasableTaskStatuses: GenerationTaskStatus[] = ['pending', 'expired', 'repair_requested']
const taskStatuses: GenerationTaskStatus[] = ['pending', 'leased', 'expired', 'submitted', 'repair_requested', 'validated', 'saved', 'failed']
const documentTypes: TechnicalDocumentType[] = ['api_spec', 'screen_spec', 'event_spec', 'schedule_spec']
const requiredRepoPhases = ['build_graph', 'build_pattern_profile', 'build_models', 'build_route', 'build_relations'] as const

interface BuildDocsStartInput {
  projectId: string
  outputLanguage?: 'ko' | 'en'
  requestedBy: string
  mode?: BuildDocsStartMode
  syncPlanId?: string
  includeStaleCandidates?: boolean
}

interface BuildDocsIncrementalPreview {
  mode: 'sync2' | 'full'
  sync_plan_id?: string
  new_document?: number
  stale?: number
  stale_candidate?: number
  orphan_document?: number
  unchanged?: number
  deprecated?: number
  task_planned: number
  skipped_fresh?: number
  review_needed?: number
  orphaned_without_task?: number
  source_unchanged_rebuild?: number
  forced_stale_candidates?: boolean
}

interface BuildDocsPlanningResult {
  taskRows: Array<typeof generationTasks.$inferInsert>
  incremental: BuildDocsIncrementalPreview
}

interface DocSyncCounts {
  unchanged: number
  newDocument: number
  stale: number
  staleCandidate: number
  orphan: number
}

export class BuildDocsGenerationRuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly nextAction?: BuildDocsNextAction,
  ) {
    super(message)
  }
}

export class BuildDocsGenerationRuntime {
  private eventSequence = 0

  constructor(private readonly input: BuildDocsGenerationRuntimeInput) {}

  async start(input: BuildDocsStartInput): Promise<{
    run_id: string
    status: GenerationRunStatus
    active_run: boolean
  }> {
    const db = this.input.db
    const activeRun = db.select()
      .from(generationRuns)
      .where(and(
        eq(generationRuns.projectId, input.projectId),
        eq(generationRuns.stage, 'build_docs'),
        inArray(generationRuns.status, activeRunStatuses),
      ))
      .get()

    if (activeRun) {
      if (activeRun.status !== 'planning' || this.tasksForRun(activeRun.id).length > 0) {
        return { run_id: activeRun.id, status: activeRun.status, active_run: true }
      }
      const failedAt = timestamp()
      db.update(generationRuns)
        .set({ status: 'failed', updatedAt: failedAt, finishedAt: failedAt })
        .where(eq(generationRuns.id, activeRun.id))
        .run()
      this.recordGenerationEvent({
        runId: activeRun.id,
        eventType: 'run_failed',
        payload: { reason: 'stale_planning_run_recovered' },
      })
    }

    this.assertPreconditions(input.projectId)
    await rebuildSharedCodeSegmentsForProject({ db, projectId: input.projectId })

    const repoRows = db.select().from(repositories).where(eq(repositories.projectId, input.projectId)).all()
    const sourceCommit = repoRows.map((repo) => repo.lastSyncedCommit).find((commit): commit is string => !!commit) ?? 'unknown'
    const runId = `gen:${randomUUID()}`
    const now = timestamp()

    db.insert(generationRuns).values({
      id: runId,
      projectId: input.projectId,
      stage: 'build_docs',
      status: 'planning',
      outputLanguage: input.outputLanguage ?? 'ko',
      requestedBy: input.requestedBy,
      sourceCommit,
      createdAt: now,
      updatedAt: now,
    }).run()
    this.recordGenerationEvent({
      runId,
      eventType: 'run_started',
      payload: { stage: 'build_docs', requested_by: input.requestedBy },
    })

    let planning: BuildDocsPlanningResult
    try {
      planning = this.effectiveStartMode(input) === 'incremental'
        ? await this.planIncrementalTasks({
          projectId: input.projectId,
          runId,
          repoRows,
          now,
          syncPlanId: input.syncPlanId,
          includeStaleCandidates: input.includeStaleCandidates,
        })
        : await this.planFullTasks({
          projectId: input.projectId,
          runId,
          repoRows,
          now,
        })
    } catch (error) {
      const failedAt = timestamp()
      db.update(generationRuns)
        .set({ status: 'failed', updatedAt: failedAt, finishedAt: failedAt })
        .where(eq(generationRuns.id, runId))
        .run()
      this.recordGenerationEvent({
        runId,
        eventType: 'run_failed',
        payload: { reason: 'task_planning_failed', error_message: errorMessage(error) },
      })
      throw error
    }

    const taskRows = planning.taskRows
    if (taskRows.length > 0) db.insert(generationTasks).values(taskRows).run()

    const status: GenerationRunStatus = taskRows.length > 0 ? 'awaiting_approval' : 'completed'
    db.update(generationRuns)
      .set({ status, updatedAt: now, finishedAt: status === 'completed' ? now : null })
      .where(eq(generationRuns.id, runId))
      .run()
    this.recordGenerationEvent({
      runId,
      eventType: status === 'completed' ? 'run_completed' : 'run_awaiting_approval',
      payload: { task_count: taskRows.length, incremental: planning.incremental },
    })

    return { run_id: runId, status, active_run: false }
  }

  async preview(input: { runId: string }): Promise<{
    run_id: string
    total_task_count: number
    task_counts_by_document_type: Record<TechnicalDocumentType, number>
    task_counts_by_repository: Record<string, number>
    batch_options: number[]
    skip_fresh_task_count: number
    blockers: string[]
    incremental: BuildDocsIncrementalPreview
    metadata: ReturnType<typeof metadataFor>
  }> {
    const run = this.requireRun(input.runId)
    const tasks = this.tasksForRun(input.runId)
    const incremental = this.incrementalPreviewForRun(input.runId, tasks)
    return {
      run_id: input.runId,
      total_task_count: tasks.length,
      task_counts_by_document_type: countTasksByDocumentType(tasks),
      task_counts_by_repository: countTasksByRepository(tasks),
      batch_options: batchOptionsFor(tasks.length),
      skip_fresh_task_count: incremental.skipped_fresh ?? 0,
      blockers: [],
      incremental,
      metadata: metadataFor(run),
    }
  }

  async approve(input: { runId: string; maxConcurrentTasks: number; approvedBy: string }): Promise<{
    run_id: string
    approved_concurrency: number
    approved_at: string
    pending_task_count: number
  }> {
    this.requireRun(input.runId)
    const approvedAt = timestamp()
    const approvedConcurrency = Math.max(1, Math.floor(input.maxConcurrentTasks))

    this.input.db.update(generationRuns)
      .set({
        status: 'running',
        maxConcurrentTasks: approvedConcurrency,
        approvedBy: input.approvedBy,
        approvedAt,
        updatedAt: approvedAt,
      })
      .where(eq(generationRuns.id, input.runId))
      .run()
    this.recordGenerationEvent({
      runId: input.runId,
      eventType: 'batch_approved',
      payload: { max_concurrent_tasks: approvedConcurrency, approved_by: input.approvedBy },
    })

    return {
      run_id: input.runId,
      approved_concurrency: approvedConcurrency,
      approved_at: approvedAt,
      pending_task_count: this.tasksForRun(input.runId).filter((task) => task.status === 'pending').length,
    }
  }

  async leaseTask(input: { runId: string; workerId: string; documentTypes?: TechnicalDocumentType[] }): Promise<LeaseTaskResult> {
    const batch = await this.leaseTasks({
      runId: input.runId,
      workerGroupId: input.workerId,
      limit: 1,
      documentTypes: input.documentTypes,
    })
    if (batch.type === 'not_approved') return batch
    const leased = batch.leased_tasks[0]
    if (!leased) {
      return {
        type: 'no_task_available',
        run_id: input.runId,
        remaining_pending_task_count: batch.remaining_pending_task_count,
      }
    }
    return leased
  }

  async leaseTasks(input: { runId: string; workerGroupId: string; limit: number; documentTypes?: TechnicalDocumentType[] }): Promise<LeaseTasksResult> {
    const run = this.requireRun(input.runId)
    this.recoverExpiredLeases(input.runId)
    const refreshedRun = this.input.db.select().from(generationRuns).where(eq(generationRuns.id, input.runId)).get() ?? run

    if (refreshedRun.status !== 'running' || refreshedRun.maxConcurrentTasks <= 0) {
      if (refreshedRun.status === 'completed' || refreshedRun.status === 'failed' || refreshedRun.status === 'cancelled') {
        return {
          type: 'tasks',
          run_id: input.runId,
          leased_tasks: [],
          actual_lease_count: 0,
          remaining_pending_task_count: this.tasksForRun(input.runId).filter((task) => releasableTaskStatuses.includes(task.status)).length,
        }
      }
      return { type: 'not_approved', run_id: input.runId, run_status: refreshedRun.status }
    }

    const tasks = this.tasksForRun(input.runId)
    const activeLeaseCount = tasks.filter((task) => task.status === 'leased').length
    const openLeaseSlots = Math.max(0, refreshedRun.maxConcurrentTasks - activeLeaseCount)
    const allowedCount = Math.max(0, Math.min(Math.floor(input.limit), openLeaseSlots))
    const requestedTypes = input.documentTypes ? new Set(input.documentTypes) : null
    const leased = createSharedGenerationLeaseEngine({
      db: this.input.db,
      stage: 'build_docs',
      leaseTtlMs: BUILD_DOCS_LEASE_TTL_MS,
    }).acquireLeases({
      runId: input.runId,
      workerId: input.workerGroupId,
      limit: allowedCount,
      taskKinds: requestedTypes ? [...requestedTypes] : undefined,
      isReady: isTechnicalGenerationTask,
    })
    const leasedTasks = leased.leasedTasks.map((lease) => toLeasedTask(
      lease.task as TechnicalGenerationTask,
      lease.leaseToken,
      lease.leaseExpiresAt,
    ))

    return {
      type: 'tasks',
      run_id: input.runId,
      leased_tasks: leasedTasks,
      actual_lease_count: leasedTasks.length,
      remaining_pending_task_count: this.tasksForRun(input.runId).filter((task) => releasableTaskStatuses.includes(task.status)).length,
    }
  }

  async getContext(input: { taskId: string; leaseToken: string }): Promise<BuildDocsGenerationContextResponse> {
    const task = this.requireTaskLease(input.taskId, input.leaseToken)
    const run = this.requireRun(task.runId)
    const context = this.buildContext(run, requireTechnicalGenerationTask(task))
    this.persistContext(run, task, context)
    return context
  }

  async getContextPage(input: { contextHandle: string; pageToken: string; leaseToken: string }): Promise<
    | { type: 'not_found'; context_handle: string; page_token: string }
    | {
        type: 'context_page'
        context_handle: string
        page_token: string
        page_content: Record<string, unknown>
        next_page_token: string | null
        page_summary: string
        included_evidence_ids: string[]
      }
  > {
    const bundle = this.input.db.select().from(generationContextBundles)
      .where(eq(generationContextBundles.contextHandle, input.contextHandle))
      .get()
    if (!bundle) return { type: 'not_found', context_handle: input.contextHandle, page_token: input.pageToken }
    this.requireTaskLease(bundle.taskId, input.leaseToken)

    const pages = this.input.db.select().from(generationContextPages)
      .where(eq(generationContextPages.contextHandle, input.contextHandle))
      .all()
      .sort((a, b) => a.pageOrder - b.pageOrder)
    const pageIndex = pages.findIndex((page) => page.pageId === input.pageToken)
    const page = pages[pageIndex]
    if (!page) return { type: 'not_found', context_handle: input.contextHandle, page_token: input.pageToken }

    return {
      type: 'context_page',
      context_handle: input.contextHandle,
      page_token: input.pageToken,
      page_content: page.contentJson,
      next_page_token: pages[pageIndex + 1]?.pageId ?? null,
      page_summary: page.summary,
      included_evidence_ids: page.evidenceIdsJson,
    }
  }

  async submitTask(input: { taskId: string; leaseToken: string; document: unknown; workerNotes?: string }): Promise<SubmitTaskResult> {
    const task = this.requireTaskLease(input.taskId, input.leaseToken)
    const technicalTask = requireTechnicalGenerationTask(task)
    const run = this.requireRun(task.runId)
    const context = this.readPersistedContext(task)
    const submittedDraft = isRecord(input.document) ? input.document : { raw: input.document }
    const draftErrors = context ? validateDraft(submittedDraft, technicalTask.documentType) : []
    const sourceLinkErrors = context && technicalTask.documentType === 'api_spec' && !hasSourceLinkSelectionShapeErrors(draftErrors)
      ? (() => {
          const resolved = resolveSourceLinkSelection(
            submittedDraft.source_link_selection,
            context.content.source_link_candidates ?? [],
          )
          return resolved.ok ? [] : resolved.errors
        })()
      : []
    const errors = context
      ? [
          ...draftErrors,
          ...sourceLinkErrors,
          ...auditDraftQuality({ document: submittedDraft, context }),
        ]
      : [{
          code: 'CONTEXT_NOT_PREPARED',
          path: '$.context',
          message: 'Call platty docs context get before platty docs tasks submit.',
        }]
    const mergedDocument = context ? mergeSystemDocument({ draft: submittedDraft, context }) : submittedDraft
    const submittedAt = timestamp()

    this.input.db.update(generationTasks)
      .set({
        status: 'submitted',
        submittedDocument: mergedDocument,
        updatedAt: submittedAt,
      })
      .where(eq(generationTasks.id, task.id))
      .run()
    this.recordGenerationEvent({
      runId: run.id,
      taskId: task.id,
      eventType: 'task_submitted',
      payload: {
        document_type: task.documentType,
        target_key: task.targetKey,
        worker_notes: input.workerNotes ?? null,
      },
    })

    if (errors.length > 0) {
      return this.markRepairOrFailed(task, run, errors, mergedDocument)
    }

    const validatedAt = timestamp()
    this.input.db.update(generationTasks)
      .set({
        status: 'validated',
        lastValidationErrors: [],
        submittedDocument: mergedDocument,
        updatedAt: validatedAt,
      })
      .where(eq(generationTasks.id, task.id))
      .run()
    this.recordGenerationEvent({
      runId: run.id,
      taskId: task.id,
      eventType: 'task_validated',
      payload: { content_hash: hashJson(mergedDocument) },
    })

    try {
      this.persistDocument({
        run,
        task: technicalTask,
        context: context!,
        document: mergedDocument,
        rawDraft: submittedDraft,
      })
    } catch (error) {
      const saveError: ValidationError = {
        code: 'DB_SAVE_FAILED',
        path: '$',
        message: errorMessage(error),
      }
      return this.markTaskFailed(task, run, [saveError], mergedDocument)
    }

    const savedDocumentId = String(mergedDocument.id)
    const savedAt = timestamp()
    this.input.db.update(generationTasks)
      .set({
        status: 'saved',
        leaseToken: null,
        leasedBy: null,
        leaseExpiresAt: null,
        lastValidationErrors: [],
        submittedDocument: mergedDocument,
        savedDocumentId,
        updatedAt: savedAt,
      })
      .where(eq(generationTasks.id, task.id))
      .run()
    this.recordGenerationEvent({
      runId: run.id,
      taskId: task.id,
      eventType: 'task_saved',
      payload: { saved_document_id: savedDocumentId },
    })
    this.refreshRunCompletion(run.id)

    return {
      status: 'saved',
      validation_errors: [],
      saved_document_id: savedDocumentId,
      next_recommended_action: 'continue',
    }
  }

  async status(input: { runId: string }): Promise<{
    run_id: string
    run_status: GenerationRunStatus
    task_counts_by_status: TaskStatusCounts
    recent_events: Array<Record<string, unknown>>
    failed_tasks: Array<{ task_id: string; document_type: TechnicalDocumentType; target_key: string }>
    saved_document_count: number
    metadata: ReturnType<typeof metadataFor>
  }> {
    this.recoverExpiredLeases(input.runId)
    const run = this.refreshRunCompletion(input.runId)
    const tasks = this.tasksForRun(input.runId)
    const counts = countTasksByStatus(tasks)
    return {
      run_id: input.runId,
      run_status: run.status,
      task_counts_by_status: counts,
      recent_events: this.input.db.select()
        .from(generationEvents)
        .where(eq(generationEvents.runId, input.runId))
        .orderBy(asc(generationEvents.id))
        .limit(50)
        .all()
        .map(toStatusEvent),
      failed_tasks: tasks
        .filter((task) => task.status === 'failed')
        .filter(isTechnicalGenerationTask)
        .map((task) => ({ task_id: task.id, document_type: task.documentType, target_key: task.targetKey })),
      saved_document_count: counts.saved,
      metadata: metadataFor(run),
    }
  }

  async cancel(input: { runId: string; reason?: string }): Promise<{
    run_id: string
    status: 'cancelled'
    reclaimed_active_lease_count: number
  }> {
    this.requireRun(input.runId)
    const activeLeases = this.tasksForRun(input.runId).filter((task) => task.status === 'leased')
    const now = timestamp()
    for (const task of activeLeases) {
      this.input.db.update(generationTasks)
        .set({ status: 'expired', leaseToken: null, leasedBy: null, leaseExpiresAt: null, updatedAt: now })
        .where(eq(generationTasks.id, task.id))
        .run()
      this.recordGenerationEvent({
        runId: input.runId,
        taskId: task.id,
        eventType: 'task_expired',
        payload: { reason: input.reason ?? 'cancelled' },
      })
    }
    this.input.db.update(generationRuns)
      .set({ status: 'cancelled', updatedAt: now, finishedAt: now })
      .where(eq(generationRuns.id, input.runId))
      .run()
    this.recordGenerationEvent({
      runId: input.runId,
      eventType: 'run_cancelled',
      payload: { reason: input.reason ?? null, reclaimed_active_lease_count: activeLeases.length },
    })
    return { run_id: input.runId, status: 'cancelled', reclaimed_active_lease_count: activeLeases.length }
  }

  async releaseActiveLeases(input: { runId: string; reason?: string }): Promise<{
    run_id: string
    run_status: GenerationRunStatus
    released_lease_count: number
  }> {
    this.requireRun(input.runId)
    const released = createSharedGenerationLeaseEngine({
      db: this.input.db,
      stage: 'build_docs',
      leaseTtlMs: BUILD_DOCS_LEASE_TTL_MS,
    }).releaseActiveLeases(input.runId, input.reason)
    return {
      run_id: input.runId,
      run_status: released.runStatus as GenerationRunStatus,
      released_lease_count: released.releasedLeaseCount,
    }
  }

  private assertPreconditions(projectId: string): void {
    const details = verifyBuildDocsPreconditions(this.input.db, projectId)
    if (details.missing.length === 0 && details.stale.length === 0 && details.failed.length === 0) return
    const nextAction = nextActionForPrecondition(details)
    throw new BuildDocsGenerationRuntimeError(
      'BUILD_DOCS_PRECONDITION_FAILED',
      `build_docs requires completed upstream static analysis before generation can start. Run ${nextAction.stage} first.`,
      details,
      nextAction,
    )
  }

  private effectiveStartMode(input: BuildDocsStartInput): BuildDocsStartMode {
    if (input.mode) return input.mode
    if (input.syncPlanId) return 'incremental'
    const snapshotCount = this.input.db.select({ id: staticMerkleSnapshots.id })
      .from(staticMerkleSnapshots)
      .where(eq(staticMerkleSnapshots.projectId, input.projectId))
      .all().length
    return snapshotCount >= 2 ? 'incremental' : 'full'
  }

  private async planFullTasks(input: {
    projectId: string
    runId: string
    repoRows: Array<typeof repositories.$inferSelect>
    now: string
  }): Promise<BuildDocsPlanningResult> {
    const taskRows: Array<typeof generationTasks.$inferInsert> = []
    const selected = await this.selectCurrentTargetsForPlanning(input)
    for (const mapped of selected.targetByCandidateKey.values()) {
      taskRows.push(this.taskRowForTarget({
        runId: input.runId,
        projectId: input.projectId,
        repoId: mapped.repoId,
        target: mapped.target,
        now: input.now,
      }))
    }
    return {
      taskRows,
      incremental: {
        mode: 'full',
        task_planned: taskRows.length,
        ...(selected.deprecatedCount > 0 ? { deprecated: selected.deprecatedCount } : {}),
      },
    }
  }

  private async planIncrementalTasks(input: {
    projectId: string
    runId: string
    repoRows: Array<typeof repositories.$inferSelect>
    now: string
    syncPlanId?: string
    includeStaleCandidates?: boolean
  }): Promise<BuildDocsPlanningResult> {
    const plan = this.resolveDocSyncPlan(input.projectId, input.syncPlanId)
    const candidateList = listDocSyncCandidates({
      db: this.input.db,
      planId: plan.planId,
      phase: 'technical',
    }).candidates
    const pendingCandidates = candidateList.filter((candidate) => candidate.status === 'pending')
    const candidateTargetKeys = new Set(candidateList.map((candidate) => candidateTargetKey(candidate.target)))
    const selected = await this.selectCurrentTargetsForPlanning(input)
    const taskRows: Array<typeof generationTasks.$inferInsert> = []
    let reviewNeeded = 0
    let orphanedWithoutTask = 0
    let skippedFresh = 0
    let sourceUnchangedRebuild = 0

    for (const candidate of pendingCandidates) {
      if (candidate.kind === 'orphan_document') {
        if (this.markOrphanDocument(input.projectId, candidate.target, input.now)) orphanedWithoutTask += 1
        markDocSyncCandidate({
          db: this.input.db,
          planId: plan.planId,
          candidateId: candidate.candidateId,
          decision: 'orphan',
          rationale: 'technical target no longer exists',
        })
        continue
      }

      if (candidate.kind === 'stale_candidate' && !input.includeStaleCandidates) {
        reviewNeeded += 1
        continue
      }
      if (candidate.kind !== 'new_document' && candidate.kind !== 'stale' && candidate.kind !== 'stale_candidate') continue

      const mapped = selected.targetByCandidateKey.get(candidateTargetKey(candidate.target))
      if (!mapped) {
        reviewNeeded += 1
        continue
      }
      if (candidate.kind === 'stale') this.markExistingDocumentStale(input.projectId, candidate.target, input.now)
      taskRows.push(this.taskRowForTarget({
        runId: input.runId,
        projectId: input.projectId,
        repoId: mapped.repoId,
        target: mapped.target,
        now: input.now,
        sync: candidate,
      }))
    }

    for (const [targetKey, mapped] of selected.targetByCandidateKey) {
      if (candidateTargetKeys.has(targetKey)) continue
      const freshness = this.documentFreshnessForTarget(input.projectId, mapped.repoId, mapped.target)
      if (freshness.fresh) {
        skippedFresh += 1
        continue
      }
      if (freshness.document) this.markExistingDocumentStale(input.projectId, freshness.syncTarget, input.now)
      sourceUnchangedRebuild += 1
      taskRows.push(this.taskRowForTarget({
        runId: input.runId,
        projectId: input.projectId,
        repoId: mapped.repoId,
        target: mapped.target,
        now: input.now,
        syncPayload: sourceUnchangedRebuildPayloadFor({
          existingDocumentSourceHash: freshness.document?.documentSourceHash ?? null,
          latestDocumentSourceHash: freshness.sourceStamp.documentSourceHash,
        }),
      }))
    }

    return {
      taskRows,
      incremental: incrementalPreviewFromCounts({
        mode: 'sync2',
        planId: plan.planId,
        counts: plan.counts,
        taskPlanned: taskRows.length,
        skippedFresh,
        reviewNeeded,
        orphanedWithoutTask,
        sourceUnchangedRebuild,
        deprecated: selected.deprecatedCount,
        includeStaleCandidates: Boolean(input.includeStaleCandidates),
      }),
    }
  }

  private resolveDocSyncPlan(projectId: string, syncPlanId?: string): {
    planId: string
    counts: DocSyncCounts
  } {
    if (syncPlanId) {
      const plan = this.input.db.select().from(docSyncPlans).where(eq(docSyncPlans.id, syncPlanId)).get()
      if (!plan || plan.projectId !== projectId) {
        throw new BuildDocsGenerationRuntimeError('DOC_SYNC_PLAN_NOT_FOUND', `Doc sync plan not found for project: ${syncPlanId}`)
      }
      return { planId: plan.id, counts: docSyncCountsFromJson(plan.countsJson) }
    }
    const created = createDocSyncPlan({
      db: this.input.db,
      projectId,
      fromSnapshotId: 'last_applied',
      toSnapshotId: 'latest',
      scope: { track: 'technical' },
    })
    return { planId: created.planId, counts: created.counts }
  }

  private async selectCurrentTargetsForPlanning(input: {
    projectId: string
    repoRows: Array<typeof repositories.$inferSelect>
    now: string
  }): Promise<{
    targetByCandidateKey: Map<string, { target: DocumentTarget; repoId: string }>
    deprecatedCount: number
  }> {
    const targetByCandidateKey = new Map<string, { target: DocumentTarget; repoId: string }>()
    let deprecatedCount = 0
    for (const repo of input.repoRows) {
      const selectedTargets = await selectDocumentTargets(repo.id, this.input.db, input.projectId)
      const decisions = listAnalysisReviewDecisions(this.input.db, {
        projectId: input.projectId,
        repoId: repo.id,
      }).map((decision) => ({
        targetId: decision.targetId,
        decision: decision.decision,
        decidedAt: decision.decidedAt,
      }))
      const { included, excluded } = applyReviewDecisionsToDocumentTargets(selectedTargets, decisions)
      deprecatedCount += excluded.length
      for (const entry of excluded) this.markDeprecatedDocument(input.projectId, entry.target, input.now)
      for (const target of included) {
        targetByCandidateKey.set(candidateTargetKeyFromDocumentTarget(target, repo.id), { target, repoId: repo.id })
      }
    }
    return { targetByCandidateKey, deprecatedCount }
  }

  private taskRowForTarget(input: {
    runId: string
    projectId: string
    repoId: string
    target: DocumentTarget
    now: string
    sync?: DocSyncCandidateSummary
    syncPayload?: Record<string, unknown>
  }): typeof generationTasks.$inferInsert {
    return {
      id: `task:${randomUUID()}`,
      runId: input.runId,
      projectId: input.projectId,
      repositoryId: input.repoId,
      documentType: input.target.documentType,
      targetKey: input.target.targetKey,
      targetDocumentId: input.target.documentId,
      primaryEntryPointId: input.target.primaryEntryPointId,
      targetJson: {
        ...input.target,
        repository_id: input.repoId,
        ...(input.sync ? { sync: syncPayloadFor(input.sync) } : {}),
        ...(!input.sync && input.syncPayload ? { sync: input.syncPayload } : {}),
      },
      status: 'pending',
      retryCount: 0,
      maxRetries: 2,
      createdAt: input.now,
      updatedAt: input.now,
    }
  }

  private markExistingDocumentStale(projectId: string, target: DocSyncTarget, now: string): boolean {
    const document = this.findDocumentBySyncTarget(projectId, target)
    if (!document) return false
    this.input.db.update(documents)
      .set({ validity: 'stale', updatedBy: 'system', updatedAt: now })
      .where(eq(documents.id, document.id))
      .run()
    return true
  }

  private markOrphanDocument(projectId: string, target: DocSyncTarget, now: string): boolean {
    const document = this.findDocumentBySyncTarget(projectId, target)
    if (!document) return false
    this.input.db.update(documents)
      .set({ status: 'deleted', validity: 'orphaned', updatedBy: 'system', updatedAt: now })
      .where(eq(documents.id, document.id))
      .run()
    return true
  }

  private markDeprecatedDocument(projectId: string, target: DocumentTarget, now: string): boolean {
    return this.markOrphanDocument(projectId, {
      track: 'technical',
      type: target.documentType,
      scope: documentScopeFor(target.documentType),
      scopeId: target.primaryEntryPointId,
      repoId: null,
    }, now)
  }

  private findDocumentBySyncTarget(projectId: string, target: DocSyncTarget): typeof documents.$inferSelect | null {
    const rows = this.input.db.select().from(documents).where(eq(documents.projectId, projectId)).all()
    return rows.find((document) => (
      document.track === target.track
        && document.type === target.type
        && document.scope === target.scope
        && document.scopeId === target.scopeId
    )) ?? null
  }

  private documentFreshnessForTarget(projectId: string, repoId: string, target: DocumentTarget): {
    fresh: boolean
    document: typeof documents.$inferSelect | null
    sourceStamp: { staticSnapshotId: string | null; documentSourceHash: string | null }
    syncTarget: DocSyncTarget
  } {
    const syncTarget = syncTargetFromDocumentTarget(target, repoId)
    const document = this.findDocumentBySyncTarget(projectId, syncTarget)
    const sourceStamp = staticDocumentSourceStamp(this.input.db, {
      projectId,
      documentType: target.documentType,
      scope: syncTarget.scope,
      scopeId: target.primaryEntryPointId,
      repoId,
    })
    const fresh = Boolean(
      document
        && document.validity === 'fresh'
        && (document.status === 'passed' || document.status === 'active')
        && sourceStamp.documentSourceHash
        && document.documentSourceHash === sourceStamp.documentSourceHash,
    )
    return { fresh, document, sourceStamp, syncTarget }
  }

  private incrementalPreviewForRun(runId: string, tasks: GenerationTask[]): BuildDocsIncrementalPreview {
    const events = this.input.db.select().from(generationEvents)
      .where(eq(generationEvents.runId, runId))
      .orderBy(asc(generationEvents.id))
      .all()
      .reverse()
    for (const event of events) {
      const payload = event.payloadJson
      if (!isRecord(payload) || !isRecord(payload.incremental)) continue
      return normalizeIncrementalPreview(payload.incremental, tasks.length)
    }
    return { mode: 'full', task_planned: tasks.length }
  }

  private buildContext(run: GenerationRun, task: TechnicalGenerationTask): BuildDocsGenerationContextResponse {
    const target = normalizeTarget({
      targetJson: task.targetJson,
      targetDocumentId: task.targetDocumentId,
      documentType: task.documentType,
      primaryEntryPointId: task.primaryEntryPointId,
      targetKey: task.targetKey,
      repositoryId: task.repositoryId,
    })
    const namespace = `platty:${run.id}:${task.id}`
    const codeRelationFacts = buildCodeRelationFacts({
      db: this.input.db,
      repoId: task.repositoryId,
      seedNodeIds: target.seed_node_ids,
      namespace,
    })
    const { sourceContext: rawSourceContext, evidenceGaps } = buildSourceContext({
      db: this.input.db,
      repoId: task.repositoryId,
      seedNodeIds: target.seed_node_ids,
      entryPointIds: target.entry_point_ids,
      codeRelationFacts,
      namespace,
      repoPath: this.repoPathFor(task.repositoryId),
    })
    const { serviceMapFacts, relatedEdges } = buildServiceMapContext({
      db: this.input.db,
      projectId: task.projectId,
      repoId: task.repositoryId,
      documentType: task.documentType,
      entryPointIds: target.entry_point_ids,
      namespace,
      evidenceOffset: codeRelationFacts.length,
    })
    const sharedContext = loadSharedCodeSegmentsForEntryPoints({
      db: this.input.db,
      projectId: task.projectId,
      entryPointIds: target.entry_point_ids,
    })
    const protectedNodeIds = new Set<string>([
      ...target.seed_node_ids,
      ...codeRelationFacts.flatMap((fact) => fact.evidence_node_ids),
      ...serviceMapFacts.flatMap((fact) => fact.evidence_node_ids),
    ])
    const sharedOwnershipIndex = buildSharedOwnershipIndex({
      db: this.input.db,
      repoId: task.repositoryId,
      seedNodeIds: target.seed_node_ids,
      sharedSegments: sharedContext,
      protectedNodeIds,
    })
    const compactedSource = compactSourceContextWithSharedSegments({
      sourceContext: rawSourceContext,
      sharedSegments: sharedContext,
      protectedNodeIds,
      sharedOwnershipIndex,
    })
    const sourceContext = compactedSource.sourceContext
    const sharedContextForAgent = compactSharedContextForAgent(sharedContext)
    const sourceLinkCandidates = buildSourceLinkCandidates(sourceContext)
    const handler = sourceContext[0]?.symbol
    if (handler) target.handler = handler

    const schema = draftSchemaFor(task.documentType)
    const evidenceIds = [
      `${namespace}:target`,
      `${namespace}:schema`,
      ...sourceContext.map((source) => source.evidence_id),
      ...codeRelationFacts.map((fact) => fact.evidence_id),
      ...serviceMapFacts.map((fact) => fact.evidence_id),
      ...relatedEdges.map((edge) => edge.evidence_id),
    ]
    const manifest: BuildDocsGenerationManifest = {
      context_handle: `ctx:${task.id}`,
      task_id: task.id,
      schema_version: BUILD_DOCS_GENERATION_SCHEMA_VERSION,
      required_pages: ['target', 'schema', 'source_context'],
      optional_pages: [
        ...(sharedContext.length > 0 ? ['shared_context'] : []),
        'source_link_candidates',
        'code_relation_facts',
        'service_map_facts',
        'related_edges',
        'evidence_gaps',
      ],
      evidence_ids: evidenceIds,
      page_token_budget_estimates: {
        target: 400,
        schema: 1200,
        source_context: Math.max(400, sourceContext.length * 300),
        ...(sharedContext.length > 0 ? { shared_context: Math.max(300, sharedContext.length * 250) } : {}),
        source_link_candidates: Math.max(200, sourceLinkCandidates.length * 120),
      },
      source_context_compaction: compactedSource.metadata,
    }
    const relationFacts = [...codeRelationFacts, ...serviceMapFacts]

    return {
      metadata: metadataFor(run, task.id),
      manifest,
      content: {
        target,
        source_context: sourceContext,
        shared_context: sharedContextForAgent,
        source_context_compaction: compactedSource.metadata,
        source_link_candidates: sourceLinkCandidates,
        code_relation_facts: codeRelationFacts,
        service_map_facts: serviceMapFacts,
        related_edges: relatedEdges,
        schema,
        rules: schema.output_rules,
        evidence_gaps: evidenceGaps,
        evidence_reference_rules: {
          allowed_evidence_ids: evidenceIds,
          required: true,
        },
        source_excerpts: sourceContext,
        relation_facts: relationFacts,
      },
    }
  }

  private persistContext(run: GenerationRun, task: GenerationTask, context: BuildDocsGenerationContextResponse): void {
    const db = this.input.db
    db.delete(generationContextPages).where(eq(generationContextPages.contextHandle, context.manifest.context_handle)).run()
    db.delete(generationContextBundles).where(eq(generationContextBundles.contextHandle, context.manifest.context_handle)).run()
    db.insert(generationContextBundles).values({
      contextHandle: context.manifest.context_handle,
      runId: run.id,
      taskId: task.id,
      sourceCommit: run.sourceCommit,
      schemaVersion: BUILD_DOCS_GENERATION_SCHEMA_VERSION,
      manifestJson: context.manifest,
      contentHash: hashJson(context.content),
      createdAt: timestamp(),
    }).run()

    const pages: Array<typeof generationContextPages.$inferInsert> = [
      pageRow(context, 'target', 'target', 0, 'Document target', [context.manifest.evidence_ids[0]], context.content.target),
      pageRow(context, 'schema', 'schema', 1, 'Draft schema and system-injected fields', [context.manifest.evidence_ids[1]], context.content.schema),
      pageRow(context, 'source_context', 'source_context', 2, 'Source context normalized by Platty', context.content.source_context.map((source) => source.evidence_id), { source_context: context.content.source_context }),
    ]
    let pageOrder = 3
    if (context.content.shared_context && context.content.shared_context.length > 0) {
      pages.push(pageRow(
        context,
        'shared_context',
        'shared_context',
        pageOrder,
        'Shared code segment summaries used by this target',
        sharedContextEvidenceIds(context.content.shared_context),
        { shared_context: context.content.shared_context },
      ))
      pageOrder += 1
    }
    pages.push(
      pageRow(
        context,
        'source_link_candidates',
        'source_link_candidates',
        pageOrder,
        'Source link candidates selectable by the draft writer',
        (context.content.source_link_candidates ?? []).map((candidate) => candidate.evidence_id),
        { source_link_candidates: context.content.source_link_candidates ?? [] },
      ),
      pageRow(context, 'code_relation_facts', 'code_relation_facts', pageOrder + 1, 'Deterministic code relation facts from build_relations', context.content.code_relation_facts.map((fact) => fact.evidence_id), { code_relation_facts: context.content.code_relation_facts }),
      pageRow(context, 'service_map_facts', 'service_map_facts', pageOrder + 2, 'Outgoing service-map facts from build_service_map', context.content.service_map_facts.map((fact) => fact.evidence_id), { service_map_facts: context.content.service_map_facts }),
      pageRow(context, 'related_edges', 'related_edges', pageOrder + 3, 'Related incoming and outgoing service-map edges for context only', context.content.related_edges.map((edge) => edge.evidence_id), { related_edges: context.content.related_edges }),
    )
    db.insert(generationContextPages).values(pages).run()
  }

  private repoPathFor(repositoryId: string): string | null {
    return this.input.db.select({ repoPath: repositories.repoPath })
      .from(repositories)
      .where(eq(repositories.id, repositoryId))
      .get()?.repoPath ?? null
  }

  private readPersistedContext(task: GenerationTask): BuildDocsGenerationContextResponse | null {
    const bundle = this.input.db.select().from(generationContextBundles)
      .where(eq(generationContextBundles.taskId, task.id))
      .get()
    if (!bundle) return null
    const run = this.input.db.select().from(generationRuns).where(eq(generationRuns.id, task.runId)).get()
    if (!run) return null
    const pages = this.input.db.select().from(generationContextPages)
      .where(eq(generationContextPages.contextHandle, bundle.contextHandle))
      .all()
    const contentByPage = new Map(pages.map((page) => [page.pageId, page.contentJson]))
    const target = contentByPage.get('target')
    const schema = contentByPage.get('schema')
    const sourceContextPage = contentByPage.get('source_context')
    const sharedContextPage = contentByPage.get('shared_context')
    const sourceLinkPage = contentByPage.get('source_link_candidates')
    const codeRelationPage = contentByPage.get('code_relation_facts')
    const serviceMapPage = contentByPage.get('service_map_facts')
    const relatedEdgesPage = contentByPage.get('related_edges')
    const sourceContext = arrayFromPage(sourceContextPage, 'source_context') as SourceContext[]
    const sharedContext = arrayFromPage(sharedContextPage, 'shared_context') as SharedCodeSegmentContext[]
    const sourceLinkCandidates = arrayFromPage(sourceLinkPage, 'source_link_candidates') as SourceLinkCandidate[]
    const codeRelationFacts = arrayFromPage(codeRelationPage, 'code_relation_facts') as RelationFactContext[]
    const serviceMapFacts = arrayFromPage(serviceMapPage, 'service_map_facts') as RelationFactContext[]
    const relatedEdges = arrayFromPage(relatedEdgesPage, 'related_edges')
    const manifest = bundle.manifestJson as unknown as BuildDocsGenerationManifest
    if (!isGenerationManifest(manifest) || !isRecord(target) || !isRecord(schema)) return null
    const relationFacts = [...codeRelationFacts, ...serviceMapFacts]
    return {
      metadata: metadataFor(run, task.id),
      manifest,
      content: {
        target: target as BuildDocsGenerationContextResponse['content']['target'],
        source_context: sourceContext,
        shared_context: sharedContext,
        source_context_compaction: manifest.source_context_compaction,
        source_link_candidates: sourceLinkCandidates,
        code_relation_facts: codeRelationFacts,
        service_map_facts: serviceMapFacts,
        related_edges: relatedEdges as BuildDocsGenerationContextResponse['content']['related_edges'],
        schema: schema as BuildDocsGenerationContextResponse['content']['schema'],
        rules: Array.isArray(schema.output_rules) ? schema.output_rules.filter(isString) : [],
        evidence_gaps: [],
        evidence_reference_rules: {
          allowed_evidence_ids: manifest.evidence_ids,
          required: true,
        },
        source_excerpts: sourceContext,
        relation_facts: relationFacts,
      },
    }
  }

  private persistDocument(input: {
    run: GenerationRun
    task: TechnicalGenerationTask
    context: BuildDocsGenerationContextResponse
    document: Record<string, unknown>
    rawDraft: Record<string, unknown>
  }): void {
    const savedAt = timestamp()
    const documentId = String(input.document.id)
    const scope = documentScopeFor(input.task.documentType)
    const sourceStamp = staticDocumentSourceStamp(this.input.db, {
      projectId: input.task.projectId,
      documentType: input.task.documentType,
      scope,
      scopeId: input.task.primaryEntryPointId,
      repoId: input.task.repositoryId,
    })
    const contentHash = hashJson(input.document)
    const deps = buildDocDeps(documentId, input.context.content.source_context)
    const relationLinks = buildDocRelationLinks(documentId, systemRelationFacts(input.context))

    this.input.db.transaction((tx) => {
      tx.insert(documents)
        .values({
          id: documentId,
          projectId: input.task.projectId,
          type: input.task.documentType,
          track: 'technical',
          scope,
          scopeId: input.task.primaryEntryPointId,
          status: 'passed',
          validity: 'fresh',
          summary: stringOrNull(input.document.summary),
          content: input.document,
          rawLlmOutput: JSON.stringify(input.rawDraft),
          contentHash,
          documentSourceHash: sourceStamp.documentSourceHash,
          staticSnapshotId: sourceStamp.staticSnapshotId,
          sourceRunId: input.run.id,
          sourceCommit: input.run.sourceCommit,
          updatedBy: 'llm',
          updatedAt: savedAt,
        })
        .onConflictDoUpdate({
          target: documents.id,
          set: {
            status: 'passed',
            validity: 'fresh',
            summary: stringOrNull(input.document.summary),
            content: input.document,
            rawLlmOutput: JSON.stringify(input.rawDraft),
            scope,
            scopeId: input.task.primaryEntryPointId,
            contentHash,
            documentSourceHash: sourceStamp.documentSourceHash,
            staticSnapshotId: sourceStamp.staticSnapshotId,
            sourceRunId: input.run.id,
            sourceCommit: input.run.sourceCommit,
            updatedBy: 'llm',
            updatedAt: savedAt,
          },
        })
        .run()
      replaceDocDeps(tx, documentId, deps)
      replaceDocRelationLinks(tx, documentId, relationLinks)
    })
  }

  private markRepairOrFailed(
    task: GenerationTask,
    run: GenerationRun,
    errors: ValidationError[],
    submittedDocument: Record<string, unknown>,
  ): SubmitTaskResult {
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
        lastValidationErrors: errors,
        submittedDocument,
        updatedAt: now,
      })
      .where(eq(generationTasks.id, task.id))
      .run()
    this.recordGenerationEvent({
      runId: run.id,
      taskId: task.id,
      eventType: status === 'failed' ? 'task_failed' : 'task_repair_requested',
      payload: { retry_count: retryCount, validation_errors: errors },
    })
    this.refreshRunCompletion(run.id)
    return {
      status,
      validation_errors: errors,
      saved_document_id: null,
      next_recommended_action: status === 'failed' ? 'stop' : 'regenerate_task',
    }
  }

  private markTaskFailed(
    task: GenerationTask,
    run: GenerationRun,
    errors: ValidationError[],
    submittedDocument: Record<string, unknown>,
  ): SubmitTaskResult {
    const now = timestamp()
    this.input.db.update(generationTasks)
      .set({
        status: 'failed',
        leaseToken: null,
        leasedBy: null,
        leaseExpiresAt: null,
        lastValidationErrors: errors,
        submittedDocument,
        updatedAt: now,
      })
      .where(eq(generationTasks.id, task.id))
      .run()
    this.recordGenerationEvent({
      runId: run.id,
      taskId: task.id,
      eventType: 'task_failed',
      payload: { validation_errors: errors },
    })
    this.refreshRunCompletion(run.id)
    return {
      status: 'failed',
      validation_errors: errors,
      saved_document_id: null,
      next_recommended_action: 'stop',
    }
  }

  private refreshRunCompletion(runId: string): GenerationRun {
    const run = this.requireRun(runId)
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return run
    const tasks = this.tasksForRun(runId)
    const complete = tasks.length > 0 && tasks.every((task) => task.status === 'saved' || task.status === 'failed')
    if (!complete) return run
    const status: GenerationRunStatus = tasks.some((task) => task.status === 'failed') ? 'failed' : 'completed'
    const now = timestamp()
    this.input.db.update(generationRuns)
      .set({ status, updatedAt: now, finishedAt: now })
      .where(eq(generationRuns.id, runId))
      .run()
    this.recordGenerationEvent({
      runId,
      eventType: status === 'failed' ? 'run_failed' : 'run_completed',
      payload: { saved_count: tasks.filter((task) => task.status === 'saved').length },
    })
    // run이 종료되면(전부 성공이든 일부 실패든) build_service_map의 연결선을 그대로 가져와 문서끼리 연결한다.
    // 'completed'로만 게이트하면 task 하나만 실패해도 프로젝트 전체 document_links가 안 생긴다(영구 누락 가능).
    // materialize는 프로젝트 전역 idempotent이고 status='passed' 문서만 잇는다(실패/미생성 문서는 자동 제외)라
    // 일부 실패 run에서도 성공 문서끼리는 안전하게 연결된다. doc-gen은 연결을 재계산하지 않는다 — service_map이
    // 단일 출처. (better-sqlite3 동기 실행)
    void materializeDocumentGraph({ db: this.input.db, projectId: run.projectId, repoId: '', runId })
    return this.input.db.select().from(generationRuns).where(eq(generationRuns.id, runId)).get() ?? run
  }

  private requireRun(runId: string): GenerationRun {
    const run = this.input.db.select().from(generationRuns).where(eq(generationRuns.id, runId)).get()
    if (!run) throw new BuildDocsGenerationRuntimeError('BUILD_DOCS_RUN_NOT_FOUND', `Build docs generation run not found: ${runId}`)
    if (run.stage !== 'build_docs') throw new BuildDocsGenerationRuntimeError('BUILD_DOCS_RUN_STAGE_MISMATCH', `Build docs runtime cannot use stage: ${run.stage}`)
    return run
  }

  private requireTaskLease(taskId: string, leaseToken: string): GenerationTask {
    const task = this.input.db.select().from(generationTasks).where(eq(generationTasks.id, taskId)).get()
    if (!task) throw new BuildDocsGenerationRuntimeError('BUILD_DOCS_TASK_NOT_FOUND', `Build docs generation task not found: ${taskId}`)
    this.requireRun(task.runId)
    if (task.status !== 'leased' || task.leaseToken !== leaseToken) {
      throw new BuildDocsGenerationRuntimeError('INVALID_LEASE_TOKEN', `Lease token is not valid for task: ${taskId}`)
    }
    if (task.leaseExpiresAt && new Date(task.leaseExpiresAt).getTime() <= Date.now()) {
      this.input.db.update(generationTasks)
        .set({ status: 'expired', leaseToken: null, leasedBy: null, leaseExpiresAt: null, updatedAt: timestamp() })
        .where(eq(generationTasks.id, task.id))
        .run()
      throw new BuildDocsGenerationRuntimeError('LEASE_EXPIRED', `Lease expired for task: ${taskId}`)
    }
    return task
  }

  private tasksForRun(runId: string): GenerationTask[] {
    return this.input.db.select().from(generationTasks).where(eq(generationTasks.runId, runId)).all()
  }

  private recoverExpiredLeases(runId: string): void {
    const now = timestamp()
    const nowMs = Date.parse(now)
    for (const task of this.tasksForRun(runId)) {
      if (task.status !== 'leased' || !task.leaseExpiresAt) continue
      if (Date.parse(task.leaseExpiresAt) > nowMs) continue
      this.input.db.update(generationTasks)
        .set({ status: 'expired', leaseToken: null, leasedBy: null, leaseExpiresAt: null, updatedAt: now })
        .where(eq(generationTasks.id, task.id))
        .run()
      this.recordGenerationEvent({
        runId,
        taskId: task.id,
        eventType: 'task_expired',
        payload: { reason: 'lease_ttl_expired_recovered', lease_expires_at: task.leaseExpiresAt },
      })
    }
  }

  private recordGenerationEvent(input: {
    runId: string
    taskId?: string
    eventType: GenerationEventType
    payload?: Record<string, unknown>
  }): void {
    this.eventSequence += 1
    this.input.db.insert(generationEvents).values({
      id: `evt:${String(this.eventSequence).padStart(12, '0')}:${randomUUID()}`,
      runId: input.runId,
      taskId: input.taskId ?? null,
      eventType: input.eventType,
      payloadJson: input.payload ?? {},
      createdAt: timestamp(),
    }).run()
  }
}

export function verifyBuildDocsPreconditions(db: DB, projectId: string): BuildDocsPreconditionDetails {
  const repos = db.select().from(repositories).where(eq(repositories.projectId, projectId)).all()
  const missing: string[] = []
  const stale: string[] = []
  const failed: string[] = []
  let latestRelationsAt = 0

  for (const repo of repos) {
    const phases = db.select().from(repositoryPhaseStatus).where(eq(repositoryPhaseStatus.repositoryId, repo.id)).all()
    const phaseByName = new Map(phases.map((phase) => [phase.phase, phase]))
    for (const phase of requiredRepoPhases) {
      const row = phaseByName.get(phase)
      const key = `${repo.id}:${phase}`
      if (!row?.builtAt) {
        missing.push(key)
        continue
      }
      if (row.status !== 'passed' || row.validity !== 'fresh') {
        failed.push(key)
        continue
      }
      if (phase === 'build_relations') latestRelationsAt = Math.max(latestRelationsAt, phaseTime(row.builtAt))
    }
  }

  const servicePhase = db.select().from(projectPhaseStatus)
    .where(and(eq(projectPhaseStatus.projectId, projectId), eq(projectPhaseStatus.phase, 'build_service_map')))
    .get()
  if (!servicePhase) {
    missing.push('project:build_service_map')
  } else if (servicePhase.status !== 'passed') {
    failed.push('project:build_service_map')
  } else if (phaseTime(servicePhase.updatedAt) < latestRelationsAt) {
    stale.push('project:build_service_map')
  }

  return { missing, stale, failed }
}

function nextActionForPrecondition(details: BuildDocsPreconditionDetails): BuildDocsNextAction {
  const first = [...details.missing, ...details.stale, ...details.failed][0] ?? 'project:build_service_map'
  const stage = stageFromPreconditionKey(first)
  return {
    type: 'run_required_stage',
    stage,
    command: ['platty', 'run'],
  }
}

function stageFromPreconditionKey(key: string): BuildDocsNextAction['stage'] {
  for (const stage of ['build_service_map', 'build_graph', 'build_pattern_profile', 'build_models', 'build_route', 'build_relations'] as const) {
    if (key.endsWith(stage)) return stage
  }
  return 'build_service_map'
}

function candidateTargetKey(target: DocSyncTarget): string {
  return `${target.type}:${target.scope}:${target.scopeId ?? ''}:${target.repoId ?? ''}`
}

function syncTargetFromDocumentTarget(target: DocumentTarget, repoId: string): DocSyncTarget {
  return {
    track: 'technical',
    type: target.documentType,
    scope: documentScopeFor(target.documentType),
    scopeId: target.primaryEntryPointId,
    repoId,
  }
}

function candidateTargetKeyFromDocumentTarget(target: DocumentTarget, repoId: string): string {
  return candidateTargetKey(syncTargetFromDocumentTarget(target, repoId))
}

function syncPayloadFor(candidate: DocSyncCandidateSummary): Record<string, unknown> {
  return {
    candidate_id: candidate.candidateId,
    candidate_kind: candidate.kind,
    phase: candidate.phase,
    status: candidate.status,
    old_hash: candidate.oldHash,
    new_hash: candidate.newHash,
    reason_summary: candidate.reasonSummary,
    target: {
      track: candidate.target.track,
      type: candidate.target.type,
      scope: candidate.target.scope,
      scope_id: candidate.target.scopeId,
      repo_id: candidate.target.repoId ?? null,
    },
  }
}

function sourceUnchangedRebuildPayloadFor(input: {
  existingDocumentSourceHash: string | null
  latestDocumentSourceHash: string | null
}): Record<string, unknown> {
  return {
    candidate_kind: 'source_unchanged_rebuild',
    phase: 'technical',
    status: 'pending',
    old_hash: input.existingDocumentSourceHash,
    new_hash: input.latestDocumentSourceHash,
    reason_summary: 'Source hash is unchanged, but the generated document is missing or not stamped fresh.',
  }
}

function docSyncCountsFromJson(value: unknown): DocSyncCounts {
  const record = isRecord(value) ? value : {}
  return {
    unchanged: numberFrom(record.unchanged),
    newDocument: numberFrom(record.newDocument),
    stale: numberFrom(record.stale),
    staleCandidate: numberFrom(record.staleCandidate),
    orphan: numberFrom(record.orphan),
  }
}

function incrementalPreviewFromCounts(input: {
  mode: 'sync2'
  planId: string
  counts: DocSyncCounts
  taskPlanned: number
  skippedFresh: number
  reviewNeeded: number
  orphanedWithoutTask: number
  sourceUnchangedRebuild: number
  deprecated: number
  includeStaleCandidates: boolean
}): BuildDocsIncrementalPreview {
  return {
    mode: input.mode,
    sync_plan_id: input.planId,
    new_document: input.counts.newDocument,
    stale: input.counts.stale,
    stale_candidate: input.counts.staleCandidate,
    orphan_document: input.counts.orphan,
    unchanged: input.counts.unchanged,
    task_planned: input.taskPlanned,
    skipped_fresh: input.skippedFresh,
    review_needed: input.reviewNeeded,
    orphaned_without_task: input.orphanedWithoutTask,
    source_unchanged_rebuild: input.sourceUnchangedRebuild,
    ...(input.deprecated > 0 ? { deprecated: input.deprecated } : {}),
    ...(input.includeStaleCandidates ? { forced_stale_candidates: true } : {}),
  }
}

function normalizeIncrementalPreview(value: Record<string, unknown>, fallbackTaskCount: number): BuildDocsIncrementalPreview {
  const mode = value.mode === 'sync2' ? 'sync2' : 'full'
  return {
    mode,
    ...(typeof value.sync_plan_id === 'string' ? { sync_plan_id: value.sync_plan_id } : {}),
    ...(value.new_document != null ? { new_document: numberFrom(value.new_document) } : {}),
    ...(value.stale != null ? { stale: numberFrom(value.stale) } : {}),
    ...(value.stale_candidate != null ? { stale_candidate: numberFrom(value.stale_candidate) } : {}),
    ...(value.orphan_document != null ? { orphan_document: numberFrom(value.orphan_document) } : {}),
    ...(value.unchanged != null ? { unchanged: numberFrom(value.unchanged) } : {}),
    ...(value.deprecated != null ? { deprecated: numberFrom(value.deprecated) } : {}),
    task_planned: value.task_planned != null ? numberFrom(value.task_planned) : fallbackTaskCount,
    ...(value.skipped_fresh != null ? { skipped_fresh: numberFrom(value.skipped_fresh) } : {}),
    ...(value.review_needed != null ? { review_needed: numberFrom(value.review_needed) } : {}),
    ...(value.orphaned_without_task != null ? { orphaned_without_task: numberFrom(value.orphaned_without_task) } : {}),
    ...(value.source_unchanged_rebuild != null ? { source_unchanged_rebuild: numberFrom(value.source_unchanged_rebuild) } : {}),
    ...(value.forced_stale_candidates === true ? { forced_stale_candidates: true } : {}),
  }
}

function sharedContextEvidenceIds(sharedContext: SharedCodeSegmentContext[]): string[] {
  return sharedContext.flatMap((segment) =>
    segment.summary.source_refs.map((ref) => `${segment.segment_id}:${ref.node_id}`),
  )
}

function compactSharedContextForAgent(sharedContext: SharedCodeSegmentContext[]): SharedCodeSegmentContext[] {
  return sharedContext.map((segment) => ({
    segment_id: segment.segment_id,
    root_node_id: segment.root_node_id,
    root_symbol: segment.root_symbol,
    root_file_path: segment.root_file_path,
    detector_version: segment.detector_version,
    summary_schema_version: segment.summary_schema_version,
    used_by_entrypoint_count: segment.used_by_entrypoint_count,
    summary: segment.summary,
  }))
}

function pageRow(
  context: BuildDocsGenerationContextResponse,
  pageId: string,
  pageKind: string,
  pageOrder: number,
  summary: string,
  evidenceIds: string[],
  content: Record<string, unknown>,
): typeof generationContextPages.$inferInsert {
  return {
    contextHandle: context.manifest.context_handle,
    pageId,
    pageKind,
    pageOrder,
    summary,
    evidenceIdsJson: evidenceIds,
    contentJson: content,
    contentHash: hashJson(content),
    createdAt: timestamp(),
  }
}

function buildDocDeps(documentId: string, sourceContext: SourceContext[]): Array<typeof docDeps.$inferInsert> {
  const seen = new Set<string>()
  const rows: Array<typeof docDeps.$inferInsert> = []
  for (const source of sourceContext) {
    const key = `${documentId}:${source.node_id}:${source.dep_type}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      documentId,
      codeNodeId: source.node_id,
      depType: source.dep_type,
    })
  }
  return rows
}

function buildDocRelationLinks(documentId: string, facts: RelationFactContext[]): Array<typeof docRelationLinks.$inferInsert> {
  const seen = new Set<string>()
  const rows: Array<typeof docRelationLinks.$inferInsert> = []
  for (const fact of facts) {
    const key = `${documentId}:${fact.source}:${fact.relation_id}:${fact.canonical_target ?? fact.target ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      documentId,
      relationId: fact.source === 'deterministic' ? fact.relation_id : null,
      repoId: fact.repo_id,
      sourceNodeId: fact.source_node_id,
      kind: fact.kind,
      target: fact.target,
      operation: fact.operation,
      canonicalTarget: fact.canonical_target ?? canonicalizeRelationFact(fact),
      payloadJson: fact.payload,
      evidenceNodeIdsJson: fact.evidence_node_ids,
      confidence: fact.confidence,
      unresolvedReason: fact.unresolved_reason,
    })
  }
  return rows
}

function replaceDocDeps(db: WriteDb, documentId: string, rows: Array<typeof docDeps.$inferInsert>): void {
  db.delete(docDeps).where(eq(docDeps.documentId, documentId)).run()
  for (const row of rows) db.insert(docDeps).values(row).run()
}

function replaceDocRelationLinks(db: WriteDb, documentId: string, rows: Array<typeof docRelationLinks.$inferInsert>): void {
  db.delete(docRelationLinks).where(eq(docRelationLinks.documentId, documentId)).run()
  for (const row of rows) db.insert(docRelationLinks).values(row).run()
}

function canonicalizeRelationFact(fact: RelationFactContext): string | null {
  if (fact.kind === 'db_access') {
    const table = relationTarget(fact, 'table')
    return table ? `db:${table}:${normalizeRelationOperation(relationTarget(fact, 'operation') ?? fact.operation)}` : null
  }
  if (fact.kind === 'api_call') {
    const path = relationTarget(fact, 'path') ?? fact.target
    return path ? `${(fact.operation ?? 'UNKNOWN').toUpperCase()} ${path}` : null
  }
  if (fact.kind === 'navigation') {
    const path = relationTarget(fact, 'path') ?? fact.target
    return path ? `screen:${path}` : null
  }
  if (fact.kind === 'external_service') {
    const system = relationTarget(fact, 'system') ?? fact.target
    return system ? `external_service:${system}` : null
  }
  if (fact.kind === 'external_link') {
    const url = relationTarget(fact, 'url') ?? fact.target
    return url ? `external:${url}` : null
  }
  if (fact.kind === 'event_publish' || fact.kind === 'event_listen') {
    const event = relationTarget(fact, 'event') ?? fact.target
    return event ? `node_event:${event}` : null
  }
  return fact.target
}

function metadataFor(run: GenerationRun, taskId?: string) {
  return {
    run_id: run.id,
    ...(taskId ? { task_id: taskId } : {}),
    schema_version: BUILD_DOCS_GENERATION_SCHEMA_VERSION,
    source_commit: run.sourceCommit,
    generated_at: timestamp(),
    evidence_id_namespace: taskId ? `platty:${run.id}:${taskId}` : `platty:${run.id}`,
  }
}

function toStatusEvent(event: GenerationEvent): Record<string, unknown> {
  return {
    event_id: event.id,
    run_id: event.runId,
    task_id: event.taskId,
    event_type: event.eventType,
    payload: event.payloadJson,
    created_at: event.createdAt,
  }
}

function countTasksByDocumentType(tasks: GenerationTask[]): Record<TechnicalDocumentType, number> {
  const counts = Object.fromEntries(documentTypes.map((type) => [type, 0])) as Record<TechnicalDocumentType, number>
  for (const task of tasks) {
    if (isTechnicalGenerationTask(task)) counts[task.documentType] += 1
  }
  return counts
}

function countTasksByRepository(tasks: GenerationTask[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const task of tasks) counts[task.repositoryId] = (counts[task.repositoryId] ?? 0) + 1
  return counts
}

function countTasksByStatus(tasks: GenerationTask[]): TaskStatusCounts {
  const counts = Object.fromEntries(taskStatuses.map((status) => [status, 0])) as TaskStatusCounts
  for (const task of tasks) counts[task.status] += 1
  return counts
}

function batchOptionsFor(totalTaskCount: number): number[] {
  return [1, 5, 10, 20].filter((option) => option <= Math.max(1, totalTaskCount))
}

function toLeasedTask(task: TechnicalGenerationTask, leaseToken: string, leaseExpiresAt: string): LeasedGenerationTask {
  return {
    type: 'task',
    task_id: task.id,
    lease_token: leaseToken,
    document_type: task.documentType,
    target_summary: task.targetKey,
    lease_expires_at: leaseExpiresAt,
  }
}

function arrayFromPage(page: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(page)) return []
  const value = page[key]
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isGenerationManifest(value: unknown): value is BuildDocsGenerationManifest {
  return isRecord(value)
    && typeof value.context_handle === 'string'
    && typeof value.task_id === 'string'
    && Array.isArray(value.evidence_ids)
}

function isTechnicalGenerationTask(task: GenerationTask): task is TechnicalGenerationTask {
  return documentTypes.includes(task.documentType as TechnicalDocumentType)
}

function requireTechnicalGenerationTask(task: GenerationTask): TechnicalGenerationTask {
  if (!isTechnicalGenerationTask(task)) {
    throw new BuildDocsGenerationRuntimeError('UNSUPPORTED_GENERATION_TASK_TYPE', `Unsupported build_docs task type: ${task.documentType}`)
  }
  return task
}

function documentScopeFor(documentType: TechnicalDocumentType): string {
  if (documentType === 'api_spec') return 'route'
  if (documentType === 'screen_spec') return 'screen'
  if (documentType === 'event_spec') return 'event'
  return 'job'
}

function staticDocumentSourceStamp(
  db: DB,
  target: {
    projectId: string
    documentType: TechnicalDocumentType
    scope: string
    scopeId: string
    repoId: string
  },
): { staticSnapshotId: string | null; documentSourceHash: string | null } {
  const snapshots = db.select()
    .from(staticMerkleSnapshots)
    .where(eq(staticMerkleSnapshots.projectId, target.projectId))
    .all()
    .sort((a, b) => `${b.createdAt}:${b.id}`.localeCompare(`${a.createdAt}:${a.id}`))

  for (const snapshot of snapshots) {
    const entry = findStaticHashEntry(snapshot.hashSetJson, {
      track: 'technical',
      type: target.documentType,
      scope: target.scope,
      scopeId: target.scopeId,
      repoId: target.repoId,
    })
    if (entry) {
      return {
        staticSnapshotId: snapshot.id,
        documentSourceHash: entry.hash,
      }
    }
  }
  return { staticSnapshotId: null, documentSourceHash: null }
}

function findStaticHashEntry(
  hashSet: Record<string, unknown>,
  target: { track: string; type: string; scope: string; scopeId: string; repoId: string },
): { hash: string } | null {
  for (const key of ['technicalDocumentSourceHashes', 'routeDocumentSourceHashes']) {
    const entries = hashSet[key]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.hash !== 'string') continue
      const entryTarget = entry.target
      if (!isRecord(entryTarget)) continue
      if (
        entryTarget.track === target.track &&
        entryTarget.type === target.type &&
        entryTarget.scope === target.scope &&
        entryTarget.scopeId === target.scopeId &&
        entryTarget.repoId === target.repoId
      ) {
        return { hash: entry.hash }
      }
    }
  }
  return null
}

function phaseTime(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (!value) return 0
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberFrom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function hasSourceLinkSelectionShapeErrors(errors: ValidationError[]): boolean {
  return errors.some((error) => (
    error.path.startsWith('$.source_link_selection')
      && (error.code === 'QUALITY_FIELD_SHAPE' || error.code === 'FORBIDDEN_DRAFT_FIELD')
  ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function timestamp(): string {
  return new Date().toISOString()
}
