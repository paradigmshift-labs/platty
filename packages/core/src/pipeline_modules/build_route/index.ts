// build_route 메인 orchestrator.
// repositories + code graph → adapter detection/rules → fallback/compose → bundles → DB.

import { and, eq } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import type { DB } from '@/db/client.js'
import { repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import type { Framework } from '@/db/schema/enums.js'
import { PipelineExecution, type PipelineFailure } from '@/pipeline_infra/index.js'

import { REGISTRY } from './adapters/index.js'
import { flutterSemanticAnalyzer } from './analyzers/semantic/flutter/index.js'
import { reactSemanticAnalyzer } from './analyzers/semantic/react/index.js'
import {
  evaluateDetection,
  resolveConflicts,
} from './f1_activate_adapters.js'
import { loadAdapters, type LoadedAdapter } from './f2_load_adapters.js'
import { runRuleEngine } from './f3_run_rule_engine.js'
import { composeRoutePromotedAdapters } from './rule_authoring/consumption.js'
import { loadPromotedRouteRules } from './rule_authoring/persistence.js'
import { runAnalyzerAdapters } from './f4_evaluate_source_analyzers.js'
import { evaluateSourceFallbacks } from './f4_evaluate_source_fallbacks.js'
import { composeEntryPoints, type ComposeEntryPointsResult } from './f6_compose_entry_points.js'
import { resolveEntryPointReachability } from './f7_resolve_entry_reachability.js'
import { persistResults } from './f8_persist_results.js'
import { createGraphIndex } from './graph_index.js'
import { emergentRoutingEnabled } from './emergent_flag.js'
import { extractPatternProfileRouteEntries } from './profile_dsl.js'
import { getHeadCommit } from '@/pipeline_modules/build_graph/git_helpers.js'
import { classifyDslLegacyFacts } from '@/pipeline_modules/shared/static_config/pattern_dsl.js'
import { getRepositoryPaths } from '@/repo/repository-paths.js'
import {
  loadFreshStaticAnalysisPatternProfile,
  mergeCustomDecorators,
  mergeRoutingFiles,
  normalizeRepositoryCustomDecorators,
} from '@/pipeline_modules/shared/static_config/index.js'
import type { ConfigPatternEvidence } from '@/pipeline_modules/shared/static_config/types.js'
import type {
  AdapterMeta,
  AnalyzerContext,
  AnalyzerResult,
  BundleEntry,
  EntryPointDraft,
  FrameworkDetectionResult,
  Adapter,
  ReachabilityCaps,
  RunRuleEngineResult,
  StackInfoForBuildRoute,
  CustomDecoratorMapping,
  SuspectedNode,
} from './types.js'

export class BuildRouteError extends Error {
  constructor(
    public code: 'REPO_NOT_FOUND' | 'STACK_INFO_MISSING',
    message: string,
  ) {
    super(message)
    this.name = 'BuildRouteError'
  }
}

export interface RunBuildRouteInput {
  db: DB
  repoId: string
  parentRunId?: string
  signal?: AbortSignal
  /** reachability(F7) 옵션. */
  opts?: {
    reachabilityCaps?: ReachabilityCaps
  }
}

export interface RunBuildRouteResult extends RunRuleEngineResult {
  runId: string
  bundles: BundleEntry[]
  composeDiagnostics: ComposeEntryPointsResult['diagnostics']
}

export async function runBuildRoute(input: RunBuildRouteInput): Promise<RunBuildRouteResult> {
  const { db, repoId } = input

  // 1. repository → stackInfo
  const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
  if (!repo) {
    throw new BuildRouteError('REPO_NOT_FOUND', `Repository '${repoId}' not found`)
  }
  if (!repo.framework) {
    throw new BuildRouteError(
      'STACK_INFO_MISSING',
      `STACK_INFO_MISSING: repository.framework not analyzed yet — run analyze_repo first`,
    )
  }
  const paths = getRepositoryPaths(repo)
  const pipeline = new PipelineExecution({ db })
  const runResult = await pipeline.runStage(
    { projectId: repo.projectId, repoId, kind: 'build_route', totalSteps: 10, parentRunId: input.parentRunId, signal: input.signal },
    async (ctx) => {
    const analysisPath = paths.analysisRoot
    const repoConfig = loadFreshStaticAnalysisPatternProfile({ db, repoId })
    const consumableRepoConfig = repoConfig?.analysisMode === 'deterministic_only' ? null : repoConfig
    const repositoryConfigEvidence: ConfigPatternEvidence = {
      confidence: 'high',
      source: 'deterministic',
      evidenceNodeIds: [],
      filePaths: [],
      builtFromCommit: repoConfig?.builtFromCommit ?? null,
      reason: 'Existing repository metadata.',
    }
    const configuredDecorators = consumableRepoConfig
      ? mergeCustomDecorators(
          normalizeRepositoryCustomDecorators(repo.customDecorators, repositoryConfigEvidence),
          consumableRepoConfig.routePatterns.customDecorators,
        ).customDecorators
      : normalizeRepositoryCustomDecorators(repo.customDecorators, repositoryConfigEvidence)
    const routingFiles = consumableRepoConfig
      ? mergeRoutingFiles(repo.routingFiles ?? [], consumableRepoConfig.routePatterns.routingFiles).routingFiles
      : repo.routingFiles ?? []
    const stackInfo: StackInfoForBuildRoute = {
      framework: repo.framework as Framework,
      routingLibs: repo.routingLibs ?? [],
      customDecorators: toRouteCustomDecorators(configuredDecorators),
      apiBasePaths: mergeApiBasePaths(repo.apiBasePaths ?? [], consumableRepoConfig?.serviceMapHints.apiBasePaths.map((item) => item.basePath) ?? []),
      routingFiles,
      entrypointFiles: repo.entrypointFiles ?? [],
    }

    // 2. route context 로드
    const { nodes, edges, graph } = await ctx.step(
      { step: 'F0:loadRouteContext', label: 'route context 로드' },
      async () => {
        const loadedNodes = db.select().from(codeNodes).where(eq(codeNodes.repoId, repoId)).all()
        const loadedEdges = db.select().from(codeEdges).where(eq(codeEdges.repoId, repoId)).all()
        return { nodes: loadedNodes, edges: loadedEdges, graph: createGraphIndex({ nodes: loadedNodes, edges: loadedEdges }) }
      },
    )

    const dslRouteResult = await ctx.step(
      { step: 'F2:patternDslRoutes', label: 'pattern DSL route 평가' },
      // The profile DSL path is the emergent static route engine for the pattern rules (react
      // jsx-route, flutter go-router, …). It is itself evidence-driven (each profile rule self-gates
      // on graph facts), so it runs in EMERGENT too; the strong adapters layer multi-hop cases (e.g.
      // nestjs decorators) on top, and downstream dedup folds any (method, path) overlap.
      () => extractPatternProfileRouteEntries({
        repoId,
        profile: consumableRepoConfig,
        nodes,
        edges,
      }),
    )

    // 3. f1 detection
    const detections = await ctx.step(
      { step: 'F1:activateAdapters', label: 'route adapter 활성화' },
      () => {
        const allMetas = Object.values(REGISTRY).map(toMeta)
        const detected = evaluateDetection(stackInfo, allMetas, {
          importSpecifiers: collectImportSpecifiers(edges),
          callPatterns: collectCallPatterns(edges),
        })
        // Emergent routing (DEFAULT): each adapter self-gates on its OWN evidence — manifest dependency for
        // FS-convention routing (nextjs/astro `pages/`), import/call signals for code-based routing
        // (express, react-router). We deliberately SKIP resolveConflicts: the exclusive winner-take-all
        // suppression WAS the framework gate (it dropped express-on-nestjs etc). Multiple frameworks now
        // coexist; per-rule requires_import keeps a non-matching adapter's rules from emitting.
        // LEGACY_ROUTING=1 restores resolveConflicts (the old single-winner framework gate).
        if (emergentRoutingEnabled()) {
          return detected
        }
        return resolveConflicts(detected)
      },
    )

    // 4. f2 loadAdapters (+ loop-promoted route rules for frameworks the hard-coded registry doesn't cover;
    //    self-gated by requiresImport, stripped when hard-coded already covers the import → empty = no-op).
    const adapters = await ctx.step(
      { step: 'F2:loadAdapters', label: 'route adapter 로드' },
      () => {
        const base = loadAdapters({ detections, stackInfo })
        const promoted = composeRoutePromotedAdapters({ promoted: loadPromotedRouteRules({ db, repoId })?.rules ?? [] })
        return [...base, ...promoted]
      },
    )

    // 5. f3 runRuleEngine
    const result = await ctx.step(
      { step: 'F3:runRuleEngine', label: 'route rule engine 실행' },
      () => runRuleEngine({ adapters, graph, repoId, stackInfo }),
    )

    const sourceFallbackResult = await ctx.step(
      { step: 'F4:evaluateSourceFallbacks', label: 'route source fallback 평가' },
      () => evaluateSourceFallbacks({
        repoPath: analysisPath,
        repoId,
        stackInfo,
        detections,
        graphNodes: nodes,
        graphEdges: edges,
      }),
    )

    const semanticAnalyzerResult = await ctx.step(
      { step: 'F4:evaluateSourceAnalyzers', label: 'route source analyzer 실행' },
      () => evaluateSemanticSourceAnalyzers({
        repoPath: analysisPath,
        repoId,
        stackInfo,
        detections,
        graphNodes: nodes,
      }),
    )
    const sourceFallbackEntries = [
      ...sourceFallbackResult.entryPoints,
      ...semanticAnalyzerResult.entryPoints,
    ]
    const suspected = suppressSourceResolvedDelegateSuspected(
      [...result.suspected, ...semanticAnalyzerResult.suspected],
      collectSourceResolvedAdapterKeys(sourceFallbackEntries),
    )

    // 6. build_route is PURE STATIC — there is no LLM fallback for suspected entry points. The former F5
    //    runLlmFallback step was REMOVED (LLM-free static-analysis core). Suspected (ambiguous) entry points
    //    are surfaced as `result.suspected`; LLM enrichment of them happens OUTSIDE the engine (the route CLI /
    //    agent handles them later). Documented static limit — see docs/system_limitations.md.

    const globalPrefixFrameworks = new Set(
      adapters.filter((a) => a.supportsGlobalPrefix).map((a) => a.name),
    )
    const composed = await ctx.step(
      { step: 'F6:composeEntryPoints', label: 'route entry point 합성' },
      () => composeEntryPoints({
        repoId,
        graphNodes: nodes,
        stackInfo,
        ruleEntries: [...dslRouteResult.entryPoints, ...result.entryPoints],
        sourceFallbackEntries,
        llmEntries: [],
        semanticSuspected: semanticAnalyzerResult.suspected.filter((node) => node.reason === 'semantic_navigation_ambiguous').length,
        globalPrefixFrameworks,
      }),
    )
    const dslLegacyTelemetry = routeDslLegacyTelemetry(
      dslRouteResult.entryPoints,
      [...result.entryPoints, ...sourceFallbackEntries],
    )
    const allEntries = composed.entryPoints

    // 7. f7 resolveReachability — 각 entry_point 별 BFS bundle
    const bundles = await ctx.step(
      { step: 'F7:resolveReachability', label: 'route reachability 계산' },
      (step) => resolveEntryPointReachability({
        repoId,
        entryPoints: allEntries,
        graph,
        caps: input.opts?.reachabilityCaps,
        onProgress: (progress) => step.emit('progress', 'route reachability 진행', progress),
      }),
    )

    // 8. f8 persist
    await ctx.step(
      { step: 'F8:persistResults', label: 'route 결과 저장' },
      () => persistResults({
        db,
        repoId,
        detections,
        entryPoints: allEntries,
        bundles,
      }),
    )

    const headCommit = getHeadCommit(paths.worktreeRoot)
    ctx.commitOutcome(ctx.markPassed({
      sourceCommit: headCommit,
      phaseMeta: {
        patternDslTelemetry: dslLegacyTelemetry,
      },
      summary: {
        patternDslTelemetry: dslLegacyTelemetry,
        entryPoints: allEntries.length,
        bundles: bundles.length,
      },
    }))

    return {
      runId: ctx.runId,
      ...result,
      entryPoints: allEntries,
      suspected,
      bundles,
      composeDiagnostics: {
        ...composed.diagnostics,
        ...dslRouteResult.diagnostics,
        ...dslLegacyTelemetry,
      },
    }
    },
  )

  if (!runResult.ok) throw toBuildRouteError(runResult.failure)
  return runResult.value
}

function toBuildRouteError(failure: PipelineFailure): unknown {
  if (!failure.causeName) return failure.message
  return new Error(failure.message)
}

function routeDslLegacyTelemetry(
  dslEntries: EntryPointDraft[],
  legacyEntries: EntryPointDraft[],
): Record<string, number> {
  const comparison = classifyDslLegacyFacts({
    dslFacts: dslEntries.map(routeFact),
    legacyFacts: legacyEntries.map(routeFact),
  })
  return {
    both: comparison.summary.both,
    dsl_only: comparison.summary.dsl_only,
    legacy_only: comparison.summary.legacy_only,
    conflict: comparison.summary.conflict,
  }
}

function routeFact(entry: EntryPointDraft): { key: string; value: string } {
  const path = entry.fullPath ?? entry.path ?? ''
  const method = entry.httpMethod ?? ''
  const handler = entry.handlerNodeId
  return {
    key: `${entry.kind}:${handler}:${path}`,
    value: `${method}:${path}`,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function toRouteCustomDecorators(
  input: Record<string, { resolvesTo: string; source: string }>,
): Record<string, CustomDecoratorMapping> {
  const out: Record<string, CustomDecoratorMapping> = {}
  for (const [name, mapping] of Object.entries(input)) {
    out[name] = { resolvesTo: mapping.resolvesTo, source: mapping.source }
  }
  return out
}

function mergeApiBasePaths(repositoryPaths: string[], configPaths: string[]): string[] {
  return [...new Set([...repositoryPaths, ...configPaths].filter(Boolean))]
}

function collectImportSpecifiers(edges: Array<typeof codeEdges.$inferSelect>): string[] {
  return [...new Set(
    edges
      .filter((edge) => edge.relation === 'imports')
      .map((edge) => edge.targetSpecifier)
      .filter((specifier): specifier is string => Boolean(specifier)),
  )]
}

function collectCallPatterns(edges: Array<typeof codeEdges.$inferSelect>): string[] {
  return [...new Set(
    edges
      .filter((edge) => edge.relation === 'calls')
      .flatMap((edge) => [
        edge.targetSymbol,
        edge.chainPath && edge.targetSymbol ? `${edge.chainPath}.${edge.targetSymbol}` : null,
      ])
      .filter((pattern): pattern is string => Boolean(pattern)),
  )]
}

function collectSourceResolvedAdapterKeys(entries: EntryPointDraft[]): Set<string> {
  const keys = new Set<string>()
  for (const entry of entries) {
    if (typeof entry.metadata?.adapterId === 'string') keys.add(entry.metadata.adapterId)
    keys.add(entry.framework)
  }
  return keys
}

function suppressSourceResolvedDelegateSuspected(
  suspected: SuspectedNode[],
  sourceResolvedAdapters: Set<string>,
): SuspectedNode[] {
  return suspected.filter((node) => {
    if (node.reason !== 'adapter_delegate') return true
    return !sourceResolvedAdapters.has(node.adapter)
  })
}

export function evaluateSemanticSourceAnalyzers(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): AnalyzerResult {
  const graph = createGraphIndex({ nodes: input.graphNodes, edges: [] })
  const ctx: AnalyzerContext = {
    repoPath: input.repoPath,
    repoId: input.repoId,
    stackInfo: input.stackInfo,
    detections: input.detections,
    graphNodes: input.graphNodes,
    graph,
  }
  return runAnalyzerAdapters({
    ctx,
    analyzers: [flutterSemanticAnalyzer, reactSemanticAnalyzer],
    readFile: (filePath) => {
      try {
        return readFileSync(joinPath(input.repoPath, filePath), 'utf-8')
      } catch {
        return null
      }
    },
  })
}

export function evaluateSourceAnalyzers(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): AnalyzerResult {
  const sourceFallbackResult = evaluateSourceFallbacks(input)
  const semanticResult = evaluateSemanticSourceAnalyzers(input)
  return {
    entryPoints: [...sourceFallbackResult.entryPoints, ...semanticResult.entryPoints],
    suspected: semanticResult.suspected,
    diagnostics: {
      'legacy_source_fallbacks.sourceFallbackEntries': sourceFallbackResult.entryPoints.length,
      ...semanticResult.diagnostics,
      filesRead: semanticResult.diagnostics.filesRead + 1,
    },
  }
}

function toMeta(adapter: Adapter): AdapterMeta {
  return {
    framework: adapter.name,
    priority: adapter.priority,
    exclusiveWith: adapter.exclusiveWith,
    mvpStatus: adapter.mvpStatus,
    detection: adapter.detection,
    minEvidence: adapter.minEvidence,
  }
}
