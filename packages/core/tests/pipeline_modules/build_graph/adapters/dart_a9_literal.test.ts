/**
 * a9 literal — Dart literal 추출 (first_arg / literal_args)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

describe('Dart a9 literal extraction', () => {
  it('LI-1 — string literal first arg → first_arg', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show someFn;
      class C { void main() { someFn('hello'); } }
    `)
    const c = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'someFn' && e.source_id.endsWith(':C.main'))
    expect(c?.first_arg).toBe('hello')
  })

  it('LI-2 — multiple string args → literal_args', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show someFn;
      class C { void main() { someFn('a', 'b'); } }
    `)
    const c = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'someFn' && e.source_id.endsWith(':C.main'))
    expect(c?.first_arg).toBe('a')
  })

  it('LI-3 — number-only args → first_arg=null', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show someFn;
      class C { void main() { someFn(42); } }
    `)
    const c = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'someFn' && e.source_id.endsWith(':C.main'))
    expect(c?.first_arg).toBeNull()
  })

  it('LI-4 — empty args call → first_arg=null', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show someFn;
      class C { void main() { someFn(); } }
    `)
    const c = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'someFn' && e.source_id.endsWith(':C.main'))
    expect(c?.first_arg).toBeNull()
  })

  it('LI-5 — interpolated string — calls edge 발화', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show someFn;
      class C {
        void main() {
          final x = 1;
          someFn('result: \$x');
        }
      }
    `)
    const c = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'someFn' && e.source_id.endsWith(':C.main'))
    expect(c).toBeDefined()
  })
})
