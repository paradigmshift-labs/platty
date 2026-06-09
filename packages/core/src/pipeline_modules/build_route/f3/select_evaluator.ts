// f3/select_evaluator — rule.select 표현식 평가 (architecture.md §4.3).
// 단위 함수 — 한 SelectExpr를 GraphIndex 위에서 평가하여 candidate 노드 추출.

import type { CodeEdge } from '@/db/schema/code_graph.js'
import type { GraphIndex } from '../graph_index.js'
import type { SelectCandidate, SelectExpr } from '../types.js'
import { evaluateEvidence } from '../evidence_predicate.js'
import { emergentRoutingEnabled } from '../emergent_flag.js'

export function evaluateSelect(expr: SelectExpr, graph: GraphIndex): SelectCandidate[] {
  // requires_import — emergent-DSL evidence self-gate, applied to EVERY select path (must be FIRST:
  // the enclosing_class_decorated_by branch returns early, so a gate placed only on the edge-based
  // path below would silently skip decorator rules — they'd fire without their declared evidence).
  // `requires_import: [...]` means "this rule only fires when the repo depends on one of these
  // packages" — REPO-level, not per-file (an `app.get('/x')` route lives in a file that received `app`
  // by injection and need not import the package itself; the structural select disambiguates). Default-on
  // (emergent routing); LEGACY_ROUTING=1 falls back to the old framework gate.
  if (emergentRoutingEnabled() && expr.requires_import && expr.requires_import.length > 0) {
    const { fired } = evaluateEvidence({ any: [{ importSpecifier: expr.requires_import }] }, graph)
    if (!fired) return []
  }

  // enclosing_class_decorated_by — 별도 path (class → contains → method)
  // 추가 조건 (node_type, decorated_by, file_glob, exclude_glob, is_default_export) 도 같이 적용.
  if (expr.enclosing_class_decorated_by) {
    let candidates = evaluateEnclosingClass(expr.enclosing_class_decorated_by, graph)

    if (expr.node_type) {
      candidates = candidates.filter((c) => c.node.type === expr.node_type)
    }

    if (expr.decorated_by) {
      const set = new Set(toArray(expr.decorated_by))
      candidates = candidates
        .map((c) => ({
          ...c,
          matchedEdges: c.matchedEdges.filter(
            (edge) =>
              edge.relation === 'decorates' &&
              edge.targetSymbol !== null &&
              set.has(edge.targetSymbol),
          ),
        }))
        .filter((c) => c.matchedEdges.length > 0)
    }

    if (expr.file_glob) {
      const globIds = new Set(graph.nodesByFileGlob(toArray(expr.file_glob)).map((n) => n.id))
      candidates = candidates.filter((c) => globIds.has(c.node.id))
    }

    if (expr.exclude_glob) {
      const excludeIds = new Set(
        graph.nodesByFileGlob(toArray(expr.exclude_glob)).map((n) => n.id),
      )
      candidates = candidates.filter((c) => !excludeIds.has(c.node.id))
    }

    if (expr.is_default_export !== undefined) {
      candidates = candidates.filter(
        (c) => (c.node.isDefaultExport ?? false) === expr.is_default_export,
      )
    }

    return candidates
  }

  // ── edge-based 후보 셋 ──
  let edges: CodeEdge[] | null = null

  if (expr.relation) {
    edges = graph.edgesByRelation(expr.relation)
  }

  if (expr.decorated_by) {
    edges = edges ?? graph.edgesByRelation('decorates')
    const set = new Set(toArray(expr.decorated_by))
    edges = edges.filter((edge) => edge.targetSymbol !== null && set.has(edge.targetSymbol))
  }

  if (expr.callee?.method) {
    edges = edges ?? graph.edgesByRelation('calls')
    const set = new Set(toArray(expr.callee.method))
    edges = edges.filter((edge) => edge.targetSymbol !== null && set.has(edge.targetSymbol))
  }

  if (expr.callee?.symbol) {
    edges = edges ?? graph.edgesByRelation('calls')
    const set = new Set(toArray(expr.callee.symbol))
    edges = edges.filter((edge) => edge.targetSymbol !== null && set.has(edge.targetSymbol))
  }

  if (expr.callee?.chain_path_root_in) {
    edges = edges ?? graph.edgesByRelation('calls')
    const roots = expr.callee.chain_path_root_in
    edges = edges.filter((edge) => {
      if (!edge.chainPath) return false
      const root = edge.chainPath.split('.')[0]
      return roots.includes(root)
    })
  }

  if (expr.first_arg?.kind === 'string_literal') {
    edges = edges ?? graph.getAllEdges()
    edges = edges.filter((edge) => edge.firstArg !== null && edge.firstArg !== undefined)
  }

  // min_arg_count — emergent-mode call-arity gate. A real route call carries a handler
  // (`app.get('/x', handler)` → literalArgs ["/x", null], len 2); a settings getter does not
  // (`app.get('env')` → ["env"], len 1). Conservative: keep edges whose literalArgs is null/unparseable.
  if (emergentRoutingEnabled() && typeof expr.min_arg_count === 'number') {
    const min = expr.min_arg_count
    edges = (edges ?? graph.getAllEdges()).filter((edge) => {
      const len = parsedArgCount(edge.literalArgs)
      return len === null || len >= min
    })
  }

  // (requires_import self-gate is applied at the top of evaluateSelect — covers every select path.)

  // ── node 후보 셋 ──
  let nodeIds: Set<string> | null = null
  if (edges !== null) {
    nodeIds = new Set(edges.map((edge) => edge.sourceId))
  }

  if (expr.file_glob) {
    const globIds = new Set(graph.nodesByFileGlob(toArray(expr.file_glob)).map((node) => node.id))
    nodeIds = nodeIds ? intersect(nodeIds, globIds) : globIds
  }

  if (expr.node_type) {
    const typeIds = new Set(graph.nodesByType(expr.node_type).map((node) => node.id))
    nodeIds = nodeIds ? intersect(nodeIds, typeIds) : typeIds
  }

  if (expr.exclude_glob && nodeIds) {
    const excludeIds = new Set(
      graph.nodesByFileGlob(toArray(expr.exclude_glob)).map((node) => node.id),
    )
    nodeIds = new Set([...nodeIds].filter((id) => !excludeIds.has(id)))
  }

  if (expr.is_default_export !== undefined) {
    const required = expr.is_default_export
    const matchingIds = new Set(
      graph.getAllNodes()
        .filter((node) => (node.isDefaultExport ?? false) === required)
        .map((node) => node.id),
    )
    nodeIds = nodeIds ? intersect(nodeIds, matchingIds) : matchingIds
  }

  if (!nodeIds) return []

  return buildCandidates(nodeIds, edges, graph)
}

