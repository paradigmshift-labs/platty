import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { runRelationRuleDiscovery, type RelationRuleAuthor, type LibraryClassifier } from '@/pipeline_modules/build_relations/rule_authoring/autonomous_loop.js'
import { toPersistedRelationRules, HARD_CODED_RELATION_PACKAGES } from '@/pipeline_modules/build_relations/rule_authoring/live_runner.js'
import { emitDbAccessRelationsForRule } from '@/pipeline_modules/build_relations/rule_authoring/db_access_promote_gate.js'
import type { GraphQuery } from '@/pipeline_modules/graph_query/index.js'

// G5: prove the loop GROWS net-new coverage end-to-end for a NON-hardcoded ORM ('@new/orm'), using an
// agent-authored graph-query (G3) to recover a table the static engine can't — and that auto-promote is SAFE
// (a non-reproducing rule is rejected; the promoted rule does not over-emit).

let edgeId = 1
function node(p: Partial<CodeNodeLike> & Pick<CodeNodeLike, 'id' | 'type' | 'filePath'>): CodeNodeLike {
  return { repoId: 'r', name: p.id.split(':').pop() ?? p.id, lineStart: 1, lineEnd: 99, ...p } as CodeNodeLike
}
function edge(p: Partial<CodeEdgeLike> & Pick<CodeEdgeLike, 'sourceId' | 'relation'>): CodeEdgeLike {
  return { id: edgeId++, repoId: 'r', targetId: null, targetSpecifier: null, targetSymbol: null, typeRefSubtype: null,
    chainPath: null, firstArg: null, literalArgs: null, argExpressions: null, resolveStatus: 'resolved', confidence: null, source: 'static', ...p } as CodeEdgeLike
}

// a repo using a brand-new ORM '@new/orm': this.widgetRepo.find(); widgetRepo: Repository<Widget>;
// @Entity('widgets') class Widget {} — the table lives in @Entity on the entity CLASS (3 hops).
function newOrmRepo() {
  edgeId = 1
  const file = node({ id: 'r:a.ts', type: 'file', filePath: 'a.ts' })
  const method = node({ id: 'r:a.ts:Svc.m', type: 'method', filePath: 'a.ts', name: 'm' })
  const field = node({ id: 'r:a.ts:Svc.widgetRepo', type: 'property', filePath: 'a.ts', name: 'widgetRepo' })
  const widgetClass = node({ id: 'r:a.ts:Widget', type: 'class', filePath: 'a.ts', name: 'Widget' })
  const find = edge({ sourceId: method.id, relation: 'calls', targetSymbol: 'find', chainPath: 'this.widgetRepo' })
  const edges: CodeEdgeLike[] = [
    edge({ sourceId: file.id, relation: 'imports', targetSpecifier: '@new/orm' }),
    find,
    edge({ sourceId: method.id, relation: 'resolves_to', targetId: field.id, targetSymbol: 'widgetRepo' }),
    edge({ sourceId: field.id, relation: 'type_ref', targetSymbol: 'Widget', targetId: widgetClass.id }),
    edge({ sourceId: widgetClass.id, relation: 'decorates', targetSymbol: 'Entity', firstArg: "'widgets'" }),
  ]
  const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, method, field, widgetClass], edges, models: [] as never }
  return { inputs, index: buildSemanticIndex(inputs), findId: find.id }
}

const ENTITY_QUERY: GraphQuery = {
  steps: [
    { edge: 'resolves_to', direction: 'out', viaReceiver: true },
    { edge: 'type_ref', direction: 'out' },
    { edge: 'decorates', direction: 'out', viaSymbol: 'Entity' },
  ],
  read: { decorates: 'firstArgToken' },
  resolveThrough: 'none',
}

const classifyDbClient: LibraryClassifier = async () => ({ kind: 'db_client', reason: 'stub' })

// the agent authors a db_access rule for @new/orm WITH a graph-query modelQuery (the G3 piece).
function authorFor(findId: number, modelQuery: GraphQuery | undefined): RelationRuleAuthor {
  return async (gap) => gap.packageSpecifier !== '@new/orm' ? null : ({
    kind: 'db_access',
    candidate: {
      id: 'rel.db_access.new-orm', ormLabel: '@new/orm', clientPackages: ['@new/orm'],
      operationByMethod: { find: 'select' }, tableSource: 'chain', modelQuery,
      anchorFixture: 'auto', anchorEvidenceEdgeIds: [findId], support: { matched: 1, examples: ['find'] },
    },
  })
}

describe('G5 — the loop grows net-new db_access coverage end-to-end (+ safety)', () => {
  it('discovers @new/orm → authors a graph-query rule → promotes → EMITS the new table the static engine lacks', async () => {
    const { inputs, index, findId } = newOrmRepo()
    const result = await runRelationRuleDiscovery({
      inputs, index, foreignInputs: [],
      knownPackages: HARD_CODED_RELATION_PACKAGES, knownRuleIds: [],
      authorCandidate: authorFor(findId, ENTITY_QUERY), classifyPackage: classifyDbClient,
    })

    // the loop PROMOTED the net-new ORM rule (with its agent-authored modelQuery)
    expect(result.promoted.map((p) => p.candidate.id)).toEqual(['rel.db_access.new-orm'])

    // consumed: the promoted rule EMITS the new relation the hardcoded registry (no @new/orm adapter) misses
    const emitRules = toPersistedRelationRules(result.promoted).dbAccess
    const out = emitRules.flatMap((rule) => emitDbAccessRelationsForRule(rule, inputs, index))
    expect(out).toHaveLength(1)                               // safety: no over-emission
    expect(out[0].canonicalTarget).toBe('db:widgets:select') // net-new coverage, via the authored 3-hop query
    expect(out[0].confidence).toBe('high')
  })

  it('SAFETY: a rule whose claimed method is never called reproduces nothing → NOT promoted (auto-promote is gated)', async () => {
    const { inputs, index } = newOrmRepo()
    const badAuthor: RelationRuleAuthor = async (gap) => gap.packageSpecifier !== '@new/orm' ? null : ({
      kind: 'db_access',
      candidate: {
        id: 'rel.db_access.new-orm', ormLabel: '@new/orm', clientPackages: ['@new/orm'],
        operationByMethod: { neverCalledMethod: 'select' }, tableSource: 'chain',
        anchorFixture: 'auto', anchorEvidenceEdgeIds: [], support: { matched: 0, examples: [] },
      },
    })
    const result = await runRelationRuleDiscovery({
      inputs, index, foreignInputs: [],
      knownPackages: HARD_CODED_RELATION_PACKAGES, knownRuleIds: [],
      authorCandidate: badAuthor, classifyPackage: classifyDbClient,
    })
    expect(result.promoted).toEqual([]) // reproduces nothing → referee rejects → rulebook not corrupted
  })
})
