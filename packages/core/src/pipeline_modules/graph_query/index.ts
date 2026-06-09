// G1 — bounded (≤3 hop) declarative graph-query traversal primitive (SHARED: build_route + build_relations).
//
// The vision: a rule expresses a GRAPH QUERY as DATA — "start at the anchor, then traverse 1-3 typed edges
// (resolves_to / decorates / type_ref / calls / contains / ...), filtering along the way, to read a target
// token" — and ONE generic interpreter walks the existing code graph. This replaces hardcoded TS traversals
// (db_access receiver-tracing in build_relations; @Controller-prefix enclosing-class walk in build_route)
// without new graph infra: it consumes the adjacency the SemanticIndex / GraphIndex already expose, via a tiny
// GraphAdjacency adapter (so one interpreter serves both modules — the "universal engine" claim).
//
// Bounded by construction: steps.length ≤ MAX_STEPS, no recursion, no hop budget → cannot blow up like the
// imperative wrapper-recursion traversals it does NOT try to absorb (those stay named hooks).
// See specs/refactor/graph-query-primitive.md (G1, Option B).

export type GraphRelation =
  | 'resolves_to' | 'decorates' | 'type_ref' | 'calls' | 'contains'
  | 'type_resolved' | 'renders' | 'imports' | 'extends' | 'implements'

/** How to read a candidate token off the edge matched at the FINAL step, keyed by that edge's relation. */
export type GraphReadKind = 'firstArgToken' | 'firstArg' | 'targetSymbol' | 'targetSpecifier'

export interface GraphStep {
  /** edge relation(s) to follow this hop; an array fans out over each (e.g. ['decorates','type_ref']). */
  edge: GraphRelation | GraphRelation[]
  direction: 'out' | 'in'
  /** when true, keep only edges whose targetSymbol === the bound receiver token (the def-use receiver filter). */
  viaReceiver?: boolean
  /** keep only edges whose targetSymbol === this literal (e.g. a specific decorator name like 'Controller'). */
  viaSymbol?: string
  /** 'first' (default, deterministic) keeps one match per node; 'all' branches the frontier. */
  fanout?: 'first' | 'all'
}

export interface GraphQuery {
  /** 1..MAX_STEPS hops. The last step's matched edges are READ (per `read`); earlier steps navigate. */
  steps: GraphStep[]
  /** how to read a token off the final step's edge, keyed by the edge relation. */
  read: Partial<Record<GraphRelation, GraphReadKind>>
  /** 'known' = keep a terminal token only if adj.resolveKnown(token) succeeds (never a name guess). */
  resolveThrough?: 'known' | 'none'
}

/** The minimal edge surface the interpreter walks (subset of CodeEdge — both modules' edges satisfy it). */
export interface GraphEdgeLike {
  relation: string
  sourceId: string | null
  targetId: string | null
  targetSymbol: string | null
  targetSpecifier: string | null
  firstArg: string | null
}

/** Adjacency adapter so one interpreter serves build_relations (SemanticIndex) and build_route (GraphIndex). */
export interface GraphAdjacency {
  out(nodeId: string): readonly GraphEdgeLike[]
  in?(nodeId: string): readonly GraphEdgeLike[]
  /** terminal verifier (e.g. model→table): returns the kept token (or its mapped form) when known, else undefined. */
  resolveKnown?(token: string): string | undefined
}

export const MAX_STEPS = 3

