// RED SPEC (describe.skip) — absorbed from pre-refactor build_graph resolution WIP.
// Un-skip + make GREEN when re-implementing resolution on the refactored engine.
// Reference impl: ~/main-wip-backup/source.patch ; design: specs/static_analysis_strategy/ideal_architecture_reverse_design.md
// DI field typed as an interface → resolve method on the single concrete implementer.
// Generalizable LSP-style rule: `constructor(private x: IFoo)` + `this.x.bar()` where a
// single class `Foo implements IFoo` defines `bar()` → resolve to `Foo.bar`.
// Real-world driver: nodejs-express-typescript-prisma-starter — UserService.create calls
// `this.unitOfWork.transaction(...)` where `unitOfWork: IUnitOfWork` and
// `UnitOfWork implements IUnitOfWork`. The `implements` edge target_id may be unresolved,
// so resolution must work off the interface name alone. No fixture/repo name branching (G3).
import { describe, it, expect } from 'vitest'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls.js'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap } from '@/pipeline_modules/build_graph/types.js'

function mkNode(o: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string }): CodeNodeRaw {
  return { repo_id: 'r1', line_start: 1, line_end: 5, signature: null, exported: true, parse_status: 'ok', is_test: false, test_type: null, is_async: false, jsdoc: null, ...o }
}
function mkEdge(o: Partial<CodeEdgeRaw> & { source_id: string; relation: CodeEdgeRaw['relation'] }): CodeEdgeRaw {
  return { repo_id: 'r1', target_id: null, target_specifier: null, target_symbol: null, source: 'static', resolve_status: 'pending', ...o }
}

describe('DI field typed as interface → single concrete implementer method', () => {
  it('DI-IFACE-01: this.unitOfWork.transaction() resolves to UnitOfWork.transaction (interface-typed field)', async () => {
    const IFACE = 'src/repositories/interfaces/iunitofwork.repository.ts'
    const IMPL = 'src/repositories/unitofwork.repository.ts'
    const SVC = 'src/services/user.service.ts'

    const nodes: CodeNodeRaw[] = [
      // interface
      mkNode({ id: `r1:${IFACE}`, type: 'file', name: 'file', file_path: IFACE }),
      mkNode({ id: `r1:${IFACE}:IUnitOfWork`, type: 'interface', name: 'IUnitOfWork', file_path: IFACE }),
      // concrete implementer
      mkNode({ id: `r1:${IMPL}`, type: 'file', name: 'file', file_path: IMPL }),
      mkNode({ id: `r1:${IMPL}:UnitOfWork`, type: 'class', name: 'UnitOfWork', file_path: IMPL }),
      mkNode({ id: `r1:${IMPL}:UnitOfWork.transaction`, type: 'method', name: 'UnitOfWork.transaction', file_path: IMPL }),
      // service that DI-injects the interface
      mkNode({ id: `r1:${SVC}`, type: 'file', name: 'file', file_path: SVC }),
      mkNode({ id: `r1:${SVC}:UserService`, type: 'class', name: 'UserService', file_path: SVC }),
      mkNode({ id: `r1:${SVC}:UserService.create`, type: 'method', name: 'UserService.create', file_path: SVC }),
    ]

    const constructorDIMap: ConstructorDIMap = new Map([
      [`r1:${SVC}:UserService`, [{ fieldName: 'unitOfWork', typeName: 'IUnitOfWork' }]],
    ])

    const edges: CodeEdgeRaw[] = [
      // implements edge — unresolved target_id, mirroring the real default-export interface case
      mkEdge({
        source_id: `r1:${IMPL}:UnitOfWork`,
        relation: 'implements',
        target_symbol: 'IUnitOfWork',
        resolve_status: 'pending',
      }),
      // the call under test
      mkEdge({
        source_id: `r1:${SVC}:UserService.create`,
        relation: 'calls',
        target_specifier: 'this.unitOfWork.transaction',
        target_symbol: 'transaction',
        chain_path: 'this.unitOfWork',
      }),
    ]

    const result = await resolveCalls(edges, nodes, constructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls' && e.target_symbol === 'transaction')
    expect(callEdge!.resolve_status).toBe('resolved')
    expect(callEdge!.target_id).toBe(`r1:${IMPL}:UnitOfWork.transaction`)
  })

  it('DI-IFACE-02: ambiguous — two implementers of the same interface → not resolved (no false positive)', async () => {
    const IFACE = 'src/i.ts'
    const A = 'src/a.ts'
    const B = 'src/b.ts'
    const SVC = 'src/svc.ts'

    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${IFACE}`, type: 'file', name: 'file', file_path: IFACE }),
      mkNode({ id: `r1:${IFACE}:IRepo`, type: 'interface', name: 'IRepo', file_path: IFACE }),
      mkNode({ id: `r1:${A}`, type: 'file', name: 'file', file_path: A }),
      mkNode({ id: `r1:${A}:RepoA`, type: 'class', name: 'RepoA', file_path: A }),
      mkNode({ id: `r1:${A}:RepoA.save`, type: 'method', name: 'RepoA.save', file_path: A }),
      mkNode({ id: `r1:${B}`, type: 'file', name: 'file', file_path: B }),
      mkNode({ id: `r1:${B}:RepoB`, type: 'class', name: 'RepoB', file_path: B }),
      mkNode({ id: `r1:${B}:RepoB.save`, type: 'method', name: 'RepoB.save', file_path: B }),
      mkNode({ id: `r1:${SVC}`, type: 'file', name: 'file', file_path: SVC }),
      mkNode({ id: `r1:${SVC}:Svc`, type: 'class', name: 'Svc', file_path: SVC }),
      mkNode({ id: `r1:${SVC}:Svc.run`, type: 'method', name: 'Svc.run', file_path: SVC }),
    ]
    const constructorDIMap: ConstructorDIMap = new Map([
      [`r1:${SVC}:Svc`, [{ fieldName: 'repo', typeName: 'IRepo' }]],
    ])
    const edges: CodeEdgeRaw[] = [
      mkEdge({ source_id: `r1:${A}:RepoA`, relation: 'implements', target_symbol: 'IRepo' }),
      mkEdge({ source_id: `r1:${B}:RepoB`, relation: 'implements', target_symbol: 'IRepo' }),
      mkEdge({
        source_id: `r1:${SVC}:Svc.run`,
        relation: 'calls',
        target_specifier: 'this.repo.save',
        target_symbol: 'save',
        chain_path: 'this.repo',
      }),
    ]
    const result = await resolveCalls(edges, nodes, constructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls' && e.target_symbol === 'save')
    expect(callEdge!.target_id).toBeNull()
    expect(callEdge!.resolve_status).not.toBe('resolved')
  })
})
