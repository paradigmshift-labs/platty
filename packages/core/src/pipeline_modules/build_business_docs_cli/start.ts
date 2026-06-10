import { createHash } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DB } from '@/db/client.js'
import {
  documentLinks,
  documentMemories,
  docRelationLinks,
  documents,
  type Document,
  type DocumentLink,
  type DocumentMemory,
  type DocRelationLink,
} from '@/db/schema/build_docs.js'
import { models, type Model } from '@/db/schema/build_models.js'
import {
  businessDocContextBundles,
  businessDocContextPages,
  businessDocGenerationRuns,
  businessDocGenerationTasks,
  type BusinessDocGenerationRun,
  type BusinessDocGenerationTask,
  type NewBusinessDocContextBundle,
  type NewBusinessDocContextPage,
  type NewBusinessDocGenerationRun,
  type NewBusinessDocGenerationTask,
} from '@/db/schema/build_business_docs_generation.js'
import {
  epicDependencies,
  epicDocumentLinks,
  type EpicDependency,
  type EpicDocumentLink,
} from '@/db/schema/build_epics.js'
import { epics, repositories } from '@/db/schema/core.js'
import { loadEpicSources } from './sot/f2_load_epic_sources.js'
import {
  projectBusinessRulesInputs,
  projectDataDictionaryInputs,
  projectDesignInputs,
  projectEpicGlossaryInputs,
  projectUseCaseListInputs,
} from './sot/projections.js'
import type { ConfirmedEpic, EpicSourceBundle } from './sot/types.js'
import {
  DEFAULT_BUSINESS_DOCS_RUNTIME_POLICY,
  TASK_DOCUMENT_TYPE,
  type BusinessDocsContextManifest,
  type BusinessDocsContextPageKind,
  type BusinessDocsEstimatedTasks,
  type BusinessDocsGenerationRunStatus,
  type BusinessDocsGenerationTaskStatus,
  type BusinessDocsPreview,
  type BusinessDocsPreviewDocType,
  type BusinessDocsStartResult,
  type BusinessDocsStartServiceResult,
  type BusinessDocsStoredDocumentType,
  type BusinessDocsTaskType,
} from './types.js'
import { previewBusinessDocsGeneration } from './preview.js'

const SOURCE_COMMIT = 'unknown'
const CONTEXT_SCHEMA_VERSION = 'business-docs-context.v1'
// CLI persists live source/business documents with status 'active'; the ported
// loadEpicSources defaults to 'passed'. Accept both so CLI sources never vanish.
const SOURCE_DOCUMENT_STATUSES = ['active', 'passed'] as const
const LOWER_DOC_TYPES = ['api_spec', 'screen_spec', 'event_spec', 'schedule_spec'] as const
const BUSINESS_DOC_TYPES = ['design', 'data_dictionary', 'br', 'ucl', 'ucs', 'glossary'] as const satisfies BusinessDocsStoredDocumentType[]
const SOURCE_FIRST_TASKS = ['system_design', 'data_dictionary', 'business_rules', 'use_case_list'] as const satisfies BusinessDocsTaskType[]
const SOURCE_CLUSTER_STOPWORDS = new Set([
  'api',
  'v1',
  'v2',
  'id',
  'page',
  'pages',
  'user',
  'admin',
  'system',
  'batch',
  'internal',
  'dialog',
  'navigator',
  'controller',
  'handler',
  'widget',
  'screen',
  'route',
  'file',
  'path',
  'src',
  'lib',
  'app',
  'index',
  'component',
  'flutter',
  'nextjs',
  'usecase',
  'usecases',
  'listener',
  'eventlistener',
  'get',
  'post',
  'put',
  'patch',
  'delete',
  '조회',
  '화면',
  '페이지',
  '관리자',
  '사용자',
  '영역',
  '흐름',
  '기능',
  '처리',
  '관련',
  '대상',
  '경우',
  '상태',
  '확인',
  '단계',
  '모달',
  '콘텐츠',
  '진입',
  '진입점',
  '리디렉션',
])
const ACTION_BUCKET_TOKENS = new Set([
  'edit',
  'rewrite',
  'rejected',
  'update',
  'submit',
  'draft',
  'post',
  'write',
  'create',
  'inspection',
  'review',
  'approve',
  'reject',
  'ai',
  'read',
  'view',
  'summary',
  'list',
  'detail',
  'notification',
  'batch',
  'report',
  'preprocess',
  'message',
  'guide',
  'introduce',
  'onboarding',
  '수정',
  '갱신',
  '반려',
  '작성',
  '제출',
  '초안',
  '검수',
  '승인',
  '조회',
  '상세',
  '목록',
  '요약',
  '알림',
  '배치',
  '리포트',
  '전처리',
  '가이드',
  '안내',
  '소개',
])
const TERMINAL_TASK_STATUSES = new Set<BusinessDocsGenerationTaskStatus>([
  'saved',
  'proposal_created',
  'skipped',
  'blocked',
])
const RESUMABLE_RUN_STATUSES = ['running', 'repair_requested', 'failed'] as const satisfies BusinessDocsGenerationRunStatus[]

interface StartInput {
  projectId: string
  selectedEpicIds?: string[]
  newRun?: boolean
  forceRegenerate?: boolean
  outputLanguage?: 'ko' | 'en'
  now?: () => Date
  makeId?: () => string
}

export interface SourceDocumentCard {
  documentId: string
  documentType: string
  scope: string
  scopeId: string | null
  summary: string | null
  epicLink: {
    role: string
    reason: string
    confidence: string
  }
  facts: Record<string, unknown>
}

interface SourceProjectionCard extends SourceDocumentCard {
  evidenceId: string
  sourceRef: string
}

interface SourceCoverageCluster {
  clusterId: string
  title: string
  sourceRefs: string[]
  evidenceIds: string[]
  documentIds: string[]
  documentTypeCounts: Record<string, number>
  sourceRoles: Record<string, number>
  sourceRefRoles: Record<string, string>
  sourceConfidences: Record<string, number>
  sourceRefConfidences: Record<string, string>
  representativeIdentities: unknown[]
  relationEvidence: SourceRelationEvidence[]
}

interface SourceRelationEvidence {
  sourceRef: string
  documentId: string
  relationType: string
  target: string
  confidence: string
  relationClassification: 'direct_call_proven' | 'relation_inferred' | 'topical_cluster'
  epicRole: string
  epicConfidence: string
  evidence?: unknown
}

export interface ModelEvidenceCard {
  modelId: string
  repositoryId: string
  name: string
  tableName: string
  comment: string | null
  description: string | null
  fields: unknown
  relations: unknown
  sourceDocumentIds: string[]
  operations: string[]
  confidence: string
}

export interface TargetEpicSnapshot {
  id: string
  name: string
  stableKey: string | null
  summary: string | null
}

/**
 * Per-task rich SOT context, projected once at plan time from the EPIC's
 * EpicSourceBundle. Carries the real source bodies + db/model evidence so the
 * external worker writes high-quality business docs (not metadata-only shells).
 */
export interface TaskRichContext {
  systemSourceDocIds: string[]
  sourceDocumentsProjection: Record<string, unknown>
  modelEvidence: Array<Record<string, unknown>>
  relationEvidence: Array<Record<string, unknown>>
  sourceGraph: Record<string, unknown>
}

export interface ExistingCanonicalSnapshot {
  documentType: BusinessDocsStoredDocumentType
  contentHash: string | null
  updatedAt: string
}

export interface PlannedTask {
  id: string
  contextHandle: string
  taskType: BusinessDocsTaskType
  documentType: BusinessDocsStoredDocumentType
  scope: 'epic' | 'project'
  scopeId: string
  epicId: string | null
  projectId: string
  targetEpic: TargetEpicSnapshot | null
  targetKey: string
  dependsOnTaskIds: string[]
  dependencyPagesReady: boolean
  deferredPages: BusinessDocsContextPageKind[]
  sourceCards: SourceDocumentCard[]
  richContext: TaskRichContext | null
  existingCanonical: ExistingCanonicalSnapshot | null
  modelEvidence: ModelEvidenceCard[]
  sync?: {
    sourceHash: string
    staticSnapshotId: string | null
    reason: 'missing_document' | 'source_changed'
  }
}

