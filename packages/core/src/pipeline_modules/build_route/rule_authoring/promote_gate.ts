// rule_authoring/promote_gate — the deterministic, LLM-free referee that admits an agent-authored
// route rule. It EXECUTES the candidate via the same engine path (runRuleEngine) and checks the
// result against graph facts. See specs/build_route/agent-route-rule-loop.md §2.

import { createGraphIndex } from '../graph_index.js'
import type { GraphIndex } from '../graph_index.js'
import { runRuleEngine } from '../f3_run_rule_engine.js'
import type { LoadedAdapter } from '../f2_load_adapters.js'
import type { Adapter, EntryPointDraft } from '../types.js'
import type {
  PromotionInput,
  PromotionVerdict,
  RouteAdapterRuleCandidate,
} from './types.js'

/** Wrap a candidate as a single-rule active adapter (its requiresImport becomes the rule's self-gate). */
export function candidateToAdapter(c: RouteAdapterRuleCandidate): Adapter {
  return {
    name: c.framework,
    version: 'candidate',
    type: 'B',
    language: 'typescript',
    detection: { importSpecifiers: c.requiresImport },
    minEvidence: 'manifest_only',
    priority: 50,
    entrypointRules: [
      {
        id: c.id,
        kind: c.kind,
        select: { ...c.select, requires_import: c.requiresImport },
        extract: c.extract,
        ...(c.nested ? { nested: c.nested } : {}),
      },
    ],
  }
}

export function loaded(adapter: Adapter): LoadedAdapter {
  return { ...adapter, resolvedAliases: {} }
}

export async function runCandidate(
  candidate: RouteAdapterRuleCandidate,
  graph: GraphIndex,
  repoId: string,
): Promise<EntryPointDraft[]> {
  const result = await runRuleEngine({ adapters: [loaded(candidateToAdapter(candidate))], graph, repoId })
  return result.entryPoints
}

/** Rebuild a GraphIndex with every `imports` edge to one of `specifiers` removed (evidence-withheld). */
function graphWithoutImports(graph: GraphIndex, specifiers: string[]): GraphIndex {
  const set = new Set(specifiers)
  const edges = graph
    .getAllEdges()
    .filter((e) => !(e.relation === 'imports' && e.targetSpecifier !== null && set.has(e.targetSpecifier)))
  return createGraphIndex({ nodes: graph.getAllNodes(), edges })
}

function routeKey(ep: EntryPointDraft): string {
  return `${ep.httpMethod ?? ''} ${ep.fullPath ?? ep.path ?? ''}`.trim().toLowerCase()
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

/**
 * Deterministic promote referee. Runs the candidate through 4 (+1 optional) mechanical checks; each
 * forbids a concrete failure mode. `promote` is the conjunction. Runs under EMERGENT semantics (the
 * requires_import self-gate is EMERGENT-gated in select_evaluator) — env is saved/restored.
 */
export async function evaluateRouteRuleForPromotion(input: PromotionInput): Promise<PromotionVerdict> {
  const { candidate, anchorGraph, foreignGraphs, anchorExpectedRouteKeys } = input
  const repoId = input.repoId ?? 'r1'

  const priorEmergent = process.env.EMERGENT
  process.env.EMERGENT = '1'
  try {
    // 1. requiresImport non-empty
    const requiresImportNonEmpty = {
      pass: candidate.requiresImport.length > 0,
      detail: candidate.requiresImport.length > 0
        ? `gated on [${candidate.requiresImport.join(', ')}]`
        : 'requiresImport is empty — rule would fire in every repo',
    }

    // 2. anchor reproduction — the rule must catch the edges the agent claimed
    const anchorEntries = await runCandidate(candidate, anchorGraph, repoId)
    const got = uniq(anchorEntries.flatMap((e) => e.detectionEvidence.matchedEdgeIds))
    const missing = candidate.anchorEdgeIds.filter((id) => !got.includes(id))
    const anchorReproduction = {
      pass: candidate.anchorEdgeIds.length > 0 && missing.length === 0,
      expected: candidate.anchorEdgeIds,
      got,
      missing,
      detail:
        candidate.anchorEdgeIds.length === 0
          ? 'no anchorEdgeIds declared — agent must cite the edges it claims to catch'
          : missing.length === 0
            ? `reproduced all ${candidate.anchorEdgeIds.length} anchor edge(s)`
            : `missed anchor edge(s): ${missing.join(', ')}`,
    }

    // 3. evidence gate — remove the requiresImport import edges → must emit nothing
    const withheldEntries = await runCandidate(
      candidate,
      graphWithoutImports(anchorGraph, candidate.requiresImport),
      repoId,
    )
    const evidenceGate = {
      pass: withheldEntries.length === 0,
      entriesWithEvidenceWithheld: withheldEntries.length,
      detail: withheldEntries.length === 0
        ? 'emits nothing once its import evidence is removed'
        : `still emits ${withheldEntries.length} entr(y/ies) without its import evidence — not self-gating`,
    }

    // 4. cross-framework cleanliness — must not fire on repos that lack its evidence
    const polluted: { fixture: string; count: number }[] = []
    for (const fg of foreignGraphs) {
      const eps = await runCandidate(candidate, fg.graph, repoId)
      if (eps.length > 0) polluted.push({ fixture: fg.fixture, count: eps.length })
    }
    const crossFrameworkClean = {
      pass: polluted.length === 0,
      polluted,
      detail: polluted.length === 0
        ? `clean on ${foreignGraphs.length} foreign repo(s)`
        : `pollutes ${polluted.length} foreign repo(s): ${polluted.map((p) => `${p.fixture}(${p.count})`).join(', ')}`,
    }

    // 5. (optional) anchor precision vs a trustworthy answer-key
    let anchorPrecision: (PromotionVerdict['checks']['anchorPrecision']) | undefined
    if (anchorExpectedRouteKeys) {
      const expectedSet = new Set(anchorExpectedRouteKeys.map((k) => k.toLowerCase()))
      const overfired = uniq(anchorEntries.map(routeKey)).filter((k) => k.length > 0 && !expectedSet.has(k))
      anchorPrecision = {
        pass: overfired.length === 0,
        overfired,
        detail: overfired.length === 0
          ? 'no routes beyond the anchor answer-key'
          : `over-fired ${overfired.length} route(s): ${overfired.join(', ')}`,
      }
    }

    const promote =
      requiresImportNonEmpty.pass &&
      anchorReproduction.pass &&
      evidenceGate.pass &&
      crossFrameworkClean.pass &&
      (anchorPrecision?.pass ?? true)

    const failed = [
      !requiresImportNonEmpty.pass && 'requiresImportNonEmpty',
      !anchorReproduction.pass && 'anchorReproduction',
      !evidenceGate.pass && 'evidenceGate',
      !crossFrameworkClean.pass && 'crossFrameworkClean',
      anchorPrecision && !anchorPrecision.pass && 'anchorPrecision',
    ].filter(Boolean)

    return {
      promote,
      checks: { requiresImportNonEmpty, anchorReproduction, evidenceGate, crossFrameworkClean, ...(anchorPrecision ? { anchorPrecision } : {}) },
      reason: promote
        ? `promote: rule '${candidate.id}' passed all checks`
        : `reject: rule '${candidate.id}' failed [${failed.join(', ')}]`,
    }
  } finally {
    if (priorEmergent === undefined) delete process.env.EMERGENT
    else process.env.EMERGENT = priorEmergent
  }
}
