/**
 * F5: externalSpecifiers 전역 오염 해소 — file별 per-file Map 검증
 * F5-EXT-01~05
 */
import { describe, it, expect } from 'vitest'
import type { CodeNodeRaw, CodeEdgeRaw } from '@/pipeline_modules/build_graph/types.js'
import {
  buildNodeIndices,
  buildEdgeIndices,
  resolveImportedCall,
  type CallIndices,
} from '@/pipeline_modules/build_graph/f5_resolve_calls.js'

// ────────────────────────────────────────────────────────────────
// 헬퍼
// ────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string }): CodeNodeRaw {
  return {
    repo_id: 'r',
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
    repo_id: 'r',
    target_id: null,
    target_specifier: null,
    target_symbol: null,
    resolve_status: 'pending',
    ...overrides,
  }
}

function makeIndices(nodes: CodeNodeRaw[], edges: CodeEdgeRaw[]): CallIndices {
  return { ...buildNodeIndices(nodes), ...buildEdgeIndices(edges) }
}

// ────────────────────────────────────────────────────────────────
// F5-EXT-01: file-a에서 'Logger' external + file-b에서 'Logger' resolved
//            → file-b 호출은 resolved (전역 오염 X)
// ────────────────────────────────────────────────────────────────

describe('F5-EXT-01: cross-file external 오염 방지', () => {
  it('file-a에서 Logger external이어도 file-b Logger 호출은 resolved여야 한다', () => {
    // file-a: Logger를 @external-pkg에서 external로 import
    const importEdgeA = makeEdge({
      relation: 'imports',
      source_id: 'r:file-a.ts',
      target_specifier: '@external-pkg',
      target_symbol: 'Logger',
      resolve_status: 'external',
    })

    // file-b: Logger를 ./my-logger에서 resolved import
    const importEdgeB = makeEdge({
      relation: 'imports',
      source_id: 'r:file-b.ts',
      target_specifier: './my-logger',
      target_symbol: 'Logger',
      target_id: 'r:my-logger.ts:Logger',
      resolve_status: 'resolved',
    })

    // file-b의 Method 노드 (calls 엣지 source)
    const methodNodeB = makeNode({ id: 'r:file-b.ts:Svc.doIt', type: 'method', name: 'Svc.doIt', file_path: 'file-b.ts' })

    const indices = makeIndices([methodNodeB], [importEdgeA, importEdgeB])

    // file-b 메서드에서 Logger 호출
    const callEdge = makeEdge({
      relation: 'calls',
      source_id: 'r:file-b.ts:Svc.doIt',
      target_specifier: './my-logger',
      target_symbol: 'Logger',
      resolve_status: 'pending',
    })

    const outcome = resolveImportedCall(callEdge, indices)
    // file-b에서 Logger는 resolved여야 함 (file-a external 오염 X)
    expect(outcome.resolve_status).toBe('resolved')
    expect(outcome.target_id).toBe('r:my-logger.ts:Logger')
  })
})

// ────────────────────────────────────────────────────────────────
// F5-EXT-02: 같은 파일 내 같은 specifier external 매칭은 그대로 동작 (회귀)
// ────────────────────────────────────────────────────────────────

