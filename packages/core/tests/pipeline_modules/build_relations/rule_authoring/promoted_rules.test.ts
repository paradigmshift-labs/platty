import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { evaluateExternalServiceRuleForPromotion } from '@/pipeline_modules/build_relations/rule_authoring/promote_gate.js'
import type { ExternalServiceRuleCandidate } from '@/pipeline_modules/build_relations/rule_authoring/types.js'
import { PROMOTED_EXTERNAL_SERVICE_RULES, type VendorRuleSpec } from '@/pipeline_modules/build_relations/rule_authoring/promoted_external_service_rules.js'

// Keystone: every vendor rule in the rulebook must PROMOTE on a synthetic anchor that uses it, AND stay
// clean on the OTHER vendors' repos. The interesting part: vendors share method names (track, identify,
// group) — only the package import gate distinguishes them. The keystone proves the gate holds, so a
// promoted vendor rule arrives tested-by-construction and never collides with another vendor.

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

// a repo that imports the vendor's first package and calls each of its methods once.
function syntheticAnchor(spec: VendorRuleSpec) {
  const fp = `${spec.label}/a.ts`
  const file = node({ id: `${spec.label}:a.ts`, type: 'file', filePath: fp })
  const fn = node({ id: `${spec.label}:a.ts:use`, type: 'function', filePath: fp })
  const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: spec.packages[0] })
  const calls = spec.methods.map((m) => edge({ sourceId: fn.id, relation: 'calls', targetSymbol: m, chainPath: 'client' }))
  const inputs: BuildRelationsInputs = { repoId: spec.label, repoPath: null, includeTestSources: false, nodes: [file, fn], edges: [imp, ...calls], models: [] }
  return { inputs, index: buildSemanticIndex(inputs), callIds: calls.map((c) => c.id) }
}

function candidateFor(spec: VendorRuleSpec, callIds: number[]): ExternalServiceRuleCandidate {
  const expected = [...new Set(spec.methods.map((m) => `external_service:${spec.label}:${spec.resolve.resourceByMethod[m]}`))]
  return {
    id: spec.id, label: spec.label, packages: spec.packages, methods: spec.methods, resolve: spec.resolve,
    anchorFixture: `synthetic/${spec.label}`, anchorEvidenceEdgeIds: callIds, anchorExpectedCanonical: expected,
    support: { matched: spec.methods.length, examples: spec.methods },
  }
}

describe('promoted external_service rules — keystone (every entry stays promotable + mutually clean)', () => {
  it('rulebook is non-empty and every id is unique', () => {
    expect(PROMOTED_EXTERNAL_SERVICE_RULES.length).toBeGreaterThan(0)
    const ids = PROMOTED_EXTERNAL_SERVICE_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // build all anchors once (stable edge ids across the suite)
  const anchors = new Map(PROMOTED_EXTERNAL_SERVICE_RULES.map((s) => [s.id, syntheticAnchor(s)]))

  for (const spec of PROMOTED_EXTERNAL_SERVICE_RULES) {
    it(`${spec.id} → PROMOTE on its anchor, clean on the other ${PROMOTED_EXTERNAL_SERVICE_RULES.length - 1} vendors (method overlap notwithstanding)`, () => {
      const mine = anchors.get(spec.id)!
      const candidate = candidateFor(spec, mine.callIds)
      const foreign = PROMOTED_EXTERNAL_SERVICE_RULES
        .filter((s) => s.id !== spec.id)
        .map((s) => ({ fixture: s.label, inputs: anchors.get(s.id)!.inputs, index: anchors.get(s.id)!.index }))
      const v = evaluateExternalServiceRuleForPromotion({ candidate, anchorInputs: mine.inputs, anchorIndex: mine.index, foreignInputs: foreign })
      expect({ promote: v.promote, reason: v.reason }).toMatchObject({ promote: true })
    })
  }
})
