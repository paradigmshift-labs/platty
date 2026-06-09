import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { externalServiceAdapter } from '@/pipeline_modules/build_relations/adapters/external/services.js'
import { resolveExternalServiceCandidate } from '@/pipeline_modules/build_relations/resolvers/external_service.js'
import { runExternalServiceRule } from '@/pipeline_modules/build_relations/rule_authoring/promote_gate.js'
import type { ExternalServiceRuleCandidate } from '@/pipeline_modules/build_relations/rule_authoring/types.js'

// Faithfulness keystone: the referee's self-contained F3→F4 matcher must agree with the REAL pipeline
// (externalServiceAdapter + resolveExternalServiceCandidate) for an EXISTING, registered vendor. If a
// rule derived from a vendor's real definition+resolver reproduces the real pipeline's relations, the
// matcher is faithful — so an agent-authored NEW vendor is graded the same way the engine would treat it.

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
const uniqSort = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort()

describe('faithfulness: referee matcher vs real pipeline (existing vendor = posthog)', () => {
  it('a rule built from posthog real definition+resolver reproduces the real pipeline relations', () => {
    edgeId = 1
    // a.ts imports posthog-node; send() calls client.capture / identify / group
    const file = node({ id: 'r1:a.ts', type: 'file', filePath: 'a.ts' })
    const fn = node({ id: 'r1:a.ts:send', type: 'function', filePath: 'a.ts' })
    const edges = [
      edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'posthog-node', targetSymbol: 'PostHog' }),
      edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'capture', chainPath: 'client', firstArg: 'signup' }),
      edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'identify', chainPath: 'client' }),
      edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'group', chainPath: 'client' }),
    ]
    const inputs: BuildRelationsInputs = { repoId: 'r1', repoPath: null, includeTestSources: false, nodes: [file, fn], edges, models: [] }
    const index = buildSemanticIndex(inputs)

    // REAL pipeline: extract external_service candidates → resolve → canonicalTargets (posthog only)
    const realCanonical = uniqSort(
      externalServiceAdapter
        .extractCandidates(inputs, index)
        .filter((c) => c.payload.service === 'posthog')
        .map((c) => resolveExternalServiceCandidate(c, index)?.canonicalTarget),
    )

    // REFEREE matcher: a candidate that serializes posthog's real definition+resolver
    const posthogRule: ExternalServiceRuleCandidate = {
      id: 'rel.external_service.posthog',
      label: 'posthog',
      packages: ['posthog-node', 'posthog-js'],
      methods: ['capture', 'identify', 'group'],
      resolve: {
        resourceByMethod: { capture: 'events', identify: 'users', group: 'groups' },
        operationByMethod: { capture: 'capture_event', identify: 'identify_user', group: 'identify_group' },
      },
      anchorFixture: 'synthetic/posthog',
      anchorEvidenceEdgeIds: [],
      support: { matched: 3, examples: ['capture', 'identify', 'group'] },
    }
    const mineCanonical = uniqSort(runExternalServiceRule(posthogRule, inputs, index).canonicalTargets)

    expect(realCanonical).toEqual(['external_service:posthog:events', 'external_service:posthog:groups', 'external_service:posthog:users'])
    expect(mineCanonical).toEqual(realCanonical)
  })
})
