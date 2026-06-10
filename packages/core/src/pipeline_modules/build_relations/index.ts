// build_relations 오케스트레이터 (F1~F6)
// SOT: specs/build_relations/architecture.md §3

import { and, eq, isNull } from 'drizzle-orm'
import { repositories } from '@/db/schema/core.js'
import { PipelineError } from '@/infra/errors.js'
import { PipelineExecution, type PipelineFailure } from '@/pipeline_infra/index.js'
import { getHeadCommit } from '@/pipeline_modules/build_graph/git_helpers.js'
import type { RunBuildRelationsInput, BuildRelationsResult, SourceFallback } from './types.js'
import { loadInputs } from './load_inputs.js'
import { buildSemanticIndex } from './semantic_index.js'
import { extractCandidates } from './candidates/index.js'
import { resolveCandidates } from './resolvers/index.js'
import { composeRelationRuleContext, emitPromotedRelations } from './rule_authoring/consumption.js'
import { loadPromotedRelationRules } from './rule_authoring/persistence.js'
import { normalizeRelations } from './normalize_relations.js'
import { persistCodeRelations } from './persist_code_relations.js'
import { createSourceFallback } from './source_fallback.js'
import { classifyDslLegacyFacts } from '@/pipeline_modules/shared/static_config/pattern_dsl.js'
import type { ExtractedRelation } from './types.js'
import { getRepositoryPaths } from '@/repo/repository-paths.js'

export const NULL_SOURCE_FALLBACK: SourceFallback = {
  /* v8 ignore next -- fallback helper for resolver unit tests. */
  resolveConstant: () => null,
}

export async function runBuildRelations(
  input: RunBuildRelationsInput,
): Promise<BuildRelationsResult & { runId: string }> {
  const { db, repoId } = input

  const repo = db.select()
    .from(repositories)
    .where(and(eq(repositories.id, repoId), isNull(repositories.deletedAt)))
    .get()
  if (!repo) throw new PipelineError(`Repository not found: ${repoId}`, 'NOT_FOUND')
  const paths = typeof repo.repoPath === 'string' ? getRepositoryPaths(repo) : null

  const pipeline = new PipelineExecution({ db })
  const runResult = await pipeline.runStage(
    { projectId: repo.projectId, repoId, kind: 'build_relations', totalSteps: 7, parentRunId: input.parentRunId, signal: input.signal },
    async (ctx) => {
    // F1: 입력 로드
    const inputs = await ctx.step(
      { step: 'F1:loadInputs' },
      () => loadInputs(input),
    )

    // F2: Semantic index 빌드
    const index = await ctx.step(
      { step: 'F2:buildSemanticIndex' },
      () => buildSemanticIndex(inputs),
    )

    // F3: Candidate 추출
    const candidates = await ctx.step(
      { step: 'F3:extractCandidates' },
      () => extractCandidates(inputs, index),
    )

    // F4: Candidate resolve
    const extracted = await ctx.step(
      { step: 'F4:resolveCandidates' },
      () => resolveCandidates(candidates, index, createSourceFallback(inputs.repoPath)),
    )

    // F4b: loop-promoted relation rules (db_access/api_call/external_service for ORMs/clients/vendors the
    // hard-coded engine doesn't cover; hard-coded wins so this is empty for known ones). Consumed from
    // per-repo persistence; appended to F4's output before normalize.
    const promotedRelations = await ctx.step(
      { step: 'F4b:promotedRelations' },
      () => {
        const stored = loadPromotedRelationRules({ db, repoId })
        return emitPromotedRelations(
          composeRelationRuleContext({
            dbAccess: stored?.dbAccess ?? [],
            apiCall: stored?.apiCall ?? [],
            externalService: stored?.externalService ?? [],
          }),
          inputs,
          index,
        )
      },
    )
    const extractedWithPromoted: ExtractedRelation[] = [...extracted, ...promotedRelations]

    // F5: Normalize + dedupe
    const normalized = await ctx.step(
      { step: 'F5:normalizeRelations' },
      () => normalizeRelations(extractedWithPromoted),
    )

    // F6: Persist
    const result = await ctx.step(
      { step: 'F6:persistCodeRelations' },
      () => persistCodeRelations(db, repoId, normalized),
    )
    const telemetry = relationDslLegacyTelemetry(extracted)

    const builtFromCommit = paths ? getHeadCommit(paths.worktreeRoot) : null
    ctx.commitOutcome(ctx.markPassed({
      sourceCommit: builtFromCommit,
      phaseMeta: {
        patternDslTelemetry: telemetry,
      },
      summary: {
        relationsCount: result.relationsCount,
        patternDslTelemetry: telemetry,
      },
    }))
    return { ...result, telemetry, runId: ctx.runId }
    },
  )

  if (!runResult.ok) throw toBuildRelationsError(runResult.failure)
  return runResult.value
}

function relationDslLegacyTelemetry(relations: ExtractedRelation[]): Record<string, number> {
  const dslRelations = relations.filter((relation) => relation.payload.adapter === 'pattern_dsl')
  const legacyRelations = relations.filter((relation) => relation.payload.adapter !== 'pattern_dsl')
  const comparison = classifyDslLegacyFacts({
    dslFacts: dslRelations.map(relationFact),
    legacyFacts: legacyRelations.map(relationFact),
  })
  return {
    both: comparison.summary.both,
    dsl_only: comparison.summary.dsl_only,
    legacy_only: comparison.summary.legacy_only,
    conflict: comparison.summary.conflict,
  }
}

function relationFact(relation: ExtractedRelation): { key: string; value: string } {
  return {
    key: `${relation.kind}:${relation.sourceNodeId}:${relation.target ?? ''}`,
    value: `${relation.operation ?? ''}:${relation.canonicalTarget ?? relation.target ?? ''}`,
  }
}

function toBuildRelationsError(failure: PipelineFailure): unknown {
  if (!failure.causeName) return failure.message
  return new Error(failure.message)
}

// build_docs 에서 사용하는 reachable relation 조회 (기존 인터페이스 유지)
export { relationsForReachableNodes } from './relations_for_reachable_nodes.js'
export type { BuildRelationsResult } from './types.js'