export function startBusinessDocsGeneration(db: DB, input: StartInput): BusinessDocsStartServiceResult {
  const now = (input.now ?? (() => new Date()))().toISOString()
  const makeId = input.makeId ?? nanoid

  if (!input.newRun && (input.selectedEpicIds ?? []).length === 0) {
    const resumable = findResumableRun(db, input.projectId)
    if (resumable) {
      return { ok: true, data: summarizeExistingRun(db, resumable, now) }
    }
  }

  const preview = previewBusinessDocsGeneration(db, {
    projectId: input.projectId,
    selectedEpicIds: input.selectedEpicIds,
  })
  if (preview.blockers.some((blocker) => blocker.severity === 'fatal') || preview.selectedEpicCount === 0) {
    return {
      ok: false,
      code: 'BUSINESS_DOCS_START_BLOCKED',
      message: 'Business docs generation cannot start until preview blockers are resolved.',
      preview,
    }
  }

  const runId = prefixedId('run', makeId)
  const selectedEpicIds = preview.documentPlan.perEpic
    .filter((epic) => epic.blockers.length === 0)
    .map((epic) => epic.epicId)
  const targetEpicsById = loadTargetEpicSnapshots(db, input.projectId, selectedEpicIds)
  const sourceCardsByEpic = loadSourceDocumentCards(db, input.projectId, selectedEpicIds)
  const bundleByEpic = loadEpicSourceBundles(db, input.projectId, selectedEpicIds)
  const modelEvidenceByEpic = loadModelEvidenceCards(db, selectedEpicIds, sourceCardsByEpic)
  const shouldLoadExistingCanonical = input.forceRegenerate === true ||
    preview.documentPlan.projectGlossary === 'incremental_merge'
  const existingCanonicalByTarget = shouldLoadExistingCanonical
    ? loadExistingCanonicalSnapshots(db, input.projectId)
    : new Map<string, ExistingCanonicalSnapshot>()
  const plannedTasks = planTasks({
    preview,
    projectId: input.projectId,
    forceRegenerate: input.forceRegenerate === true,
    makeId,
    targetEpicsById,
    sourceCardsByEpic,
    bundleByEpic,
    modelEvidenceByEpic,
    existingCanonicalByTarget,
  })

  const policy = {
    ...DEFAULT_BUSINESS_DOCS_RUNTIME_POLICY,
    outputLanguage: input.outputLanguage ?? DEFAULT_BUSINESS_DOCS_RUNTIME_POLICY.outputLanguage,
  }
  const runRow: NewBusinessDocGenerationRun = {
    id: runId,
    projectId: input.projectId,
    status: 'running',
    policyJson: policy,
    previewSnapshotJson: preview,
    selectedEpicIdsJson: selectedEpicIds,
    sourceCommit: SOURCE_COMMIT,
    forceRegenerate: input.forceRegenerate === true ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  }

  db.transaction((tx) => {
    tx.insert(businessDocGenerationRuns).values(runRow).run()
    for (const task of plannedTasks) {
      tx.insert(businessDocGenerationTasks).values(toTaskRow({
        task,
        runId,
        projectId: input.projectId,
        maxRepairAttempts: policy.maxRepairAttempts,
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
        contentHash: hashJson(manifest),
        createdAt: now,
      } satisfies NewBusinessDocContextBundle).run()

      for (const page of buildPages({ task, runId, now, outputLanguage: policy.outputLanguage })) {
        tx.insert(businessDocContextPages).values(page).run()
      }
    }
  })

  return {
    ok: true,
    data: {
      mode: 'created',
      run: {
        id: runId,
        projectId: input.projectId,
        status: 'running',
        sourceCommit: SOURCE_COMMIT,
        forceRegenerate: input.forceRegenerate === true,
        createdAt: now,
        updatedAt: now,
      },
      project: preview.project,
      policy,
      preview,
      tasks: summarizeCreatedTasks(plannedTasks, preview, input.forceRegenerate === true),
      contexts: {
        bundlesCreated: plannedTasks.length,
        pagesCreated: countPlannedContextPages(plannedTasks),
        deferredDependencyContexts: plannedTasks.filter((task) => !task.dependencyPagesReady).length,
      },
      nextAction: {
        type: 'lease_tasks',
      },
    },
  }
}

function findResumableRun(db: DB, projectId: string): BusinessDocGenerationRun | null {
  const runs = db.select().from(businessDocGenerationRuns)
    .where(and(
      eq(businessDocGenerationRuns.projectId, projectId),
      inArray(businessDocGenerationRuns.status, RESUMABLE_RUN_STATUSES),
    ))
    .orderBy(desc(businessDocGenerationRuns.createdAt))
    .all()

  for (const run of runs) {
    if (!isBusinessDocsGenerationPreview(run.previewSnapshotJson)) continue
    const tasks = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.runId, run.id))
      .all()
    if (tasks.some((task) => !TERMINAL_TASK_STATUSES.has(task.status))) return run
  }
  return null
}

function isBusinessDocsGenerationPreview(value: unknown): value is BusinessDocsPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return !!record.project &&
    typeof record.project === 'object' &&
    typeof record.confirmedEpicCount === 'number' &&
    typeof record.selectedEpicCount === 'number' &&
    Array.isArray(record.blockers) &&
    !!record.documentPlan &&
    typeof record.documentPlan === 'object' &&
    !!record.estimatedTasks &&
    typeof record.estimatedTasks === 'object'
}

function summarizeExistingRun(db: DB, run: BusinessDocGenerationRun, now: string): BusinessDocsStartResult {
  const tasks = db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.runId, run.id))
    .all()
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
      status: run.status,
      sourceCommit: run.sourceCommit,
      forceRegenerate: run.forceRegenerate === 1,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt ?? now,
    },
    project: run.previewSnapshotJson.project,
    policy: run.policyJson,
    preview: run.previewSnapshotJson,
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

function planTasks(input: {
  preview: BusinessDocsPreview
  projectId: string
  forceRegenerate: boolean
  makeId: () => string
  targetEpicsById: Map<string, TargetEpicSnapshot>
  sourceCardsByEpic: Map<string, SourceDocumentCard[]>
  bundleByEpic: Map<string, EpicSourceBundle>
  modelEvidenceByEpic: Map<string, ModelEvidenceCard[]>
  existingCanonicalByTarget: Map<string, ExistingCanonicalSnapshot>
}): PlannedTask[] {
  const tasks: PlannedTask[] = []
  const taskByKey = new Map<string, PlannedTask>()
  const epicGlossaryTasks: PlannedTask[] = []

  for (const epic of input.preview.documentPlan.perEpic.filter((item) => item.blockers.length === 0)) {
    const existing = new Set(epic.existingPassedDocTypes)
    const missing = new Set(epic.missingDocTypes)
    const epicSourceCards = input.sourceCardsByEpic.get(epic.epicId) ?? []
    const epicBundle = input.bundleByEpic.get(epic.epicId) ?? null
    const epicModelEvidence = input.modelEvidenceByEpic.get(epic.epicId) ?? []
    const upstreamTasks: PlannedTask[] = []

    for (const taskType of SOURCE_FIRST_TASKS) {
      const previewDocType = taskToPreviewDocType(taskType)
      if (!input.forceRegenerate && !missing.has(previewDocType)) continue
      const task = makeTask({
        projectId: input.projectId,
        epicId: epic.epicId,
        taskType,
        scope: 'epic',
        scopeId: epic.epicId,
        targetEpic: input.targetEpicsById.get(epic.epicId) ?? {
          id: epic.epicId,
          name: epic.epicName,
          stableKey: null,
          summary: null,
        },
        dependsOnTaskIds: [],
        makeId: input.makeId,
        sourceCards: epicSourceCards,
        bundle: epicBundle,
        modelEvidence: epicModelEvidence,
        existingCanonicalByTarget: input.existingCanonicalByTarget,
      })
      tasks.push(task)
      upstreamTasks.push(task)
      taskByKey.set(`${epic.epicId}:${taskType}`, task)
    }

    const useCaseList = taskByKey.get(`${epic.epicId}:use_case_list`)
    if (useCaseList) {
      tasks.push(makeTask({
        projectId: input.projectId,
        epicId: epic.epicId,
        taskType: 'use_case_list_refine',
        scope: 'epic',
        scopeId: epic.epicId,
        targetEpic: input.targetEpicsById.get(epic.epicId) ?? {
          id: epic.epicId,
          name: epic.epicName,
          stableKey: null,
          summary: null,
        },
        dependsOnTaskIds: [useCaseList.id],
        makeId: input.makeId,
        sourceCards: epicSourceCards,
        bundle: epicBundle,
        modelEvidence: epicModelEvidence,
        existingCanonicalByTarget: input.existingCanonicalByTarget,
      }))
    }

    const hasExistingUpstream = ['system_design', 'data_dictionary', 'br', 'ucl']
      .some((docType) => existing.has(docType as BusinessDocsPreviewDocType))
    const shouldCreateEpicGlossary =
      input.forceRegenerate ||
      (missing.has('glossary') && (upstreamTasks.length > 0 || hasExistingUpstream))
    if (shouldCreateEpicGlossary) {
      const glossaryTask = makeTask({
        projectId: input.projectId,
        epicId: epic.epicId,
        taskType: 'epic_glossary',
        scope: 'epic',
        scopeId: epic.epicId,
        targetEpic: input.targetEpicsById.get(epic.epicId) ?? {
          id: epic.epicId,
          name: epic.epicName,
          stableKey: null,
          summary: null,
        },
        dependsOnTaskIds: upstreamTasks.map((task) => task.id),
        makeId: input.makeId,
        sourceCards: epicSourceCards,
        bundle: epicBundle,
        modelEvidence: epicModelEvidence,
        existingCanonicalByTarget: input.existingCanonicalByTarget,
      })
      tasks.push(glossaryTask)
      epicGlossaryTasks.push(glossaryTask)
    }
  }

  if (
    input.preview.documentPlan.projectGlossary === 'full_build' ||
    input.preview.documentPlan.projectGlossary === 'incremental_merge' ||
    (input.forceRegenerate && input.preview.selectedEpicCount > 0)
  ) {
    tasks.push(makeTask({
      projectId: input.projectId,
      epicId: null,
      taskType: 'project_glossary',
      scope: 'project',
      scopeId: input.projectId,
      targetEpic: null,
      dependsOnTaskIds: epicGlossaryTasks.map((task) => task.id),
      makeId: input.makeId,
      sourceCards: Array.from(input.sourceCardsByEpic.values()).flat(),
      bundle: null,
      modelEvidence: Array.from(input.modelEvidenceByEpic.values()).flat(),
      existingCanonicalByTarget: input.existingCanonicalByTarget,
    }))
  }

  return tasks
}

