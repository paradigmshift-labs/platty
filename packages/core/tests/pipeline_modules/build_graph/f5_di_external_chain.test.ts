// P11: resolveDICall에서 receiver type 기반 분류
// - DI typeName이 graph 안에 없음 (외부 lib type) → external_chain
// - DI typeName이 graph 안 class → method/property 매칭 (resolved 또는 failed)
import { describe, it, expect } from 'vitest'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls.js'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap } from '@/pipeline_modules/build_graph/types.js'

function mkNode(o: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string }): CodeNodeRaw {
  return { repo_id: 'r1', line_start: 1, line_end: 5, signature: null, exported: true, parse_status: 'ok', is_test: false, test_type: null, is_async: false, jsdoc: null, ...o }
}
function mkEdge(o: Partial<CodeEdgeRaw> & { source_id: string; relation: CodeEdgeRaw['relation'] }): CodeEdgeRaw {
  return { repo_id: 'r1', target_id: null, target_specifier: null, target_symbol: null, source: 'static', resolve_status: 'pending', ...o }
}

describe('P11: this.X DI chain — receiver type 기반 분류', () => {
  const USECASE = 'src/usecase.ts'
  const CACHE = 'src/cache.wrapper.ts'

  // ─── 외부 type 케이스 (PrismaClient, Kysely 등) ───
  it('EC-DI-01: this.prisma.user.findMany — PrismaClient 외부 type → external_chain', async () => {
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase`, type: 'class', name: 'Usecase', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase.fn`, type: 'method', name: 'Usecase.fn', file_path: USECASE }),
      // PrismaClient는 graph에 없음 (외부 @prisma/client)
    ]
    const di: ConstructorDIMap = new Map([
      [`r1:${USECASE}:Usecase`, [{ fieldName: 'prisma', typeName: 'PrismaClient' }]],
    ])
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}:Usecase.fn`,
        relation: 'calls',
        target_specifier: 'this.prisma.user.findMany',
        target_symbol: 'findMany',
        chain_path: 'this.prisma.user',
      }),
    ]
    const result = await resolveCalls(edges, nodes, di, new Map())
    const e = result.find((x) => x.relation === 'calls')
    expect(e!.resolve_status).toBe('external_chain')
  })

  it('EC-DI-02: this.kysely.selectFrom — Kysely 외부 type → external_chain', async () => {
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase`, type: 'class', name: 'Usecase', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase.fn`, type: 'method', name: 'Usecase.fn', file_path: USECASE }),
    ]
    const di: ConstructorDIMap = new Map([
      [`r1:${USECASE}:Usecase`, [{ fieldName: 'kysely', typeName: 'Kysely' }]],
    ])
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}:Usecase.fn`,
        relation: 'calls',
        target_specifier: 'this.kysely.selectFrom',
        target_symbol: 'selectFrom',
        chain_path: 'this.kysely',
      }),
    ]
    const result = await resolveCalls(edges, nodes, di, new Map())
    expect(result.find((x) => x.relation === 'calls')!.resolve_status).toBe('external_chain')
  })

  // ─── 내부 wrapper class 케이스 (graph 안) ───
  it('EC-DI-03: this.cache.set — CacheWrapper 내부 class의 method → resolved', async () => {
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${CACHE}`, type: 'file', name: 'file', file_path: CACHE }),
      mkNode({ id: `r1:${CACHE}:CacheWrapper`, type: 'class', name: 'CacheWrapper', file_path: CACHE }),
      mkNode({ id: `r1:${CACHE}:CacheWrapper.set`, type: 'method', name: 'CacheWrapper.set', file_path: CACHE }),
      mkNode({ id: `r1:${CACHE}:CacheWrapper.get`, type: 'method', name: 'CacheWrapper.get', file_path: CACHE }),
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase`, type: 'class', name: 'Usecase', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase.fn`, type: 'method', name: 'Usecase.fn', file_path: USECASE }),
    ]
    const di: ConstructorDIMap = new Map([
      [`r1:${USECASE}:Usecase`, [{ fieldName: 'cache', typeName: 'CacheWrapper' }]],
    ])
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}:Usecase.fn`,
        relation: 'calls',
        target_specifier: 'this.cache.set',
        target_symbol: 'set',
        chain_path: 'this.cache',
      }),
    ]
    const result = await resolveCalls(edges, nodes, di, new Map())
    const e = result.find((x) => x.relation === 'calls')
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toBe(`r1:${CACHE}:CacheWrapper.set`)
  })

  it('EC-DI-04: this.cache.get — 내부 method (regression)', async () => {
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${CACHE}`, type: 'file', name: 'file', file_path: CACHE }),
      mkNode({ id: `r1:${CACHE}:CacheWrapper`, type: 'class', name: 'CacheWrapper', file_path: CACHE }),
      mkNode({ id: `r1:${CACHE}:CacheWrapper.get`, type: 'method', name: 'CacheWrapper.get', file_path: CACHE }),
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase`, type: 'class', name: 'Usecase', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase.fn`, type: 'method', name: 'Usecase.fn', file_path: USECASE }),
    ]
    const di: ConstructorDIMap = new Map([
      [`r1:${USECASE}:Usecase`, [{ fieldName: 'cache', typeName: 'CacheWrapper' }]],
    ])
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}:Usecase.fn`,
        relation: 'calls',
        target_specifier: 'this.cache.get',
        target_symbol: 'get',
        chain_path: 'this.cache',
      }),
    ]
    const result = await resolveCalls(edges, nodes, di, new Map())
    const e = result.find((x) => x.relation === 'calls')
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toBe(`r1:${CACHE}:CacheWrapper.get`)
  })

  it('EC-DI-05: this.cache.unknownMethod — 내부 class에 없는 method → failed (정확)', async () => {
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${CACHE}`, type: 'file', name: 'file', file_path: CACHE }),
      mkNode({ id: `r1:${CACHE}:CacheWrapper`, type: 'class', name: 'CacheWrapper', file_path: CACHE }),
      mkNode({ id: `r1:${CACHE}:CacheWrapper.set`, type: 'method', name: 'CacheWrapper.set', file_path: CACHE }),
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase`, type: 'class', name: 'Usecase', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase.fn`, type: 'method', name: 'Usecase.fn', file_path: USECASE }),
    ]
    const di: ConstructorDIMap = new Map([
      [`r1:${USECASE}:Usecase`, [{ fieldName: 'cache', typeName: 'CacheWrapper' }]],
    ])
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}:Usecase.fn`,
        relation: 'calls',
        target_specifier: 'this.cache.unknownMethod',
        target_symbol: 'unknownMethod',
        chain_path: 'this.cache',
      }),
    ]
    const result = await resolveCalls(edges, nodes, di, new Map())
    expect(result.find((x) => x.relation === 'calls')!.resolve_status).toBe('failed')
  })

  it('EC-DI-06: this.cache.timeout — 내부 class의 property field → resolved (P8 fallback)', async () => {
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${CACHE}`, type: 'file', name: 'file', file_path: CACHE }),
      mkNode({ id: `r1:${CACHE}:CacheWrapper`, type: 'class', name: 'CacheWrapper', file_path: CACHE }),
      mkNode({ id: `r1:${CACHE}:CacheWrapper.timeout`, type: 'property', name: 'CacheWrapper.timeout', file_path: CACHE }),
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase`, type: 'class', name: 'Usecase', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase.fn`, type: 'method', name: 'Usecase.fn', file_path: USECASE }),
    ]
    const di: ConstructorDIMap = new Map([
      [`r1:${USECASE}:Usecase`, [{ fieldName: 'cache', typeName: 'CacheWrapper' }]],
    ])
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}:Usecase.fn`,
        relation: 'calls',
        target_specifier: 'this.cache.timeout',
        target_symbol: 'timeout',
        chain_path: 'this.cache',
      }),
    ]
    const result = await resolveCalls(edges, nodes, di, new Map())
    const e = result.find((x) => x.relation === 'calls')
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toBe(`r1:${CACHE}:CacheWrapper.timeout`)
  })

  it('EC-DI-07: this.prisma.user.findMany.then — 깊은 외부 chain + proto method(then) → external (P13 elevate)', async () => {
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase`, type: 'class', name: 'Usecase', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase.fn`, type: 'method', name: 'Usecase.fn', file_path: USECASE }),
    ]
    const di: ConstructorDIMap = new Map([
      [`r1:${USECASE}:Usecase`, [{ fieldName: 'prisma', typeName: 'PrismaClient' }]],
    ])
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}:Usecase.fn`,
        relation: 'calls',
        target_specifier: 'this.prisma.user.findMany.then',
        target_symbol: 'then',
        chain_path: 'this.prisma.user.findMany',
      }),
    ]
    const result = await resolveCalls(edges, nodes, di, new Map())
    // P13: external_chain + 끝 method가 Promise.prototype.then(화이트리스트) → external로 elevate
    expect(result.find((x) => x.relation === 'calls')!.resolve_status).toBe('external')
  })
})
