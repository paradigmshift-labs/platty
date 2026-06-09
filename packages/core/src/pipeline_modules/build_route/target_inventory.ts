import { and, asc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import { codeBundles, entryPoints } from '@/db/schema/build_route.js'
import { repositories } from '@/db/schema/core.js'
import type { EntryPointKind } from '@/db/schema/enums.js'
import type { AnalysisReviewDecisionRow, AnalysisReviewTargetType } from '@/db/schema/project_analysis_v2.js'
import { listAnalysisReviewDecisions } from './review_decisions.js'

export type DocsTargetKind = 'api' | 'screen' | 'job' | 'event'

export interface ListDocsTargetsInput {
  projectId: string
  kind?: DocsTargetKind
  repo?: string
  method?: string
  search?: string
  limit?: number
  offset?: number
}

export interface DocsTargetRow {
  id: string
  repoId: string
  repoName: string
  kind: DocsTargetKind
  targetType: AnalysisReviewTargetType
  method: string | null
  path: string | null
  fullPath: string | null
  handlerName: string | null
  handlerFilePath: string | null
  confidence: string
  detectionSource: string
  bundleNodeCount: number
  reviewDecision: AnalysisReviewDecisionRow | null
}

export interface ListDocsTargetsResult {
  summary: {
    total: number
    api: number
    screen: number
    job: number
    event: number
    deprecated: number
  }
  pagination: {
    limit: number
    offset: number
    returned: number
  }
  targets: DocsTargetRow[]
}

export type DocsTargetInventoryError =
  | { code: 'REPOSITORY_NOT_FOUND'; message: string }
  | { code: 'REPOSITORY_AMBIGUOUS'; message: string }
export type DocsTargetSelector = { id: string } | { kind: DocsTargetKind; path: string; method?: string; repo?: string }
export type ResolveDocsTargetError =
  | { code: 'TARGET_SELECTOR_INCOMPLETE'; message: string }
  | { code: 'TARGET_NOT_FOUND'; message: string }
  | { code: 'REPOSITORY_NOT_FOUND'; message: string }
  | { code: 'REPOSITORY_AMBIGUOUS'; message: string }
  | { code: 'TARGET_SELECTOR_AMBIGUOUS'; message: string; candidates: DocsTargetRow[] }

type EntryPointTargetRow = {
  id: string
  repoId: string
  repoName: string
  kind: EntryPointKind
  method: string | null
  path: string | null
  fullPath: string | null
  handlerName: string | null
  handlerFilePath: string | null
  confidence: string
  detectionSource: string
}

export function normalizeDocsTargetKind(value: string | undefined): DocsTargetKind | null {
  if (value === 'api' || value === 'screen' || value === 'job' || value === 'event') return value
  return null
}

export function entryPointKindForDocsTarget(kind: DocsTargetKind): EntryPointKind {
  return kind === 'screen' ? 'page' : kind
}

export function docsTargetKindForEntryPoint(kind: EntryPointKind): DocsTargetKind {
  return kind === 'page' ? 'screen' : kind
}

export function listDocsTargets(db: DB, input: ListDocsTargetsInput): ListDocsTargetsResult | DocsTargetInventoryError {
  const repo = input.repo ? resolveRepository(db, input.projectId, input.repo) : null
  if (repo && 'code' in repo) {
    return repo
  }

  const allRows = listTargetRows(db, {
    projectId: input.projectId,
    kind: input.kind,
    repoId: repo?.id,
    method: input.method,
    search: input.search,
  })
  const decisionByTargetId = new Map(
    listAnalysisReviewDecisions(db, { projectId: input.projectId }).map((decision) => [decision.targetId, decision]),
  )
  const limit = normalizeLimit(input.limit)
  const offset = normalizeOffset(input.offset)
  const returnedRows = allRows.slice(offset, offset + limit)
  const bundleCounts = countBundlesByEntryPoint(db, returnedRows.map((row) => row.id))
  const targets = returnedRows.map((row) => toDocsTargetRow(row, bundleCounts, decisionByTargetId))

  return {
    summary: summarizeTargets(allRows, decisionByTargetId),
    pagination: {
      limit,
      offset,
      returned: targets.length,
    },
    targets,
  }
}

export function resolveDocsTargetSelectors(
  db: DB,
  input: { projectId: string; selectors: DocsTargetSelector[] },
): { targets: DocsTargetRow[] } | ResolveDocsTargetError {
  const resolved = new Map<string, DocsTargetRow>()

  for (const selector of input.selectors) {
    const result = 'id' in selector
      ? resolveTargetById(db, input.projectId, selector.id)
      : resolveTargetByPath(db, input.projectId, selector)
    if ('code' in result) return result
    resolved.set(result.target.id, result.target)
  }

  return { targets: [...resolved.values()] }
}

function resolveRepository(db: DB, projectId: string, selector: string): { id: string; name: string } | DocsTargetInventoryError {
  const matches = db
    .select({ id: repositories.id, name: repositories.name })
    .from(repositories)
    .where(and(
      eq(repositories.projectId, projectId),
      isNull(repositories.deletedAt),
      or(eq(repositories.id, selector), eq(repositories.name, selector))!,
    ))
    .all()
  const idMatch = matches.find((repo) => repo.id === selector)
  if (idMatch) return idMatch

  const nameMatches = matches.filter((repo) => repo.name === selector)
  if (nameMatches.length > 1) {
    return { code: 'REPOSITORY_AMBIGUOUS', message: `Repository selector matched multiple repositories: ${selector}` }
  }
  if (nameMatches.length === 1) return nameMatches[0]!
  return { code: 'REPOSITORY_NOT_FOUND', message: `Repository was not found in project: ${selector}` }
}

function listTargetRows(
  db: DB,
  input: { projectId: string; kind?: DocsTargetKind; repoId?: string; method?: string; search?: string },
): EntryPointTargetRow[] {
  const repoRows = db
    .select({ id: repositories.id })
    .from(repositories)
    .where(and(eq(repositories.projectId, input.projectId), isNull(repositories.deletedAt)))
    .all()
  const repoIds = repoRows.map((repo) => repo.id)
  if (repoIds.length === 0) return []

  const filters = [inArray(entryPoints.repoId, input.repoId ? [input.repoId] : repoIds)]
  if (input.kind) filters.push(eq(entryPoints.kind, entryPointKindForDocsTarget(input.kind)))
  if (input.method) filters.push(eq(entryPoints.httpMethod, input.method.toUpperCase()))
  if (input.search?.trim()) {
    const term = `%${input.search.trim()}%`
    filters.push(or(
      like(entryPoints.fullPath, term),
      like(entryPoints.path, term),
      like(codeNodes.name, term),
      like(codeNodes.filePath, term),
    )!)
  }

  return db
    .select({
      id: entryPoints.id,
      repoId: entryPoints.repoId,
      repoName: repositories.name,
      kind: entryPoints.kind,
      method: entryPoints.httpMethod,
      path: entryPoints.path,
      fullPath: entryPoints.fullPath,
      handlerName: codeNodes.name,
      handlerFilePath: codeNodes.filePath,
      confidence: entryPoints.confidence,
      detectionSource: entryPoints.detectionSource,
    })
    .from(entryPoints)
    .innerJoin(repositories, eq(repositories.id, entryPoints.repoId))
    .leftJoin(codeNodes, eq(codeNodes.id, entryPoints.handlerNodeId))
    .where(and(...filters))
    .orderBy(asc(entryPoints.kind), asc(entryPoints.fullPath), asc(entryPoints.httpMethod))
    .all()
}

function resolveTargetById(
  db: DB,
  projectId: string,
  id: string,
): { target: DocsTargetRow } | ResolveDocsTargetError {
  const decisionByTargetId = new Map(
    listAnalysisReviewDecisions(db, { projectId }).map((decision) => [decision.targetId, decision]),
  )
  const row = listTargetRows(db, { projectId }).find((target) => target.id === id)
  if (!row) {
    return { code: 'TARGET_NOT_FOUND', message: `Target was not found: ${id}` }
  }
  return { target: toDocsTargetRow(row, countBundlesByEntryPoint(db, [row.id]), decisionByTargetId) }
}

function resolveTargetByPath(
  db: DB,
  projectId: string,
  selector: Extract<DocsTargetSelector, { kind: DocsTargetKind }>,
): { target: DocsTargetRow } | ResolveDocsTargetError {
  if (!selector.kind || !selector.path) {
    return { code: 'TARGET_SELECTOR_INCOMPLETE', message: 'Target selector requires kind and path.' }
  }

  const listed = listDocsTargets(db, {
    projectId,
    kind: selector.kind,
    repo: selector.repo,
    method: selector.method,
    search: selector.path,
    limit: Number.MAX_SAFE_INTEGER,
    offset: 0,
  })
  if ('code' in listed) return listed

  const exact = listed.targets.filter((target) => target.path === selector.path || target.fullPath === selector.path)
  if (exact.length === 0) {
    return { code: 'TARGET_NOT_FOUND', message: `Target was not found: ${selector.path}` }
  }
  if (exact.length > 1) {
    return {
      code: 'TARGET_SELECTOR_AMBIGUOUS',
      message: `Target selector matched multiple targets: ${selector.path}`,
      candidates: exact,
    }
  }
  return { target: exact[0]! }
}

function toDocsTargetRow(
  row: EntryPointTargetRow,
  bundleCounts: Map<string, number>,
  decisionByTargetId: Map<string, AnalysisReviewDecisionRow>,
): DocsTargetRow {
  const kind = docsTargetKindForEntryPoint(row.kind)
  return {
    id: row.id,
    repoId: row.repoId,
    repoName: row.repoName,
    kind,
    targetType: targetTypeForDocsKind(kind),
    method: row.method,
    path: row.path,
    fullPath: row.fullPath,
    handlerName: row.handlerName,
    handlerFilePath: row.handlerFilePath,
    confidence: row.confidence,
    detectionSource: row.detectionSource,
    bundleNodeCount: bundleCounts.get(row.id) ?? 0,
    reviewDecision: decisionByTargetId.get(row.id) ?? null,
  }
}

function targetTypeForDocsKind(kind: DocsTargetKind): AnalysisReviewTargetType {
  if (kind === 'api') return 'route'
  if (kind === 'screen') return 'screen'
  return kind
}

function summarizeTargets(
  rows: EntryPointTargetRow[],
  decisionByTargetId: Map<string, AnalysisReviewDecisionRow>,
): ListDocsTargetsResult['summary'] {
  const docsKinds = rows.map((row) => docsTargetKindForEntryPoint(row.kind))
  return {
    total: rows.length,
    api: docsKinds.filter((kind) => kind === 'api').length,
    screen: docsKinds.filter((kind) => kind === 'screen').length,
    job: docsKinds.filter((kind) => kind === 'job').length,
    event: docsKinds.filter((kind) => kind === 'event').length,
    deprecated: rows.filter((row) => decisionByTargetId.get(row.id)?.decision === 'deprecated').length,
  }
}

function countBundlesByEntryPoint(db: DB, entryPointIds: string[]): Map<string, number> {
  if (entryPointIds.length === 0) return new Map()
  return new Map(
    db
      .select({
        entryPointId: codeBundles.entryPointId,
        count: sql<number>`count(*)`,
      })
      .from(codeBundles)
      .where(inArray(codeBundles.entryPointId, entryPointIds))
      .groupBy(codeBundles.entryPointId)
      .all()
      .map((row) => [row.entryPointId, Number(row.count)]),
  )
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return 200
  return Math.max(1, Math.min(500, Math.trunc(value)))
}

function normalizeOffset(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return 0
  return Math.max(0, Math.trunc(value))
}
