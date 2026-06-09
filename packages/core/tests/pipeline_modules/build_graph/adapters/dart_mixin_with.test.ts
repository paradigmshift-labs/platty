/**
 * D4: Dart `with` clause → mixes edge
 *
 * tree-sitter-dart WASM grammar에서 superclass > mixins > type_identifier 정상 파싱.
 * dart.ts L404 'grammar ERROR → skip' 주석은 outdated — 실제로는 잘 작동.
 *
 * 패턴: class S extends BaseS with M1, M2 → S가 M1/M2를 mixes edge로 연결
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'
import type { CodeEdgeRaw } from '@/pipeline_modules/build_graph/types'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

function mixesOf(edges: CodeEdgeRaw[], symbol: string, sourceClassEnds: string) {
  return edges.filter(
    (e) => e.relation === 'mixes' && e.target_symbol === symbol && e.source_id.endsWith(sourceClassEnds),
  )
}

describe('D4: with clause → mixes edge', () => {
  it('M1 — extends + with single mixin → extends + mixes 1개', async () => {
    const r = await parse(`
      class S extends BaseS with M1 {}
    `)
    expect(mixesOf(r.edges, 'M1', ':S').length).toBe(1)
    // extends edge도 그대로 발화되어야 (회귀 방지)
    const ex = r.edges.filter(
      (e) => e.relation === 'extends' && e.target_symbol === 'BaseS' && e.source_id.endsWith(':S'),
    )
    expect(ex.length).toBe(1)
  })

  it('M2 — multiple mixins (with M1, M2, M3) → 각각 mixes edge', async () => {
    const r = await parse(`
      class S with M1, M2, M3 {}
    `)
    expect(mixesOf(r.edges, 'M1', ':S').length).toBe(1)
    expect(mixesOf(r.edges, 'M2', ':S').length).toBe(1)
    expect(mixesOf(r.edges, 'M3', ':S').length).toBe(1)
  })

  it('M3 — extends + with + implements 모두 함께', async () => {
    const r = await parse(`
      class S extends BaseS with M1 implements I1 {}
    `)
    expect(mixesOf(r.edges, 'M1', ':S').length).toBe(1)
    const ex = r.edges.filter(
      (e) => e.relation === 'extends' && e.target_symbol === 'BaseS' && e.source_id.endsWith(':S'),
    )
    expect(ex.length).toBe(1)
    const im = r.edges.filter(
      (e) => e.relation === 'implements' && e.target_symbol === 'I1' && e.source_id.endsWith(':S'),
    )
    expect(im.length).toBe(1)
  })

  it('M4 — 우리 graph 안 mixin (같은 file 정의) — specifier=null', async () => {
    const r = await parse(`
      mixin M1 {}
      class S with M1 {}
    `)
    const m = mixesOf(r.edges, 'M1', ':S')
    expect(m.length).toBe(1)
    expect(m[0].target_specifier).toBeNull()
  })

  it('M5 — import한 mixin — specifier=URI', async () => {
    const r = await parse(`
      import 'package:flutter/widgets.dart' show WidgetsBindingObserver;
      class S with WidgetsBindingObserver {}
    `)
    const m = mixesOf(r.edges, 'WidgetsBindingObserver', ':S')
    expect(m.length).toBe(1)
    expect(m[0].target_specifier).toBe('package:flutter/widgets.dart')
  })

  it('M6 — with 없는 평범한 class → mixes edge 없음', async () => {
    const r = await parse(`
      class S extends BaseS {}
    `)
    const m = r.edges.filter((e) => e.relation === 'mixes' && e.source_id.endsWith(':S'))
    expect(m.length).toBe(0)
  })
})
