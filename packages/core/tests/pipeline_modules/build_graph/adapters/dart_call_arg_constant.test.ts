/**
 * call_arg_constant — fn(MAX_LIMIT, ERROR_CODE) import 상수 depends_on
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string) {
  return adapter.parseFile(source, 'lib/x.dart', 'r1')
}

describe('Dart call_arg_constant', () => {
  it('AC-1 — fn(IMPORTED_CONST) → depends_on', async () => {
    const r = await parse(`
      import 'package:foo/c.dart' show MAX_LIMIT;
      class C { void fn() { someFn(MAX_LIMIT); } }
    `)
    expect(r.edges.some((e) => e.relation === 'depends_on' && e.target_symbol === 'MAX_LIMIT' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })

  it('AC-2 — fn({key: IMPORTED_CONST}) Map literal value', async () => {
    const r = await parse(`
      import 'package:foo/c.dart' show ERROR_CODE;
      class C { void fn() { someFn({'code': ERROR_CODE}); } }
    `)
    expect(r.edges.some((e) => e.relation === 'depends_on' && e.target_symbol === 'ERROR_CODE' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })

  it('AC-3 — fn([IMPORTED_CONST]) List literal element', async () => {
    const r = await parse(`
      import 'package:foo/c.dart' show ITEM;
      class C { void fn() { someFn([ITEM]); } }
    `)
    expect(r.edges.some((e) => e.relation === 'depends_on' && e.target_symbol === 'ITEM' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })

  it('AC-4 — local var (non-import) reference → 발화 없음', async () => {
    const r = await parse(`
      class C { void fn() { final localVar = 1; someFn(localVar); } }
    `)
    expect(r.edges.some((e) => e.relation === 'depends_on' && e.target_symbol === 'localVar')).toBe(false)
  })
})
