import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { runRelationRuleDiscovery, findRelationGaps, type RelationRuleAuthor } from '@/pipeline_modules/build_relations/rule_authoring/autonomous_loop.js'

// The full-autonomy loop: scan a repo → find imported packages no rule covers → author a candidate per
// gap → run the deterministic referee → auto-promote the passers. The author is stubbed so the
// orchestration is tested deterministically (the real author is an LLM agent).

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

// repo importing TWO unknown vendors: 'newvendor' (client.capture/identify) + 'badvendor' (client.send)
function repoWithGaps() {
  edgeId = 1
  const file = node({ id: 'r:a.ts', type: 'file', filePath: 'a.ts' })
  const fn = node({ id: 'r:a.ts:f', type: 'function', filePath: 'a.ts' })
  const e = (p: Partial<CodeEdgeLike> & Pick<CodeEdgeLike, 'sourceId' | 'relation'>) => edge(p)
  const edges = [
    e({ sourceId: file.id, relation: 'imports', targetSpecifier: 'newvendor' }),
    e({ sourceId: file.id, relation: 'imports', targetSpecifier: 'badvendor' }),
    e({ sourceId: file.id, relation: 'imports', targetSpecifier: '@prisma/client' }), // KNOWN → not a gap
  ]
  const capture = e({ sourceId: fn.id, relation: 'calls', targetSymbol: 'capture', chainPath: 'nv' })
  const identify = e({ sourceId: fn.id, relation: 'calls', targetSymbol: 'identify', chainPath: 'nv' })
  edges.push(capture, identify)
  const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, fn], edges, models: [] }
  return { inputs, index: buildSemanticIndex(inputs), captureId: capture.id, identifyId: identify.id }
}

// stub author: a good external_service rule for 'newvendor'; an INVALID (empty packages) rule for 'badvendor'
const stubAuthor = (ids: { captureId: number; identifyId: number }): RelationRuleAuthor => async (gap) => {
  if (gap.packageSpecifier === 'newvendor') {
    return {
      kind: 'external_service',
      candidate: {
        id: 'rel.external_service.newvendor', label: 'newvendor', packages: ['newvendor'],
        methods: ['capture', 'identify'],
        resolve: { resourceByMethod: { capture: 'events', identify: 'users' }, operationByMethod: { capture: 'capture_event', identify: 'identify_user' } },
        anchorFixture: 'auto/newvendor', anchorEvidenceEdgeIds: [ids.captureId, ids.identifyId],
        anchorExpectedCanonical: ['external_service:newvendor:events', 'external_service:newvendor:users'],
        support: { matched: 2, examples: ['capture', 'identify'] },
      },
    }
  }
  if (gap.packageSpecifier === 'badvendor') {
    return {
      kind: 'external_service',
      candidate: {
        id: 'rel.external_service.badvendor', label: 'badvendor', packages: [], // INVALID → referee rejects
        methods: ['send'], resolve: { resourceByMethod: {}, operationByMethod: {} },
        anchorFixture: 'auto/badvendor', anchorEvidenceEdgeIds: [], support: { matched: 0, examples: [] },
      },
    }
  }
  return null
}

describe('runRelationRuleDiscovery — the autonomous loop', () => {
  it('detects unknown-package gaps (excludes known packages)', () => {
    const r = repoWithGaps()
    const gaps = findRelationGaps(r.inputs, r.index, new Set(['@prisma/client']))
    expect(gaps.map((g) => g.packageSpecifier).sort()).toEqual(['badvendor', 'newvendor'])
  })

  it('authors + referees + promotes the good gap, rejects the invalid one', async () => {
    const r = repoWithGaps()
    const result = await runRelationRuleDiscovery({
      inputs: r.inputs, index: r.index, foreignInputs: [],
      knownPackages: ['@prisma/client'], knownRuleIds: [],
      classifyPackage: async () => ({ kind: 'vendor_service', reason: 'test' }),
      authorCandidate: stubAuthor({ captureId: r.captureId, identifyId: r.identifyId }),
    })
    expect(result.gaps.map((g) => g.packageSpecifier).sort()).toEqual(['badvendor', 'newvendor'])
    expect(result.promoted.map((p) => p.candidate.id)).toEqual(['rel.external_service.newvendor'])
    expect(result.rejected.map((x) => x.ruleId)).toContain('rel.external_service.badvendor')
  })

  it('rejects a re-authored rule whose id is already known (duplicate)', async () => {
    const r = repoWithGaps()
    const result = await runRelationRuleDiscovery({
      inputs: r.inputs, index: r.index, foreignInputs: [],
      knownPackages: ['@prisma/client', 'badvendor'], // badvendor known → only newvendor is a gap
      knownRuleIds: ['rel.external_service.newvendor'], // already promoted earlier
      classifyPackage: async () => ({ kind: 'vendor_service', reason: 'test' }),
      authorCandidate: stubAuthor({ captureId: r.captureId, identifyId: r.identifyId }),
    })
    expect(result.promoted).toEqual([])
    expect(result.rejected).toEqual([{ ruleId: 'rel.external_service.newvendor', reason: 'duplicate_id' }])
  })
})
