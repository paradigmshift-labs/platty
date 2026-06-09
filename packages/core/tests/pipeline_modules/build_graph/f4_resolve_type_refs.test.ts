/**
 * F4: resolveTypeRefs 테스트
 * SOT: specs/build_graph/specs/f4_resolve_type_refs/tests.md
 *
 * 유닛: buildExportMap 14 + buildImportsIndex 8 + resolveIntraFile 4 +
 *        lookupImportEdge 4 + resolveFromImport 5 + resolveFromResolvedImport 6 +
 *        resolveOneTypeRef 6 = 47개
 * 통합: 20개
 */
import { describe, it, expect, vi } from 'vitest'
import {
  buildExportMap,
  buildImportsIndex,
  resolveIntraFile,
  lookupImportEdge,
  resolveFromImport,
  resolveFromResolvedImport,
  resolveOneTypeRef,
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
  exported = true,
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

function makeImportEdge(
  sourceId: string,
  specifier: string,
  symbol: string | null,
  targetId: string | null,
  resolveStatus: CodeEdgeRaw['resolve_status'],
): CodeEdgeRaw {
  return {
    repo_id: 'proj',
    source_id: sourceId,
    target_id: targetId,
    relation: 'imports',
    target_specifier: specifier,
    target_symbol: symbol,
    resolve_status: resolveStatus,
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
// buildExportMap
// ══════════════════════════════════════════════════════════════

describe('buildExportMap', () => {
  it('#1 정상: exported class 1개', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('p:f.ts:A', 'f.ts', 'A', 'class', true),
    ]
    const map = buildExportMap(nodes)
    expect(map.get('f.ts|A')).toBe('p:f.ts:A')
    expect(map.size).toBe(1)
  })

  it('#2 정상: exported type/interface/enum 혼합', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('p:f.ts:MyType', 'f.ts', 'MyType', 'type', true),
      makeSymbolNode('p:f.ts:MyInterface', 'f.ts', 'MyInterface', 'interface', true),
      makeSymbolNode('p:f.ts:MyEnum', 'f.ts', 'MyEnum', 'enum', true),
    ]
    const map = buildExportMap(nodes)
    expect(map.get('f.ts|MyType')).toBe('p:f.ts:MyType')
    expect(map.get('f.ts|MyInterface')).toBe('p:f.ts:MyInterface')
    expect(map.get('f.ts|MyEnum')).toBe('p:f.ts:MyEnum')
    expect(map.size).toBe(3)
  })

  it('#3 정상: exported function (decorator factory)', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('p:dec.ts:Injectable', 'dec.ts', 'Injectable', 'function', true),
    ]
    const map = buildExportMap(nodes)
    expect(map.get('dec.ts|Injectable')).toBe('p:dec.ts:Injectable')
  })

  it('#4 정상: exported variable (arrow decorator)', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('p:dec.ts:MyDec', 'dec.ts', 'MyDec', 'variable', true),
    ]
    const map = buildExportMap(nodes)
    expect(map.get('dec.ts|MyDec')).toBe('p:dec.ts:MyDec')
  })

  it('#5 경계: exported=false 노드는 미포함', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('p:f.ts:Private', 'f.ts', 'Private', 'class', false),
    ]
    const map = buildExportMap(nodes)
    expect(map.size).toBe(0)
  })

  it('#6 경계: type=\'file\' 노드 100개 — exportMap 미포함 (불변식 #6)', () => {
    const nodes: CodeNodeRaw[] = Array.from({ length: 100 }, (_, i) =>
      makeFileNode(`p:f${i}.ts`, `f${i}.ts`),
    )
    const map = buildExportMap(nodes)
    expect(map.size).toBe(0)
  })

  it('#7 경계: type=\'method\' 노드 (점 포함 이름) — exportMap 미포함 (불변식 #6, 1차 필터)', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('p:f.ts:A.m', 'f.ts', 'A.m', 'method', true),
    ]
    const map = buildExportMap(nodes)
    expect(map.size).toBe(0)
  })

  it('#7b [M2-10] 경계: type=\'method\' + 점 없는 이름 — type===\'method\' 직접 체크로 필터링', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('p:f.ts:solo_method', 'f.ts', 'solo_method', 'method', true),
    ]
    const map = buildExportMap(nodes)
    // method는 점 없어도 제외 (type 직접 체크 우선)
    expect(map.size).toBe(0)
  })

  it('#8 경계: 같은 파일에 같은 이름 중복 exported — 첫 번째만 등록', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('p:f.ts:A-1', 'f.ts', 'A', 'class', true),
      makeSymbolNode('p:f.ts:A-2', 'f.ts', 'A', 'class', true),
    ]
    const map = buildExportMap(nodes)
    expect(map.get('f.ts|A')).toBe('p:f.ts:A-1')
    expect(map.size).toBe(1)
  })

  it('#8b 경계: type=\'method\' + exported=false 조합 — method 체크에서 이미 제외 (exported 체크 도달 이전)', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('p:f.ts:m', 'f.ts', 'm', 'method', false),
    ]
    const map = buildExportMap(nodes)
    // method는 exported=false여도 exported 체크 이전에 method 체크로 제외
    expect(map.size).toBe(0)
  })

  it('#9 경계: 여러 파일에 같은 이름 — 각자 key로 등록', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('p:f1.ts:A', 'f1.ts', 'A', 'class', true),
      makeSymbolNode('p:f2.ts:A', 'f2.ts', 'A', 'class', true),
    ]
    const map = buildExportMap(nodes)
    expect(map.get('f1.ts|A')).toBe('p:f1.ts:A')
    expect(map.get('f2.ts|A')).toBe('p:f2.ts:A')
    expect(map.size).toBe(2)
  })

  it('#10 경계: name=\'default\' — \'path|default\' key로 등록', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('p:f.ts:default', 'f.ts', 'default', 'class', true),
    ]
    const map = buildExportMap(nodes)
    expect(map.get('f.ts|default')).toBe('p:f.ts:default')
  })

  it('#11 경계: 빈 nodes → 빈 Map', () => {
    const map = buildExportMap([])
    expect(map.size).toBe(0)
  })

  // extra: method + 점 포함 이름도 필터
  it('#12 경계: method 노드 + 점 포함 이름 — 두 필터 모두 적용됨', () => {
    const nodes: CodeNodeRaw[] = [
      makeSymbolNode('p:f.ts:A.method', 'f.ts', 'A.method', 'method', true),
      makeSymbolNode('p:f.ts:B', 'f.ts', 'B', 'class', true),
    ]
    const map = buildExportMap(nodes)
    expect(map.size).toBe(1)
    expect(map.get('f.ts|B')).toBe('p:f.ts:B')
  })
})

// ══════════════════════════════════════════════════════════════
// buildImportsIndex
// ══════════════════════════════════════════════════════════════

describe('buildImportsIndex', () => {
  it('#1 정상: imports edge 1개 — key로 조회 가능', () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const edge = makeImportEdge('p:a.ts', './b', 'B', 'p:b.ts:B', 'resolved')
    const { importsByFileAndSymbol, fileNodeIdByPath } = buildImportsIndex([edge], [fileNode])

    expect(importsByFileAndSymbol.get('p:a.ts|./b|B')).toBe(edge)
    expect(fileNodeIdByPath.get('a.ts')).toBe('p:a.ts')
  })

  it('#2 정상: re_exports edge 포함 — 동일 key로 등록', () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const edge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts',
      target_id: 'p:b.ts:B',
      relation: 're_exports',
      target_specifier: './b',
      target_symbol: 'B',
      resolve_status: 'resolved',
    }
    const { importsByFileAndSymbol } = buildImportsIndex([edge], [fileNode])
    expect(importsByFileAndSymbol.get('p:a.ts|./b|B')).toBe(edge)
  })

  it('#3 경계: side-effect import (target_symbol=null) — symbol 부분이 \'\'로 등록', () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const edge = makeImportEdge('p:a.ts', './polyfill', null, null, 'resolved')
    const { importsByFileAndSymbol } = buildImportsIndex([edge], [fileNode])
    expect(importsByFileAndSymbol.get('p:a.ts|./polyfill|')).toBe(edge)
  })

  it('#3b 경계: target_symbol=undefined (프로퍼티 키 자체 누락) — ?? \'\' 연산자로 \'\' 처리', () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    // target_symbol 프로퍼티 자체가 없는 edge
    const edge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts',
      target_id: null,
      relation: 'imports',
      target_specifier: './x',
      target_symbol: undefined as unknown as null, // 프로퍼티 누락 시뮬레이션
      resolve_status: 'resolved',
    }
    const { importsByFileAndSymbol } = buildImportsIndex([edge], [fileNode])
    // undefined ?? '' → '' → key: 'p:a.ts|./x|'
    expect(importsByFileAndSymbol.get('p:a.ts|./x|')).toBe(edge)
  })

  it('#4 경계: target_specifier === null → 인덱스 미포함 (skip)', () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const edge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts',
      target_id: null,
      relation: 'imports',
      target_specifier: null,
      target_symbol: 'X',
      resolve_status: 'failed',
    }
    const { importsByFileAndSymbol } = buildImportsIndex([edge], [fileNode])
    expect(importsByFileAndSymbol.size).toBe(0)
  })

  it('#5 경계: imports/re_exports 아닌 edge — 인덱스 미포함', () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const callsEdge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts:Foo',
      target_id: 'p:b.ts:Bar',
      relation: 'calls',
      target_specifier: './b',
      target_symbol: 'Bar',
      resolve_status: 'resolved',
    }
    const extendsEdge = makeTypeRefEdge('p:a.ts:Child', 'extends', './b', 'Base', 'pending')
    const containsEdge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts',
      target_id: 'p:a.ts:Foo',
      relation: 'contains',
      target_specifier: null,
      target_symbol: null,
      resolve_status: 'n/a',
    }
    const { importsByFileAndSymbol } = buildImportsIndex(
      [callsEdge, extendsEdge, containsEdge],
      [fileNode],
    )
    expect(importsByFileAndSymbol.size).toBe(0)
  })

  it('#6 정상: fileNodeIdByPath 구축 — file 노드 3개', () => {
    const nodes: CodeNodeRaw[] = [
      makeFileNode('p:a.ts', 'a.ts'),
      makeFileNode('p:b.ts', 'b.ts'),
      makeFileNode('p:c.ts', 'c.ts'),
    ]
    const { fileNodeIdByPath } = buildImportsIndex([], nodes)
    expect(fileNodeIdByPath.get('a.ts')).toBe('p:a.ts')
    expect(fileNodeIdByPath.get('b.ts')).toBe('p:b.ts')
    expect(fileNodeIdByPath.get('c.ts')).toBe('p:c.ts')
    expect(fileNodeIdByPath.size).toBe(3)
  })

  it('#7 경계: 같은 key 중복 — 첫 번째 edge만 보존', () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const edge1 = makeImportEdge('p:a.ts', './b', 'B', 'p:b.ts:B', 'resolved')
    const edge2 = makeImportEdge('p:a.ts', './b', 'B', 'p:b.ts:B2', 'resolved')
    const { importsByFileAndSymbol } = buildImportsIndex([edge1, edge2], [fileNode])
    expect(importsByFileAndSymbol.get('p:a.ts|./b|B')).toBe(edge1)
  })
})

