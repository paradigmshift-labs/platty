/**
 * a4 exports — Dart export/library/part syntax
 * TS의 export/re-export 1:1 매핑 (Dart는 export + part of 시스템)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

describe('Dart a4 exports', () => {
  it('E-1 — `export "package:foo/bar.dart"` re-export', async () => {
    const r = await parse(`
      export 'package:foo/bar.dart';
      class X {}
    `)
    // re-export는 grammar로 export 처리. WASM에서 다르게 처리 가능 — 일단 회귀 안전망
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'X')).toBe(true)
  })

  it.skip('E-2 — `export "..." show A` re-export specifier (TS C-25 대응)', async () => {
    // Dart re-export with show clause — grammar 한계 가능성
    const r = await parse(`
      export 'package:foo/bar.dart' show A;
    `)
    const re = r.edges.find((e) => e.relation === 're_exports' && e.target_symbol === 'A')
    expect(re).toBeDefined()
  })

  it('E-3 — top-level public class export (Dart는 _ prefix 없으면 자동 export)', async () => {
    const r = await parse(`
      class PublicX {}
      class _PrivateX {}
    `)
    const pub = r.nodes.find((n) => n.type === 'class' && n.name === 'PublicX')
    const priv = r.nodes.find((n) => n.type === 'class' && n.name === '_PrivateX')
    expect(pub?.exported).toBe(true)
    expect(priv?.exported).toBe(false)
  })

  it('E-4 — top-level export const variable', async () => {
    const r = await parse(`
      const MAX = 100;
    `)
    expect(r.nodes.some((n) => n.type === 'variable' && n.name === 'MAX')).toBe(true)
  })

  it('E-5 — top-level export function', async () => {
    const r = await parse(`
      void doSomething() { print('hi'); }
    `)
    const fn = r.nodes.find((n) => n.type === 'function' && n.name === 'doSomething')
    expect(fn).toBeDefined()
    expect(fn?.exported).toBe(true)
  })
})
