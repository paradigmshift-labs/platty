/*
 * runAnalyzeRepo — analyze_repo 모듈 orchestrator (v2).
 *
 * SOT: specs/analyze_repo/specs/orchestrator/spec.md
 *      specs/analyze_repo/architecture.md §1, §9
 *
 * v2 흐름 (static-core — LLM 호출 없음):
 *   F1 validateRepo (sync, no LLM)
 *   F2a-1 readManifests (sync, no LLM)
 *   F2a-2 extractIdentity (정적, no LLM)
 *   F2b-1 extractStandardSlots (정적) — framework='other'/null이어도 SKIP 없이 실행
 *   F2b-3 mergeStackInfo (Zod 검증)
 *   F3 validatePaths
 *   S8 persist (단일 트랜잭션 — repositories UPDATE + repository_phase_status UPSERT)
 *
 * 동시 실행 방어: status='running' run 존재 시 RUN_IN_PROGRESS throw.
 * server route 시그니처 유지 — `{ runId, completion }`.
 */

import { eq, and } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { repositories } from '@/db/schema/core.js'
import { pipelineRuns } from '@/db/schema/pipeline_runs.js'
import {
  PipelineExecution,
  type LlmOverride,
  type PipelineFailure,
} from '@/pipeline_infra/index.js'
import type { TriggeredBy } from '@/db/schema/enums.js'
import { aliveById } from '@/db/helpers/soft-delete.js'

import { validateRepo } from './f1_validate_repo.js'
import { readManifests } from './f2a_read_manifests.js'
import { extractIdentity } from './f2a_extract_identity.js'
import { extractStandardSlots } from './f2b_extract_standard_slots.js'
import { StackInfoSchema } from './schemas.js'
import { validatePaths } from './f3_validate_paths.js'
import { getHeadCommit } from './git_helpers.js'
import type { Warning } from '@/db/schema/json_types/warning.js'
import { detectDefaultAnalysisBranch, prepareAnalysisWorktree } from '@/repo/analysis-worktree.js'
import { getRepositoryPaths } from '@/repo/repository-paths.js'

import type {
  IdentitySignal,
  StackInfo,
  StandardSlots,
} from './types.js'

// ────────────────────────────────────────
// 공개 타입 (v1 호환 유지)
// ────────────────────────────────────────

export interface AnalyzeRepoOptions {
  repoId: string
  triggeredBy?: TriggeredBy
  parentRunId?: string
  signal?: AbortSignal
  /** 테스트/e2e용 LLM 어댑터 override. 미지정 시 글로벌 registry 사용. */
  llmOverride?: LlmOverride
}

export class AnalyzeRepoError extends Error {
  constructor(
    message: string,
    public readonly code: 'REPO_NOT_FOUND' | 'REPO_DELETED' | 'RUN_IN_PROGRESS',
  ) {
    super(message)
    this.name = 'AnalyzeRepoError'
  }
}

export interface AnalyzeRepoStartResult {
  runId: string
  completion: Promise<void>
}

// ────────────────────────────────────────
// orchestrator
// ────────────────────────────────────────

