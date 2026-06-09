// F1: loadInputs — DB에서 노드/엣지/모델 로드
// SOT: specs/build_relations/architecture.md §4 F1

import { eq } from 'drizzle-orm'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { models } from '@/db/schema/build_models.js'
import { entryPoints } from '@/db/schema/build_route.js'
import { repositories } from '@/db/schema/core.js'
import { PipelineError } from '@/infra/errors.js'
import type { RunBuildRelationsInput, BuildRelationsInputs, ModelLookup } from './types.js'
import { loadFreshStaticAnalysisPatternProfile } from '@/pipeline_modules/shared/static_config/index.js'
import { getRepositoryPaths } from '@/repo/repository-paths.js'

// test path 패턴 (isTest=true 또는 파일 경로 패턴)
const TEST_PATH_RE = /\.(test|spec|e2e-spec)\.[cm]?[jt]sx?$|_test\.dart$/

export async function loadInputs(input: RunBuildRelationsInput): Promise<BuildRelationsInputs> {
  const { db, repoId, includeTestSources = false } = input

  const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
  if (!repo) throw new PipelineError(`Repository not found: ${repoId}`, 'NOT_FOUND')

  const allNodes = db.select({
    id: codeNodes.id,
    repoId: codeNodes.repoId,
    type: codeNodes.type,
    name: codeNodes.name,
    filePath: codeNodes.filePath,
    lineStart: codeNodes.lineStart,
    lineEnd: codeNodes.lineEnd,
    isTest: codeNodes.isTest,
    parseStatus: codeNodes.parseStatus,
  }).from(codeNodes).where(eq(codeNodes.repoId, repoId)).all()

  const nodes = includeTestSources
    ? allNodes.filter((n) => n.parseStatus === 'ok')
    : allNodes.filter((n) => n.parseStatus === 'ok' && !n.isTest && !TEST_PATH_RE.test(n.filePath))

  const allEdges = db.select({
    id: codeEdges.id,
    repoId: codeEdges.repoId,
    sourceId: codeEdges.sourceId,
    targetId: codeEdges.targetId,
    relation: codeEdges.relation,
    targetSpecifier: codeEdges.targetSpecifier,
    targetSymbol: codeEdges.targetSymbol,
    typeRefSubtype: codeEdges.typeRefSubtype,
    chainPath: codeEdges.chainPath,
    firstArg: codeEdges.firstArg,
    literalArgs: codeEdges.literalArgs,
    argExpressions: codeEdges.argExpressions,
    resolveStatus: codeEdges.resolveStatus,
    confidence: codeEdges.confidence,
    source: codeEdges.source,
  }).from(codeEdges).where(eq(codeEdges.repoId, repoId)).all()

  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = allEdges.filter((e) => nodeIds.has(e.sourceId))

  const rawModels = db.select().from(models).where(eq(models.repositoryId, repoId)).all()
  const modelLookup: ModelLookup[] = rawModels.map((m) => ({
    modelName: m.name,
    tableName: m.tableName,
    orm: m.orm ?? 'unknown',
  }))

  const rawEntryPoints = db.select().from(entryPoints).where(eq(entryPoints.repoId, repoId)).all() ?? []
  const repoPath = typeof repo.repoPath === 'string'
    ? getRepositoryPaths(repo).analysisRoot
    : null

  return {
    repoId,
    repoPath,
    includeTestSources,
    nodes,
    edges,
    models: modelLookup,
    staticAnalysisPatternProfile: loadFreshStaticAnalysisPatternProfile({ db, repoId }),
    entryPoints: rawEntryPoints.map((entry) => ({
      id: entry.id,
      repoId: entry.repoId,
      nodeId: entry.handlerNodeId,
      kind: entry.kind,
      routePath: entry.fullPath ?? entry.path,
    })),
  }
}
