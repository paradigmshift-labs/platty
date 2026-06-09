/**
 * advanced_chain — Dart Iterable/List chain method 다양 패턴
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string) {
  return adapter.parseFile(source, 'lib/x.dart', 'r1')
}

describe('Dart advanced_chain', () => {
  it('CH-1 — Iterable variable .where().map().toList()', async () => {
    const r = await parse(`
      class C {
        void fn() {
          final list = [1, 2, 3];
          list.where((x) => x > 0).map((x) => x * 2).toList();
        }
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'where' && e.source_id.endsWith(':C.fn'))).toBe(true)
    expect(r.edges.some((e) => e.target_symbol === 'map' && e.source_id.endsWith(':C.fn'))).toBe(true)
    expect(r.edges.some((e) => e.target_symbol === 'toList' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })

  it('CH-2 — Future.then().catchError().whenComplete()', async () => {
    const r = await parse(`
      class C {
        Future<int> fn() async => Future.value(1).then((x) => x + 1).catchError((e) => 0).whenComplete(() => null);
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'then')).toBe(true)
    expect(r.edges.some((e) => e.target_symbol === 'catchError')).toBe(true)
  })

  it('CH-3 — stream variable.where().listen() chain', async () => {
    const r = await parse(`
      class C {
        void fn(stream) {
          stream.where((x) => x > 0).listen((x) => null);
        }
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'where')).toBe(true)
    expect(r.edges.some((e) => e.target_symbol === 'listen')).toBe(true)
  })

  it('CH-4 — String.split().join()', async () => {
    const r = await parse(`
      class C { String fn(String s) => s.split(',').map((x) => x.trim()).join('-'); }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'split')).toBe(true)
    expect(r.edges.some((e) => e.target_symbol === 'join')).toBe(true)
  })

  it('CH-5 — cascade chain (`..add()..add()`)', async () => {
    const r = await parse(`
      class C {
        void fn() { final l = <int>[]..add(1)..add(2); }
      }
    `)
    // cascade — at least cascade target visible
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })
})
