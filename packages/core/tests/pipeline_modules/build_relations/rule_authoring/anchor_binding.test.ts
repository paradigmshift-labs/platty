import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { bindCandidateAnchor } from '@/pipeline_modules/build_relations/rule_authoring/anchor_binding.js'
import type { AuthoredRelationRule } from '@/pipeline_modules/build_relations/rule_authoring/autonomous_loop.js'
import type { GraphQuery } from '@/pipeline_modules/graph_query/index.js'

// The PURE, LLM-FREE anchor binder (extracted from the removed in-code LLM author). The agent (the dsl-build
// skill) authors only packages+methods+(query); bindCandidateAnchor grounds the anchor from THIS repo's real
// call edges so the deterministic referee grades against real data. NO LLM. See specs/refactor/llm-free-dsl-builder.md.

let edgeId = 1
function node(p: Partial<CodeNodeLike> & Pick<CodeNodeLike, 'id' | 'type' | 'filePath'>): CodeNodeLike {
  return { repoId: 'r', name: p.id, lineStart: 1, lineEnd: 99, isTest: false, parseStatus: 'ok', ...p } as CodeNodeLike
}
function edge(p: Partial<CodeEdgeLike> & Pick<CodeEdgeLike, 'sourceId' | 'relation'>): CodeEdgeLike {
  return {
    id: edgeId++, repoId: 'r', targetId: null, targetSpecifier: null, targetSymbol: null, typeRefSubtype: null,
    chainPath: null, firstArg: null, literalArgs: null, argExpressions: null, resolveStatus: 'resolved', confidence: null, source: 'static', ...p,
  } as CodeEdgeLike
}

// repo imports 'newvendor' and calls nv.capture / nv.identify on it
function repoWithVendorGap() {
  edgeId = 1
  const file = node({ id: 'r:a.ts', type: 'file', filePath: 'a.ts' })
  const fn = node({ id: 'r:a.ts:f', type: 'function', filePath: 'a.ts' })
  const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'newvendor' })
  const capture = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'capture', chainPath: 'nv' })
  const identify = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'identify', chainPath: 'nv' })
  const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, fn], edges: [imp, capture, identify], models: [] }
  return { inputs, index: buildSemanticIndex(inputs), captureId: capture.id, identifyId: identify.id }
}

// a redaxios-style repo: get('/api/reports') has a captured path; the other get has firstArg=null
// (a template literal / variable arg build_graph leaves null). Only the path call is a real api_call.
function repoWithRedaxios() {
  edgeId = 1
  const file = node({ id: 'r:a.ts', type: 'file', filePath: 'a.ts' })
  const fn = node({ id: 'r:a.ts:f', type: 'function', filePath: 'a.ts' })
  const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'redaxios' })
  const getPath = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'get', chainPath: 'axios', firstArg: '/api/reports' })
  const getNull = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'get', chainPath: 'axios', firstArg: null })
  const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, fn], edges: [imp, getPath, getNull], models: [] }
  return { inputs, index: buildSemanticIndex(inputs), getPathId: getPath.id }
}

const externalCandidate = (): AuthoredRelationRule => ({
  kind: 'external_service',
  candidate: {
    id: 'rel.external_service.newvendor', label: 'newvendor', packages: ['newvendor'],
    methods: ['capture', 'identify'],
    resolve: { resourceByMethod: { capture: 'events', identify: 'users' }, operationByMethod: { capture: 'capture_event', identify: 'identify_user' } },
    anchorFixture: 'auto/newvendor', anchorEvidenceEdgeIds: [],
    anchorExpectedCanonical: ['external_service:newvendor:events'], support: { matched: 2, examples: ['capture', 'identify'] },
  },
})

const apiCandidate = (over: Record<string, unknown> = {}): AuthoredRelationRule => ({
  kind: 'api_call',
  candidate: { id: 'rel.api_call.redaxios', clientLabel: 'redaxios', clientPackages: ['redaxios'], methodBySymbol: { get: 'GET', post: 'POST' }, anchorFixture: 'auto', anchorEvidenceEdgeIds: [], support: { matched: 0, examples: [] }, ...over },
})

describe('bindCandidateAnchor — deterministic anchor binding (LLM-free)', () => {
  it('external_service: empty edge ids in → the repo\'s real call-edge ids out, predicted canonical cleared', () => {
    const { inputs, index, captureId, identifyId } = repoWithVendorGap()
    const out = bindCandidateAnchor(externalCandidate(), inputs, index)
    expect(out.candidate.anchorEvidenceEdgeIds.sort()).toEqual([captureId, identifyId].sort())
    // trust the graph, not a predicted canonical → the optional precision check is skipped
    expect(out.candidate.anchorExpectedCanonical).toBeUndefined()
  })

  it('api_call is GROUNDED by running the rule: binds only internal-path calls (not firstArg=null)', () => {
    const { inputs, index, getPathId } = repoWithRedaxios()
    const out = bindCandidateAnchor(apiCandidate(), inputs, index)
    // only the /api/reports edge is bound — the firstArg=null call (template/var) is correctly excluded
    expect(out.candidate.anchorEvidenceEdgeIds).toEqual([getPathId])
    expect(out.candidate.anchorExpectedCanonical).toBeUndefined()
  })

  it('db_access: a MALFORMED modelQuery is dropped (untrusted → safe fallback to the default traversal)', () => {
    const { inputs, index } = repoWithVendorGap()
    const malformed = {
      kind: 'db_access',
      candidate: {
        id: 'rel.db_access.x', ormLabel: 'x', clientPackages: ['newvendor'], operationByMethod: { capture: 'select' },
        tableSource: 'chain', modelQuery: { steps: [{ edge: 'BOGUS', direction: 'sideways' }], read: {} } as unknown as GraphQuery,
        anchorFixture: 'auto', anchorEvidenceEdgeIds: [], support: { matched: 0, examples: [] },
      },
    } as AuthoredRelationRule
    const out = bindCandidateAnchor(malformed, inputs, index)
    expect((out as { candidate: { modelQuery?: unknown } }).candidate.modelQuery).toBeUndefined()
  })
})
