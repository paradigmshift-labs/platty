// rule_authoring/anchor_binding — the PURE, LLM-FREE anchor binder. Given an authored candidate (a relation
// rule whose packages+methods are already chosen), it binds candidate.anchorEvidenceEdgeIds from the REAL call
// edges in this repo so the referee's anchorReproduction grades the rule against actual graph evidence — the
// agent (the dsl-build skill) authors only packages+methods+(query); the code binds the anchor.
//
// This is the deterministic edge-binding extracted out of llm_relation_rule_author.ts's bindAnchorToRepo, with
// the LLM/gap/ctx-prompt bits removed: instead of a gap's file list, the relevant files are derived from the
// candidate's OWN packages (the import specifiers) — the same file set the referees use. NO LLM, NO prompt.

import type { BuildRelationsInputs, SemanticIndex } from '../types.js'
import type { AuthoredRelationRule } from './autonomous_loop.js'
import { runApiCallRule } from './api_call_promote_gate.js'
import { isValidGraphQuery } from '@/pipeline_modules/graph_query/index.js'

/** The npm packages a candidate is gated by (the import specifiers), keyed off its kind. */
function candidatePackages(authored: AuthoredRelationRule): string[] {
  if (authored.kind === 'external_service') return authored.candidate.packages
  return authored.candidate.clientPackages
}

/** Files that import any of the candidate's packages — where its calls live (mirrors the referees' file gate). */
function importFilesForPackages(packages: string[], inputs: BuildRelationsInputs, index: SemanticIndex): Set<string> {
  const want = new Set(packages)
  const files = new Set<string>()
  for (const edge of inputs.edges) {
    if (edge.relation !== 'imports' || !edge.targetSpecifier || !want.has(edge.targetSpecifier)) continue
    const fp = index.nodesById.get(edge.sourceId)?.filePath
    if (fp) files.add(fp)
  }
  return files
}

/**
 * Bind the candidate's anchor to THIS repo deterministically: set anchorEvidenceEdgeIds to the call edges (in
 * the files that import the candidate's packages) whose method the rule names, so the referee's
 * anchorReproduction grades against real edges. Also CLEAR anchorExpectedCanonical — we trust the graph, not a
 * predicted canonical (the grounded checks anchorReproduction + evidenceGate + crossClean validate the rule).
 * Pure: no LLM, no prompt, no gap context — just the deterministic edge binding.
 */
export function bindCandidateAnchor(
  authored: AuthoredRelationRule,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): AuthoredRelationRule {
  if (authored.kind === 'api_call') {
    // GROUND the api_call anchor by RUNNING the rule: bind only the edges it actually reproduces (internal
    // `/path` calls). A method-name heuristic over-binds, because build_graph leaves template-literal /
    // variable call args as firstArg=null and runDetect skips those — so binding every get/post call makes
    // anchorReproduction false-reject. Running the rule also catches a wrong clientPackages (it reproduces
    // nothing → rejected).
    authored.candidate.anchorEvidenceEdgeIds = runApiCallRule(authored.candidate, inputs, index).matchedEdgeIds
    authored.candidate.anchorExpectedCanonical = undefined
    return authored
  }
  // An authored modelQuery is UNTRUSTED — drop a malformed one (fall back to the default traversal) so the
  // bounded interpreter never runs a bad query. A valid one is then graded by anchorReproduction.
  if (authored.kind === 'db_access' && authored.candidate.modelQuery !== undefined && !isValidGraphQuery(authored.candidate.modelQuery)) {
    authored.candidate.modelQuery = undefined
  }
  const files = importFilesForPackages(candidatePackages(authored), inputs, index)
  const named = new Set(
    authored.kind === 'external_service' ? authored.candidate.methods
    : Object.keys(authored.candidate.operationByMethod),
  )
  const edgeIds: number[] = []
  for (const node of inputs.nodes) {
    if (!node.filePath || !files.has(node.filePath)) continue
    for (const call of index.callsBySource.get(node.id) ?? []) {
      if (call.targetSymbol && named.has(call.targetSymbol) && typeof call.id === 'number') edgeIds.push(call.id)
    }
  }
  authored.candidate.anchorEvidenceEdgeIds = [...new Set(edgeIds)]
  authored.candidate.anchorExpectedCanonical = undefined
  return authored
}
