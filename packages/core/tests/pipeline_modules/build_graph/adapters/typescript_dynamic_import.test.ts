/**
 * TS-2: dynamic import (`import('...')`) 처리
 *
 * `await import('./mod')` / `import('./mod').then(m => ...)` — `import_expression` 노드 미처리.
 * lazy loading 패턴이 흔함. imports edge 발화 추가.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import type { CodeEdgeRaw } from '@/pipeline_modules/build_graph/types'

async function parse(source: string, filePath = 'src/x.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(source, filePath, 'r1')
}

function imports(edges: CodeEdgeRaw[], specifier: string) {
  return edges.filter((e) => e.relation === 'imports' && e.target_specifier === specifier)
}

describe('TS-2: dynamic import (`import(...)`)', () => {
  it('DI-1 — `const m = await import("./mod")` — imports edge 발화', async () => {
    const r = await parse(`
      export async function fn() {
        const m = await import('./mod')
        return m
      }
    `)
    expect(imports(r.edges, './mod').length).toBeGreaterThan(0)
  })

  it('DI-2 — `import("./mod").then(m => m.X())` — imports edge + chain method', async () => {
    const r = await parse(`
      export function fn() {
        return import('./mod').then(m => m.doIt())
      }
    `)
    expect(imports(r.edges, './mod').length).toBeGreaterThan(0)
    // chain .then 호출 잡힘 (P13 화이트리스트)
    const thenCall = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'then' && e.source_id.endsWith(':fn'),
    )
    expect(thenCall).toBeDefined()
  })

  it('DI-3 — dynamic import + 변수 path (`import(MOD_PATH)`) — 발화 없음 (path 모름)', async () => {
    const r = await parse(`
      const MOD_PATH = './mod'
      export function fn() {
        return import(MOD_PATH)
      }
    `)
    // path가 변수면 specifier 모르니 imports edge 발화 안 함 (정직)
    const dyn = r.edges.find((e) => e.relation === 'imports' && e.target_specifier === './mod')
    expect(dyn).toBeUndefined()
  })
})
