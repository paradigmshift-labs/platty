import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { runApiCallRule } from '@/pipeline_modules/build_relations/rule_authoring/api_call_promote_gate.js'
import type { ApiCallRuleCandidate } from '@/pipeline_modules/build_relations/rule_authoring/api_call_types.js'

// Faithfulness: the api_call referee's captured endpoints must agree with the REAL pipeline for an
// existing client (axios) — so an agent-authored NEW client is graded the same way the engine treats it.

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
const uniqSort = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort()

describe('faithfulness: api_call referee vs real pipeline (existing client = axios)', () => {
  it('an axios rule reproduces the real pipeline internal api_call endpoints', async () => {
    edgeId = 1
    const file = node({ id: 'r1:api.ts', type: 'file', filePath: 'api.ts' })
    const fn = node({ id: 'r1:api.ts:load', type: 'function', filePath: 'api.ts' })
    const edges: CodeEdgeLike[] = [
      edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'axios', targetSymbol: 'axios' }),
      edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'get', chainPath: 'axios', firstArg: '/api/users' }),
      edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'post', chainPath: 'axios', firstArg: '/api/users' }),
    ]
    const inputs: BuildRelationsInputs = { repoId: 'r1', repoPath: null, includeTestSources: false, nodes: [file, fn], edges, models: [] }
    const index = buildSemanticIndex(inputs)

    // REAL pipeline: extract → resolve → internal api_call canonicalTargets (METHOD path)
    const realCanonical = uniqSort(
      resolveCandidates(extractCandidates(inputs, index), index, { resolveConstant: () => null })
        .filter((r) => r.kind === 'api_call' && typeof r.canonicalTarget === 'string' && /^[A-Z]+ \//.test(r.canonicalTarget))
        .map((r) => r.canonicalTarget),
    )

    const axiosRule: ApiCallRuleCandidate = {
      id: 'rel.api_call.axios', clientLabel: 'axios', clientPackages: ['axios'],
      methodBySymbol: { get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', patch: 'PATCH' },
      anchorFixture: 'synthetic/axios', anchorEvidenceEdgeIds: [], support: { matched: 2, examples: ['get', 'post'] },
    }
    const mineCanonical = uniqSort(runApiCallRule(axiosRule, inputs, index).canonicalTargets)

    expect(realCanonical).toContain('GET /api/users')
    expect(realCanonical).toContain('POST /api/users')
    expect(mineCanonical).toEqual(realCanonical)
  })
})
