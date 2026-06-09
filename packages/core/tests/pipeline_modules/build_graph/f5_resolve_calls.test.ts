/**
 * F5: resolveCalls — 유닛 + 통합 테스트
 * SOT: specs/build_graph/specs/f5_resolve_calls/spec.md
 *      specs/build_graph/specs/f5_resolve_calls/tests.md
 */
import { describe, it, expect } from 'vitest'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap, EnumValueMap } from '@/pipeline_modules/build_graph/types.js'
import {
  buildNodeIndices,
  buildEdgeIndices,
  resolveSuperCall,
  resolveDICall,
  resolveIntraFileCall,
  resolveImportedCall,
  resolveCalls,
  type CallIndices,
} from '@/pipeline_modules/build_graph/f5_resolve_calls.js'

// ────────────────────────────────────────────────────────────────
// 헬퍼: 최소 노드/엣지 팩토리
// ────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string }): CodeNodeRaw {
  return {
    repo_id: 'p',
    line_start: 1,
    line_end: 10,
    signature: null,
    exported: true,
    parse_status: 'ok',
    is_test: false,
    test_type: null,
    is_async: false,
    jsdoc: null,
    ...overrides,
  }
}

function makeEdge(overrides: Partial<CodeEdgeRaw> & { relation: CodeEdgeRaw['relation']; source_id: string }): CodeEdgeRaw {
  return {
    repo_id: 'p',
    target_id: null,
    target_specifier: null,
    target_symbol: null,
    resolve_status: 'pending',
    ...overrides,
  }
}

/** buildNodeIndices + buildEdgeIndices 결합 헬퍼 */
function makeIndices(nodes: CodeNodeRaw[], edges: CodeEdgeRaw[]): CallIndices {
  return { ...buildNodeIndices(nodes), ...buildEdgeIndices(edges) }
}

// ────────────────────────────────────────────────────────────────
// 1.1 buildNodeIndices
// ────────────────────────────────────────────────────────────────

describe('buildNodeIndices', () => {
  it('#1 정상: class 1 + method 2', () => {
    const classNode = makeNode({ id: 'p:a.ts:C', type: 'class', name: 'C', file_path: 'a.ts' })
    const m1        = makeNode({ id: 'p:a.ts:C.m1', type: 'method', name: 'C.m1', file_path: 'a.ts' })
    const m2        = makeNode({ id: 'p:a.ts:C.m2', type: 'method', name: 'C.m2', file_path: 'a.ts' })
    const idx       = buildNodeIndices([classNode, m1, m2])

    expect(idx.nodesByClass.get('C')).toEqual([classNode])
    const methods = idx.methodsByClassId.get('p:a.ts:C')!
    expect(methods.get('m1')).toBe(m1)
    expect(methods.get('m2')).toBe(m2)
    expect(idx.ownerClassByMethodId.get('p:a.ts:C.m1')).toBe('p:a.ts:C')
    expect(idx.ownerClassByMethodId.get('p:a.ts:C.m2')).toBe('p:a.ts:C')
  })

  it('#2 경계: method name에 점 없음 (F2 버그 방어)', () => {
    const node = makeNode({ id: 'p:a.ts:solo', type: 'method', name: 'solo', file_path: 'a.ts' })
    const idx  = buildNodeIndices([node])
    expect(idx.methodsByClassId.size).toBe(0)
    expect(idx.ownerClassByMethodId.size).toBe(0)
    // nodeById는 등록됨
    expect(idx.nodeById.get('p:a.ts:solo')).toBe(node)
  })

  it('#3 경계: method id가 dotSuffix로 끝나지 않음 (id 규약 위반)', () => {
    const node = makeNode({ id: 'p:a.ts:DIFFERENT', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const idx  = buildNodeIndices([node])
    expect(idx.methodsByClassId.size).toBe(0)
  })

  it('#4 경계: 동명 메서드 중복 — 첫 노드 우선 (B5 해소)', () => {
    const first  = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts', line_start: 1 })
    const second = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts', line_start: 20 })
    const idx    = buildNodeIndices([first, second])
    const methods = idx.methodsByClassId.get('p:a.ts:C')!
    expect(methods.get('m')).toBe(first)
  })

  it('#5 경계: ownerClassByMethodId 중복 방어', () => {
    const m1 = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const m2 = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const idx = buildNodeIndices([m1, m2])
    // 중복 id라도 첫 값 유지
    expect(idx.ownerClassByMethodId.get('p:a.ts:C.m')).toBe('p:a.ts:C')
    expect(idx.ownerClassByMethodId.size).toBe(1)
  })

  it('#6 경계: 동명 class 2개 + file_path 사전순 정렬 (H4)', () => {
    const cB = makeNode({ id: 'p:b.ts:C', type: 'class', name: 'C', file_path: 'b.ts' })
    const cA = makeNode({ id: 'p:a.ts:C', type: 'class', name: 'C', file_path: 'a.ts' })
    const idx = buildNodeIndices([cB, cA])  // b.ts 먼저 입력

    const arr = idx.nodesByClass.get('C')!
    expect(arr[0].file_path).toBe('a.ts')  // 사전순 정렬 결과
    expect(arr[1].file_path).toBe('b.ts')
  })

  it('#7 경계: 동명 class 3개 file_path 혼합', () => {
    const cZ = makeNode({ id: 'p:z.ts:C', type: 'class', name: 'C', file_path: 'z.ts' })
    const cA = makeNode({ id: 'p:a.ts:C', type: 'class', name: 'C', file_path: 'a.ts' })
    const cM = makeNode({ id: 'p:m.ts:C', type: 'class', name: 'C', file_path: 'm.ts' })
    const idx = buildNodeIndices([cZ, cA, cM])

    const arr = idx.nodesByClass.get('C')!
    expect(arr.map(n => n.file_path)).toEqual(['a.ts', 'm.ts', 'z.ts'])
  })

  it('#8 경계: class 노드만 (method 없음)', () => {
    const cls = makeNode({ id: 'p:a.ts:C', type: 'class', name: 'C', file_path: 'a.ts' })
    const idx = buildNodeIndices([cls])
    expect(idx.methodsByClassId.size).toBe(0)
    expect(idx.nodesByClass.get('C')).toEqual([cls])
  })

  it('#9 경계: method 노드만 (class 없음 — F2 버그)', () => {
    const m = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const idx = buildNodeIndices([m])
    // methodsByClassId에는 등록됨 (class 존재 여부 체크 없음)
    expect(idx.methodsByClassId.has('p:a.ts:C')).toBe(true)
    expect(idx.nodesByClass.size).toBe(0)
  })

  it('#10 경계: 빈 입력', () => {
    const idx = buildNodeIndices([])
    expect(idx.nodeById.size).toBe(0)
    expect(idx.ownerClassByMethodId.size).toBe(0)
    expect(idx.methodsByClassId.size).toBe(0)
    expect(idx.nodesByClass.size).toBe(0)
  })

  it('#11 경계: property node id가 name suffix와 맞지 않으면 ownerClassByMethodId에 등록하지 않는다', () => {
    const prop = makeNode({ id: 'p:a.ts:C.other', type: 'property', name: 'C.fn', file_path: 'a.ts' })
    const idx = buildNodeIndices([prop])

    expect(idx.ownerClassByMethodId.has(prop.id)).toBe(false)
  })

  it('#12 경계: property node name에 class/member 구분 점이 없으면 ownerClassByMethodId에 등록하지 않는다', () => {
    const prop = makeNode({ id: 'p:a.ts:fn', type: 'property', name: 'fn', file_path: 'a.ts' })
    const idx = buildNodeIndices([prop])

    expect(idx.ownerClassByMethodId.has(prop.id)).toBe(false)
  })

  it('#13 경계: 동명 class의 file_path도 같으면 정렬 comparator는 동일 순서를 유지한다', () => {
    const first = makeNode({ id: 'p:a.ts:C1', type: 'class', name: 'C', file_path: 'a.ts' })
    const second = makeNode({ id: 'p:a.ts:C2', type: 'class', name: 'C', file_path: 'a.ts' })
    const idx = buildNodeIndices([first, second])

    expect(idx.nodesByClass.get('C')).toEqual([first, second])
  })

  it('#14 정상: Dart bare method name도 id에서 owner class와 method를 인덱싱한다', () => {
    const method = makeNode({ id: 'p:a.dart:_State.build', type: 'method', name: 'build', file_path: 'a.dart' })
    const idx = buildNodeIndices([method])

    expect(idx.ownerClassByMethodId.get('p:a.dart:_State.build')).toBe('p:a.dart:_State')
    expect(idx.methodsByClassId.get('p:a.dart:_State')?.get('build')).toBe(method)
  })
})

// ────────────────────────────────────────────────────────────────
// 1.2 buildEdgeIndices
// ────────────────────────────────────────────────────────────────

describe('buildEdgeIndices', () => {
  it('#1 정상: extends resolved', () => {
    const edge = makeEdge({
      relation: 'extends',
      source_id: 'p:a.ts:Child',
      target_id: 'p:b.ts:Base',
      resolve_status: 'resolved',
    })
    const idx = buildEdgeIndices([edge])
    expect(idx.extendsMap.get('p:a.ts:Child')).toBe('p:b.ts:Base')
  })

  it('#2a 경계: extends external 미등록', () => {
    const edge = makeEdge({ relation: 'extends', source_id: 'p:a.ts:Child', resolve_status: 'external' })
    const idx  = buildEdgeIndices([edge])
    expect(idx.extendsMap.size).toBe(0)
  })

  it('#2b 경계: extends failed 미등록', () => {
    const edge = makeEdge({ relation: 'extends', source_id: 'p:a.ts:Child', resolve_status: 'failed' })
    const idx  = buildEdgeIndices([edge])
    expect(idx.extendsMap.size).toBe(0)
  })

  it('#2c 경계: extends pending 미등록', () => {
    const edge = makeEdge({ relation: 'extends', source_id: 'p:a.ts:Child', resolve_status: 'pending' })
    const idx  = buildEdgeIndices([edge])
    expect(idx.extendsMap.size).toBe(0)
  })

  it('#3 정상: imports external → externalsByFile에 파일별 등록', () => {
    const edge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: '@nestjs/common',
      resolve_status: 'external',
    })
    const idx = buildEdgeIndices([edge])
    // externalsByFile: Map<sourceFileId, Set<string>> 로 파일별 관리
    const set = idx.externalsByFile.get('p:a.ts')
    expect(set?.has('@nestjs/common')).toBe(true)
  })

  it('#4 정상: imports resolved → importResolvedMap', () => {
    const edge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: './b',
      target_symbol: 'B',
      target_id: 'p:b.ts:B',
      resolve_status: 'resolved',
    })
    const idx = buildEdgeIndices([edge])
    expect(idx.importResolvedMap.get('p:a.ts|./b|B')).toBe('p:b.ts:B')
  })

  it('#5 경계: imports 중복 key (첫 edge 우선)', () => {
    const e1 = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: './b',
      target_symbol: 'B',
      target_id: 'FIRST',
      resolve_status: 'resolved',
    })
    const e2 = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: './b',
      target_symbol: 'B',
      target_id: 'SECOND',
      resolve_status: 'resolved',
    })
    const idx = buildEdgeIndices([e1, e2])
    expect(idx.importResolvedMap.get('p:a.ts|./b|B')).toBe('FIRST')
  })

  it('#6 경계: importsByFileId — resolve_status 무관 전체 포함', () => {
    const fileA1 = makeEdge({ relation: 'imports', source_id: 'p:fileA.ts', target_specifier: './x', resolve_status: 'resolved' })
    const fileA2 = makeEdge({ relation: 'imports', source_id: 'p:fileA.ts', target_specifier: './y', resolve_status: 'failed' })
    const fileA3 = makeEdge({ relation: 'imports', source_id: 'p:fileA.ts', target_specifier: './z', resolve_status: 'pending' })
    const fileB1 = makeEdge({ relation: 'imports', source_id: 'p:fileB.ts', target_specifier: './w', resolve_status: 'resolved' })
    const idx    = buildEdgeIndices([fileA1, fileA2, fileA3, fileB1])

    expect(idx.importsByFileId.get('p:fileA.ts')!.length).toBe(3)
    expect(idx.importsByFileId.get('p:fileB.ts')!.length).toBe(1)
    // 소비자가 filtered — 모든 status 포함
    const statuses = idx.importsByFileId.get('p:fileA.ts')!.map(e => e.resolve_status)
    expect(statuses).toContain('resolved')
    expect(statuses).toContain('failed')
    expect(statuses).toContain('pending')
  })

})

// ────────────────────────────────────────────────────────────────
// 1.3 resolveSuperCall
// ────────────────────────────────────────────────────────────────

