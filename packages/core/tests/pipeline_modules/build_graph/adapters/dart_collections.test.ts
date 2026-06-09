/**
 * Dart collection literals — spread, collection-if, collection-for
 * https://dart.dev/language/collections
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(s: string) { return adapter.parseFile(s, 'lib/x.dart', 'r1') }

describe('Dart collection literals', () => {
  it('CL-1 — spread `[...other]`', async () => {
    const r = await parse(`
      class C {
        List<int> fn(List<int> a, List<int> b) => [...a, ...b];
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('CL-2 — null-aware spread `[...?other]`', async () => {
    const r = await parse(`
      class C {
        List<int> fn(List<int>? a) => [...?a, 0];
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('CL-3 — collection-if `[if (cond) x]`', async () => {
    const r = await parse(`
      class C {
        List<int> fn(bool cond) => [if (cond) 1, 2];
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('CL-4 — collection-for `[for (var x in xs) x*2]`', async () => {
    const r = await parse(`
      class C {
        List<int> fn(List<int> xs) => [for (final x in xs) x * 2];
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it('CL-5 — Map literal with import-bound key value', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show KEY, VALUE;
      class C {
        Map<String, int> fn() => {KEY: VALUE};
      }
    `)
    expect(r.edges.some((e) => e.relation === 'depends_on' && e.target_symbol === 'KEY')).toBe(true)
    expect(r.edges.some((e) => e.relation === 'depends_on' && e.target_symbol === 'VALUE')).toBe(true)
  })

  it('CL-6 — Set literal `{1, 2, 3}`', async () => {
    const r = await parse(`
      class C {
        Set<int> fn() => {1, 2, 3};
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })
})
