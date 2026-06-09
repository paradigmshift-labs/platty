/**
 * F4 same-file local symbol index 테스트
 *
 * 검증 대상: buildSameFileIndex + resolveIntraFile(sameFileIndex 우선 매칭)
 *
 * 시나리오:
 *   F4-LOCAL-01: 같은 파일 non-export type 참조 → resolved
 *   F4-LOCAL-02: 같은 파일 non-export interface 참조 → resolved
 *   F4-LOCAL-03: 같은 파일 exported 심볼 참조 → resolved (회귀)
 *   F4-LOCAL-04: 다른 파일 non-export 심볼 참조 → failed (cross-file 차단 회귀)
 *   F4-LOCAL-05: 같은 파일 method 노드는 매칭 안 함 (skip 회귀)
 *   F4-LOCAL-06: 같은 파일 file 노드는 매칭 안 함 (skip 회귀)
 *   F4-LOCAL-07: 같은 파일 name에 점 포함(NS.Sub) → skip 회귀
 *   F4-LOCAL-08: 같은 파일 두 심볼 같은 이름 → 첫 노드 우선
 */
import { describe, it, expect } from 'vitest'
import {
  buildSameFileIndex,
  resolveIntraFile,
  resolveTypeRefs,
} from '@/pipeline_modules/build_graph/f4_resolve_type_refs.js'
import type { CodeNodeRaw, CodeEdgeRaw, SourceFile } from '@/pipeline_modules/build_graph/types.js'

// ── 헬퍼: 노드/엣지 팩토리 ──

function makeFileNode(id: string, filePath: string): CodeNodeRaw {
  return {
    id,
    repo_id: 'proj',
    type: 'file',
    file_path: filePath,
    name: filePath,
    line_start: null,
    line_end: null,
    signature: null,
    exported: false,
    parse_status: 'ok',
    is_test: false,
    test_type: null,
    is_async: false,
    jsdoc: null,
  }
}

function makeSymbolNode(
  id: string,
  filePath: string,
  name: string,
  type: CodeNodeRaw['type'],
  exported = false,
): CodeNodeRaw {
  return {
    id,
    repo_id: 'proj',
    type,
    file_path: filePath,
    name,
    line_start: 1,
    line_end: 10,
    signature: null,
    exported,
    parse_status: 'ok',
    is_test: false,
    test_type: null,
    is_async: false,
    jsdoc: null,
  }
}

function makeTypeRefEdge(
  sourceId: string,
  relation: string,
  specifier: string | null,
  symbol: string | null,
  resolveStatus: CodeEdgeRaw['resolve_status'] = 'pending',
  targetId: string | null = null,
): CodeEdgeRaw {
  return {
    repo_id: 'proj',
    source_id: sourceId,
    target_id: targetId,
    relation: relation as CodeEdgeRaw['relation'],
    target_specifier: specifier,
    target_symbol: symbol,
    resolve_status: resolveStatus,
  }
}

// ══════════════════════════════════════════════════════════════
// buildSameFileIndex
// ══════════════════════════════════════════════════════════════

