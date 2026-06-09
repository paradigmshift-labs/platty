/**
 * runBuildGraph — build_graph 모듈 orchestrator (V2)
 * SOT: specs/build_graph/architecture.md §4.1
 *
 * M2 analyze_repo와 동일한 fire-and-forget 패턴:
 *   { runId, completion } 동기 반환 — server route는 runId 즉시 응답.
 *
 * 게이트:
 *   - REPO_NOT_FOUND: repository 없음 또는 soft-deleted
 *   - NOT_ANALYZED (Q2): repository_phase_status.phase='analyze_repo'.confirmedAt IS NULL
 *   - BUILD_IN_FLIGHT (Q1): 같은 repo의 build_graph가 이미 status='running'
 *
 * 흐름 (7 steps):
 *   F1 collectSourceFiles
 *   F2 extractAst
 *   F3a resolveImportEdges
 *   F4 resolveTypeRefs
 *   F5 resolveCalls
 *   F6 persistGraph (DELETE → INSERT 멱등, PRAGMA OFF 우회)
 *   F7 validateGraph + phase_status UPSERT by pipeline_infra
 */
import { eq, and } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { DB } from '@/db/client.js'
import { fileCache } from '@/db/schema/code_graph.js'
import { repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { pipelineRuns } from '@/db/schema/pipeline_runs.js'
import { PipelineExecution, type PipelineFailure, type PipelineStepContext } from '@/pipeline_infra/index.js'
import type { TriggeredBy } from '@/db/schema/enums.js'
import { aliveById } from '@/db/helpers/soft-delete.js'
import { collectSourceFiles } from './f1_collect_source_files.js'
import { extractAst } from './f2_extract_ast.js'
import { resolveImportEdges } from './f3a_resolve_import_edges.js'
import { resolveTypeRefs } from './f4_resolve_type_refs.js'
import { resolveCalls } from './f5_resolve_calls.js'
import { persistGraph } from './f6_persist_graph.js'
import { validateGraph } from './f7_validate_graph.js'
import { TypeScriptParserAdapter } from './adapters/typescript.js'
import { DartParserAdapter } from './adapters/dart.js'
import { JvmAstParserAdapter } from './adapters/jvm_ast.js'
import { getHeadCommit } from './git_helpers.js'
import type { BuildGraphResult, ParserAdapter, SourceFile } from './types.js'
import { BuildGraphError } from './types.js'
import { getRepositoryPaths } from '@/repo/repository-paths.js'

export interface BuildGraphOptions {
  repoId: string
  triggeredBy?: TriggeredBy
  parentRunId?: string
  /** Q3 — 시그니처만 유지, 본문 미사용 (abort UI 도입 시 보강) */
  signal?: AbortSignal
}

export interface BuildGraphStartResult {
  runId: string
  completion: Promise<BuildGraphResult>
}

export { BuildGraphError }
export type { BuildGraphResult } from './types.js'

/**
 * dart 패키지 이름 (path 매핑용) — pubspec.yaml에서 'name:' 추출.
 * 실패해도 undefined 반환 (그래프는 진행).
 */
function readDartPackageName(repoPath: string): string | undefined {
  try {
    const pubspec = fs.readFileSync(path.join(repoPath, 'pubspec.yaml'), 'utf-8')
    const m = pubspec.match(/^name:\s*(\S+)/m)
    return m?.[1]
  } catch {
    return undefined
  }
}

function persistFileHashes(repoId: string, files: SourceFile[], db: DB): void {
  const now = new Date().toISOString()
  for (const file of files) {
    const fileHash = createHash('sha256').update(file.content, 'utf8').digest('hex')
    db.insert(fileCache)
      .values({
        repoId,
        filePath: file.path,
        fileHash,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [fileCache.repoId, fileCache.filePath],
        set: { fileHash, updatedAt: now },
      })
      .run()
  }
}

export function runBuildGraph(opts: BuildGraphOptions, db: DB): BuildGraphStartResult {
  // 1. repository 조회
  const repo = db
    .select()
    .from(repositories)
    .where(aliveById(repositories.id, repositories.deletedAt, opts.repoId))
    .get()
  if (!repo) {
    throw new BuildGraphError(`Repository not found: ${opts.repoId}`, 'REPO_NOT_FOUND')
  }

  // 2. Q2 — analyze_repo 완료 + confirm 게이트
  const analyzeStatus = db
    .select()
    .from(repositoryPhaseStatus)
    .where(
      and(
        eq(repositoryPhaseStatus.repositoryId, repo.id),
        eq(repositoryPhaseStatus.phase, 'analyze_repo'),
      ),
    )
    .get()
  if (!analyzeStatus?.confirmedAt) {
    throw new BuildGraphError(
      `analyze_repo not confirmed for repo ${repo.id}`,
      'NOT_ANALYZED',
    )
  }

  // 3. Q1 — in-flight 체크
  const inFlight = db
    .select()
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.repoId, repo.id),
        eq(pipelineRuns.kind, 'build_graph'),
        eq(pipelineRuns.status, 'running'),
      ),
    )
    .get()
  if (inFlight) {
    throw new BuildGraphError(
      `build_graph already running (runId=${inFlight.id})`,
      'BUILD_IN_FLIGHT',
    )
  }

  const paths = getRepositoryPaths(repo)
  const headCommit = getHeadCommit(paths.worktreeRoot)
  const pipeline = new PipelineExecution({ db })

  const started = pipeline.startStage(
    {
      projectId: repo.projectId,
      repoId: repo.id,
      kind: 'build_graph',
      totalSteps: 7,
      triggeredBy: opts.triggeredBy,
      sourceCommit: headCommit,
      parentRunId: opts.parentRunId,
      signal: opts.signal,
    },
    async (ctx): Promise<BuildGraphResult> => {
      const analysisPath = paths.analysisRoot
      // F1: 파일 수집
      const files = await ctx.step(
        { step: 'F1:collect', label: '소스 파일 수집' },
        () => collectSourceFiles(repo.id, analysisPath, repo.framework ?? 'unknown', repo.language ?? 'typescript'),
      )
      persistFileHashes(repo.id, files, db)

      // 어댑터 선택 (language 기반)
      const adapter: ParserAdapter =
        repo.language === 'dart'
          ? await DartParserAdapter.create()
          : (repo.language === 'java' || repo.language === 'kotlin')
            ? await JvmAstParserAdapter.create()
            : await TypeScriptParserAdapter.create()

      const dartPackageName = repo.language === 'dart' ? readDartPackageName(analysisPath) : undefined

      // F2: AST 파싱
      const astResult = await ctx.step(
        { step: 'F2:extractAst', label: 'AST 파싱' },
        (ctx) => extractAst(files, repo.id, adapter, (event) => {
          if (event.step === 'F2:progress') {
            ctx.emit('progress', 'AST 파싱 진행', event.meta)
            return
          }
          if (event.step === 'F2:parseError') {
            ctx.emit('warning', 'AST 파싱 오류', event.meta)
          }
        }),
      )

      // F3a: import 해석
      const importResolved = await ctx.step(
        { step: 'F3a:resolveImportEdges', label: 'import 해석' },
        (step) =>
          resolveImportEdges(astResult.edges, astResult.nodes, files, repo.id, {
            pathAliases: (repo.pathAliases ?? {}) as Record<string, string | string[]>,
            baseUrl: repo.baseUrl ?? '',
            repoPath: analysisPath,
            language: repo.language ?? 'typescript',
            dartPackageName,
          }, undefined, (progress) => step.emit('progress', 'import 해석 진행', {
            ...progress,
            unit: 'edges',
            phase: 'build_graph',
            step: 'F3a:resolveImportEdges',
          })),
      )

      // F4: 타입 참조 해석
      const typeResolved = await ctx.step(
        { step: 'F4:resolveTypeRefs', label: '타입 참조 해석' },
        (step) => resolveTypeRefs(importResolved, astResult.nodes, files, (progress) => step.emit('progress', '타입 참조 해석 진행', {
          ...progress,
          unit: 'edges',
          phase: 'build_graph',
          step: 'F4:resolveTypeRefs',
        })),
      )

      // F5: 함수 호출 해석 + CHA
      const finalEdges = await ctx.step(
        { step: 'F5:resolveCalls', label: '함수 호출 해석' },
        (step) =>
          resolveCalls(
            typeResolved,
            astResult.nodes,
            astResult.constructorDIMap,
            astResult.enumValueMap,
            astResult.fieldOriginsMap,
            (progress) => step.emit('progress', '함수 호출 해석 진행', {
              ...progress,
              unit: 'edges',
              phase: 'build_graph',
              step: 'F5:resolveCalls',
            }),
          ),
      )

      // F6: persistGraph (트랜잭션 내 DELETE → INSERT)
      const upsertStats = await ctx.step(
        { step: 'F6:persistGraph', label: 'DB 저장' },
        (step: PipelineStepContext) =>
          persistGraph(repo.id, astResult.nodes, finalEdges, db, ({ meta }) => {
            /* v8 ignore next -- pending residual callback behavior is covered in F6; orchestrator only forwards ctx.emit */
            step.emit('warning', 'F6: pending residual converted', meta)
          }, (meta) => {
            step.emit('progress', '그래프 DB 저장 진행', {
              ...meta,
              phase: 'build_graph',
              step: 'F6:persistGraph',
            })
          }),
      )

      // F7: validateGraph
      const validation = await ctx.step(
        { step: 'F7:validateGraph', label: '그래프 검증' },
        () => validateGraph(repo.id, files.length, astResult.parse_errors.length, db),
      )

      const result = {
        files_count: files.length,
        nodes_count: upsertStats.nodes_count,
        edges_count: upsertStats.edges_count,
        parse_errors: astResult.parse_errors,
        validation: { valid: validation.valid, warnings: validation.warnings },
        pending_edges: validation.pending_edges,
      }
      ctx.commitOutcome(ctx.markPassed({
        sourceCommit: headCommit,
        summary: result,
      }))
      return result
    },
  )

  return {
    runId: started.runId,
    completion: started.completion.then((result) => {
      if (result.ok) return result.value
      throw buildGraphErrorFromPipelineFailure(result.failure)
    }),
  }
}

function buildGraphErrorFromPipelineFailure(failure: PipelineFailure): BuildGraphError {
  return new BuildGraphError(failure.message, 'GRAPH_FAILED')
}
