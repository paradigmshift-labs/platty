// F4: type_ref relation 처리 — 어댑터의 메서드 시그니처 타입 발화를 F4가 resolve해야 한다
// SOT: spec scenarios-heroines.md HB-01 (EmailParam DTO 추적)
import { describe, it, expect } from 'vitest'
import { resolveTypeRefs } from '@/pipeline_modules/build_graph/f4_resolve_type_refs.js'
import type { CodeNodeRaw, CodeEdgeRaw } from '@/pipeline_modules/build_graph/types.js'

function mkNode(o: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string }): CodeNodeRaw {
  return {
    repo_id: 'r1',
    line_start: 1,
    line_end: 5,
    signature: null,
    exported: true,
    parse_status: 'ok',
    is_test: false,
    test_type: null,
    is_async: false,
    jsdoc: null,
    ...o,
  }
}

function mkEdge(o: Partial<CodeEdgeRaw> & { source_id: string; relation: CodeEdgeRaw['relation'] }): CodeEdgeRaw {
  return {
    repo_id: 'r1',
    target_id: null,
    target_specifier: null,
    target_symbol: null,
    source: 'static',
    resolve_status: 'pending',
    ...o,
  }
}

describe('F4: type_ref relation 처리 (어댑터 메서드 시그니처 → F4 resolve)', () => {
  it('cross-file type_ref가 imports edge 경유로 resolved 된다 (target_id = type 노드 ID)', async () => {
    const nodes: CodeNodeRaw[] = [
      // dto/types.ts
      mkNode({ id: 'r1:dto/types.ts', type: 'file', name: 'file', file_path: 'dto/types.ts' }),
      mkNode({ id: 'r1:dto/types.ts:EmailParam', type: 'type', name: 'EmailParam', file_path: 'dto/types.ts' }),
      // service.ts
      mkNode({ id: 'r1:service.ts', type: 'file', name: 'file', file_path: 'service.ts' }),
      mkNode({
        id: 'r1:service.ts:Service.checkIfAdmin',
        type: 'method',
        name: 'Service.checkIfAdmin',
        file_path: 'service.ts',
      }),
    ]
    const edges: CodeEdgeRaw[] = [
      // F3a 통과 후 — imports edge resolved
      mkEdge({
        source_id: 'r1:service.ts',
        relation: 'imports',
        target_id: 'r1:dto/types.ts:EmailParam',
        target_specifier: './dto/types',
        target_symbol: 'EmailParam',
        resolve_status: 'resolved',
      }),
      // 어댑터가 발화한 type_ref (pending)
      mkEdge({
        source_id: 'r1:service.ts:Service.checkIfAdmin',
        relation: 'type_ref',
        target_specifier: './dto/types',
        target_symbol: 'EmailParam',
        type_ref_subtype: 'method_param',
      }),
    ]

    const result = await resolveTypeRefs(edges, nodes, [])
    const typeRef = result.find((e) => e.relation === 'type_ref')

    expect(typeRef).toBeDefined()
    expect(typeRef!.resolve_status).toBe('resolved')
    expect(typeRef!.target_id).toBe('r1:dto/types.ts:EmailParam')
  })

  it('intra-file type_ref가 same-file 노드로 resolved 된다 (target_specifier=null)', async () => {
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: 'r1:service.ts', type: 'file', name: 'file', file_path: 'service.ts' }),
      mkNode({ id: 'r1:service.ts:LocalParam', type: 'type', name: 'LocalParam', file_path: 'service.ts' }),
      mkNode({
        id: 'r1:service.ts:fn',
        type: 'function',
        name: 'fn',
        file_path: 'service.ts',
      }),
    ]
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: 'r1:service.ts:fn',
        relation: 'type_ref',
        target_specifier: null,
        target_symbol: 'LocalParam',
        type_ref_subtype: 'method_param',
      }),
    ]

    const result = await resolveTypeRefs(edges, nodes, [])
    const typeRef = result.find((e) => e.relation === 'type_ref')

    expect(typeRef!.resolve_status).toBe('resolved')
    expect(typeRef!.target_id).toBe('r1:service.ts:LocalParam')
  })
})