describe('resolveSuperCall', () => {
  it('#1 정상: super.validate → Base.validate', () => {
    const childMethod = makeNode({ id: 'p:a.ts:Child.m', type: 'method', name: 'Child.m', file_path: 'a.ts' })
    const baseValidate = makeNode({ id: 'p:b.ts:Base.validate', type: 'method', name: 'Base.validate', file_path: 'b.ts' })
    const baseClass    = makeNode({ id: 'p:b.ts:Base', type: 'class', name: 'Base', file_path: 'b.ts' })
    const childClass   = makeNode({ id: 'p:a.ts:Child', type: 'class', name: 'Child', file_path: 'a.ts' })

    const extendsEdge  = makeEdge({ relation: 'extends', source_id: 'p:a.ts:Child', target_id: 'p:b.ts:Base', resolve_status: 'resolved' })
    const indices = makeIndices([childClass, childMethod, baseClass, baseValidate], [extendsEdge])

    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:Child.m', target_specifier: 'super.validate' })
    const result = resolveSuperCall(edge, indices)
    expect(result).toEqual({ target_id: 'p:b.ts:Base.validate', resolve_status: 'resolved' })
  })

  it('#2 실패: "super." 만 있는 이상치', () => {
    const idx = makeIndices([], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'x', target_specifier: 'super.' })
    expect(resolveSuperCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#3 실패: ownerClassId miss', () => {
    const idx = makeIndices([], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:Unknown.m', target_specifier: 'super.validate' })
    expect(resolveSuperCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#4 실패: parentClassId miss (extends 미등록)', () => {
    const m = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const idx = makeIndices([m], [])  // extends edge 없음
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: 'super.validate' })
    expect(resolveSuperCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#5 실패: methodMap miss (parent class methods 없음)', () => {
    const childM    = makeNode({ id: 'p:a.ts:Child.m', type: 'method', name: 'Child.m', file_path: 'a.ts' })
    const extendsEdge = makeEdge({ relation: 'extends', source_id: 'p:a.ts:Child', target_id: 'p:b.ts:Base', resolve_status: 'resolved' })
    // Base 클래스 노드 없음 → methodsByClassId miss
    const idx = makeIndices([childM], [extendsEdge])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:Child.m', target_specifier: 'super.validate' })
    expect(resolveSuperCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#6 실패: target method miss', () => {
    const childM   = makeNode({ id: 'p:a.ts:Child.m', type: 'method', name: 'Child.m', file_path: 'a.ts' })
    const baseOther = makeNode({ id: 'p:b.ts:Base.other', type: 'method', name: 'Base.other', file_path: 'b.ts' })
    const baseClass = makeNode({ id: 'p:b.ts:Base', type: 'class', name: 'Base', file_path: 'b.ts' })
    const extendsEdge = makeEdge({ relation: 'extends', source_id: 'p:a.ts:Child', target_id: 'p:b.ts:Base', resolve_status: 'resolved' })
    const idx = makeIndices([childM, baseOther, baseClass], [extendsEdge])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:Child.m', target_specifier: 'super.validate' })
    expect(resolveSuperCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })
})

describe('resolveCalls imported API method reachability gaps', () => {
  it('resolves imported class instance method calls by target specifier and method name', async () => {
    const page = makeNode({ id: 'p:src/page.tsx:Page', type: 'function', name: 'Page', file_path: 'src/page.tsx' })
    const repoClass = makeNode({ id: 'p:src/user.repository.ts:UserRepository', type: 'class', name: 'UserRepository', file_path: 'src/user.repository.ts' })
    const fetchMe = makeNode({ id: 'p:src/user.repository.ts:UserRepository.fetchMe', type: 'method', name: 'UserRepository.fetchMe', file_path: 'src/user.repository.ts' })
    const edges = [
      makeEdge({
        relation: 'imports',
        source_id: 'p:src/page.tsx',
        target_id: repoClass.id,
        target_specifier: './user.repository',
        target_symbol: 'UserRepository',
        resolve_status: 'resolved',
      }),
      makeEdge({
        relation: 'calls',
        source_id: page.id,
        target_specifier: './user.repository',
        target_symbol: 'fetchMe',
        chain_path: 'repo',
      }),
    ]

    const result = await resolveCalls(edges, [page, repoClass, fetchMe], new Map(), new Map())
    const call = result.find((edge) => edge.relation === 'calls')

    expect(call).toMatchObject({
      target_id: fetchMe.id,
      resolve_status: 'resolved',
    })
  })

  it('resolves Dart file-level imports to a unique class method for repository calls', async () => {
    const page = makeNode({ id: 'p:lib/page.dart:UserPage.build', type: 'method', name: 'build', file_path: 'lib/page.dart' })
    const repoFile = makeNode({ id: 'p:lib/user_repository.dart', type: 'file', name: 'user_repository.dart', file_path: 'lib/user_repository.dart' })
    const repoClass = makeNode({ id: 'p:lib/user_repository.dart:UserRepository', type: 'class', name: 'UserRepository', file_path: 'lib/user_repository.dart' })
    const fetchMe = makeNode({ id: 'p:lib/user_repository.dart:UserRepository.fetchMe', type: 'method', name: 'fetchMe', file_path: 'lib/user_repository.dart' })
    const edges = [
      makeEdge({
        relation: 'imports',
        source_id: 'p:lib/page.dart',
        target_id: repoFile.id,
        target_specifier: 'package:app/user_repository.dart',
        target_symbol: null,
        resolve_status: 'resolved',
      }),
      makeEdge({
        relation: 'calls',
        source_id: page.id,
        target_specifier: null,
        target_symbol: 'fetchMe',
        chain_path: 'repo',
      }),
    ]

    const result = await resolveCalls(edges, [page, repoFile, repoClass, fetchMe], new Map(), new Map())
    const call = result.find((edge) => edge.relation === 'calls')

    expect(call).toMatchObject({
      target_id: fetchMe.id,
      resolve_status: 'resolved',
    })
  })

  it('does not guess imported method calls when multiple imported classes expose the same method', async () => {
    const page = makeNode({ id: 'p:lib/page.dart:UserPage.build', type: 'method', name: 'build', file_path: 'lib/page.dart' })
    const userFile = makeNode({ id: 'p:lib/user_repository.dart', type: 'file', name: 'user_repository.dart', file_path: 'lib/user_repository.dart' })
    const orderFile = makeNode({ id: 'p:lib/order_repository.dart', type: 'file', name: 'order_repository.dart', file_path: 'lib/order_repository.dart' })
    const userClass = makeNode({ id: 'p:lib/user_repository.dart:UserRepository', type: 'class', name: 'UserRepository', file_path: 'lib/user_repository.dart' })
    const orderClass = makeNode({ id: 'p:lib/order_repository.dart:OrderRepository', type: 'class', name: 'OrderRepository', file_path: 'lib/order_repository.dart' })
    const userFetch = makeNode({ id: 'p:lib/user_repository.dart:UserRepository.fetchMe', type: 'method', name: 'fetchMe', file_path: 'lib/user_repository.dart' })
    const orderFetch = makeNode({ id: 'p:lib/order_repository.dart:OrderRepository.fetchMe', type: 'method', name: 'fetchMe', file_path: 'lib/order_repository.dart' })
    const edges = [
      makeEdge({
        relation: 'imports',
        source_id: 'p:lib/page.dart',
        target_id: userFile.id,
        target_specifier: 'package:app/user_repository.dart',
        target_symbol: null,
        resolve_status: 'resolved',
      }),
      makeEdge({
        relation: 'imports',
        source_id: 'p:lib/page.dart',
        target_id: orderFile.id,
        target_specifier: 'package:app/order_repository.dart',
        target_symbol: null,
        resolve_status: 'resolved',
      }),
      makeEdge({
        relation: 'calls',
        source_id: page.id,
        target_specifier: null,
        target_symbol: 'fetchMe',
        chain_path: 'repo',
      }),
    ]

    const result = await resolveCalls(
      edges,
      [page, userFile, orderFile, userClass, orderClass, userFetch, orderFetch],
      new Map(),
      new Map(),
    )
    const call = result.find((edge) => edge.relation === 'calls')

    expect(call?.resolve_status).toBe('failed')
    expect(call?.target_id).toBeNull()
  })

  it('resolves repository registry property calls through imported context hooks', async () => {
    const page = makeNode({ id: 'p:src/pages/adReports.tsx:AdReportsPage', type: 'function', name: 'AdReportsPage', file_path: 'src/pages/adReports.tsx' })
    const useRepository = makeNode({ id: 'p:src/contexts/RepositoryContext.tsx:useRepository', type: 'function', name: 'useRepository', file_path: 'src/contexts/RepositoryContext.tsx' })
    const repositoriesVar = makeNode({ id: 'p:src/repositories/index.ts:Repositories', type: 'variable', name: 'Repositories', file_path: 'src/repositories/index.ts', exported: true })
    const repoClass = makeNode({ id: 'p:src/repositories/AdUnitRepository.ts:AdUnitRepository', type: 'class', name: 'AdUnitRepository', file_path: 'src/repositories/AdUnitRepository.ts' })
    const getAdUnits = makeNode({ id: 'p:src/repositories/AdUnitRepository.ts:AdUnitRepository.getAdUnits', type: 'method', name: 'AdUnitRepository.getAdUnits', file_path: 'src/repositories/AdUnitRepository.ts' })
    const edges = [
      makeEdge({
        relation: 'imports',
        source_id: 'p:src/pages/adReports.tsx',
        target_id: useRepository.id,
        target_specifier: '@contexts/RepositoryContext',
        target_symbol: 'useRepository',
        resolve_status: 'resolved',
      }),
      makeEdge({
        relation: 'imports',
        source_id: 'p:src/contexts/RepositoryContext.tsx',
        target_id: repositoriesVar.id,
        target_specifier: '../repositories',
        target_symbol: 'default',
        resolve_status: 'resolved',
      }),
      makeEdge({
        relation: 'imports',
        source_id: 'p:src/repositories/index.ts',
        target_id: repoClass.id,
        target_specifier: './AdUnitRepository',
        target_symbol: 'AdUnitRepository',
        resolve_status: 'resolved',
      }),
      makeEdge({
        relation: 'calls',
        source_id: repositoriesVar.id,
        target_id: null,
        target_specifier: './AdUnitRepository',
        target_symbol: 'AdUnitRepository',
        chain_path: 'adUnit',
        resolve_status: 'pending',
      }),
      makeEdge({
        relation: 'calls',
        source_id: page.id,
        target_specifier: '@contexts/RepositoryContext',
        target_symbol: 'getAdUnits',
        chain_path: 'repository.adUnit',
      }),
    ]

    const result = await resolveCalls(edges, [page, useRepository, repositoriesVar, repoClass, getAdUnits], new Map(), new Map())
    const call = result.find((edge) => edge.source_id === page.id && edge.target_symbol === 'getAdUnits')

    expect(call).toMatchObject({
      target_id: getAdUnits.id,
      resolve_status: 'resolved',
    })
  })
})

// ────────────────────────────────────────────────────────────────
// 1.4 resolveDICall
// ────────────────────────────────────────────────────────────────

describe('resolveDICall', () => {
  it('#1 정상: this.repo.find()', () => {
    const serviceClass = makeNode({ id: 'p:svc.ts:OrdersService', type: 'class', name: 'OrdersService', file_path: 'svc.ts' })
    const serviceMethod = makeNode({ id: 'p:svc.ts:OrdersService.create', type: 'method', name: 'OrdersService.create', file_path: 'svc.ts' })
    const repoClass = makeNode({ id: 'p:r.ts:Repo', type: 'class', name: 'Repo', file_path: 'r.ts' })
    const repoFind  = makeNode({ id: 'p:r.ts:Repo.find', type: 'method', name: 'Repo.find', file_path: 'r.ts' })
    const diMap: ConstructorDIMap = new Map([
      ['p:svc.ts:OrdersService', [{ fieldName: 'repo', typeName: 'Repo' }]],
    ])
    const idx = makeIndices([serviceClass, serviceMethod, repoClass, repoFind], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:svc.ts:OrdersService.create', target_specifier: 'this.repo.find' })
    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: 'p:r.ts:Repo.find', resolve_status: 'resolved' })
  })

  it('#2 깊은 chain (this.svc.ns.m) — Svc.ns property 노드 없음 → external_chain (P12 의미)', () => {
    // P12 이전: middle 무시하고 svc.m fallback resolve. 이후: graph 안 type 추적 못하면 external_chain.
    const ownerM   = makeNode({ id: 'p:o.ts:Owner.method', type: 'method', name: 'Owner.method', file_path: 'o.ts' })
    const ownerCls = makeNode({ id: 'p:o.ts:Owner', type: 'class', name: 'Owner', file_path: 'o.ts' })
    const svcCls   = makeNode({ id: 'p:s.ts:Svc', type: 'class', name: 'Svc', file_path: 's.ts' })
    const svcM     = makeNode({ id: 'p:s.ts:Svc.m', type: 'method', name: 'Svc.m', file_path: 's.ts' })
    const diMap: ConstructorDIMap = new Map([
      ['p:o.ts:Owner', [{ fieldName: 'svc', typeName: 'Svc' }]],
    ])
    const idx  = makeIndices([ownerM, ownerCls, svcCls, svcM], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:o.ts:Owner.method', target_specifier: 'this.svc.ns.m' })
    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: null, resolve_status: 'external_chain' })
  })

  it('#3 실패: ownerClassId miss', () => {
    const idx = makeIndices([], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:Unknown.m', target_specifier: 'this.repo.find' })
    expect(resolveDICall(edge, idx, new Map())).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#4 실패: DIMap에 class 없음', () => {
    const m   = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const idx = makeIndices([m], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: 'this.repo.find' })
    expect(resolveDICall(edge, idx, new Map())).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#5 실패: fieldName 불일치', () => {
    const m   = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const cls = makeNode({ id: 'p:a.ts:C', type: 'class', name: 'C', file_path: 'a.ts' })
    const diMap: ConstructorDIMap = new Map([['p:a.ts:C', [{ fieldName: 'logger', typeName: 'Logger' }]]])
    const idx = makeIndices([m, cls], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: 'this.repo.find' })
    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#6 external_chain: typeName이 interface (nodesByClass miss) — interface는 class index 외, 외부 type 처리', () => {
    const m     = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const cls   = makeNode({ id: 'p:a.ts:C', type: 'class', name: 'C', file_path: 'a.ts' })
    const iface = makeNode({ id: 'p:a.ts:IRepo', type: 'interface' as any, name: 'IRepo', file_path: 'a.ts' })
    const diMap: ConstructorDIMap = new Map([['p:a.ts:C', [{ fieldName: 'repo', typeName: 'IRepo' }]]])
    const idx = makeIndices([m, cls, iface], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: 'this.repo.find' })
    // P11: typeName이 nodesByClass에 없음 → external_chain (외부 type, receiver만 알려짐)
    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: null, resolve_status: 'external_chain' })
  })

  it('#7 external_chain: nodesByClass에 typeName 없음 (외부 lib type)', () => {
    const m   = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const diMap: ConstructorDIMap = new Map([['p:a.ts:C', [{ fieldName: 'repo', typeName: 'Unknown' }]]])
    const idx = makeIndices([m], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: 'this.repo.find' })
    // P11: typeName 미등록 = 외부 type → external_chain
    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: null, resolve_status: 'external_chain' })
  })

  it('#8 실패: methodsByClassId(classId) miss', () => {
    const m     = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const cls   = makeNode({ id: 'p:a.ts:C', type: 'class', name: 'C', file_path: 'a.ts' })
    const repo  = makeNode({ id: 'p:r.ts:Repo', type: 'class', name: 'Repo', file_path: 'r.ts' })
    // Repo 클래스는 있으나 method 없음 → methodsByClassId miss
    const diMap: ConstructorDIMap = new Map([['p:a.ts:C', [{ fieldName: 'repo', typeName: 'Repo' }]]])
    const idx = makeIndices([m, cls, repo], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: 'this.repo.find' })
    // P13: graph 안 type 확인됨(Repo) + method 정의 누락 = 진짜 갭 → explicit_gap=true 표시
    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: null, resolve_status: 'failed', explicit_gap: true })
  })

  it('#9 정상: 동명 class 복수 + tiebreaker (H4) — a.ts 우선', () => {
    const m   = makeNode({ id: 'p:svc.ts:Svc.m', type: 'method', name: 'Svc.m', file_path: 'svc.ts' })
    const cls = makeNode({ id: 'p:svc.ts:Svc', type: 'class', name: 'Svc', file_path: 'svc.ts' })
    const repoA = makeNode({ id: 'p:a.ts:Repo', type: 'class', name: 'Repo', file_path: 'a.ts' })
    const repoZ = makeNode({ id: 'p:z.ts:Repo', type: 'class', name: 'Repo', file_path: 'z.ts' })
    const repoAFind = makeNode({ id: 'p:a.ts:Repo.find', type: 'method', name: 'Repo.find', file_path: 'a.ts' })
    const repoZFind = makeNode({ id: 'p:z.ts:Repo.find', type: 'method', name: 'Repo.find', file_path: 'z.ts' })
    const diMap: ConstructorDIMap = new Map([['p:svc.ts:Svc', [{ fieldName: 'r', typeName: 'Repo' }]]])
    // z.ts를 먼저 넣어도 tiebreaker로 a.ts 우선
    const idx = makeIndices([m, cls, repoZ, repoA, repoAFind, repoZFind], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:svc.ts:Svc.m', target_specifier: 'this.r.find' })
    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: 'p:a.ts:Repo.find', resolve_status: 'resolved' })
  })

  it('#9b 정상: 동명 class 복수 + import target이 file node면 해당 file의 class를 우선한다', () => {
    const svcM = makeNode({ id: 'p:svc.ts:Svc.m', type: 'method', name: 'Svc.m', file_path: 'svc.ts' })
    const svcCls = makeNode({ id: 'p:svc.ts:Svc', type: 'class', name: 'Svc', file_path: 'svc.ts' })
    const repoA = makeNode({ id: 'p:a.ts:Repo', type: 'class', name: 'Repo', file_path: 'a.ts' })
    const repoB = makeNode({ id: 'p:b.ts:Repo', type: 'class', name: 'Repo', file_path: 'b.ts' })
    const repoAFind = makeNode({ id: 'p:a.ts:Repo.find', type: 'method', name: 'Repo.find', file_path: 'a.ts' })
    const repoBFind = makeNode({ id: 'p:b.ts:Repo.find', type: 'method', name: 'Repo.find', file_path: 'b.ts' })
    const repoFile = makeNode({ id: 'p:b.ts', type: 'file', name: 'b.ts', file_path: 'b.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:svc.ts',
      target_symbol: 'Repo',
      target_id: repoFile.id,
      resolve_status: 'resolved',
    })
    const diMap: ConstructorDIMap = new Map([['p:svc.ts:Svc', [{ fieldName: 'r', typeName: 'Repo' }]]])
    const idx = makeIndices([svcM, svcCls, repoA, repoB, repoAFind, repoBFind, repoFile], [importEdge])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:svc.ts:Svc.m', target_specifier: 'this.r.find' })

    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: repoBFind.id, resolve_status: 'resolved' })
  })

  it('#9c 정상: 동명 class 복수 + import target이 class node면 해당 class를 직접 우선한다', () => {
    const svcM = makeNode({ id: 'p:svc.ts:Svc.m', type: 'method', name: 'Svc.m', file_path: 'svc.ts' })
    const svcCls = makeNode({ id: 'p:svc.ts:Svc', type: 'class', name: 'Svc', file_path: 'svc.ts' })
    const repoA = makeNode({ id: 'p:a.ts:Repo', type: 'class', name: 'Repo', file_path: 'a.ts' })
    const repoB = makeNode({ id: 'p:b.ts:Repo', type: 'class', name: 'Repo', file_path: 'b.ts' })
    const repoAFind = makeNode({ id: 'p:a.ts:Repo.find', type: 'method', name: 'Repo.find', file_path: 'a.ts' })
    const repoBFind = makeNode({ id: 'p:b.ts:Repo.find', type: 'method', name: 'Repo.find', file_path: 'b.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:svc.ts',
      target_symbol: 'Repo',
      target_id: repoB.id,
      resolve_status: 'resolved',
    })
    const diMap: ConstructorDIMap = new Map([['p:svc.ts:Svc', [{ fieldName: 'r', typeName: 'Repo' }]]])
    const idx = makeIndices([svcM, svcCls, repoA, repoB, repoAFind, repoBFind], [importEdge])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:svc.ts:Svc.m', target_specifier: 'this.r.find' })

    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: repoBFind.id, resolve_status: 'resolved' })
  })

  it('#9d 정상: import target node가 없어도 target_id의 file path로 동명 class 후보를 고른다', () => {
    const svcM = makeNode({ id: 'p:svc.ts:Svc.m', type: 'method', name: 'Svc.m', file_path: 'svc.ts' })
    const svcCls = makeNode({ id: 'p:svc.ts:Svc', type: 'class', name: 'Svc', file_path: 'svc.ts' })
    const repoA = makeNode({ id: 'p:a.ts:Repo', type: 'class', name: 'Repo', file_path: 'a.ts' })
    const repoB = makeNode({ id: 'p:b.ts:Repo', type: 'class', name: 'Repo', file_path: 'b.ts' })
    const repoAFind = makeNode({ id: 'p:a.ts:Repo.find', type: 'method', name: 'Repo.find', file_path: 'a.ts' })
    const repoBFind = makeNode({ id: 'p:b.ts:Repo.find', type: 'method', name: 'Repo.find', file_path: 'b.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:svc.ts',
      target_symbol: 'Repo',
      target_id: 'p:b.ts',
      resolve_status: 'resolved',
    })
    const diMap: ConstructorDIMap = new Map([['p:svc.ts:Svc', [{ fieldName: 'r', typeName: 'Repo' }]]])
    const idx = makeIndices([svcM, svcCls, repoA, repoB, repoAFind, repoBFind], [importEdge])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:svc.ts:Svc.m', target_specifier: 'this.r.find' })

    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: repoBFind.id, resolve_status: 'resolved' })
  })

  it('#9e 정상: import target_id가 symbol까지 포함된 문자열이면 file path를 추출해 class 후보를 고른다', () => {
    const svcM = makeNode({ id: 'p:svc.ts:Svc.m', type: 'method', name: 'Svc.m', file_path: 'svc.ts' })
    const svcCls = makeNode({ id: 'p:svc.ts:Svc', type: 'class', name: 'Svc', file_path: 'svc.ts' })
    const repoA = makeNode({ id: 'p:a.ts:Repo', type: 'class', name: 'Repo', file_path: 'a.ts' })
    const repoB = makeNode({ id: 'p:b.ts:Repo', type: 'class', name: 'Repo', file_path: 'b.ts' })
    const repoBFind = makeNode({ id: 'p:b.ts:Repo.find', type: 'method', name: 'Repo.find', file_path: 'b.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:svc.ts',
      target_symbol: 'Repo',
      target_id: 'p:b.ts:DefaultExport',
      resolve_status: 'resolved',
    })
    const diMap: ConstructorDIMap = new Map([['p:svc.ts:Svc', [{ fieldName: 'r', typeName: 'Repo' }]]])
    const idx = makeIndices([svcM, svcCls, repoA, repoB, repoBFind], [importEdge])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:svc.ts:Svc.m', target_specifier: 'this.r.find' })

    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: repoBFind.id, resolve_status: 'resolved' })
  })

  it('#9f 정상: 동명 class 중 요청 member가 property로 존재하는 후보를 method-aware fallback으로 고른다', () => {
    const svcM = makeNode({ id: 'p:svc.ts:Svc.m', type: 'method', name: 'Svc.m', file_path: 'svc.ts' })
    const svcCls = makeNode({ id: 'p:svc.ts:Svc', type: 'class', name: 'Svc', file_path: 'svc.ts' })
    const repoA = makeNode({ id: 'p:a.ts:Repo', type: 'class', name: 'Repo', file_path: 'a.ts' })
    const repoB = makeNode({ id: 'p:b.ts:Repo', type: 'class', name: 'Repo', file_path: 'b.ts' })
    const repoBRun = makeNode({ id: 'p:b.ts:Repo.run', type: 'property', name: 'Repo.run', file_path: 'b.ts' })
    const diMap: ConstructorDIMap = new Map([['p:svc.ts:Svc', [{ fieldName: 'r', typeName: 'Repo' }]]])
    const idx = makeIndices([svcM, svcCls, repoA, repoB, repoBRun], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:svc.ts:Svc.m', target_specifier: 'this.r.run' })

    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: repoBRun.id, resolve_status: 'resolved' })
  })

  it('#9g 실패: import와 member 단서가 없으면 owner file의 동명 class 후보를 우선해 explicit gap을 남긴다', () => {
    const svcM = makeNode({ id: 'p:svc.ts:Svc.m', type: 'method', name: 'Svc.m', file_path: 'svc.ts' })
    const svcCls = makeNode({ id: 'p:svc.ts:Svc', type: 'class', name: 'Svc', file_path: 'svc.ts' })
    const repoSameFile = makeNode({ id: 'p:svc.ts:Repo', type: 'class', name: 'Repo', file_path: 'svc.ts' })
    const repoOther = makeNode({ id: 'p:b.ts:Repo', type: 'class', name: 'Repo', file_path: 'b.ts' })
    const diMap: ConstructorDIMap = new Map([['p:svc.ts:Svc', [{ fieldName: 'r', typeName: 'Repo' }]]])
    const idx = makeIndices([svcM, svcCls, repoOther, repoSameFile], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:svc.ts:Svc.m', target_specifier: 'this.r.missing' })

    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: null, resolve_status: 'failed', explicit_gap: true })
  })

  it('#9h 정상: import 후보 중 symbol 불일치와 target_id 누락은 건너뛰고 method-aware fallback을 사용한다', () => {
    const svcM = makeNode({ id: 'p:svc.ts:Svc.m', type: 'method', name: 'Svc.m', file_path: 'svc.ts' })
    const svcCls = makeNode({ id: 'p:svc.ts:Svc', type: 'class', name: 'Svc', file_path: 'svc.ts' })
    const repo = makeNode({ id: 'p:r.ts:Repo', type: 'class', name: 'Repo', file_path: 'r.ts' })
    const otherRepo = makeNode({ id: 'p:z.ts:Repo', type: 'class', name: 'Repo', file_path: 'z.ts' })
    const find = makeNode({ id: 'p:r.ts:Repo.find', type: 'method', name: 'Repo.find', file_path: 'r.ts' })
    const wrongSymbolImport = makeEdge({
      relation: 'imports',
      source_id: 'p:svc.ts',
      target_symbol: 'OtherRepo',
      target_id: 'p:other.ts:OtherRepo',
      resolve_status: 'resolved',
    })
    const missingTargetImport = makeEdge({
      relation: 'imports',
      source_id: 'p:svc.ts',
      target_symbol: 'Repo',
      target_id: null,
      resolve_status: 'resolved',
    })
    const diMap: ConstructorDIMap = new Map([['p:svc.ts:Svc', [{ fieldName: 'r', typeName: 'Repo' }]]])
    const idx = makeIndices([svcM, svcCls, repo, otherRepo, find], [wrongSymbolImport, missingTargetImport])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:svc.ts:Svc.m', target_specifier: 'this.r.find' })

    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: find.id, resolve_status: 'resolved' })
  })

  it('#10 정상: 복수 DI 필드 — 두 번째 필드(logger) 호출', () => {
    const m         = makeNode({ id: 'p:svc.ts:Svc.m', type: 'method', name: 'Svc.m', file_path: 'svc.ts' })
    const cls       = makeNode({ id: 'p:svc.ts:Svc', type: 'class', name: 'Svc', file_path: 'svc.ts' })
    const loggerCls = makeNode({ id: 'p:log.ts:Logger', type: 'class', name: 'Logger', file_path: 'log.ts' })
    const loggerInfo = makeNode({ id: 'p:log.ts:Logger.info', type: 'method', name: 'Logger.info', file_path: 'log.ts' })
    const diMap: ConstructorDIMap = new Map([
      ['p:svc.ts:Svc', [
        { fieldName: 'repo', typeName: 'Repo' },
        { fieldName: 'logger', typeName: 'Logger' },
      ]],
    ])
    const idx  = makeIndices([m, cls, loggerCls, loggerInfo], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:svc.ts:Svc.m', target_specifier: 'this.logger.info' })
    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: 'p:log.ts:Logger.info', resolve_status: 'resolved' })
  })

  it('#10b 정상: owner class 노드가 없어도 method id 규약과 DI map으로 첫 class 후보를 사용한다', () => {
    const ownerM = makeNode({ id: 'p:o.ts:Owner.m', type: 'method', name: 'Owner.m', file_path: 'o.ts' })
    const repo = makeNode({ id: 'p:r.ts:Repo', type: 'class', name: 'Repo', file_path: 'r.ts' })
    const find = makeNode({ id: 'p:r.ts:Repo.find', type: 'method', name: 'Repo.find', file_path: 'r.ts' })
    const diMap: ConstructorDIMap = new Map([['p:o.ts:Owner', [{ fieldName: 'repo', typeName: 'Repo' }]]])
    const idx = makeIndices([ownerM, repo, find], [])
    const edge = makeEdge({ relation: 'calls', source_id: ownerM.id, target_specifier: 'this.repo.find' })

    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: find.id, resolve_status: 'resolved' })
  })

  it('#10c 실패: 동명 class 후보를 import/same-file/method로 좁히지 못하면 첫 후보를 기준으로 explicit gap을 남긴다', () => {
    const ownerM = makeNode({ id: 'p:o.ts:Owner.m', type: 'method', name: 'Owner.m', file_path: 'o.ts' })
    const ownerCls = makeNode({ id: 'p:o.ts:Owner', type: 'class', name: 'Owner', file_path: 'o.ts' })
    const repoA = makeNode({ id: 'p:a.ts:Repo', type: 'class', name: 'Repo', file_path: 'a.ts' })
    const repoB = makeNode({ id: 'p:b.ts:Repo', type: 'class', name: 'Repo', file_path: 'b.ts' })
    const diMap: ConstructorDIMap = new Map([['p:o.ts:Owner', [{ fieldName: 'repo', typeName: 'Repo' }]]])
    const idx = makeIndices([ownerM, ownerCls, repoA, repoB], [])
    const edge = makeEdge({ relation: 'calls', source_id: ownerM.id, target_specifier: 'this.repo.missing' })

    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: null, resolve_status: 'failed', explicit_gap: true })
  })

  it('#11 정상: deep chain의 마지막 segment가 property면 property node로 resolved 된다', () => {
    const ownerM = makeNode({ id: 'p:o.ts:Owner.m', type: 'method', name: 'Owner.m', file_path: 'o.ts' })
    const ownerCls = makeNode({ id: 'p:o.ts:Owner', type: 'class', name: 'Owner', file_path: 'o.ts' })
    const cacheCls = makeNode({ id: 'p:c.ts:CacheWrapper', type: 'class', name: 'CacheWrapper', file_path: 'c.ts' })
    const innerProp = makeNode({
      id: 'p:c.ts:CacheWrapper.inner',
      type: 'property',
      name: 'CacheWrapper.inner',
      file_path: 'c.ts',
      signature: ': InnerCache',
    })
    const innerCls = makeNode({ id: 'p:i.ts:InnerCache', type: 'class', name: 'InnerCache', file_path: 'i.ts' })
    const countProp = makeNode({ id: 'p:i.ts:InnerCache.count', type: 'property', name: 'InnerCache.count', file_path: 'i.ts' })
    const diMap: ConstructorDIMap = new Map([['p:o.ts:Owner', [{ fieldName: 'cache', typeName: 'CacheWrapper' }]]])
    const idx = makeIndices([ownerM, ownerCls, cacheCls, innerProp, innerCls, countProp], [])
    const edge = makeEdge({ relation: 'calls', source_id: ownerM.id, target_specifier: 'this.cache.inner.count' })

    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: countProp.id, resolve_status: 'resolved' })
  })

  it('#11b external_chain: deep chain 중간 property의 type signature가 없으면 추적을 중단한다', () => {
    const ownerM = makeNode({ id: 'p:o.ts:Owner.m', type: 'method', name: 'Owner.m', file_path: 'o.ts' })
    const ownerCls = makeNode({ id: 'p:o.ts:Owner', type: 'class', name: 'Owner', file_path: 'o.ts' })
    const cacheCls = makeNode({ id: 'p:c.ts:CacheWrapper', type: 'class', name: 'CacheWrapper', file_path: 'c.ts' })
    const innerProp = makeNode({
      id: 'p:c.ts:CacheWrapper.inner',
      type: 'property',
      name: 'CacheWrapper.inner',
      file_path: 'c.ts',
      signature: null,
    })
    const diMap: ConstructorDIMap = new Map([['p:o.ts:Owner', [{ fieldName: 'cache', typeName: 'CacheWrapper' }]]])
    const idx = makeIndices([ownerM, ownerCls, cacheCls, innerProp], [])
    const edge = makeEdge({ relation: 'calls', source_id: ownerM.id, target_specifier: 'this.cache.inner.count' })

    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: null, resolve_status: 'external_chain' })
  })

  it('#12 정상: DI type의 parent class property까지 extends chain으로 검색한다', () => {
    const ownerM = makeNode({ id: 'p:o.ts:Owner.m', type: 'method', name: 'Owner.m', file_path: 'o.ts' })
    const ownerCls = makeNode({ id: 'p:o.ts:Owner', type: 'class', name: 'Owner', file_path: 'o.ts' })
    const repo = makeNode({ id: 'p:r.ts:Repo', type: 'class', name: 'Repo', file_path: 'r.ts' })
    const base = makeNode({ id: 'p:b.ts:BaseRepo', type: 'class', name: 'BaseRepo', file_path: 'b.ts' })
    const status = makeNode({ id: 'p:b.ts:BaseRepo.status', type: 'property', name: 'BaseRepo.status', file_path: 'b.ts' })
    const extendsEdge = makeEdge({
      relation: 'extends',
      source_id: repo.id,
      target_id: base.id,
      resolve_status: 'resolved',
    })
    const diMap: ConstructorDIMap = new Map([['p:o.ts:Owner', [{ fieldName: 'repo', typeName: 'Repo' }]]])
    const idx = makeIndices([ownerM, ownerCls, repo, base, status], [extendsEdge])
    const edge = makeEdge({ relation: 'calls', source_id: ownerM.id, target_specifier: 'this.repo.status' })

    expect(resolveDICall(edge, idx, diMap)).toEqual({ target_id: status.id, resolve_status: 'resolved' })
  })
})