export function makeTask(input: {
  projectId: string
  epicId: string | null
  taskType: BusinessDocsTaskType
  scope: 'epic' | 'project'
  scopeId: string
  targetEpic: TargetEpicSnapshot | null
  dependsOnTaskIds: string[]
  makeId: () => string
  sourceCards: SourceDocumentCard[]
  bundle: EpicSourceBundle | null
  modelEvidence: ModelEvidenceCard[]
  existingCanonicalByTarget: Map<string, ExistingCanonicalSnapshot>
}): PlannedTask {
  const dependencyPagesReady = input.dependsOnTaskIds.length === 0
  const targetKey = makeTargetKey(input.scope, input.scopeId, input.taskType)
  return {
    id: prefixedId('task', input.makeId),
    contextHandle: prefixedId('context', input.makeId),
    taskType: input.taskType,
    documentType: TASK_DOCUMENT_TYPE[input.taskType],
    scope: input.scope,
    scopeId: input.scopeId,
    epicId: input.epicId,
    projectId: input.projectId,
    targetEpic: input.targetEpic,
    targetKey,
    dependsOnTaskIds: input.dependsOnTaskIds,
    dependencyPagesReady,
    deferredPages: dependencyPagesReady ? [] : ['upstream_business_docs'],
    sourceCards: input.sourceCards,
    richContext: input.bundle ? buildTaskRichContext(input.bundle, input.taskType) : null,
    modelEvidence: input.modelEvidence,
    existingCanonical: input.existingCanonicalByTarget.get(targetKey) ?? null,
  }
}

/**
 * Projects the EPIC's source bundle into the per-task-type LLM-ready shapes.
 * Source-document body + source_graph come from the doc-type projection (token
 * budgets differ by doc type); model/relation evidence are derived from the
 * bundle directly so every task carries consistent db-anchor evidence.
 */
function buildTaskRichContext(bundle: EpicSourceBundle, taskType: BusinessDocsTaskType): TaskRichContext {
  const projection = projectForTaskType(bundle, taskType)
  return {
    systemSourceDocIds: bundle.sourceDocuments.map((doc) => doc.id).sort(),
    sourceDocumentsProjection: {
      source_documents: sanitizeSourceCards((projection.source_documents ?? []) as Array<Record<string, unknown>>),
      related_screen_documents: sanitizeSourceCards((projection.related_screen_documents ?? []) as Array<Record<string, unknown>>),
      cross_epic_context: redactUnsafe(projection.cross_epic_context ?? []),
      source_gaps: bundle.sourceGaps,
    },
    modelEvidence: projectModelEvidenceForContext(bundle.modelEvidence),
    relationEvidence: projectRelationEvidenceForContext(bundle.docRelationLinks),
    sourceGraph: redactUnsafe(
      (projection.projection as Record<string, unknown> | undefined)?.source_graph
        ?? { epic_id: bundle.epic.id, documents: [], models: [], edges: [] },
    ) as Record<string, unknown>,
  }
}

// Curated allowlist for source-document card bodies. We forward the structured
// projection (summary + key_facts: route/request/response/auth/errors/rules/
// relations) but never the raw `content` blob, so arbitrary unknown keys (e.g.
// local-path or SQL instructions) cannot reach the external worker. This keeps
// the CLI's existing safe-context guarantee while delivering rich SOT facts.
const SAFE_SOURCE_CARD_KEYS = new Set([
  'id',
  'type',
  'scope',
  'scope_id',
  'summary',
  'key_facts',
  'content',
  'matched_source_document_ids',
  'match_reason',
])

function sanitizeSourceCards(cards: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return cards.map((card) =>
    redactUnsafe(Object.fromEntries(
      Object.entries(card).filter(([key]) => SAFE_SOURCE_CARD_KEYS.has(key)),
    )) as Record<string, unknown>)
}

const REDACTION = '[redacted]'
// Redact ONLY environment / secret material that must not leak to the external worker:
// secret env-var assignments, credentialed connection strings, private keys, cloud
// access keys, and absolute local filesystem paths / on-disk DB files (which reveal the
// host environment). Ordinary business prose — including words like "create"/"update"/
// "open", SQL verbs, table names, and route paths (/api/orders) — passes through intact.
// We deliberately do NOT match-to-end-of-text, which previously mangled real content.
const UNSAFE_TEXT_PATTERNS: RegExp[] = [
  // UPPER_SNAKE secret/env var assignments: API_KEY=..., DB_PASSWORD: ..., *_SECRET=...
  /\b[A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|AUTH_?TOKEN|ACCESS_?TOKEN|CREDENTIALS?)\b\s*[:=]\s*\S+/g,
  // credentials embedded in a connection string: scheme://user:pass@host
  /\b[a-z][a-z0-9+.\-]*:\/\/[^\s:@/]+:[^\s:@/]+@\S+/gi,
  // PEM private key blocks
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // common cloud access key id (e.g. AWS AKIA...)
  /\bAKIA[0-9A-Z]{16}\b/g,
  // absolute local filesystem paths (with extension) + on-disk DB files — host env leak
  /(?:\/[\w.-]+)+\.[A-Za-z0-9]+/g,
  /\b[\w./-]*\.(?:sqlite|sqlite3|db)\b/gi,
]

function redactUnsafeText(value: string): string {
  let result = value
  for (const pattern of UNSAFE_TEXT_PATTERNS) result = result.replace(pattern, REDACTION)
  return result
}

function redactUnsafe(value: unknown): unknown {
  if (typeof value === 'string') return redactUnsafeText(value)
  if (Array.isArray(value)) return value.map(redactUnsafe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactUnsafe(item)]))
  }
  return value
}

