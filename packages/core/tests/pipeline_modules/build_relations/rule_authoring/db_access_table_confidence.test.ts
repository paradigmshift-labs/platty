import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { emitDbAccessRelationsForRule, type DbAccessEmitRule } from '@/pipeline_modules/build_relations/rule_authoring/db_access_promote_gate.js'

// B (harm reduction for the live db_access table bug): a chain ORM guesses the table from the receiver
// NAME; that guess is only VERIFIED when it resolves through the model→table map. An unresolved chain
// receiver (a DI repo var like `userRepo`, which is really Repository<User> → the `user` table) falls
// through `?? rawModel` and emitted the raw token as a HIGH-confidence table — corrupting impact analysis.
// Until receiver-tracing (def-use) lands, emit such unverified tables at LOW confidence so they can't
// masquerade as verified. first_arg ORMs carry the table literally in the call → still verified/high.

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
// a repo importing '@some/orm' with `<receiver>.find()`; `models` controls whether the receiver resolves.
function repo(call: Partial<CodeEdgeLike>, models: BuildRelationsInputs['models']) {
  edgeId = 1
  const file = node({ id: 'r:a.ts', type: 'file', filePath: 'a.ts' })
  const fn = node({ id: 'r:a.ts:f', type: 'function', filePath: 'a.ts' })
  const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: '@some/orm' })
  const c = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'find', ...call })
  const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, fn], edges: [imp, c], models }
  return { inputs, index: buildSemanticIndex(inputs) }
}
const chainRule: DbAccessEmitRule = { ormLabel: 'someorm', clientPackages: ['@some/orm'], operationByMethod: { find: 'select' }, tableSource: 'chain' }

describe('db_access emit confidence reflects table VERIFICATION (B)', () => {
  it('chain receiver that RESOLVES via model→table map → high confidence', () => {
    const { inputs, index } = repo({ chainPath: 'User' }, [{ modelName: 'User', tableName: 'users' }] as never)
    const out = emitDbAccessRelationsForRule(chainRule, inputs, index)
    expect(out).toHaveLength(1)
    expect(out[0].target).toBe('users')
    expect(out[0].confidence).toBe('high')
  })

  it('chain receiver that FALLS THROUGH ?? rawModel (DI repo var, not a known model) → LOW confidence', () => {
    const { inputs, index } = repo({ chainPath: 'userRepo' }, []) // no models → userRepo unresolved
    const out = emitDbAccessRelationsForRule(chainRule, inputs, index)
    expect(out).toHaveLength(1)
    expect(out[0].target).toBe('userRepo') // the unverified heuristic table
    expect(out[0].confidence).toBe('low') // ← was 'high' (the bug)
  })

  it('first_arg ORM (table literal in the call) stays high — the table is in the code, not a guess', () => {
    const firstArgRule: DbAccessEmitRule = { ...chainRule, tableSource: 'first_arg' }
    const { inputs, index } = repo({ targetSymbol: 'insert', firstArg: "'orders'" }, [])
    const rule2: DbAccessEmitRule = { ...firstArgRule, operationByMethod: { insert: 'insert' } }
    const out = emitDbAccessRelationsForRule(rule2, inputs, index)
    expect(out).toHaveLength(1)
    expect(out[0].target).toBe('orders')
    expect(out[0].confidence).toBe('high')
  })
})
