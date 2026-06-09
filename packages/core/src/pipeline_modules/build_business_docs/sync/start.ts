import { and, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DB } from '@/db/client.js'
import { documents, generationRuns } from '@/db/schema/build_docs.js'
import {
  businessDocContextBundles,
  businessDocContextPages,
  type BusinessDocGenerationRun,
  type BusinessDocGenerationTask,
  businessDocGenerationRuns,
  businessDocGenerationTasks,
} from '@/db/schema/build_business_docs_generation.js'
import { epics } from '@/db/schema/core.js'
import {
  buildManifest,
  buildPages,
  countPlannedContextPages,
  countPlannedTasksByType,
  countTasksByType,
  loadEpicSourceBundles,
  loadExistingCanonicalSnapshots,
  loadModelEvidenceCards,
  loadSourceDocumentCards,
  loadTargetEpicSnapshots,
  makeTask,
  toTaskRow,
  type PlannedTask,
} from '@/pipeline_modules/build_business_docs_cli/start.js'
import {
  DEFAULT_BUSINESS_DOCS_RUNTIME_POLICY,
  type BusinessDocsEstimatedTasks,
  type BusinessDocsGenerationRunStatus,
  type BusinessDocsPreview,
  type BusinessDocsRuntimePolicy,
  type BusinessDocsTaskType,
} from '@/pipeline_modules/build_business_docs_cli/types.js'
import { hashValue } from '@/pipeline_modules/sync/hash.js'
import { cleanupOrphanedBusinessDocumentGraph, cleanupStaleBusinessDocumentSourceLinks } from './graph_reconcile.js'
import { previewBusinessDocsSync } from './preview.js'

const SOURCE_COMMIT = 'unknown'
const CONTEXT_SCHEMA_VERSION = 'business-docs-context.v1'

interface StartInput {
  projectId: string
  docSyncPlanId?: string
  newRun?: boolean
  now?: () => Date
  makeId?: () => string
}

export type BusinessDocsSyncStartServiceResult =
  | { ok: true; data: BusinessDocsSyncStartResult }
  | {
    ok: false
    code: 'BUSINESS_DOCS_SYNC_START_BLOCKED'
    message: string
    preview: ReturnType<typeof previewBusinessDocsSync>
  }

type SyncPreview = ReturnType<typeof previewBusinessDocsSync>
type SyncTarget = SyncPreview['targets'][number]

export interface BusinessDocsSyncStartResult {
  mode: 'created' | 'resumed'
  run: {
    id: string
    projectId: string
    status: BusinessDocsGenerationRunStatus
    sourceCommit: string
    forceRegenerate: boolean
    createdAt: string
    updatedAt: string
  }
  project: SyncPreview['project']
  policy: BusinessDocsRuntimePolicy
  preview: SyncPreview
  tasks: {
    total: number
    created: number
    resumable: number
    skippedExisting: number
    byType: BusinessDocsEstimatedTasks
  }
  contexts: {
    bundlesCreated: number
    pagesCreated: number
    deferredDependencyContexts: number
  }
  nextAction: {
    type: 'lease_tasks' | 'inspect_existing_run'
  }
}

const SOURCE_FIRST_TASK_BY_DOC_TYPE = {
  design: 'system_design',
  data_dictionary: 'data_dictionary',
  br: 'business_rules',
  ucl: 'use_case_list',
} as const satisfies Record<string, BusinessDocsTaskType>
const RESUMABLE_RUN_STATUSES = ['running', 'repair_requested', 'failed'] as const
const TERMINAL_TASK_STATUSES = new Set(['saved', 'proposal_created', 'blocked', 'failed', 'skipped'])

