import { eq, and, isNull } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { PipelineExecution, type PipelineContext, type PipelineFailure } from '@/pipeline_infra/index.js'
import { PipelineError, AbortError, type ErrorCode } from '@/infra/errors.js'

import type { BuildModelsAdapter, BuildModelsResult } from './types.js'
import { DEFAULT_ADAPTER_REGISTRY, loadSchemaSources } from './f1_load_schema_sources.js'
import { composeModelAdapterRegistry, promotedGraphQuerySources, PROMOTED_MODEL_ADAPTERS } from './rule_authoring/promoted_model_adapters.js'
import { loadPromotedModelAdapters } from './rule_authoring/persistence.js'
import { parseModels } from './f2_parse_models.js'
import { mergeRelations } from './f3_merge_relations.js'
import { validateModels } from './f4_validate_models.js'
import { orphanModelsForRepo, upsertModels } from './f5_upsert_models.js'
import { getRepositoryPaths } from '@/repo/repository-paths.js'

export async function runBuildModels(params: {
  repoId: string
  db: DB
  signal?: AbortSignal
  parentRunId?: string
  _adapterRegistry?: Map<string, () => BuildModelsAdapter>
}): Promise<BuildModelsResult> {
  const { repoId, db, signal } = params
  // hand-written adapters + loop-promoted graph-query specs: compiled-in rulebook + per-repo DB-persisted
  // promotions (loaded so a discovered ORM keeps producing models across runs).
  const promotedSpecs = [...PROMOTED_MODEL_ADAPTERS, ...(loadPromotedModelAdapters({ db, repoId })?.specs ?? [])]
  const adapterRegistry = params._adapterRegistry ?? composeModelAdapterRegistry(DEFAULT_ADAPTER_REGISTRY, promotedSpecs)

  // 1. repo 조회
  const repo = db.select()
    .from(repositories)
    .where(and(eq(repositories.id, repoId), isNull(repositories.deletedAt)))
    .get()
  if (!repo) {
    throw new PipelineError(`Repository not found: ${repoId}`, 'NOT_FOUND')
  }

  const commit = repo.lastSyncedCommit ?? null
  const analysisPath = getRepositoryPaths(repo).analysisRoot

  const pipeline = new PipelineExecution({ db })
  const result = await pipeline.runStage(
    {
      projectId: repo.projectId,
      repoId,
      kind: 'build_models',
      totalSteps: 5,
      sourceCommit: commit,
      signal,
      parentRunId: params.parentRunId,
    },
    async (ctx) => {
      if (signal?.aborted) throw new AbortError('build_models aborted before start')

      // Step 1 — F1 loadSchemaSources (hand-written ORMs, driven by analyze_repo's schemaSources) +
      // always-on promoted graph-query sources (loop-discovered ORMs analyze_repo can't name; each
      // self-gates on its clientPackages so it's a no-op on repos that don't import it).
      const loaded = await ctx.step(
        { step: 'F1:loadSchemaSources' },
        () => {
          const baseLoaded = loadSchemaSources(repo, adapterRegistry)
          const promoted = promotedGraphQuerySources(
            promotedSpecs,
            new Set(DEFAULT_ADAPTER_REGISTRY.keys()),
            new Set(baseLoaded.map((l) => l.source.orm)),
          )
          return [...baseLoaded, ...promoted]
        },
      )

      if (loaded.length === 0) {
        const { orphaned } = await orphanModelsForRepo(db, repoId, commit, ctx.runId, signal)
        const output: BuildModelsResult = {
          runId: ctx.runId,
          modelsCount: 0,
          upsertedCount: 0,
          orphanedCount: orphaned,
          skippedFiles: [],
          warnings: [],
          errors: [],
        }
        commitPassed(ctx, commit, output)
        return output
      }

      // Step 1.5 — graph-query 전략 선행조건 체크 (build_graph 완료 여부)
      for (const l of loaded) {
        if (l.strategy === 'graph-query') {
          const status = db.select()
            .from(repositoryPhaseStatus)
            .where(and(
              eq(repositoryPhaseStatus.repositoryId, repoId),
              eq(repositoryPhaseStatus.phase, 'build_graph'),
            ))
            .get()
          if (!status?.builtAt) {
            throw new PipelineError(
              `build_graph not completed for graph-query ORM: ${l.source.orm}`,
              'ANALYSIS_FAILED',
            )
          }
        }
      }

      // Step 2 — F2 parseModels
      const { bySource, skippedFiles } = await ctx.step(
        { step: 'F2:parseModels' },
        () => parseModels(loaded, db, repoId, analysisPath, signal),
      )

      if (bySource.length === 0) {
        const { orphaned } = await orphanModelsForRepo(db, repoId, commit, ctx.runId, signal)
        const output: BuildModelsResult = {
          runId: ctx.runId,
          modelsCount: 0,
          upsertedCount: 0,
          orphanedCount: orphaned,
          skippedFiles,
          warnings: [],
          errors: [],
        }
        commitPassed(ctx, commit, output)
        return output
      }

      // Step 3 — F3 mergeRelations (DSL source만)
      let mergedBySource = bySource
      const hasDsl = loaded.some(l => l.strategy === 'dsl-parse')
      if (hasDsl) {
        await ctx.step({ step: 'F3:mergeRelations' }, () => {
          const dslModels = bySource
            .filter(b => loaded.find(l => l.source === b.source)?.strategy === 'dsl-parse')
            .flatMap(b => b.models)
          const mergedDsl = mergeRelations(dslModels)
          mergedBySource = bySource.map(b => {
            const isDsl = loaded.find(l => l.source === b.source)?.strategy === 'dsl-parse'
            if (!isDsl) return b
            return {
              ...b,
              models: mergedDsl.filter(m => b.models.some(orig => orig.name === m.name)),
            }
          })
        })
      }

      // Step 4 — F4 validateModels
      const allModels = mergedBySource.flatMap(b => b.models)
      const { verdicts } = await ctx.step(
        { step: 'F4:validateModels' },
        () => validateModels(allModels),
      )
      const errors = verdicts.filter(v => v.level === 'error')
      const warnings = verdicts.filter(v => v.level === 'warning')

      // Step 5 — F5 upsertModels (bySource 순회 — ORM별 격리)
      let upsertedTotal = 0
      let orphanedTotal = 0
      for (const entry of mergedBySource) {
        if (signal?.aborted) throw new AbortError('build_models aborted')
        const upsertResult = await upsertModels(db, repoId, entry.source.orm, entry.models, commit, ctx.runId, signal)
        upsertedTotal += upsertResult.upserted
        orphanedTotal += upsertResult.orphaned
      }

      const output: BuildModelsResult = {
        runId: ctx.runId,
        modelsCount: allModels.length,
        upsertedCount: upsertedTotal,
        orphanedCount: orphanedTotal,
        skippedFiles,
        warnings,
        errors,
      }
      commitPassed(ctx, commit, output)
      return output
    },
  )

  if (!result.ok) throw toBuildModelsError(result.failure)
  return result.value
}

function commitPassed(ctx: PipelineContext, commit: string | null, output: BuildModelsResult): void {
  ctx.commitOutcome(ctx.markPassed({
    sourceCommit: commit,
    summary: {
      modelsCount: output.modelsCount,
      upsertedCount: output.upsertedCount,
      orphanedCount: output.orphanedCount,
      skippedFiles: output.skippedFiles.length,
      warnings: output.warnings.length,
      errors: output.errors.length,
    },
  }))
}

function toBuildModelsError(failure: PipelineFailure): Error {
  if (failure.kind === 'cancelled') return new AbortError(failure.message)
  return new PipelineError(failure.message, toBuildModelsErrorCode(failure.code))
}

function toBuildModelsErrorCode(code: string): ErrorCode {
  if (code === 'NOT_FOUND') return 'NOT_FOUND'
  if (code === 'PIPELINE_CANCELLED') return 'ABORTED'
  return 'ANALYSIS_FAILED'
}