function projectForTaskType(bundle: EpicSourceBundle, taskType: BusinessDocsTaskType): Record<string, unknown> {
  switch (taskType) {
    case 'data_dictionary':
      return projectDataDictionaryInputs(bundle, null)
    case 'business_rules':
      return projectBusinessRulesInputs(bundle, null, null)
    case 'use_case_list':
    case 'use_case_list_refine':
      return projectUseCaseListInputs(bundle, null, null, null)
    case 'epic_glossary':
      return projectEpicGlossaryInputs(bundle, {
        design: null,
        dataDictionary: null,
        businessRules: null,
        useCaseList: null,
        useCaseSpecs: [],
      })
    case 'system_design':
    default:
      return projectDesignInputs(bundle)
  }
}

function projectModelEvidenceForContext(modelEvidence: EpicSourceBundle['modelEvidence']): Array<Record<string, unknown>> {
  return modelEvidence.map((evidence) => ({
    id: evidence.model.id,
    name: evidence.model.name,
    table_name: evidence.model.tableName,
    field_count: evidence.model.fields.length,
    relation_count: evidence.model.relations.length,
    fields: evidence.model.fields,
    relations: evidence.model.relations,
    source_document_ids: evidence.sourceDocumentIds,
    relation_targets: evidence.relationTargets,
  }))
}

function projectRelationEvidenceForContext(links: DocRelationLink[]): Array<Record<string, unknown>> {
  return links.map((link) => ({
    document_id: link.documentId,
    kind: link.kind,
    operation: link.operation,
    target: link.target,
    canonical_target: link.canonicalTarget,
    confidence: link.confidence,
  }))
}

