// Navigation + external_link candidate extractor
// SOT: specs/build_relations/architecture.md §5.3 §5.4

import type { BuildRelationsInputs, CodeEdgeLike, CodeNodeLike, SemanticIndex, RelationCandidate } from '../types.js'
import { relationCandidateAdapters } from '../adapters/registry.js'
import { resolveFirstArgsFromSource } from '../source_call_args.js'

const INTERNAL_PATH_RE = /^\/[^/]/
const IDENTIFIER_RE = /^[A-Za-z_$][\w.$]*$/

export function extractNavigationCandidates(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  const candidates: RelationCandidate[] = []

  for (const node of inputs.nodes) {
    // ── calls edge 기반 네비게이션 ─────────────────────────
    for (const callEdge of (index.callsBySource.get(node.id) ?? [])) {
      const method = callEdge.targetSymbol
      if (!method) continue

      for (const hydratedEdge of withSourceFirstArgVariants(inputs, node, callEdge)) {
        const adapterCandidate = matchNavigationAdapterCandidate(hydratedEdge, node.id, inputs, index)
        if (adapterCandidate) {
          candidates.push(adapterCandidate)
        }
      }
    }
  }

  return candidates
}

function matchNavigationAdapterCandidate(
  callEdge: CodeEdgeLike,
  sourceNodeId: string,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate | null {
  for (const adapter of relationCandidateAdapters) {
    if (adapter.relationKind !== 'navigation' && adapter.relationKind !== 'external_link') continue
    const candidate = adapter.matchCall(callEdge, sourceNodeId, { inputs, index, maxTraceHops: 5 })
    if (candidate) return candidate
  }
  return null
}

function withSourceFirstArgVariants(
  inputs: BuildRelationsInputs,
  node: CodeNodeLike,
  edge: CodeEdgeLike,
): CodeEdgeLike[] {
  const firstArgs = resolveFirstArgsFromSource(inputs, node, edge)
  return firstArgs.length > 0 ? firstArgs.map((firstArg) => ({ ...edge, firstArg })) : [edge]
}

export { IDENTIFIER_RE, INTERNAL_PATH_RE }
