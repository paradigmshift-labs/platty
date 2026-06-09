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
  type GenerationTaskKind,
  type GenerationTaskStatus,
} from '@/db/schema/build_docs.js'
import { buildEpicsDrafts } from '@/db/schema/build_epics.js'
import { repositories } from '@/db/schema/core.js'
import { applyEpicDraftCommands, type EpicDraftCommand } from '@/pipeline_modules/build_epics/core/editable_draft.js'
import { assertBuildDocsComplete } from '@/pipeline_modules/build_epics/core/f0_assert_docs_complete.js'
import { loadDocIndex } from '@/pipeline_modules/build_epics/core/f1_load_doc_index.js'
import { validateEpicPlan } from '@/pipeline_modules/build_epics/core/f9_validate_plan.js'
import { persistConfirmedEpics } from '@/pipeline_modules/build_epics/core/f10_persist_confirmed_epics.js'
import type { BuildEpicsDocIndex } from '@/pipeline_modules/build_epics/core/types.js'
import { validateAssignmentSubmission } from './assignment_validation.js'
import { findLatestResumableGenerationRun, reopenFailedGenerationRun } from '@/pipeline_modules/generation_runs/resumable_run_resolver.js'
import { upsertProjectPhaseStatus } from '@/pipeline_infra/phase/phase_status.js'
import { packBuildEpicsDocumentCards } from '../source/cards.js'
import { buildOwnerMap, validateCrossDomainSubmission, type CrossDomainSubmission } from '../source/cross_domain.js'
import {
  buildDraftFromRuntimeSubmissions,
  validateBuildEpicsDraft,
  type AssignmentSubmission,
  type TaxonomyCandidateSubmission,
} from './draft.js'
import { summarizeEditCommands, toConfirmedPlan, toEditableDraft, toPersistedPlan, type PersistedEditablePlan } from './editing.js'
import { resolveBuildEpicsRuntimePolicy } from './policy.js'
import {
  normalizeConsolidatedTaxonomySubmission,
  validateConsolidatedTaxonomySubmission,
  type TaxonomyConsolidationSubmission,
} from '../source/taxonomy_consolidation.js'
import type { BuildEpicsDocumentCard, BuildEpicsDraftConfirmResult, BuildEpicsDraftEditResult, BuildEpicsRuntimePolicyInput, ResolvedBuildEpicsRuntimePolicy } from './types.js'

const SCHEMA_VERSION = 'build_epics_cli_runtime_v1'
const LEASE_TTL_MS = 15 * 60 * 1000
const RELEASABLE_TASK_STATUSES: GenerationTaskStatus[] = ['pending', 'expired', 'repair_requested']
const FINAL_TASK_STATUSES: GenerationTaskStatus[] = ['completed', 'failed']

export class BuildEpicsCliRuntime {
  constructor(private readonly input: { db: DB }) {}

  async resumeLatestInterruptedRun(input: { projectId: string }) {
    const run = findLatestResumableGenerationRun(this.input.db, {
      projectId: input.projectId,
      stage: 'build_epics',
      includeRun: (candidate) => !this.isEpicsSyncRun(candidate.id),
    })
    if (!run) return null
    const resumed = reopenFailedGenerationRun(this.input.db, run)
    return { runId: resumed.id, status: resumed.status as 'running', policy: {} }
  }

  async preview(input: { projectId: string; outputLanguage?: 'ko' | 'en'; policy?: BuildEpicsRuntimePolicyInput }) {
    await assertBuildDocsComplete({ db: this.input.db, projectId: input.projectId, allowFailedDocs: input.policy?.allowPartialBuildDocs })
    const docIndex = await loadDocIndex({ db: this.input.db, projectId: input.projectId, documentScope: 'all' })
    const cards = packBuildEpicsDocumentCards(docIndex)
    const policy = resolveBuildEpicsRuntimePolicy(
      { ...input.policy, outputLanguage: input.outputLanguage ?? input.policy?.outputLanguage ?? 'ko' },
      { totalAssignableDocs: assignableDocs(docIndex), totalDocumentCards: cards.length },
    )

    return {
      projectId: input.projectId,
      documentCounts: documentCounts(docIndex),
      blockers: [],
      recommendedPolicy: policy,
      estimatedTasks: {
        taxonomy_candidate: policy.resolvedTaxonomyTaskCount,
        taxonomy_consolidation: policy.resolvedTaxonomyConsolidationTaskCount,
        document_assignment: policy.resolvedAssignmentTaskCount,
        cross_domain_link: policy.resolvedCrossDomainTaskCount,
      },
      warnings: [],
    }
  }