// ══════════════════════════════════════════════════════════════
// resolveIntraFile
// ══════════════════════════════════════════════════════════════

describe('resolveIntraFile', () => {
  it('#1 정상: 같은 파일 exported 심볼 hit → resolved', () => {
    const sourceNode = makeSymbolNode('p:m.ts:X', 'm.ts', 'X', 'class', true)
    const nodeById = new Map([[sourceNode.id, sourceNode]])
    const exportMap = new Map([['m.ts|MyType', 'p:m.ts:MyType']])
    const edge = makeTypeRefEdge('p:m.ts:X', 'uses_type', null, 'MyType')

    const result = resolveIntraFile(edge, exportMap, nodeById)
    expect(result).toEqual({ target_id: 'p:m.ts:MyType', resolve_status: 'resolved' })
  })

  it('#2 실패: exportMap miss (심볼 미등록)', () => {
    const sourceNode = makeSymbolNode('p:m.ts:X', 'm.ts', 'X', 'class', true)
    const nodeById = new Map([[sourceNode.id, sourceNode]])
    const exportMap = new Map<string, string>()
    const edge = makeTypeRefEdge('p:m.ts:X', 'uses_type', null, 'Missing')

    const result = resolveIntraFile(edge, exportMap, nodeById)
    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#2b 실패: 같은 파일 exported=false 심볼 참조 (§9 한계 회귀) — exportMap 미등록이라 failed', () => {
    const sourceNode = makeSymbolNode('p:m.ts:X', 'm.ts', 'X', 'class', true)
    // exported=false 심볼 — buildExportMap이 제외하므로 exportMap에 없음
    const privateNode = makeSymbolNode('p:m.ts:MyType', 'm.ts', 'MyType', 'type', false)
    const nodeById = new Map([
      [sourceNode.id, sourceNode],
      [privateNode.id, privateNode],
    ])
    const exportMap = new Map<string, string>() // exported=false는 포함 안 됨

    const edge = makeTypeRefEdge('p:m.ts:X', 'uses_type', null, 'MyType')
    const result = resolveIntraFile(edge, exportMap, nodeById)
    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#3 실패: sourceNode 고아 (nodeById에 없음) → failed', () => {
    const nodeById = new Map<string, CodeNodeRaw>()
    const exportMap = new Map([['m.ts|MyType', 'p:m.ts:MyType']])
    const edge = makeTypeRefEdge('p:orphan.ts:Ghost', 'uses_type', null, 'MyType')

    const result = resolveIntraFile(edge, exportMap, nodeById)
    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })
})

// ══════════════════════════════════════════════════════════════
// lookupImportEdge
// ══════════════════════════════════════════════════════════════

describe('lookupImportEdge', () => {
  it('#1 정상: import edge 탐색 성공 → {ok:true, importEdge}', () => {
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const nodeById = new Map([[childNode.id, childNode]])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])
    const importEdge = makeImportEdge('p:a.ts', './base', 'Base', 'p:base.ts:Base', 'resolved')
    const importsByFileAndSymbol = new Map([['p:a.ts|./base|Base', importEdge]])

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './base', 'Base')
    const result = lookupImportEdge(edge, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ ok: true, importEdge })
  })

  it('#2 실패: sourceNode 고아 (nodeById miss) → {ok:false, reason:\'no-source\'}', () => {
    const nodeById = new Map<string, CodeNodeRaw>()
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])
    const importsByFileAndSymbol = new Map<string, CodeEdgeRaw>()

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './base', 'Base')
    const result = lookupImportEdge(edge, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ ok: false, reason: 'no-source' })
  })

  it('#3 실패: fileNodeIdByPath miss → {ok:false, reason:\'no-source\'}', () => {
    const childNode = makeSymbolNode('p:x.ts:Child', 'x.ts', 'Child', 'class', true)
    const nodeById = new Map([[childNode.id, childNode]])
    const fileNodeIdByPath = new Map<string, string>() // 'x.ts' 없음
    const importsByFileAndSymbol = new Map<string, CodeEdgeRaw>()

    const edge = makeTypeRefEdge('p:x.ts:Child', 'extends', './base', 'Base')
    const result = lookupImportEdge(edge, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ ok: false, reason: 'no-source' })
  })

  it('#4 실패: importEdge 부재 (key 미등록) → {ok:false, reason:\'no-import\'}', () => {
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const nodeById = new Map([[childNode.id, childNode]])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])
    const importsByFileAndSymbol = new Map<string, CodeEdgeRaw>() // key 없음

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './base', 'Base')
    const result = lookupImportEdge(edge, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ ok: false, reason: 'no-import' })
  })
})

// ══════════════════════════════════════════════════════════════
// resolveFromResolvedImport
// ══════════════════════════════════════════════════════════════

describe('resolveFromResolvedImport', () => {
  it('#1 Case 2c-0: dangling (nodeById miss) → failed', () => {
    const nodeById = new Map<string, CodeNodeRaw>()
    const exportMap = new Map<string, string>()

    const result = resolveFromResolvedImport('ghost', 'X', exportMap, nodeById)
    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#2 Case 2c-1: 심볼 노드 직접 hit (class) → resolved', () => {
    const baseNode = makeSymbolNode('p:base.ts:Base', 'base.ts', 'Base', 'class', true)
    const nodeById = new Map([[baseNode.id, baseNode]])
    const exportMap = new Map<string, string>()

    const result = resolveFromResolvedImport('p:base.ts:Base', 'Base', exportMap, nodeById)
    expect(result).toEqual({ target_id: 'p:base.ts:Base', resolve_status: 'resolved' })
  })

  it('#3 Case 2c-1: interface 타겟 → resolved', () => {
    const ifNode = makeSymbolNode('p:i.ts:IFoo', 'i.ts', 'IFoo', 'interface', true)
    const nodeById = new Map([[ifNode.id, ifNode]])
    const exportMap = new Map<string, string>()

    const result = resolveFromResolvedImport('p:i.ts:IFoo', 'IFoo', exportMap, nodeById)
    expect(result).toEqual({ target_id: 'p:i.ts:IFoo', resolve_status: 'resolved' })
  })

  it('#4 Case 2c-2: file 노드 + symbol hit → resolved', () => {
    const baseFileNode = makeFileNode('p:base.ts', 'base.ts')
    const nodeById = new Map([[baseFileNode.id, baseFileNode]])
    const exportMap = new Map([['base.ts|Base', 'p:base.ts:Base']])

    const result = resolveFromResolvedImport('p:base.ts', 'Base', exportMap, nodeById)
    expect(result).toEqual({ target_id: 'p:base.ts:Base', resolve_status: 'resolved' })
  })

  it('#5 Case 2c-2: file 노드 + default fallback → resolved', () => {
    const baseFileNode = makeFileNode('p:base.ts', 'base.ts')
    const nodeById = new Map([[baseFileNode.id, baseFileNode]])
    // 'Base' key 없음, 'default' key만 있음
    const exportMap = new Map([['base.ts|default', 'p:base.ts:default']])

    const result = resolveFromResolvedImport('p:base.ts', 'Base', exportMap, nodeById)
    expect(result).toEqual({ target_id: 'p:base.ts:default', resolve_status: 'resolved' })
  })

  it('#6 Case 2c-2: file 노드 + 전부 miss → failed', () => {
    const baseFileNode = makeFileNode('p:base.ts', 'base.ts')
    const nodeById = new Map([[baseFileNode.id, baseFileNode]])
    const exportMap = new Map<string, string>() // 모두 없음

    const result = resolveFromResolvedImport('p:base.ts', 'Base', exportMap, nodeById)
    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })
})

