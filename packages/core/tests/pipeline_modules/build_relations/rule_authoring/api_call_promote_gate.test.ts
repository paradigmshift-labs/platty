import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { evaluateApiCallRuleForPromotion, runApiCallRule } from '@/pipeline_modules/build_relations/rule_authoring/api_call_promote_gate.js'
import type { ApiCallRuleCandidate } from '@/pipeline_modules/build_relations/rule_authoring/api_call_types.js'

// Deterministic referee for agent-authored api_call rules. canonicalTarget = `METHOD endpoint` — the
// endpoint (method + internal path) is what build_service_map matches to the backend route.

let edgeId = 1
function node(p: Partial<CodeNodeLike> & Pick<CodeNodeLike, 'id' | 'type' | 'filePath'>): CodeNodeLike {
  return { repoId: 'r1', name: p.id, lineStart: 1, lineEnd: 50, isTest: false, parseStatus: 'ok', ...p } as CodeNodeLike
}
function edge(p: Partial<CodeEdgeLike> & Pick<CodeEdgeLike, 'sourceId' | 'relation'>): CodeEdgeLike {
  return {
    id: edgeId++, repoId: 'r1', targetId: null, targetSpecifier: null, targetSymbol: null, typeRefSubtype: null,
    chainPath: null, firstArg: null, literalArgs: null, argExpressions: null, resolveStatus: 'resolved', confidence: null, source: 'static', ...p,
  } as CodeEdgeLike
}
function inputsOf(nodes: CodeNodeLike[], edges: CodeEdgeLike[]): BuildRelationsInputs {
  return { repoId: 'r1', repoPath: null, includeTestSources: false, nodes, edges, models: [] }
}

// axios anchor: api.ts imports axios; load() calls axios.get('/api/users'), axios.post('/api/users'),
// axios.get('/api/users/${id}')
function axiosAnchor() {
  edgeId = 1
  const file = node({ id: 'r1:api.ts', type: 'file', filePath: 'api.ts' })
  const fn = node({ id: 'r1:api.ts:load', type: 'function', filePath: 'api.ts' })
  const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'axios', targetSymbol: 'axios' })
  const getList = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'get', chainPath: 'axios', firstArg: '/api/users' })
  const post = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'post', chainPath: 'axios', firstArg: '/api/users' })
  const getById = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'get', chainPath: 'axios', firstArg: '/api/users/${id}' })
  const inputs = inputsOf([file, fn], [imp, getList, post, getById])
  return { inputs, index: buildSemanticIndex(inputs), getListId: getList.id, postId: post.id, getByIdId: getById.id }
}

function axiosCandidate(over: Partial<ApiCallRuleCandidate> = {}): ApiCallRuleCandidate {
  return {
    id: 'rel.api_call.axios', clientLabel: 'axios', clientPackages: ['axios'],
    methodBySymbol: { get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', patch: 'PATCH' },
    anchorFixture: 'test/axios', anchorEvidenceEdgeIds: [],
    anchorExpectedCanonical: ['GET /api/users', 'POST /api/users', 'GET /api/users/:id'],
    support: { matched: 3, examples: ['get', 'post'] }, ...over,
  }
}

// foreign repo: imports got (a different client), calls got.get('/x') — must NOT trip the axios rule.
function gotForeign() {
  const file = node({ id: 'r2:g.ts', type: 'file', filePath: 'g.ts' })
  const fn = node({ id: 'r2:g.ts:f', type: 'function', filePath: 'g.ts' })
  const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'got' })
  const call = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'get', chainPath: 'got', firstArg: '/health' })
  const inputs = inputsOf([file, fn], [imp, call])
  return { fixture: 'test/got', inputs, index: buildSemanticIndex(inputs) }
}

describe('evaluateApiCallRuleForPromotion', () => {
  it('happy: axios rule captures METHOD+endpoint (incl. /users/${id} → /users/:id) → promote', () => {
    const a = axiosAnchor()
    const v = evaluateApiCallRuleForPromotion({
      candidate: axiosCandidate({ anchorEvidenceEdgeIds: [a.getListId, a.postId, a.getByIdId] }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [gotForeign()],
    })
    expect(v.promote).toBe(true)
    expect(v.checks.crossClientClean.pass).toBe(true)
    expect(runApiCallRule(axiosCandidate(), a.inputs, a.index).canonicalTargets.sort()).toEqual(
      ['GET /api/users', 'GET /api/users/:id', 'POST /api/users'],
    )
  })

  it('empty clientPackages → rejected', () => {
    const a = axiosAnchor()
    const v = evaluateApiCallRuleForPromotion({
      candidate: axiosCandidate({ clientPackages: [], anchorEvidenceEdgeIds: [a.getListId] }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.clientPackagesNonEmpty.pass).toBe(false)
  })

  it('anchor edge not caught → rejected (anchorReproduction)', () => {
    const a = axiosAnchor()
    const v = evaluateApiCallRuleForPromotion({
      candidate: axiosCandidate({ anchorEvidenceEdgeIds: [99999] }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.anchorReproduction.pass).toBe(false)
  })

  it('cross-client: an axios rule does NOT fire on a got repo (import gate)', () => {
    const a = axiosAnchor()
    const v = evaluateApiCallRuleForPromotion({
      candidate: axiosCandidate({ anchorEvidenceEdgeIds: [a.getListId, a.postId, a.getByIdId] }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [gotForeign()],
    })
    expect(v.checks.crossClientClean.pass).toBe(true)
  })

  it('wrong verb map (post→GET) captures an out-of-key endpoint → rejected (endpoint precision)', () => {
    // focused anchor: a single axios.post('/api/orders'); the key expects POST, the buggy rule emits GET
    edgeId = 1
    const file = node({ id: 'r1:o.ts', type: 'file', filePath: 'o.ts' })
    const fn = node({ id: 'r1:o.ts:f', type: 'function', filePath: 'o.ts' })
    const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'axios' })
    const post = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'post', chainPath: 'axios', firstArg: '/api/orders' })
    const inputs = inputsOf([file, fn], [imp, post])
    const index = buildSemanticIndex(inputs)
    const v = evaluateApiCallRuleForPromotion({
      candidate: axiosCandidate({
        methodBySymbol: { post: 'GET' }, // BUG: post mapped to GET
        anchorEvidenceEdgeIds: [post.id],
        anchorExpectedCanonical: ['POST /api/orders'],
      }),
      anchorInputs: inputs, anchorIndex: index, foreignInputs: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.anchorEndpointPrecision?.pass).toBe(false)
    expect(v.checks.anchorEndpointPrecision?.overfired).toContain('GET /api/orders')
  })

  it('external URLs (https://…) are NOT captured as internal endpoints', () => {
    edgeId = 1
    const file = node({ id: 'r1:x.ts', type: 'file', filePath: 'x.ts' })
    const fn = node({ id: 'r1:x.ts:f', type: 'function', filePath: 'x.ts' })
    const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'axios' })
    const ext = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'get', chainPath: 'axios', firstArg: 'https://api.stripe.com/v1/charges' })
    const internal = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'get', chainPath: 'axios', firstArg: '/api/me' })
    const inputs = inputsOf([file, fn], [imp, ext, internal])
    const index = buildSemanticIndex(inputs)
    expect(runApiCallRule(axiosCandidate(), inputs, index).canonicalTargets).toEqual(['GET /api/me'])
  })
})
