// build_route/rule_authoring — the live runner that activates the route-rule loop on a real repo: given the
// repo graph + the engine's suspected nodes (the route gaps), run the loop with an INJECTED author, referee,
// and persist the promotions so the next runBuildRoute consumes them (composeRoutePromotedAdapters).
//
// LLM-FREE: this file no longer resolves an in-code LLM author. The DSL authoring intelligence lives OUTSIDE the
// code — the agent (the dsl-build skill) drives the deterministic `dsl` CLI (dsl_builder/) which exposes gaps,
// validates+referees an agent-authored candidate, and promotes it. The loop here stays as the deterministic
// activation primitive: it runs with whatever author is injected (a test stub, or the agent-driven dsl CLI's
// promote path) and persists promotions. See specs/refactor/llm-free-dsl-builder.md.

import type { DB } from '@/db/client.js'
import type { GraphIndex } from '../graph_index.js'
import type { SuspectedNode } from '../types.js'
import { runRouteRuleDiscovery, type RouteRuleAuthor, type RouteDiscoveryResult } from './autonomous_loop.js'
import { savePromotedRouteRules, loadPromotedRouteRules } from './persistence.js'

// NOTE: the in-code LLM author resolver (resolveLiveRouteAuthor / createLlmRouteRuleAuthor) and its env gate
// (isLiveRouteDiscoveryAllowed) were REMOVED — the codebase is LLM-free. The author is now injected (a test stub,
// or the agent-driven dsl CLI's promote path). No callSynthesizer in this import graph.

/**
 * Run the route loop on a real repo's graph + suspected set, persisting the promotions. graph + suspected
 * come from a prior build_route engine run; the author is injected (testable with a stub, or the agent-driven
 * dsl CLI's promote path).
 */
export async function runLiveRouteDiscovery(input: {
  db: DB
  repoId: string
  graph: GraphIndex
  suspected: SuspectedNode[]
  author: RouteRuleAuthor
  foreignGraphs?: { fixture: string; graph: GraphIndex }[]
  persist?: boolean
}): Promise<RouteDiscoveryResult> {
  const knownRuleIds = loadPromotedRouteRules({ db: input.db, repoId: input.repoId })?.rules.map((r) => r.id) ?? []
  const result = await runRouteRuleDiscovery({
    graph: input.graph, repoId: input.repoId, suspected: input.suspected,
    foreignGraphs: input.foreignGraphs, knownRuleIds, authorCandidate: input.author,
  })
  if (input.persist !== false && result.promoted.length > 0) {
    savePromotedRouteRules({ db: input.db, repoId: input.repoId, rules: result.promoted })
  }
  return result
}
