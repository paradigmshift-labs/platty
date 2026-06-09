/**
 * Dart null safety operators
 * https://dart.dev/null-safety
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(s: string) { return adapter.parseFile(s, 'lib/x.dart', 'r1') }

describe('Dart null safety', () => {
  it('NS-1 — nullable type field `String? name`', async () => {
    const r = await parse(`
      class C {
        String? name;
      }
    `)
    expect(r.nodes.some((n) => n.type === 'property' && n.name === 'C.name')).toBe(true)
  })

  it('NS-2 — null-aware access `?.`', async () => {
    const r = await parse(`
      class C {
        void fn(s) { s?.toUpperCase(); }
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'toUpperCase')).toBe(true)
  })

  it.skip('NS-3 — null assertion `!` (grammar 한계)', async () => {
    const r = await parse(`
      class C {
        int fn(int? x) => x!.abs();
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'abs')).toBe(true)
  })

  it('NS-4 — null coalescing `??`', async () => {
    const r = await parse(`
      class C {
        String fn(String? s) => s ?? 'default';
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('NS-5 — null-aware assignment `??=`', async () => {
    const r = await parse(`
      class C {
        void fn(Map m) { m['x'] ??= 1; }
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('NS-6 — nullable param + required', async () => {
    const r = await parse(`
      class C {
        void fn({required String? name, int age = 0}) {}
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it.skip('NS-7 — late init expression depends_on (P19 적용 영역)', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show compute;
      class C {
        late final int value = compute();
      }
    `)
    // late init expression 안 호출 추적
    expect(r.edges.some((e) => e.relation === 'depends_on' && e.target_symbol === 'compute')).toBe(true)
  })

  it('NS-8 — nullable return type `Future<int?>`', async () => {
    const r = await parse(`
      class C {
        Future<int?> fn() async => null;
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })
})