describe('F5-EXT-02: 같은 파일 내 external 매칭 회귀', () => {
  it('file-a에서 Logger external import → file-a 메서드 호출도 external이어야 한다', () => {
    // file-a: Logger external import
    const importEdgeA = makeEdge({
      relation: 'imports',
      source_id: 'r:file-a.ts',
      target_specifier: '@external-pkg',
      target_symbol: 'Logger',
      resolve_status: 'external',
    })

    const methodNodeA = makeNode({ id: 'r:file-a.ts:Svc.log', type: 'method', name: 'Svc.log', file_path: 'file-a.ts' })

    const indices = makeIndices([methodNodeA], [importEdgeA])

    // file-a 메서드에서 @external-pkg Logger 호출
    const callEdge = makeEdge({
      relation: 'calls',
      source_id: 'r:file-a.ts:Svc.log',
      target_specifier: '@external-pkg',
      target_symbol: 'Logger',
      resolve_status: 'pending',
    })

    const outcome = resolveImportedCall(callEdge, indices)
    expect(outcome.resolve_status).toBe('external')
    expect(outcome.target_id).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────
// F5-EXT-03: 다른 파일에서 같은 specifier 양쪽 다 external → 둘 다 external
// ────────────────────────────────────────────────────────────────

describe('F5-EXT-03: 양쪽 파일 다 external — 둘 다 external 처리', () => {
  it('file-a, file-b 모두 @lib/http를 external import → 각자 호출도 external', () => {
    const importA = makeEdge({
      relation: 'imports',
      source_id: 'r:file-a.ts',
      target_specifier: '@lib/http',
      target_symbol: 'HttpClient',
      resolve_status: 'external',
    })
    const importB = makeEdge({
      relation: 'imports',
      source_id: 'r:file-b.ts',
      target_specifier: '@lib/http',
      target_symbol: 'HttpClient',
      resolve_status: 'external',
    })

    const methodA = makeNode({ id: 'r:file-a.ts:A.fetch', type: 'method', name: 'A.fetch', file_path: 'file-a.ts' })
    const methodB = makeNode({ id: 'r:file-b.ts:B.fetch', type: 'method', name: 'B.fetch', file_path: 'file-b.ts' })

    const indices = makeIndices([methodA, methodB], [importA, importB])

    const callA = makeEdge({
      relation: 'calls',
      source_id: 'r:file-a.ts:A.fetch',
      target_specifier: '@lib/http',
      target_symbol: 'HttpClient',
      resolve_status: 'pending',
    })
    const callB = makeEdge({
      relation: 'calls',
      source_id: 'r:file-b.ts:B.fetch',
      target_specifier: '@lib/http',
      target_symbol: 'HttpClient',
      resolve_status: 'pending',
    })

    expect(resolveImportedCall(callA, indices).resolve_status).toBe('external')
    expect(resolveImportedCall(callB, indices).resolve_status).toBe('external')
  })
})

// ────────────────────────────────────────────────────────────────
// F5-EXT-04: file-a에 external import 있고, file-b에 import 자체 없는 specifier 호출
//            → file-b는 external 처리 안 함 (file-a 영향 0)
// ────────────────────────────────────────────────────────────────

describe('F5-EXT-04: file-a external이 file-b 미import specifier에 영향 없음', () => {
  it('file-b에 @special-lib import 없으면 file-b 호출은 external이 아닌 failed여야 한다', () => {
    // file-a만 @special-lib를 external로 import
    const importA = makeEdge({
      relation: 'imports',
      source_id: 'r:file-a.ts',
      target_specifier: '@special-lib',
      target_symbol: 'Util',
      resolve_status: 'external',
    })

    const methodB = makeNode({ id: 'r:file-b.ts:B.use', type: 'method', name: 'B.use', file_path: 'file-b.ts' })

    const indices = makeIndices([methodB], [importA])

    // file-b에서 @special-lib 호출 (import 없음)
    const callB = makeEdge({
      relation: 'calls',
      source_id: 'r:file-b.ts:B.use',
      target_specifier: '@special-lib',
      target_symbol: 'Util',
      resolve_status: 'pending',
    })

    const outcome = resolveImportedCall(callB, indices)
    // file-b에는 @special-lib import가 없으므로 external이 아닌 failed (importResolvedMap miss)
    expect(outcome.resolve_status).not.toBe('external')
  })
})

// ────────────────────────────────────────────────────────────────
// F5-EXT-05: buildEdgeIndices 결과 자료구조 검증 (externalsByFile Map 형식)
// ────────────────────────────────────────────────────────────────

describe('F5-EXT-05: buildEdgeIndices externalsByFile 자료구조', () => {
  it('externalsByFile은 Map<sourceFileId, Set<string>> 형태여야 한다', () => {
    const edgeA = makeEdge({
      relation: 'imports',
      source_id: 'r:file-a.ts',
      target_specifier: '@pkg/a',
      resolve_status: 'external',
    })
    const edgeB = makeEdge({
      relation: 'imports',
      source_id: 'r:file-b.ts',
      target_specifier: '@pkg/b',
      resolve_status: 'external',
    })
    const edgeB2 = makeEdge({
      relation: 'imports',
      source_id: 'r:file-b.ts',
      target_specifier: '@pkg/c',
      resolve_status: 'external',
    })

    const idx = buildEdgeIndices([edgeA, edgeB, edgeB2])

    // externalsByFile 존재 확인
    expect(idx).toHaveProperty('externalsByFile')
    const map = idx.externalsByFile

    // file-a에는 @pkg/a만
    const setA = map.get('r:file-a.ts')
    expect(setA).toBeDefined()
    expect(setA!.has('@pkg/a')).toBe(true)
    expect(setA!.has('@pkg/b')).toBe(false)

    // file-b에는 @pkg/b, @pkg/c
    const setB = map.get('r:file-b.ts')
    expect(setB).toBeDefined()
    expect(setB!.has('@pkg/b')).toBe(true)
    expect(setB!.has('@pkg/c')).toBe(true)
    expect(setB!.has('@pkg/a')).toBe(false)
  })

  it('externalSpecifiers 레거시 키가 없어도 기존 동작 유지 (externalsByFile로 대체)', () => {
    const edge = makeEdge({
      relation: 'imports',
      source_id: 'r:file-a.ts',
      target_specifier: '@nestjs/common',
      resolve_status: 'external',
    })
    const idx = buildEdgeIndices([edge])

    // externalsByFile에 올바르게 들어있어야 함
    const set = idx.externalsByFile.get('r:file-a.ts')
    expect(set?.has('@nestjs/common')).toBe(true)
  })
})
