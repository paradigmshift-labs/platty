/**
 * D-7: Dart generic type bound `<T extends Comparable>` 처리
 *
 * type_parameters > type_parameter > type_bound > type_identifier — 현재 미발화.
 * 클래스 type_ref edge에 추가.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

describe('D-7: generic type bound', () => {
  it('GB-1 — `class Box<T extends Comparable>` — Comparable type_ref edge', async () => {
    const r = await parse(`
      class Comparable {}
      class Box<T extends Comparable> {
        T value;
        Box(this.value);
      }
    `)
    const tr = r.edges.find(
      (e) => e.relation === 'type_ref' && e.target_symbol === 'Comparable' && e.source_id.endsWith(':Box'),
    )
    expect(tr).toBeDefined()
  })

  it('GB-2 — multi bound (`<T extends A, U extends B>`) — A, B 모두 발화', async () => {
    const r = await parse(`
      class A {}
      class B {}
      class Pair<T extends A, U extends B> {}
    `)
    expect(r.edges.some((e) => e.relation === 'type_ref' && e.target_symbol === 'A' && e.source_id.endsWith(':Pair'))).toBe(true)
    expect(r.edges.some((e) => e.relation === 'type_ref' && e.target_symbol === 'B' && e.source_id.endsWith(':Pair'))).toBe(true)
  })

  it('GB-3 — generic bound + extends sibling — 둘 다 발화', async () => {
    const r = await parse(`
      class Base {}
      class A {}
      class Foo<T extends A> extends Base {}
    `)
    expect(r.edges.some((e) => e.relation === 'extends' && e.target_symbol === 'Base' && e.source_id.endsWith(':Foo'))).toBe(true)
    expect(r.edges.some((e) => e.relation === 'type_ref' && e.target_symbol === 'A' && e.source_id.endsWith(':Foo'))).toBe(true)
  })
})
