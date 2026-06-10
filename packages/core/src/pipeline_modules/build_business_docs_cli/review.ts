import { and, eq, inArray } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import {
  documentItemDocumentLinks,
  documentItems,
  documentProposals,
  documents,
  type Document,
  type DocumentItem,
  type DocumentItemDocumentLink,
} from '@/db/schema/build_docs.js'
import {
  businessDocGenerationRuns,
  businessDocGenerationTasks,
  type BusinessDocGenerationRun,
  type BusinessDocGenerationTask,
} from '@/db/schema/build_business_docs_generation.js'
import type {
  BusinessDocsDocumentShowResult,
  BusinessDocsDocumentShowServiceResult,
  BusinessDocsGenerationTaskStatus,
  BusinessDocsLifecycleNextAction,
  BusinessDocsLifecycleRunSummary,
  BusinessDocsReviewResult,
  BusinessDocsReviewServiceResult,
  BusinessDocsStoredDocumentType,
  BusinessDocsTaskStatusCounts,
  BusinessDocsValidateResult,
  BusinessDocsValidateServiceResult,
  BusinessDocsValidationIssue,
} from './types.js'

const TASK_STATUSES = [
  'pending',
  'leased',
  'expired',
  'submitted',
  'saved',
  'proposal_created',
  'repair_requested',
  'blocked',
  'failed',
  'skipped',
] as const satisfies BusinessDocsGenerationTaskStatus[]

const REQUIRED_EPIC_DOC_TYPES = ['design', 'data_dictionary', 'br', 'ucl', 'glossary'] as const satisfies BusinessDocsStoredDocumentType[]

type RuntimeReadDb = Pick<DB, 'select'>

interface RunContext {
  run: BusinessDocGenerationRun
  tasks: BusinessDocGenerationTask[]
}

export function validateBusinessDocsRun(
  db: DB,
  input: { projectId: string; runId: string },
): BusinessDocsValidateServiceResult {
  const context = loadRunContext(db, input)
  if (!context) return runNotFound()
  const activeDocuments = loadRunActiveDocuments(db, context.run)
  const activeItems = loadActiveItems(db, activeDocuments)
  const sourceLinks = loadSourceLinks(db, activeItems)
  const proposals = db.select().from(documentProposals)
    .where(and(
      eq(documentProposals.projectId, input.projectId),
      eq(documentProposals.sourceRunId, input.runId),
      eq(documentProposals.status, 'pending'),
    ))
    .all()
  const issues = collectValidationIssues({
    tasks: context.tasks,
    documents: activeDocuments,
    items: activeItems,
    sourceLinks,
    proposalCount: proposals.length,
  })
  return {
    ok: true,
    data: {
      run: summarizeRun(context.run),
      fatal: issues.filter((issue) => issue.severity === 'fatal'),
      warnings: issues.filter((issue) => issue.severity === 'warning'),
      summary: {
        fatalCount: issues.filter((issue) => issue.severity === 'fatal').length,
        warningCount: issues.filter((issue) => issue.severity === 'warning').length,
      },
    } satisfies BusinessDocsValidateResult,
  }
}

export function reviewBusinessDocsRun(
  db: DB,
  input: { projectId: string; runId: string },
): BusinessDocsReviewServiceResult {
  const context = loadRunContext(db, input)
  if (!context) return runNotFound()
  const activeDocuments = loadRunActiveDocuments(db, context.run)
  const activeItems = loadActiveItems(db, activeDocuments)
  const sourceLinks = loadSourceLinks(db, activeItems)
  const proposals = db.select().from(documentProposals)
    .where(and(
      eq(documentProposals.projectId, input.projectId),
      eq(documentProposals.sourceRunId, input.runId),
      eq(documentProposals.status, 'pending'),
    ))
    .all()
  const counts = countTaskStatuses(context.tasks)
  const coverage = summarizeCoverage(context.run.selectedEpicIdsJson, activeDocuments)
  const issues = collectValidationIssues({
    tasks: context.tasks,
    documents: activeDocuments,
    items: activeItems,
    sourceLinks,
    proposalCount: proposals.length,
  })

  return {
    ok: true,
    data: {
      run: summarizeRun(context.run),
      tasks: { counts },
      documents: {
        saved: counts.saved,
        proposals: counts.proposal_created,
        failed: counts.failed,
        activeDocumentCount: activeDocuments.length,
        proposalCount: proposals.length,
        byType: countBy(activeDocuments.map((document) => document.type)),
      },
      items: {
        total: activeItems.length,
        linkedToSource: countLinkedItems(activeItems, sourceLinks),
        unlinked: activeItems.length - countLinkedItems(activeItems, sourceLinks),
        byType: countBy(activeItems.map((item) => item.itemType)),
      },
      coverage,
      validation: {
        fatalCount: issues.filter((issue) => issue.severity === 'fatal').length,
        warningCount: issues.filter((issue) => issue.severity === 'warning').length,
        issuesByCode: countBy(issues.map((issue) => issue.code)),
      },
      nextAction: nextActionFor(context.run, counts),
    } satisfies BusinessDocsReviewResult,
  }
}