export function startBusinessDocsSync(db: DB, input: StartInput): BusinessDocsSyncStartServiceResult {
  const now = (input.now ?? (() => new Date()))().toISOString()
  const makeId = input.makeId ?? nanoid

  if (!input.newRun) {
    const resumable = findResumableSyncRun(db, input.projectId)
    if (resumable) return { ok: true, data: summarizeExistingSyncRun(db, resumable, now) }
  }

  const preview = previewBusinessDocsSync(db, {
    projectId: input.projectId,
    docSyncPlanId: input.docSyncPlanId,
  })

  if (hasActiveBuildEpicsRun(db, input.projectId)) {
    return {
      ok: false,
      code: 'BUSINESS_DOCS_SYNC_START_BLOCKED',
      message: 'Business docs sync cannot start until build_epics sync is confirmed.',
      preview,
    }
  }

  if (!preview.latestStaticSnapshotId) {
    return {
      ok: false,
      code: 'BUSINESS_DOCS_SYNC_START_BLOCKED',
      message: 'Business docs sync cannot start without a static snapshot.',
      preview,
    }
  }

  if (preview.summary.blocked > 0) {
    db.transaction((tx) => {
      markOrphanedDocuments(tx, { preview, now })
    })
    return {
      ok: false,
      code: 'BUSINESS_DOCS_SYNC_START_BLOCKED',
      message: 'Business docs sync cannot start until preview blockers are resolved.',
      preview,
    }
  }

  const taskTargets = preview.targets.filter((target) => target.taskPlanned)
  const selectedEpicIds = uniqueSorted(taskTargets
    .map((target) => target.epicId)
    .filter((epicId): epicId is string => typeof epicId === 'string'))
  const plannedTasks = taskTargets.length > 0
    ? planSyncTasks(db, {
      projectId: input.projectId,
      selectedEpicIds,
      taskTargets,
      makeId,
    })
    : []
  const runId = plannedTasks.length > 0 ? prefixedId('run', makeId) : null

  db.transaction((tx) => {
    markImpactedDocuments(tx, { preview, now })

    if (!runId) return

    tx.insert(businessDocGenerationRuns).values({
      id: runId,
      projectId: input.projectId,
      status: 'running',
      policyJson: DEFAULT_BUSINESS_DOCS_RUNTIME_POLICY,
      previewSnapshotJson: preview as unknown as BusinessDocsPreview,
      selectedEpicIdsJson: selectedEpicIds,
      sourceCommit: SOURCE_COMMIT,
      forceRegenerate: 0,
      createdAt: now,
      updatedAt: now,
    }).run()

    for (const task of plannedTasks) {
      tx.insert(businessDocGenerationTasks).values(toTaskRow({
        task,
        runId,
        projectId: input.projectId,
        maxRepairAttempts: DEFAULT_BUSINESS_DOCS_RUNTIME_POLICY.maxRepairAttempts,
        now,
      })).run()
    }

    for (const task of plannedTasks) {
      const manifest = buildManifest({ task, runId, now })
      tx.insert(businessDocContextBundles).values({
        contextHandle: task.contextHandle,
        runId,
        taskId: task.id,
        schemaVersion: CONTEXT_SCHEMA_VERSION,
        sourceCommit: SOURCE_COMMIT,
        manifestJson: manifest,
        contentHash: hashValue(manifest),
        createdAt: now,
      }).run()

      for (const page of buildPages({ task, runId, now })) {
        tx.insert(businessDocContextPages).values(page).run()
      }
    }
  })

  return {
    ok: true,
    data: {
      mode: 'created',
      run: {
        id: runId ?? '',
        projectId: input.projectId,
        status: runId ? 'running' : 'completed',
        sourceCommit: SOURCE_COMMIT,
        forceRegenerate: false,
        createdAt: now,
        updatedAt: now,
      },
      project: preview.project,
      policy: DEFAULT_BUSINESS_DOCS_RUNTIME_POLICY,
      preview,
      tasks: {
        total: plannedTasks.length,
        created: plannedTasks.length,
        resumable: plannedTasks.length,
        skippedExisting: preview.summary.fresh,
        byType: countPlannedTasksByType(plannedTasks),
      },
      contexts: {
        bundlesCreated: plannedTasks.length,
        pagesCreated: countPlannedContextPages(plannedTasks),
        deferredDependencyContexts: plannedTasks.filter((task) => !task.dependencyPagesReady).length,
      },
      nextAction: {
        type: runId ? 'lease_tasks' : 'inspect_existing_run',
      },
    },
  }
}

function hasActiveBuildEpicsRun(db: DB, projectId: string): boolean {
  return db.select({ id: generationRuns.id }).from(generationRuns)
    .where(and(
      eq(generationRuns.projectId, projectId),
      eq(generationRuns.stage, 'build_epics'),
      inArray(generationRuns.status, ['planning', 'awaiting_approval', 'running']),
    ))
    .get() !== undefined
}

function findResumableSyncRun(db: DB, projectId: string): BusinessDocGenerationRun | null {
  const runs = db.select().from(businessDocGenerationRuns)
    .where(and(
      eq(businessDocGenerationRuns.projectId, projectId),
      inArray(businessDocGenerationRuns.status, RESUMABLE_RUN_STATUSES),
    ))
    .all()
    .filter((run) => isSyncPreview(run.previewSnapshotJson))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  for (const run of runs) {
    const tasks = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.runId, run.id))
      .all()
    if (tasks.some((task) => !TERMINAL_TASK_STATUSES.has(task.status))) return run
  }
  return null
}

