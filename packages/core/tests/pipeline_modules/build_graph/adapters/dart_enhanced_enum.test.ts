/**
 * Dart enhanced enum (Dart 2.17+)
 * https://dart.dev/language/enums#declaring-enhanced-enums
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(s: string) { return adapter.parseFile(s, 'lib/x.dart', 'r1') }

describe('Dart enhanced enum', () => {
  it('EE-1 — simple enum', async () => {
    const r = await parse(`
      enum Color { red, green, blue }
    `)
    expect(r.nodes.some((n) => n.type === 'enum' && n.name === 'Color')).toBe(true)
  })

  it('EE-2 — enhanced enum with method (Dart 2.17)', async () => {
    const r = await parse(`
      enum Status {
        active, inactive;
        bool get isActive => this == Status.active;
        String label() => name;
      }
    `)
    expect(r.nodes.some((n) => n.type === 'enum' && n.name === 'Status')).toBe(true)
  })

  it('EE-3 — enum with field + ctor', async () => {
    const r = await parse(`
      enum Priority {
        low(1),
        medium(2),
        high(3);
        final int value;
        const Priority(this.value);
      }
    `)
    expect(r.nodes.some((n) => n.type === 'enum' && n.name === 'Priority')).toBe(true)
  })

  it.skip('EE-4 — enum implements interface (enum implements 처리 미구현)', async () => {
    const r = await parse(`
      abstract class Comparable<T> {}
      enum Size implements Comparable<Size> {
        small, medium, large
      }
    `)
    expect(r.nodes.some((n) => n.type === 'enum' && n.name === 'Size')).toBe(true)
  })

  it.skip('EE-5 — enum with mixin (enum with 처리 미구현)', async () => {
    const r = await parse(`
      mixin Printable {}
      enum Status with Printable {
        on, off
      }
    `)
    expect(r.nodes.some((n) => n.type === 'enum' && n.name === 'Status')).toBe(true)
  })
})