export function showBusinessDoc(
  db: DB,
  input: { projectId: string; documentId: string },
): BusinessDocsDocumentShowServiceResult {
  const document = db.select().from(documents)
    .where(and(
      eq(documents.projectId, input.projectId),
      eq(documents.id, input.documentId),
      eq(documents.track, 'business'),
    ))
    .get()
  if (!document) {
    return {
      ok: false,
      code: 'BUSINESS_DOCS_DOCUMENT_NOT_FOUND',
      message: 'Business docs document was not found for the selected project.',
    }
  }

  const items = db.select().from(documentItems)
    .where(and(
      eq(documentItems.projectId, input.projectId),
      eq(documentItems.documentId, input.documentId),
      eq(documentItems.status, 'active'),
    ))
    .all()
  const links = loadSourceLinks(db, items)
  const allItemDocumentLinks = loadItemDocumentLinks(db, items)
  return {
    ok: true,
    data: {
      document: {
        id: document.id,
        type: document.type,
        scope: document.scope,
        scopeId: document.scopeId,
        status: document.status,
        validity: document.validity,
        summary: document.summary,
        content: document.content,
        contentHash: document.contentHash,
        staticSnapshotId: document.staticSnapshotId,
        documentSourceHash: document.documentSourceHash,
        sourceRunId: document.sourceRunId,
      },
      freshness: freshnessForDocument(document),
      items: items.map((item) => ({
        id: item.id,
        itemType: item.itemType,
        stableKey: item.stableKey,
        title: item.title,
        summary: item.summary,
        content: item.content,
        status: item.status,
        sourceDocumentLinks: (links.get(item.id) ?? []).map((link) => ({
          documentId: link.toDocumentId,
          linkType: link.linkType,
          role: link.role ?? null,
        })),
        targetDocumentLinks: (allItemDocumentLinks.get(item.id) ?? [])
          .filter((link) => link.linkType !== 'source_document')
          .map((link) => ({
            documentId: link.toDocumentId,
            linkType: link.linkType,
            role: link.role ?? null,
          })),
        relatedItems: [],
        modelLinks: [],
      })),
    } satisfies BusinessDocsDocumentShowResult,
  }
}

function freshnessForDocument(document: Document): BusinessDocsDocumentShowResult['freshness'] {
  if (document.status === 'deleted' || document.validity === 'orphaned') {
    return { state: 'orphaned', reason: 'orphaned' }
  }
  if (document.validity === 'stale') {
    return { state: 'stale', reason: 'source_changed' }
  }
  return { state: 'fresh', reason: null }
}

function loadRunContext(
  db: RuntimeReadDb,
  input: { projectId: string; runId: string },
): RunContext | null {
  const run = db.select().from(businessDocGenerationRuns)
    .where(and(
      eq(businessDocGenerationRuns.id, input.runId),
      eq(businessDocGenerationRuns.projectId, input.projectId),
    ))
    .get()
  if (!run) return null
  const tasks = db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.runId, input.runId))
    .all()
  return { run, tasks }
}

function loadRunActiveDocuments(db: RuntimeReadDb, run: BusinessDocGenerationRun): Document[] {
  return db.select().from(documents)
    .where(and(
      eq(documents.projectId, run.projectId),
      eq(documents.track, 'business'),
      eq(documents.status, 'active'),
      eq(documents.sourceRunId, run.id),
    ))
    .all()
}

function loadActiveItems(db: RuntimeReadDb, activeDocuments: Document[]): DocumentItem[] {
  const documentIds = activeDocuments.map((document) => document.id)
  if (documentIds.length === 0) return []
  return db.select().from(documentItems)
    .where(and(
      inArray(documentItems.documentId, documentIds),
      eq(documentItems.status, 'active'),
    ))
    .all()
}

function loadSourceLinks(
  db: RuntimeReadDb,
  items: DocumentItem[],
): Map<string, DocumentItemDocumentLink[]> {
  const itemIds = items.map((item) => item.id)
  if (itemIds.length === 0) return new Map()
  const links = db.select().from(documentItemDocumentLinks)
    .where(and(
      inArray(documentItemDocumentLinks.fromItemId, itemIds),
      eq(documentItemDocumentLinks.linkType, 'source_document'),
    ))
    .all()
  const byItem = new Map<string, DocumentItemDocumentLink[]>()
  for (const link of links) {
    const existing = byItem.get(link.fromItemId) ?? []
    existing.push(link)
    byItem.set(link.fromItemId, existing)
  }
  return byItem
}

function loadItemDocumentLinks(
  db: RuntimeReadDb,
  items: DocumentItem[],
): Map<string, DocumentItemDocumentLink[]> {
  const itemIds = items.map((item) => item.id)
  if (itemIds.length === 0) return new Map()
  const links = db.select().from(documentItemDocumentLinks)
    .where(inArray(documentItemDocumentLinks.fromItemId, itemIds))
    .all()
  const byItem = new Map<string, DocumentItemDocumentLink[]>()
  for (const link of links) {
    const existing = byItem.get(link.fromItemId) ?? []
    existing.push(link)
    byItem.set(link.fromItemId, existing)
  }
  return byItem
}