// ────────────────────────────────────────────────────────────────
// 1.5 resolveIntraFileCall
// ────────────────────────────────────────────────────────────────

describe('resolveIntraFileCall', () => {
  it('#1 Case A: specifier=null (F2 버그 방어)', () => {
    const idx  = makeIndices([], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: null })
    expect(resolveIntraFileCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#2 Case B 정상: this.m intra-class', () => {
    const mOther = makeNode({ id: 'p:a.ts:C.other', type: 'method', name: 'C.other', file_path: 'a.ts' })
    const mTarget = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const cls    = makeNode({ id: 'p:a.ts:C', type: 'class', name: 'C', file_path: 'a.ts' })
    const idx    = makeIndices([mOther, mTarget, cls], [])
    const edge   = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.other', target_specifier: 'this.m' })
    expect(resolveIntraFileCall(edge, idx)).toEqual({ target_id: 'p:a.ts:C.m', resolve_status: 'resolved' })
  })

  it('#3 Case B 실패: "this." 만 있음 (methodName 빈 문자열)', () => {
    const idx  = makeIndices([], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: 'this.' })
    expect(resolveIntraFileCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#4 Case B 실패: ownerClassId miss (함수 source_id)', () => {
    const idx  = makeIndices([], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:standaloneFunc', target_specifier: 'this.m' })
    expect(resolveIntraFileCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#5 Case B 실패: target method miss', () => {
    const m   = makeNode({ id: 'p:a.ts:C.other', type: 'method', name: 'C.other', file_path: 'a.ts' })
    const cls = makeNode({ id: 'p:a.ts:C', type: 'class', name: 'C', file_path: 'a.ts' })
    const idx = makeIndices([m, cls], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.other', target_specifier: 'this.missing' })
    expect(resolveIntraFileCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#6 정상: Dart createState bare constructor call resolves same-file private State class', () => {
    const source = makeNode({ id: 'p:a.dart:Widget.createState', type: 'method', name: 'createState', file_path: 'a.dart' })
    const target = makeNode({ id: 'p:a.dart:_WidgetState', type: 'class', name: '_WidgetState', file_path: 'a.dart' })
    const idx = makeIndices([source, target], [])
    const edge = makeEdge({
      relation: 'calls',
      source_id: source.id,
      target_specifier: null,
      target_symbol: '_WidgetState',
    })

    expect(resolveIntraFileCall(edge, idx)).toEqual({ target_id: target.id, resolve_status: 'resolved' })
  })

  it('#7 정상: Dart bare helper method call resolves within owner class', () => {
    const source = makeNode({ id: 'p:a.dart:_WidgetState.build', type: 'method', name: 'build', file_path: 'a.dart' })
    const target = makeNode({ id: 'p:a.dart:_WidgetState._buildBody', type: 'method', name: '_buildBody', file_path: 'a.dart' })
    const idx = makeIndices([source, target], [])
    const edge = makeEdge({
      relation: 'calls',
      source_id: source.id,
      target_specifier: null,
      target_symbol: '_buildBody',
    })

    expect(resolveIntraFileCall(edge, idx)).toEqual({ target_id: target.id, resolve_status: 'resolved' })
  })
})

// ────────────────────────────────────────────────────────────────
// 1.6 resolveImportedCall
// ────────────────────────────────────────────────────────────────

describe('resolveImportedCall', () => {
  it('#1 정상: cross-file resolved', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:render', type: 'method', name: 'render', file_path: 'a.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: './utils',
      target_symbol: 'formatDate',
      target_id: 'p:utils.ts:formatDate',
      resolve_status: 'resolved',
    })
    const idx  = makeIndices([sourceNode], [importEdge])
    const edge = makeEdge({
      relation: 'calls',
      source_id: 'p:a.ts:render',
      target_specifier: './utils',
      target_symbol: 'formatDate',
    })
    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: 'p:utils.ts:formatDate', resolve_status: 'resolved' })
  })

  it('#2 정상: external 전파', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:Service.m', type: 'method', name: 'Service.m', file_path: 'a.ts' })
    const importEdge = makeEdge({ relation: 'imports', source_id: 'p:a.ts', target_specifier: '@nestjs/common', resolve_status: 'external' })
    const idx  = makeIndices([sourceNode], [importEdge])
    const edge = makeEdge({
      relation: 'calls',
      source_id: 'p:a.ts:Service.m',
      target_specifier: '@nestjs/common',
      target_symbol: 'Logger',
    })
    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'external' })
  })

  it('#3 경계: external 우선순위 (importResolvedMap에도 있음)', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const extEdge = makeEdge({ relation: 'imports', source_id: 'p:a.ts', target_specifier: './shared', resolve_status: 'external' })
    const resEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:b.ts',
      target_specifier: './shared',
      target_symbol: 'fn',
      target_id: 'p:shared.ts:fn',
      resolve_status: 'resolved',
    })
    const idx  = makeIndices([sourceNode], [extEdge, resEdge])
    const edge = makeEdge({
      relation: 'calls',
      source_id: 'p:a.ts:M.m',
      target_specifier: './shared',
      target_symbol: 'fn',
    })
    // external specifier 있으므로 external 우선
    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'external' })
  })

  it('#4 실패: sourceNode miss', () => {
    const idx  = makeIndices([], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:missing', target_specifier: './x', target_symbol: 'f' })
    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#5 실패: target_symbol 없음', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const idx  = makeIndices([sourceNode], [])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:M.m', target_specifier: './x', target_symbol: null })
    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#6 실패: importResolvedMap miss (다른 파일 import)', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:OTHER.ts',  // 다른 파일
      target_specifier: './x',
      target_symbol: 'fn',
      target_id: 'p:x.ts:fn',
      resolve_status: 'resolved',
    })
    const idx  = makeIndices([sourceNode], [importEdge])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:M.m', target_specifier: './x', target_symbol: 'fn' })
    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#7 실패: importResolvedMap miss (symbol 불일치)', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: './x',
      target_symbol: 'other',  // 'fn'이 아님
      target_id: 'p:x.ts:other',
      resolve_status: 'resolved',
    })
    const idx  = makeIndices([sourceNode], [importEdge])
    const edge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:M.m', target_specifier: './x', target_symbol: 'fn' })
    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#8 정상: repo_id는 node에서 조립 (H3 확인)', () => {
    const sourceNode = makeNode({
      id: 'p2:a.ts:M.m',
      type: 'method',
      name: 'M.m',
      file_path: 'a.ts',
      repo_id: 'p2',
    })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p2:a.ts',  // sourceFileNodeId = repo_id:file_path
      target_specifier: './b',
      target_symbol: 'B',
      target_id: 'p2:b.ts:B',
      resolve_status: 'resolved',
      repo_id: 'p2',
    })
    const idx  = makeIndices([sourceNode], [importEdge])
    const edge = makeEdge({ relation: 'calls', source_id: 'p2:a.ts:M.m', target_specifier: './b', target_symbol: 'B', repo_id: 'p2' })
    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: 'p2:b.ts:B', resolve_status: 'resolved' })
  })

  it('#9 정상: imported default object member call → class method resolved', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const apiClass = makeNode({ id: 'p:api.ts:ApiClient', type: 'class', name: 'ApiClient', file_path: 'api.ts' })
    const getMethod = makeNode({ id: 'p:api.ts:ApiClient.get', type: 'method', name: 'ApiClient.get', file_path: 'api.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: './api',
      target_symbol: 'default',
      target_imported_symbol: 'default',
      target_local_symbol: 'api',
      target_id: apiClass.id,
      resolve_status: 'resolved',
    })
    const idx = makeIndices([sourceNode, apiClass, getMethod], [importEdge])
    const edge = makeEdge({ relation: 'calls', source_id: sourceNode.id, target_specifier: './api', target_symbol: 'api.get' })

    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: getMethod.id, resolve_status: 'resolved' })
  })

  it('#10 정상: namespace member call → exported file member resolved', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const utilFile = makeNode({ id: 'p:utils.ts', type: 'file', name: 'utils.ts', file_path: 'utils.ts', exported: false })
    const formatFn = makeNode({ id: 'p:utils.ts:format', type: 'function', name: 'format', file_path: 'utils.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: './utils',
      target_symbol: 'Utils',
      target_imported_symbol: '*',
      target_local_symbol: 'Utils',
      target_id: utilFile.id,
      resolve_status: 'resolved',
    })
    const idx = makeIndices([sourceNode, utilFile, formatFn], [importEdge])
    const edge = makeEdge({ relation: 'calls', source_id: sourceNode.id, target_specifier: './utils', target_symbol: 'Utils.format' })

    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: formatFn.id, resolve_status: 'resolved' })
  })

  it('#10b 정상: imported generated client object member alias → referenced function resolved', () => {
    const sourceNode = makeNode({ id: 'p:a.tsx:AccountPage', type: 'function', name: 'AccountPage', file_path: 'a.tsx' })
    const clientNode = makeNode({ id: 'p:client.ts:client', type: 'variable', name: 'client', file_path: 'client.ts' })
    const operationNode = makeNode({ id: 'p:client.ts:getCurrentAccount', type: 'function', name: 'getCurrentAccount', file_path: 'client.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.tsx',
      target_specifier: './client',
      target_symbol: 'client',
      target_id: clientNode.id,
      resolve_status: 'resolved',
    })
    const aliasEdge = makeEdge({
      relation: 'contains',
      source_id: clientNode.id,
      target_id: operationNode.id,
      target_symbol: 'getCurrent',
      resolve_status: 'resolved',
    })
    const idx = makeIndices([sourceNode, clientNode, operationNode], [importEdge, aliasEdge])
    const edge = makeEdge({
      relation: 'calls',
      source_id: sourceNode.id,
      target_specifier: './client',
      target_symbol: 'getCurrent',
      chain_path: 'client.accounts',
    })

    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: operationNode.id, resolve_status: 'resolved' })
  })

  it('#11 실패: import-bound class 객체에 요청 member가 없으면 failed로 남긴다', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const apiClass = makeNode({ id: 'p:api.ts:ApiClient', type: 'class', name: 'ApiClient', file_path: 'api.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: './api',
      target_symbol: 'api',
      target_local_symbol: 'api',
      target_id: apiClass.id,
      resolve_status: 'resolved',
    })
    const idx = makeIndices([sourceNode, apiClass], [importEdge])
    const edge = makeEdge({ relation: 'calls', source_id: sourceNode.id, target_specifier: './api', target_symbol: 'api.missing' })

    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#12 실패: import-bound file 객체에 요청 export가 없으면 failed로 남긴다', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const utilFile = makeNode({ id: 'p:utils.ts', type: 'file', name: 'utils.ts', file_path: 'utils.ts', exported: false })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: './utils',
      target_symbol: 'Utils',
      target_imported_symbol: '*',
      target_local_symbol: 'Utils',
      target_id: utilFile.id,
      resolve_status: 'resolved',
    })
    const idx = makeIndices([sourceNode, utilFile], [importEdge])
    const edge = makeEdge({ relation: 'calls', source_id: sourceNode.id, target_specifier: './utils', target_symbol: 'Utils.missing' })

    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#13 실패: object member call에 matching import가 없으면 failed로 남긴다', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const idx = makeIndices([sourceNode], [])
    const edge = makeEdge({ relation: 'calls', source_id: sourceNode.id, target_specifier: './api', target_symbol: 'api.get' })

    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#14 실패: object member import의 target node가 없으면 failed로 남긴다', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: './api',
      target_symbol: 'api',
      target_local_symbol: 'api',
      target_id: 'p:missing.ts:Api',
      resolve_status: 'resolved',
    })
    const idx = makeIndices([sourceNode], [importEdge])
    const edge = makeEdge({ relation: 'calls', source_id: sourceNode.id, target_specifier: './api', target_symbol: 'api.get' })

    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#15 실패: namespace member chain root가 비어 있으면 namespace fallback 없이 failed로 남긴다', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const idx = makeIndices([sourceNode], [])
    const edge = makeEdge({
      relation: 'calls',
      source_id: sourceNode.id,
      target_specifier: './utils',
      target_symbol: 'format',
      chain_path: '.json',
    })

    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'failed' })
  })

  it('#16 external_chain: namespace member import의 target node가 없어도 import-bound chain 정보는 보존한다', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: './utils',
      target_symbol: 'Utils',
      target_id: 'p:missing.ts:Utils',
      resolve_status: 'resolved',
    })
    const idx = makeIndices([sourceNode], [importEdge])
    const edge = makeEdge({
      relation: 'calls',
      source_id: sourceNode.id,
      target_specifier: './utils',
      target_symbol: 'format',
      chain_path: 'Utils',
    })

    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'external_chain' })
  })

  it('#16b external_chain: chain root가 import local alias와 맞으면 receiver 도달 정보로 보존한다', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const namespaceNode = makeNode({ id: 'p:utils.ts:OriginalUtils', type: 'function', name: 'OriginalUtils', file_path: 'utils.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_specifier: './utils',
      target_symbol: 'OriginalUtils',
      target_local_symbol: 'Utils',
      target_id: namespaceNode.id,
      resolve_status: 'resolved',
    })
    const idx = makeIndices([sourceNode, namespaceNode], [importEdge])
    const edge = makeEdge({
      relation: 'calls',
      source_id: sourceNode.id,
      target_specifier: './utils',
      target_symbol: 'missing',
      chain_path: 'Utils',
    })

    expect(resolveImportedCall(edge, idx)).toEqual({ target_id: null, resolve_status: 'external_chain' })
  })

  it('#17 실패: object member resolver는 specifier나 root/member가 비어 있으면 failed로 남긴다', () => {
    const sourceNode = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const idx = makeIndices([sourceNode], [])

    expect(resolveImportedCall(
      makeEdge({ relation: 'calls', source_id: sourceNode.id, target_specifier: null, target_symbol: 'api.get' }),
      idx,
    )).toEqual({ target_id: null, resolve_status: 'failed' })
    expect(resolveImportedCall(
      makeEdge({ relation: 'calls', source_id: sourceNode.id, target_specifier: './api', target_symbol: '.get' }),
      idx,
    )).toEqual({ target_id: null, resolve_status: 'failed' })
    expect(resolveImportedCall(
      makeEdge({ relation: 'calls', source_id: sourceNode.id, target_specifier: './api', target_symbol: 'api.' }),
      idx,
    )).toEqual({ target_id: null, resolve_status: 'failed' })
  })
})


