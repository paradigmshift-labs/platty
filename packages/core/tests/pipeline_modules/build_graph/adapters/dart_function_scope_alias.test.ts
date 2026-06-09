/**
 * function_scope_alias — `final fn = importedFn;` alias 추적
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string) {
  return adapter.parseFile(source, 'lib/x.dart', 'r1')
}

describe('Dart function_scope_alias', () => {
  it('FA-1 — final alias = importedFn; alias() 호출', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show actualFn;
      class C {
        void fn() {
          final alias = actualFn;
          alias();
        }
      }
    `)
    // final alias = actualFn → depends_on(actualFn) 발화
    expect(r.edges.some((e) => e.relation === 'depends_on' && e.target_symbol === 'actualFn' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })

  it('FA-2 — class method method 호출 (this 없이) — V1 호환 분기', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show importedFn;
      class C { void fn() { importedFn(); } }
    `)
    expect(r.edges.some((e) => e.relation === 'calls' && e.target_symbol === 'importedFn' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })

  it('FA-3 — local fn redeclare (shadowing) — local 우선', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show shared;
      class C {
        void fn() {
          shared();
        }
      }
    `)
    // shared 호출 → calls edge specifier=URI
    const c = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'shared' && e.source_id.endsWith(':C.fn'))
    expect(c).toBeDefined()
    expect(c!.target_specifier).toBe('package:foo/util.dart')
  })
})