function collectValidationIssues(input: {
  tasks: BusinessDocGenerationTask[]
  documents: Document[]
  items: DocumentItem[]
  sourceLinks: Map<string, DocumentItemDocumentLink[]>
  proposalCount: number
}): BusinessDocsValidationIssue[] {
  const issues: BusinessDocsValidationIssue[] = []
  for (const task of input.tasks) {
    if (task.status === 'failed') {
      issues.push({
        severity: 'fatal',
        code: 'TASK_FAILED',
        message: `Business docs task failed: ${task.taskType}`,
        taskId: task.id,
      })
    }
    for (const validationError of task.validationErrors ?? []) {
      issues.push({
        severity: task.status === 'failed' ? 'fatal' : 'warning',
        code: typeof validationError.code === 'string' ? validationError.code : 'TASK_VALIDATION_ERROR',
        message: typeof validationError.message === 'string'
          ? validationError.message
          : `Task has validation errors: ${task.taskType}`,
        taskId: task.id,
      })
    }
  }

  const itemCountsByDocument = countItemsByDocument(input.items)
  for (const document of input.documents) {
    if ((itemCountsByDocument.get(document.id) ?? 0) === 0) {
      issues.push({
        severity: 'warning',
        code: 'DOCUMENT_WITHOUT_ACTIVE_ITEMS',
        message: `Business document has no active searchable items: ${document.type}`,
        documentId: document.id,
      })
    }
  }
  for (const item of input.items) {
    if ((input.sourceLinks.get(item.id) ?? []).length === 0) {
      issues.push({
        severity: 'warning',
        code: 'ITEM_WITHOUT_SOURCE_LINK',
        message: `Business document item is not linked to a lower source document: ${item.stableKey}`,
        documentId: item.documentId,
      })
    }
  }
  if (input.proposalCount > 0) {
    issues.push({
      severity: 'warning',
      code: 'PENDING_DOCUMENT_PROPOSALS',
      message: `Run produced ${input.proposalCount} pending business document proposals.`,
    })
  }
  return issues
}

function summarizeCoverage(epicIds: string[], activeDocuments: Document[]): BusinessDocsReviewResult['coverage'] {
  const missingByEpic: BusinessDocsReviewResult['coverage']['missingByEpic'] = []
  for (const epicId of epicIds) {
    const documentTypes = new Set(activeDocuments
      .filter((document) => document.scope === 'epic' && document.scopeId === epicId)
      .map((document) => document.type))
    const missingDocumentTypes = REQUIRED_EPIC_DOC_TYPES
      .filter((type) => !documentTypes.has(type))
    if (missingDocumentTypes.length > 0) missingByEpic.push({ epicId, missingDocumentTypes })
  }
  return {
    requiredEpicCount: epicIds.length,
    epicsWithRequiredDocs: epicIds.length - missingByEpic.length,
    missingByEpic,
  }
}

function countTaskStatuses(tasks: BusinessDocGenerationTask[]): BusinessDocsTaskStatusCounts {
  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as BusinessDocsTaskStatusCounts
  counts.total = tasks.length
  for (const task of tasks) {
    counts[task.status] += 1
  }
  return counts
}

function nextActionFor(
  run: BusinessDocGenerationRun,
  counts: BusinessDocsTaskStatusCounts,
): BusinessDocsLifecycleNextAction {
  if (run.status === 'completed') return { type: 'done' }
  if (run.status === 'cancelled') return { type: 'cancelled' }
  if (counts.repair_requested > 0) return { type: 'repair_task' }
  if (counts.failed > 0) return { type: 'retry_failed' }
  if (counts.pending > 0 || counts.expired > 0) return { type: 'lease_tasks' }
  return { type: 'done' }
}

function summarizeRun(run: BusinessDocGenerationRun): BusinessDocsLifecycleRunSummary {
  return {
    id: run.id,
    projectId: run.projectId,
    status: run.status,
    sourceCommit: run.sourceCommit,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
  }
}

function countLinkedItems(
  items: DocumentItem[],
  sourceLinks: Map<string, DocumentItemDocumentLink[]>,
): number {
  return items.filter((item) => (sourceLinks.get(item.id) ?? []).length > 0).length
}

function countItemsByDocument(items: DocumentItem[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    counts.set(item.documentId, (counts.get(item.documentId) ?? 0) + 1)
  }
  return counts
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function runNotFound(): { ok: false; code: 'BUSINESS_DOCS_RUN_NOT_FOUND'; message: string } {
  return {
    ok: false,
    code: 'BUSINESS_DOCS_RUN_NOT_FOUND',
    message: 'Business docs generation run was not found for the selected project.',
  }
}
