// rule_authoring/api_call_types — agent-authored api_call (HTTP client) rules + verdict types (slice 3).
// An api_call relation captures the called ENDPOINT (METHOD + internal path) so build_service_map can
// normalize it and connect it to the backend route (the build_route entry point that serves it).

import type { BuildRelationsInputs, SemanticIndex } from '../types.js'

/**
 * What an agent emits for an HTTP client (axios/got/ky/… or a NEW one). The rule supplies which packages
 * signal the client and how each call method maps to an HTTP verb; the endpoint is read from the call's
 * first argument and normalized by the engine's shared normalizer (`/users/${id}` → `/users/:id`).
 */
export interface ApiCallRuleCandidate {
  id: string
  /** the client label (e.g. 'axios') — LABEL only. */
  clientLabel: string
  /** HTTP-client npm package specifier(s) — detection + NON-EMPTY evidence gate. */
  clientPackages: string[]
  /** call method (targetSymbol) → HTTP verb, e.g. { get: 'GET', post: 'POST' }. */
  methodBySymbol: Record<string, string>
  anchorFixture: string
  /** the call-edge ids the rule CLAIMS to catch (evidence). */
  anchorEvidenceEdgeIds: number[]
  /** optional precision oracle: canonicalTargets, e.g. 'GET /api/users' (METHOD + endpoint). */
  anchorExpectedCanonical?: string[]
  support: { matched: number; examples: string[] }
}

export interface CheckResult {
  pass: boolean
  detail: string
}

export interface ApiCallPromotionInput {
  candidate: ApiCallRuleCandidate
  anchorInputs: BuildRelationsInputs
  anchorIndex: SemanticIndex
  /** other repos that do NOT import the candidate's clientPackages — used to prove no pollution. */
  foreignInputs: { fixture: string; inputs: BuildRelationsInputs; index: SemanticIndex }[]
}

export interface ApiCallPromotionVerdict {
  promote: boolean
  checks: {
    clientPackagesNonEmpty: CheckResult
    anchorReproduction: CheckResult & { expected: number[]; got: number[]; missing: number[] }
    evidenceGate: CheckResult & { candidatesWithEvidenceWithheld: number }
    crossClientClean: CheckResult & { polluted: { fixture: string; count: number }[] }
    /** the user's key concern: the captured ENDPOINT (METHOD + path) must match the answer-key. */
    anchorEndpointPrecision?: CheckResult & { overfired: string[] }
  }
  reason: string
}