export function runAnalyzeRepo(
  opts: AnalyzeRepoOptions,
  db: DB,
): AnalyzeRepoStartResult {
  // 1. repository 조회 + soft-delete 체크
  const repo = db
    .select()
    .from(repositories)
    .where(aliveById(repositories.id, repositories.deletedAt, opts.repoId))
    .get()
  if (!repo) {
    throw new AnalyzeRepoError(`Repository not found: ${opts.repoId}`, 'REPO_NOT_FOUND')
  }

  // ★ v2: 동시 실행 방어 — status='running' 진행 중인 analyze_repo run 존재 시 throw
  const inProgress = db
    .select()
    .from(pipelineRuns)
    .where(and(
      eq(pipelineRuns.repoId, repo.id),
      eq(pipelineRuns.kind, 'analyze_repo'),
      eq(pipelineRuns.status, 'running'),
    ))
    .get()
  if (inProgress) {
    throw new AnalyzeRepoError(
      `analyze_repo run already in progress for repo ${repo.id}`,
      'RUN_IN_PROGRESS',
    )
  }

  const pipeline = new PipelineExecution({ db, llmOverride: opts.llmOverride })
  const started = pipeline.startStage(
    {
      projectId: repo.projectId,
      repoId: repo.id,
      kind: 'analyze_repo',
      totalSteps: 10, // max — F0 worktree + A=7, B=8, C=9, D=5 (SKIP은 row 미생성)
      triggeredBy: opts.triggeredBy,
      parentRunId: opts.parentRunId,
      signal: opts.signal,
    },
    async (ctx) => {
      // F1: validate_repo (sync)
      const worktree = await ctx.step(
        { step: 'F0:prepare_worktree', label: '분석 worktree 준비' },
        () => {
          const analysisBranch = repo.analysisBranch ?? detectDefaultAnalysisBranch(repo.repoPath)
          if (!analysisBranch) {
            throw new Error('분석할 branch를 찾을 수 없습니다. repository 설정에서 analysis branch를 선택하세요.')
          }
          const prepared = prepareAnalysisWorktree({
            sourceRepoPath: repo.repoPath,
            repositoryId: repo.id,
            branch: analysisBranch,
          })
          db.update(repositories)
            .set({
              analysisBranch: prepared.branch,
              analysisWorktreePath: prepared.path,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(repositories.id, repo.id))
            .run()
          return prepared
        },
      )
      const paths = getRepositoryPaths({
        ...repo,
        analysisWorktreePath: worktree.path,
      })

      // F1: validate_repo (sync)
      const repoInfo = await ctx.step(
        { step: 'F1:validate', label: 'repo 검증' },
        () => validateRepo(paths.worktreeRoot, { allowedRoots: [worktree.path] }),
      )

      // F2a-1: read_manifests (sync)
      const manifests = await ctx.step(
        { step: 'F2a-1:read_manifests', label: '매니페스트 읽기' },
        () => readManifests(paths.analysisRoot),
      )

      // F2a-2: extract_identity (정적, sync) — LLM fallback 없음 (static-core)
      const identity: IdentitySignal = await ctx.step(
        { step: 'F2a-2:identity', label: '정적 신원 분류' },
        () => extractIdentity(manifests, paths.analysisRoot),
      )

      // F2b-1: extract_standard_slots (정적)
      // ★ static-core: framework='other'/null이어도 SKIP하지 않고 정적 슬롯을 추출한다
      // (path_aliases/schema_sources 등은 framework-독립 정적값이라 downstream이 필요로 함).
      const standard: StandardSlots = await ctx.step(
        { step: 'F2b-1:standard_slots', label: '정적 슬롯' },
        () => extractStandardSlots(manifests, identity, paths.analysisRoot, { signal: opts.signal }),
      )

      // mergeStackInfo (Zod 검증만) — ambiguous(LLM) 입력 없음
      // ★ N5: run.step으로 감싸서 Zod throw 시 F2b-3:merge step row가 status='failed'로 기록
      const merged: StackInfo = await ctx.step(
        { step: 'F2b-3:merge', label: '병합 + Zod 검증' },
        () => mergeStackInfo(identity, standard),
      )

      // F3: validate_paths
      const validated = await ctx.step(
        { step: 'F3:validate_paths', label: '경로 검증' },
        () => validatePaths(paths.analysisRoot, merged, opts.signal),
      )

      const sotWarnings = computeSotWarnings(merged)

      // S8: persist (단일 트랜잭션)
      const allWarnings: Warning[] = [
        ...sotWarnings,
        ...validated.warnings,
      ]
      const sourceCommit = await ctx.step(
        { step: 'S8:persist', label: 'DB 저장' },
        () => persist(db, repo.id, identity, merged, allWarnings, repoInfo.path),
      )

      ctx.commitOutcome(ctx.markPassed({ sourceCommit }))
    },
  )

  return {
    runId: started.runId,
    completion: started.completion.then((result) => {
      if (result.ok) return
      throw analyzeRepoErrorFromPipelineFailure(result.failure)
    }),
  }
}

function analyzeRepoErrorFromPipelineFailure(failure: PipelineFailure): Error {
  if (failure.kind === 'cancelled') {
    const error = new Error(failure.message)
    error.name = 'AbortError'
    return error
  }
  return new Error(failure.message)
}

// ────────────────────────────────────────
// mergeStackInfo — IdentitySignal + StandardSlots → StackInfo
// SOT: architecture.md §3.2
// ────────────────────────────────────────

export function mergeStackInfo(
  identity: IdentitySignal,
  standard: StandardSlots,
): StackInfo {
  const raw = {
    type: identity.type ?? 'backend',
    language: identity.language ?? 'other',
    framework: identity.framework ?? 'other',

    path_aliases: standard.path_aliases,
    base_url: standard.base_url,
    entrypoint_files: standard.entrypoint_files,
    routing_libs: standard.routing_libs,
    schema_sources: standard.schema_sources,

    // static-core: routing_files는 정적 adapter 결과만 (LLM 보정 경로 제거)
    routing_files: standard.routing_files,

    // custom_decorators는 LLM 전용이었음 → 항상 빈 값. 회사 커스텀 래퍼 alias는
    // build_route 자기개선 루프가 발견·승격한다 (static-core-refactor.md [C]).
    custom_decorators: {},
  }

  // ★ v2: Zod 검증만
  const result = StackInfoSchema.safeParse(raw)
  if (!result.success) {
    const messages = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`mergeStackInfo Zod 검증 실패: ${messages}`)
  }
  return result.data as StackInfo
}

