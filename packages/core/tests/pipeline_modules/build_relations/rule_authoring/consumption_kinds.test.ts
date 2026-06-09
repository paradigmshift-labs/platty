import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { composeRelationRuleContext, emitPromotedRelations } from '@/pipeline_modules/build_relations/rule_authoring/consumption.js'
import { emitApiCallRelationsForRule, type ApiCallEmitRule } from '@/pipeline_modules/build_relations/rule_authoring/api_call_promote_gate.js'
import { emitExternalServiceRelationsForRule, type ExternalServiceEmitRule } from '@/pipeline_modules/build_relations/rule_authoring/promote_gate.js'

// api_call + external_service consumption: a NEW client/vendor gains relations; hard-coded ones are stripped.

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

function repo(imports: string, call: Partial<CodeEdgeLike>): { inputs: BuildRelationsInputs; index: ReturnType<typeof buildSemanticIndex> } {
  edgeId = 1
  const file = node({ id: 'r:a.ts', type: 'file', filePath: 'a.ts' })
  const fn = node({ id: 'r:a.ts:fn', type: 'function', filePath: 'a.ts' })
  const edges = [
    edge({ sourceId: file.id, relation: 'imports', targetSpecifier: imports }),
    edge({ sourceId: fn.id, relation: 'calls', ...call }),
  ]
  const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, fn], edges, models: [] }
  return { inputs, index: buildSemanticIndex(inputs) }
}

describe('api_call consumption', () => {
  const rule: ApiCallEmitRule = { clientLabel: 'myhttp', clientPackages: ['@myorg/http'], methodBySymbol: { get: 'GET', post: 'POST' } }

  it('emits an api_call relation with the full endpoint (METHOD path) for a NEW client', () => {
    const { inputs, index } = repo('@myorg/http', { targetSymbol: 'get', chainPath: 'client', firstArg: '/api/users' })
    const rels = emitApiCallRelationsForRule(rule, inputs, index)
    expect(rels).toHaveLength(1)
    expect(rels[0].kind).toBe('api_call')
    expect(rels[0].canonicalTarget).toBe('GET /api/users')
  })

  it('regression: a rule for a hard-coded client (axios) is stripped', () => {
    const ctx = composeRelationRuleContext({ apiCall: [{ clientLabel: 'axios', clientPackages: ['axios'], methodBySymbol: { get: 'GET' } }] })
    expect(ctx.apiCall).toEqual([])
  })
})

describe('external_service consumption', () => {
  const rule: ExternalServiceEmitRule = {
    label: 'myvendor', packages: ['@myvendor/sdk'], methods: ['track'],
    resolve: { resourceByMethod: { track: 'events' }, operationByMethod: { track: 'capture' } },
  }

  it('emits an external_service relation for a NEW vendor', () => {
    const { inputs, index } = repo('@myvendor/sdk', { targetSymbol: 'track', chainPath: 'vendor' })
    const rels = emitExternalServiceRelationsForRule(rule, inputs, index)
    expect(rels).toHaveLength(1)
    expect(rels[0].kind).toBe('external_service')
    expect(rels[0].canonicalTarget).toBe('external_service:myvendor:events')
    expect(rels[0].operation).toBe('capture')
  })

  it('regression: a rule for a hard-coded vendor (stripe) is stripped', () => {
    const ctx = composeRelationRuleContext({
      externalService: [{ label: 'stripe', packages: ['stripe'], methods: ['create'], resolve: { resourceByMethod: { create: 'charges' }, operationByMethod: {} } }],
    })
    expect(ctx.externalService).toEqual([])
  })
})

describe('emitPromotedRelations across all 3 kinds', () => {
  it('runs db_access + api_call + external_service rules together', () => {
    const { inputs, index } = repo('@myorg/http', { targetSymbol: 'get', chainPath: 'client', firstArg: '/api/x' })
    const ctx = composeRelationRuleContext({ apiCall: [{ clientLabel: 'myhttp', clientPackages: ['@myorg/http'], methodBySymbol: { get: 'GET' } }] })
    const rels = emitPromotedRelations(ctx, inputs, index)
    expect(rels.map((r) => r.canonicalTarget)).toEqual(['GET /api/x'])
  })
})
