/**
 * misc coverage — chain_call_fn_recur / annotation_guard / field_initializer / method_decorator_no_dup / method_get_set_name / library_part
 * TS 다양 small 시나리오를 한 파일에 모음 (각 영역 회귀 안전망)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string) {
  return adapter.parseFile(source, 'lib/x.dart', 'r1')
}

describe('Dart chain_call_fn_recur — 인자 안 nested 호출', () => {
  it('CR-1 — fn(other()) — nested call 둘 다 잡힘', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show outer, inner;
      class C { void fn() { outer(inner()); } }
    `)
    expect(r.edges.some((e) => e.relation === 'calls' && e.target_symbol === 'outer' && e.source_id.endsWith(':C.fn'))).toBe(true)
    expect(r.edges.some((e) => e.relation === 'calls' && e.target_symbol === 'inner' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })

  it('CR-2 — deeply nested fn(a(b(c())))', async () => {
    const r = await parse(`
      import 'package:foo/util.dart' show a, b, c;
      class C { void fn() { a(b(c())); } }
    `)
    expect(r.edges.some((e) => e.target_symbol === 'a' && e.source_id.endsWith(':C.fn'))).toBe(true)
    expect(r.edges.some((e) => e.target_symbol === 'b' && e.source_id.endsWith(':C.fn'))).toBe(true)
    expect(r.edges.some((e) => e.target_symbol === 'c' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })
})

describe('Dart annotation_guard — annotation walk no dup', () => {
  it('AG-1 — class에 multiple annotation, 중복 발화 없음', async () => {
    const r = await parse(`
      @injectable
      @lazySingleton
      class Svc {}
    `)
    const decs = r.edges.filter((e) => e.relation === 'decorates' && e.source_id.endsWith(':Svc'))
    expect(decs.length).toBe(2)
  })

  it('AG-2 — annotation 인자 안 함수 호출 시 calls/depends_on edge 발화 안 함', async () => {
    const r = await parse(`
      @Path('/users')
      class C {}
    `)
    // Path annotation의 인자 '/users' literal — calls edge 발화 X (decorates만)
    const calls = r.edges.filter((e) => e.relation === 'calls' && e.source_id.endsWith(':C'))
    expect(calls.length).toBe(0)
  })
})

describe('Dart field_initializer — 다양 RHS', () => {
  it('FI-1 — field with await initializer (anonymous fn) — function origin', async () => {
    const r = await parse(`
      class C {
        final compute = () async => 1;
      }
    `)
    const fo = r.fieldOrigins as Map<string, Map<string, any>> | undefined
    let origin: any
    for (const [k, m] of fo ?? []) if (k.endsWith(':C')) origin = m.get('compute')
    expect(origin).toEqual({ kind: 'function' })
  })

  it('FI-2 — field with conditional init `final x = cond ? a : b;` — unknown', async () => {
    const r = await parse(`
      class C {
        final x = true ? 1 : 0;
      }
    `)
    expect(r.nodes.some((n) => n.type === 'property' && n.name === 'C.x')).toBe(true)
  })
})

describe('Dart method_decorator_no_dup', () => {
  it('MD-1 — method 위 multiple annotation', async () => {
    const r = await parse(`
      class C {
        @override
        @Deprecated('use newer')
        void old() {}
      }
    `)
    const decs = r.edges.filter((e) => e.relation === 'decorates' && e.source_id.endsWith(':C.old'))
    expect(decs.length).toBe(2)
  })
})

describe('Dart method_get_set_name', () => {
  it("GS-1 — getter 'value' (이름이 흔한 단어) — get:value", async () => {
    const r = await parse(`
      class C {
        int _v = 0;
        int get value => _v;
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'get:value')).toBe(true)
  })

  it('GS-2 — getter/setter 한 쌍', async () => {
    const r = await parse(`
      class C {
        int _v = 0;
        int get count => _v;
        set count(int v) { _v = v; }
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'get:count')).toBe(true)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'set:count')).toBe(true)
  })
})

describe('Dart library_part', () => {
  it.skip('LP-1 — `part of` 다른 file body — Dart library/part 시스템 (별 milestone)', async () => {
    // Dart의 part of는 file 단위 import와 다름. 별도 처리 필요.
    const r = await parse(`
      part 'x_impl.dart';
      class X {}
    `)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'X')).toBe(true)
  })
})
