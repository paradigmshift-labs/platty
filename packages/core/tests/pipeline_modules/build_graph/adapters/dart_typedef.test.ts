/**
 * D-9: Dart typedef 처리 (modern + legacy)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

describe('D-9: typedef function form', () => {
  it('TD-1 — modern typedef `Callback = void Function(int)` — type node', async () => {
    const r = await parse(`typedef Callback = void Function(int x);`)
    expect(r.nodes.some((n) => n.type === 'type' && n.name === 'Callback')).toBe(true)
  })

  it('TD-2 — legacy `typedef void OldFn(int)` form', async () => {
    const r = await parse(`typedef void OldFn(int x);`)
    expect(r.nodes.some((n) => n.type === 'type' && n.name === 'OldFn')).toBe(true)
  })

  it('TD-3 — generic typedef `Predicate<T> = bool Function(T)`', async () => {
    const r = await parse(`typedef Predicate<T> = bool Function(T);`)
    expect(r.nodes.some((n) => n.type === 'type' && n.name === 'Predicate')).toBe(true)
  })
})
