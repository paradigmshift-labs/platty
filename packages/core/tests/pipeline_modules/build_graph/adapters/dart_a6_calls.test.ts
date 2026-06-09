/**
 * a6 calls — Dart calls walk 다양 시나리오
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

function call(edges: any[], symbol: string, sourceEnds: string) {
  return edges.find((e: any) => e.relation === 'calls' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds))
}

describe('Dart a6 calls walk', () => {
  it('CA-1 — 단순 함수 호출 (import-bound) → calls edge', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show helper;
      class C { void main() { helper(); } }
    `)
    expect(call(r.edges, 'helper', ':C.main')).toBeDefined()
  })

  it('CA-2 — chain method (Iterable) → 각 hop calls edge', async () => {
    const r = await parse(`
      class C {
        void main() {
          final list = [1, 2, 3];
          list.where((x) => x > 0).map((x) => x * 2).toList();
        }
      }
    `)
    expect(call(r.edges, 'where', ':C.main')).toBeDefined()
    expect(call(r.edges, 'map', ':C.main')).toBeDefined()
    expect(call(r.edges, 'toList', ':C.main')).toBeDefined()
  })

  it('CA-3 — async/await call', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show compute;
      class C {
        Future<int> main() async {
          return await compute();
        }
      }
    `)
    expect(call(r.edges, 'compute', ':C.main')).toBeDefined()
  })

  it('CA-4 — constructor call', async () => {
    const r = await parse(`
      class Foo {}
      class C { void main() { final f = Foo(); } }
    `)
    expect(call(r.edges, 'Foo', ':C.main')).toBeDefined()
  })

  it('CA-5 — if/for/while body calls', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show doIt;
      class C {
        void main() {
          if (true) { doIt(); }
          for (var i = 0; i < 3; i++) { doIt(); }
        }
      }
    `)
    expect(call(r.edges, 'doIt', ':C.main')).toBeDefined()
  })

  it('CA-6 — try/catch/finally body calls', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show riskyOp, cleanup;
      class C {
        void main() {
          try { riskyOp(); } catch (e) { cleanup(); }
        }
      }
    `)
    expect(call(r.edges, 'riskyOp', ':C.main')).toBeDefined()
    expect(call(r.edges, 'cleanup', ':C.main')).toBeDefined()
  })

  it('CA-7 — cascade builder', async () => {
    const r = await parse(`
      class Builder { Builder add(int x) => this; }
      class C {
        void main() { final b = Builder()..add(1)..add(2); }
      }
    `)
    expect(call(r.edges, 'Builder', ':C.main')).toBeDefined()
  })

  it.skip('CA-8 — IIFE 익명 함수 (skip: grammar 한계)', async () => {
    // Dart IIFE는 grammar 처리 어려움
    const r = await parse(`
      import 'package:foo/util.dart' show doIt;
      class C { void main() { (() => doIt())(); } }
    `)
    expect(call(r.edges, 'doIt', ':C.main')).toBeDefined()
  })
})
