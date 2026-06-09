import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { runCorpusSelfImprovement, type CorpusFixture } from '@/pipeline_modules/build_relations/rule_authoring/corpus_sweep.js'
import { HARD_CODED_RELATION_PACKAGES } from '@/pipeline_modules/build_relations/rule_authoring/live_runner.js'
import type { RelationRuleAuthor, LibraryClassifier } from '@/pipeline_modules/build_relations/rule_authoring/autonomous_loop.js'

// G7: the autonomous rulebook GROWS across a corpus sweep — a rule the loop learns on fixture A is REUSED
// (not re-authored) on fixture B, so the LLM is asked fewer times and coverage compounds. The author/classifier
// are deterministic stubs (no LLM); this proves the accumulation orchestration, not a model.

let edgeId = 1
function node(p: Partial<CodeNodeLike> & Pick<CodeNodeLike, 'id' | 'type' | 'filePath'>): CodeNodeLike {
  return { repoId: 'r', name: p.id.split(':').pop() ?? p.id, lineStart: 1, lineEnd: 99, isTest: false, parseStatus: 'ok', ...p } as CodeNodeLike
}
function edge(p: Partial<CodeEdgeLike> & Pick<CodeEdgeLike, 'sourceId' | 'relation'>): CodeEdgeLike {
  return { id: edgeId++, repoId: 'r', targetId: null, targetSpecifier: null, targetSymbol: null, typeRefSubtype: null,
    chainPath: null, firstArg: null, literalArgs: null, argExpressions: null, resolveStatus: 'resolved', confidence: null, source: 'static', ...p } as CodeEdgeLike
}

// a fixture importing the given packages; for `@new/orm` it has a `widget.find()` db call (so the db_access
// rule emits coverage), for `@acme/vendor` a `client.charge()` vendor call.
function fixture(name: string, repoId: string, opts: { newOrm?: boolean; vendor?: boolean }): CorpusFixture {
  edgeId = 1
  const file = node({ id: `${repoId}:a.ts`, type: 'file', filePath: 'a.ts' })
  const method = node({ id: `${repoId}:a.ts:Svc.m`, type: 'method', filePath: 'a.ts', name: 'm' })
  const edges: CodeEdgeLike[] = []
  if (opts.newOrm) {
    edges.push(edge({ sourceId: file.id, relation: 'imports', targetSpecifier: '@new/orm' }))
    edges.push(edge({ sourceId: method.id, relation: 'calls', targetSymbol: 'find', chainPath: 'widget' }))
  }
  if (opts.vendor) {
    edges.push(edge({ sourceId: file.id, relation: 'imports', targetSpecifier: '@acme/vendor' }))
    edges.push(edge({ sourceId: method.id, relation: 'calls', targetSymbol: 'charge', chainPath: 'client' }))
  }
  const inputs: BuildRelationsInputs = {
    repoId, repoPath: null, includeTestSources: false, nodes: [file, method], edges,
    models: [{ modelName: 'widget', tableName: 'widgets' }] as never,
  }
  return { fixture: name, inputs, index: buildSemanticIndex(inputs) }
}

// classify the two unknown packages; everything else unknown.
const classify: LibraryClassifier = async (pkg) =>
  pkg === '@new/orm' ? { kind: 'db_client', reason: 'stub' }
  : pkg === '@acme/vendor' ? { kind: 'vendor_service', reason: 'stub' }
  : { kind: 'unknown', reason: 'stub' }

// author a db_access rule for @new/orm and an external_service rule for @acme/vendor; binds the anchor to the
// real call edge in the gap's file so the deterministic referee reproduces it.
function makeAuthor(): { author: RelationRuleAuthor; calls: string[] } {
  const calls: string[] = []
  const author: RelationRuleAuthor = async (gap, ctx) => {
    calls.push(gap.packageSpecifier)
    const callEdgeIds = (sym: string) => ctx.inputs.edges.filter((e) => e.relation === 'calls' && e.targetSymbol === sym && typeof e.id === 'number').map((e) => e.id as number)
    if (gap.packageSpecifier === '@new/orm') {
      return { kind: 'db_access', candidate: {
        id: 'rel.db_access.new-orm', ormLabel: '@new/orm', clientPackages: ['@new/orm'],
        operationByMethod: { find: 'select' }, tableSource: 'chain',
        anchorFixture: 'auto', anchorEvidenceEdgeIds: callEdgeIds('find'), support: { matched: 1, examples: ['find'] },
      } }
    }
    if (gap.packageSpecifier === '@acme/vendor') {
      return { kind: 'external_service', candidate: {
        id: 'rel.external_service.acme', label: '@acme/vendor', packages: ['@acme/vendor'], methods: ['charge'],
        resolve: { resourceByMethod: { charge: 'payments' }, operationByMethod: { charge: 'charge' } },
        anchorFixture: 'auto', anchorEvidenceEdgeIds: callEdgeIds('charge'),
        anchorExpectedCanonical: undefined, support: { matched: 1, examples: ['charge'] },
      } }
    }
    return null
  }
  return { author, calls }
}

describe('G7 — corpus self-improvement sweep (the accumulating rulebook driver)', () => {
  it('learns @new/orm on fixture A and REUSES it on fixture B (no re-author), authoring only B\'s new vendor', async () => {
    const { author, calls } = makeAuthor()
    const fixtures = [
      fixture('A', 'rA', { newOrm: true }),
      fixture('B', 'rB', { newOrm: true, vendor: true }),
    ]
    const report = await runCorpusSelfImprovement({ fixtures, author, classifyPackage: classify, seedKnownPackages: HARD_CODED_RELATION_PACKAGES })

    // accumulation: @new/orm authored once (on A), NOT re-authored on B; @acme/vendor authored once (on B)
    expect(calls).toEqual(['@new/orm', '@acme/vendor'])
    expect(report.totals.llmAuthorCalls).toBe(2) // not 3 — B reuses the learned @new/orm rule
    expect(report.learnedPackages).toEqual(['@acme/vendor', '@new/orm'])

    const b = report.perFixture.find((r) => r.fixture === 'B')!
    expect(b.reusedPackages).toContain('@new/orm') // already known from A → not re-asked
    expect(b.gapPackages).toEqual(['@acme/vendor']) // @new/orm is NOT a gap on B anymore
    expect(b.coverageRelations).toBeGreaterThanOrEqual(1) // the A-learned @new/orm rule still emits on B

    expect(report.totals.rulesPromoted).toBe(2)
    expect(report.totals.fixturesSwept).toBe(2)
  })

  it('a sweep where every package is already seed-known authors NOTHING (zero LLM calls)', async () => {
    const { author, calls } = makeAuthor()
    const known = fixture('K', 'rK', {}) // imports nothing unknown
    const report = await runCorpusSelfImprovement({ fixtures: [known], author, classifyPackage: classify, seedKnownPackages: HARD_CODED_RELATION_PACKAGES })
    expect(calls).toEqual([])
    expect(report.totals.llmAuthorCalls).toBe(0)
    expect(report.totals.rulesPromoted).toBe(0)
    expect(report.learnedPackages).toEqual([])
  })
})
