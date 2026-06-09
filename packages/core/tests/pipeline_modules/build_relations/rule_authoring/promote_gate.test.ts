import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { evaluateExternalServiceRuleForPromotion } from '@/pipeline_modules/build_relations/rule_authoring/promote_gate.js'
import type { ExternalServiceRuleCandidate } from '@/pipeline_modules/build_relations/rule_authoring/types.js'

// The deterministic promote referee for agent-authored external_service vendor rules.
// Each test pins a single check via the exact graph shape that should pass/fail it.
// See specs/build_relations/agent-relation-rule-loop.md §2.

let edgeId = 1
function node(p: Partial<CodeNodeLike> & Pick<CodeNodeLike, 'id' | 'type' | 'filePath'>): CodeNodeLike {
  return { repoId: 'r1', name: p.id, lineStart: 1, lineEnd: 50, isTest: false, parseStatus: 'ok', ...p } as CodeNodeLike
}
function edge(p: Partial<CodeEdgeLike> & Pick<CodeEdgeLike, 'sourceId' | 'relation'>): CodeEdgeLike {
  return {
    id: edgeId++, repoId: 'r1', targetId: null, targetSpecifier: null, targetSymbol: null,
    typeRefSubtype: null, chainPath: null, firstArg: null, literalArgs: null, argExpressions: null,
    resolveStatus: 'resolved', confidence: null, source: 'static', ...p,
  } as CodeEdgeLike
}
function inputsOf(nodes: CodeNodeLike[], edges: CodeEdgeLike[]): BuildRelationsInputs {
  return { repoId: 'r1', repoPath: null, includeTestSources: false, nodes, edges, models: [] }
}

// posthog anchor: a.ts imports posthog-node; send() calls client.capture(), client.identify().
function posthogAnchor() {
  edgeId = 1
  const file = node({ id: 'r1:a.ts', type: 'file', filePath: 'a.ts' })
  const fn = node({ id: 'r1:a.ts:send', type: 'function', filePath: 'a.ts' })
  const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'posthog-node', targetSymbol: 'PostHog' })
  const capture = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'capture', chainPath: 'client', firstArg: 'signup' })
  const identify = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'identify', chainPath: 'client' })
  const inputs = inputsOf([file, fn], [imp, capture, identify])
  return { inputs, index: buildSemanticIndex(inputs), captureId: capture.id, identifyId: identify.id }
}

function posthogCandidate(over: Partial<ExternalServiceRuleCandidate> = {}): ExternalServiceRuleCandidate {
  return {
    id: 'rel.external_service.posthog',
    label: 'posthog',
    packages: ['posthog-node'],
    methods: ['capture', 'identify'],
    resolve: {
      resourceByMethod: { capture: 'events', identify: 'users' },
      operationByMethod: { capture: 'capture_event', identify: 'identify_user' },
    },
    anchorFixture: 'test/posthog',
    anchorEvidenceEdgeIds: [],
    anchorExpectedCanonical: ['external_service:posthog:events', 'external_service:posthog:users'],
    support: { matched: 2, examples: ['capture', 'identify'] },
    ...over,
  }
}

// foreign segment repo: imports analytics-node, calls analytics.capture() — a METHOD LOOKALIKE with no
// posthog import. A well-scoped posthog rule must NOT fire here (the import gate at work).
function segmentForeign() {
  const file = node({ id: 'r2:s.ts', type: 'file', filePath: 's.ts' })
  const fn = node({ id: 'r2:s.ts:t', type: 'function', filePath: 's.ts' })
  const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'analytics-node' })
  const cap = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'capture', chainPath: 'analytics' })
  const inputs = inputsOf([file, fn], [imp, cap])
  return { fixture: 'test/segment', inputs, index: buildSemanticIndex(inputs) }
}

