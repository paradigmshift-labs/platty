// P9: external_chain — chain root가 import-bound resolved + 끝 method 외부
// 사용자 지적: 'failed' 의미가 부정확. 정적분석 영역 외인데 graph receiver는 도달
// 분류: 'failed' → 'external_chain' (graph 안 chain root + 외부 끝 method)
import { describe, it, expect } from 'vitest'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls.js'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap } from '@/pipeline_modules/build_graph/types.js'

function mkNode(o: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string }): CodeNodeRaw {
  return { repo_id: 'r1', line_start: 1, line_end: 5, signature: null, exported: true, parse_status: 'ok', is_test: false, test_type: null, is_async: false, jsdoc: null, ...o }
}
function mkEdge(o: Partial<CodeEdgeRaw> & { source_id: string; relation: CodeEdgeRaw['relation'] }): CodeEdgeRaw {
  return { repo_id: 'r1', target_id: null, target_specifier: null, target_symbol: null, source: 'static', resolve_status: 'pending', ...o }
}

describe('P9: external_chain — graph receiver + 외부 끝 method', () => {
  it('EC-01: SGlobal.prisma.user.findMany — chain root SGlobal 도달, .findMany 외부 → external_chain', async () => {
    const SG = 'src/SGlobal.ts'
    const USECASE = 'src/usecase.ts'
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${SG}`, type: 'file', name: 'file', file_path: SG }),
      mkNode({ id: `r1:${SG}:SGlobal`, type: 'class', name: 'SGlobal', file_path: SG }),
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:fn`, type: 'function', name: 'fn', file_path: USECASE }),
    ]
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}`,
        relation: 'imports',
        target_id: `r1:${SG}:SGlobal`,
        target_specifier: 'src/SGlobal',
        target_symbol: 'SGlobal',
        resolve_status: 'resolved',
      }),
      // 어댑터 발화: chain_path='SGlobal.prisma.user', target_symbol='findMany', target_specifier='src/SGlobal'
      mkEdge({
        source_id: `r1:${USECASE}:fn`,
        relation: 'calls',
        target_specifier: 'src/SGlobal',
        target_symbol: 'findMany',
        chain_path: 'SGlobal.prisma.user',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map() as ConstructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls')
    expect(callEdge!.resolve_status).toBe('external_chain')
    expect(callEdge!.target_id).toBeNull()
  })

  it('EC-02: logger.error — logger import-bound + .error 외부 → external_chain', async () => {
    const LOG = 'src/logger.ts'
    const USECASE = 'src/usecase.ts'
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${LOG}`, type: 'file', name: 'file', file_path: LOG }),
      mkNode({ id: `r1:${LOG}:logger`, type: 'variable', name: 'logger', file_path: LOG }),
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:fn`, type: 'function', name: 'fn', file_path: USECASE }),
    ]
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}`,
        relation: 'imports',
        target_id: `r1:${LOG}:logger`,
        target_specifier: 'src/logger',
        target_symbol: 'logger',
        resolve_status: 'resolved',
      }),
      mkEdge({
        source_id: `r1:${USECASE}:fn`,
        relation: 'calls',
        target_specifier: 'src/logger',
        target_symbol: 'error',
        chain_path: 'logger',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map() as ConstructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls')
    expect(callEdge!.resolve_status).toBe('external_chain')
  })

  it('EC-03: chain root가 import 안 된 경우 → failed (false positive 차단)', async () => {
    const USECASE = 'src/usecase.ts'
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:fn`, type: 'function', name: 'fn', file_path: USECASE }),
    ]
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}:fn`,
        relation: 'calls',
        target_specifier: 'unknown/path',
        target_symbol: 'method',
        chain_path: 'UnknownVar',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map() as ConstructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls')
    expect(callEdge!.resolve_status).toBe('failed')
  })
})
