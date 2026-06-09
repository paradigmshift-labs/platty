// build_route/rule_authoring — the autonomous loop: route gaps (entry points the current rules missed,
// surfaced as the engine's SuspectedNode[]) → an agent authors a RouteAdapterRuleCandidate → the
// deterministic referee (evaluateRouteRuleForPromotion) executes it on the repo graph → auto-promote the
// passers. Mirrors build_relations/build_models autonomous loops; the author is pluggable (real = an LLM,
// tests = a stub) so the orchestration is deterministic + testable.

import type { GraphIndex } from '../graph_index.js'
import type { SuspectedNode } from '../types.js'
import { evaluateRouteRuleForPromotion } from './promote_gate.js'
import type { RouteAdapterRuleCandidate } from './types.js'

/** An entry point the current rules missed — derived from the engine's suspected nodes (post F3+F4). */
export interface RouteGap {
  reason: SuspectedNode['reason']
  nodeId: string
  filePath?: string
  contextHint?: 'window' | 'file'
  /** the adapter/framework that flagged it (a hint for the author). */
  adapter: string
}

/** Enumerate route gaps from the engine's suspected set, enriched with the node's file path. */
export function findRouteGaps(suspected: SuspectedNode[], graph: GraphIndex): RouteGap[] {
  return suspected.map((s) => ({
    reason: s.reason,
    nodeId: s.nodeId,
    filePath: graph.getNode(s.nodeId)?.filePath ?? undefined,
    contextHint: s.contextHint,
    adapter: s.adapter,
  }))
}

export interface RouteRuleAuthorContext {
  graph: GraphIndex
  repoId: string
}

/** Pluggable author: given a gap, returns a candidate rule (or null to skip). Real impl calls an LLM agent. */
export type RouteRuleAuthor = (gap: RouteGap, ctx: RouteRuleAuthorContext) => Promise<RouteAdapterRuleCandidate | null>

export interface RouteDiscoveryInput {
  graph: GraphIndex
  repoId: string
  /** suspected nodes from a prior build_route engine run (the gap source). */
  suspected: SuspectedNode[]
  /** other-framework graphs for the referee's cross-clean check. */
  foreignGraphs?: { fixture: string; graph: GraphIndex }[]
  /** rule ids already promoted (dedup). */
  knownRuleIds?: string[]
  authorCandidate: RouteRuleAuthor
}

export interface RouteDiscoveryResult {
  gaps: RouteGap[]
  promoted: RouteAdapterRuleCandidate[]
  rejected: { ruleId: string; reason: string }[]
}

/**
 * gap → author → referee → promote. The referee runs the candidate through the REAL engine on the repo
 * graph (anchorReproduction + evidenceGate + crossFrameworkClean), so a promoted rule provably fires. The
 * known-id set grows within the batch so re-authoring the same framework rule is rejected as a duplicate.
 */
export async function runRouteRuleDiscovery(input: RouteDiscoveryInput): Promise<RouteDiscoveryResult> {
  const gaps = findRouteGaps(input.suspected, input.graph)
  const promoted: RouteAdapterRuleCandidate[] = []
  const rejected: { ruleId: string; reason: string }[] = []
  const knownIds = new Set(input.knownRuleIds ?? [])

  for (const gap of gaps) {
    const candidate = await input.authorCandidate(gap, { graph: input.graph, repoId: input.repoId })
    if (!candidate) continue
    if (knownIds.has(candidate.id)) {
      rejected.push({ ruleId: candidate.id, reason: 'duplicate_id' })
      continue
    }
    const verdict = await evaluateRouteRuleForPromotion({
      candidate, anchorGraph: input.graph, foreignGraphs: input.foreignGraphs ?? [], repoId: input.repoId,
    })
    if (verdict.promote) {
      promoted.push(candidate)
      knownIds.add(candidate.id)
    } else {
      rejected.push({ ruleId: candidate.id, reason: verdict.reason })
    }
  }

  return { gaps, promoted, rejected }
}