  async start(input: { projectId: string; policy?: ResolvedBuildEpicsRuntimePolicy | BuildEpicsRuntimePolicyInput; requestedBy: string }) {
    const requestedPolicy = input.policy ?? {}
    await assertBuildDocsComplete({ db: this.input.db, projectId: input.projectId, allowFailedDocs: requestedPolicy.allowPartialBuildDocs })
    const docIndex = await loadDocIndex({ db: this.input.db, projectId: input.projectId, documentScope: 'all' })
    const cards = packBuildEpicsDocumentCards(docIndex)
    const policy = resolveBuildEpicsRuntimePolicy(requestedPolicy, {
      totalAssignableDocs: assignableDocs(docIndex),
      totalDocumentCards: cards.length,
    })
    const repo = this.input.db.select().from(repositories).where(eq(repositories.projectId, input.projectId)).get()
    if (!repo) throw new Error('BUILD_EPICS_REPOSITORY_REQUIRED')

    const runId = `gen:build_epics:${randomUUID()}`
    const now = timestamp()
    this.input.db.insert(generationRuns).values({
      id: runId,
      projectId: input.projectId,
      stage: 'build_epics',
      status: 'running',
      outputLanguage: policy.outputLanguage,
      requestedBy: input.requestedBy,
      sourceCommit: repo.lastSyncedCommit ?? 'unknown',
      maxConcurrentTasks: policy.maxWorkerCount,
      approvedBy: input.requestedBy,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    }).run()
    this.recordEvent(runId, null, 'run_started', { stage: 'build_epics' })
    this.insertTasks(runId, input.projectId, repo.id, policy, cards)

    return { runId, status: 'running' as const, policy }
  }

  async leaseTasks(input: { runId: string; limit: number; workerId: string }) {
    const run = this.requireBuildEpicsRun(input.runId)
    this.recoverExpiredLeases(input.runId)
    if (run.status !== 'running') {
      return { runId: input.runId, leasedTasks: [], remainingPendingTaskCount: 0 }
    }

    const tasks = this.tasksForRun(input.runId)
    const activeLeaseCount = tasks.filter((task) => task.status === 'leased').length
    const openLeaseSlots = Math.max(0, run.maxConcurrentTasks - activeLeaseCount)
    const selected = tasks
      .filter((task) => RELEASABLE_TASK_STATUSES.includes(task.status))
      .filter((task) => isTaskReadyForLease(task, tasks))
      .sort(compareRuntimeTasks)
      .slice(0, Math.min(Math.max(0, Math.floor(input.limit)), openLeaseSlots))
    const leaseExpiresAt = new Date(Date.now() + LEASE_TTL_MS).toISOString()

    const leasedTasks = selected.map((task) => {
      const leaseToken = `lease:${randomUUID()}`
      this.input.db.update(generationTasks)
        .set({
          status: 'leased',
          leaseToken,
          leasedBy: input.workerId,
          leaseExpiresAt,
          updatedAt: timestamp(),
        })
        .where(and(
          eq(generationTasks.id, task.id),
          inArray(generationTasks.status, RELEASABLE_TASK_STATUSES),
        ))
        .run()
      const leasedTask = this.input.db.select()
        .from(generationTasks)
        .where(and(eq(generationTasks.id, task.id), eq(generationTasks.leaseToken, leaseToken)))
        .get()
      if (!leasedTask) return null
      this.recordEvent(input.runId, task.id, 'task_leased', { worker_id: input.workerId })
      return {
        type: 'task' as const,
        taskId: task.id,
        taskType: task.documentType,
        targetKey: task.targetKey,
        leaseToken,
        leaseExpiresAt,
      }
    }).filter((task): task is NonNullable<typeof task> => task !== null)

    return {
      runId: input.runId,
      leasedTasks,
      remainingPendingTaskCount: this.tasksForRun(input.runId).filter((task) => RELEASABLE_TASK_STATUSES.includes(task.status)).length,
    }
  }

