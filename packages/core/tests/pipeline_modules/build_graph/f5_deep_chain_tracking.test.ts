// P12: 깊은 chain 추적 — property type annotation chain segment 매핑
// this.cache.other.set 같은 depth 2+ chain에서 중간 segment를 property + type 따라가며 끝까지 graph 매핑
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls.js'
import type { CodeNodeRaw, ConstructorDIMap } from '@/pipeline_modules/build_graph/types.js'

async function parseAndResolve(content: string, filePath = 'src/x.ts') {
  const adapter = new TypeScriptParserAdapter()
  const result = adapter.parseFile(content, filePath, 'r1')
  const fileNode: CodeNodeRaw = {
    id: `r1:${filePath}`, repo_id: 'r1', type: 'file', file_path: filePath, name: 'file',
    line_start: null, line_end: null, signature: null, exported: false, parse_status: 'ok',
    is_test: false, test_type: null, is_async: false, jsdoc: null,
  }
  const allNodes: CodeNodeRaw[] = [fileNode, ...result.nodes]
  const diMap: ConstructorDIMap = new Map()
  for (const cp of result.constructorParams) {
    const cls = result.nodes.find((n) => n.type === 'class' && n.name === cp.className)
    if (cls) diMap.set(cls.id, cp.params)
  }
  const edges = await resolveCalls(result.edges, allNodes, diMap, result.enumValues)
  return { nodes: allNodes, edges }
}

describe('P12: 깊은 chain 추적 — property type annotation 기반', () => {
  it('DC-01: this.cache.inner.set — type annotation 기반 chain → InnerCache.set 매핑', async () => {
    const r = await parseAndResolve(`
      export class InnerCache {
        set(k: string, v: any) { return v }
      }
      export class CacheWrapper {
        inner: InnerCache = new InnerCache()
      }
      export class Outer {
        constructor(private readonly cache: CacheWrapper) {}
        fn() {
          this.cache.inner.set('k', 'v')
        }
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'calls' &&
        edge.source_id.endsWith(':Outer.fn') &&
        edge.target_symbol === 'set',
    )
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toBe('r1:src/x.ts:InnerCache.set')
  })

  it('DC-02: type annotation만 있고 RHS 없음 — chain 추적', async () => {
    const r = await parseAndResolve(`
      export class InnerCache {
        get(k: string) { return null }
      }
      export class CacheWrapper {
        inner: InnerCache  // type annotation만, RHS 없음 (DI later)
      }
      export class Outer {
        constructor(private readonly cache: CacheWrapper) {}
        fn() {
          this.cache.inner.get('k')
        }
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'calls' &&
        edge.source_id.endsWith(':Outer.fn') &&
        edge.target_symbol === 'get',
    )
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toBe('r1:src/x.ts:InnerCache.get')
  })

  it('DC-03: depth 3 chain — A.b.c.fn → C.fn 매핑', async () => {
    const r = await parseAndResolve(`
      export class C {
        fn() { return 1 }
      }
      export class B {
        c: C = new C()
      }
      export class A {
        b: B = new B()
      }
      export class Outer {
        constructor(private readonly a: A) {}
        run() {
          this.a.b.c.fn()
        }
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'calls' &&
        edge.source_id.endsWith(':Outer.run') &&
        edge.target_symbol === 'fn',
    )
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toBe('r1:src/x.ts:C.fn')
  })

  it('DC-04: type이 외부 (graph 없음) + proto method(get) → external (P13 elevate)', async () => {
    const r = await parseAndResolve(`
      import { RedisClient } from 'redis-external'
      export class CacheWrapper {
        client: RedisClient
      }
      export class Outer {
        constructor(private readonly cache: CacheWrapper) {}
        fn() {
          this.cache.client.get('k')
        }
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'calls' &&
        edge.source_id.endsWith(':Outer.fn') &&
        edge.target_symbol === 'get',
    )
    // P13: external_chain + 'get'(Map.prototype 화이트리스트) → external로 elevate
    expect(e!.resolve_status).toBe('external')
  })

  it('DC-05: 우리 type 안에 method 없음 → failed (진짜 갭)', async () => {
    const r = await parseAndResolve(`
      export class InnerCache {
        set(k: string, v: any) { return v }
        // get은 빠뜨림 (진짜 갭)
      }
      export class CacheWrapper {
        inner: InnerCache = new InnerCache()
      }
      export class Outer {
        constructor(private readonly cache: CacheWrapper) {}
        fn() {
          this.cache.inner.unknownMethod('k')
        }
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'calls' &&
        edge.source_id.endsWith(':Outer.fn') &&
        edge.target_symbol === 'unknownMethod',
    )
    expect(e!.resolve_status).toBe('failed')
  })

  it('DC-06: 중간 property가 graph에 없음 + proto method(set) → external (P13 elevate)', async () => {
    const r = await parseAndResolve(`
      export class CacheWrapper {
        // inner property 정의 안 됨 (이상한 chain)
      }
      export class Outer {
        constructor(private readonly cache: CacheWrapper) {}
        fn() {
          // @ts-ignore — fixture 의도된 잘못된 chain
          this.cache.inner.set('k', 'v')
        }
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'calls' &&
        edge.source_id.endsWith(':Outer.fn') &&
        edge.target_symbol === 'set',
    )
    // P13: external_chain + 'set'(Map/Set.prototype 화이트리스트) → external로 elevate
    expect(e!.resolve_status).toBe('external')
  })
})