// ══════════════════════════════════════════════════════════════
// resolveFromImport
// ══════════════════════════════════════════════════════════════

describe('resolveFromImport', () => {
  it('#1 Case 2a: external → {null, \'external\'}', () => {
    const importEdge = makeImportEdge('p:a.ts', '@nestjs/common', 'Injectable', null, 'external')
    const result = resolveFromImport(importEdge, 'Injectable', new Map(), new Map())
    expect(result).toEqual({ target_id: null, resolve_status: 'external' })
  })

  it('#2 Case 2b: failed → {null, \'failed\'}', () => {
    const importEdge = makeImportEdge('p:a.ts', './x', 'X', null, 'failed')
    const result = resolveFromImport(importEdge, 'X', new Map(), new Map())
    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#3 Case 2c 위임: resolved + target_id 존재 → resolveFromResolvedImport 실 호출 (Case 2c-1 경로)', () => {
    // importEdge가 심볼 노드 id를 target_id로 가짐 → Case 2c-1
    const baseNode = makeSymbolNode('p:base.ts:Base', 'base.ts', 'Base', 'class', true)
    const nodeById = new Map([[baseNode.id, baseNode]])
    const exportMap = new Map<string, string>()

    const importEdge = makeImportEdge('p:a.ts', './base', 'Base', 'p:base.ts:Base', 'resolved')
    const result = resolveFromImport(importEdge, 'Base', exportMap, nodeById)

    expect(result).toEqual({ target_id: 'p:base.ts:Base', resolve_status: 'resolved' })
  })

  it('#4 Case 2d: pending (F3 계약 위반 방어) → failed + console.warn 2-인자 단언', () => {
    const importEdge = makeImportEdge('p:a.ts', './b', 'Base', null, 'pending')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = resolveFromImport(importEdge, 'Base', new Map(), new Map())

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[F4] imports edge still pending (F3 invariant violation):',
      JSON.stringify({
        source_id: 'p:a.ts',
        target_specifier: './b',
        target_symbol: 'Base',
      }),
    )

    warnSpy.mockRestore()
  })

  it('#5 Case 2d: resolved + target_id=null (이상치) → failed + warn 1회', () => {
    const importEdge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts',
      target_id: null,
      relation: 'imports',
      target_specifier: './x',
      target_symbol: 'X',
      resolve_status: 'resolved',
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = resolveFromImport(importEdge, 'X', new Map(), new Map())

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[F4] imports edge still pending (F3 invariant violation):',
      JSON.stringify({
        source_id: 'p:a.ts',
        target_specifier: './x',
        target_symbol: 'X',
      }),
    )

    warnSpy.mockRestore()
  })
})

// ══════════════════════════════════════════════════════════════
// resolveOneTypeRef (§1.7 — 통합 분기 검증)
// ══════════════════════════════════════════════════════════════

describe('resolveOneTypeRef (§1.7)', () => {
  const emptyExportMap = new Map<string, string>()
  const emptyImports = new Map<string, CodeEdgeRaw>()
  const emptyNodeById = new Map<string, CodeNodeRaw>()
  const emptyFileNodeIdByPath = new Map<string, string>()

  it('#1 Case 0: target_symbol=null → failed', () => {
    const edge = makeTypeRefEdge('p:a.ts:Foo', 'extends', './x', null)
    const result = resolveOneTypeRef(edge, emptyExportMap, emptyImports, emptyNodeById, emptyFileNodeIdByPath)
    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#2 Case 0: target_symbol=\'\' → failed', () => {
    const edge = makeTypeRefEdge('p:a.ts:Foo', 'extends', null, '')
    const result = resolveOneTypeRef(edge, emptyExportMap, emptyImports, emptyNodeById, emptyFileNodeIdByPath)
    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#3 Case 1 위임: intra-file resolved → resolveIntraFile 결과 그대로', () => {
    const sourceNode = makeSymbolNode('p:m.ts:Comp', 'm.ts', 'Comp', 'class', true)
    const nodeById = new Map([[sourceNode.id, sourceNode]])
    const exportMap = new Map([['m.ts|MyType', 'p:m.ts:MyType']])

    const edge = makeTypeRefEdge('p:m.ts:Comp', 'uses_type', null, 'MyType')
    const result = resolveOneTypeRef(edge, exportMap, emptyImports, nodeById, emptyFileNodeIdByPath)
    expect(result).toEqual({ target_id: 'p:m.ts:MyType', resolve_status: 'resolved' })
  })

  it('#4 Case 2 위임: import resolved → resolveFromImport 결과 그대로 (심볼 노드 hit)', () => {
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const baseNode = makeSymbolNode('p:b.ts:Base', 'b.ts', 'Base', 'class', true)
    const aFileNode = makeFileNode('p:a.ts', 'a.ts')
    const nodeById = new Map([
      [childNode.id, childNode],
      [baseNode.id, baseNode],
      [aFileNode.id, aFileNode],
    ])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])
    const importEdge = makeImportEdge('p:a.ts', './b', 'Base', 'p:b.ts:Base', 'resolved')
    const importsByFileAndSymbol = new Map([['p:a.ts|./b|Base', importEdge]])

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './b', 'Base')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)
    expect(result).toEqual({ target_id: 'p:b.ts:Base', resolve_status: 'resolved' })
  })

  it('#5 Case 2 위임: lookup 실패 (no-source, sourceNode 고아) → failed', () => {
    const edge = makeTypeRefEdge('p:orphan.ts:Ghost', 'extends', './b', 'Base')
    const result = resolveOneTypeRef(edge, emptyExportMap, emptyImports, emptyNodeById, emptyFileNodeIdByPath)
    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#6 Case 2 위임: lookup 실패 (no-import, importEdge 부재) → failed', () => {
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const aFileNode = makeFileNode('p:a.ts', 'a.ts')
    const nodeById = new Map([[childNode.id, childNode], [aFileNode.id, aFileNode]])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './b', 'Base')
    const result = resolveOneTypeRef(edge, emptyExportMap, emptyImports, nodeById, fileNodeIdByPath)
    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })
})

// ══════════════════════════════════════════════════════════════
// resolveOneTypeRef (기존 상세 케이스)
// ══════════════════════════════════════════════════════════════

