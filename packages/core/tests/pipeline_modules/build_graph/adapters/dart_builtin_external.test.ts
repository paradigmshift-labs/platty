/**
 * builtin_external — Dart core types method → external 분류
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string) {
  return adapter.parseFile(source, 'lib/x.dart', 'r1')
}

describe('Dart builtin_external', () => {
  it('BX-1 — List.add/.length/.where', async () => {
    const r = await parse(`
      class C {
        void fn() {
          final l = <int>[];
          l.add(1);
          l.length;
          l.where((x) => x > 0);
        }
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'add')).toBe(true)
    expect(r.edges.some((e) => e.target_symbol === 'where')).toBe(true)
  })

  it('BX-2 — Map.put/.get/.containsKey', async () => {
    const r = await parse(`
      class C {
        void fn() {
          final m = <String, int>{};
          m['x'] = 1;
          m.containsKey('x');
        }
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'containsKey')).toBe(true)
  })

  it('BX-3 — String.toUpperCase/.split', async () => {
    const r = await parse(`
      class C {
        void fn() {
          final s = 'hi';
          s.toUpperCase();
          s.split(',');
        }
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'toUpperCase')).toBe(true)
    expect(r.edges.some((e) => e.target_symbol === 'split')).toBe(true)
  })

  it('BX-4 — Future.value/.then', async () => {
    const r = await parse(`
      class C {
        Future<int> fn() => Future.value(1).then((x) => x + 1);
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'value')).toBe(true)
    expect(r.edges.some((e) => e.target_symbol === 'then')).toBe(true)
  })
})