function summarizeExistingSyncRun(db: DB, run: BusinessDocGenerationRun, now: string): BusinessDocsSyncStartResult {
  const tasks = db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.runId, run.id))
    .all() as BusinessDocGenerationTask[]
  const bundles = db.select().from(businessDocContextBundles)
    .where(eq(businessDocContextBundles.runId, run.id))
    .all()
  const pages = bundles.length === 0
    ? []
    : db.select().from(businessDocContextPages)
      .where(inArray(businessDocContextPages.contextHandle, bundles.map((bundle) => bundle.contextHandle)))
      .all()

  return {
    mode: 'resumed',
    run: {
      id: run.id,
      projectId: run.projectId,
      status: run.status === 'running' || run.status === 'repair_requested' || run.status === 'failed'
        ? run.status
        : 'running',
      sourceCommit: run.sourceCommit,
      forceRegenerate: run.forceRegenerate === 1,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt ?? now,
    },
    project: isSyncPreview(run.previewSnapshotJson)
      ? run.previewSnapshotJson.project
      : { id: run.projectId, name: run.projectId },
    policy: run.policyJson,
    preview: run.previewSnapshotJson as unknown as BusinessDocsSyncStartResult['preview'],
    tasks: {
      total: tasks.length,
      created: 0,
      resumable: tasks.filter((task) => !TERMINAL_TASK_STATUSES.has(task.status)).length,
      skippedExisting: 0,
      byType: countTasksByType(tasks),
    },
    contexts: {
      bundlesCreated: bundles.length,
      pagesCreated: pages.length,
      deferredDependencyContexts: bundles.filter((bundle) => bundle.manifestJson.dependencyPagesReady === false).length,
    },
    nextAction: {
      type: 'inspect_existing_run',
    },
  }
}

function markImpactedDocuments(db: Pick<DB, 'delete' | 'run' | 'select' | 'update'>, input: { preview: SyncPreview; now: string }): void {
  const staleDocumentIds = input.preview.targets
    .filter((target) => target.state === 'stale' && target.existingDocumentId)
    .map((target) => target.existingDocumentId!)
  if (staleDocumentIds.length > 0) {
    db.update(documents)
      .set({
        status: 'active',
        validity: 'stale',
        updatedAt: input.now,
      })
      .where(and(
        inArray(documents.id, staleDocumentIds),
        eq(documents.track, 'business'),
      ))
      .run()
    cleanupStaleBusinessDocumentSourceLinks(db, {
      projectId: input.preview.projectId,
      documentIds: staleDocumentIds,
    })
  }

  markOrphanedDocuments(db, input)
}

function markOrphanedDocuments(db: Pick<DB, 'delete' | 'run' | 'select' | 'update'>, input: { preview: SyncPreview; now: string }): void {
  const orphanDocumentIds = input.preview.orphanedTargets.map((target) => target.documentId)
  if (orphanDocumentIds.length > 0) {
    db.update(documents)
      .set({
        status: 'deleted',
        validity: 'orphaned',
        updatedBy: 'system',
        updatedAt: input.now,
      })
      .where(and(
        inArray(documents.id, orphanDocumentIds),
        eq(documents.track, 'business'),
      ))
      .run()
    cleanupOrphanedBusinessDocumentGraph(db, {
      projectId: input.preview.projectId,
      documentIds: orphanDocumentIds,
      now: input.now,
    })
  }
}