describe('resolveOneTypeRef', () => {
  // 공통 헬퍼: 빈 인덱스들
  const emptyExportMap = new Map<string, string>()
  const emptyImports = new Map<string, CodeEdgeRaw>()
  const emptyNodeById = new Map<string, CodeNodeRaw>()
  const emptyFileNodeIdByPath = new Map<string, string>()

  it('#1 extends: 로컬 class 해석 성공 (Case 2c-1, 심볼 노드)', () => {
    // a.ts의 Child extends ./base의 Base
    // source: Child 심볼 노드 (a.ts)
    // imports edge: a.ts 파일 노드 → base.ts:Base (심볼 노드, type='class')
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const baseNode = makeSymbolNode('p:base.ts:Base', 'base.ts', 'Base', 'class', true)
    const aFileNode = makeFileNode('p:a.ts', 'a.ts')
    const baseFileNode = makeFileNode('p:base.ts', 'base.ts')

    const nodeById = new Map<string, CodeNodeRaw>([
      [childNode.id, childNode],
      [baseNode.id, baseNode],
      [aFileNode.id, aFileNode],
      [baseFileNode.id, baseFileNode],
    ])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts'], ['base.ts', 'p:base.ts']])

    const importEdge = makeImportEdge('p:a.ts', './base', 'Base', 'p:base.ts:Base', 'resolved')
    const importsByFileAndSymbol = new Map([['p:a.ts|./base|Base', importEdge]])

    const exportMap = new Map([['base.ts|Base', 'p:base.ts:Base']])

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './base', 'Base')
    const result = resolveOneTypeRef(edge, exportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: 'p:base.ts:Base', resolve_status: 'resolved' })
  })

  it('#2 extends: 외부 패키지 → external', () => {
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const aFileNode = makeFileNode('p:a.ts', 'a.ts')

    const nodeById = new Map([[childNode.id, childNode], [aFileNode.id, aFileNode]])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    const importEdge = makeImportEdge('p:a.ts', '@nestjs/common', 'Injectable', null, 'external')
    const importsByFileAndSymbol = new Map([['p:a.ts|@nestjs/common|Injectable', importEdge]])

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', '@nestjs/common', 'Injectable')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'external' })
  })

  it('#3 extends: import failed → failed', () => {
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const aFileNode = makeFileNode('p:a.ts', 'a.ts')

    const nodeById = new Map([[childNode.id, childNode], [aFileNode.id, aFileNode]])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    const importEdge = makeImportEdge('p:a.ts', './missing', 'Base', null, 'failed')
    const importsByFileAndSymbol = new Map([['p:a.ts|./missing|Base', importEdge]])

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './missing', 'Base')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#4 implements: 인터페이스 resolved (Case 2c-1)', () => {
    const implNode = makeSymbolNode('p:a.ts:UserService', 'a.ts', 'UserService', 'class', true)
    const ifNode = makeSymbolNode('p:iface.ts:IUserService', 'iface.ts', 'IUserService', 'interface', true)
    const aFileNode = makeFileNode('p:a.ts', 'a.ts')

    const nodeById = new Map([
      [implNode.id, implNode],
      [ifNode.id, ifNode],
      [aFileNode.id, aFileNode],
    ])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    const importEdge = makeImportEdge('p:a.ts', './iface', 'IUserService', 'p:iface.ts:IUserService', 'resolved')
    const importsByFileAndSymbol = new Map([['p:a.ts|./iface|IUserService', importEdge]])

    const edge = makeTypeRefEdge('p:a.ts:UserService', 'implements', './iface', 'IUserService')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: 'p:iface.ts:IUserService', resolve_status: 'resolved' })
  })

  it('#5 implements: 외부 인터페이스 CanActivate (@nestjs/common) → external (S1 검증)', () => {
    const guardNode = makeSymbolNode('p:auth.ts:AuthGuard', 'auth.ts', 'AuthGuard', 'class', true)
    const aFileNode = makeFileNode('p:auth.ts', 'auth.ts')

    const nodeById = new Map([[guardNode.id, guardNode], [aFileNode.id, aFileNode]])
    const fileNodeIdByPath = new Map([['auth.ts', 'p:auth.ts']])

    const importEdge = makeImportEdge('p:auth.ts', '@nestjs/common', 'CanActivate', null, 'external')
    const importsByFileAndSymbol = new Map([['p:auth.ts|@nestjs/common|CanActivate', importEdge]])

    const edge = makeTypeRefEdge('p:auth.ts:AuthGuard', 'implements', '@nestjs/common', 'CanActivate')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'external' })
  })

  it('#6 mixes (Dart): 로컬 mixin resolved (Case 2c-1) (S3 검증)', () => {
    const classNode = makeSymbolNode('p:widget.dart:MyWidget', 'widget.dart', 'MyWidget', 'class', true)
    const mixinNode = makeSymbolNode('p:mixin.dart:TickerProviderMixin', 'mixin.dart', 'TickerProviderMixin', 'class', true)
    const widgetFileNode = makeFileNode('p:widget.dart', 'widget.dart')

    const nodeById = new Map([
      [classNode.id, classNode],
      [mixinNode.id, mixinNode],
      [widgetFileNode.id, widgetFileNode],
    ])
    const fileNodeIdByPath = new Map([['widget.dart', 'p:widget.dart']])

    const importEdge = makeImportEdge('p:widget.dart', './mixin', 'TickerProviderMixin', 'p:mixin.dart:TickerProviderMixin', 'resolved')
    const importsByFileAndSymbol = new Map([['p:widget.dart|./mixin|TickerProviderMixin', importEdge]])

    const edge = makeTypeRefEdge('p:widget.dart:MyWidget', 'mixes', './mixin', 'TickerProviderMixin')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: 'p:mixin.dart:TickerProviderMixin', resolve_status: 'resolved' })
  })

  it('#7 mixes: 외부 mixin (package:flutter_riverpod) → external', () => {
    const classNode = makeSymbolNode('p:page.dart:MyPage', 'page.dart', 'MyPage', 'class', true)
    const fileNode = makeFileNode('p:page.dart', 'page.dart')

    const nodeById = new Map([[classNode.id, classNode], [fileNode.id, fileNode]])
    const fileNodeIdByPath = new Map([['page.dart', 'p:page.dart']])

    const importEdge = makeImportEdge('p:page.dart', 'package:flutter_riverpod/flutter_riverpod.dart', 'ConsumerMixin', null, 'external')
    const importsByFileAndSymbol = new Map([['p:page.dart|package:flutter_riverpod/flutter_riverpod.dart|ConsumerMixin', importEdge]])

    const edge = makeTypeRefEdge('p:page.dart:MyPage', 'mixes', 'package:flutter_riverpod/flutter_riverpod.dart', 'ConsumerMixin')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'external' })
  })

  it('#8 uses_type: intra-file (specifier=null) → resolved', () => {
    const componentNode = makeSymbolNode('p:m.ts:MyComponent', 'm.ts', 'MyComponent', 'class', true)
    const typeNode = makeSymbolNode('p:m.ts:MyType', 'm.ts', 'MyType', 'type', true)

    const nodeById = new Map([[componentNode.id, componentNode], [typeNode.id, typeNode]])
    const exportMap = new Map([['m.ts|MyType', 'p:m.ts:MyType']])

    const edge = makeTypeRefEdge('p:m.ts:MyComponent', 'uses_type', null, 'MyType')
    const result = resolveOneTypeRef(edge, exportMap, emptyImports, nodeById, emptyFileNodeIdByPath)

    expect(result).toEqual({ target_id: 'p:m.ts:MyType', resolve_status: 'resolved' })
  })

  it('#9 uses_type: intra-file + exportMap miss → failed', () => {
    const componentNode = makeSymbolNode('p:m.ts:MyComponent', 'm.ts', 'MyComponent', 'class', true)
    const nodeById = new Map([[componentNode.id, componentNode]])

    const edge = makeTypeRefEdge('p:m.ts:MyComponent', 'uses_type', null, 'NotExist')
    const result = resolveOneTypeRef(edge, emptyExportMap, emptyImports, nodeById, emptyFileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#10 uses_type: React.FC 외부 (S2 검증) → external', () => {
    const pageNode = makeSymbolNode('p:page.tsx:HomePage', 'page.tsx', 'HomePage', 'function', true)
    const fileNode = makeFileNode('p:page.tsx', 'page.tsx')

    const nodeById = new Map([[pageNode.id, pageNode], [fileNode.id, fileNode]])
    const fileNodeIdByPath = new Map([['page.tsx', 'p:page.tsx']])

    const importEdge = makeImportEdge('p:page.tsx', 'react', 'FC', null, 'external')
    const importsByFileAndSymbol = new Map([['p:page.tsx|react|FC', importEdge]])

    const edge = makeTypeRefEdge('p:page.tsx:HomePage', 'uses_type', 'react', 'FC')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'external' })
  })

  it('#11 decorates: @Injectable 외부 (@nestjs/common) → external', () => {
    const controllerNode = makeSymbolNode('p:ctrl.ts:AppController', 'ctrl.ts', 'AppController', 'class', true)
    const fileNode = makeFileNode('p:ctrl.ts', 'ctrl.ts')

    const nodeById = new Map([[controllerNode.id, controllerNode], [fileNode.id, fileNode]])
    const fileNodeIdByPath = new Map([['ctrl.ts', 'p:ctrl.ts']])

    const importEdge = makeImportEdge('p:ctrl.ts', '@nestjs/common', 'Injectable', null, 'external')
    const importsByFileAndSymbol = new Map([['p:ctrl.ts|@nestjs/common|Injectable', importEdge]])

    const edge = makeTypeRefEdge('p:ctrl.ts:AppController', 'decorates', '@nestjs/common', 'Injectable')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'external' })
  })

  it('#12 decorates: 로컬 decorator factory (Case 2c-1) → resolved', () => {
    const serviceNode = makeSymbolNode('p:svc.ts:MyService', 'svc.ts', 'MyService', 'class', true)
    const decNode = makeSymbolNode('p:dec.ts:LogExec', 'dec.ts', 'LogExec', 'function', true)
    const fileNode = makeFileNode('p:svc.ts', 'svc.ts')

    const nodeById = new Map([
      [serviceNode.id, serviceNode],
      [decNode.id, decNode],
      [fileNode.id, fileNode],
    ])
    const fileNodeIdByPath = new Map([['svc.ts', 'p:svc.ts']])

    const importEdge = makeImportEdge('p:svc.ts', './decorators', 'LogExec', 'p:dec.ts:LogExec', 'resolved')
    const importsByFileAndSymbol = new Map([['p:svc.ts|./decorators|LogExec', importEdge]])

    const edge = makeTypeRefEdge('p:svc.ts:MyService', 'decorates', './decorators', 'LogExec')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: 'p:dec.ts:LogExec', resolve_status: 'resolved' })
  })

  it('#13 target_symbol=null (이상치) → failed', () => {
    const edge = makeTypeRefEdge('p:a.ts:Foo', 'extends', './b', null)
    const result = resolveOneTypeRef(edge, emptyExportMap, emptyImports, emptyNodeById, emptyFileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#14 imports edge 없음 (대응 import 미탐지) → failed', () => {
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const nodeById = new Map([[childNode.id, childNode], [fileNode.id, fileNode]])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './x', 'Y')
    const result = resolveOneTypeRef(edge, emptyExportMap, emptyImports, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#15 Case 2: source_id가 nodeById에 없음 (fileIdOfNode 실패) → failed', () => {
    const edge = makeTypeRefEdge('p:orphan.ts:Ghost', 'extends', './x', 'Y')
    // nodeById에 아무것도 없음 → sourceNode not found
    const result = resolveOneTypeRef(edge, emptyExportMap, emptyImports, emptyNodeById, emptyFileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#16 Case 2c-2: import target_id가 file 노드 + 심볼 재조회 성공 → resolved', () => {
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const baseFileNode = makeFileNode('p:base.ts', 'base.ts')
    const aFileNode = makeFileNode('p:a.ts', 'a.ts')

    const nodeById = new Map([
      [childNode.id, childNode],
      [baseFileNode.id, baseFileNode],
      [aFileNode.id, aFileNode],
    ])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    // import edge target_id가 파일 노드 (barrel export 등)
    const importEdge = makeImportEdge('p:a.ts', './base', 'Base', 'p:base.ts', 'resolved')
    const importsByFileAndSymbol = new Map([['p:a.ts|./base|Base', importEdge]])

    const exportMap = new Map([['base.ts|Base', 'p:base.ts:Base']])

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './base', 'Base')
    const result = resolveOneTypeRef(edge, exportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: 'p:base.ts:Base', resolve_status: 'resolved' })
  })

  it('#17 Case 2c-2: import target_id가 file 노드 + default fallback → resolved', () => {
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const baseFileNode = makeFileNode('p:base.ts', 'base.ts')
    const defaultNode = makeSymbolNode('p:base.ts:default', 'base.ts', 'default', 'class', true)
    const aFileNode = makeFileNode('p:a.ts', 'a.ts')

    const nodeById = new Map([
      [childNode.id, childNode],
      [baseFileNode.id, baseFileNode],
      [defaultNode.id, defaultNode],
      [aFileNode.id, aFileNode],
    ])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    const importEdge = makeImportEdge('p:a.ts', './base', 'Base', 'p:base.ts', 'resolved')
    const importsByFileAndSymbol = new Map([['p:a.ts|./base|Base', importEdge]])

    // exportMap: 'Base' key 없음, 'default' key만 있음 → fallback
    const exportMap = new Map([['base.ts|default', 'p:base.ts:default']])

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './base', 'Base')
    const result = resolveOneTypeRef(edge, exportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: 'p:base.ts:default', resolve_status: 'resolved' })
  })

  it('#18 Case 2c-2: import target_id가 file 노드 + 재조회 실패 → failed', () => {
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const baseFileNode = makeFileNode('p:base.ts', 'base.ts')
    const aFileNode = makeFileNode('p:a.ts', 'a.ts')

    const nodeById = new Map([
      [childNode.id, childNode],
      [baseFileNode.id, baseFileNode],
      [aFileNode.id, aFileNode],
    ])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    const importEdge = makeImportEdge('p:a.ts', './base', 'Base', 'p:base.ts', 'resolved')
    const importsByFileAndSymbol = new Map([['p:a.ts|./base|Base', importEdge]])

    // exportMap: 빈 map → 재조회 실패
    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './base', 'Base')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#19 Case 2d: import edge pending (불변식 위반) → failed + console.warn (importEdge 필드 사용)', () => {
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const aFileNode = makeFileNode('p:a.ts', 'a.ts')

    const nodeById = new Map([[childNode.id, childNode], [aFileNode.id, aFileNode]])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    // importEdge의 source_id는 파일 노드 id (p:a.ts), target_specifier='./b', target_symbol='Base'
    const importEdge = makeImportEdge('p:a.ts', './b', 'Base', null, 'pending')
    const importsByFileAndSymbol = new Map([['p:a.ts|./b|Base', importEdge]])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './b', 'Base')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    // spec §4.6: importEdge 필드 사용 (type-ref edge 필드 아님)
    expect(warnSpy).toHaveBeenCalledWith(
      '[F4] imports edge still pending (F3 invariant violation):',
      JSON.stringify({
        source_id: 'p:a.ts',        // importEdge.source_id (파일 노드)
        target_specifier: './b',     // importEdge.target_specifier
        target_symbol: 'Base',       // importEdge.target_symbol
      }),
    )

    warnSpy.mockRestore()
  })

  it('#20 Case 2c-0: import target_id가 nodeById에 없음 (dangling) → failed', () => {
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const aFileNode = makeFileNode('p:a.ts', 'a.ts')

    const nodeById = new Map([[childNode.id, childNode], [aFileNode.id, aFileNode]])
    // 'p:base.ts:Base'는 nodeById에 없음 (dangling)
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    const importEdge = makeImportEdge('p:a.ts', './base', 'Base', 'p:base.ts:Base', 'resolved')
    const importsByFileAndSymbol = new Map([['p:a.ts|./base|Base', importEdge]])

    const edge = makeTypeRefEdge('p:a.ts:Child', 'extends', './base', 'Base')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#21 [B2] Case 1: intra-file × sourceNode 고아 (nodeById miss) → failed', () => {
    // specifier=null, source_id가 nodeById에 없음
    const edge = makeTypeRefEdge('p:orphan.ts:Ghost', 'uses_type', null, 'MyType')
    const result = resolveOneTypeRef(edge, emptyExportMap, emptyImports, emptyNodeById, emptyFileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#22 [H6] implements: imports failed → failed', () => {
    const svcNode = makeSymbolNode('p:svc.ts:Svc', 'svc.ts', 'Svc', 'class', true)
    const fileNode = makeFileNode('p:svc.ts', 'svc.ts')
    const nodeById = new Map([[svcNode.id, svcNode], [fileNode.id, fileNode]])
    const fileNodeIdByPath = new Map([['svc.ts', 'p:svc.ts']])

    const importEdge = makeImportEdge('p:svc.ts', './iface', 'ISvc', null, 'failed')
    const importsByFileAndSymbol = new Map([['p:svc.ts|./iface|ISvc', importEdge]])

    const edge = makeTypeRefEdge('p:svc.ts:Svc', 'implements', './iface', 'ISvc')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#23 [H6] mixes: imports failed → failed', () => {
    const classNode = makeSymbolNode('p:w.dart:Widget', 'w.dart', 'Widget', 'class', true)
    const fileNode = makeFileNode('p:w.dart', 'w.dart')
    const nodeById = new Map([[classNode.id, classNode], [fileNode.id, fileNode]])
    const fileNodeIdByPath = new Map([['w.dart', 'p:w.dart']])

    const importEdge = makeImportEdge('p:w.dart', './mixin', 'MixinA', null, 'failed')
    const importsByFileAndSymbol = new Map([['p:w.dart|./mixin|MixinA', importEdge]])

    const edge = makeTypeRefEdge('p:w.dart:Widget', 'mixes', './mixin', 'MixinA')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#24 [H6] decorates: imports failed → failed', () => {
    const svcNode = makeSymbolNode('p:svc.ts:Svc', 'svc.ts', 'Svc', 'class', true)
    const fileNode = makeFileNode('p:svc.ts', 'svc.ts')
    const nodeById = new Map([[svcNode.id, svcNode], [fileNode.id, fileNode]])
    const fileNodeIdByPath = new Map([['svc.ts', 'p:svc.ts']])

    const importEdge = makeImportEdge('p:svc.ts', './dec', 'MyDec', null, 'failed')
    const importsByFileAndSymbol = new Map([['p:svc.ts|./dec|MyDec', importEdge]])

    const edge = makeTypeRefEdge('p:svc.ts:Svc', 'decorates', './dec', 'MyDec')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#25 [H6] uses_type: imports failed (외부 specifier) → failed', () => {
    const compNode = makeSymbolNode('p:comp.ts:Comp', 'comp.ts', 'Comp', 'class', true)
    const fileNode = makeFileNode('p:comp.ts', 'comp.ts')
    const nodeById = new Map([[compNode.id, compNode], [fileNode.id, fileNode]])
    const fileNodeIdByPath = new Map([['comp.ts', 'p:comp.ts']])

    const importEdge = makeImportEdge('p:comp.ts', './m', 'SomeType', null, 'failed')
    const importsByFileAndSymbol = new Map([['p:comp.ts|./m|SomeType', importEdge]])

    const edge = makeTypeRefEdge('p:comp.ts:Comp', 'uses_type', './m', 'SomeType')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#26 [M8] 알려진 한계: namespace import → failed (회귀 방지)', () => {
    // import * as NS from './m'; class X extends NS.Base
    // F2 가정: namespace import는 target_symbol='*'로 기록 → key 불일치
    const classNode = makeSymbolNode('p:a.ts:X', 'a.ts', 'X', 'class', true)
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const nodeById = new Map([[classNode.id, classNode], [fileNode.id, fileNode]])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    // importsByFileAndSymbol에는 '...|./m|*' key만 있음
    const importEdge = makeImportEdge('p:a.ts', './m', '*', 'p:m.ts', 'resolved')
    const importsByFileAndSymbol = new Map([['p:a.ts|./m|*', importEdge]])

    // type-ref edge의 target_symbol='Base' → lookup key '...|./m|Base' 부재
    const edge = makeTypeRefEdge('p:a.ts:X', 'extends', './m', 'Base')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#27 [M8] default import local binding → resolved', () => {
    // import X from './m'; class C extends X
    // imports edge: target_symbol='default', type-ref: target_symbol='X' → 불일치
    const classNode = makeSymbolNode('p:a.ts:C', 'a.ts', 'C', 'class', true)
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const defaultNode = makeSymbolNode('p:m.ts:default', 'm.ts', 'default', 'class', true)
    const nodeById = new Map([[classNode.id, classNode], [fileNode.id, fileNode], [defaultNode.id, defaultNode]])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    // imports edge는 '...|./m|default' key로 등록
    const importEdge = {
      ...makeImportEdge('p:a.ts', './m', 'default', 'p:m.ts:default', 'resolved'),
      target_imported_symbol: 'default',
      target_local_symbol: 'X',
    }
    const importsByFileAndSymbol = new Map([
      ['p:a.ts|./m|default', importEdge],
      ['p:a.ts|./m|X', importEdge],
    ])

    // type-ref: target_symbol='X' → lookup key '...|./m|X' 부재
    const edge = makeTypeRefEdge('p:a.ts:C', 'extends', './m', 'X')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: 'p:m.ts:default', resolve_status: 'resolved' })
  })

  it('#28 [M8] 알려진 한계: type-only re-export 체인 → failed (회귀 방지)', () => {
    // export type { X } from '...' — buildImportsIndex에 없을 때
    const classNode = makeSymbolNode('p:a.ts:Cls', 'a.ts', 'Cls', 'class', true)
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const nodeById = new Map([[classNode.id, classNode], [fileNode.id, fileNode]])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    // imports 없음 (type-only re-export가 F3에서 처리 안 됨 시나리오)
    const edge = makeTypeRefEdge('p:a.ts:Cls', 'uses_type', './types', 'MyTypeX')
    const result = resolveOneTypeRef(edge, emptyExportMap, emptyImports, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#29 [L6] re_exports edge 경유 resolved', () => {
    // re_exports edge로 buildImportsIndex에 등록된 경우
    const classNode = makeSymbolNode('p:a.ts:Consumer', 'a.ts', 'Consumer', 'class', true)
    const targetNode = makeSymbolNode('p:impl.ts:Base', 'impl.ts', 'Base', 'class', true)
    const aFileNode = makeFileNode('p:a.ts', 'a.ts')

    const nodeById = new Map([
      [classNode.id, classNode],
      [targetNode.id, targetNode],
      [aFileNode.id, aFileNode],
    ])
    const fileNodeIdByPath = new Map([['a.ts', 'p:a.ts']])

    // re_exports edge: target_symbol='Base', resolved → targetNode (심볼 노드)
    const reExportEdge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts',
      target_id: 'p:impl.ts:Base',
      relation: 're_exports',
      target_specifier: './impl',
      target_symbol: 'Base',
      resolve_status: 'resolved',
    }
    const importsByFileAndSymbol = new Map([['p:a.ts|./impl|Base', reExportEdge]])

    const edge = makeTypeRefEdge('p:a.ts:Consumer', 'extends', './impl', 'Base')
    const result = resolveOneTypeRef(edge, emptyExportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath)

    expect(result).toEqual({ target_id: 'p:impl.ts:Base', resolve_status: 'resolved' })
  })
})