export function toTaskRow(input: {
  task: PlannedTask
  runId: string
  projectId: string
  maxRepairAttempts: number
  now: string
}): NewBusinessDocGenerationTask {
  return {
    id: input.task.id,
    runId: input.runId,
    projectId: input.projectId,
    epicId: input.task.epicId,
    taskType: input.task.taskType,
    documentType: input.task.documentType,
    scope: input.task.scope,
    scopeId: input.task.scopeId,
    targetKey: input.task.targetKey,
    status: 'pending',
    dependsOnTaskIdsJson: input.task.dependsOnTaskIds,
    attemptNo: 0,
    maxRepairAttempts: input.maxRepairAttempts,
    contextHandle: input.task.contextHandle,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function buildManifest(input: { task: PlannedTask; runId: string; now: string }): BusinessDocsContextManifest {
  return {
    runId: input.runId,
    taskId: input.task.id,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    sourceCommit: SOURCE_COMMIT,
    generatedAt: input.now,
    evidenceIdNamespace: `${input.runId}:${input.task.id}`,
    pageTokens: buildPageTokens(input.task),
    dependencyTaskIds: input.task.dependsOnTaskIds,
    dependencyPagesReady: input.task.dependencyPagesReady,
    deferredPages: input.task.deferredPages,
  }
}

export function buildPages(input: { task: PlannedTask; runId: string; now: string; outputLanguage?: 'ko' | 'en' }): NewBusinessDocContextPage[] {
  const targetContent = {
    runId: input.runId,
    taskId: input.task.id,
    taskType: input.task.taskType,
    documentType: input.task.documentType,
    scope: input.task.scope,
    scopeId: input.task.scopeId,
    epicId: input.task.epicId,
    outputLanguage: input.outputLanguage ?? DEFAULT_BUSINESS_DOCS_RUNTIME_POLICY.outputLanguage,
    sourceCommit: SOURCE_COMMIT,
    dependencyTaskIds: input.task.dependsOnTaskIds,
    target: {
      projectId: input.task.projectId,
      scope: input.task.scope,
      scopeId: input.task.scopeId,
      epic: input.task.targetEpic,
    },
  }
  const schemaContent = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    expectedJson: {
      type: input.task.documentType,
      scope: input.task.scope,
      scopeId: input.task.scopeId,
      evidenceRefs: 'must reference evidence ids from this context only',
      expectedItemContent: expectedItemContentContract(input.task.documentType, input.task.taskType),
    },
    glossaryRegistryRules: input.task.documentType === 'glossary'
      ? [
        'Use canonical_term for the company-standard term.',
        'Put only evidence-backed equivalents in aliases.',
        'Put vague natural language guesses in candidate_aliases.',
        'Use related_terms for near concepts that must not be silently merged.',
        'Use ambiguity.status=ambiguous when one surface term can mean multiple business concepts.',
        'Include bilingual Korean/English variants in synonyms when source evidence supports them.',
      ]
      : undefined,
  }
  const rich = input.task.richContext
  // Index projected source bodies by their source documents.id.
  const projectedById = new Map<string, Record<string, unknown>>()
  if (rich) {
    const projected = (rich.sourceDocumentsProjection.source_documents ?? []) as Array<Record<string, unknown>>
    for (const doc of projected) {
      if (typeof doc.id === 'string') projectedById.set(doc.id, doc)
    }
  }
  const sourceCards: SourceProjectionCard[] = input.task.sourceCards.map((card, index) => {
    const evidenceId = makeEvidenceId({
      runId: input.runId,
      taskId: input.task.id,
      kind: 'source_document',
      ordinal: index + 1,
    })
    const projection = projectedById.get(card.documentId)
    return {
      evidenceId,
      sourceRef: `source_document_${index + 1}`,
      documentId: card.documentId,
      documentType: card.documentType,
      scope: card.scope,
      scopeId: card.scopeId,
      summary: card.summary,
      contentProjection: projection ? 'source_graph_projection' : 'business_docs_source_v1',
      epicLink: card.epicLink,
      facts: card.facts,
      ...(projection ?? {}),
    }
  })
  const sourceContent = {
    systemSourceDocIds: rich?.systemSourceDocIds ?? [],
    cards: sourceCards,
    related_screen_documents: rich?.sourceDocumentsProjection.related_screen_documents ?? [],
    cross_epic_context: rich?.sourceDocumentsProjection.cross_epic_context ?? [],
    source_gaps: rich?.sourceDocumentsProjection.source_gaps ?? [],
  }

  // systemSourceDocIds is also stamped on the always-present target page so
  // submit can recover it from context pages (Phases B/C fuel).
  const targetContentWithSources = {
    ...targetContent,
    sync: input.task.sync,
    systemSourceDocIds: rich?.systemSourceDocIds ?? [],
  }
  const sourceGraphContent = buildSourceGraphProjection(sourceCards)
  const relationEvidence = sourceGraphContent.coverageOutline.clusters.flatMap((cluster) => cluster.relationEvidence)

  const pages = [
    makePage({ task: input.task, pageToken: 'target', pageKind: 'target', pageOrder: 0, summary: 'Task target', content: targetContentWithSources, now: input.now }),
    makePage({ task: input.task, pageToken: 'schema', pageKind: 'schema', pageOrder: 1, summary: 'Output schema summary', content: schemaContent, now: input.now }),
    makePage({
      task: input.task,
      pageToken: 'source_document_cards',
      pageKind: 'source_document_cards',
      pageOrder: 2,
      summary: 'Source document cards',
      content: sourceContent,
      now: input.now,
      evidenceIds: sourceCards.map((card) => card.evidenceId),
    }),
    makePage({
      task: input.task,
      pageToken: 'source_graph_projection',
      pageKind: 'source_graph_projection',
      pageOrder: 3,
      summary: 'Source coverage outline',
      content: sourceGraphContent,
      now: input.now,
      evidenceIds: sourceGraphContent.coverageOutline.clusters.flatMap((cluster) => cluster.evidenceIds),
    }),
  ]

  if (relationEvidence.length > 0) {
    pages.push(makePage({
      task: input.task,
      pageToken: 'relation_evidence',
      pageKind: 'relation_evidence',
      pageOrder: pages.length,
      summary: 'Screen/API and source relation evidence',
      content: { relations: relationEvidence },
      now: input.now,
      evidenceIds: relationEvidence.map((_, index) => makeEvidenceId({
        runId: input.runId,
        taskId: input.task.id,
        kind: 'relation_evidence',
        ordinal: index + 1,
      })),
    }))
  }

  const modelEvidence = input.task.modelEvidence.length > 0 ? input.task.modelEvidence : (rich?.modelEvidence ?? [])
  if (modelEvidence.length > 0 || rich) {
    const evidenceIds = modelEvidence.map((_, index) => makeEvidenceId({
      runId: input.runId,
      taskId: input.task.id,
      kind: 'model_evidence',
      ordinal: index + 1,
    }))
    pages.push(makePage({
      task: input.task,
      pageToken: 'model_evidence',
      pageKind: 'model_evidence',
      pageOrder: pages.length,
      summary: 'Model/table/field evidence',
      content: {
        models: modelEvidence.map((model, index) => ({
          ...model,
          evidenceId: evidenceIds[index],
        })),
      },
      now: input.now,
      evidenceIds,
    }))
  }

  if (input.task.existingCanonical) {
    const evidenceId = makeEvidenceId({
      runId: input.runId,
      taskId: input.task.id,
      kind: 'existing_canonical',
      ordinal: 1,
    })
    pages.push(makePage({
      task: input.task,
      pageToken: 'existing_canonical',
      pageKind: 'existing_canonical',
      pageOrder: pages.length,
      summary: 'Existing canonical document metadata',
      content: {
        document: {
          evidenceId,
          documentType: input.task.existingCanonical.documentType,
          contentHash: input.task.existingCanonical.contentHash,
          updatedAt: input.task.existingCanonical.updatedAt,
          contentProjection: 'metadata_only',
        },
      },
      now: input.now,
      evidenceIds: [evidenceId],
    }))
  }

  return pages
}

function expectedItemContentContract(
  documentType: BusinessDocsStoredDocumentType,
  taskType: BusinessDocsTaskType,
): Record<string, string> | null {
  if (documentType === 'ucl') {
    return {
      sourceClusterIds: 'string[]',
      coverageRelation: 'owned_by_epic | supporting | cross_epic | topical_cluster',
      ownedByEpic: 'boolean',
      primarySourceRefs: 'string[]',
      supportingSourceRefs: 'string[]',
      crossEpicSourceRefs: 'string[]',
      relationEvidenceRefs: 'string[]',
      uncertainty: 'string[]',
    }
  }
  if (documentType === 'br') {
    return {
      earsPattern: 'ubiquitous | event_driven | state_driven | optional | unwanted',
      condition: 'string',
      rule: 'string',
      outcome: 'string',
      ownership: 'owned_by_epic | handoff | reference',
      source_mapping: 'Array<{ sourceRef: string; role: string; reason: string }>',
    }
  }
  if (documentType === 'data_dictionary') {
    return {
      entity: 'string',
      fields: 'Array<{ name: string; type?: string; meaning: string; source_mapping: string[] }>',
      states: 'string[]',
      relationships: 'Array<{ from: string; to: string; meaning: string }>',
      gapType: 'missing_model_evidence when model evidence is absent',
    }
  }
  if (documentType === 'design') {
    return {
      component: 'string',
      responsibility: 'string',
      flow: 'string[]',
      integration_points: 'string[]',
      source_mapping: 'Array<{ sourceRef: string; role: string; reason: string }>',
      relationConfidence: 'direct_call_proven | relation_inferred | topical_cluster | cross_epic',
    }
  }
  if (documentType === 'glossary') {
    return {
      term: 'string',
      canonical_term: 'string',
      definition: 'string',
      termType: 'domain | role | process | status | forbidden | ambiguous',
      aliases: 'string[] confirmed aliases',
      candidate_aliases: 'string[] unconfirmed natural-language aliases',
      synonyms: 'string[] including bilingual variants',
      antonyms: 'string[] opposite or contrast terms',
      contrast_terms: 'string[] optional contrast terms when antonym is too strong',
      related_terms: 'string[] near but not equivalent terms',
      signals: 'string[] business-language search clues only; do not include class, service, usecase, controller, repository, API path, SQL, or DTO identifiers',
      code_term: 'string optional code identifier or DB value',
      source_mapping: 'Array<{ sourceRef: string; role: string; reason: string }>',
      ambiguity: 'object with status none | ambiguous | user_resolved, candidates, and optional resolution_note',
    }
  }
  if (taskType === 'use_case_spec') {
    return {
      actor: 'string',
      trigger: 'string',
      preconditions: 'string[]',
      main_success_flow: 'string[]',
      alternatives: 'string[]',
      exceptions: 'string[]',
      business_rules: 'string[]',
      source_mapping: 'Array<{ sourceRef: string; role: string; reason: string }>',
      uncertainty: 'string[]',
    }
  }
  return null
}

function makePage(input: {
  task: PlannedTask
  pageToken: string
  pageKind: BusinessDocsContextPageKind
  pageOrder: number
  summary: string
  content: Record<string, unknown>
  now: string
  evidenceIds?: string[]
}): NewBusinessDocContextPage {
  return {
    contextHandle: input.task.contextHandle,
    pageToken: input.pageToken,
    pageKind: input.pageKind,
    pageOrder: input.pageOrder,
    summary: input.summary,
    evidenceIdsJson: input.evidenceIds ?? [],
    contentJson: input.content,
    contentHash: hashJson(input.content),
    createdAt: input.now,
  }
}

function buildSourceGraphProjection(sourceCards: SourceProjectionCard[]): {
  coverageOutline: {
    schemaVersion: 'business-docs-source-coverage.v1'
    sourceDocumentCount: number
    clusterCount: number
    expectedUseCaseCount: {
      min: number
      reason: string
    }
    clusters: SourceCoverageCluster[]
  }
} {
  const clustersByKey = new Map<string, SourceCoverageCluster>()
  for (const card of sourceCards) {
    const clusterKey = sourceClusterKey(card)
    const clusterId = `cluster:${clusterKey}`
    const existing = clustersByKey.get(clusterId)
    const identity = isRecord(card.facts.identity) ? card.facts.identity : null
    if (existing) {
      existing.sourceRefs.push(card.sourceRef)
      existing.evidenceIds.push(card.evidenceId)
      existing.documentIds.push(card.documentId)
      existing.documentTypeCounts[card.documentType] = (existing.documentTypeCounts[card.documentType] ?? 0) + 1
      existing.sourceRoles[card.epicLink.role] = (existing.sourceRoles[card.epicLink.role] ?? 0) + 1
      existing.sourceRefRoles[card.sourceRef] = card.epicLink.role
      existing.sourceConfidences[card.epicLink.confidence] = (existing.sourceConfidences[card.epicLink.confidence] ?? 0) + 1
      existing.sourceRefConfidences[card.sourceRef] = card.epicLink.confidence
      if (identity) existing.representativeIdentities.push(identity)
      existing.relationEvidence.push(...extractSourceRelationEvidence(card))
      continue
    }
    clustersByKey.set(clusterId, {
      clusterId,
      title: titleFromClusterKey(clusterKey),
      sourceRefs: [card.sourceRef],
      evidenceIds: [card.evidenceId],
      documentIds: [card.documentId],
      documentTypeCounts: { [card.documentType]: 1 },
      sourceRoles: { [card.epicLink.role]: 1 },
      sourceRefRoles: { [card.sourceRef]: card.epicLink.role },
      sourceConfidences: { [card.epicLink.confidence]: 1 },
      sourceRefConfidences: { [card.sourceRef]: card.epicLink.confidence },
      representativeIdentities: identity ? [identity] : [],
      relationEvidence: extractSourceRelationEvidence(card),
    })
  }
  const clusters = [...clustersByKey.values()]
  const expectedMin = clusters.length <= 1 ? clusters.length : Math.max(2, Math.ceil(clusters.length / 2))
  return {
    coverageOutline: {
      schemaVersion: 'business-docs-source-coverage.v1',
      sourceDocumentCount: sourceCards.length,
      clusterCount: clusters.length,
      expectedUseCaseCount: {
        min: expectedMin,
        reason: 'Final UCL should cover every source coverage cluster and should not collapse many independent source clusters into too few use cases.',
      },
      clusters,
    },
  }
}

function extractSourceRelationEvidence(card: SourceProjectionCard): SourceRelationEvidence[] {
  const relations = isRecord(card.facts.relations) ? card.facts.relations : null
  if (!relations) return []
  const evidence: SourceRelationEvidence[] = []
  for (const [relationType, value] of Object.entries(relations)) {
    const items = Array.isArray(value) ? value : [value]
    for (const item of items) {
      const target = relationTarget(item)
      if (!target) continue
      evidence.push({
        sourceRef: card.sourceRef,
        documentId: card.documentId,
        relationType,
        target,
        confidence: relationConfidence(item) ?? card.epicLink.confidence,
        relationClassification: 'relation_inferred',
        epicRole: card.epicLink.role,
        epicConfidence: card.epicLink.confidence,
        evidence: isRecord(item) ? safeJsonValue(item.evidence) : undefined,
      })
    }
  }
  return evidence
}

function relationTarget(value: unknown): string | null {
  if (typeof value === 'string') return safeString(value)
  if (!isRecord(value)) return null
  const method = safeString(value.method)
  const path = safeString(value.path)
  if (method && path) return `${method.toUpperCase()} ${path}`
  const table = safeString(value.table)
  const operation = safeString(value.operation)
  if (table && operation) return `${operation} ${table}`
  if (table) return table
  for (const key of ['target', 'canonical_target', 'canonicalTarget', 'route_path', 'topic', 'handler', 'name']) {
    const candidate = safeString(value[key])
    if (candidate) return candidate
  }
  return null
}

function relationConfidence(value: unknown): string | null {
  if (!isRecord(value)) return null
  return safeString(value.confidence)
}

function sourceClusterKey(card: SourceProjectionCard): string {
  const identity = isRecord(card.facts.identity) ? card.facts.identity : {}
  const candidates = [
    identity.path,
    identity.route_path,
    identity.handler,
    identity.screen_name,
    identity.component,
    identity.topic,
    identity.job_name,
    card.epicLink.reason,
    card.summary,
    card.facts.title,
    card.documentId,
  ]
  const tokens = Array.from(new Set(candidates.flatMap((candidate) => significantTokens(candidate)).map(normalizeClusterToken)))
  if (tokens.length === 0) return slugForCluster(card.documentId)
  const action = actionBucket(tokens)
  const domainTokens = tokens
    .filter((token) => !ACTION_BUCKET_TOKENS.has(token))
    .filter((token) => token !== action)
    .slice(0, 2)
  const keyParts = domainTokens.length > 0 ? [...domainTokens, action] : [action]
  return keyParts.join('-')
}

function significantTokens(value: unknown): string[] {
  const safe = safeString(value)
  if (!safe) return []
  const tokens = safe
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/:[A-Za-z0-9_가-힣-]+/g, ' ')
    .replace(/([a-z가-힣])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9가-힣]+/)
    .map((token) => normalizeClusterToken(token.trim().toLowerCase()))
    .filter((token) => token.length >= 2)
    .filter((token) => !SOURCE_CLUSTER_STOPWORDS.has(token))
    .filter((token) => !/^v\d+$/.test(token))
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !/(controller|usecase|page|widget|listener|handler|screen)$/.test(token))
  return Array.from(new Set(tokens)).slice(0, 8)
}

