import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { entryPoints, codeBundles } from '@/db/schema/build_route.js'
import { codeEdges, codeNodes } from '@/db/schema/code_graph.js'
import { codeRelations } from '@/db/schema/build_relations.js'
import { documents, docDeps } from '@/db/schema/build_docs.js'
import { PipelineError } from '@/infra/errors.js'
import { loadFreshStaticAnalysisPatternProfile } from '@/pipeline_modules/shared/static_config/index.js'
import type {
  ServiceMapInputIndex,
  EntryPointForServiceMap,
  CodeRelationForServiceMap,
  DocumentForServiceMap,
  RelationFactKind,
  ApiTargetRepoHint,
} from './types.js'

export async function loadInputs(input: {
  db: DB
  repoId?: string
  projectId?: string
}): Promise<ServiceMapInputIndex> {
  const { db } = input

  const scope = resolveScope(input)
  const { repoId, projectId, repoIds } = scope

  if (repoIds.length === 0) {
    return {
      repoId,
      projectId,
      repoIds,
      apiTargetRepoHints: [],
      entryPoints: [],
      codeBundles: [],
      graphNodes: [],
      graphEdges: [],
      codeRelations: [],
      documents: [],
      docDeps: [],
    }
  }

  // entry_points + code_nodes join for filePath and name
  const epRows = db
    .select({
      id: entryPoints.id,
      repoId: entryPoints.repoId,
      framework: entryPoints.framework,
      kind: entryPoints.kind,
      httpMethod: entryPoints.httpMethod,
      path: entryPoints.path,
      fullPath: entryPoints.fullPath,
      handlerNodeId: entryPoints.handlerNodeId,
      metadata: entryPoints.metadata,
      confidence: entryPoints.confidence,
      filePath: codeNodes.filePath,
      name: codeNodes.name,
    })
    .from(entryPoints)
    .leftJoin(codeNodes, eq(entryPoints.handlerNodeId, codeNodes.id))
    .where(inArray(entryPoints.repoId, repoIds))
    .all()

  const entryPointsResult: EntryPointForServiceMap[] = epRows.map((row) => ({
    id: row.id,
    repoId: row.repoId,
    framework: row.framework,
    kind: row.kind as 'api' | 'page' | 'job' | 'event',
    httpMethod: row.httpMethod,
    path: row.path,
    fullPath: row.fullPath,
    handlerNodeId: row.handlerNodeId,
    metadata: row.metadata as Record<string, unknown> | null,
    confidence: row.confidence as 'high' | 'medium' | 'low',
    filePath: row.filePath,
    name: row.name,
  }))

  const bundleRows = db
    .select({
      entryPointId: codeBundles.entryPointId,
      nodeId: codeBundles.nodeId,
      depth: codeBundles.depth,
    })
    .from(codeBundles)
    .innerJoin(entryPoints, eq(codeBundles.entryPointId, entryPoints.id))
    .where(inArray(entryPoints.repoId, repoIds))
    .all()

  const graphNodeRows = db
    .select({
      id: codeNodes.id,
      type: codeNodes.type,
      filePath: codeNodes.filePath,
      name: codeNodes.name,
      lineStart: codeNodes.lineStart,
      lineEnd: codeNodes.lineEnd,
      parentNodeId: codeNodes.parentNodeId,
      originKind: codeNodes.originKind,
      role: codeNodes.role,
    })
    .from(codeNodes)
    .where(inArray(codeNodes.repoId, repoIds))
    .all()

  const graphEdgeRows = db
    .select({
      sourceId: codeEdges.sourceId,
      targetId: codeEdges.targetId,
      relation: codeEdges.relation,
      targetSymbol: codeEdges.targetSymbol,
      targetSpecifier: codeEdges.targetSpecifier,
      chainPath: codeEdges.chainPath,
    })
    .from(codeEdges)
    .where(inArray(codeEdges.repoId, repoIds))
    .all()

  const relationRows = db
    .select()
    .from(codeRelations)
    .where(inArray(codeRelations.repoId, repoIds))
    .all()

  const codeRelationsResult: CodeRelationForServiceMap[] = relationRows.map((row) => ({
    id: row.id,
    repoId: row.repoId,
    sourceNodeId: row.sourceNodeId,
    kind: row.kind as RelationFactKind,
    target: row.target,
    operation: row.operation,
    canonicalTarget: row.canonicalTarget ?? null,
    payload: row.payload as Record<string, unknown>,
    evidenceNodeIds: row.evidenceNodeIds as string[],
    confidence: row.confidence as 'high' | 'medium' | 'low',
    unresolvedReason: row.unresolvedReason,
  }))

  const documentRows = db
    .select({
      id: documents.id,
      projectId: documents.projectId,
      type: documents.type,
      scope: documents.scope,
      scopeId: documents.scopeId,
      status: documents.status,
      content: documents.content,
    })
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .all()

  const documentsResult: DocumentForServiceMap[] = documentRows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    scope: row.scope,
    scopeId: row.scopeId,
    status: row.status,
    content: row.content as Record<string, unknown> | null,
  }))

  const apiTargetRepoHints = loadApiTargetRepoHints(db, repoIds)

  const docDepRows = db
    .select({
      documentId: docDeps.documentId,
      codeNodeId: docDeps.codeNodeId,
      depType: docDeps.depType,
    })
    .from(docDeps)
    .all()

  return {
    repoId,
    projectId,
    repoIds,
    apiTargetRepoHints,
    entryPoints: entryPointsResult,
    codeBundles: bundleRows,
    graphNodes: graphNodeRows,
    graphEdges: graphEdgeRows,
    codeRelations: codeRelationsResult,
    documents: documentsResult,
    docDeps: docDepRows,
  }
}

