// rule_authoring/promote_gate — deterministic, LLM-free referee that admits an agent-authored
// external_service vendor rule. It runs a self-contained, faithful F3 (detect) → F4 (resolve) matcher
// over the anchor's BuildRelationsInputs/SemanticIndex (NOT the global vendor registries, so it can
// grade a NEW vendor) and checks the result against graph facts.
// See specs/build_relations/agent-relation-rule-loop.md §2.

import type { BuildRelationsInputs, SemanticIndex, ExtractedRelation } from '../types.js'
import type {
  ExternalServiceRuleCandidate,
  RelationPromotionInput,
  RelationPromotionVerdict,
} from './types.js'

interface Match {
  edgeId: number
  method: string
  sourceNodeId: string
}

/** File paths that import one of `packages` (the file-import detection path of services.ts). */
function vendorImportFiles(inputs: BuildRelationsInputs, index: SemanticIndex, packages: string[]): Set<string> {
  const want = new Set(packages)
  const files = new Set<string>()
  for (const edge of inputs.edges) {
    if (edge.relation !== 'imports' || !edge.targetSpecifier || !want.has(edge.targetSpecifier)) continue
    const fp = index.nodesById.get(edge.sourceId)?.filePath
    if (fp) files.add(fp)
  }
  return files
}

/** F3: calls in a vendor-importing file whose method is one the rule names. `vendorFiles` empty → none. */
function runDetect(
  candidate: ExternalServiceRuleCandidate,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
  vendorFiles: Set<string>,
): Match[] {
  const out: Match[] = []
  for (const node of inputs.nodes) {
    if (!node.filePath || !vendorFiles.has(node.filePath)) continue
    for (const call of index.callsBySource.get(node.id) ?? []) {
      if (!call.targetSymbol || typeof call.id !== 'number') continue
      const method = matchedPattern(candidate, call.targetSymbol, call.chainPath)
      if (method) out.push({ edgeId: call.id, method, sourceNodeId: node.id })
    }
  }
  return out
}

/** Does the call's chainPath end with the dotted `suffix` (segment-wise)? e.g. 'client.charges' ⊇ 'charges'. */
function chainEndsWith(chainPath: string | null | undefined, suffix: string): boolean {
  if (!chainPath) return false
  const cs = chainPath.split('.')
  const ss = suffix.split('.')
  if (ss.length > cs.length) return false
  return ss.every((seg, i) => cs[cs.length - ss.length + i] === seg)
}

/**
 * Which rule method-pattern (if any) does this call match? A bare pattern `capture` matches
 * targetSymbol==='capture'. A dotted pattern `charges.create` (namespaced SDK, e.g. stripe.charges.create)
 * matches targetSymbol==='create' AND a chainPath ending in '…charges' — so the shared `create` verb is
 * disambiguated by the resource namespace in the chain. Returns the matched PATTERN (the resolve key).
 */
function matchedPattern(candidate: ExternalServiceRuleCandidate, targetSymbol: string, chainPath: string | null | undefined): string | null {
  for (const pattern of candidate.methods) {
    const dot = pattern.lastIndexOf('.')
    if (dot === -1) {
      if (targetSymbol === pattern) return pattern
    } else if (targetSymbol === pattern.slice(dot + 1) && chainEndsWith(chainPath, pattern.slice(0, dot))) {
      return pattern
    }
  }
  return null
}