function titleFromClusterKey(clusterKey: string): string {
  return clusterKey
    .split('-')
    .filter(Boolean)
    .join(' ')
}

function slugForCluster(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'source'
}

function normalizeClusterToken(token: string): string {
  const normalized = normalizeKoreanParticle(singularizeClusterToken(token))
  const aliases: Record<string, string> = {
    검수: 'inspection',
    승인: 'approve',
    반려: 'reject',
    목록: 'list',
    상세: 'detail',
    요약: 'summary',
    조회: 'view',
    안내: 'guide',
    소개: 'introduce',
    수정: 'edit',
    작성: 'write',
    제출: 'submit',
    알림: 'notification',
    개인화: 'personalization',
    전처리: 'preprocess',
    리포트: 'report',
    키워드: 'keyword',
    클러스터링: 'clustering',
    공개: 'public',
  }
  return aliases[token] ?? aliases[normalized] ?? normalized
}

function singularizeClusterToken(token: string): string {
  if (token.endsWith('ies')) return token.replace(/ies$/, 'y')
  if (/[a-z]{4,}s$/.test(token) && !/(ss|us|is)$/.test(token)) return token.slice(0, -1)
  return token
}

function normalizeKoreanParticle(token: string): string {
  return token.replace(/(으로|에서|부터|까지|에게|으로서|로서|으로써|로써|와|과|은|는|이|가|을|를|의|로|에)$/u, '')
}

function actionBucket(tokens: string[]): string {
  const tokenSet = new Set(tokens)
  if (hasAny(tokenSet, ['edit', 'rewrite', 'rejected', 'update', '수정', '갱신', '반려'])) return 'edit'
  if (hasAny(tokenSet, ['inspection', 'review', 'approve', 'reject', 'ai', '검수', '승인'])) return 'review'
  if (hasAny(tokenSet, ['notification', 'batch', 'report', 'preprocess', 'message', '알림', '배치', '리포트', '전처리'])) return 'automation'
  if (hasAny(tokenSet, ['submit', 'draft', 'post', 'write', 'create', '작성', '제출', '초안'])) return 'authoring'
  if (hasAny(tokenSet, ['read', 'view', 'summary', 'list', 'detail', '조회', '상세', '목록', '요약'])) return 'view'
  if (hasAny(tokenSet, ['guide', 'tip', 'introduce', 'onboarding', '가이드', '안내', '소개'])) return 'guide'
  return 'general'
}

function hasAny(tokens: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate))
}

function summarizeCreatedTasks(
  plannedTasks: PlannedTask[],
  preview: BusinessDocsPreview,
  forceRegenerate: boolean,
): BusinessDocsStartResult['tasks'] {
  return {
    total: plannedTasks.length,
    created: plannedTasks.length,
    resumable: plannedTasks.length,
    skippedExisting: forceRegenerate ? 0 : countSkippedExisting(preview),
    byType: countPlannedTasksByType(plannedTasks),
  }
}

function countSkippedExisting(preview: BusinessDocsPreview): number {
  let skipped = 0
  for (const epic of preview.documentPlan.perEpic.filter((item) => item.blockers.length === 0)) {
    if (epic.existingPassedDocTypes.includes('system_design')) skipped += 1
    if (epic.existingPassedDocTypes.includes('data_dictionary')) skipped += 1
    if (epic.existingPassedDocTypes.includes('br')) skipped += 1
    if (epic.existingPassedDocTypes.includes('ucl')) skipped += 1
    if (epic.existingPassedDocTypes.includes('glossary')) skipped += 1
  }
  return skipped
}

export function countPlannedTasksByType(tasks: PlannedTask[]): BusinessDocsEstimatedTasks {
  const counts = emptyEstimatedTasks()
  for (const task of tasks) {
    counts[task.taskType] += 1
  }
  counts.total = tasks.length
  return counts
}

export function countTasksByType(tasks: BusinessDocGenerationTask[]): BusinessDocsEstimatedTasks {
  const counts = emptyEstimatedTasks()
  for (const task of tasks) {
    counts[task.taskType] += 1
  }
  counts.total = tasks.length
  return counts
}

export function countPlannedContextPages(tasks: PlannedTask[]): number {
  return tasks.reduce((total, task) => total + buildPageTokens(task).length, 0)
}

function buildPageTokens(task: PlannedTask): string[] {
  const pageTokens = ['target', 'schema', 'source_document_cards', 'source_graph_projection']
  if (task.sourceCards.some((card) => extractSourceRelationEvidence({
    ...card,
    evidenceId: '',
    sourceRef: '',
  }).length > 0)) {
    pageTokens.push('relation_evidence')
  }
  if (task.modelEvidence.length > 0 || task.richContext) pageTokens.push('model_evidence')
  if (task.existingCanonical) pageTokens.push('existing_canonical')
  return pageTokens
}

function emptyEstimatedTasks(): BusinessDocsEstimatedTasks {
  return {
    system_design: 0,
    data_dictionary: 0,
    business_rules: 0,
    use_case_list: 0,
    use_case_list_refine: 0,
    use_case_spec: 0,
    epic_glossary: 0,
    project_glossary: 0,
    total: 0,
  }
}

export function loadTargetEpicSnapshots(db: DB, projectId: string, epicIds: string[]): Map<string, TargetEpicSnapshot> {
  if (epicIds.length === 0) return new Map()
  const rows = db.select({
    id: epics.id,
    name: epics.name,
    stableKey: epics.stableKey,
    summary: epics.summary,
  }).from(epics)
    .where(and(
      eq(epics.projectId, projectId),
      inArray(epics.id, epicIds),
    ))
    .all()
  return new Map(rows.map((row) => [row.id, {
    id: row.id,
    name: row.name,
    stableKey: row.stableKey,
    summary: row.summary,
  }]))
}