// ══════════════════════════════════════════════════════════════
// 통합 테스트 (resolveTypeRefs 전체 호출)
// ══════════════════════════════════════════════════════════════

describe('resolveTypeRefs (통합)', () => {
  const emptyFiles: SourceFile[] = []

  it('#1 Happy path — 모든 타입 참조 resolved (S1 NestJS 축약판)', async () => {
    // NestJS: AppController extends/implements/decorates 로컬 심볼 참조
    const fileNodeCtrl = makeFileNode('p:ctrl.ts', 'ctrl.ts')
    const fileNodeBase = makeFileNode('p:base.ts', 'base.ts')
    const ctrlNode = makeSymbolNode('p:ctrl.ts:AppController', 'ctrl.ts', 'AppController', 'class', true)
    const baseNode = makeSymbolNode('p:base.ts:BaseController', 'base.ts', 'BaseController', 'class', true)
    const ifNode = makeSymbolNode('p:base.ts:IController', 'base.ts', 'IController', 'interface', true)
    const decNode = makeSymbolNode('p:base.ts:Controller', 'base.ts', 'Controller', 'function', true)

    const nodes: CodeNodeRaw[] = [fileNodeCtrl, fileNodeBase, ctrlNode, baseNode, ifNode, decNode]

    // imports edges (F3 기완료)
    const importBaseEdge = makeImportEdge('p:ctrl.ts', './base', 'BaseController', 'p:base.ts:BaseController', 'resolved')
    const importIfEdge = makeImportEdge('p:ctrl.ts', './base', 'IController', 'p:base.ts:IController', 'resolved')
    const importDecEdge = makeImportEdge('p:ctrl.ts', './base', 'Controller', 'p:base.ts:Controller', 'resolved')

    // type-ref edges (pending)
    const extendsEdge = makeTypeRefEdge('p:ctrl.ts:AppController', 'extends', './base', 'BaseController')
    const implementsEdge = makeTypeRefEdge('p:ctrl.ts:AppController', 'implements', './base', 'IController')
    const decoratesEdge = makeTypeRefEdge('p:ctrl.ts:AppController', 'decorates', './base', 'Controller')

    const edges: CodeEdgeRaw[] = [importBaseEdge, importIfEdge, importDecEdge, extendsEdge, implementsEdge, decoratesEdge]

    const result = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result).toHaveLength(6)
    // imports edges: pass-through
    expect(result[0]).toBe(edges[0])
    expect(result[1]).toBe(edges[1])
    expect(result[2]).toBe(edges[2])
    // type-ref edges: resolved
    expect(result[3].resolve_status).toBe('resolved')
    expect(result[3].target_id).toBe('p:base.ts:BaseController')
    expect(result[4].resolve_status).toBe('resolved')
    expect(result[4].target_id).toBe('p:base.ts:IController')
    expect(result[5].resolve_status).toBe('resolved')
    expect(result[5].target_id).toBe('p:base.ts:Controller')
  })

  it('#2 혼합: 내부 resolved + 외부 external + 실패 failed + target_id 무결성 양방향 assert (불변식 F4-8)', async () => {
    const fileNodeA = makeFileNode('p:a.ts', 'a.ts')
    const fileNodeB = makeFileNode('p:b.ts', 'b.ts')
    const childNode = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const parentNode = makeSymbolNode('p:b.ts:Parent', 'b.ts', 'Parent', 'class', true)

    const nodes: CodeNodeRaw[] = [fileNodeA, fileNodeB, childNode, parentNode]

    // local resolved import
    const importLocalEdge = makeImportEdge('p:a.ts', './b', 'Parent', 'p:b.ts:Parent', 'resolved')
    // external import
    const importExtEdge = makeImportEdge('p:a.ts', '@nestjs/common', 'Injectable', null, 'external')
    // missing import → 없음

    const extendsEdge = makeTypeRefEdge('p:a.ts:Child', 'extends', './b', 'Parent')
    const decoratesEdge = makeTypeRefEdge('p:a.ts:Child', 'decorates', '@nestjs/common', 'Injectable')
    const failEdge = makeTypeRefEdge('p:a.ts:Child', 'implements', './missing', 'ISome')

    const edges: CodeEdgeRaw[] = [importLocalEdge, importExtEdge, extendsEdge, decoratesEdge, failEdge]
    const result = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result).toHaveLength(5)

    // 양방향 assert (불변식 F4-8):
    // (a) resolved → target_id !== null
    result.filter(e => e.resolve_status === 'resolved').forEach(e =>
      expect(e.target_id).not.toBeNull()
    )
    // (b) target_id === null → status in {external, failed}
    result.filter(e => e.target_id === null).forEach(e =>
      expect(['external', 'failed']).toContain(e.resolve_status)
    )
    // (c) status in {external, failed} → target_id === null
    result.filter(e => ['external', 'failed'].includes(e.resolve_status as string)).forEach(e =>
      expect(e.target_id).toBeNull()
    )
  })

  it('#3 pending 소거 — 5종 relation × pending → 하나도 pending 남지 않음 (불변식 #3)', async () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const classNode = makeSymbolNode('p:a.ts:Foo', 'a.ts', 'Foo', 'class', true)
    const nodes: CodeNodeRaw[] = [fileNode, classNode]

    // 모두 pending인 type-ref edges, 대응 import 없음 → 모두 failed
    const pendingEdges: CodeEdgeRaw[] = [
      makeTypeRefEdge('p:a.ts:Foo', 'extends', './x', 'X'),
      makeTypeRefEdge('p:a.ts:Foo', 'implements', './y', 'Y'),
      makeTypeRefEdge('p:a.ts:Foo', 'mixes', './z', 'Z'),
      makeTypeRefEdge('p:a.ts:Foo', 'uses_type', './t', 'T'),
      makeTypeRefEdge('p:a.ts:Foo', 'decorates', './d', 'D'),
    ]

    const result = await resolveTypeRefs(pendingEdges, nodes, emptyFiles)

    expect(result).toHaveLength(5)
    for (const edge of result) {
      expect(edge.resolve_status).not.toBe('pending')
    }
  })

  it('#4 non-target edge pass-through — 참조 동일성 유지 (불변식 #4)', async () => {
    const nodes: CodeNodeRaw[] = []
    const callsEdge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts:Foo',
      target_id: 'p:b.ts:Bar',
      relation: 'calls',
      target_specifier: null,
      target_symbol: null,
      resolve_status: 'resolved',
    }
    const importEdge = makeImportEdge('p:a.ts', './b', 'Bar', 'p:b.ts:Bar', 'resolved')
    const containsEdge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts',
      target_id: 'p:a.ts:Foo',
      relation: 'contains',
      target_specifier: null,
      target_symbol: null,
      resolve_status: 'n/a',
    }

    const edges: CodeEdgeRaw[] = [callsEdge, importEdge, containsEdge]
    const result = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result).toHaveLength(3)
    // 참조 동일성 (toBe)
    expect(result[0]).toBe(edges[0])
    expect(result[1]).toBe(edges[1])
    expect(result[2]).toBe(edges[2])
  })

  it('#5 입력 비변형 — edges/nodes의 모든 프로퍼티 불변 (불변식 #1)', async () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const classNode = makeSymbolNode('p:a.ts:Foo', 'a.ts', 'Foo', 'class', true)
    const nodes: CodeNodeRaw[] = [fileNode, classNode]

    const importEdge = makeImportEdge('p:a.ts', './b', 'Bar', null, 'external')
    const typeRefEdge = makeTypeRefEdge('p:a.ts:Foo', 'extends', './b', 'Bar')
    const edges: CodeEdgeRaw[] = [importEdge, typeRefEdge]

    // deep snapshot before
    const edgesSnapshot = structuredClone(edges)
    const nodesSnapshot = structuredClone(nodes)

    await resolveTypeRefs(edges, nodes, emptyFiles)

    // 입력 배열과 각 객체 불변 확인
    expect(edges).toEqual(edgesSnapshot)
    expect(nodes).toEqual(nodesSnapshot)
  })

  it('#6 출력 순서/길이 보존 (불변식 #2)', async () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const classNode = makeSymbolNode('p:a.ts:X', 'a.ts', 'X', 'class', true)
    const nodes: CodeNodeRaw[] = [fileNode, classNode]

    const callsEdge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts:X',
      target_id: null,
      relation: 'calls',
      target_specifier: null,
      target_symbol: null,
      resolve_status: 'resolved',
    }
    const typeRef1 = makeTypeRefEdge('p:a.ts:X', 'extends', './b', 'B1')
    const importEdge = makeImportEdge('p:a.ts', './c', 'C', null, 'external')
    const typeRef2 = makeTypeRefEdge('p:a.ts:X', 'uses_type', null, 'LocalType')

    const edges: CodeEdgeRaw[] = [callsEdge, typeRef1, importEdge, typeRef2]
    const result = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result).toHaveLength(4)
    // 순서 보존: 각 위치 확인
    expect(result[0].relation).toBe('calls')
    expect(result[1].relation).toBe('extends')
    expect(result[2].relation).toBe('imports')
    expect(result[3].relation).toBe('uses_type')
  })

  it('#7 멱등성 — 동일 입력 2회 호출 결과 deep equal (불변식 #5)', async () => {
    const fileNodeA = makeFileNode('p:a.ts', 'a.ts')
    const fileNodeB = makeFileNode('p:b.ts', 'b.ts')
    const classNodeA = makeSymbolNode('p:a.ts:Child', 'a.ts', 'Child', 'class', true)
    const classNodeB = makeSymbolNode('p:b.ts:Parent', 'b.ts', 'Parent', 'class', true)
    const nodes: CodeNodeRaw[] = [fileNodeA, fileNodeB, classNodeA, classNodeB]

    const importEdge = makeImportEdge('p:a.ts', './b', 'Parent', 'p:b.ts:Parent', 'resolved')
    const typeRef = makeTypeRefEdge('p:a.ts:Child', 'extends', './b', 'Parent')
    const edges: CodeEdgeRaw[] = [importEdge, typeRef]

    const result1 = await resolveTypeRefs(edges, nodes, emptyFiles)
    const result2 = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result1).toEqual(result2)
  })

  it('#8 intra-file 해석 — specifier=null인 uses_type edges 다수 resolved', async () => {
    const fileNode = makeFileNode('p:m.ts', 'm.ts')
    const compNode = makeSymbolNode('p:m.ts:MyComp', 'm.ts', 'MyComp', 'class', true)
    const typeA = makeSymbolNode('p:m.ts:TypeA', 'm.ts', 'TypeA', 'type', true)
    const typeB = makeSymbolNode('p:m.ts:TypeB', 'm.ts', 'TypeB', 'interface', true)
    const nodes: CodeNodeRaw[] = [fileNode, compNode, typeA, typeB]

    const edge1 = makeTypeRefEdge('p:m.ts:MyComp', 'uses_type', null, 'TypeA')
    const edge2 = makeTypeRefEdge('p:m.ts:MyComp', 'uses_type', null, 'TypeB')
    const edges: CodeEdgeRaw[] = [edge1, edge2]

    const result = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result).toHaveLength(2)
    expect(result[0].resolve_status).toBe('resolved')
    expect(result[0].target_id).toBe('p:m.ts:TypeA')
    expect(result[1].resolve_status).toBe('resolved')
    expect(result[1].target_id).toBe('p:m.ts:TypeB')
  })

  it('#9 Dart mixes — 여러 mixin 모두 resolved (S3)', async () => {
    const fileNodeWidget = makeFileNode('p:widget.dart', 'widget.dart')
    const fileNodeMixins = makeFileNode('p:mixins.dart', 'mixins.dart')
    const widgetNode = makeSymbolNode('p:widget.dart:MyWidget', 'widget.dart', 'MyWidget', 'class', true)
    const mixinA = makeSymbolNode('p:mixins.dart:MixinA', 'mixins.dart', 'MixinA', 'class', true)
    const mixinB = makeSymbolNode('p:mixins.dart:MixinB', 'mixins.dart', 'MixinB', 'class', true)
    const nodes: CodeNodeRaw[] = [fileNodeWidget, fileNodeMixins, widgetNode, mixinA, mixinB]

    const importMixinAEdge = makeImportEdge('p:widget.dart', './mixins', 'MixinA', 'p:mixins.dart:MixinA', 'resolved')
    const importMixinBEdge = makeImportEdge('p:widget.dart', './mixins', 'MixinB', 'p:mixins.dart:MixinB', 'resolved')
    const mixesA = makeTypeRefEdge('p:widget.dart:MyWidget', 'mixes', './mixins', 'MixinA')
    const mixesB = makeTypeRefEdge('p:widget.dart:MyWidget', 'mixes', './mixins', 'MixinB')

    const edges: CodeEdgeRaw[] = [importMixinAEdge, importMixinBEdge, mixesA, mixesB]
    const result = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result).toHaveLength(4)
    expect(result[2].resolve_status).toBe('resolved')
    expect(result[2].target_id).toBe('p:mixins.dart:MixinA')
    expect(result[3].resolve_status).toBe('resolved')
    expect(result[3].target_id).toBe('p:mixins.dart:MixinB')
  })

  it('#10 [H5] default import — default canonical and local alias both resolve', async () => {
    const fileNodeA = makeFileNode('p:a.ts', 'a.ts')
    const fileNodeM = makeFileNode('p:m.ts', 'm.ts')
    const classNodeA = makeSymbolNode('p:a.ts:ChildA', 'a.ts', 'ChildA', 'class', true)
    const classNodeB = makeSymbolNode('p:a.ts:ChildB', 'a.ts', 'ChildB', 'class', true)
    const defaultExportNode = makeSymbolNode('p:m.ts:default', 'm.ts', 'default', 'class', true)
    const nodes: CodeNodeRaw[] = [fileNodeA, fileNodeM, classNodeA, classNodeB, defaultExportNode]

    // (a) F2가 target_symbol='default'로 정규화 → import lookup 성공
    const importDefaultEdge = {
      ...makeImportEdge('p:a.ts', './m', 'default', 'p:m.ts:default', 'resolved'),
      target_imported_symbol: 'default',
      target_local_symbol: 'X',
    }
    const typeRefA = makeTypeRefEdge('p:a.ts:ChildA', 'extends', './m', 'default')

    const typeRefB = makeTypeRefEdge('p:a.ts:ChildB', 'extends', './m', 'X')

    const edges: CodeEdgeRaw[] = [importDefaultEdge, typeRefA, typeRefB]
    const result = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result).toHaveLength(3)
    // (a) resolved
    expect(result[1].resolve_status).toBe('resolved')
    expect(result[1].target_id).toBe('p:m.ts:default')
    expect(result[2].resolve_status).toBe('resolved')
    expect(result[2].target_id).toBe('p:m.ts:default')
  })

  it('#11 이미 처리된 edge 건드리지 않음 — resolve_status!==\'pending\'은 재처리 금지', async () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const classNode = makeSymbolNode('p:a.ts:Foo', 'a.ts', 'Foo', 'class', true)
    const nodes: CodeNodeRaw[] = [fileNode, classNode]

    // 이미 failed 상태인 type-ref edge
    const alreadyFailedEdge = makeTypeRefEdge('p:a.ts:Foo', 'extends', './b', 'Base', 'failed', null)
    const alreadyResolvedEdge = makeTypeRefEdge('p:a.ts:Foo', 'implements', './c', 'IFoo', 'resolved', 'p:c.ts:IFoo')

    const edges: CodeEdgeRaw[] = [alreadyFailedEdge, alreadyResolvedEdge]
    const result = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result).toHaveLength(2)
    // 원본 참조 유지 (재처리 안 함)
    expect(result[0]).toBe(edges[0])
    expect(result[1]).toBe(edges[1])
  })

  it('#12 빈 입력 → [] 반환, throw 없음', async () => {
    await expect(resolveTypeRefs([], [], emptyFiles)).resolves.toEqual([])
  })

  it('#13 타입 참조 edge 없음 — 전체 pass-through', async () => {
    const nodes: CodeNodeRaw[] = []
    const callsEdge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts:Foo',
      target_id: null,
      relation: 'calls',
      target_specifier: null,
      target_symbol: null,
      resolve_status: 'resolved',
    }
    const importEdge = makeImportEdge('p:a.ts', './b', 'B', 'p:b.ts:B', 'resolved')

    const edges: CodeEdgeRaw[] = [callsEdge, importEdge]
    const result = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result).toHaveLength(2)
    expect(result[0]).toBe(edges[0])
    expect(result[1]).toBe(edges[1])
  })

  it('#14 throw 하지 않음 — 고아 source_id, 빈 exportMap 등 에러 시나리오', async () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const nodes: CodeNodeRaw[] = [fileNode]

    const orphanEdge = makeTypeRefEdge('p:orphan.ts:Ghost', 'extends', './x', 'Y')
    const nullSymbolEdge = makeTypeRefEdge('p:a.ts:Foo', 'implements', './b', null)

    const edges: CodeEdgeRaw[] = [orphanEdge, nullSymbolEdge]

    await expect(resolveTypeRefs(edges, nodes, emptyFiles)).resolves.not.toThrow()

    const result = await resolveTypeRefs(edges, nodes, emptyFiles)
    for (const edge of result) {
      expect(edge.resolve_status).toBe('failed')
    }
  })

  it('#15 [L5] 대규모 perf — 1,000 nodes + 5,000 edges (type-ref 500개), 임계값 내 완료', async () => {
    // 노드 생성: 파일 노드 100개 + 클래스 노드 900개
    const nodes: CodeNodeRaw[] = []
    for (let i = 0; i < 100; i++) {
      nodes.push(makeFileNode(`p:f${i}.ts`, `f${i}.ts`))
    }
    for (let i = 0; i < 900; i++) {
      const fileIdx = i % 100
      nodes.push(makeSymbolNode(`p:f${fileIdx}.ts:Class${i}`, `f${fileIdx}.ts`, `Class${i}`, 'class', true))
    }

    // edges: 4500 non-type-ref (calls) + 500 type-ref (extends, pending)
    const edges: CodeEdgeRaw[] = []

    // non-type-ref edges
    for (let i = 0; i < 4500; i++) {
      edges.push({
        repo_id: 'proj',
        source_id: `p:f${i % 100}.ts:Class${i % 900}`,
        target_id: `p:f${(i + 1) % 100}.ts:Class${(i + 1) % 900}`,
        relation: 'calls',
        target_specifier: null,
        target_symbol: null,
        resolve_status: 'resolved',
      })
    }

    // type-ref edges (pending, 대응 imports 없음 → failed)
    for (let i = 0; i < 500; i++) {
      edges.push(makeTypeRefEdge(
        `p:f${i % 100}.ts:Class${i}`,
        'extends',
        `./base${i}`,
        `Base${i}`,
      ))
    }

    const start = performance.now()
    const result = await resolveTypeRefs(edges, nodes, [])
    const duration = performance.now() - start

    const threshold = process.env.CI ? 200 : 100
    expect(duration).toBeLessThan(threshold)
    expect(result).toHaveLength(5000)
  })

  it('#16 [L7] files 인자 무시 검증 — files=[] vs files=대량 → 동일 결과', async () => {
    const fileNode = makeFileNode('p:a.ts', 'a.ts')
    const classNode = makeSymbolNode('p:a.ts:Foo', 'a.ts', 'Foo', 'class', true)
    const nodes: CodeNodeRaw[] = [fileNode, classNode]

    const typeRef = makeTypeRefEdge('p:a.ts:Foo', 'extends', './b', 'Base')
    const edges: CodeEdgeRaw[] = [typeRef]

    // files=[] (빈 배열)
    const result1 = await resolveTypeRefs(edges, nodes, [])

    // files=대량 (무시되어야 함)
    const largeFiles: SourceFile[] = Array.from({ length: 1000 }, (_, i) => ({
      path: `file${i}.ts`,
      content: `// file ${i}`,
      isTest: false,
    }))
    const result2 = await resolveTypeRefs(edges, nodes, largeFiles)

    expect(result1).toEqual(result2)
  })

  it('#17 S2 Next.js uses_type 외부 → external (통합 #11 보완)', async () => {
    // S2: Next.js 컴포넌트가 React.FC를 uses_type으로 참조 → 외부 패키지 → external
    const fileNodePage = makeFileNode('p:page.tsx', 'page.tsx')
    const homeNode = makeSymbolNode('p:page.tsx:HomePage', 'page.tsx', 'HomePage', 'function', true)
    const nodes: CodeNodeRaw[] = [fileNodePage, homeNode]

    // external import edge (react는 외부 패키지)
    const importReactEdge = makeImportEdge('p:page.tsx', 'react', 'FC', null, 'external')

    // uses_type type-ref edge (pending)
    const usesTypeEdge = makeTypeRefEdge('p:page.tsx:HomePage', 'uses_type', 'react', 'FC')

    const edges: CodeEdgeRaw[] = [importReactEdge, usesTypeEdge]
    const result = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result).toHaveLength(2)
    expect(result[0]).toBe(edges[0]) // import edge pass-through
    expect(result[1].resolve_status).toBe('external')
    expect(result[1].target_id).toBeNull()
  })

  it('#18 namespace import 한계 회귀 → failed (통합 #13)', async () => {
    // import * as NS from './m'; class X extends NS.Base
    // importsByFileAndSymbol에 '...|./m|*' key만 등록, type-ref는 'Base' lookup
    const fileNodeA = makeFileNode('p:a.ts', 'a.ts')
    const classX = makeSymbolNode('p:a.ts:X', 'a.ts', 'X', 'class', true)
    const nodes: CodeNodeRaw[] = [fileNodeA, classX]

    // namespace import edge: target_symbol='*'
    const nsImportEdge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts',
      target_id: 'p:m.ts',
      relation: 'imports',
      target_specifier: './m',
      target_symbol: '*',
      resolve_status: 'resolved',
    }

    // type-ref: target_symbol='Base' → lookup key '...|./m|Base' 부재 → failed
    const extendsEdge = makeTypeRefEdge('p:a.ts:X', 'extends', './m', 'Base')

    const edges: CodeEdgeRaw[] = [nsImportEdge, extendsEdge]
    const result = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result).toHaveLength(2)
    expect(result[1].resolve_status).toBe('failed')
    expect(result[1].target_id).toBeNull()
  })

  it('#19 type-only re-export 한계 회귀 → failed (통합 #14)', async () => {
    // export type { X } from '...' — imports/re_exports edge 자체 부재 시나리오
    const fileNodeA = makeFileNode('p:a.ts', 'a.ts')
    const classA = makeSymbolNode('p:a.ts:Cls', 'a.ts', 'Cls', 'class', true)
    const nodes: CodeNodeRaw[] = [fileNodeA, classA]

    // imports edge 없음 (type-only re-export가 F3에서 처리 안 된 시나리오)
    const usesTypeEdge = makeTypeRefEdge('p:a.ts:Cls', 'uses_type', './types', 'MyTypeX')

    const result = await resolveTypeRefs([usesTypeEdge], nodes, emptyFiles)

    expect(result).toHaveLength(1)
    expect(result[0].resolve_status).toBe('failed')
    expect(result[0].target_id).toBeNull()
  })

  it('#20 re_exports edge 경유 resolved (통합 #15)', async () => {
    // re_exports edge가 buildImportsIndex에 등록되어 type-ref 해석 성공
    const fileNodeA = makeFileNode('p:a.ts', 'a.ts')
    const consumerNode = makeSymbolNode('p:a.ts:Consumer', 'a.ts', 'Consumer', 'class', true)
    const targetNode = makeSymbolNode('p:impl.ts:Base', 'impl.ts', 'Base', 'class', true)
    const nodes: CodeNodeRaw[] = [fileNodeA, consumerNode, targetNode]

    // re_exports edge (imports 아님) — buildImportsIndex가 re_exports도 포함함
    const reExportEdge: CodeEdgeRaw = {
      repo_id: 'proj',
      source_id: 'p:a.ts',
      target_id: 'p:impl.ts:Base',
      relation: 're_exports',
      target_specifier: './impl',
      target_symbol: 'Base',
      resolve_status: 'resolved',
    }

    const extendsEdge = makeTypeRefEdge('p:a.ts:Consumer', 'extends', './impl', 'Base')

    const edges: CodeEdgeRaw[] = [reExportEdge, extendsEdge]
    const result = await resolveTypeRefs(edges, nodes, emptyFiles)

    expect(result).toHaveLength(2)
    expect(result[0]).toBe(edges[0]) // re_exports edge pass-through
    expect(result[1].resolve_status).toBe('resolved')
    expect(result[1].target_id).toBe('p:impl.ts:Base')
  })
})
