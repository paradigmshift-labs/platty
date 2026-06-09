/**
 * Dart parameters — named/required/optional/default
 * https://dart.dev/language/functions#parameters
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(s: string) { return adapter.parseFile(s, 'lib/x.dart', 'r1') }

describe('Dart parameters', () => {
  it('PA-1 — required positional only', async () => {
    const r = await parse(`
      class C { void fn(int a, String b) {} }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('PA-2 — named optional `{int? x, String s = "d"}`', async () => {
    const r = await parse(`
      class C {
        void fn({int? x, String s = 'd'}) {}
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('PA-3 — required named `{required int x}`', async () => {
    const r = await parse(`
      class C {
        void fn({required int id, required String name}) {}
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('PA-4 — optional positional `[int x = 0]`', async () => {
    const r = await parse(`
      class C { void fn(int a, [int b = 0, String? c]) {} }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('PA-5 — function-typed parameter `void Function(int) cb`', async () => {
    const r = await parse(`
      class C {
        void fn(void Function(int) cb) { cb(1); }
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('PA-6 — generic function param `<T>(T x)`', async () => {
    const r = await parse(`
      class C { T fn<T>(T x) => x; }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('PA-7 — param type → type_ref', async () => {
    const r = await parse(`
      class User {}
      class C {
        void fn(User u) {}
      }
    `)
    expect(r.edges.some((e) => e.relation === 'type_ref' && e.target_symbol === 'User' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })
})