/** F4: resolve a matched method to its canonicalTarget, or null (no-emit) when no resource maps. */
function resolveCanonical(candidate: ExternalServiceRuleCandidate, method: string): string | null {
  const resource = candidate.resolve.resourceByMethod[method]
  if (!resource) return null
  return `external_service:${candidate.label}:${resource}`
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

/** The minimal data a promoted external_service rule needs to fire in production (subset of the candidate). */
export interface ExternalServiceEmitRule {
  label: string
  packages: string[]
  methods: string[]
  resolve: { resourceByMethod: Record<string, string>; operationByMethod: Record<string, string> }
}

/**
 * Production consumption: emit the external_service relations a promoted vendor rule produces. Reuses the
 * referee's runDetect (vendor-importing files + method-pattern match) + resourceByMethod, so output ==
 * what was promoted. canonicalTarget = external_service:{label}:{resource}.
 */
export function emitExternalServiceRelationsForRule(
  rule: ExternalServiceEmitRule,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): ExtractedRelation[] {
  // runDetect only reads .methods (via matchedPattern) + the import gate; the anchor fields are unused here.
  const candidate = rule as unknown as ExternalServiceRuleCandidate
  const matches = runDetect(candidate, inputs, index, vendorImportFiles(inputs, index, rule.packages))
  const out: ExtractedRelation[] = []
  for (const m of matches) {
    const resource = rule.resolve.resourceByMethod[m.method]
    if (!resource) continue
    out.push({
      sourceNodeId: m.sourceNodeId,
      kind: 'external_service',
      target: resource,
      operation: rule.resolve.operationByMethod[m.method] ?? null,
      canonicalTarget: `external_service:${rule.label}:${resource}`,
      payload: { service: rule.label, method: m.method, resource, promotedRuleLabel: rule.label },
      evidenceNodeIds: [`edge:${m.edgeId}`],
      confidence: 'high',
    })
  }
  return out
}

/** Public: run the rule end-to-end (F3→F4) over real inputs. Used by the referee, demos, and the keystone. */
export function runExternalServiceRule(
  candidate: ExternalServiceRuleCandidate,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): { matchedEdgeIds: number[]; canonicalTargets: string[] } {
  const matches = runDetect(candidate, inputs, index, vendorImportFiles(inputs, index, candidate.packages))
  return {
    matchedEdgeIds: uniq(matches.map((m) => m.edgeId)),
    canonicalTargets: uniq(matches.map((m) => resolveCanonical(candidate, m.method)).filter((c): c is string => c !== null)),
  }
}

/**
 * Deterministic promote referee for an external_service vendor rule. Five checks, each forbidding a
 * concrete failure mode; `promote` is their conjunction.
 */
export function evaluateExternalServiceRuleForPromotion(input: RelationPromotionInput): RelationPromotionVerdict {
  const { candidate, anchorInputs, anchorIndex, foreignInputs } = input

  // 1. packages non-empty
  const packagesNonEmpty = {
    pass: candidate.packages.length > 0,
    detail: candidate.packages.length > 0
      ? `gated on [${candidate.packages.join(', ')}]`
      : 'packages is empty — rule would fire in every repo',
  }

  // 2. anchor reproduction
  const anchorFiles = vendorImportFiles(anchorInputs, anchorIndex, candidate.packages)
  const matches = runDetect(candidate, anchorInputs, anchorIndex, anchorFiles)
  const got = uniq(matches.map((m) => m.edgeId))
  const missing = candidate.anchorEvidenceEdgeIds.filter((id) => !got.includes(id))
  const anchorReproduction = {
    pass: candidate.anchorEvidenceEdgeIds.length > 0 && missing.length === 0,
    expected: candidate.anchorEvidenceEdgeIds,
    got,
    missing,
    detail:
      candidate.anchorEvidenceEdgeIds.length === 0
        ? 'no anchorEvidenceEdgeIds declared — the rule must cite the call edges it claims to catch'
        : missing.length === 0
          ? `reproduced all ${candidate.anchorEvidenceEdgeIds.length} anchor edge(s)`
          : `missed anchor edge(s): ${missing.join(', ')}`,
  }

  // 3. evidence gate — withhold the vendor imports → must detect nothing
  const withheld = runDetect(candidate, anchorInputs, anchorIndex, new Set())
  const evidenceGate = {
    pass: withheld.length === 0,
    candidatesWithEvidenceWithheld: withheld.length,
    detail: withheld.length === 0
      ? 'detects nothing once its package imports are withheld'
      : `still detects ${withheld.length} call(s) without its import evidence — not self-gating`,
  }

  // 4. cross-vendor cleanliness — must not fire on repos lacking its packages
  const polluted: { fixture: string; count: number }[] = []
  for (const fg of foreignInputs) {
    const files = vendorImportFiles(fg.inputs, fg.index, candidate.packages)
    const m = runDetect(candidate, fg.inputs, fg.index, files)
    if (m.length > 0) polluted.push({ fixture: fg.fixture, count: m.length })
  }
  const crossVendorClean = {
    pass: polluted.length === 0,
    polluted,
    detail: polluted.length === 0
      ? `clean on ${foreignInputs.length} foreign repo(s)`
      : `pollutes ${polluted.length} foreign repo(s): ${polluted.map((p) => `${p.fixture}(${p.count})`).join(', ')}`,
  }

  // 5. (optional) anchor resolution precision — the resolved tuples must not exceed the answer-key
  let anchorResolutionPrecision: RelationPromotionVerdict['checks']['anchorResolutionPrecision']
  if (candidate.anchorExpectedCanonical) {
    const expected = new Set(candidate.anchorExpectedCanonical)
    const produced = uniq(matches.map((m) => resolveCanonical(candidate, m.method)).filter((c): c is string => c !== null))
    const overfired = produced.filter((c) => !expected.has(c))
    anchorResolutionPrecision = {
      pass: overfired.length === 0,
      overfired,
      detail: overfired.length === 0
        ? 'every resolved relation is in the anchor answer-key'
        : `resolved ${overfired.length} relation(s) outside the answer-key: ${overfired.join(', ')}`,
    }
  }

  const promote =
    packagesNonEmpty.pass &&
    anchorReproduction.pass &&
    evidenceGate.pass &&
    crossVendorClean.pass &&
    (anchorResolutionPrecision?.pass ?? true)

  const failed = [
    !packagesNonEmpty.pass && 'packagesNonEmpty',
    !anchorReproduction.pass && 'anchorReproduction',
    !evidenceGate.pass && 'evidenceGate',
    !crossVendorClean.pass && 'crossVendorClean',
    anchorResolutionPrecision && !anchorResolutionPrecision.pass && 'anchorResolutionPrecision',
  ].filter(Boolean)

  return {
    promote,
    checks: { packagesNonEmpty, anchorReproduction, evidenceGate, crossVendorClean, ...(anchorResolutionPrecision ? { anchorResolutionPrecision } : {}) },
    reason: promote
      ? `promote: vendor rule '${candidate.id}' passed all checks`
      : `reject: vendor rule '${candidate.id}' failed [${failed.join(', ')}]`,
  }
}