export function loadSourceDocumentCards(db: DB, projectId: string, epicIds: string[]): Map<string, SourceDocumentCard[]> {
  const cardsByEpic = new Map<string, SourceDocumentCard[]>()
  for (const epicId of epicIds) cardsByEpic.set(epicId, [])
  if (epicIds.length === 0) return cardsByEpic

  const rows = db.select({
    epicId: epicDocumentLinks.epicId,
    documentId: documents.id,
    linkDocumentType: epicDocumentLinks.documentType,
    documentType: documents.type,
    scope: documents.scope,
    scopeId: documents.scopeId,
    summary: documents.summary,
    content: documents.content,
    linkRole: epicDocumentLinks.role,
    linkReason: epicDocumentLinks.reason,
    linkConfidence: epicDocumentLinks.confidence,
  }).from(epicDocumentLinks)
    .innerJoin(documents, eq(documents.id, epicDocumentLinks.documentId))
    .where(and(
      inArray(epicDocumentLinks.epicId, epicIds),
      inArray(epicDocumentLinks.documentType, LOWER_DOC_TYPES),
      eq(documents.projectId, projectId),
      inArray(documents.status, SOURCE_DOCUMENT_STATUSES),
      eq(documents.track, 'technical'),
      inArray(documents.type, LOWER_DOC_TYPES),
    ))
    .orderBy(asc(epicDocumentLinks.epicId), asc(documents.type), asc(documents.id))
    .all()

  for (const row of rows) {
    if (row.linkDocumentType !== row.documentType) continue
    const cards = cardsByEpic.get(row.epicId)
    if (!cards) continue
    const facts = projectSourceDocumentFacts(row.content)
    cards.push({
      documentId: row.documentId,
      documentType: row.documentType,
      scope: row.scope,
      scopeId: projectSourceScopeId(row.scopeId, facts),
      summary: safeString(row.summary),
      epicLink: {
        role: row.linkRole,
        reason: row.linkReason,
        confidence: row.linkConfidence,
      },
      facts,
    })
  }

  // Stable ordering so evidence ids are deterministic across runs.
  for (const cards of cardsByEpic.values()) {
    cards.sort((a, b) => a.documentId.localeCompare(b.documentId))
  }

  return cardsByEpic
}

/**
 * Loads the per-EPIC EpicSourceBundle once for a run. All DB arrays
 * loadEpicSources needs are read a single time, then loadEpicSources is called
 * per selected EPIC. EPICs with no resolvable source documents are skipped
 * (NO_SOURCE_INPUTS) rather than aborting the whole run.
 */
export function loadEpicSourceBundles(db: DB, projectId: string, epicIds: string[]): Map<string, EpicSourceBundle> {
  const bundleByEpic = new Map<string, EpicSourceBundle>()
  if (epicIds.length === 0) return bundleByEpic

  const projectDocuments = db.select().from(documents)
    .where(eq(documents.projectId, projectId)).all() as Document[]
  const documentIds = new Set(projectDocuments.map((doc) => doc.id))

  const allEpicDocumentLinks = db.select().from(epicDocumentLinks)
    .where(inArray(epicDocumentLinks.epicId, epicIds)).all() as EpicDocumentLink[]
  const allEpicDependencies = db.select().from(epicDependencies)
    .where(or(
      inArray(epicDependencies.sourceEpicId, epicIds),
      inArray(epicDependencies.targetEpicId, epicIds),
    )).all() as EpicDependency[]

  const allDocRelationLinks = documentIds.size === 0
    ? []
    : (db.select().from(docRelationLinks)
      .where(inArray(docRelationLinks.documentId, [...documentIds])).all() as DocRelationLink[])
  const allDocumentLinks = documentIds.size === 0
    ? []
    : (db.select().from(documentLinks)
      .where(inArray(documentLinks.toDocumentId, [...documentIds])).all() as DocumentLink[])
  const allMemories = documentIds.size === 0
    ? []
    : (db.select().from(documentMemories)
      .where(inArray(documentMemories.documentId, [...documentIds])).all() as DocumentMemory[])

  const repoRows = db.select({ id: repositories.id }).from(repositories)
    .where(and(eq(repositories.projectId, projectId), isNull(repositories.deletedAt))).all()
  const repoIds = repoRows.map((row) => row.id)
  const allModels = repoIds.length === 0
    ? []
    : (db.select().from(models)
      .where(inArray(models.repositoryId, repoIds)).all() as Model[])

  const confirmedEpics = loadConfirmedEpics(db, projectId)
  const epicById = new Map(confirmedEpics.map((epic) => [epic.id, epic]))
  const existingBusinessDocs = projectDocuments.filter((doc) => doc.track === 'business')

  for (const epicId of epicIds) {
    const epic = epicById.get(epicId)
    if (!epic) continue
    try {
      bundleByEpic.set(epicId, loadEpicSources({
        projectId,
        epic,
        epics: confirmedEpics,
        documents: projectDocuments,
        epicDocumentLinks: allEpicDocumentLinks,
        epicDependencies: allEpicDependencies,
        docRelationLinks: allDocRelationLinks,
        documentLinks: allDocumentLinks,
        models: allModels,
        memories: allMemories,
        existingBusinessDocs,
        acceptedStatuses: SOURCE_DOCUMENT_STATUSES,
      }))
    } catch (error) {
      // NO_SOURCE_INPUTS: leave this EPIC without a rich bundle; preview-level
      // blockers already gate EPICs with zero linked sources.
      if ((error as { code?: string }).code !== 'NO_SOURCE_INPUTS') throw error
    }
  }

  return bundleByEpic
}

function loadConfirmedEpics(db: DB, projectId: string): ConfirmedEpic[] {
  return db.select({
    id: epics.id,
    projectId: epics.projectId,
    name: epics.name,
    abbr: epics.abbr,
    summary: epics.summary,
    confirmedAt: epics.confirmedAt,
  }).from(epics)
    .where(eq(epics.projectId, projectId))
    .all()
    .map((row) => ({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      abbr: row.abbr,
      summary: row.summary,
      confirmedAt: row.confirmedAt ?? '',
    }))
}

export function loadModelEvidenceCards(
  db: DB,
  epicIds: string[],
  sourceCardsByEpic: Map<string, SourceDocumentCard[]>,
): Map<string, ModelEvidenceCard[]> {
  const evidenceByEpic = new Map<string, ModelEvidenceCard[]>()
  for (const epicId of epicIds) evidenceByEpic.set(epicId, [])

  for (const epicId of epicIds) {
    const sourceCards = sourceCardsByEpic.get(epicId) ?? []
    const sourceDocumentIds = sourceCards.map((card) => card.documentId)
    if (sourceDocumentIds.length === 0) continue

    const relationRows = db.select({
      documentId: docRelationLinks.documentId,
      repoId: docRelationLinks.repoId,
      target: docRelationLinks.target,
      canonicalTarget: docRelationLinks.canonicalTarget,
      operation: docRelationLinks.operation,
      confidence: docRelationLinks.confidence,
    }).from(docRelationLinks)
      .where(and(
        inArray(docRelationLinks.documentId, sourceDocumentIds),
        eq(docRelationLinks.kind, 'db_access'),
      ))
      .all()

    const relationTargets = new Map<string, {
      sourceDocumentIds: Set<string>
      operations: Set<string>
      confidences: Set<string>
    }>()
    for (const row of relationRows) {
      const modelName = modelNameFromDbRelation(row.canonicalTarget ?? row.target)
      if (!modelName) continue
      const targetKey = modelTargetKey(row.repoId, modelName)
      const target = relationTargets.get(targetKey) ?? {
        sourceDocumentIds: new Set<string>(),
        operations: new Set<string>(),
        confidences: new Set<string>(),
      }
      target.sourceDocumentIds.add(row.documentId)
      const operation = safeString(row.operation) ?? operationFromDbRelation(row.canonicalTarget ?? row.target)
      if (operation) target.operations.add(operation)
      target.confidences.add(row.confidence)
      relationTargets.set(targetKey, target)
    }

    const modelNames = [...new Set(relationRows
      .map((row) => modelNameFromDbRelation(row.canonicalTarget ?? row.target))
      .filter((modelName): modelName is string => modelName !== null))]
    const repoIds = [...new Set(relationRows.map((row) => row.repoId))]
    if (modelNames.length === 0) continue
    const modelRows = db.select().from(models)
      .where(and(
        inArray(models.repositoryId, repoIds),
        or(
          inArray(models.name, modelNames),
          inArray(models.tableName, modelNames),
        ),
      ))
      .all()

    const evidence = modelRows
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 40)
      .flatMap((model): ModelEvidenceCard[] => {
        const target = relationTargets.get(modelTargetKey(model.repositoryId, model.name))
          ?? relationTargets.get(modelTargetKey(model.repositoryId, model.tableName))
        if (!target) return []
        return [{
          modelId: model.id,
          repositoryId: model.repositoryId,
          name: model.name,
          tableName: model.tableName,
          comment: safeString(model.comment),
          description: safeString(model.description),
          fields: safeJsonValue(model.fields),
          relations: safeJsonValue(model.relations),
          sourceDocumentIds: [...target.sourceDocumentIds],
          operations: [...target.operations],
          confidence: strongestConfidence([...target.confidences]),
        }]
      })
    evidenceByEpic.set(epicId, evidence)
  }

  return evidenceByEpic
}

