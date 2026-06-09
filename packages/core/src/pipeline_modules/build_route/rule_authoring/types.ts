// rule_authoring — agent-authored route rules + the deterministic promote gate (axis 2 / step 5).
// See specs/build_route/agent-route-rule-loop.md.

import type { GraphIndex } from '../graph_index.js'
import type { EntrypointRule, NestedExpr, SelectExpr } from '../types.js'

export type EntrypointKind = EntrypointRule['kind']

/**
 * What the agent emits when it discovers a route pattern. It IS an EntrypointRule (the strong DSL
 * the engine runs) plus provenance, so promotion is a drop-in registration — no shape translation.
 */
export interface RouteAdapterRuleCandidate {
  /** unique, mandatory — an anonymous rule can't be attributed or gated. */
  id: string
  /** LABEL only — never a gate. */
  framework: string
  kind: EntrypointKind
  /** the graph query the engine runs. */
  select: SelectExpr
  /** ${placeholder} templates → entry columns (http_method, path, handler_node_id, …). */
  extract: Record<string, string>
  /** optional recursive child rule (e.g. react <Route> nesting). */
  nested?: NestedExpr
  /**
   * NON-EMPTY evidence self-gate: the package specifier(s) that must be imported in the repo for this
   * rule to fire. Injected into select.requires_import at execution time. Empty → rejected.
   */
  requiresImport: string[]
  /** corpus fixture id the rule was derived from. */
  anchorFixture: string
  /** the specific edge ids the agent CLAIMS this rule should catch on the anchor graph. */
  anchorEdgeIds: number[]
  /** human-readable evidence summary. */
  support: { matched: number; examplePaths: string[] }
}

export interface CheckResult {
  pass: boolean
  detail: string
}

export interface PromotionInput {
  candidate: RouteAdapterRuleCandidate
  /** build_graph of anchorFixture. */
  anchorGraph: GraphIndex
  /** other-framework repos that do NOT import requiresImport — used to prove no pollution. */
  foreignGraphs: { fixture: string; graph: GraphIndex }[]
  /** optional precision oracle: trustworthy route keys ("METHOD path", lowercased) for the anchor. */
  anchorExpectedRouteKeys?: string[]
  /** repoId passed to the engine (default 'r1'). */
  repoId?: string
}

export interface PromotionVerdict {
  promote: boolean
  checks: {
    requiresImportNonEmpty: CheckResult
    anchorReproduction: CheckResult & { expected: number[]; got: number[]; missing: number[] }
    evidenceGate: CheckResult & { entriesWithEvidenceWithheld: number }
    crossFrameworkClean: CheckResult & { polluted: { fixture: string; count: number }[] }
    anchorPrecision?: CheckResult & { overfired: string[] }
  }
  reason: string
}