describe('buildSameFileIndex', () => {
  it('F4-LOCAL-01: non-export type 노드 → 인덱스에 등록됨', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('proj:utils.ts:InternalState', 'utils.ts', 'InternalState', 'type', false),
    ]
    const idx = buildSameFileIndex(nodes)
    expect(idx.get('utils.ts|InternalState')).toBe('proj:utils.ts:InternalState')
    expect(idx.size).toBe(1)
  })

  it('F4-LOCAL-02: non-export interface 노드 → 인덱스에 등록됨', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('proj:svc.ts:LocalBase', 'svc.ts', 'LocalBase', 'interface', false),
    ]
    const idx = buildSameFileIndex(nodes)
    expect(idx.get('svc.ts|LocalBase')).toBe('proj:svc.ts:LocalBase')
  })

  it('F4-LOCAL-03: exported 심볼도 인덱스에 포함됨 (exported 무관)', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('proj:svc.ts:OrderService', 'svc.ts', 'OrderService', 'class', true),
    ]
    const idx = buildSameFileIndex(nodes)
    expect(idx.get('svc.ts|OrderService')).toBe('proj:svc.ts:OrderService')
  })

  it('F4-LOCAL-05: method 노드는 인덱스에서 제외 (skip)', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('proj:svc.ts:process', 'svc.ts', 'process', 'method', false),
    ]
    const idx = buildSameFileIndex(nodes)
    expect(idx.size).toBe(0)
  })

  it('F4-LOCAL-06: file 노드는 인덱스에서 제외 (skip)', () => {
    const nodes: CodeNodeRaw[] = [
      makeFileNode('proj:utils.ts', 'utils.ts'),
    ]
    const idx = buildSameFileIndex(nodes)
    expect(idx.size).toBe(0)
  })

  it('F4-LOCAL-07: name에 점 포함(NS.Sub)은 인덱스에서 제외 (skip)', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('proj:svc.ts:NS.Sub', 'svc.ts', 'NS.Sub', 'class', false),
    ]
    const idx = buildSameFileIndex(nodes)
    expect(idx.size).toBe(0)
  })

  it('F4-LOCAL-08: 같은 파일에 같은 이름 두 심볼 → 첫 노드 우선', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('proj:svc.ts:Helper-1', 'svc.ts', 'Helper', 'function', false),
      makeSymbolNode('proj:svc.ts:Helper-2', 'svc.ts', 'Helper', 'function', false),
    ]
    const idx = buildSameFileIndex(nodes)
    expect(idx.get('svc.ts|Helper')).toBe('proj:svc.ts:Helper-1')
    expect(idx.size).toBe(1)
  })
})

// ══════════════════════════════════════════════════════════════
// resolveIntraFile (same-file index 우선 매칭)
// ══════════════════════════════════════════════════════════════