  async getContext(input: { taskId: string; leaseToken: string }) {
    const task = this.requireTaskLease(input.taskId, input.leaseToken)
    const run = this.requireBuildEpicsRun(task.runId)
    const content = await this.contextContent(task)
    const contentHash = hashJson(content)
    const contextHandle = `ctx:${task.id}`
    const manifest = {
      runId: run.id,
      taskId: task.id,
      schemaVersion: SCHEMA_VERSION,
      evidenceNamespace: `platty:build_epics:${run.id}:${task.id}`,
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
      summary: `${task.documentType} context`,
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
    const validationErrors = await this.validateTaskResult(task, input.result, this.tasksForRun(run.id))
    const submittedDocument = asRecord(input.result)
    const now = timestamp()

    if (validationErrors.length > 0) {
      const retryCount = task.retryCount + 1
      const status: GenerationTaskStatus = retryCount > task.maxRetries ? 'failed' : 'repair_requested'
      this.input.db.update(generationTasks)
        .set({
          status,
          retryCount,
          leaseToken: null,
          leasedBy: null,
          leaseExpiresAt: null,
          lastValidationErrors: validationErrors,
          submittedDocument,
          updatedAt: now,
        })
        .where(eq(generationTasks.id, task.id))
        .run()
      this.recordEvent(run.id, task.id, status === 'failed' ? 'task_failed' : 'task_repair_requested', { validation_errors: validationErrors })
      if (status === 'failed' && task.documentType === 'taxonomy_candidate') this.failPendingAssignments(run.id, validationErrors)
      await this.ensureCrossDomainTasks(run.id)
      await this.refreshDraft(run.id)
      return { status, validationErrors }
    }

    this.input.db.update(generationTasks)
      .set({
        status: 'completed',
        submittedDocument,
        leaseToken: null,
        leasedBy: null,
        leaseExpiresAt: null,
        lastValidationErrors: [],
        updatedAt: now,
      })
      .where(eq(generationTasks.id, task.id))
      .run()
    this.recordEvent(run.id, task.id, 'task_completed', { task_type: task.documentType })
    await this.ensureCrossDomainTasks(run.id)
    await this.refreshDraft(run.id)
    return { status: 'completed' as const, validationErrors: [] }
  }

  async status(input: { runId: string }) {
    this.recoverExpiredLeases(input.runId)
    await this.ensureCrossDomainTasks(input.runId)
    await this.refreshDraft(input.runId)
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
      plan: draft.draftJson,
      validation: draft.validationJson,
    }
  }

  async validate(input: { runId: string }) {
    this.requireBuildEpicsRun(input.runId)
    await this.refreshDraft(input.runId)
    return (await this.showDraft(input))?.validation ?? { fatal: [], warnings: [] }
  }

  async editDraft(input: {
    runId: string
    expectedVersion: number
    commands: EpicDraftCommand[]
    requestedBy: string
  }): Promise<BuildEpicsDraftEditResult> {
    const run = this.requireBuildEpicsRun(input.runId)
    const draft = this.input.db.select().from(buildEpicsDrafts).where(eq(buildEpicsDrafts.runId, input.runId)).get()
    if (!draft) throw new Error('BUILD_EPICS_DRAFT_NOT_FOUND')
    if (draft.status === 'building') throw new Error('BUILD_EPICS_DRAFT_NOT_READY')
    const confirmedEvent = this.input.db.select()
      .from(generationEvents)
      .where(and(eq(generationEvents.runId, input.runId), eq(generationEvents.eventType, 'run_confirmed')))
      .get()
    if (confirmedEvent) throw new Error('BUILD_EPICS_DRAFT_ALREADY_CONFIRMED')

    const previousPlan = draft.draftJson as unknown as PersistedEditablePlan
    const previousVersion = previousPlan.version ?? 1
    const editableDraft = toEditableDraft({
      draftId: draft.id,
      projectId: run.projectId,
      plan: previousPlan,
    })
    const editedDraft = applyEpicDraftCommands(editableDraft, input.commands, { expectedVersion: input.expectedVersion })
    const persistedPlan = toPersistedPlan(editedDraft)
    const tasks = this.tasksForRun(input.runId)
    const validation = validateBuildEpicsDraft(persistedPlan, validationPolicyForRun(tasks))
    persistedPlan.validationIssues = validation.fatal
    const status = validation.fatal.length > 0 ? 'invalid' : 'ready'
    const changeSummary = summarizeEditCommands(input.commands)
    const now = timestamp()

    this.input.db.update(buildEpicsDrafts)
      .set({
        status,
        draftJson: persistedPlan as unknown as Record<string, unknown>,
        validationJson: validation as unknown as Record<string, unknown>,
        updatedAt: now,
      })
      .where(eq(buildEpicsDrafts.runId, input.runId))
      .run()
    this.recordEvent(input.runId, null, 'draft_updated', {
      requested_by: input.requestedBy,
      previous_version: previousVersion,
      next_version: persistedPlan.version,
      draft_status: status,
      change_summary: changeSummary,
    })

    return {
      runId: input.runId,
      draftStatus: status,
      previousVersion,
      nextVersion: persistedPlan.version ?? previousVersion + 1,
      validation,
      changeSummary,
    }
  }

