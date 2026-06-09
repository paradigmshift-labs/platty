import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { evaluateDbAccessRuleForPromotion } from '@/pipeline_modules/build_relations/rule_authoring/db_access_promote_gate.js'
import { evaluateApiCallRuleForPromotion } from '@/pipeline_modules/build_relations/rule_authoring/api_call_promote_gate.js'
import { PROMOTED_DB_ACCESS_RULES } from '@/pipeline_modules/build_relations/rule_authoring/promoted_db_access_rules.js'
import { PROMOTED_API_CALL_RULES } from '@/pipeline_modules/build_relations/rule_authoring/promoted_api_call_rules.js'

// Keystone: every ORM/client rule in the rulebooks must PROMOTE on its representative anchor AND stay
// clean on the other ORMs/clients. Methods overlap (create/get/find) across ORMs/clients — only the
// package import gate distinguishes them. Tested-by-construction.

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

function anchor(pkg: string, label: string, call: Partial<CodeEdgeLike>) {
  const fp = `${label}/a.ts`
  const file = node({ id: `${label}:a.ts`, type: 'file', filePath: fp })
  const fn = node({ id: `${label}:a.ts:use`, type: 'function', filePath: fp })
  const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: pkg })
  const c = edge({ sourceId: fn.id, relation: 'calls', ...call })
  const inputs: BuildRelationsInputs = { repoId: label, repoPath: null, includeTestSources: false, nodes: [file, fn], edges: [imp, c], models: [] }
  return { inputs, index: buildSemanticIndex(inputs), callId: c.id }
}

describe('promoted db_access rules — keystone (every ORM promotes + mutually clean)', () => {
  expect(PROMOTED_DB_ACCESS_RULES.length).toBeGreaterThan(0)
  const anchors = new Map(PROMOTED_DB_ACCESS_RULES.map((s) => [s.id, anchor(s.clientPackages[0], s.ormLabel, { targetSymbol: s.example.method, chainPath: s.example.chainPath })]))
  for (const spec of PROMOTED_DB_ACCESS_RULES) {
    it(`${spec.id} → PROMOTE (${spec.example.expectedCanonical}), clean on other ORMs`, () => {
      const mine = anchors.get(spec.id)!
      const foreign = PROMOTED_DB_ACCESS_RULES.filter((s) => s.id !== spec.id).map((s) => ({ fixture: s.ormLabel, inputs: anchors.get(s.id)!.inputs, index: anchors.get(s.id)!.index }))
      const v = evaluateDbAccessRuleForPromotion({
        candidate: { id: spec.id, ormLabel: spec.ormLabel, clientPackages: spec.clientPackages, operationByMethod: spec.operationByMethod, anchorFixture: `synthetic/${spec.ormLabel}`, anchorEvidenceEdgeIds: [mine.callId], anchorExpectedCanonical: [spec.example.expectedCanonical], support: { matched: 1, examples: [spec.example.method] } },
        anchorInputs: mine.inputs, anchorIndex: mine.index, foreignInputs: foreign,
      })
      expect({ promote: v.promote, reason: v.reason }).toMatchObject({ promote: true })
    })
  }
})

describe('promoted api_call rules — keystone (every client promotes + mutually clean)', () => {
  expect(PROMOTED_API_CALL_RULES.length).toBeGreaterThan(0)
  const anchors = new Map(PROMOTED_API_CALL_RULES.map((s) => [s.id, anchor(s.clientPackages[0], s.clientLabel, { targetSymbol: s.example.symbol, chainPath: s.clientLabel, firstArg: s.example.firstArg })]))
  for (const spec of PROMOTED_API_CALL_RULES) {
    it(`${spec.id} → PROMOTE (${spec.example.expectedCanonical}), clean on other clients`, () => {
      const mine = anchors.get(spec.id)!
      const foreign = PROMOTED_API_CALL_RULES.filter((s) => s.id !== spec.id).map((s) => ({ fixture: s.clientLabel, inputs: anchors.get(s.id)!.inputs, index: anchors.get(s.id)!.index }))
      const v = evaluateApiCallRuleForPromotion({
        candidate: { id: spec.id, clientLabel: spec.clientLabel, clientPackages: spec.clientPackages, methodBySymbol: spec.methodBySymbol, anchorFixture: `synthetic/${spec.clientLabel}`, anchorEvidenceEdgeIds: [mine.callId], anchorExpectedCanonical: [spec.example.expectedCanonical], support: { matched: 1, examples: [spec.example.symbol] } },
        anchorInputs: mine.inputs, anchorIndex: mine.index, foreignInputs: foreign,
      })
      expect({ promote: v.promote, reason: v.reason }).toMatchObject({ promote: true })
    })
  }
})
