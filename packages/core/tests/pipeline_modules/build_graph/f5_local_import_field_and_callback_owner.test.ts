// RED SPEC (describe.skip) — absorbed from pre-refactor build_graph resolution WIP.
// Un-skip + make GREEN when re-implementing resolution on the refactored engine.
// Reference impl: ~/main-wip-backup/source.patch ; design: specs/static_analysis_strategy/ideal_architecture_reverse_design.md
/**
 * Bug: cross-file `this.<field>.<method>()` calls and nested object-arg callbacks
 * are dropped from the code graph.
 *
 * Three generalizable root causes (no fixture/repo names — pure AST/F5 rules):
 *
 * [A] Field whose type annotation is a class IMPORTED FROM A LOCAL MODULE
 *     (`./`, `../`, `src/`, `@/`) was classified as `external`, so
 *     `this.field.method()` never resolved to the cross-file class method.
 *     Only node_module imports should be `external`.
 *
 * [B] End-to-end: a `this.field.method()` call, where the field's declared
 *     type is a locally-imported class, must resolve to that class's method.
 *
 * [C] A `this.<method>()` call written INSIDE a nested callback/arrow that is
 *     lexically inside a class method must resolve to the enclosing class
 *     method (the callback inherits the owner class via parent_node_id).
 *
 * [D] An arrow function that is the value of an object-literal property, where
 *     the object literal is (possibly nested) a call argument, must be captured
 *     as a callback node (+ contains edge from its parent).
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'
import type {
  CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap, FieldOriginsMap,
} from '@/pipeline_modules/build_graph/types'

interface FileSpec { filePath: string; source: string }

async function parseFiles(files: FileSpec[]) {
  const adapter = new TypeScriptParserAdapter()
  return Promise.all(
    files.map(async (f) => ({ filePath: f.filePath, ...(await adapter.parseFile(f.source, f.filePath, 'r1')) })),
  )
}

function getOrigin(parseResult: any, className: string, fieldName: string) {
  const fieldOrigins = parseResult.fieldOrigins as
    | Map<string, Map<string, { kind: string; typeName?: string }>>
    | undefined
  if (!fieldOrigins) return undefined
  for (const [classKey, fields] of fieldOrigins) {
    if (classKey.endsWith(`:${className}`) || classKey === className) {
      return fields.get(fieldName)
    }
  }
  return undefined
}

async function runE2E(files: FileSpec[]) {
  const adapter = new TypeScriptParserAdapter()
  const allNodes: CodeNodeRaw[] = []
  const allEdges: CodeEdgeRaw[] = []
  const diMap: ConstructorDIMap = new Map()
  const allOrigins: FieldOriginsMap = new Map()
  const allConstructorParams: { className: string; params: any[] }[] = []
  const allClassesByName = new Map<string, CodeNodeRaw>()

  for (const f of files) {
    const r = await adapter.parseFile(f.source, f.filePath, 'r1')
    const fileNode: CodeNodeRaw = {
      id: `r1:${f.filePath}`, repo_id: 'r1', type: 'file', file_path: f.filePath, name: 'file',
      line_start: null, line_end: null, signature: null, exported: false, parse_status: 'ok',
      is_test: false, test_type: null, is_async: false, jsdoc: null,
    }
    allNodes.push(fileNode, ...r.nodes)
    allEdges.push(...r.edges)
    allConstructorParams.push(...r.constructorParams)
    for (const n of r.nodes) {
      if (n.type === 'class') allClassesByName.set(n.name, n)
    }
    if (r.fieldOrigins) {
      for (const [k, v] of r.fieldOrigins) allOrigins.set(k, v)
    }
  }
  for (const cp of allConstructorParams) {
    const cls = allClassesByName.get(cp.className)
    if (cls) diMap.set(cls.id, cp.params)
  }

  const resolved = await resolveCalls(allEdges, allNodes, diMap, new Map(), allOrigins)
  return { nodes: allNodes, edges: resolved }
}

function findCall(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.find(
    (e) => e.relation === 'calls' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

function makeRawNode(
  overrides: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string },
): CodeNodeRaw {
  return {
    repo_id: 'r1', line_start: 1, line_end: 1, signature: null, exported: true,
    parse_status: 'ok', is_test: false, test_type: null, is_async: false, jsdoc: null,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────
// [A] field type = locally-imported class → internal
// ─────────────────────────────────────────────────────────

describe('local-import field origin [A]', () => {
  it('A1 — annotation = class imported from relative path (../x) → internal(typeName)', async () => {
    const [, ownerRes] = await parseFiles([
      { filePath: 'src/util/repo.ts', source: `export class Repository { findOne() { return 1 } }` },
      {
        filePath: 'src/app/svc.ts',
        source: `
          import { Repository } from '../util/repo'
          export class Svc {
            private readonly repo: Repository;
          }
        `,
      },
    ])
    expect(getOrigin(ownerRes, 'Svc', 'repo')).toEqual({ kind: 'internal', typeName: 'Repository' })
  })

  it('A2 — annotation = class imported from src/ absolute path → internal(typeName)', async () => {
    const [, ownerRes] = await parseFiles([
      { filePath: 'src/util/repo.ts', source: `export class Repository {}` },
      {
        filePath: 'src/app/svc.ts',
        source: `
          import { Repository } from 'src/util/repo'
          export class Svc { private readonly repo: Repository; }
        `,
      },
    ])
    expect(getOrigin(ownerRes, 'Svc', 'repo')).toEqual({ kind: 'internal', typeName: 'Repository' })
  })

  it('A3 — annotation = default-imported class from local path → internal(typeName)', async () => {
    const [, ownerRes] = await parseFiles([
      { filePath: 'src/routes/auth.ts', source: `export default class AuthRouter { getRouter() {} }` },
      {
        filePath: 'src/routes/index.ts',
        source: `
          import AuthRouter from './auth'
          export class Loader { private authRouter: AuthRouter; }
        `,
      },
    ])
    expect(getOrigin(ownerRes, 'Loader', 'authRouter')).toEqual({ kind: 'internal', typeName: 'AuthRouter' })
  })

  it('A4 — annotation = class imported from a node_module stays external (no regression)', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          import { PrismaClient } from '@prisma/client'
          export class Repo { private readonly prisma: PrismaClient; }
        `,
      },
    ])
    expect(getOrigin(res, 'Repo', 'prisma')).toEqual({ kind: 'external' })
  })
})

// ─────────────────────────────────────────────────────────
// [B] e2e: this.field.method() across files → resolved
// ─────────────────────────────────────────────────────────

describe('cross-file this.field.method resolution [B]', () => {
  it('B1 — this.repo.findOne() where repo: Repository (local import) → resolved to Repository.findOne', async () => {
    const { edges } = await runE2E([
      { filePath: 'src/util/repo.ts', source: `export class Repository { findOne() { return 1 } }` },
      {
        filePath: 'src/app/svc.ts',
        source: `
          import { Repository } from '../util/repo'
          export class Svc {
            private readonly repo: Repository;
            run() { return this.repo.findOne(); }
          }
        `,
      },
    ])
    const e = findCall(edges, 'findOne', ':Svc.run')
    expect(e?.resolve_status).toBe('resolved')
    expect(e?.target_id).toMatch(/util\/repo\.ts:Repository\.findOne$/)
  })
})

// ─────────────────────────────────────────────────────────
// [C] this.method() inside a nested callback → resolved to enclosing class
// ─────────────────────────────────────────────────────────

describe('callback owner-class inheritance [C]', () => {
  it('C1 — this.helper() called inside a callback returned from a class method → resolved', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/x.ts',
        source: `
          export class Mw {
            helper(): number { return 1; }
            build(): () => number {
              return (): number => {
                return this.helper();
              };
            }
          }
        `,
      },
    ])
    const e = edges.find(
      (c) => c.relation === 'calls' && c.target_symbol === 'helper' &&
        c.source_id.includes(':Mw.build:returnedFunction:'),
    )
    expect(e).toBeDefined()
    expect(e?.resolve_status).toBe('resolved')
    expect(e?.target_id).toMatch(/:Mw\.helper$/)
  })
})

// ─────────────────────────────────────────────────────────
// [E] namespace import of a LOCAL module: ns.fn() → resolved to exported fn
// ─────────────────────────────────────────────────────────

describe('namespace import of local module [E]', () => {
  it('E1 — import * as cache from "./redis"; cache.del() → resolved to exported del', async () => {
    // F5 unit: F3a가 namespace import를 file 노드로 resolved 한 상태를 전제 (그 출력 계약).
    const redisFile: CodeNodeRaw = makeRawNode({ id: 'r1:src/redis.ts', type: 'file', name: 'file', file_path: 'src/redis.ts', exported: false })
    const delFn: CodeNodeRaw = makeRawNode({ id: 'r1:src/redis.ts:del', type: 'function', name: 'del', file_path: 'src/redis.ts', exported: true })
    const svcClass: CodeNodeRaw = makeRawNode({ id: 'r1:src/svc.ts:Svc', type: 'class', name: 'Svc', file_path: 'src/svc.ts' })
    const runMethod: CodeNodeRaw = makeRawNode({ id: 'r1:src/svc.ts:Svc.run', type: 'method', name: 'Svc.run', file_path: 'src/svc.ts' })
    const svcFile: CodeNodeRaw = makeRawNode({ id: 'r1:src/svc.ts', type: 'file', name: 'file', file_path: 'src/svc.ts', exported: false })

    const importEdge: CodeEdgeRaw = {
      repo_id: 'r1', source_id: svcFile.id, target_id: redisFile.id, relation: 'imports',
      target_specifier: './redis', target_symbol: 'cache', target_local_symbol: 'cache',
      resolve_status: 'resolved', first_arg: null, literal_args: null, chain_path: null,
    }
    const callEdge: CodeEdgeRaw = {
      repo_id: 'r1', source_id: runMethod.id, target_id: null, relation: 'calls',
      target_specifier: './redis', target_symbol: 'del', chain_path: 'cache',
      resolve_status: 'pending', first_arg: null, literal_args: null,
    }

    const resolved = await resolveCalls(
      [importEdge, callEdge],
      [redisFile, delFn, svcFile, svcClass, runMethod],
      new Map(), new Map(), new Map(),
    )
    const e = resolved.find((c) => c.relation === 'calls' && c.target_symbol === 'del')
    expect(e?.resolve_status).toBe('resolved')
    expect(e?.target_id).toBe(delFn.id)
  })
})

// ─────────────────────────────────────────────────────────
// [D] arrow value of object-literal property inside a call arg → callback node
// ─────────────────────────────────────────────────────────

describe.skip('nested object-arg callback node extraction [D]', () => {
  it('D1 — { stream: { write: (m) => sink(m) } } as a call arg captures the write arrow as a callback node', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          import { sink } from './sink'
          import { mw } from './mw'
          export class App {
            init(): void {
              mw(
                'fmt',
                { stream: { write: (message: string) => sink(message) } }
              );
            }
          }
        `,
      },
    ])
    const cb = res.nodes.find(
      (n: CodeNodeRaw) => n.type === 'function' && n.name.includes('init.callback@'),
    )
    expect(cb, 'expected a callback node for the nested object-arg arrow').toBeDefined()
    // parent (the init method) contains the callback
    const contains = res.edges.find(
      (e: CodeEdgeRaw) =>
        e.relation === 'contains' && e.target_id === cb!.id && e.source_id.endsWith(':App.init'),
    )
    expect(contains, 'expected contains edge App.init -> callback').toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────
// [F] callback node → parent function `calls` edge (inverse of contains)
//
// Downstream build_docs traversal (traverseCallEdges) inner-joins on
// codeEdges.targetId IS NOT NULL. A callback node is reachable from its parent
// via the `contains` edge, but the parent is NOT reachable from the callback
// because no edge originates at the callback toward the parent. When a callback
// is itself an entrypoint (route handler arrow), its enclosing function's
// context is then dropped during document generation. The adapter must emit a
// `calls` edge from the callback to its parent_node_id with target_id and
// target_symbol (the parent's name) populated — the inverse of the contains
// edge it already creates.
// ─────────────────────────────────────────────────────────

describe('callback → parent calls edge [F]', () => {
  function findCallbackNode(nodes: CodeNodeRaw[]): CodeNodeRaw | undefined {
    return nodes.find((n) => n.type === 'function' && (n as any).origin_kind === 'callback')
  }

  it('F1 — a nested callback emits a calls edge to its parent function with target_id + target_symbol set', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          import { register } from './register'
          export class Router {
            mount(): void {
              register('/path', (req: any, res: any) => {
                res.send(req.body);
              });
            }
          }
        `,
      },
    ])
    const cb = findCallbackNode(res.nodes)
    expect(cb, 'expected a callback node for the call-arg arrow').toBeDefined()
    const parentId = cb!.parent_node_id
    expect(parentId, 'callback must carry a parent_node_id').toBeTruthy()
    const parent = res.nodes.find((n) => n.id === parentId)
    expect(parent, 'parent node must exist in graph').toBeDefined()

    const callsEdge = res.edges.find(
      (e: CodeEdgeRaw) =>
        e.relation === 'calls' && e.source_id === cb!.id && e.target_id === parentId,
    )
    expect(callsEdge, 'expected calls edge callback -> parent with target_id populated').toBeDefined()
    expect(callsEdge!.target_id).toBe(parentId)
    // target_symbol is the callee's bare symbol (last segment of a qualified
    // Owner.method name) — matching how every resolved calls edge stores the
    // symbol and what the LSP oracle requires.
    expect(callsEdge!.target_symbol).toBe(parent!.name.split('.').at(-1))
    expect(callsEdge!.resolve_status).toBe('resolved')
  })

  it('F2 — a returned-function callback also emits a calls edge to its parent', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/y.ts',
        source: `
          export class Mw {
            helper(): number { return 1; }
            build(): () => number {
              return (): number => {
                return this.helper();
              };
            }
          }
        `,
      },
    ])
    const cb = findCallbackNode(res.nodes)
    expect(cb, 'expected a returned-function callback node').toBeDefined()
    const parentId = cb!.parent_node_id
    const parent = res.nodes.find((n) => n.id === parentId)
    const callsEdge = res.edges.find(
      (e: CodeEdgeRaw) =>
        e.relation === 'calls' && e.source_id === cb!.id && e.target_id === parentId,
    )
    expect(callsEdge, 'expected calls edge returnedFunction -> parent').toBeDefined()
    expect(callsEdge!.target_symbol).toBe(parent!.name.split('.').at(-1))
  })
})