// ────────────────────────────────────────
// helpers
// ────────────────────────────────────────

function evaluateEnclosingClass(symbol: string, graph: GraphIndex): SelectCandidate[] {
  const decorEdges = graph
    .edgesByRelation('decorates')
    .filter((edge) => edge.targetSymbol === symbol)
  const classIds = new Set(decorEdges.map((edge) => edge.sourceId))
  if (classIds.size === 0) return []

  const containEdges = graph
    .edgesByRelation('contains')
    .filter((edge) => classIds.has(edge.sourceId))

  const out: SelectCandidate[] = []
  for (const containEdge of containEdges) {
    if (!containEdge.targetId) continue
    const node = graph.getNode(containEdge.targetId)
    if (!node) continue
    // candidate.matchedEdges 는 method 자체의 decorates edges.
    // (class decorator 정보는 enclosing_class.X.first_arg placeholder 가 graph 에서 직접 lookup — 후속.)
    const methodDecorates = graph
      .outgoingEdges(node.id)
      .filter((edge) => edge.relation === 'decorates')
    out.push({ node, matchedEdges: methodDecorates })
  }
  return out
}

function buildCandidates(
  nodeIds: Set<string>,
  edges: CodeEdge[] | null,
  graph: GraphIndex,
): SelectCandidate[] {
  const out: SelectCandidate[] = []
  if (edges) {
    for (const edge of edges) {
      if (!nodeIds.has(edge.sourceId)) continue
      const node = graph.getNode(edge.sourceId)
      if (!node) continue
      out.push({ node, matchedEdges: [edge] })
    }
    return out
  }

  for (const id of nodeIds) {
    const node = graph.getNode(id)
    /* v8 ignore next -- nodeIds are built from graph lookups; this is defensive for custom GraphIndex implementations. */
    if (!node) continue
    out.push({ node, matchedEdges: [] })
  }
  return out
}

function toArray<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v]
}

/** Number of call arguments recorded in an edge's literalArgs JSON array, or null if absent/unparseable. */
function parsedArgCount(literalArgs: string | null | undefined): number | null {
  if (!literalArgs) return null
  try {
    const parsed = JSON.parse(literalArgs) as unknown
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}

function intersect<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>()
  for (const v of a) if (b.has(v)) out.add(v)
  return out
}