function modelNameFromDbRelation(value: unknown): string | null {
  const safe = safeString(value)
  if (!safe) return null
  const match = /^db:([^:]+)(?::[^:]+)?$/.exec(safe)
  if (match) return match[1]
  return safe
}

function modelTargetKey(repoId: string, modelName: string): string {
  return `${repoId}:${modelName}`
}

function operationFromDbRelation(value: unknown): string | null {
  const safe = safeString(value)
  if (!safe) return null
  const match = /^db:[^:]+:([^:]+)$/.exec(safe)
  return match?.[1] ?? null
}

function strongestConfidence(values: string[]): string {
  if (values.includes('high')) return 'high'
  if (values.includes('medium')) return 'medium'
  if (values.includes('low')) return 'low'
  return values[0] ?? 'unknown'
}

function projectSourceDocumentFacts(content: Record<string, unknown> | null): Record<string, unknown> {
  const source = isRecord(content) ? content : {}
  return compactObject({
    title: safeString(source.title),
    identity: projectIdentity(source.identity),
    flow: safeStringArray(source.flow ?? source.business_logic),
    rules: safeStringArray(source.rules ?? source.business_rules),
    relations: safeJsonValue(source.relations),
    actions: safeJsonValue(source.actions),
    state: safeJsonValue(source.state),
    contracts: safeJsonValue(source.contracts),
    payload: safeJsonValue(source.payload),
    schedule: safeJsonValue(source.schedule),
    trigger: safeJsonValue(source.trigger),
    consumers: safeJsonValue(source.consumers),
    listeners: safeJsonValue(source.listeners),
    evidence_gaps: safeStringArray(source.evidence_gaps),
  }) ?? {}
}

function projectIdentity(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  return compactObject({
    method: safeString(value.method),
    path: safeString(value.path),
    route_path: safeString(value.route_path),
    handler: safeString(value.handler),
    screen_name: safeString(value.screen_name),
    component: safeString(value.component),
    router: safeString(value.router),
    name: safeString(value.name),
    broker: safeString(value.broker),
    topic: safeString(value.topic),
    job_name: safeString(value.job_name),
  })
}

function projectSourceScopeId(value: unknown, facts: Record<string, unknown>): string | null {
  const scopeId = safeString(value)
  if (scopeId) return scopeId
  const identity = isRecord(facts.identity) ? facts.identity : {}
  const method = safeString(identity.method)
  const path = safeString(identity.path)
  if (method && path) return `${method} ${path}`
  for (const key of ['route_path', 'screen_name', 'handler', 'component', 'name', 'topic', 'job_name']) {
    const candidate = safeString(identity[key])
    if (candidate) return candidate
  }
  return null
}

function safeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined
  if (typeof value === 'string') return safeString(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 30)
      .map((item) => safeJsonValue(item, depth + 1))
      .filter((item) => item !== undefined)
    return items.length > 0 ? items : undefined
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      if (isForbiddenProjectionKey(key)) continue
      const projected = safeJsonValue(item, depth + 1)
      if (projected !== undefined) output[key] = projected
    }
    return Object.keys(output).length > 0 ? output : undefined
  }
  return undefined
}

function safeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .slice(0, 30)
    .map((item) => safeString(item))
    .filter((item): item is string => item !== null)
  return items.length > 0 ? items : undefined
}

function safeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || isForbiddenProjectionText(trimmed)) return null
  return trimmed.length > 800 ? `${trimmed.slice(0, 797)}...` : trimmed
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (isRecord(value) && Object.keys(value).length === 0) continue
    output[key] = value
  }
  return Object.keys(output).length > 0 ? output : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isForbiddenProjectionKey(key: string): boolean {
  return /(?:raw|sql|dbpath|file_path|filepath|source_file_path|localsourceinstruction|instruction)$/i.test(key)
}

function isForbiddenProjectionText(value: string): boolean {
  return /\bSELECT\s+/i.test(value) ||
    /\bopen\s+src\//i.test(value) ||
    /\bsrc\//i.test(value) ||
    /\.sqlite\b/i.test(value) ||
    /\/Users\//.test(value) ||
    /\/home\/azureuser\//.test(value)
}

export function loadExistingCanonicalSnapshots(db: DB, projectId: string): Map<string, ExistingCanonicalSnapshot> {
  const snapshotsByTarget = new Map<string, ExistingCanonicalSnapshot>()
  const rows = db.select({
    documentType: documents.type,
    scope: documents.scope,
    scopeId: documents.scopeId,
    contentHash: documents.contentHash,
    updatedAt: documents.updatedAt,
  }).from(documents).where(and(
    eq(documents.projectId, projectId),
    eq(documents.status, 'active'),
    eq(documents.track, 'business'),
    inArray(documents.type, BUSINESS_DOC_TYPES),
  )).all()

  for (const row of rows) {
    if (!isGenerationScope(row.scope) || !row.scopeId || !isBusinessDocsStoredDocumentType(row.documentType)) continue
    const snapshot: ExistingCanonicalSnapshot = {
      documentType: row.documentType,
      contentHash: row.contentHash,
      updatedAt: row.updatedAt,
    }
    for (const taskType of taskTypesForExistingCanonical(row.documentType, row.scope)) {
      snapshotsByTarget.set(makeTargetKey(row.scope, row.scopeId, taskType), snapshot)
    }
  }

  return snapshotsByTarget
}

export function taskToPreviewDocType(taskType: BusinessDocsTaskType): BusinessDocsPreviewDocType {
  if (taskType === 'system_design') return 'system_design'
  if (taskType === 'business_rules') return 'br'
  if (taskType === 'use_case_list' || taskType === 'use_case_list_refine') return 'ucl'
  if (taskType === 'use_case_spec') return 'ucs'
  if (taskType === 'epic_glossary' || taskType === 'project_glossary') return 'glossary'
  return taskType
}

function prefixedId(prefix: string, makeId: () => string): string {
  return `${prefix}:${makeId()}`
}

export function makeTargetKey(scope: 'epic' | 'project', scopeId: string, taskType: BusinessDocsTaskType): string {
  return `${scope}:${scopeId}:${taskType}`
}

function makeEvidenceId(input: { runId: string; taskId: string; kind: string; ordinal: number }): string {
  return `${input.runId}:${input.taskId}:${input.kind}:${input.ordinal}`
}

function isGenerationScope(value: string): value is 'epic' | 'project' {
  return value === 'epic' || value === 'project'
}

function isBusinessDocsStoredDocumentType(value: string): value is BusinessDocsStoredDocumentType {
  return (BUSINESS_DOC_TYPES as readonly string[]).includes(value)
}

function taskTypesForExistingCanonical(
  documentType: BusinessDocsStoredDocumentType,
  scope: 'epic' | 'project',
): BusinessDocsTaskType[] {
  if (documentType === 'design' && scope === 'epic') return ['system_design']
  if (documentType === 'data_dictionary' && scope === 'epic') return ['data_dictionary']
  if (documentType === 'br' && scope === 'epic') return ['business_rules']
  if (documentType === 'ucl' && scope === 'epic') return ['use_case_list', 'use_case_list_refine']
  if (documentType === 'glossary') return scope === 'project' ? ['project_glossary'] : ['epic_glossary']
  return []
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