// ────────────────────────────────────────────────────────────────
// 2. 통합 테스트 (resolveCalls)
// ────────────────────────────────────────────────────────────────
// NestJS/Next.js/Flutter 스타일 realistic fixture

describe('resolveCalls (통합)', () => {
  // ── NestJS 공통 fixture ──
  // orders.service.ts + repository.ts 2파일
  // OrdersService (3 methods) + OrdersRepo (3 methods)
  function makeNestJsFixture() {
    const repoId = 'proj'

    // Nodes (≥12)
    const svcFileNode  = makeNode({ id: `${repoId}:orders/orders.service.ts`, type: 'file' as any, name: 'orders.service.ts', file_path: 'orders/orders.service.ts', repo_id: repoId })
    const repoFileNode = makeNode({ id: `${repoId}:orders/repository.ts`, type: 'file' as any, name: 'repository.ts', file_path: 'orders/repository.ts', repo_id: repoId })
    const svcClass  = makeNode({ id: `${repoId}:orders/orders.service.ts:OrdersService`, type: 'class', name: 'OrdersService', file_path: 'orders/orders.service.ts', repo_id: repoId })
    const repoClass = makeNode({ id: `${repoId}:orders/repository.ts:OrdersRepo`, type: 'class', name: 'OrdersRepo', file_path: 'orders/repository.ts', repo_id: repoId })
    const svcCreate = makeNode({ id: `${repoId}:orders/orders.service.ts:OrdersService.create`, type: 'method', name: 'OrdersService.create', file_path: 'orders/orders.service.ts', repo_id: repoId })
    const svcFindAll = makeNode({ id: `${repoId}:orders/orders.service.ts:OrdersService.findAll`, type: 'method', name: 'OrdersService.findAll', file_path: 'orders/orders.service.ts', repo_id: repoId })
    const svcDelete  = makeNode({ id: `${repoId}:orders/orders.service.ts:OrdersService.delete`, type: 'method', name: 'OrdersService.delete', file_path: 'orders/orders.service.ts', repo_id: repoId })
    const repoFind   = makeNode({ id: `${repoId}:orders/repository.ts:OrdersRepo.find`, type: 'method', name: 'OrdersRepo.find', file_path: 'orders/repository.ts', repo_id: repoId })
    const repoSave   = makeNode({ id: `${repoId}:orders/repository.ts:OrdersRepo.save`, type: 'method', name: 'OrdersRepo.save', file_path: 'orders/repository.ts', repo_id: repoId })
    const repoDelete = makeNode({ id: `${repoId}:orders/repository.ts:OrdersRepo.delete`, type: 'method', name: 'OrdersRepo.delete', file_path: 'orders/repository.ts', repo_id: repoId })
    const nestCommon = makeNode({ id: `${repoId}:orders/orders.service.ts:Injectable`, type: 'class', name: 'Injectable', file_path: 'orders/orders.service.ts', repo_id: repoId })
    const loggerNode = makeNode({ id: `${repoId}:orders/orders.service.ts:Logger`, type: 'class', name: 'Logger', file_path: 'orders/orders.service.ts', repo_id: repoId })

    const nodes: CodeNodeRaw[] = [
      svcFileNode, repoFileNode, svcClass, repoClass,
      svcCreate, svcFindAll, svcDelete,
      repoFind, repoSave, repoDelete,
      nestCommon, loggerNode,
    ]

    // Edges (≥20)
    const svcFileId  = `${repoId}:orders/orders.service.ts`
    // imports: OrdersService → OrdersRepo (resolved)
    const importRepo = makeEdge({
      relation: 'imports',
      source_id: svcFileId,
      target_specifier: './repository',
      target_symbol: 'OrdersRepo',
      target_id: `${repoId}:orders/repository.ts:OrdersRepo`,
      resolve_status: 'resolved',
      repo_id: repoId,
    })
    // imports: @nestjs/common (external)
    const importNest = makeEdge({
      relation: 'imports',
      source_id: svcFileId,
      target_specifier: '@nestjs/common',
      resolve_status: 'external',
      repo_id: repoId,
    })
    // contains (pass-through)
    const containsSvc   = makeEdge({ relation: 'contains', source_id: svcFileId, target_id: svcClass.id, resolve_status: 'resolved', repo_id: repoId })
    const containsRepo  = makeEdge({ relation: 'contains', source_id: `${repoId}:orders/repository.ts`, target_id: repoClass.id, resolve_status: 'resolved', repo_id: repoId })
    const containsCreate = makeEdge({ relation: 'contains', source_id: svcClass.id, target_id: svcCreate.id, resolve_status: 'resolved', repo_id: repoId })
    const containsFindAll = makeEdge({ relation: 'contains', source_id: svcClass.id, target_id: svcFindAll.id, resolve_status: 'resolved', repo_id: repoId })
    const containsDelete  = makeEdge({ relation: 'contains', source_id: svcClass.id, target_id: svcDelete.id, resolve_status: 'resolved', repo_id: repoId })
    const containsRepoFind   = makeEdge({ relation: 'contains', source_id: repoClass.id, target_id: repoFind.id, resolve_status: 'resolved', repo_id: repoId })
    const containsRepoSave   = makeEdge({ relation: 'contains', source_id: repoClass.id, target_id: repoSave.id, resolve_status: 'resolved', repo_id: repoId })
    const containsRepoDelete = makeEdge({ relation: 'contains', source_id: repoClass.id, target_id: repoDelete.id, resolve_status: 'resolved', repo_id: repoId })

    // calls edges (pending) — cross-file: OrdersService.findAll calls OrdersRepo class (static-style)
    const callFindAll = makeEdge({
      relation: 'calls',
      source_id: svcFindAll.id,
      target_specifier: './repository',
      target_symbol: 'OrdersRepo',   // importRepo.target_symbol과 일치해야 resolveImportedCall이 lookup 성공
      resolve_status: 'pending',
      repo_id: repoId,
    })
    // calls: this.repo.find (DI)
    const callDIFind = makeEdge({
      relation: 'calls',
      source_id: svcCreate.id,
      target_specifier: 'this.repo.find',
      resolve_status: 'pending',
      repo_id: repoId,
    })
    // calls: this.repo.save (DI)
    const callDISave = makeEdge({
      relation: 'calls',
      source_id: svcCreate.id,
      target_specifier: 'this.repo.save',
      resolve_status: 'pending',
      repo_id: repoId,
    })
    // calls: @nestjs/common.Logger (external)
    const callLogger = makeEdge({
      relation: 'calls',
      source_id: svcDelete.id,
      target_specifier: '@nestjs/common',
      target_symbol: 'Logger',
      resolve_status: 'pending',
      repo_id: repoId,
    })
    // uses_type (pass-through)
    const usesType = makeEdge({ relation: 'uses_type', source_id: svcCreate.id, target_id: repoClass.id, resolve_status: 'resolved', repo_id: repoId })
    // decorates (pass-through)
    const decorates = makeEdge({ relation: 'decorates', source_id: svcClass.id, target_id: nestCommon.id, resolve_status: 'resolved', repo_id: repoId })
    // extra edges to reach ≥20
    const callDIDelete = makeEdge({
      relation: 'calls',
      source_id: svcDelete.id,
      target_specifier: 'this.repo.delete',
      resolve_status: 'pending',
      repo_id: repoId,
    })
    const extraContain1 = makeEdge({ relation: 'contains', source_id: svcClass.id, target_id: loggerNode.id, resolve_status: 'resolved', repo_id: repoId })
    const extraContain2 = makeEdge({ relation: 'contains', source_id: `${repoId}:orders/repository.ts`, target_id: repoFind.id, resolve_status: 'resolved', repo_id: repoId })
    const extraContain3 = makeEdge({ relation: 'contains', source_id: `${repoId}:orders/repository.ts`, target_id: repoSave.id, resolve_status: 'resolved', repo_id: repoId })

    const edges: CodeEdgeRaw[] = [
      importRepo, importNest,
      containsSvc, containsRepo, containsCreate, containsFindAll, containsDelete,
      containsRepoFind, containsRepoSave, containsRepoDelete,
      callFindAll, callDIFind, callDISave, callLogger, callDIDelete,
      usesType, decorates,
      extraContain1, extraContain2, extraContain3,
    ]

    const diMap: ConstructorDIMap = new Map([
      [`${repoId}:orders/orders.service.ts:OrdersService`, [
        { fieldName: 'repo', typeName: 'OrdersRepo' },
      ]],
    ])
    const enumValueMap: EnumValueMap = new Map()

    return { nodes, edges, diMap, enumValueMap, svcFindAll, callDIFind, callDISave, callLogger, callFindAll, repoFind, repoSave, repoDelete, callDIDelete, repoClass }
  }

  it('file-level import fallback: specifier 없는 호출도 show import의 non-file target으로 연결한다', async () => {
    const source = makeNode({ id: 'p:a.ts:run', type: 'function', name: 'run', file_path: 'a.ts' })
    const target = makeNode({ id: 'p:b.ts:format', type: 'function', name: 'format', file_path: 'b.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_symbol: 'format',
      target_id: target.id,
      resolve_status: 'resolved',
    })
    const call = makeEdge({
      relation: 'calls',
      source_id: source.id,
      target_specifier: null,
      target_symbol: 'format',
      resolve_status: 'pending',
    })

    const edges = await resolveCalls([importEdge, call], [source, target], new Map(), new Map())
    const resolved = edges.find((edge) => edge.relation === 'calls')!

    expect(resolved.resolve_status).toBe('resolved')
    expect(resolved.target_id).toBe(target.id)
  })

  it('file-level import fallback: show import가 file target이면 export lookup을 시도하고 없으면 failed로 남긴다', async () => {
    const source = makeNode({ id: 'p:a.ts:run', type: 'function', name: 'run', file_path: 'a.ts' })
    const targetFile = makeNode({ id: 'p:b.ts', type: 'file', name: 'b.ts', file_path: 'b.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_symbol: 'format',
      target_id: targetFile.id,
      resolve_status: 'resolved',
    })
    const call = makeEdge({
      relation: 'calls',
      source_id: source.id,
      target_specifier: null,
      target_symbol: 'format',
      resolve_status: 'pending',
    })

    const edges = await resolveCalls([importEdge, call], [source, targetFile], new Map(), new Map())
    const resolved = edges.find((edge) => edge.relation === 'calls')!

    expect(resolved.resolve_status).toBe('failed')
    expect(resolved.target_id).toBeNull()
  })

  it('builtin global calls: target symbol 또는 chain root가 JS builtin이면 external로 분류한다', async () => {
    const source = makeNode({ id: 'p:a.ts:run', type: 'function', name: 'run', file_path: 'a.ts' })
    const dateCall = makeEdge({
      relation: 'calls',
      source_id: source.id,
      target_specifier: null,
      target_symbol: 'Date',
      resolve_status: 'pending',
    })
    const mathCall = makeEdge({
      relation: 'calls',
      source_id: source.id,
      target_specifier: null,
      target_symbol: 'floor',
      chain_path: 'Math',
      resolve_status: 'pending',
    })

    const edges = await resolveCalls([dateCall, mathCall], [source], new Map(), new Map())

    expect(edges[0].resolve_status).toBe('external')
    expect(edges[1].resolve_status).toBe('external')
  })

  it('file-level import fallback: resolved import에 target_id가 없으면 건너뛰고 failed로 남긴다', async () => {
    const source = makeNode({ id: 'p:a.ts:run', type: 'function', name: 'run', file_path: 'a.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_symbol: 'format',
      target_id: null,
      resolve_status: 'resolved',
    })
    const call = makeEdge({
      relation: 'calls',
      source_id: source.id,
      target_specifier: null,
      target_symbol: 'format',
      resolve_status: 'pending',
    })

    const edges = await resolveCalls([importEdge, call], [source], new Map(), new Map())
    const resolved = edges.find((edge) => edge.relation === 'calls')!

    expect(resolved.resolve_status).toBe('failed')
    expect(resolved.target_id).toBeNull()
  })

  it('file-level import fallback: show import가 file target이면 해당 file export로 연결한다', async () => {
    const source = makeNode({ id: 'p:a.ts:run', type: 'function', name: 'run', file_path: 'a.ts' })
    const targetFile = makeNode({ id: 'p:b.ts', type: 'file', name: 'b.ts', file_path: 'b.ts', exported: false })
    const exportedFormat = makeNode({ id: 'p:b.ts:format', type: 'function', name: 'format', file_path: 'b.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_symbol: 'format',
      target_id: targetFile.id,
      resolve_status: 'resolved',
    })
    const call = makeEdge({
      relation: 'calls',
      source_id: source.id,
      target_specifier: null,
      target_symbol: 'format',
      resolve_status: 'pending',
    })

    const edges = await resolveCalls([importEdge, call], [source, targetFile, exportedFormat], new Map(), new Map())
    const resolved = edges.find((edge) => edge.relation === 'calls')!

    expect(resolved.resolve_status).toBe('resolved')
    expect(resolved.target_id).toBe(exportedFormat.id)
  })

  it('file-level import fallback: star/file import의 target이 file node가 아니면 건너뛰고 failed로 남긴다', async () => {
    const source = makeNode({ id: 'p:a.ts:run', type: 'function', name: 'run', file_path: 'a.ts' })
    const nonFileTarget = makeNode({ id: 'p:b.ts:format', type: 'function', name: 'format', file_path: 'b.ts' })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: 'p:a.ts',
      target_symbol: null,
      target_id: nonFileTarget.id,
      resolve_status: 'resolved',
    })
    const call = makeEdge({
      relation: 'calls',
      source_id: source.id,
      target_specifier: null,
      target_symbol: 'format',
      resolve_status: 'pending',
    })

    const edges = await resolveCalls([importEdge, call], [source, nonFileTarget], new Map(), new Map())
    const resolved = edges.find((edge) => edge.relation === 'calls')!

    expect(resolved.resolve_status).toBe('failed')
    expect(resolved.target_id).toBeNull()
  })

  it('file-level import fallback: source node가 없으면 fallback 없이 failed로 남긴다', async () => {
    const call = makeEdge({
      relation: 'calls',
      source_id: 'p:a.ts:missing',
      target_specifier: null,
      target_symbol: 'format',
      resolve_status: 'pending',
    })

    const [resolved] = await resolveCalls([call], [], new Map(), new Map())

    expect(resolved.resolve_status).toBe('failed')
    expect(resolved.target_id).toBeNull()
  })

  it('Flutter known symbol fallback: 일반 symbol은 external, this/super receiver는 false positive 방지로 제외한다', async () => {
    const owner = makeNode({ id: 'p:a.ts:WidgetState', type: 'class', name: 'WidgetState', file_path: 'a.ts' })
    const method = makeNode({ id: 'p:a.ts:WidgetState.build', type: 'method', name: 'WidgetState.build', file_path: 'a.ts' })
    const standalone = makeNode({ id: 'p:a.ts:render', type: 'function', name: 'render', file_path: 'a.ts' })
    const plain = makeEdge({
      relation: 'calls',
      source_id: standalone.id,
      target_specifier: null,
      target_symbol: 'RepositoryProvider',
      resolve_status: 'pending',
    })
    const thisReceiver = makeEdge({
      relation: 'calls',
      source_id: method.id,
      target_specifier: 'this.RepositoryProvider',
      target_symbol: 'RepositoryProvider',
      resolve_status: 'pending',
    })
    const superReceiver = makeEdge({
      relation: 'calls',
      source_id: method.id,
      target_specifier: 'super.RepositoryProvider',
      target_symbol: 'RepositoryProvider',
      resolve_status: 'pending',
    })

    const edges = await resolveCalls([plain, thisReceiver, superReceiver], [owner, method, standalone], new Map(), new Map())

    expect(edges[0].resolve_status).toBe('external')
    expect(edges[1].resolve_status).toBe('failed')
    expect(edges[2].resolve_status).toBe('failed')
  })

  it('ORM whitelist fallback: super receiver는 false positive 방지를 위해 external로 올리지 않는다', async () => {
    const owner = makeNode({ id: 'p:a.ts:Repo', type: 'class', name: 'Repo', file_path: 'a.ts' })
    const method = makeNode({ id: 'p:a.ts:Repo.run', type: 'method', name: 'Repo.run', file_path: 'a.ts' })
    const call = makeEdge({
      relation: 'calls',
      source_id: method.id,
      target_specifier: 'super.findMany',
      target_symbol: 'findMany',
      resolve_status: 'pending',
    })

    const [resolved] = await resolveCalls([call], [owner, method], new Map(), new Map())

    expect(resolved.resolve_status).toBe('failed')
    expect(resolved.target_id).toBeNull()
  })

  it('T-01: S1 NestJS DI + cross-file — 모든 pending calls resolved', async () => {
    const { nodes, edges, diMap, enumValueMap, callDIFind, callDISave, callDIDelete, callFindAll, repoFind, repoSave, repoDelete, repoClass } = makeNestJsFixture()

    const result = await resolveCalls(edges, nodes, diMap, enumValueMap)
    expect(result.length).toBe(edges.length)

    // DI: this.repo.find
    expect(result[edges.indexOf(callDIFind)].resolve_status).toBe('resolved')
    expect(result[edges.indexOf(callDIFind)].target_id).toBe(repoFind.id)
    // DI: this.repo.save
    expect(result[edges.indexOf(callDISave)].resolve_status).toBe('resolved')
    expect(result[edges.indexOf(callDISave)].target_id).toBe(repoSave.id)
    // DI: this.repo.delete
    expect(result[edges.indexOf(callDIDelete)].resolve_status).toBe('resolved')
    expect(result[edges.indexOf(callDIDelete)].target_id).toBe(repoDelete.id)
    // cross-file: import { OrdersRepo } from './repository' → class 노드
    expect(result[edges.indexOf(callFindAll)].resolve_status).toBe('resolved')
    expect(result[edges.indexOf(callFindAll)].target_id).toBe(repoClass.id)
  })

  it('T-02: S3 Flutter super happy — super.validate() → Base.validate', async () => {
    const repoId = 'flutter_proj'
    const childClass  = makeNode({ id: `${repoId}:lib/child.dart:Child`, type: 'class', name: 'Child', file_path: 'lib/child.dart', repo_id: repoId })
    const childMethod = makeNode({ id: `${repoId}:lib/child.dart:Child.validate`, type: 'method', name: 'Child.validate', file_path: 'lib/child.dart', repo_id: repoId })
    const baseClass   = makeNode({ id: `${repoId}:lib/base.dart:Base`, type: 'class', name: 'Base', file_path: 'lib/base.dart', repo_id: repoId })
    const baseValidate = makeNode({ id: `${repoId}:lib/base.dart:Base.validate`, type: 'method', name: 'Base.validate', file_path: 'lib/base.dart', repo_id: repoId })
    // extra nodes to reach ≥10
    const baseInit    = makeNode({ id: `${repoId}:lib/base.dart:Base.init`, type: 'method', name: 'Base.init', file_path: 'lib/base.dart', repo_id: repoId })
    const baseBuild   = makeNode({ id: `${repoId}:lib/base.dart:Base.build`, type: 'method', name: 'Base.build', file_path: 'lib/base.dart', repo_id: repoId })
    const childInit   = makeNode({ id: `${repoId}:lib/child.dart:Child.init`, type: 'method', name: 'Child.init', file_path: 'lib/child.dart', repo_id: repoId })
    const childBuild  = makeNode({ id: `${repoId}:lib/child.dart:Child.build`, type: 'method', name: 'Child.build', file_path: 'lib/child.dart', repo_id: repoId })
    const utilClass   = makeNode({ id: `${repoId}:lib/util.dart:Util`, type: 'class', name: 'Util', file_path: 'lib/util.dart', repo_id: repoId })
    const utilHelper  = makeNode({ id: `${repoId}:lib/util.dart:Util.helper`, type: 'method', name: 'Util.helper', file_path: 'lib/util.dart', repo_id: repoId })

    const extendsEdge = makeEdge({
      relation: 'extends',
      source_id: childClass.id,
      target_id: baseClass.id,
      resolve_status: 'resolved',
      repo_id: repoId,
    })
    const callSuper = makeEdge({
      relation: 'calls',
      source_id: childMethod.id,
      target_specifier: 'super.validate',
      resolve_status: 'pending',
      repo_id: repoId,
    })
    // extra edges to reach ≥20
    const contains1 = makeEdge({ relation: 'contains', source_id: baseClass.id, target_id: baseValidate.id, resolve_status: 'resolved', repo_id: repoId })
    const contains2 = makeEdge({ relation: 'contains', source_id: baseClass.id, target_id: baseInit.id, resolve_status: 'resolved', repo_id: repoId })
    const contains3 = makeEdge({ relation: 'contains', source_id: baseClass.id, target_id: baseBuild.id, resolve_status: 'resolved', repo_id: repoId })
    const contains4 = makeEdge({ relation: 'contains', source_id: childClass.id, target_id: childMethod.id, resolve_status: 'resolved', repo_id: repoId })
    const contains5 = makeEdge({ relation: 'contains', source_id: childClass.id, target_id: childInit.id, resolve_status: 'resolved', repo_id: repoId })
    const contains6 = makeEdge({ relation: 'contains', source_id: childClass.id, target_id: childBuild.id, resolve_status: 'resolved', repo_id: repoId })
    const contains7 = makeEdge({ relation: 'contains', source_id: utilClass.id, target_id: utilHelper.id, resolve_status: 'resolved', repo_id: repoId })
    const callInit1 = makeEdge({ relation: 'calls', source_id: childInit.id, target_specifier: 'super.init', resolve_status: 'pending', repo_id: repoId })
    const callBuild1 = makeEdge({ relation: 'calls', source_id: childBuild.id, target_specifier: 'super.build', resolve_status: 'pending', repo_id: repoId })
    const callInit2  = makeEdge({ relation: 'calls', source_id: childInit.id, target_specifier: 'this.validate', resolve_status: 'pending', repo_id: repoId })
    const callBuild2 = makeEdge({ relation: 'calls', source_id: childBuild.id, target_specifier: 'this.init', resolve_status: 'pending', repo_id: repoId })
    const implEdge   = makeEdge({ relation: 'implements', source_id: childClass.id, target_id: utilClass.id, resolve_status: 'resolved', repo_id: repoId })
    const callUtil   = makeEdge({ relation: 'calls', source_id: childMethod.id, target_specifier: 'this.validate', resolve_status: 'pending', repo_id: repoId })
    const usesT      = makeEdge({ relation: 'uses_type', source_id: childMethod.id, target_id: utilClass.id, resolve_status: 'resolved', repo_id: repoId })
    const decorate   = makeEdge({ relation: 'decorates', source_id: childClass.id, target_id: utilClass.id, resolve_status: 'resolved', repo_id: repoId })
    const extraCall1 = makeEdge({ relation: 'calls', source_id: baseInit.id, target_specifier: 'this.helper', resolve_status: 'pending', repo_id: repoId })
    const extraCall2 = makeEdge({ relation: 'calls', source_id: baseBuild.id, target_specifier: 'this.init', resolve_status: 'pending', repo_id: repoId })
    const reExport   = makeEdge({ relation: 're_exports', source_id: `${repoId}:lib/base.dart`, target_id: baseClass.id, resolve_status: 'resolved', repo_id: repoId })

    const nodes: CodeNodeRaw[] = [childClass, childMethod, baseClass, baseValidate, baseInit, baseBuild, childInit, childBuild, utilClass, utilHelper]
    const edges: CodeEdgeRaw[] = [
      extendsEdge, callSuper, contains1, contains2, contains3, contains4, contains5, contains6, contains7,
      callInit1, callBuild1, callInit2, callBuild2, implEdge, callUtil, usesT, decorate, extraCall1, extraCall2, reExport,
    ]

    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const callSuperIdx = edges.indexOf(callSuper)
    expect(result[callSuperIdx].resolve_status).toBe('resolved')
    expect(result[callSuperIdx].target_id).toBe(baseValidate.id)
  })

  it('T-03: S2 Next.js intra-class — this.b() → Service.b', async () => {
    const repoId = 'nextjs'
    const svcClass = makeNode({ id: `${repoId}:lib/service.ts:Service`, type: 'class', name: 'Service', file_path: 'lib/service.ts', repo_id: repoId })
    const svcA     = makeNode({ id: `${repoId}:lib/service.ts:Service.a`, type: 'method', name: 'Service.a', file_path: 'lib/service.ts', repo_id: repoId })
    const svcB     = makeNode({ id: `${repoId}:lib/service.ts:Service.b`, type: 'method', name: 'Service.b', file_path: 'lib/service.ts', repo_id: repoId })
    // extra
    const svcC = makeNode({ id: `${repoId}:lib/service.ts:Service.c`, type: 'method', name: 'Service.c', file_path: 'lib/service.ts', repo_id: repoId })
    const svcD = makeNode({ id: `${repoId}:lib/service.ts:Service.d`, type: 'method', name: 'Service.d', file_path: 'lib/service.ts', repo_id: repoId })
    const otherClass = makeNode({ id: `${repoId}:lib/other.ts:Other`, type: 'class', name: 'Other', file_path: 'lib/other.ts', repo_id: repoId })
    const otherM1  = makeNode({ id: `${repoId}:lib/other.ts:Other.m1`, type: 'method', name: 'Other.m1', file_path: 'lib/other.ts', repo_id: repoId })
    const otherM2  = makeNode({ id: `${repoId}:lib/other.ts:Other.m2`, type: 'method', name: 'Other.m2', file_path: 'lib/other.ts', repo_id: repoId })
    const otherM3  = makeNode({ id: `${repoId}:lib/other.ts:Other.m3`, type: 'method', name: 'Other.m3', file_path: 'lib/other.ts', repo_id: repoId })
    const fileNode = makeNode({ id: `${repoId}:lib/service.ts`, type: 'file' as any, name: 'service.ts', file_path: 'lib/service.ts', repo_id: repoId })

    const callAtoB = makeEdge({ relation: 'calls', source_id: svcA.id, target_specifier: 'this.b', resolve_status: 'pending', repo_id: repoId })
    // extra edges
    const cont1 = makeEdge({ relation: 'contains', source_id: svcClass.id, target_id: svcA.id, resolve_status: 'resolved', repo_id: repoId })
    const cont2 = makeEdge({ relation: 'contains', source_id: svcClass.id, target_id: svcB.id, resolve_status: 'resolved', repo_id: repoId })
    const cont3 = makeEdge({ relation: 'contains', source_id: svcClass.id, target_id: svcC.id, resolve_status: 'resolved', repo_id: repoId })
    const cont4 = makeEdge({ relation: 'contains', source_id: svcClass.id, target_id: svcD.id, resolve_status: 'resolved', repo_id: repoId })
    const cont5 = makeEdge({ relation: 'contains', source_id: otherClass.id, target_id: otherM1.id, resolve_status: 'resolved', repo_id: repoId })
    const cont6 = makeEdge({ relation: 'contains', source_id: otherClass.id, target_id: otherM2.id, resolve_status: 'resolved', repo_id: repoId })
    const cont7 = makeEdge({ relation: 'contains', source_id: otherClass.id, target_id: otherM3.id, resolve_status: 'resolved', repo_id: repoId })
    const callCtoD = makeEdge({ relation: 'calls', source_id: svcC.id, target_specifier: 'this.d', resolve_status: 'pending', repo_id: repoId })
    const callDtoA = makeEdge({ relation: 'calls', source_id: svcD.id, target_specifier: 'this.a', resolve_status: 'pending', repo_id: repoId })
    const importOther = makeEdge({ relation: 'imports', source_id: `${repoId}:lib/service.ts`, target_specifier: './other', target_symbol: 'Other', target_id: otherClass.id, resolve_status: 'resolved', repo_id: repoId })
    const usesT = makeEdge({ relation: 'uses_type', source_id: svcA.id, target_id: otherClass.id, resolve_status: 'resolved', repo_id: repoId })
    const callM1 = makeEdge({ relation: 'calls', source_id: otherM1.id, target_specifier: 'this.m2', resolve_status: 'pending', repo_id: repoId })
    const callM2 = makeEdge({ relation: 'calls', source_id: otherM2.id, target_specifier: 'this.m3', resolve_status: 'pending', repo_id: repoId })
    const callM3 = makeEdge({ relation: 'calls', source_id: otherM3.id, target_specifier: 'this.m1', resolve_status: 'pending', repo_id: repoId })
    const fileContainSvc = makeEdge({ relation: 'contains', source_id: fileNode.id, target_id: svcClass.id, resolve_status: 'resolved', repo_id: repoId })
    const fileContainOther = makeEdge({ relation: 'contains', source_id: `${repoId}:lib/other.ts`, target_id: otherClass.id, resolve_status: 'resolved', repo_id: repoId })
    const extImport = makeEdge({ relation: 'imports', source_id: `${repoId}:lib/service.ts`, target_specifier: 'react', resolve_status: 'external', repo_id: repoId })
    const decoEdge  = makeEdge({ relation: 'decorates', source_id: svcClass.id, target_id: otherClass.id, resolve_status: 'resolved', repo_id: repoId })
    const implEdge  = makeEdge({ relation: 'implements', source_id: svcClass.id, target_id: otherClass.id, resolve_status: 'failed', repo_id: repoId })

    const nodes: CodeNodeRaw[] = [svcClass, svcA, svcB, svcC, svcD, otherClass, otherM1, otherM2, otherM3, fileNode]
    const edges: CodeEdgeRaw[] = [
      callAtoB, cont1, cont2, cont3, cont4, cont5, cont6, cont7,
      callCtoD, callDtoA, importOther, usesT, callM1, callM2, callM3,
      fileContainSvc, fileContainOther, extImport, decoEdge, implEdge,
    ]

    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const callIdx = edges.indexOf(callAtoB)
    expect(result[callIdx].resolve_status).toBe('resolved')
    expect(result[callIdx].target_id).toBe(svcB.id)
  })

  it('T-04: specifier=null (Case A defensive — F2 버그 방어)', async () => {
    const callNullSpec = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: null, resolve_status: 'pending' })
    const edges: CodeEdgeRaw[] = [callNullSpec]

    const result = await resolveCalls(edges, [], new Map(), new Map())
    expect(result[0].resolve_status).toBe('failed')
  })

  it('T-05: cross-file happy — import resolved + calls pending → resolved', async () => {
    const repoId = 'proj'
    const sourceNode = makeNode({ id: `${repoId}:a.ts:render`, type: 'method', name: 'render', file_path: 'a.ts', repo_id: repoId })
    const importEdge = makeEdge({
      relation: 'imports',
      source_id: `${repoId}:a.ts`,
      target_specifier: './utils',
      target_symbol: 'formatDate',
      target_id: `${repoId}:utils.ts:formatDate`,
      resolve_status: 'resolved',
      repo_id: repoId,
    })
    const callEdge = makeEdge({
      relation: 'calls',
      source_id: `${repoId}:a.ts:render`,
      target_specifier: './utils',
      target_symbol: 'formatDate',
      resolve_status: 'pending',
      repo_id: repoId,
    })

    const result = await resolveCalls([importEdge, callEdge], [sourceNode], new Map(), new Map())
    expect(result[1].resolve_status).toBe('resolved')
    expect(result[1].target_id).toBe(`${repoId}:utils.ts:formatDate`)
  })

  it('T-06: external 전파 — calls → external', async () => {
    const repoId = 'proj'
    const sourceNode = makeNode({ id: `${repoId}:a.ts:Svc.m`, type: 'method', name: 'Svc.m', file_path: 'a.ts', repo_id: repoId })
    const importExt = makeEdge({ relation: 'imports', source_id: `${repoId}:a.ts`, target_specifier: '@nestjs/common', resolve_status: 'external', repo_id: repoId })
    const callExt   = makeEdge({ relation: 'calls', source_id: `${repoId}:a.ts:Svc.m`, target_specifier: '@nestjs/common', target_symbol: 'Logger', resolve_status: 'pending', repo_id: repoId })

    const result = await resolveCalls([importExt, callExt], [sourceNode], new Map(), new Map())
    expect(result[1].resolve_status).toBe('external')
    expect(result[1].target_id).toBeNull()
  })

  it('T-07: 혼합 — DI + super + cross-file 동시 → 모두 resolved', async () => {
    const repoId = 'multi'

    // DI setup
    const svcCls  = makeNode({ id: `${repoId}:svc.ts:Svc`, type: 'class', name: 'Svc', file_path: 'svc.ts', repo_id: repoId })
    const svcM    = makeNode({ id: `${repoId}:svc.ts:Svc.m`, type: 'method', name: 'Svc.m', file_path: 'svc.ts', repo_id: repoId })
    const repoCls = makeNode({ id: `${repoId}:repo.ts:Repo`, type: 'class', name: 'Repo', file_path: 'repo.ts', repo_id: repoId })
    const repoF   = makeNode({ id: `${repoId}:repo.ts:Repo.find`, type: 'method', name: 'Repo.find', file_path: 'repo.ts', repo_id: repoId })

    // Super setup
    const childCls  = makeNode({ id: `${repoId}:child.ts:Child`, type: 'class', name: 'Child', file_path: 'child.ts', repo_id: repoId })
    const childM    = makeNode({ id: `${repoId}:child.ts:Child.validate`, type: 'method', name: 'Child.validate', file_path: 'child.ts', repo_id: repoId })
    const baseCls   = makeNode({ id: `${repoId}:base.ts:Base`, type: 'class', name: 'Base', file_path: 'base.ts', repo_id: repoId })
    const baseValidate = makeNode({ id: `${repoId}:base.ts:Base.validate`, type: 'method', name: 'Base.validate', file_path: 'base.ts', repo_id: repoId })

    // Cross-file setup
    const callerM  = makeNode({ id: `${repoId}:caller.ts:Caller.call`, type: 'method', name: 'Caller.call', file_path: 'caller.ts', repo_id: repoId })

    const nodes: CodeNodeRaw[] = [svcCls, svcM, repoCls, repoF, childCls, childM, baseCls, baseValidate, callerM]

    const extendsEdge = makeEdge({ relation: 'extends', source_id: childCls.id, target_id: baseCls.id, resolve_status: 'resolved', repo_id: repoId })
    const importRepo  = makeEdge({ relation: 'imports', source_id: `${repoId}:svc.ts`, target_specifier: './repo', target_symbol: 'Repo', target_id: repoCls.id, resolve_status: 'resolved', repo_id: repoId })
    const importUtil  = makeEdge({ relation: 'imports', source_id: `${repoId}:caller.ts`, target_specifier: './util', target_symbol: 'fn', target_id: `${repoId}:util.ts:fn`, resolve_status: 'resolved', repo_id: repoId })

    const callDI    = makeEdge({ relation: 'calls', source_id: svcM.id, target_specifier: 'this.repo.find', resolve_status: 'pending', repo_id: repoId })
    const callSuper = makeEdge({ relation: 'calls', source_id: childM.id, target_specifier: 'super.validate', resolve_status: 'pending', repo_id: repoId })
    const callCross = makeEdge({ relation: 'calls', source_id: callerM.id, target_specifier: './util', target_symbol: 'fn', resolve_status: 'pending', repo_id: repoId })

    const edges: CodeEdgeRaw[] = [extendsEdge, importRepo, importUtil, callDI, callSuper, callCross]
    const diMap: ConstructorDIMap = new Map([[svcCls.id, [{ fieldName: 'repo', typeName: 'Repo' }]]])

    const result = await resolveCalls(edges, nodes, diMap, new Map())
    expect(result[edges.indexOf(callDI)].resolve_status).toBe('resolved')
    expect(result[edges.indexOf(callDI)].target_id).toBe(repoF.id)
    expect(result[edges.indexOf(callSuper)].resolve_status).toBe('resolved')
    expect(result[edges.indexOf(callSuper)].target_id).toBe(baseValidate.id)
    expect(result[edges.indexOf(callCross)].resolve_status).toBe('resolved')
    expect(result[edges.indexOf(callCross)].target_id).toBe(`${repoId}:util.ts:fn`)
  })

  it('T-11: calls 해석 실패 — DI field 없음 → failed', async () => {
    const m   = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const cls = makeNode({ id: 'p:a.ts:C', type: 'class', name: 'C', file_path: 'a.ts' })
    const diMap: ConstructorDIMap = new Map([['p:a.ts:C', [{ fieldName: 'logger', typeName: 'Logger' }]]])
    const callEdge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: 'this.unknown.m', resolve_status: 'pending' })

    const result = await resolveCalls([callEdge], [m, cls], diMap, new Map())
    expect(result[0].resolve_status).toBe('failed')
  })

  it('T-12: super 부모 메서드 없음 → failed', async () => {
    const childM  = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const baseCls = makeNode({ id: 'p:b.ts:Base', type: 'class', name: 'Base', file_path: 'b.ts' })
    const extendsE = makeEdge({ relation: 'extends', source_id: 'p:a.ts:C', target_id: 'p:b.ts:Base', resolve_status: 'resolved' })
    const callSuper = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: 'super.missing', resolve_status: 'pending' })

    const result = await resolveCalls([extendsE, callSuper], [childM, baseCls], new Map(), new Map())
    expect(result[1].resolve_status).toBe('failed')
  })

  it('T-13: cross-file — imports edge 없음 → failed', async () => {
    const m = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const callEdge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:M.m', target_specifier: './x', target_symbol: 'fn', resolve_status: 'pending' })

    const result = await resolveCalls([callEdge], [m], new Map(), new Map())
    expect(result[0].resolve_status).toBe('failed')
  })

  it('T-18: 재료 전무 entry + calls pending → failed (early exit 없음, B3)', async () => {
    const m = makeNode({ id: 'p:a.ts:M.m', type: 'method', name: 'M.m', file_path: 'a.ts' })
    const callEdge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:M.m', target_specifier: './utils', target_symbol: 'fn', resolve_status: 'pending' })
    const containsEdge = makeEdge({ relation: 'contains', source_id: 'p:a.ts', target_id: 'p:a.ts:M.m', resolve_status: 'resolved' })

    // DIMap 비어있음 + extends 없음 + enumValueMap 비어있음 + imports 없음
    const edges: CodeEdgeRaw[] = [containsEdge, callEdge]
    const result = await resolveCalls(edges, [m], new Map(), new Map())

    // contains는 pass-through
    expect(result[0]).toBe(containsEdge)
    // calls pending → Pass A 진입 → resolveImportedCall → importResolvedMap miss → failed
    expect(result[1].resolve_status).toBe('failed')
    expect(result[1].resolve_status).not.toBe('pending')
  })

  it('T-19: this. 빈 문자열 dispatch → IntraFile(Case B) → methodName empty → failed', async () => {
    const m = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const callEdge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: 'this.', resolve_status: 'pending' })

    const result = await resolveCalls([callEdge], [m], new Map(), new Map())
    expect(result[0].resolve_status).toBe('failed')
  })

  // ────────────────────────────────────────────────────────────────
  // 2.3 불변식 검증
  // ────────────────────────────────────────────────────────────────

  it('T-20: F5-1 입력 비변형 — edges/nodes JSON 전후 동일', async () => {
    const m = makeNode({ id: 'p:a.ts:C.m', type: 'method', name: 'C.m', file_path: 'a.ts' })
    const callEdge = makeEdge({ relation: 'calls', source_id: 'p:a.ts:C.m', target_specifier: 'this.', resolve_status: 'pending' })
    const edges = [callEdge]
    const nodes = [m]

    const edgesBefore = JSON.stringify(edges)
    const nodesBefore = JSON.stringify(nodes)

    await resolveCalls(edges, nodes, new Map(), new Map())

    expect(JSON.stringify(edges)).toBe(edgesBefore)
    expect(JSON.stringify(nodes)).toBe(nodesBefore)
  })

  it('T-21: F5-2 길이/순서 동일', async () => {
    const { nodes, edges, diMap, enumValueMap } = makeNestJsFixture()
    const result = await resolveCalls(edges, nodes, diMap, enumValueMap)
    expect(result.length).toBe(edges.length)
  })

  it('T-22: F5-3 calls pending 소거', async () => {
    const { nodes, edges, diMap, enumValueMap } = makeNestJsFixture()
    const result = await resolveCalls(edges, nodes, diMap, enumValueMap)
    const callsPending = result.filter(e => e.relation === 'calls' && e.resolve_status === 'pending')
    expect(callsPending.length).toBe(0)
  })

  it('T-23b: externalsByFile 파일별 분리 — file-a external이 file-b에 오염되지 않음 (known limitation 해소)', async () => {
    // externalsByFile: Map<sourceFileId, Set<string>> 도입으로 전역 오염 해소.
    // File A의 external 마킹이 File B call에 영향을 주지 않는다.
    const repoId = 'proj'
    const nodeB = makeNode({ id: `${repoId}:b.ts:B.m`, type: 'method', name: 'B.m', file_path: 'b.ts', repo_id: repoId })
    // File A: @app/shared → external
    const importExtA = makeEdge({
      relation: 'imports',
      source_id: `${repoId}:a.ts`,
      target_specifier: '@app/shared',
      resolve_status: 'external',
      repo_id: repoId,
    })
    // File B: @app/shared → resolved (실제로는 로컬 모노레포 패키지)
    const importResB = makeEdge({
      relation: 'imports',
      source_id: `${repoId}:b.ts`,
      target_specifier: '@app/shared',
      target_symbol: 'SharedFn',
      target_id: `${repoId}:shared.ts:SharedFn`,
      resolve_status: 'resolved',
      repo_id: repoId,
    })
    // File B의 call: @app/shared → SharedFn (pending)
    const callB = makeEdge({
      relation: 'calls',
      source_id: `${repoId}:b.ts:B.m`,
      target_specifier: '@app/shared',
      target_symbol: 'SharedFn',
      resolve_status: 'pending',
      repo_id: repoId,
    })
    const result = await resolveCalls([importExtA, importResB, callB], [nodeB], new Map(), new Map())
    // File B는 @app/shared를 resolved로 import했으므로 call도 resolved여야 함 (file-a external 오염 X)
    expect(result[2].resolve_status).toBe('resolved')
    expect(result[2].target_id).toBe(`${repoId}:shared.ts:SharedFn`)
  })

  it('T-24: F5-5 non-target 참조 동일성 — toBe (Object.is)', async () => {
    const containsE = makeEdge({ relation: 'contains', source_id: 'p:a.ts', target_id: 'p:a.ts:C', resolve_status: 'resolved' })
    const extendsE  = makeEdge({ relation: 'extends', source_id: 'p:a.ts:C', target_id: 'p:b.ts:B', resolve_status: 'resolved' })
    const usesTypeE = makeEdge({ relation: 'uses_type', source_id: 'p:a.ts:C.m', target_id: 'p:b.ts:B', resolve_status: 'resolved' })

    const edges = [containsE, extendsE, usesTypeE]
    const result = await resolveCalls(edges, [], new Map(), new Map())

    expect(result[0]).toBe(containsE)
    expect(result[1]).toBe(extendsE)
    expect(result[2]).toBe(usesTypeE)
  })

  it('T-25: F5-6 결정성 — 같은 입력 2회 → deepEqual', async () => {
    const { nodes, edges, diMap, enumValueMap } = makeNestJsFixture()

    const result1 = await resolveCalls(edges, nodes, diMap, enumValueMap)
    const result2 = await resolveCalls(edges, nodes, diMap, enumValueMap)

    expect(result1).toEqual(result2)
  })

  it('T-26: F5-8 target_id 무결성 — resolved는 모두 target_id !== null', async () => {
    const { nodes, edges, diMap, enumValueMap } = makeNestJsFixture()
    const result = await resolveCalls(edges, nodes, diMap, enumValueMap)
    const resolvedEdges = result.filter(e => e.resolve_status === 'resolved')
    expect(resolvedEdges.length).toBeGreaterThan(0)   // resolved 엣지가 반드시 존재해야 의미있는 검증
    for (const e of resolvedEdges) {
      expect(e.target_id).not.toBeNull()
    }
  })

  // ────────────────────────────────────────────────────────────────
  // 2.4 scenarios.md 매핑 + F5-11
  // ────────────────────────────────────────────────────────────────

  it('T-32: F5-11 contains/extends pending 잔류 양성 검증', async () => {
    const containsPending = makeEdge({ relation: 'contains', source_id: 'p:a.ts', target_id: null, resolve_status: 'pending' })
    const extendsPending  = makeEdge({ relation: 'extends', source_id: 'p:a.ts:C', target_id: null, resolve_status: 'pending' })

    const edges: CodeEdgeRaw[] = [containsPending, extendsPending]
    const result = await resolveCalls(edges, [], new Map(), new Map())

    // F5-5: non-target edge → 원본 참조 pass-through
    expect(result[0]).toBe(containsPending)
    expect(result[1]).toBe(extendsPending)

    // F5-11: F5는 이 pending들을 소거하지 않음 (F6 담당)
    expect(result[0].resolve_status).toBe('pending')
    expect(result[1].resolve_status).toBe('pending')
  })
})
