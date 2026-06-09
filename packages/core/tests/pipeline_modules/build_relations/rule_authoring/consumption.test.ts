import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { composeRelationRuleContext, emitPromotedRelations } from '@/pipeline_modules/build_relations/rule_authoring/consumption.js'
import { emitDbAccessRelationsForRule, type DbAccessEmitRule } from '@/pipeline_modules/build_relations/rule_authoring/db_access_promote_gate.js'

// The un-orphaning proof: with the SAME graph, build_relations GAINS a db_access relation when a promoted
// rule for a NEW ORM is present, and hard-coded ORMs in the rulebook are stripped (no double-emit).

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

// a file importing the NEW ORM '@neworm/db' + a svc() calling db.insert(users) (query-builder style: the
// table is in the first arg → tableSource:'first_arg').
function repoWithNewOrm(): { inputs: BuildRelationsInputs; index: ReturnType<typeof buildSemanticIndex> } {
  edgeId = 1
  const file = node({ id: 'r:a.ts', type: 'file', filePath: 'a.ts' })
  const fn = node({ id: 'r:a.ts:svc', type: 'function', filePath: 'a.ts' })
  const edges = [
    edge({ sourceId: file.id, relation: 'imports', targetSpecifier: '@neworm/db' }),
    edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'insert', chainPath: 'db', firstArg: 'users' }),
  ]
  const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, fn], edges, models: [] }
  return { inputs, index: buildSemanticIndex(inputs) }
}

const newOrmRule: DbAccessEmitRule = { ormLabel: 'neworm', clientPackages: ['@neworm/db'], operationByMethod: { insert: 'insert' }, tableSource: 'first_arg' }

describe('build_relations promoted-rule consumption', () => {
  it('emits a db_access relation for a NEW ORM the hard-coded engine misses', () => {
    const { inputs, index } = repoWithNewOrm()
    const rels = emitDbAccessRelationsForRule(newOrmRule, inputs, index)
    expect(rels).toHaveLength(1)
    expect(rels[0].kind).toBe('db_access')
    expect(rels[0].canonicalTarget).toBe('db:users:insert')
    expect(rels[0].payload.orm).toBe('neworm')
  })

  it('without a promoted rule, the new ORM produces NO relation (proves the rule is what adds it)', () => {
    const { inputs, index } = repoWithNewOrm()
    const empty = composeRelationRuleContext({ dbAccess: [] })
    expect(emitPromotedRelations(empty, inputs, index)).toEqual([])
  })

  it('regression invariant: a rule for a hard-coded ORM (@prisma/client) is STRIPPED → no double-emit', () => {
    const ctx = composeRelationRuleContext({
      dbAccess: [{ ormLabel: 'prisma', clientPackages: ['@prisma/client'], operationByMethod: { findMany: 'select' } }],
    })
    expect(ctx.dbAccess).toEqual([]) // fully hard-coded → dropped
  })

  it('a mixed rule keeps only the novel package', () => {
    const ctx = composeRelationRuleContext({
      dbAccess: [{ ormLabel: 'x', clientPackages: ['@prisma/client', '@neworm/db'], operationByMethod: { fetchMany: 'select' } }],
    })
    expect(ctx.dbAccess).toHaveLength(1)
    expect(ctx.dbAccess[0].clientPackages).toEqual(['@neworm/db'])
  })

  it('end-to-end (in-memory): composed context emits the relation for the novel ORM', () => {
    const { inputs, index } = repoWithNewOrm()
    const ctx = composeRelationRuleContext({ dbAccess: [newOrmRule] })
    const rels = emitPromotedRelations(ctx, inputs, index)
    expect(rels.map((r) => r.canonicalTarget)).toEqual(['db:users:insert'])
  })
})
