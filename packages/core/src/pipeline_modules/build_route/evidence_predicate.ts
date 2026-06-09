// Unified evidence predicate — the single self-gating primitive for BOTH DSL rules
// (SelectExpr.requires_import / requires_evidence) AND evidence-gated exception handlers.
//
// "Does the build_graph contain evidence X" — at two granularities: `matchedFiles` (per-source-file,
// used by select_evaluator to keep only edges whose source file carries the evidence) and `fired`
// (repo-wide boolean, used by exception handlers to arm/skip). This REPLACES framework classification:
// a rule/handler runs because its specific graph evidence is present, never because we guessed the framework.

import type { CodeNodeType, EdgeRelation } from '@/db/schema/enums.js'
import type { GraphIndex } from './graph_index.js'

export type EvidenceCondition =
  // a source file imports one of these package specifiers (generalizes requires_import)
  | { importSpecifier: string[] }
  // a `decorates` edge to one of these decorator symbols exists (NestJS @Controller/@Get, …)
  | { decoratesSymbol: string[] }
  // a `calls` edge matches (express app.get, …); method == the call's targetSymbol
  | { callsSymbol?: string[]; callsMethod?: string[]; firstArgNonNull?: boolean }
  // any edge of `relation` whose target matches (react-router <Route> renders, mount edges, …)
  | { relation: EdgeRelation; targetSymbol?: string[]; targetSpecifier?: string[] }
  // file nodes matching a glob exist (FS-routing conventions)
  | { fileGlob: string[]; nodeType?: CodeNodeType }

export interface EvidenceTrigger {
  /** every condition must hold (per file) */
  all?: EvidenceCondition[]
  /** at least one condition holds */
  any?: EvidenceCondition[]
}

export interface EvidenceMatch {
  /** repo-wide: did the trigger find any evidence (for exception handlers to arm) */
  fired: boolean
  /** source files carrying the evidence (for per-edge DSL filtering) */
  matchedFiles: Set<string>
}

function fileOf(graph: GraphIndex, nodeId: string): string | undefined {
  const fp = graph.getNode(nodeId)?.filePath
  return typeof fp === 'string' ? fp : undefined
}

function has(value: string | null | undefined, list: string[]): boolean {
  return value !== null && value !== undefined && list.includes(value)
}

/** Source files that satisfy a single condition. */
export function filesForCondition(cond: EvidenceCondition, graph: GraphIndex): Set<string> {
  const out = new Set<string>()
  const addEdgeFile = (sourceId: string): void => {
    const f = fileOf(graph, sourceId)
    if (f !== undefined) out.add(f)
  }

  if ('importSpecifier' in cond) {
    for (const edge of graph.edgesByRelation('imports')) {
      if (has(edge.targetSpecifier, cond.importSpecifier)) addEdgeFile(edge.sourceId)
    }
  } else if ('decoratesSymbol' in cond) {
    for (const edge of graph.edgesByRelation('decorates')) {
      if (has(edge.targetSymbol, cond.decoratesSymbol)) addEdgeFile(edge.sourceId)
    }
  } else if ('callsSymbol' in cond || 'callsMethod' in cond || 'firstArgNonNull' in cond) {
    for (const edge of graph.edgesByRelation('calls')) {
      const symOk = cond.callsSymbol ? has(edge.targetSymbol, cond.callsSymbol) : true
      const methodOk = cond.callsMethod ? has(edge.targetSymbol, cond.callsMethod) : true
      const argOk = cond.firstArgNonNull ? edge.firstArg !== null && edge.firstArg !== undefined : true
      if (symOk && methodOk && argOk) addEdgeFile(edge.sourceId)
    }
  } else if ('relation' in cond) {
    for (const edge of graph.edgesByRelation(cond.relation)) {
      const symOk = cond.targetSymbol ? has(edge.targetSymbol, cond.targetSymbol) : true
      const specOk = cond.targetSpecifier ? has(edge.targetSpecifier, cond.targetSpecifier) : true
      if (symOk && specOk) addEdgeFile(edge.sourceId)
    }
  } else if ('fileGlob' in cond) {
    for (const node of graph.nodesByFileGlob(cond.fileGlob)) {
      if (cond.nodeType !== undefined && node.type !== cond.nodeType) continue
      if (typeof node.filePath === 'string') out.add(node.filePath)
    }
  }
  return out
}

function intersect(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set()
  return sets.reduce((acc, s) => new Set([...acc].filter((f) => s.has(f))))
}

function union(sets: Set<string>[]): Set<string> {
  const out = new Set<string>()
  for (const s of sets) for (const f of s) out.add(f)
  return out
}

/** Evaluate a trigger over the graph. all → file must satisfy every condition; any → at least one. */
export function evaluateEvidence(trigger: EvidenceTrigger, graph: GraphIndex): EvidenceMatch {
  const allSets = (trigger.all ?? []).map((c) => filesForCondition(c, graph))
  const anySets = (trigger.any ?? []).map((c) => filesForCondition(c, graph))

  let files: Set<string>
  if (allSets.length > 0 && anySets.length > 0) {
    files = intersect([intersect(allSets), union(anySets)])
  } else if (allSets.length > 0) {
    files = intersect(allSets)
  } else if (anySets.length > 0) {
    files = union(anySets)
  } else {
    files = new Set()
  }
  return { fired: files.size > 0, matchedFiles: files }
}