describe('evaluateExternalServiceRuleForPromotion', () => {
  it('happy path: well-scoped posthog rule reproduces its anchor, self-gates, stays clean, resolves precisely → promote', () => {
    const a = posthogAnchor()
    const v = evaluateExternalServiceRuleForPromotion({
      candidate: posthogCandidate({ anchorEvidenceEdgeIds: [a.captureId, a.identifyId] }),
      anchorInputs: a.inputs,
      anchorIndex: a.index,
      foreignInputs: [segmentForeign()],
    })
    expect(v.promote).toBe(true)
    expect(v.checks.anchorReproduction.pass).toBe(true)
    expect(v.checks.evidenceGate.pass).toBe(true)
    expect(v.checks.crossVendorClean.pass).toBe(true)
    expect(v.checks.anchorResolutionPrecision?.pass).toBe(true)
  })

  it('empty packages → rejected (would fire everywhere)', () => {
    const a = posthogAnchor()
    const v = evaluateExternalServiceRuleForPromotion({
      candidate: posthogCandidate({ packages: [], anchorEvidenceEdgeIds: [a.captureId, a.identifyId] }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.packagesNonEmpty.pass).toBe(false)
  })

  it('anchor edge not caught → rejected (anchorReproduction)', () => {
    const a = posthogAnchor()
    const v = evaluateExternalServiceRuleForPromotion({
      candidate: posthogCandidate({ anchorEvidenceEdgeIds: [99999] }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.anchorReproduction.pass).toBe(false)
    expect(v.checks.anchorReproduction.missing).toContain(99999)
  })

  it('import gate: a method-lookalike call without the package import does NOT fire (crossVendorClean)', () => {
    const a = posthogAnchor()
    const v = evaluateExternalServiceRuleForPromotion({
      candidate: posthogCandidate({ anchorEvidenceEdgeIds: [a.captureId, a.identifyId] }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [segmentForeign()],
    })
    expect(v.checks.crossVendorClean.pass).toBe(true)
    expect(v.checks.crossVendorClean.polluted).toEqual([])
  })

  it('over-broad packages that match a foreign repo → rejected (crossVendorClean)', () => {
    const a = posthogAnchor()
    const seg = segmentForeign()
    // a sloppy rule that declares the foreign repo's package → fires there
    const v = evaluateExternalServiceRuleForPromotion({
      candidate: posthogCandidate({ packages: ['posthog-node', 'analytics-node'], anchorEvidenceEdgeIds: [a.captureId, a.identifyId] }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [seg],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.crossVendorClean.pass).toBe(false)
    expect(v.checks.crossVendorClean.polluted[0].fixture).toBe('test/segment')
  })

  it('resolves a relation outside the answer-key → rejected (anchorResolutionPrecision)', () => {
    // add a flush() call to the anchor; the rule maps flush→an extra resource not in the answer-key
    edgeId = 1
    const file = node({ id: 'r1:a.ts', type: 'file', filePath: 'a.ts' })
    const fn = node({ id: 'r1:a.ts:send', type: 'function', filePath: 'a.ts' })
    const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'posthog-node' })
    const capture = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'capture' })
    const flush = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'flush' })
    const inputs = inputsOf([file, fn], [imp, capture, flush])
    const index = buildSemanticIndex(inputs)

    const v = evaluateExternalServiceRuleForPromotion({
      candidate: posthogCandidate({
        methods: ['capture', 'flush'],
        resolve: { resourceByMethod: { capture: 'events', flush: 'internal' }, operationByMethod: { capture: 'capture_event', flush: 'flush' } },
        anchorEvidenceEdgeIds: [capture.id, flush.id],
        anchorExpectedCanonical: ['external_service:posthog:events'], // flush→internal is NOT a real relation
      }),
      anchorInputs: inputs, anchorIndex: index, foreignInputs: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.anchorResolutionPrecision?.pass).toBe(false)
    expect(v.checks.anchorResolutionPrecision?.overfired).toContain('external_service:posthog:internal')
  })

  it('namespaced SDK (stripe.charges.create): a dotted method-pattern matches targetSymbol=create + chainPath …charges', () => {
    // real call shape: stripe.charges.create(...) → targetSymbol 'create', chainPath 'stripe.charges'
    edgeId = 1
    const file = node({ id: 'r1:a.ts', type: 'file', filePath: 'a.ts' })
    const fn = node({ id: 'r1:a.ts:pay', type: 'function', filePath: 'a.ts' })
    const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'stripe' })
    const charge = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'create', chainPath: 'stripe.charges' })
    const cust = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'create', chainPath: 'stripe.customers' })
    const unrelated = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'create', chainPath: 'localCache' }) // bare create, NOT a stripe resource
    const inputs = inputsOf([file, fn], [imp, charge, cust, unrelated])
    const index = buildSemanticIndex(inputs)

    const v = evaluateExternalServiceRuleForPromotion({
      candidate: {
        id: 'rel.external_service.stripe', label: 'stripe', packages: ['stripe'],
        methods: ['charges.create', 'customers.create'],
        resolve: {
          resourceByMethod: { 'charges.create': 'charges', 'customers.create': 'customers' },
          operationByMethod: { 'charges.create': 'create_charge', 'customers.create': 'create_customer' },
        },
        anchorFixture: 'test/stripe', anchorEvidenceEdgeIds: [charge.id, cust.id],
        anchorExpectedCanonical: ['external_service:stripe:charges', 'external_service:stripe:customers'],
        support: { matched: 2, examples: ['charges.create', 'customers.create'] },
      },
      anchorInputs: inputs, anchorIndex: index, foreignInputs: [],
    })
    expect(v.promote).toBe(true)
    // the bare `create` on `localCache` (chainPath not …charges/…customers) must NOT be caught
    expect(v.checks.anchorReproduction.got.sort()).toEqual([charge.id, cust.id].sort())
    expect(v.checks.anchorReproduction.got).not.toContain(unrelated.id)
  })
})
