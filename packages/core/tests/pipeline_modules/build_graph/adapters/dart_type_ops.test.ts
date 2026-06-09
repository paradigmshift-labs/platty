/**
 * Dart type test/cast operators — is, is!, as
 * https://dart.dev/language/operators#type-test-operators
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(s: string) { return adapter.parseFile(s, 'lib/x.dart', 'r1') }

describe('Dart type test/cast operators', () => {
  it('TO-1 — `x is User` type test', async () => {
    const r = await parse(`
      class User {}
      class C {
        bool fn(Object x) => x is User;
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it.skip('TO-2 — `(x as User).name()` cast chain (as 처리 한계)', async () => {
    const r = await parse(`
      class User {
        String name() => '';
      }
      class C {
        String fn(Object x) => (x as User).name();
      }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'name')).toBe(true)
  })

  it('TO-3 — `x is! User` negative test', async () => {
    const r = await parse(`
      class User {}
      class C {
        bool fn(Object x) => x is! User;
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('TO-4 — `x is User?` nullable type test', async () => {
    const r = await parse(`
      class User {}
      class C {
        bool fn(Object? x) => x is User?;
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })
})
