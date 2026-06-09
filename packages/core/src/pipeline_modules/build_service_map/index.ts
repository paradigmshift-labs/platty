import { eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { projects, repositories } from '@/db/schema/core.js'
import { PipelineExecution, type PipelineFailure } from '@/pipeline_infra/index.js'
import { PipelineError } from '@/infra/errors.js'
import type { RunBuildServiceMapInput, RunBuildServiceMapResult, DocumentFactIndex } from './types.js'
import { loadInputs } from './f1_load_inputs.js'
import { buildDocumentFactIndex } from './f2_build_document_fact_index.js'
import { buildDeterministicFactIndex } from './f3_build_deterministic_fact_index.js'
import { resolveUnresolvedTargets } from './f4_resolve_unresolved_targets.js'
import { matchFactsToNodes } from './f5_match_facts_to_nodes.js'
import { buildEdges } from './f6_build_edges.js'
import { mergeAndDedupeEdges } from './f7_merge_and_dedupe_edges.js'
import { persistServiceMap } from './f8_persist_service_map.js'
import { validateServiceMap } from './f9_validate_service_map.js'
import { getHeadCommit } from '@/pipeline_modules/build_graph/git_helpers.js'
import { getRepositoryPaths } from '@/repo/repository-paths.js'

export async function runBuildServiceMap(input: RunBuildServiceMapInput): Promise<RunBuildServiceMapResult> {
  const { db, repoId } = input
  const opts = input.opts ?? {}
  const includeLowConfidence = opts.includeLowConfidence ?? false
  const failOnValidationWarning = opts.failOnValidationWarning ?? false
  const includeDocumentFacts = opts.includeDocumentFacts ?? false

  const scope = resolveRunScope(db, { repoId, projectId: input.projectId })

  const pipeline = new PipelineExecution({ db })
  const runResult = await pipeline.runStage(
    {
      projectId: scope.projectId,
      repoId: scope.repoId ?? undefined,
      kind: 'build_service_map',
      totalSteps: 9,
      parentRunId: input.parentRunId,
      signal: input.signal,
    },
    async (ctx) => {
    // F1
    const serviceMapInput = await ctx.step(
      { step: 'F1:loadInputs' },
      () => loadInputs({ db, repoId: scope.repoId ?? undefined, projectId: scope.projectId }),
    )

    // F2 — MVP 기본 비활성화. opts.includeDocumentFacts=true일 때만 실행.
    const docFactIndex: DocumentFactIndex = includeDocumentFacts
      ? await ctx.step(
          { step: 'F2:buildDocumentFactIndex' },
          () => buildDocumentFactIndex(serviceMapInput),
        )
      : { anchoredFacts: [], mergeEvidenceFacts: [], unresolvedFacts: [], warnings: [] }

    // F3
    const deterministicFactIndex = await ctx.step(
      { step: 'F3:buildDeterministicFactIndex' },
      () => buildDeterministicFactIndex(serviceMapInput),
    )

    // F4
    const resolvedFacts = await ctx.step(
      { step: 'F4:resolveUnresolvedTargets' },
      () => resolveUnresolvedTargets({
        deterministic: deterministicFactIndex,
        documents: docFactIndex,
        serviceMapInput,
      }),
    )

    // F5
    const matchedFacts = await ctx.step(
      { step: 'F5:matchFactsToNodes' },
      () => matchFactsToNodes({ facts: resolvedFacts.facts, serviceMapInput }),
    )

    // F6
    const draftEdges = await ctx.step(
      { step: 'F6:buildEdges' },
      () => buildEdges(matchedFacts, { projectId: serviceMapInput.projectId, fallbackRepoId: serviceMapInput.repoId }),
    )

    // F7
    const mergedEdges = await ctx.step(
      { step: 'F7:mergeAndDedupeEdges' },
      () => mergeAndDedupeEdges(draftEdges),
    )

    // F8
    const persistResult = await ctx.step(
      { step: 'F8:persistServiceMap' },
      () => persistServiceMap({
        db,
        projectId: serviceMapInput.projectId,
        repoId: serviceMapInput.repoId,
        runId: ctx.runId,
        edges: mergedEdges,
        includeLowConfidence,
      }),
    )

    // F9
    const validation = await ctx.step(
      { step: 'F9:validateServiceMap' },
      () => validateServiceMap({
        serviceMapInput,
        resolvedFacts,
        persistedEdges: mergedEdges.filter((e) => includeLowConfidence || e.confidence !== 'low'),
        skippedLowConfidence: persistResult.skippedLowConfidence,
        failOnValidationWarning,
      }),
    )

    if (validation.shouldFail) {
      throw new PipelineError(`build_service_map validation failed: ${validation.warnings.map((w) => w.message).join('; ')}`, 'VALIDATION_FAILED')
    }

    const sourceCommit = scope.repo
      ? getHeadCommit(getRepositoryPaths(scope.repo).worktreeRoot) ?? scope.repo.lastSyncedCommit ?? 'unknown'
      : null
    ctx.commitOutcome(ctx.markPassed({
      sourceCommit,
      phaseMeta: { repoIds: serviceMapInput.repoIds },
      summary: {
        insertedEdges: persistResult.insertedEdges,
        skippedLowConfidence: persistResult.skippedLowConfidence,
        unresolvedFacts: resolvedFacts.unresolvedFacts.length,
        warnings: docFactIndex.warnings.length + validation.warnings.length,
      },
    }))

    return {
      runId: ctx.runId,
      insertedEdges: persistResult.insertedEdges,
      skippedLowConfidence: persistResult.skippedLowConfidence,
      unresolvedFacts: resolvedFacts.unresolvedFacts.length,
      warnings: [...docFactIndex.warnings, ...validation.warnings],
    }
    },
  )

  if (!runResult.ok) throw toBuildServiceMapError(runResult.failure)
  return runResult.value
}

export * from './types.js'
export * from './f1_load_inputs.js'
export * from './f2_build_document_fact_index.js'
export * from './f3_build_deterministic_fact_index.js'
export * from './f4_resolve_unresolved_targets.js'
export * from './f5_match_facts_to_nodes.js'
export * from './f6_build_edges.js'
export * from './f7_merge_and_dedupe_edges.js'
export * from './f8_persist_service_map.js'
export * from './f9_validate_service_map.js'

function resolveRunScope(db: DB, input: { repoId?: string; projectId?: string }) {
  if (input.repoId) {
    const repo = db.select().from(repositories).where(eq(repositories.id, input.repoId)).get()
    if (!repo) throw new PipelineError(`Repository not found: ${input.repoId}`, 'NOT_FOUND')
    if (input.projectId && input.projectId !== repo.projectId) {
      throw new PipelineError(
        `Repository ${input.repoId} does not belong to project ${input.projectId}`,
        'VALIDATION_FAILED',
      )
    }
    return { projectId: repo.projectId, repoId: repo.id, repo }
  }

  if (!input.projectId) {
    throw new PipelineError('projectId or repoId is required for build_service_map', 'VALIDATION_FAILED')
  }

  const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get()
  if (!project) throw new PipelineError(`Project not found: ${input.projectId}`, 'NOT_FOUND')
  return { projectId: input.projectId, repoId: null, repo: null }
}

function toBuildServiceMapError(failure: PipelineFailure): Error {
  return new PipelineError(failure.message, failure.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'ANALYSIS_FAILED')
}
