import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { emitDbAccessRelationsForRule, type DbAccessEmitRule } from '@/pipeline_modules/build_relations/rule_authoring/db_access_promote_gate.js'
import type { GraphQuery } from '@/pipeline_modules/graph_query/index.js'
import { bindCandidateAnchor } from '@/pipeline_modules/build_relations/rule_authoring/anchor_binding.js'
import type { AuthoredRelationRule } from '@/pipeline_modules/build_relations/rule_authoring/autonomous_loop.js'

// G3: the agent can author the receiver→table TRAVERSAL as a GraphQuery (not just packages/methods). This
// proves a NON-standard ORM — whose table lives in an @Entity('…') decorator on the entity CLASS (reached by
// a 3-hop walk the default RECEIVER_MODEL_QUERY can't do) — is recovered by the agent-authored query, and the
// referee/emit interpret it via the shared runGraphQuery interpreter.

let edgeId = 1
function node(p: Partial<CodeNodeLike> & Pick<CodeNodeLike, 'id' | 'type' | 'filePath'>): CodeNodeLike {
  return { repoId: 'r', name: p.id.split(':').pop() ?? p.id, lineStart: null, lineEnd: null, ...p } as CodeNodeLike
}
function edge(p: Partial<CodeEdgeLike> & Pick<CodeEdgeLike, 'sourceId' | 'relation'>): CodeEdgeLike {
  return { id: edgeId++, repoId: 'r', targetId: null, targetSpecifier: null, targetSymbol: null, typeRefSubtype: null,
    chainPath: null, firstArg: null, literalArgs: null, argExpressions: null, resolveStatus: 'resolved', confidence: null, source: 'static', ...p } as CodeEdgeLike
}

// `@fancy/orm`: this.userRepo.find(); userRepo: Repository<User>; @Entity('app_users') class User {}.
// The table 'app_users' is in @Entity on the CLASS — NOT in any model→table map, and 3 hops from the call.
function fancyOrmRepo() {
  edgeId = 1
  const file = node({ id: 'r:a.ts', type: 'file', filePath: 'a.ts' })
  const method = node({ id: 'r:a.ts:Svc.m', type: 'method', filePath: 'a.ts', name: 'm' })
  const field = node({ id: 'r:a.ts:Svc.userRepo', type: 'property', filePath: 'a.ts', name: 'userRepo' })
  const userClass = node({ id: 'r:a.ts:User', type: 'class', filePath: 'a.ts', name: 'User' })
  const edges: CodeEdgeLike[] = [
    edge({ sourceId: file.id, relation: 'imports', targetSpecifier: '@fancy/orm' }),
    edge({ sourceId: method.id, relation: 'calls', targetSymbol: 'find', chainPath: 'this.userRepo' }),
    edge({ sourceId: method.id, relation: 'resolves_to', targetId: field.id, targetSymbol: 'userRepo' }),
    edge({ sourceId: field.id, relation: 'type_ref', targetSymbol: 'User', targetId: userClass.id }),
    edge({ sourceId: userClass.id, relation: 'decorates', targetSymbol: 'Entity', firstArg: "'app_users'" }),
  ]
  const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, method, field, userClass], edges, models: [] as never }
  return { inputs, index: buildSemanticIndex(inputs) }
}

// the agent-authored traversal: call → resolves_to(field) → type_ref(entity class) → decorates(@Entity)→ table
const ENTITY_TABLE_QUERY: GraphQuery = {
  steps: [
    { edge: 'resolves_to', direction: 'out', viaReceiver: true },
    { edge: 'type_ref', direction: 'out' },
    { edge: 'decorates', direction: 'out', viaSymbol: 'Entity' },
  ],
  read: { decorates: 'firstArgToken' },
  resolveThrough: 'none',
}

const baseRule: DbAccessEmitRule = { ormLabel: 'fancyorm', clientPackages: ['@fancy/orm'], operationByMethod: { find: 'select' }, tableSource: 'chain' }

describe('G3 — agent-authored GraphQuery traversal (db_access modelQuery)', () => {
  it('the authored 3-hop @Entity query recovers the table the default RECEIVER_MODEL_QUERY cannot', () => {
    const { inputs, index } = fancyOrmRepo()
    const out = emitDbAccessRelationsForRule({ ...baseRule, modelQuery: ENTITY_TABLE_QUERY }, inputs, index)
    expect(out).toHaveLength(1)
    expect(out[0].target).toBe('app_users') // read from @Entity('app_users') via the authored traversal
    expect(out[0].canonicalTarget).toBe('db:app_users:select')
    expect(out[0].confidence).toBe('high') // traced (verified), not a low-confidence guess
  })

  it('without the authored query the default cannot reach the @Entity table → unverified heuristic', () => {
    const { inputs, index } = fancyOrmRepo()
    const out = emitDbAccessRelationsForRule(baseRule, inputs, index) // no modelQuery → RECEIVER_MODEL_QUERY
    expect(out).toHaveLength(1)
    expect(out[0].target).not.toBe('app_users') // default 2-hop stops at 'User', not in the model→table map
    expect(out[0].confidence).toBe('low')
  })

  const authoredCandidate = (modelQuery: unknown): AuthoredRelationRule => ({
    kind: 'db_access', candidate: {
      id: 'rel.db_access.fancyorm', ormLabel: '@fancy/orm', clientPackages: ['@fancy/orm'],
      operationByMethod: { find: 'select' }, tableSource: 'chain', modelQuery: modelQuery as never,
      anchorFixture: 'auto', anchorEvidenceEdgeIds: [], support: { matched: 0, examples: [] },
    },
  })
  // The agent authors only packages+methods+(query); the deterministic bindCandidateAnchor validates the
  // untrusted modelQuery (keep a valid one, drop a malformed one) before binding the anchor. NO LLM.
  const runBind = (modelQuery: unknown) => {
    const { inputs, index } = fancyOrmRepo()
    return bindCandidateAnchor(authoredCandidate(modelQuery), inputs, index)
  }

  it('bindCandidateAnchor KEEPS a valid authored modelQuery on the candidate', () => {
    const result = runBind(ENTITY_TABLE_QUERY)
    expect(result.kind).toBe('db_access')
    expect((result as { candidate: { modelQuery?: unknown } }).candidate.modelQuery).toEqual(ENTITY_TABLE_QUERY)
  })

  it('bindCandidateAnchor DROPS a malformed authored modelQuery (untrusted → safe fallback to default)', () => {
    const result = runBind({ steps: [{ edge: 'BOGUS', direction: 'sideways' }], read: {} })
    expect((result as { candidate: { modelQuery?: unknown } }).candidate.modelQuery).toBeUndefined()
  })
})
