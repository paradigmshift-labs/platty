/**
 * Dart const expression — const constructor, const literal
 * https://dart.dev/language/classes#constant-constructors
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(s: string) { return adapter.parseFile(s, 'lib/x.dart', 'r1') }

describe('Dart const expression', () => {
  it('CE-1 — const constructor', async () => {
    const r = await parse(`
      class Point {
        final int x;
        final int y;
        const Point(this.x, this.y);
      }
    `)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'Point')).toBe(true)
  })

  it('CE-2 — static const list/map field', async () => {
    const r = await parse(`
      class C {
        static const list = [1, 2, 3];
        static const map = {'a': 1};
      }
    `)
    expect(r.nodes.some((n) => n.type === 'property' && n.name === 'C.list')).toBe(true)
  })

  it('CE-3 — const constructor invocation', async () => {
    const r = await parse(`
      class Point {
        const Point(this.x, this.y);
        final int x;
        final int y;
      }
      class C {
        static const origin = Point(0, 0);
      }
    `)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'Point')).toBe(true)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'C')).toBe(true)
  })

  it('CE-4 — top-level const variable', async () => {
    const r = await parse(`
      const PI = 3.14;
      const NAMES = ['a', 'b'];
    `)
    expect(r.nodes.some((n) => n.type === 'variable' && n.name === 'PI')).toBe(true)
    expect(r.nodes.some((n) => n.type === 'variable' && n.name === 'NAMES')).toBe(true)
  })

  it('CE-5 — const with type annotation', async () => {
    const r = await parse(`
      const int MAX = 100;
      const String NAME = 'foo';
    `)
    expect(r.nodes.some((n) => n.type === 'variable' && n.name === 'MAX')).toBe(true)
  })
})
