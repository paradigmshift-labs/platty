import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { traceReceiverIdentity } from '@/pipeline_modules/build_relations/graph_trace/receiver_identity.js'

// G6 — def-use precision for the db_client RECEIVER IDENTITY. A local/module-const receiver
// (`const orm = new PrismaClient(); orm.user.findMany()`) must resolve to db_client identity by WALKING the
// already-emitted def-use graph (call-site --resolves_to--> the `orm` declaration --calls--> `new
// PrismaClient()`), reading the identity off the LIBRARY CONSTRUCTOR — NOT by guessing the variable is named
// "prisma". The name-heuristic crutch (looksLikeDbReceiver) is DEMOTED to a strictly-lower-priority fallback,
// kept only for receivers this precise walk can't reach (DI-field / method-return / factory-init).

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

// `const <varName> = new PrismaClient(); <varName>.user.findMany()` — build_graph emits:
//   method --resolves_to--> the var declaration (targetSymbol = varName)   [HOP 1, def-use]
//   var-decl --calls--> { targetSymbol:'PrismaClient', targetSpecifier:'@prisma/client' }  [HOP 2, ctor]
function moduleConstRepo(varName: string, ctorSymbol = 'PrismaClient', ctorPackage = '@prisma/client') {
  edgeId = 1
  const file = node({ id: 'r:a.ts', type: 'file', filePath: 'a.ts', name: 'a.ts' })
  const method = node({ id: 'r:a.ts:svc.listUsers', type: 'method', filePath: 'a.ts', name: 'listUsers' })
  const varDecl = node({ id: `r:a.ts:${varName}`, type: 'variable', filePath: 'a.ts', name: varName })
  const edges: CodeEdgeLike[] = [
    edge({ sourceId: method.id, relation: 'calls', targetSymbol: 'findMany', chainPath: `${varName}.user` }),
    edge({ sourceId: method.id, relation: 'resolves_to', targetId: varDecl.id, targetSymbol: varName }),
    edge({ sourceId: varDecl.id, relation: 'calls', targetSymbol: ctorSymbol, targetSpecifier: ctorPackage }),
  ]
  const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, method, varDecl], edges, models: [] as never }
  return { inputs, index: buildSemanticIndex(inputs), methodId: method.id, varName }
}

describe('G6 — db_client receiver identity via def-use resolves_to (name-independent)', () => {
  it('resolves a NON-db-like-named receiver `const orm = new PrismaClient()` → db_client/prisma HIGH', () => {
    // 'orm' does NOT match looksLikeDbReceiver, so the name crutch CANNOT fire — identity must come purely
    // from the def-use walk to the `new PrismaClient()` constructor. (RED before G6: returns null.)
    const { inputs, index, methodId, varName } = moduleConstRepo('orm')
    const id = traceReceiverIdentity({ nodeId: methodId, chainPath: `${varName}.user`, index })
    expect(id?.kind).toBe('db_client')
    expect(id?.orm).toBe('prisma')
    expect(id?.confidence).toBe('high') // verified via the library constructor, not a name guess
  })

  it('resolves the db-like-named `const prisma = new PrismaClient()` identically (same precise path)', () => {
    const { inputs, index, methodId, varName } = moduleConstRepo('prisma')
    const id = traceReceiverIdentity({ nodeId: methodId, chainPath: `${varName}.user`, index })
    expect(id?.kind).toBe('db_client')
    expect(id?.orm).toBe('prisma')
    expect(id?.confidence).toBe('high')
  })

  it('resolves by the constructor PACKAGE even when the ctor type-name is not a known regex', () => {
    // detectOrmFromTypeName prefers the package specifier: a db client whose ctor symbol the type-name
    // regexes don't cover still resolves via @prisma/client on the ctor edge (robustness, not name).
    const { inputs, index, methodId, varName } = moduleConstRepo('client', 'MakeClient', '@prisma/client')
    const id = traceReceiverIdentity({ nodeId: methodId, chainPath: `${varName}.user`, index })
    expect(id?.orm).toBe('prisma')
  })

  it('NEGATIVE: a non-db constructor (`const x = makeThing()`) yields NO identity — never wrong-HIGH', () => {
    // resolves_to reaches the decl, but its ctor is a non-db factory → def-use yields nothing, and the name
    // 'x' is not db-like → no crutch fallback → null (precision preserved).
    edgeId = 1
    const file = node({ id: 'r:b.ts', type: 'file', filePath: 'b.ts', name: 'b.ts' })
    const method = node({ id: 'r:b.ts:svc.run', type: 'method', filePath: 'b.ts', name: 'run' })
    const varDecl = node({ id: 'r:b.ts:x', type: 'variable', filePath: 'b.ts', name: 'x' })
    const edges: CodeEdgeLike[] = [
      edge({ sourceId: method.id, relation: 'resolves_to', targetId: varDecl.id, targetSymbol: 'x' }),
      edge({ sourceId: varDecl.id, relation: 'calls', targetSymbol: 'makeThing', targetSpecifier: './factory' }),
    ]
    const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, method, varDecl], edges, models: [] as never }
    const id = traceReceiverIdentity({ nodeId: method.id, chainPath: 'x.foo', index: buildSemanticIndex(inputs) })
    expect(id).toBeNull()
  })

  it('RECALL-SAFETY: the name crutch STILL fires (guarded fallback) when no def-use edge reaches a db ctor', () => {
    // db-like name + same-file db-client import evidence, but NO resolves_to to a `new PrismaClient()` decl
    // (e.g. a DI-field / factory receiver the precise walk can't reach). The demoted crutch must still
    // resolve it so removing the name-DEPENDENCE does not cost recall.
    edgeId = 1
    const file = node({ id: 'r:c.ts', type: 'file', filePath: 'c.ts', name: 'c.ts' })
    const method = node({ id: 'r:c.ts:svc.find', type: 'method', filePath: 'c.ts', name: 'find' })
    const edges: CodeEdgeLike[] = [
      edge({ sourceId: file.id, relation: 'imports', targetSymbol: 'PrismaClient', targetSpecifier: '@prisma/client' }),
      edge({ sourceId: method.id, relation: 'calls', targetSymbol: 'find', chainPath: 'prisma.user' }),
    ]
    const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, method], edges, models: [] as never }
    const id = traceReceiverIdentity({ nodeId: method.id, chainPath: 'prisma.user', index: buildSemanticIndex(inputs) })
    expect(id?.kind).toBe('db_client')
    expect(id?.orm).toBe('prisma')
  })
})