function planSyncTasks(
  db: DB,
  input: {
    projectId: string
    selectedEpicIds: string[]
    taskTargets: SyncTarget[]
    makeId: () => string
  },
): PlannedTask[] {
  const projectGlossaryPlanned = input.taskTargets.some((target) => target.scope === 'project' && target.documentType === 'glossary')
  const contextEpicIds = projectGlossaryPlanned
    ? loadConfirmedEpicIds(db, input.projectId)
    : input.selectedEpicIds
  const targetEpicsById = loadTargetEpicSnapshots(db, input.projectId, contextEpicIds)
  const sourceCardsByEpic = loadSourceDocumentCards(db, input.projectId, contextEpicIds)
  const bundleByEpic = loadEpicSourceBundles(db, input.projectId, contextEpicIds)
  const modelEvidenceByEpic = loadModelEvidenceCards(db, contextEpicIds, sourceCardsByEpic)
  const existingCanonicalByTarget = loadExistingCanonicalSnapshots(db, input.projectId)
  const targetsByKey = new Map(input.taskTargets.map((target) => [target.key, target]))
  const tasks: PlannedTask[] = []
  const upstreamTasksByEpic = new Map<string, PlannedTask[]>()
  const epicGlossaryTasks: PlannedTask[] = []

  for (const epicId of input.selectedEpicIds) {
    const upstreamTasks: PlannedTask[] = []
    upstreamTasksByEpic.set(epicId, upstreamTasks)
    const epicSourceCards = sourceCardsByEpic.get(epicId) ?? []
    const epicBundle = bundleByEpic.get(epicId) ?? null
    const epicModelEvidence = modelEvidenceByEpic.get(epicId) ?? []

    for (const documentType of ['design', 'data_dictionary', 'br', 'ucl'] as const) {
      const target = targetsByKey.get(`epic:${epicId}:${documentType}`)
      if (!target?.taskPlanned) continue
      const taskType = SOURCE_FIRST_TASK_BY_DOC_TYPE[documentType]
      const task = makeTask({
        projectId: input.projectId,
        epicId,
        taskType,
        scope: 'epic',
        scopeId: epicId,
        targetEpic: targetEpicsById.get(epicId) ?? null,
        dependsOnTaskIds: [],
        makeId: input.makeId,
        sourceCards: epicSourceCards,
        bundle: epicBundle,
        modelEvidence: epicModelEvidence,
        existingCanonicalByTarget,
      })
      task.sync = syncMetadata(target)
      tasks.push(task)
      upstreamTasks.push(task)

      if (documentType === 'ucl') {
        const refineTask = makeTask({
          projectId: input.projectId,
          epicId,
          taskType: 'use_case_list_refine',
          scope: 'epic',
          scopeId: epicId,
          targetEpic: targetEpicsById.get(epicId) ?? null,
          dependsOnTaskIds: [task.id],
          makeId: input.makeId,
          sourceCards: epicSourceCards,
          bundle: epicBundle,
          modelEvidence: epicModelEvidence,
          existingCanonicalByTarget,
        })
        refineTask.sync = syncMetadata(target)
        tasks.push(refineTask)
      }
    }

    const glossaryTarget = targetsByKey.get(`epic:${epicId}:glossary`)
    if (glossaryTarget?.taskPlanned) {
      const glossaryTask = makeTask({
        projectId: input.projectId,
        epicId,
        taskType: 'epic_glossary',
        scope: 'epic',
        scopeId: epicId,
        targetEpic: targetEpicsById.get(epicId) ?? null,
        dependsOnTaskIds: upstreamTasks.map((task) => task.id),
        makeId: input.makeId,
        sourceCards: epicSourceCards,
        bundle: epicBundle,
        modelEvidence: epicModelEvidence,
        existingCanonicalByTarget,
      })
      glossaryTask.sync = syncMetadata(glossaryTarget)
      tasks.push(glossaryTask)
      epicGlossaryTasks.push(glossaryTask)
    }
  }

  const projectGlossaryTarget = targetsByKey.get(`project:${input.projectId}:glossary`)
  if (projectGlossaryTarget?.taskPlanned) {
    const projectGlossaryTask = makeTask({
      projectId: input.projectId,
      epicId: null,
      taskType: 'project_glossary',
      scope: 'project',
      scopeId: input.projectId,
      targetEpic: null,
      dependsOnTaskIds: epicGlossaryTasks.map((task) => task.id),
      makeId: input.makeId,
      sourceCards: Array.from(sourceCardsByEpic.values()).flat(),
      bundle: null,
      modelEvidence: Array.from(modelEvidenceByEpic.values()).flat(),
      existingCanonicalByTarget,
    })
    projectGlossaryTask.sync = syncMetadata(projectGlossaryTarget)
    tasks.push(projectGlossaryTask)
  }

  return tasks
}

function loadConfirmedEpicIds(db: DB, projectId: string): string[] {
  return db.select().from(epics)
    .where(eq(epics.projectId, projectId))
    .all()
    .filter((epic) => epic.confirmedAt !== null && epic.deletedAt === null)
    .map((epic) => epic.id)
    .sort()
}

function isSyncPreview(value: unknown): value is SyncPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.projectId === 'string' &&
    !!record.project &&
    typeof record.project === 'object' &&
    !!record.summary &&
    typeof record.summary === 'object' &&
    Array.isArray(record.targets) &&
    Array.isArray(record.orphanedTargets)
}

function syncMetadata(target: SyncTarget): NonNullable<PlannedTask['sync']> {
  return {
    sourceHash: target.sourceHash,
    staticSnapshotId: target.staticSnapshotId,
    reason: target.state === 'missing' ? 'missing_document' : 'source_changed',
  }
}

function prefixedId(prefix: string, makeId: () => string): string {
  return `${prefix}:${makeId()}`
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}