  async confirmDraft(input: { runId: string; requestedBy: string }): Promise<BuildEpicsDraftConfirmResult> {
    const run = this.requireBuildEpicsRun(input.runId)
    const draft = this.input.db.select().from(buildEpicsDrafts).where(eq(buildEpicsDrafts.runId, input.runId)).get()
    if (!draft) throw new Error('BUILD_EPICS_DRAFT_NOT_FOUND')
    if (draft.status !== 'ready') throw new Error('BUILD_EPICS_DRAFT_NOT_READY')

    const plan = draft.draftJson as unknown as PersistedEditablePlan
    const validation = validateBuildEpicsDraft(plan, validationPolicyForRun(this.tasksForRun(input.runId)))
    if (validation.fatal.length > 0) throw new Error('BUILD_EPICS_DRAFT_INVALID')

    const docIndex = await loadDocIndex({ db: this.input.db, projectId: run.projectId, documentScope: 'all' })
    const confirmedPlan = toConfirmedPlan(plan)
    const validatedPlan = validateEpicPlan(confirmedPlan, docIndex)
    const persistResult = await persistConfirmedEpics({ db: this.input.db, projectId: run.projectId, plan: validatedPlan })
    const draftVersion = plan.version ?? 1
    const confirmedAt = new Date().toISOString()
    upsertProjectPhaseStatus(this.input.db, run.projectId, 'build_epics', {
      status: 'passed',
      sourceRunId: input.runId,
      sourceCommit: run.sourceCommit,
      meta: {
        confirmedAt,
        confirmedCount: persistResult.confirmedCount,
        rejectedCount: persistResult.rejectedCount,
        persistResult,
      },
    })
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

  async cancel(input: { runId: string; reason?: string }) {
    this.requireBuildEpicsRun(input.runId)
    const now = timestamp()
    this.input.db.update(generationRuns)
      .set({ status: 'cancelled', finishedAt: now, updatedAt: now })
      .where(eq(generationRuns.id, input.runId))
      .run()
    this.input.db.update(generationTasks)
      .set({ status: 'expired', leaseToken: null, leasedBy: null, leaseExpiresAt: null, updatedAt: now })
      .where(and(eq(generationTasks.runId, input.runId), eq(generationTasks.status, 'leased')))
      .run()
    this.recordEvent(input.runId, null, 'run_cancelled', { reason: input.reason ?? null })
    return { runId: input.runId, status: 'cancelled' as const }
  }

  private insertTasks(
    runId: string,
    projectId: string,
    repositoryId: string,
    policy: ResolvedBuildEpicsRuntimePolicy,
    cards: BuildEpicsDocumentCard[],
  ): void {
    const now = timestamp()
    const taxonomyChunks = chunk(cards, policy.taxonomyChunkSize)
    const assignmentChunks = chunk(cards, policy.resolvedAssignmentChunkSize)
    const consolidationRows = cards.length === 0
      ? []
      : [taskRow(runId, projectId, repositoryId, 'taxonomy_consolidation', 'taxonomy:consolidated', cards, policy, now)]
    const rows = [
      ...taxonomyChunks.map((cardsForTask, index) => taskRow(runId, projectId, repositoryId, 'taxonomy_candidate', `taxonomy:${index + 1}`, cardsForTask, policy, now)),
      ...consolidationRows,
      ...assignmentChunks.map((cardsForTask, index) => taskRow(runId, projectId, repositoryId, 'document_assignment', `assignment:${index + 1}`, cardsForTask, policy, now)),
    ]
    if (rows.length > 0) this.input.db.insert(generationTasks).values(rows).run()
  }

  private async contextContent(task: GenerationTask) {
    const target = task.targetJson as { task_type: string; cards: BuildEpicsDocumentCard[] }
    const tasks = this.tasksForRun(task.runId)
    if (target.task_type === 'taxonomy_consolidation') {
      const taxonomyResults = completedTaskDocuments<TaxonomyCandidateSubmission>(tasks, 'taxonomy_candidate')
      return {
        taskType: target.task_type,
        cards: target.cards,
        taxonomyCandidates: taxonomyResults,
        instruction: 'Merge duplicate or overlapping candidate EPICs into one MECE taxonomy. Do not assign documents here.',
        repair: {
          retryCount: task.retryCount,
          maxRetries: task.maxRetries,
          validationErrors: task.lastValidationErrors ?? [],
        },
      }
    }
    const completedTaxonomy = completedConsolidatedTaxonomy(tasks)?.epics
      ?? completedTaskDocuments<TaxonomyCandidateSubmission>(tasks, 'taxonomy_candidate').flatMap((result) => result.epics)
    if (target.task_type === 'cross_domain_link') {
      const docIndex = await loadDocIndex({ db: this.input.db, projectId: task.projectId, documentScope: 'all' })
      const draft = buildDraftFromRuntimeSubmissions({
        projectId: task.projectId,
        taxonomyResults: completedTaskDocuments<TaxonomyCandidateSubmission>(tasks, 'taxonomy_candidate'),
        consolidatedTaxonomyResult: completedConsolidatedTaxonomy(tasks),
        assignmentResults: completedTaskDocuments<AssignmentSubmission>(tasks, 'document_assignment'),
        docIndex,
        validationPolicy: validationPolicyForRun(tasks),
      })
      return {
        taskType: target.task_type,
        cards: target.cards,
        epics: draft.epics,
        owners: Object.fromEntries(buildOwnerMap(draft.epics)),
        repair: {
          retryCount: task.retryCount,
          maxRetries: task.maxRetries,
          validationErrors: task.lastValidationErrors ?? [],
        },
      }
    }
    return {
      taskType: target.task_type,
      cards: target.cards,
      epics: completedTaxonomy,
      repair: {
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
        validationErrors: task.lastValidationErrors ?? [],
      },
    }
  }

  private async validateTaskResult(task: GenerationTask, result: unknown, allTasks: GenerationTask[]): Promise<Array<Record<string, unknown>>> {
    const value = asRecord(result)
    if (task.documentType === 'taxonomy_candidate') {
      if (!Array.isArray(value.domains) || !Array.isArray(value.epics)) {
        return [{ severity: 'fatal', code: 'INVALID_TAXONOMY_RESULT', path: '$', message: 'domains and epics arrays are required' }]
      }
      return []
    }
    if (task.documentType === 'taxonomy_consolidation') {
      if (!Array.isArray(value.domains) || !Array.isArray(value.epics)) {
        return [{ severity: 'fatal', code: 'INVALID_TAXONOMY_CONSOLIDATION_RESULT', path: '$', message: 'domains and epics arrays are required' }]
      }
      const normalized = normalizeConsolidatedTaxonomySubmission(value as unknown as TaxonomyConsolidationSubmission)
      const validationErrors = validateConsolidatedTaxonomySubmission(normalized) as unknown as Array<Record<string, unknown>>
      return filterAllowedRawAliasSourceErrors(validationErrors, normalized, allTasks)
    }
    if (task.documentType === 'document_assignment') {
      if (!Array.isArray(value.assignments)) {
        return [{ severity: 'fatal', code: 'INVALID_ASSIGNMENT_RESULT', path: '$.assignments', message: 'assignments array is required' }]
      }
      if (value.assignments.some((assignment) => asRecord(assignment).epics !== undefined)) {
        return [{ severity: 'fatal', code: 'ASSIGNMENT_CREATED_EPIC', path: '$.assignments', message: 'assignment tasks cannot create EPICs' }]
      }
      const target = task.targetJson as { cards?: BuildEpicsDocumentCard[] }
      const taxonomyEpics = completedConsolidatedTaxonomy(allTasks)?.epics ?? []
      return validateAssignmentSubmission({
        cards: target.cards ?? [],
        epics: taxonomyEpics,
        submission: value as unknown as AssignmentSubmission,
      }) as unknown as Array<Record<string, unknown>>
    }
    if (task.documentType === 'cross_domain_link') {
      if (!Array.isArray(value.links)) {
        return [{ severity: 'fatal', code: 'INVALID_CROSS_DOMAIN_RESULT', path: '$.links', message: 'links array is required' }]
      }
      const target = task.targetJson as { cards?: BuildEpicsDocumentCard[] }
      const docIndex = await loadDocIndex({ db: this.input.db, projectId: task.projectId, documentScope: 'all' })
      const draft = buildDraftFromRuntimeSubmissions({
        projectId: task.projectId,
        taxonomyResults: completedTaskDocuments<TaxonomyCandidateSubmission>(allTasks, 'taxonomy_candidate'),
        consolidatedTaxonomyResult: completedConsolidatedTaxonomy(allTasks),
        assignmentResults: completedTaskDocuments<AssignmentSubmission>(allTasks, 'document_assignment'),
        docIndex,
        validationPolicy: validationPolicyForRun(allTasks),
      })
      return validateCrossDomainSubmission({
        cards: target.cards ?? [],
        epics: draft.epics,
        ownerByDocumentId: buildOwnerMap(draft.epics),
        submission: value as unknown as CrossDomainSubmission,
        maxCrossLinksPerDocument: policyForRun(allTasks).maxCrossLinksPerDocument,
      }) as unknown as Array<Record<string, unknown>>
    }
    return []
  }

  private async refreshDraft(runId: string): Promise<void> {
    const run = this.requireBuildEpicsRun(runId)
    if (!run || run.status === 'cancelled') return
    const existingDraft = this.input.db.select().from(buildEpicsDrafts).where(eq(buildEpicsDrafts.runId, runId)).get()
    if (existingDraft && draftVersion(existingDraft.draftJson) > 1) return
    const tasks = this.tasksForRun(runId)
    if (tasks.length === 0 || tasks.some((task) => !FINAL_TASK_STATUSES.includes(task.status))) return

    const docIndex = await loadDocIndex({ db: this.input.db, projectId: run.projectId, documentScope: 'all' })
    const plan: PersistedEditablePlan = {
      ...buildDraftFromRuntimeSubmissions({
      projectId: run.projectId,
      taxonomyResults: completedTaskDocuments<TaxonomyCandidateSubmission>(tasks, 'taxonomy_candidate'),
      consolidatedTaxonomyResult: completedConsolidatedTaxonomy(tasks),
      assignmentResults: completedTaskDocuments<AssignmentSubmission>(tasks, 'document_assignment'),
      crossDomainResults: completedTaskDocuments<CrossDomainSubmission>(tasks, 'cross_domain_link'),
      docIndex,
      validationPolicy: validationPolicyForRun(tasks),
      }),
      version: 1,
    }
    const validation = validateBuildEpicsDraft(plan, validationPolicyForRun(tasks))
    const status = validation.fatal.length > 0 ? 'invalid' : 'ready'
    const now = timestamp()

    this.input.db.insert(buildEpicsDrafts).values({
      id: `draft:${runId}`,
      runId,
      projectId: run.projectId,
      status,
      draftJson: plan as unknown as Record<string, unknown>,
      validationJson: validation as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: buildEpicsDrafts.runId,
      set: {
        status,
        draftJson: plan as unknown as Record<string, unknown>,
        validationJson: validation as unknown as Record<string, unknown>,
        updatedAt: now,
      },
    }).run()
    this.input.db.update(generationRuns)
      .set({ status: status === 'ready' ? 'completed' : 'failed', finishedAt: now, updatedAt: now })
      .where(eq(generationRuns.id, runId))
      .run()
    this.recordEvent(runId, null, status === 'ready' ? 'run_completed' : 'run_failed', { draft_status: status })
  }

  private tasksForRun(runId: string): GenerationTask[] {
    return this.input.db.select()
      .from(generationTasks)
      .where(eq(generationTasks.runId, runId))
      .orderBy(asc(generationTasks.targetKey))
      .all()
  }

  private requireBuildEpicsRun(runId: string) {
    const run = this.input.db.select().from(generationRuns).where(eq(generationRuns.id, runId)).get()
    if (!run) throw new Error('BUILD_EPICS_RUN_NOT_FOUND')
    if (run.stage !== 'build_epics') throw new Error('BUILD_EPICS_RUN_STAGE_MISMATCH')
    return run
  }

  private isEpicsSyncRun(runId: string): boolean {
    const draft = this.input.db.select().from(buildEpicsDrafts).where(eq(buildEpicsDrafts.runId, runId)).get()
    return Boolean((draft?.draftJson as { syncMetadata?: unknown } | undefined)?.syncMetadata)
  }

  private requireTaskLease(taskId: string, leaseToken: string): GenerationTask {
    const task = this.input.db.select().from(generationTasks).where(eq(generationTasks.id, taskId)).get()
    if (!task || task.leaseToken !== leaseToken || task.status !== 'leased') throw new Error('INVALID_LEASE_TOKEN')
    this.requireBuildEpicsRun(task.runId)
    if (
      task.documentType !== 'taxonomy_candidate' &&
      task.documentType !== 'taxonomy_consolidation' &&
      task.documentType !== 'document_assignment' &&
      task.documentType !== 'cross_domain_link'
    ) {
      throw new Error('BUILD_EPICS_TASK_TYPE_MISMATCH')
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

  private failPendingAssignments(runId: string, validationErrors: Array<Record<string, unknown>>): void {
    const now = timestamp()
    const pendingAssignments = this.tasksForRun(runId)
      .filter((task) => task.documentType === 'taxonomy_consolidation' || task.documentType === 'document_assignment')
      .filter((task) => RELEASABLE_TASK_STATUSES.includes(task.status))
    for (const task of pendingAssignments) {
      this.input.db.update(generationTasks)
        .set({
          status: 'failed',
          leaseToken: null,
          leasedBy: null,
          leaseExpiresAt: null,
          lastValidationErrors: [{
            code: 'TAXONOMY_PREREQUISITE_FAILED',
            path: '$.taxonomy',
            message: 'A taxonomy task failed before assignments could run.',
            validationErrors,
          }],
          updatedAt: now,
        })
        .where(eq(generationTasks.id, task.id))
        .run()
      this.recordEvent(runId, task.id, 'task_failed', { reason: 'taxonomy_prerequisite_failed' })
    }
  }

  private async ensureCrossDomainTasks(runId: string): Promise<void> {
    const run = this.requireBuildEpicsRun(runId)
    if (run.status !== 'running') return
    const tasks = this.tasksForRun(runId)
    if (tasks.some((task) => task.documentType === 'cross_domain_link')) return
    const taxonomyDone = completedPrerequisites(tasks, ['taxonomy_candidate'])
    const consolidationDone = completedPrerequisites(tasks, ['taxonomy_consolidation'])
    const assignmentsDone = completedPrerequisites(tasks, ['document_assignment'])
    if (!taxonomyDone || !consolidationDone || !assignmentsDone) return

    const repo = this.input.db.select().from(repositories).where(eq(repositories.projectId, run.projectId)).get()
    if (!repo) throw new Error('BUILD_EPICS_REPOSITORY_REQUIRED')
    const docIndex = await loadDocIndex({ db: this.input.db, projectId: run.projectId, documentScope: 'all' })
    const cards = packBuildEpicsDocumentCards(docIndex)
    const policy = policyForRun(tasks)
    const now = timestamp()
    const rows = chunk(cards, policy.crossDomainChunkSize).map((cardsForTask, index) =>
      taskRow(runId, run.projectId, repo.id, 'cross_domain_link', `cross:${index + 1}`, cardsForTask, policy, now),
    )
    if (rows.length > 0) {
      this.input.db.insert(generationTasks)
        .values(rows)
        .onConflictDoNothing({ target: [generationTasks.runId, generationTasks.repositoryId, generationTasks.targetKey] })
        .run()
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

function taskRow(
  runId: string,
  projectId: string,
  repositoryId: string,
  taskType: GenerationTaskKind,
  key: string,
  cards: BuildEpicsDocumentCard[],
  policy: ResolvedBuildEpicsRuntimePolicy,
  now: string,
) {
  return {
    id: `task:${randomUUID()}`,
    runId,
    projectId,
    repositoryId,
    documentType: taskType,
    targetKey: key,
    targetDocumentId: key,
    primaryEntryPointId: key,
    targetJson: { task_type: taskType, cards, policy },
    status: 'pending' as const,
    retryCount: 0,
    maxRetries: policy.maxRepairPasses,
    createdAt: now,
    updatedAt: now,
  }
}

function completedTaskDocuments<T>(tasks: GenerationTask[], taskType: GenerationTaskKind): T[] {
  return tasks
    .filter((task) => task.documentType === taskType && task.status === 'completed')
    .map((task) => task.submittedDocument as T)
}

function completedConsolidatedTaxonomy(tasks: GenerationTask[]): TaxonomyConsolidationSubmission | undefined {
  return completedTaskDocuments<TaxonomyConsolidationSubmission>(tasks, 'taxonomy_consolidation')[0]
}

function filterAllowedRawAliasSourceErrors(
  errors: Array<Record<string, unknown>>,
  normalized: TaxonomyConsolidationSubmission,
  tasks: GenerationTask[],
): Array<Record<string, unknown>> {
  const rawCandidateKeys = new Set(
    completedTaskDocuments<TaxonomyCandidateSubmission>(tasks, 'taxonomy_candidate')
      .flatMap((result) => result.epics)
      .map((epic) => normalizeStableKey(epic.stableKey)),
  )
  const allowedRawAliasSources = new Set(
    (normalized.aliases ?? [])
      .filter((alias) => rawCandidateKeys.has(alias.fromStableKey))
      .map((alias) => alias.fromStableKey),
  )

  return errors.filter((error) =>
    error.code !== 'UNKNOWN_ALIAS_SOURCE' || !allowedRawAliasSources.has(String(error.stableKey ?? '')),
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function assignableDocs(index: BuildEpicsDocIndex): number {
  return index.apis.length + index.screens.length + index.events.length + index.schedules.length
}

function documentCounts(index: BuildEpicsDocIndex) {
  return {
    api_spec: index.apis.length,
    screen_spec: index.screens.length,
    event_spec: index.events.length,
    schedule_spec: index.schedules.length,
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

function countByStatus(tasks: GenerationTask[]): Partial<Record<GenerationTaskStatus, number>> {
  return tasks.reduce<Partial<Record<GenerationTaskStatus, number>>>((counts, task) => {
    counts[task.status] = (counts[task.status] ?? 0) + 1
    return counts
  }, {})
}

function isTaskReadyForLease(task: GenerationTask, allTasks: GenerationTask[]): boolean {
  if (task.documentType === 'taxonomy_consolidation') {
    return completedPrerequisites(allTasks, ['taxonomy_candidate'])
  }
  if (task.documentType === 'document_assignment') {
    return completedPrerequisites(allTasks, ['taxonomy_consolidation'])
  }
  if (task.documentType === 'cross_domain_link') {
    return completedPrerequisites(allTasks, ['taxonomy_consolidation']) &&
      completedPrerequisites(allTasks, ['document_assignment'])
  }
  return true
}

function completedPrerequisites(allTasks: GenerationTask[], taskTypes: GenerationTaskKind[]): boolean {
  const prerequisites = allTasks.filter((candidate) => taskTypes.includes(candidate.documentType))
  return prerequisites.length > 0 && prerequisites.every((candidate) => candidate.status === 'completed')
}

function compareRuntimeTasks(a: GenerationTask, b: GenerationTask): number {
  return taskPriority(a) - taskPriority(b) || a.targetKey.localeCompare(b.targetKey)
}

function taskPriority(task: GenerationTask): number {
  if (task.documentType === 'taxonomy_candidate') return 0
  if (task.documentType === 'taxonomy_consolidation') return 1
  if (task.documentType === 'document_assignment') return 2
  return 3
}

function validationPolicyForRun(tasks: GenerationTask[]) {
  for (const task of tasks) {
    const target = asRecord(task.targetJson)
    const policy = asRecord(target.policy)
    if (typeof policy.maxReviewRatioWarning === 'number' && typeof policy.maxReviewRatioFatal === 'number') {
      return {
        maxReviewRatioWarning: policy.maxReviewRatioWarning,
        maxReviewRatioFatal: policy.maxReviewRatioFatal,
      }
    }
  }
  return { maxReviewRatioWarning: 0.2, maxReviewRatioFatal: 0.35 }
}

function policyForRun(tasks: GenerationTask[]): ResolvedBuildEpicsRuntimePolicy {
  for (const task of tasks) {
    const target = asRecord(task.targetJson)
    const policy = asRecord(target.policy)
    if (typeof policy.maxWorkerCount === 'number') return policy as unknown as ResolvedBuildEpicsRuntimePolicy
  }
  return resolveBuildEpicsRuntimePolicy({}, { totalAssignableDocs: 0, totalDocumentCards: 0 })
}

function draftVersion(draftJson: Record<string, unknown>): number {
  return typeof draftJson.version === 'number' ? draftJson.version : 1
}

function normalizeStableKey(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function timestamp(): string {
  return new Date().toISOString()
}
