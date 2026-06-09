// rule_authoring — agent-authored relation rules + the deterministic promote gate (axis 3).
// First slice: external_service vendor rules. See specs/build_relations/agent-relation-rule-loop.md.

import type { BuildRelationsInputs, SemanticIndex } from '../types.js'

/**
 * What an agent emits when it discovers an external-service vendor (mixpanel/posthog/stripe/…). It is
 * the declarative form of an ExternalServiceDefinition (detection) + a ServiceResolver (resolution) +
 * anchor provenance — drop-in data, no new dispatch code.
 */
export interface ExternalServiceRuleCandidate {
  /** unique, mandatory. */
  id: string
  /** the service key (e.g. 'posthog') — LABEL only, never a gate. */
  label: string
  /** npm package specifiers — detection + NON-EMPTY evidence gate (rejected if empty). */
  packages: string[]
  /** SDK methods (call targetSymbol) that signal a relation. */
  methods: string[]
  resolve: {
    /** method → resource (serializes ServiceResolver.resourceFor). A method absent here resolves to nothing. */
    resourceByMethod: Record<string, string>
    /** method → operation (serializes ServiceResolver.operationFor). */
    operationByMethod: Record<string, string>
  }
  /** corpus fixture the rule was derived from. */
  anchorFixture: string
  /** the call-edge ids the rule CLAIMS to catch (its evidence `edge:<id>`s). */
  anchorEvidenceEdgeIds: number[]
  /** optional precision oracle: canonicalTargets, e.g. 'external_service:posthog:events'. */
  anchorExpectedCanonical?: string[]
  support: { matched: number; examples: string[] }
}

export interface CheckResult {
  pass: boolean
  detail: string
}

export interface RelationPromotionInput {
  candidate: ExternalServiceRuleCandidate
  anchorInputs: BuildRelationsInputs
  anchorIndex: SemanticIndex
  /** other repos that do NOT import the candidate's packages — used to prove no pollution. */
  foreignInputs: { fixture: string; inputs: BuildRelationsInputs; index: SemanticIndex }[]
}

export interface RelationPromotionVerdict {
  promote: boolean
  checks: {
    packagesNonEmpty: CheckResult
    anchorReproduction: CheckResult & { expected: number[]; got: number[]; missing: number[] }
    evidenceGate: CheckResult & { candidatesWithEvidenceWithheld: number }
    crossVendorClean: CheckResult & { polluted: { fixture: string; count: number }[] }
    anchorResolutionPrecision?: CheckResult & { overfired: string[] }
  }
  reason: string
}
