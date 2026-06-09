// rule_authoring/api_call_promote_gate — deterministic referee for an agent-authored api_call (HTTP
// client) rule. It REUSES the engine's normalizeInternalPathTarget so the captured endpoint is exactly
// what build_service_map will normalize + match to a backend route. Detection is import-based so a NEW
// client can be graded. canonicalTarget = `METHOD endpoint`. See spec.

import type { BuildRelationsInputs, SemanticIndex, ExtractedRelation } from '../types.js'
import { normalizeInternalPathTarget } from '../resolvers/api_call.js'
import type {
  ApiCallRuleCandidate,
  ApiCallPromotionInput,
  ApiCallPromotionVerdict,
} from './api_call_types.js'

interface Match {
  edgeId: number
  canonical: string
}

function clientImportFiles(inputs: BuildRelationsInputs, index: SemanticIndex, packages: string[]): Set<string> {
  const want = new Set(packages)
  const files = new Set<string>()
  for (const edge of inputs.edges) {
    if (edge.relation !== 'imports' || !edge.targetSpecifier || !want.has(edge.targetSpecifier)) continue
    const fp = index.nodesById.get(edge.sourceId)?.filePath
    if (fp) files.add(fp)
  }
  return files
}

/** F3+F4: client-method calls to an INTERNAL endpoint, resolved to `METHOD path`. External URLs skipped. */
function runDetect(
  candidate: ApiCallRuleCandidate,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
  clientFiles: Set<string>,
): Match[] {
  const out: Match[] = []
  for (const node of inputs.nodes) {
    if (!node.filePath || !clientFiles.has(node.filePath)) continue
    for (const call of index.callsBySource.get(node.id) ?? []) {
      const method = call.targetSymbol ? candidate.methodBySymbol[call.targetSymbol] : undefined
      if (!method || typeof call.id !== 'number') continue
      const endpoint = call.firstArg
      // only INTERNAL endpoints (the ones build_service_map connects to backend routes)
      if (!endpoint || !endpoint.startsWith('/')) continue
      const normalized = normalizeInternalPathTarget(endpoint)
      if (!normalized) continue
      out.push({ edgeId: call.id, canonical: `${method} ${normalized}` })
    }
  }
  return out
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

/** The minimal data a promoted api_call rule needs to fire in production (subset of ApiCallRuleCandidate). */
export interface ApiCallEmitRule {
  clientLabel: string
  clientPackages: string[]
  methodBySymbol: Record<string, string>
}

/**
 * Production consumption: emit the api_call relations a promoted rule produces. Reuses the referee's
 * detection (clientImportFiles + methodBySymbol + normalizeInternalPathTarget), so it captures the full
 * internal endpoint (METHOD + path) build_service_map normalizes + connects to backend routes. External
 * URLs are skipped (same as the referee).
 */
export function emitApiCallRelationsForRule(
  rule: ApiCallEmitRule,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): ExtractedRelation[] {
  const files = clientImportFiles(inputs, index, rule.clientPackages)
  const out: ExtractedRelation[] = []
  for (const node of inputs.nodes) {
    if (!node.filePath || !files.has(node.filePath)) continue
    for (const call of index.callsBySource.get(node.id) ?? []) {
      const method = call.targetSymbol ? rule.methodBySymbol[call.targetSymbol] : undefined
      if (!method || typeof call.id !== 'number') continue
      const endpoint = call.firstArg
      if (!endpoint || !endpoint.startsWith('/')) continue
      const normalized = normalizeInternalPathTarget(endpoint)
      if (!normalized) continue
      out.push({
        sourceNodeId: node.id,
        kind: 'api_call',
        target: normalized,
        operation: method,
        canonicalTarget: `${method} ${normalized}`,
        payload: { client: rule.clientLabel, method, endpoint: normalized, promotedRuleClient: rule.clientLabel },
        evidenceNodeIds: [`edge:${call.id}`],
        confidence: 'high',
      })
    }
  }
  return out
}

/** Public: run the rule end-to-end over real inputs. */
export function runApiCallRule(
  candidate: ApiCallRuleCandidate,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): { matchedEdgeIds: number[]; canonicalTargets: string[] } {
  const matches = runDetect(candidate, inputs, index, clientImportFiles(inputs, index, candidate.clientPackages))
  return {
    matchedEdgeIds: uniq(matches.map((m) => m.edgeId)),
    canonicalTargets: uniq(matches.map((m) => m.canonical)),
  }
}

export function evaluateApiCallRuleForPromotion(input: ApiCallPromotionInput): ApiCallPromotionVerdict {
  const { candidate, anchorInputs, anchorIndex, foreignInputs } = input

  const clientPackagesNonEmpty = {
    pass: candidate.clientPackages.length > 0,
    detail: candidate.clientPackages.length > 0
      ? `gated on [${candidate.clientPackages.join(', ')}]`
      : 'clientPackages is empty — rule would fire in every repo',
  }

  const anchorFiles = clientImportFiles(anchorInputs, anchorIndex, candidate.clientPackages)
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
        ? 'no anchorEvidenceEdgeIds declared — cite the api-call edges the rule catches'
        : missing.length === 0
          ? `reproduced all ${candidate.anchorEvidenceEdgeIds.length} anchor edge(s)`
          : `missed anchor edge(s): ${missing.join(', ')}`,
  }

  const withheld = runDetect(candidate, anchorInputs, anchorIndex, new Set())
  const evidenceGate = {
    pass: withheld.length === 0,
    candidatesWithEvidenceWithheld: withheld.length,
    detail: withheld.length === 0
      ? 'detects nothing once its client imports are withheld'
      : `still detects ${withheld.length} call(s) without its import evidence — not self-gating`,
  }

  const polluted: { fixture: string; count: number }[] = []
  for (const fg of foreignInputs) {
    const files = clientImportFiles(fg.inputs, fg.index, candidate.clientPackages)
    const m = runDetect(candidate, fg.inputs, fg.index, files)
    if (m.length > 0) polluted.push({ fixture: fg.fixture, count: m.length })
  }
  const crossClientClean = {
    pass: polluted.length === 0,
    polluted,
    detail: polluted.length === 0
      ? `clean on ${foreignInputs.length} foreign repo(s)`
      : `pollutes ${polluted.length} foreign repo(s): ${polluted.map((p) => `${p.fixture}(${p.count})`).join(', ')}`,
  }

  let anchorEndpointPrecision: ApiCallPromotionVerdict['checks']['anchorEndpointPrecision']
  if (candidate.anchorExpectedCanonical) {
    const expected = new Set(candidate.anchorExpectedCanonical)
    const produced = uniq(matches.map((m) => m.canonical))
    const overfired = produced.filter((c) => !expected.has(c))
    anchorEndpointPrecision = {
      pass: overfired.length === 0,
      overfired,
      detail: overfired.length === 0
        ? 'every captured endpoint is in the anchor answer-key'
        : `captured ${overfired.length} endpoint(s) outside the answer-key: ${overfired.join(', ')}`,
    }
  }

  const promote =
    clientPackagesNonEmpty.pass &&
    anchorReproduction.pass &&
    evidenceGate.pass &&
    crossClientClean.pass &&
    (anchorEndpointPrecision?.pass ?? true)

  const failed = [
    !clientPackagesNonEmpty.pass && 'clientPackagesNonEmpty',
    !anchorReproduction.pass && 'anchorReproduction',
    !evidenceGate.pass && 'evidenceGate',
    !crossClientClean.pass && 'crossClientClean',
    anchorEndpointPrecision && !anchorEndpointPrecision.pass && 'anchorEndpointPrecision',
  ].filter(Boolean)

  return {
    promote,
    checks: { clientPackagesNonEmpty, anchorReproduction, evidenceGate, crossClientClean, ...(anchorEndpointPrecision ? { anchorEndpointPrecision } : {}) },
    reason: promote
      ? `promote: api_call rule '${candidate.id}' passed all checks`
      : `reject: api_call rule '${candidate.id}' failed [${failed.join(', ')}]`,
  }
}
