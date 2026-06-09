// API call candidate extractor
// SOT: specs/build_relations/architecture.md §5.2

import type { BuildRelationsInputs, CodeEdgeLike, CodeNodeLike, SemanticIndex, RelationCandidate } from '../types.js'
import { relationCandidateAdapters } from '../adapters/registry.js'
import { resolveFirstArgsFromSource } from '../source_call_args.js'

// URL 패턴
const INTERNAL_PATH_RE = /^\/[^/]/  // /api/orders, /profile 등
const EXTERNAL_URL_RE = /^https?:\/\//

export function extractApiCallCandidates(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  const candidates: RelationCandidate[] = []

  for (const node of inputs.nodes) {
    // ── calls edge: axios.post, fetch, etc. ──────────────
    for (const callEdge of (index.callsBySource.get(node.id) ?? [])) {
      const method = callEdge.targetSymbol
      if (!method) continue

      for (const hydratedEdge of withSourceFirstArgVariants(inputs, node, callEdge)) {
        const adapterCandidate = matchApiAdapterCandidate(hydratedEdge, node.id, inputs, index)
        if (adapterCandidate) {
          candidates.push(adapterCandidate)
        }
      }
    }

    // ── renders edge: form action ─────────────────────────
    for (const renderEdge of (index.rendersBySource.get(node.id) ?? [])) {
      if (renderEdge.targetSymbol !== 'form') continue
      const action = renderEdge.firstArg
      if (!action || EXTERNAL_URL_RE.test(action)) continue
      if (!INTERNAL_PATH_RE.test(action)) continue  // 상대경로 등 skip

      let formMethod = 'POST'  // HTML form 기본값
      if (renderEdge.literalArgs) {
        try {
          const args = JSON.parse(renderEdge.literalArgs) as unknown[]
          if (Array.isArray(args) && typeof args[0] === 'string') {
            formMethod = (args[0] as string).toUpperCase()
          }
        } catch { /* ignore malformed */ }
      }

      candidates.push({
        kind: 'api_call',
        sourceNodeId: node.id,
        evidenceNodeIds: [`edge:${renderEdge.id}`],
        chainPath: null,
        firstArg: action,
        rawTarget: action,
        payload: { method: formMethod, protocol: 'form_action', anchor: 'form' },
      })
    }
  }

  return candidates
}

function matchApiAdapterCandidate(
  callEdge: CodeEdgeLike,
  sourceNodeId: string,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate | null {
  for (const adapter of relationCandidateAdapters) {
    if (adapter.relationKind !== 'api_call') continue
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
