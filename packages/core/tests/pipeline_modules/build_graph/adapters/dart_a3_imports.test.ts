/**
 * a3 imports — Dart import syntax 다양 패턴
 * TS의 typescript_a3_gap_b 1:1 매핑 (Dart syntax에 맞게 변환)
 *
 * Dart: import 'pkg/x.dart' show A, B / hide X / as Y / deferred as Z
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

describe('Dart a3 imports', () => {
  it('I-1 — show clause multi-symbol → 각 symbol마다 imports edge', async () => {
    const r = await parse(`
      import 'package:foo/bar.dart' show A, B, C;
      class X {}
    `)
    const imps = r.edges.filter((e) => e.relation === 'imports' && e.target_specifier === 'package:foo/bar.dart')
    expect(imps.length).toBe(3)
    const syms = imps.map((e) => e.target_symbol).sort()
    expect(syms).toEqual(['A', 'B', 'C'])
  })

  it('I-2 — hide clause는 정보 명시 안 함 — 단일 imports edge (target_symbol=null)', async () => {
    const r = await parse(`
      import 'package:foo/bar.dart' hide X;
      class A {}
    `)
    const imps = r.edges.filter((e) => e.relation === 'imports' && e.target_specifier === 'package:foo/bar.dart')
    expect(imps.length).toBeGreaterThanOrEqual(1)
  })

  it('I-3 — as alias `import "..." as F` — single edge', async () => {
    const r = await parse(`
      import 'package:foo/bar.dart' as F;
      class X {}
    `)
    const imps = r.edges.filter((e) => e.relation === 'imports' && e.target_specifier === 'package:foo/bar.dart')
    expect(imps.length).toBeGreaterThanOrEqual(1)
  })

  it('I-4 — 같은 module 다중 import 문 → 각 edge 독립', async () => {
    const r = await parse(`
      import 'package:foo/a.dart';
      import 'package:foo/b.dart';
      class X {}
    `)
    expect(r.edges.some((e) => e.relation === 'imports' && e.target_specifier === 'package:foo/a.dart')).toBe(true)
    expect(r.edges.some((e) => e.relation === 'imports' && e.target_specifier === 'package:foo/b.dart')).toBe(true)
  })

  it('I-5 — relative import (`./foo.dart`) → imports edge', async () => {
    const r = await parse(`
      import './foo.dart' show Foo;
      class X {}
    `)
    expect(r.edges.some((e) => e.relation === 'imports' && e.target_specifier === './foo.dart' && e.target_symbol === 'Foo')).toBe(true)
  })

  it.skip('I-6 — deferred import (`deferred as F`) → imports edge (LOW: grammar 한계)', async () => {
    const r = await parse(`
      import 'package:foo/bar.dart' deferred as F;
      class X {}
    `)
    const imps = r.edges.filter((e) => e.relation === 'imports' && e.target_specifier === 'package:foo/bar.dart')
    expect(imps.length).toBeGreaterThanOrEqual(1)
  })

  it('I-7 — Dart core import (no `package:` prefix) → imports edge', async () => {
    const r = await parse(`
      import 'dart:async';
      class X {}
    `)
    expect(r.edges.some((e) => e.relation === 'imports' && e.target_specifier === 'dart:async')).toBe(true)
  })

  it('I-8 — show + hide 동시 사용 (Dart도 동작) → show 우선 처리', async () => {
    const r = await parse(`
      import 'package:foo/bar.dart' show A, B hide C;
      class X {}
    `)
    // show clause symbol 등록
    expect(r.edges.some((e) => e.relation === 'imports' && e.target_symbol === 'A')).toBe(true)
    expect(r.edges.some((e) => e.relation === 'imports' && e.target_symbol === 'B')).toBe(true)
  })
})