/** A clean identifier token from a call/decorator arg string: strip quotes, reject dynamic/templated, take pre-dot. */
export function cleanArgToken(arg: string | null | undefined): string | null {
  if (!arg) return null
  const t = arg.replace(/^['"`]|['"`]$/g, '').trim()
  if (!t || t.includes('${') || /[^\w.-]/.test(t)) return null // reject dynamic/templated args
  return t.split('.')[0]! // User.name → User
}

const GRAPH_RELATIONS = new Set<string>([
  'resolves_to', 'decorates', 'type_ref', 'calls', 'contains', 'type_resolved', 'renders', 'imports', 'extends', 'implements',
])
const READ_KINDS = new Set<string>(['firstArgToken', 'firstArg', 'targetSymbol', 'targetSpecifier'])

/**
 * Validate an UNTRUSTED GraphQuery (e.g. one an LLM authored, G3) before the interpreter runs it: bounded
 * steps (1..MAX_STEPS), only known edge relations / directions / read kinds / resolveThrough. Lets the agent
 * author traversals as data while the deterministic engine refuses a malformed query (no crash, no surprise).
 */
export function isValidGraphQuery(q: unknown): q is GraphQuery {
  if (!q || typeof q !== 'object') return false
  const o = q as Record<string, unknown>
  if (!Array.isArray(o.steps) || o.steps.length < 1 || o.steps.length > MAX_STEPS) return false
  for (const s of o.steps) {
    if (!s || typeof s !== 'object') return false
    const st = s as Record<string, unknown>
    const edges = Array.isArray(st.edge) ? st.edge : [st.edge]
    if (edges.length === 0 || !edges.every((e) => typeof e === 'string' && GRAPH_RELATIONS.has(e))) return false
    if (st.direction !== 'out' && st.direction !== 'in') return false
    if (st.viaSymbol != null && typeof st.viaSymbol !== 'string') return false
    if (st.fanout != null && st.fanout !== 'first' && st.fanout !== 'all') return false
  }
  if (o.read == null || typeof o.read !== 'object') return false
  for (const v of Object.values(o.read as Record<string, unknown>)) {
    if (typeof v !== 'string' || !READ_KINDS.has(v)) return false
  }
  if (o.resolveThrough != null && o.resolveThrough !== 'known' && o.resolveThrough !== 'none') return false
  return true
}

function relationsOf(step: GraphStep): string[] {
  return Array.isArray(step.edge) ? step.edge : [step.edge]
}

function readToken(edge: GraphEdgeLike, read: GraphQuery['read']): string | null {
  const kind = read[edge.relation as GraphRelation]
  if (!kind) return null
  if (kind === 'firstArgToken') return cleanArgToken(edge.firstArg)
  if (kind === 'firstArg') return edge.firstArg ?? null
  if (kind === 'targetSymbol') return edge.targetSymbol ?? null
  return edge.targetSpecifier ?? null
}

/**
 * Run a bounded graph query from one anchor node. `receiver` is the bound token used by steps with
 * `viaReceiver` (e.g. the call's chain-root variable name). Returns the terminal tokens (verified ones only
 * when `resolveThrough:'known'`), deterministically (frontier order preserved; `fanout:'first'` keeps one).
 */
export function runGraphQuery(
  query: GraphQuery,
  startNodeId: string,
  receiver: string | null,
  adj: GraphAdjacency,
): string[] {
  if (query.steps.length === 0 || query.steps.length > MAX_STEPS) {
    throw new Error(`GraphQuery: steps must be 1..${MAX_STEPS} (got ${query.steps.length})`)
  }
  let frontier: string[] = [startNodeId]
  const lastIdx = query.steps.length - 1
  const out: string[] = []

  for (let i = 0; i < query.steps.length; i++) {
    const step = query.steps[i]!
    const rels = relationsOf(step)
    const isLast = i === lastIdx
    const next: string[] = []
    for (const nodeId of frontier) {
      const edges = step.direction === 'out' ? adj.out(nodeId) : (adj.in?.(nodeId) ?? [])
      for (const e of edges) {
        if (!rels.includes(e.relation)) continue
        if (step.viaReceiver && e.targetSymbol !== receiver) continue
        if (step.viaSymbol != null && e.targetSymbol !== step.viaSymbol) continue
        if (isLast) {
          const token = readToken(e, query.read)
          if (token != null) out.push(token)
        } else {
          const nextId = step.direction === 'out' ? e.targetId : e.sourceId
          if (nextId != null) next.push(nextId)
        }
        if (step.fanout !== 'all') break // deterministic: one match per node unless explicitly branching
      }
    }
    if (isLast) break
    frontier = next
  }

  if (query.resolveThrough === 'known') {
    const resolved: string[] = []
    for (const tok of out) {
      const kept = adj.resolveKnown?.(tok)
      if (kept != null) resolved.push(kept)
    }
    return resolved
  }
  return out
}