function loadApiTargetRepoHints(db: DB, repoIds: string[]): ApiTargetRepoHint[] {
  const rows = db.select({
    repositoryId: repositoryPhaseStatus.repositoryId,
    meta: repositoryPhaseStatus.meta,
  })
    .from(repositoryPhaseStatus)
    .where(and(
      inArray(repositoryPhaseStatus.repositoryId, repoIds),
      eq(repositoryPhaseStatus.phase, 'analyze_repo'),
    ))
    .all()

  const knownRepoIds = new Set(repoIds)
  const hints: ApiTargetRepoHint[] = []
  for (const row of rows) {
    const serviceMap = asRecord(row.meta)?.serviceMap
    const rawHints = asRecord(serviceMap)?.apiTargetRepoHints
    if (!Array.isArray(rawHints)) continue
    for (const item of rawHints) {
      const hint = asApiTargetRepoHint(row.repositoryId, item)
      if (!hint) continue
      if (!knownRepoIds.has(hint.targetRepoId)) continue
      hints.push(hint)
    }
  }
  hints.push(...loadStaticConfigRepoAffinityHints(db, repoIds, knownRepoIds))
  return hints
}

function loadStaticConfigRepoAffinityHints(
  db: DB,
  repoIds: string[],
  knownRepoIds: Set<string>,
): ApiTargetRepoHint[] {
  const hints: ApiTargetRepoHint[] = []
  for (const repoId of repoIds) {
    const config = loadFreshStaticAnalysisPatternProfile({ db, repoId })
    if (!config || config.analysisMode === 'deterministic_only') continue
    for (const item of config.serviceMapHints.repoAffinity) {
      const hint = asRepoAffinityHint(repoId, item)
      if (!hint || !knownRepoIds.has(hint.targetRepoId)) continue
      hints.push(hint)
    }
  }
  return hints
}

function asRepoAffinityHint(sourceRepoId: string, raw: unknown): ApiTargetRepoHint | null {
  const item = asRecord(raw)
  if (!item) return null
  const sourcePattern = typeof item.sourcePattern === 'string' ? item.sourcePattern.trim() : ''
  const targetRepoId = typeof item.targetRepoId === 'string' ? item.targetRepoId.trim() : ''
  const match = sourcePattern.match(/^([A-Z]+)\s+(\/.*)$/)
  if (!match || !targetRepoId) return null
  return {
    sourceRepoId,
    method: match[1]!,
    path: match[2]!,
    targetRepoId,
  }
}

function asApiTargetRepoHint(sourceRepoId: string, raw: unknown): ApiTargetRepoHint | null {
  const item = asRecord(raw)
  if (!item) return null
  const method = typeof item.method === 'string' ? item.method.trim().toUpperCase() : ''
  const path = typeof item.path === 'string' ? item.path.trim() : ''
  const targetRepoId = typeof item.targetRepoId === 'string' ? item.targetRepoId.trim() : ''
  if (!method || !path || !targetRepoId) return null
  return { sourceRepoId, method, path, targetRepoId }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function resolveScope(scopeInput: { db: DB; repoId?: string; projectId?: string }): {
  repoId: string | null
  projectId: string
  repoIds: string[]
} {
  const { db } = scopeInput

  if (scopeInput.repoId) {
    const repo = db.select().from(repositories)
      .where(and(eq(repositories.id, scopeInput.repoId), isNull(repositories.deletedAt)))
      .get()
    if (!repo) throw new PipelineError(`Repository not found: ${scopeInput.repoId}`, 'NOT_FOUND')
    if (scopeInput.projectId && scopeInput.projectId !== repo.projectId) {
      throw new PipelineError(
        `Repository ${scopeInput.repoId} does not belong to project ${scopeInput.projectId}`,
        'VALIDATION_FAILED',
      )
    }
    return {
      repoId: scopeInput.repoId,
      projectId: repo.projectId,
      repoIds: [scopeInput.repoId],
    }
  }

  if (!scopeInput.projectId) {
    throw new PipelineError('projectId or repoId is required for build_service_map', 'VALIDATION_FAILED')
  }

  const project = db.select().from(projects).where(eq(projects.id, scopeInput.projectId)).get()
  if (!project) throw new PipelineError(`Project not found: ${scopeInput.projectId}`, 'NOT_FOUND')
  const rows = db.select({ id: repositories.id })
    .from(repositories)
    .where(and(eq(repositories.projectId, scopeInput.projectId), isNull(repositories.deletedAt)))
    .all()
  return {
    repoId: null,
    projectId: scopeInput.projectId,
    repoIds: rows.map((row) => row.id),
  }
}
