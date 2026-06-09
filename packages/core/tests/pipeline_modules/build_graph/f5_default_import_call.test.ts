// RED SPEC (describe.skip) — absorbed from pre-refactor build_graph resolution WIP.
// Un-skip + make GREEN when re-implementing resolution on the refactored engine.
// Reference impl: ~/main-wip-backup/source.patch ; design: specs/static_analysis_strategy/ideal_architecture_reverse_design.md
// Default-import call-target resolution.
// A default-imported free function called directly (`import f from './m'; f(x)`)
// must resolve its `calls` edge target_id — the default import is already resolved
// on the file-level `imports` edge (target_symbol='default', target_local_symbol='f'),
// but the call site references the symbol by its LOCAL binding name (`f`).
// Generalizable AST/symbol-semantics rule: a call uses the local symbol, so the
// import index must be keyed by the local symbol, not only by target_symbol.
import { describe, it, expect } from 'vitest'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls.js'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap } from '@/pipeline_modules/build_graph/types.js'

function mkNode(o: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string }): CodeNodeRaw {
  return { repo_id: 'r1', line_start: 1, line_end: 5, signature: null, exported: true, parse_status: 'ok', is_test: false, test_type: null, is_async: false, jsdoc: null, ...o }
}
function mkEdge(o: Partial<CodeEdgeRaw> & { source_id: string; relation: CodeEdgeRaw['relation'] }): CodeEdgeRaw {
  return { repo_id: 'r1', target_id: null, target_specifier: null, target_symbol: null, source: 'static', resolve_status: 'pending', ...o }
}

describe('F5: default-import call-target resolution', () => {
  it('DI-DEFAULT-01: `import f from "./m"; f(x)` resolves the calls edge to the default-exported function', async () => {
    const MAPPER = 'src/mapper.ts'
    const SERVICE = 'src/service.ts'
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${MAPPER}`, type: 'file', name: 'file', file_path: MAPPER, exported: false }),
      mkNode({ id: `r1:${MAPPER}:mapItem`, type: 'function', name: 'mapItem', file_path: MAPPER, is_default_export: true }),
      mkNode({ id: `r1:${SERVICE}`, type: 'file', name: 'file', file_path: SERVICE, exported: false }),
      mkNode({ id: `r1:${SERVICE}:listItems`, type: 'function', name: 'listItems', file_path: SERVICE }),
    ]
    const edges: CodeEdgeRaw[] = [
      // default import — resolved on the imports edge. target_symbol='default',
      // local binding name 'mapItem' on target_local_symbol. target_id → the function node.
      mkEdge({
        source_id: `r1:${SERVICE}`,
        relation: 'imports',
        target_id: `r1:${MAPPER}:mapItem`,
        target_specifier: './mapper',
        target_symbol: 'default',
        target_imported_symbol: 'default',
        target_local_symbol: 'mapItem',
        resolve_status: 'resolved',
      }),
      // direct call by the local binding name — no chain_path, no this./super.
      mkEdge({
        source_id: `r1:${SERVICE}:listItems`,
        relation: 'calls',
        target_specifier: './mapper',
        target_symbol: 'mapItem',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map() as ConstructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls')
    expect(callEdge!.resolve_status).toBe('resolved')
    expect(callEdge!.target_id).toBe(`r1:${MAPPER}:mapItem`)
  })

  it('DI-DEFAULT-02: named imports are unaffected (target_symbol === local name still resolves)', async () => {
    const MOD = 'src/mod.ts'
    const CALLER = 'src/caller.ts'
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${MOD}`, type: 'file', name: 'file', file_path: MOD, exported: false }),
      mkNode({ id: `r1:${MOD}:helper`, type: 'function', name: 'helper', file_path: MOD }),
      mkNode({ id: `r1:${CALLER}`, type: 'file', name: 'file', file_path: CALLER, exported: false }),
      mkNode({ id: `r1:${CALLER}:run`, type: 'function', name: 'run', file_path: CALLER }),
    ]
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${CALLER}`,
        relation: 'imports',
        target_id: `r1:${MOD}:helper`,
        target_specifier: './mod',
        target_symbol: 'helper',
        target_imported_symbol: 'helper',
        target_local_symbol: 'helper',
        resolve_status: 'resolved',
      }),
      mkEdge({
        source_id: `r1:${CALLER}:run`,
        relation: 'calls',
        target_specifier: './mod',
        target_symbol: 'helper',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map() as ConstructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls')
    expect(callEdge!.resolve_status).toBe('resolved')
    expect(callEdge!.target_id).toBe(`r1:${MOD}:helper`)
  })
})
