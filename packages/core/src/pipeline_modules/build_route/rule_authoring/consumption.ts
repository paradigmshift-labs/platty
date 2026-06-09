// build_route/rule_authoring — make the live route engine CONSUME loop-promoted route rules. Mirrors
// build_models' composeModelAdapterRegistry / build_relations' composeRelationRuleContext: hard-coded
// adapters win, promoted rules fire ONLY for frameworks whose import specifiers the hard-coded registry
// doesn't already cover (so existing repos are unchanged; a NEW framework gains routes). A promoted rule is
// wrapped as a synthetic single-rule adapter (candidateToAdapter) that self-gates on requiresImport, then
// appended to the engine's adapter list before F3.

import { REGISTRY } from '../adapters/index.js'
import type { LoadedAdapter } from '../f2_load_adapters.js'
import { candidateToAdapter, loaded } from './promote_gate.js'
import type { RouteAdapterRuleCandidate } from './types.js'

/** Import specifiers the hard-coded route adapters already detect — used to strip duplicate promoted rules. */
function hardCodedRouteImportSpecifiers(): Set<string> {
  const set = new Set<string>()
  for (const adapter of Object.values(REGISTRY)) {
    for (const spec of adapter.detection?.importSpecifiers ?? []) set.add(spec)
  }
  return set
}

/**
 * Build the synthetic adapters for promoted route rules whose framework the hard-coded engine doesn't
 * cover. A rule is kept only if ALL its requiresImport are novel (none hard-coded) — the "hard-coded wins,
 * no double-emit" invariant. The current compiled-in rulebook (fastify/nestjs/react/flutter) duplicates the
 * hard-coded adapters, so it strips to empty and existing output is unchanged.
 */
export function composeRoutePromotedAdapters(opts: { promoted?: RouteAdapterRuleCandidate[] } = {}): LoadedAdapter[] {
  const covered = hardCodedRouteImportSpecifiers()
  const out: LoadedAdapter[] = []
  for (const rule of opts.promoted ?? []) {
    if (rule.requiresImport.length === 0) continue
    if (!rule.requiresImport.every((p) => !covered.has(p))) continue // any import hard-coded → skip (no double-emit)
    out.push(loaded(candidateToAdapter(rule)))
  }
  return out
}
