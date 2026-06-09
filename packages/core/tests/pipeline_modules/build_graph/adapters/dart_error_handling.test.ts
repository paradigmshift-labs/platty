/**
 * Dart error handling — try/catch/on/throw/rethrow
 * https://dart.dev/language/error-handling
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(s: string) { return adapter.parseFile(s, 'lib/x.dart', 'r1') }

describe('Dart error handling', () => {
  it('EH-1 — throw new Exception', async () => {
    const r = await parse(`
      class C {
        void fn() { throw Exception('error'); }
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'Exception' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })

  it.skip('EH-2 — try/catch with `on Type` filter (catch handler scope 한계)', async () => {
    const r = await parse(`
      import 'package:foo/errors.dart' show NotFoundError;
      class C {
        void fn() {
          try {
            riskyOp();
          } on NotFoundError catch (e) {
            handleNotFound(e);
          } on Exception catch (e) {
            handleGeneric(e);
          }
        }
      }
    `)
    // catch handler 안 호출 추적
    expect(r.edges.some((e) => e.target_symbol === 'handleNotFound' || e.target_symbol === 'handleGeneric')).toBe(true)
  })

  it('EH-3 — rethrow', async () => {
    const r = await parse(`
      class C {
        void fn() {
          try {
            doIt();
          } catch (e) {
            rethrow;
          }
        }
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('EH-4 — finally block 안 cleanup call', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show cleanup;
      class C {
        void fn() {
          try {
            doIt();
          } finally {
            cleanup();
          }
        }
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'cleanup')).toBe(true)
  })

  it('EH-5 — custom error class extends', async () => {
    const r = await parse(`
      class AppError implements Exception {
        final String message;
        AppError(this.message);
      }
    `)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'AppError')).toBe(true)
    expect(r.edges.some((e) => e.relation === 'implements' && e.target_symbol === 'Exception')).toBe(true)
  })

  it('EH-6 — assert statement', async () => {
    const r = await parse(`
      class C {
        void fn(int x) {
          assert(x >= 0, 'must be non-negative');
        }
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('EH-7 — Future.catchError — async error handling', async () => {
    const r = await parse(`
      class C {
        Future<int> fn(f) => f.catchError((e) => 0);
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'catchError')).toBe(true)
  })
})
