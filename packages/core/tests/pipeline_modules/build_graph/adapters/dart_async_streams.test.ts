/**
 * Dart async / Future / Stream / async* / yield
 * https://dart.dev/language/async
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(s: string) { return adapter.parseFile(s, 'lib/x.dart', 'r1') }

describe('Dart async / Future / Stream', () => {
  it('AS-1 — async method + await call', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show fetch;
      class C {
        Future<int> getData() async {
          final v = await fetch();
          return v;
        }
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'getData' && n.is_async === true)).toBe(true)
    expect(r.edges.some((e) => e.relation === 'calls' && e.target_symbol === 'fetch')).toBe(true)
  })

  it('AS-2 — Future.then chain', async () => {
    const r = await parse(`
      class C {
        Future<int> fn() => Future.value(1).then((x) => x + 1);
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'value')).toBe(true)
    expect(r.edges.some((e) => e.target_symbol === 'then')).toBe(true)
  })

  it('AS-3 — async generator (`async*`) + yield', async () => {
    const r = await parse(`
      class C {
        Stream<int> count() async* {
          for (var i = 0; i < 3; i++) yield i;
        }
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'count')).toBe(true)
  })

  it('AS-4 — sync generator (`sync*`) + yield', async () => {
    const r = await parse(`
      class C {
        Iterable<int> seq() sync* {
          yield 1;
          yield 2;
        }
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'seq')).toBe(true)
  })

  it('AS-5 — Stream listen + cancel', async () => {
    const r = await parse(`
      class C {
        void fn(stream) {
          final sub = stream.listen((x) => null);
          sub.cancel();
        }
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'listen')).toBe(true)
    expect(r.edges.some((e) => e.target_symbol === 'cancel')).toBe(true)
  })

  it('AS-6 — Completer pattern', async () => {
    const r = await parse(`
      import 'dart:async';
      class C {
        Future<int> fn() {
          final c = Completer<int>();
          c.complete(1);
          return c.future;
        }
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'complete')).toBe(true)
  })

  it('AS-7 — await for (Stream iteration)', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show consume;
      class C {
        Future<void> fn(stream) async {
          await for (final v in stream) {
            consume(v);
          }
        }
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'consume' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })

  it('AS-8 — Future.wait multi', async () => {
    const r = await parse(`
      class C {
        Future<List<int>> fn(a, b) => Future.wait([a, b]);
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'wait')).toBe(true)
  })
})