describe('resolveIntraFile — sameFileIndex 우선 매칭', () => {
  function makeExportMap(entries: [string, string][]): Map<string, string> {
    return new Map(entries)
  }

  function makeNodeById(nodes: CodeNodeRaw[]): Map<string, CodeNodeRaw> {
    return new Map(nodes.map(n => [n.id, n]))
  }

  function makeSameFileIndex(nodes: CodeNodeRaw[]): Map<string, string> {
    return buildSameFileIndex(nodes)
  }

  it('F4-LOCAL-01: non-export type → sameFileIndex로 resolved', () => {
    const sourceNode = makeSymbolNode('proj:utils.ts:OrderService', 'utils.ts', 'OrderService', 'class', true)
    const typeNode = makeSymbolNode('proj:utils.ts:InternalState', 'utils.ts', 'InternalState', 'type', false)
    const edge = makeTypeRefEdge('proj:utils.ts:OrderService', 'uses_type', null, 'InternalState')

    const exportMap = makeExportMap([])  // exported=false → exportMap에 없음
    const nodeById = makeNodeById([sourceNode, typeNode])
    const sameFileIndex = makeSameFileIndex([sourceNode, typeNode])

    const result = resolveIntraFile(edge, exportMap, nodeById, sameFileIndex)
    expect(result.resolve_status).toBe('resolved')
    expect(result.target_id).toBe('proj:utils.ts:InternalState')
  })

  it('F4-LOCAL-02: non-export interface → sameFileIndex로 resolved', () => {
    const sourceNode = makeSymbolNode('proj:svc.ts:ChildClass', 'svc.ts', 'ChildClass', 'class', true)
    const baseNode = makeSymbolNode('proj:svc.ts:LocalBase', 'svc.ts', 'LocalBase', 'interface', false)
    const edge = makeTypeRefEdge('proj:svc.ts:ChildClass', 'implements', null, 'LocalBase')

    const exportMap = makeExportMap([])
    const nodeById = makeNodeById([sourceNode, baseNode])
    const sameFileIndex = makeSameFileIndex([sourceNode, baseNode])

    const result = resolveIntraFile(edge, exportMap, nodeById, sameFileIndex)
    expect(result.resolve_status).toBe('resolved')
    expect(result.target_id).toBe('proj:svc.ts:LocalBase')
  })

  it('F4-LOCAL-03: exported 심볼도 sameFileIndex로 resolved (회귀)', () => {
    const sourceNode = makeSymbolNode('proj:svc.ts:Child', 'svc.ts', 'Child', 'class', true)
    const baseNode = makeSymbolNode('proj:svc.ts:Base', 'svc.ts', 'Base', 'class', true)
    const edge = makeTypeRefEdge('proj:svc.ts:Child', 'extends', null, 'Base')

    const exportMap = makeExportMap([['svc.ts|Base', 'proj:svc.ts:Base']])
    const nodeById = makeNodeById([sourceNode, baseNode])
    const sameFileIndex = makeSameFileIndex([sourceNode, baseNode])

    const result = resolveIntraFile(edge, exportMap, nodeById, sameFileIndex)
    expect(result.resolve_status).toBe('resolved')
    expect(result.target_id).toBe('proj:svc.ts:Base')
  })

  it('F4-LOCAL-04: 다른 파일 non-export → sameFileIndex 미매칭 → failed', () => {
    // sourceNode는 svc.ts에, typeNode는 other.ts에 있음
    const sourceNode = makeSymbolNode('proj:svc.ts:OrderService', 'svc.ts', 'OrderService', 'class', true)
    const typeNode = makeSymbolNode('proj:other.ts:SharedState', 'other.ts', 'SharedState', 'type', false)
    const edge = makeTypeRefEdge('proj:svc.ts:OrderService', 'uses_type', null, 'SharedState')

    const exportMap = makeExportMap([])  // 다른 파일 non-export → exportMap에 없음
    const nodeById = makeNodeById([sourceNode, typeNode])
    const sameFileIndex = makeSameFileIndex([sourceNode, typeNode])
    // sameFileIndex에는 'svc.ts|SharedState' 없고 'other.ts|SharedState'만 있음

    const result = resolveIntraFile(edge, exportMap, nodeById, sameFileIndex)
    expect(result.resolve_status).toBe('failed')
    expect(result.target_id).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════
// resolveTypeRefs 통합: non-export intra-file 참조
// ══════════════════════════════════════════════════════════════

describe('resolveTypeRefs — non-export intra-file 통합', () => {
  it('F4-LOCAL-01 통합: non-export type intra-file → resolved', async () => {
    const fileNode = makeFileNode('proj:utils.ts', 'utils.ts')
    const helperNode = makeSymbolNode('proj:utils.ts:helper', 'utils.ts', 'helper', 'function', false)
    const stateNode = makeSymbolNode('proj:utils.ts:InternalState', 'utils.ts', 'InternalState', 'type', false)
    const serviceNode = makeSymbolNode('proj:utils.ts:OrderService', 'utils.ts', 'OrderService', 'class', true)

    const nodes: CodeNodeRaw[] = [fileNode, helperNode, stateNode, serviceNode]

    // OrderService uses_type InternalState (같은 파일, non-export)
    const typeRefEdge = makeTypeRefEdge('proj:utils.ts:OrderService', 'uses_type', null, 'InternalState')
    const edges: CodeEdgeRaw[] = [typeRefEdge]

    const result = await resolveTypeRefs(edges, nodes, [])
    expect(result).toHaveLength(1)
    expect(result[0].resolve_status).toBe('resolved')
    expect(result[0].target_id).toBe('proj:utils.ts:InternalState')
  })

  it('F4-LOCAL-04 통합: 다른 파일 non-export → failed', async () => {
    const fileA = makeFileNode('proj:a.ts', 'a.ts')
    const fileB = makeFileNode('proj:b.ts', 'b.ts')
    const serviceNode = makeSymbolNode('proj:a.ts:ServiceA', 'a.ts', 'ServiceA', 'class', true)
    const hiddenType = makeSymbolNode('proj:b.ts:HiddenType', 'b.ts', 'HiddenType', 'type', false)

    const nodes: CodeNodeRaw[] = [fileA, fileB, serviceNode, hiddenType]

    // ServiceA uses_type HiddenType — 다른 파일, non-export, import 없음
    const typeRefEdge = makeTypeRefEdge('proj:a.ts:ServiceA', 'uses_type', null, 'HiddenType')
    const edges: CodeEdgeRaw[] = [typeRefEdge]

    const result = await resolveTypeRefs(edges, nodes, [])
    expect(result).toHaveLength(1)
    expect(result[0].resolve_status).toBe('failed')
    expect(result[0].target_id).toBeNull()
  })
})
