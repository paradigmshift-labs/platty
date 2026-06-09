import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { emitDbAccessRelationsForRule, type DbAccessEmitRule } from '@/pipeline_modules/build_relations/rule_authoring/db_access_promote_gate.js'

// db_access receiver-tracing via the build_graph def-use `resolves_to` edge (the REAL fix for the table
// bug, unblocked by the def-use edge). `this.userRepo.find()` where the chain receiver `userRepo` is NOT a
// model — trace it: call's method --resolves_to--> field `userRepo` --decorates--> @InjectModel('User')
// (or --type_ref--> Model<User>) → the User model → its table. 1-3 hop graph traversal, not a name guess.

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

// class C { @InjectModel('User') userRepo; m() { this.userRepo.find() } }  — via `modelFrom` pick the field
// edge that names the model: a decorator first-arg OR a generic type ref.
function repo(modelFrom: 'decorator' | 'type', models: BuildRelationsInputs['models']) {
  edgeId = 1
  const file = node({ id: 'r:a.ts', type: 'file', filePath: 'a.ts' })
  const cls = node({ id: 'r:a.ts:C', type: 'class', filePath: 'a.ts', name: 'C' })
  const method = node({ id: 'r:a.ts:C.m', type: 'method', filePath: 'a.ts', name: 'm' })
  const field = node({ id: 'r:a.ts:C.userRepo', type: 'property', filePath: 'a.ts', name: 'userRepo' })
  const edges: CodeEdgeLike[] = [
    edge({ sourceId: file.id, relation: 'imports', targetSpecifier: '@some/orm' }),
    edge({ sourceId: method.id, relation: 'calls', targetSymbol: 'find', chainPath: 'this.userRepo' }),
    // the def-use edge build_graph now emits: method --resolves_to--> the userRepo field declaration
    edge({ sourceId: method.id, relation: 'resolves_to', targetId: field.id, targetSymbol: 'userRepo' }),
    // model-recovery edge on the field
    modelFrom === 'decorator'
      ? edge({ sourceId: field.id, relation: 'decorates', targetSymbol: 'InjectModel', firstArg: "'User'" })
      : edge({ sourceId: field.id, relation: 'type_ref', targetSymbol: 'User', typeRefSubtype: 'generic_arg' }),
  ]
  const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, cls, method, field], edges, models }
  return { inputs, index: buildSemanticIndex(inputs) }
}
const rule: DbAccessEmitRule = { ormLabel: 'someorm', clientPackages: ['@some/orm'], operationByMethod: { find: 'select' }, tableSource: 'chain' }

describe('db_access receiver-tracing via def-use resolves_to (the real table fix)', () => {
  it('traces this.userRepo.find() → field → @InjectModel(User) → users table, HIGH confidence', () => {
    const { inputs, index } = repo('decorator', [{ modelName: 'User', tableName: 'users' }] as never)
    const out = emitDbAccessRelationsForRule(rule, inputs, index)
    expect(out).toHaveLength(1)
    expect(out[0].target).toBe('users') // NOT 'userRepo'
    expect(out[0].confidence).toBe('high') // verified via tracing, not a low-confidence guess
  })

  it('traces via the field generic TYPE (Repository<User>/Model<User>) too', () => {
    const { inputs, index } = repo('type', [{ modelName: 'User', tableName: 'users' }] as never)
    const out = emitDbAccessRelationsForRule(rule, inputs, index)
    expect(out[0]?.target).toBe('users')
    expect(out[0]?.confidence).toBe('high')
  })

  it('no resolves_to / unknown receiver → stays the low-confidence heuristic (B), never wrong-HIGH', () => {
    // a field whose model edge names something NOT in the model map → tracing yields nothing → fallback
    const { inputs, index } = repo('decorator', []) // models empty → User not known
    const out = emitDbAccessRelationsForRule(rule, inputs, index)
    expect(out[0]?.target).toBe('userRepo') // unresolved heuristic
    expect(out[0]?.confidence).toBe('low') // never high when unverified
  })
})

describe('reconcile #1 — requireReceiverIdentity tightens detection to imperative precision', () => {
  const strictRule: DbAccessEmitRule = { ...rule, requireReceiverIdentity: true }

  it('a VERIFIED model is kept (the gate only fires on UNVERIFIED emissions)', () => {
    const { inputs, index } = repo('decorator', [{ modelName: 'User', tableName: 'users' }] as never)
    const out = emitDbAccessRelationsForRule(strictRule, inputs, index)
    expect(out).toHaveLength(1)
    expect(out[0].target).toBe('users')
    expect(out[0].confidence).toBe('high')
  })

  it('an UNVERIFIED receiver with no db_client identity is DROPPED — the over-emit FP (postService/toUser)', () => {
    const { inputs, index } = repo('decorator', []) // User not known → unverified; no classFieldOrigins → identity null
    expect(emitDbAccessRelationsForRule(rule, inputs, index)).toHaveLength(1) // file-gate: low-confidence guess
    expect(emitDbAccessRelationsForRule(rule, inputs, index)[0].confidence).toBe('low')
    expect(emitDbAccessRelationsForRule(strictRule, inputs, index)).toHaveLength(0) // reconcile #1 drops it
  })
})
