/**
 * Dart callable class — `call()` method
 * https://dart.dev/language/methods#callable-objects
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(s: string) { return adapter.parseFile(s, 'lib/x.dart', 'r1') }

describe('Dart callable class', () => {
  it('CC-1 — class with call() method', async () => {
    const r = await parse(`
      class Greeter {
        final String name;
        Greeter(this.name);
        String call(String greeting) => '\$greeting, \$name';
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'call' && n.id.includes('Greeter'))).toBe(true)
  })

  it('CC-2 — Greeter()() pattern (callable instance)', async () => {
    const r = await parse(`
      class Greeter {
        Greeter();
        void call() {}
      }
      class C {
        void fn() {
          Greeter()();
        }
      }
    `)
    // Greeter() — constructor call
    expect(r.edges.some((e) => e.target_symbol === 'Greeter' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })
})
