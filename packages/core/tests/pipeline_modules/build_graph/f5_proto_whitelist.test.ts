/**
 * P13: ECMAScript built-in prototype method 화이트리스트
 *
 * 목표: receiver type 추적 불가능한 prototype method 호출 (`arr.map`, `name.trim` 등)을
 *      `failed` 대신 `external` 로 분류 — heroines failed 30% 중 84%(prototype) 해결.
 *
 * 우선순위: self/DI/import 매칭이 모두 실패한 경우에만 화이트리스트 fallback 적용.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap } from '@/pipeline_modules/build_graph/types'

interface RunOpts {
  source: string
  filePath?: string
  importedFromFile?: { filePath: string; source: string }[]
}

async function runE2E(opts: RunOpts) {
  const adapter = new TypeScriptParserAdapter()
  const filePath = opts.filePath ?? 'src/x.ts'
  const result = adapter.parseFile(opts.source, filePath, 'r1')

  const fileNode: CodeNodeRaw = {
    id: `r1:${filePath}`, repo_id: 'r1', type: 'file', file_path: filePath, name: 'file',
    line_start: null, line_end: null, signature: null, exported: false, parse_status: 'ok',
    is_test: false, test_type: null, is_async: false, jsdoc: null,
  }
  const allNodes: CodeNodeRaw[] = [fileNode, ...result.nodes]
  const allEdges: CodeEdgeRaw[] = [...result.edges]

  for (const ext of opts.importedFromFile ?? []) {
    const r = adapter.parseFile(ext.source, ext.filePath, 'r1')
    const fn: CodeNodeRaw = {
      id: `r1:${ext.filePath}`, repo_id: 'r1', type: 'file', file_path: ext.filePath, name: 'file',
      line_start: null, line_end: null, signature: null, exported: false, parse_status: 'ok',
      is_test: false, test_type: null, is_async: false, jsdoc: null,
    }
    allNodes.push(fn, ...r.nodes)
    allEdges.push(...r.edges)
  }

  const diMap: ConstructorDIMap = new Map()
  for (const cp of result.constructorParams) {
    const cls = result.nodes.find((n) => n.type === 'class' && n.name === cp.className)
    if (cls) diMap.set(cls.id, cp.params)
  }

  const edges = await resolveCalls(allEdges, allNodes, diMap, result.enumValues)
  return { nodes: allNodes, edges }
}

function findCall(edges: CodeEdgeRaw[], symbol: string, specifierContains?: string) {
  return edges.find(
    (e) =>
      e.relation === 'calls' &&
      e.target_symbol === symbol &&
      (specifierContains == null || (e.target_specifier ?? '').includes(specifierContains)),
  )
}

describe('P13: ECMAScript proto method 화이트리스트', () => {
  describe('A. proto method → external (화이트리스트 적용)', () => {
    it('A1 — Array.map (param.map(...), specifier=null)', async () => {
      const { edges } = await runE2E({
        source: `
          export function fn(arr: any[]) {
            arr.map(x => x)
          }
        `,
      })
      const e = findCall(edges, 'map')
      expect(e?.resolve_status).toBe('external')
    })

    it('A2 — Array.filter (chain method, specifier=this.getList().filter)', async () => {
      const { edges } = await runE2E({
        source: `
          export class S {
            getList(): any[] { return [] }
            fn() { this.getList().filter(p => p) }
          }
        `,
      })
      expect(findCall(edges, 'getList')?.resolve_status).toBe('resolved')
      expect(findCall(edges, 'filter')?.resolve_status).toBe('external')
    })

    it('A3 — String.trim (specifier=null)', async () => {
      const { edges } = await runE2E({
        source: `export function fn(name: string) { name.trim() }`,
      })
      expect(findCall(edges, 'trim')?.resolve_status).toBe('external')
    })

    it('A4 — Set.has (specifier=null)', async () => {
      const { edges } = await runE2E({
        source: `export function fn(s: Set<number>) { s.has(1) }`,
      })
      expect(findCall(edges, 'has')?.resolve_status).toBe('external')
    })

    it('A5 — Map.get (specifier=null)', async () => {
      const { edges } = await runE2E({
        source: `export function fn(m: Map<string, number>) { m.get('k') }`,
      })
      expect(findCall(edges, 'get')?.resolve_status).toBe('external')
    })

    it('A6 — Date.toISOString (specifier=null)', async () => {
      const { edges } = await runE2E({
        source: `export function fn(d: Date) { d.toISOString() }`,
      })
      expect(findCall(edges, 'toISOString')?.resolve_status).toBe('external')
    })

    it('A7 — Promise.then (specifier=null)', async () => {
      const { edges } = await runE2E({
        source: `export function fn(p: Promise<number>) { p.then(x => x) }`,
      })
      expect(findCall(edges, 'then')?.resolve_status).toBe('external')
    })

    it('A8 — Number.toFixed (specifier=null)', async () => {
      const { edges } = await runE2E({
        source: `export function fn(n: number) { n.toFixed(2) }`,
      })
      expect(findCall(edges, 'toFixed')?.resolve_status).toBe('external')
    })

    it('A10 — chain map().filter() — 두 hop 모두 external', async () => {
      const { edges } = await runE2E({
        source: `export function fn(arr: number[]) { arr.map(x => x).filter(x => x > 0) }`,
      })
      expect(findCall(edges, 'map')?.resolve_status).toBe('external')
      expect(findCall(edges, 'filter')?.resolve_status).toBe('external')
    })

    it('A13 — this.getUser().map (내부 method + proto chain)', async () => {
      const { edges } = await runE2E({
        source: `
          export interface User { id: number }
          export class UserService {
            getUser(): User[] { return [] }
            fn() { this.getUser().map(u => u.id) }
          }
        `,
      })
      expect(findCall(edges, 'getUser')?.resolve_status).toBe('resolved')
      expect(findCall(edges, 'map')?.resolve_status).toBe('external')
    })

    it('A14 — this.svc.getUser().filter (DI + proto chain)', async () => {
      const { edges } = await runE2E({
        source: `
          export interface User { active: boolean }
          export class Svc {
            getUser(): User[] { return [] }
          }
          export class Owner {
            constructor(private readonly svc: Svc) {}
            fn() { this.svc.getUser().filter(p => p.active) }
          }
        `,
      })
      expect(findCall(edges, 'getUser')?.resolve_status).toBe('resolved')
      expect(findCall(edges, 'filter')?.resolve_status).toBe('external')
    })

    it('A15 — getPrismaDB().map (import + proto chain)', async () => {
      const { edges } = await runE2E({
        filePath: 'src/main.ts',
        source: `
          import { getPrismaDB } from './db'
          export function fn() { getPrismaDB().map(x => x) }
        `,
        importedFromFile: [
          { filePath: 'src/db.ts', source: `export function getPrismaDB(): any[] { return [] }` },
        ],
      })
      // .map — proto 화이트리스트 (getPrismaDB 자체 import 추적은 별도 영역, P13 범위 외)
      expect(findCall(edges, 'map')?.resolve_status).toBe('external')
    })
  })

  describe('B. False positive 방지 — 우리 class 동명 method 우선', () => {
    it('B1 — this.map(x), 같은 class에 map 정의 → resolved', async () => {
      const { edges } = await runE2E({
        source: `
          export class S {
            map(x: number) { return x }
            fn() { this.map(1) }
          }
        `,
      })
      expect(findCall(edges, 'map')?.resolve_status).toBe('resolved')
    })

    it('B2 — this.svc.has(k), Svc에 has 정의 → resolved (DI 우선)', async () => {
      const { edges } = await runE2E({
        source: `
          export class Svc {
            has(k: string) { return true }
          }
          export class Owner {
            constructor(private readonly svc: Svc) {}
            fn() { this.svc.has('k') }
          }
        `,
      })
      expect(findCall(edges, 'has')?.resolve_status).toBe('resolved')
    })

    it('B4 — this.getUser().map() + 같은 class에 map 정의 → getUser=resolved, map=external', async () => {
      // map은 우리 class 안에 있어도, this.getUser() 의 receiver는 Array → 우리 map 호출 아님
      const { edges } = await runE2E({
        source: `
          export class S {
            getUser(): number[] { return [] }
            map(x: number) { return x }
            fn() { this.getUser().map(u => u) }
          }
        `,
      })
      expect(findCall(edges, 'getUser')?.resolve_status).toBe('resolved')
      // .map은 chain method (specifier=this.getUser().map)이라 self 매칭 대상 아님 → external
      const mapEdge = edges.find(
        (e) =>
          e.relation === 'calls' &&
          e.target_symbol === 'map' &&
          (e.target_specifier ?? '').includes('getUser()'),
      )
      expect(mapEdge?.resolve_status).toBe('external')
    })
  })

  describe('C. 라이브러리 chain — 화이트리스트 적용 안 됨 (기존 경로)', () => {
    it('C2 — this.cache.set (cache=우리 wrapper, set 정의 있음) → resolved', async () => {
      const { edges } = await runE2E({
        source: `
          export class CacheWrapper {
            set(k: string, v: any) { return v }
          }
          export class Owner {
            constructor(private readonly cache: CacheWrapper) {}
            fn() { this.cache.set('k', 'v') }
          }
        `,
      })
      expect(findCall(edges, 'set')?.resolve_status).toBe('resolved')
    })

    it('C3 — this.cache.set (cache=우리 wrapper, set 정의 없음) → failed (진짜 갭)', async () => {
      const { edges } = await runE2E({
        source: `
          export class CacheWrapper {
            // set 정의 없음
            other(k: string) { return k }
          }
          export class Owner {
            constructor(private readonly cache: CacheWrapper) {}
            fn() { this.cache.set('k', 'v') }
          }
        `,
      })
      // set은 우리 type 안 method 없음 = 진짜 갭. 화이트리스트로 잡히면 안 됨 (DI 매칭 단계에서 P11/P12 처리)
      expect(findCall(edges, 'set')?.resolve_status).toBe('failed')
    })
  })

  describe('D. unknown symbol — failed 유지', () => {
    it('D1 — obj.totallyMadeUpMethod (화이트리스트 외) → failed', async () => {
      const { edges } = await runE2E({
        source: `export function fn(obj: any) { obj.totallyMadeUpMethod() }`,
      })
      expect(findCall(edges, 'totallyMadeUpMethod')?.resolve_status).toBe('failed')
    })
  })

  describe('E. 우선순위 검증', () => {
    it('E2 — self method 매칭 + symbol 화이트리스트 → resolved (self 우선)', async () => {
      // B1과 같은 의도
      const { edges } = await runE2E({
        source: `
          export class S {
            set(k: string) { return k }
            fn() { this.set('a') }
          }
        `,
      })
      expect(findCall(edges, 'set')?.resolve_status).toBe('resolved')
    })

    it('E3 — 모든 매칭 실패 + 화이트리스트 → external (fallback)', async () => {
      const { edges } = await runE2E({
        source: `export function fn(arr: any[]) { arr.map(x => x) }`,
      })
      expect(findCall(edges, 'map')?.resolve_status).toBe('external')
    })

    it('E4 — 모든 매칭 실패 + 화이트리스트 외 → failed', async () => {
      const { edges } = await runE2E({
        source: `export function fn(obj: any) { obj.zzzWeirdMethod() }`,
      })
      expect(findCall(edges, 'zzzWeirdMethod')?.resolve_status).toBe('failed')
    })
  })
})