function computeSotWarnings(data: StackInfo): Warning[] {
  const warnings: Warning[] = []
  if (data.framework === 'flutter' && data.routing_libs.length === 0) {
    warnings.push({
      field: 'routing_libs',
      message: 'flutter framework이지만 routing_libs가 비어있음 → flutter_navigator로 가정',
      severity: 'low',
    })
  }
  if (data.type !== 'backend' && data.routing_files.length === 0 && data.routing_libs.length === 0) {
    warnings.push({
      field: 'routing_files',
      message: 'frontend/mobile framework이지만 routing_files/routing_libs 모두 비어있음',
      severity: 'medium',
    })
  }
  return warnings
}

// ────────────────────────────────────────
// persist — 단일 트랜잭션 (repositories UPDATE + repository_phase_status UPSERT)
// ────────────────────────────────────────

function persist(
  db: DB,
  repoId: string,
  identity: IdentitySignal,
  stackInfo: StackInfo,
  warnings: { field: string; message: string; severity: string }[],
  repoPath: string,
): string | null {
  const now = new Date().toISOString()
  const headCommit = getHeadCommit(repoPath)

  db.transaction(() => {
    db.update(repositories)
      .set({
        type: identity.type,
        language: identity.language,
        languageRaw: identity.language_raw,
        // static-core: 미인식 repo도 framework는 canonical 'other'로 저장(null 금지 — downstream 게이트 안전).
        framework: identity.framework ?? 'other',
        frameworkRaw: identity.framework_raw,
        orm: identity.orm,                                       // ★ v2 — H1
        schemaSources: stackInfo.schema_sources,
        routingFiles: stackInfo.routing_files,
        routingLibs: stackInfo.routing_libs,
        entrypointFiles: stackInfo.entrypoint_files,
        pathAliases: stackInfo.path_aliases,
        baseUrl: stackInfo.base_url,
        customDecorators: stackInfo.custom_decorators,           // ★ N4: cast 제거

        validationWarnings: warnings as never,
        lastSyncedCommit: headCommit,
        updatedAt: now,
      })
      .where(eq(repositories.id, repoId))
      .run()

  })
  return headCommit
}
