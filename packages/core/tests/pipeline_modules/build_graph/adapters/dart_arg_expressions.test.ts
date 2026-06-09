/**
 * ARG-DART: Dart argExpressions 캡처 테스트
 *
 * Dart string interpolation → staticPattern + identifiers
 * 기존 first_arg / literal_args 동작 불변 검증.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart.js'

let adapter: DartParserAdapter

beforeAll(async () => {
  adapter = await DartParserAdapter.create()
})

function parse(content: string) {
  return adapter.parseFile(content, 'lib/a.dart', 'r1')
}

function getCallEdge(content: string, targetSymbol: string) {
  const r = parse(content)
  return r.edges.find((e) => e.relation === 'calls' && e.target_symbol === targetSymbol)
}

describe('ARG-DART: argExpressions 캡처', () => {
  it('ARG-DART-01: dio.get("/api/users/$id") — staticPattern=/api/users/:id', () => {
    const e = getCallEdge(
      `import 'package:dio/dio.dart' show Dio;
       class C { final Dio d; C(this.d);
         void f(int id) { d.get('/api/users/\$id'); }
       }`,
      'get',
    )
    expect(e).toBeDefined()
    // first_arg: 현재 Dart adapter는 interpolated string 포함 그대로 반환
    const exprs = e?.arg_expressions as Array<{ kind: string; staticPattern?: string; identifiers?: string[] }> | null
    expect(exprs).not.toBeNull()
    expect(exprs![0].kind).toBe('template')
    expect(exprs![0].staticPattern).toBe('/api/users/:id')
    expect(exprs![0].identifiers).toContain('id')
  })

  it('ARG-DART-02: http.get(Uri.parse("/api/users/$id")) — raw call preserved', () => {
    const e = getCallEdge(
      `import 'package:http/http.dart' show get;
       void f(int id) async { await get(Uri.parse('/api/users/\$id')); }`,
      'get',
    )
    // http.get은 Uri.parse() call_expression 인자 → argExpressions에 call 또는 null
    // first_arg는 null (string literal 아님)
    expect(e).toBeDefined()
    expect(e?.first_arg).toBeNull()
    // argExpressions: call_expression이거나 null — 어느 쪽이든 오류 없이 반환
    // (비어있을 수 있음. 핵심: 기존 edge 생성에 영향 없어야 함)
    expect(e?.relation).toBe('calls')
  })

  it('ARG-DART-03: context.go("/profile/$userId") — staticPattern=/profile/:userId', () => {
    const e = getCallEdge(
      `import 'package:go_router/go_router.dart';
       class P extends StatelessWidget {
         void f(BuildContext ctx, String userId) { ctx.go('/profile/\$userId'); }
       }`,
      'go',
    )
    expect(e).toBeDefined()
    const exprs = e?.arg_expressions as Array<{ kind: string; staticPattern?: string; identifiers?: string[] }> | null
    expect(exprs).not.toBeNull()
    expect(exprs![0].kind).toBe('template')
    expect(exprs![0].staticPattern).toBe('/profile/:userId')
    expect(exprs![0].identifiers).toContain('userId')
  })

  it('ARG-DART-04: Navigator.pushNamed(context, "/orders/$orderId") — second arg staticPattern', () => {
    const e = getCallEdge(
      `import 'package:flutter/material.dart';
       class P extends StatelessWidget {
         void f(BuildContext ctx, String orderId) {
           Navigator.pushNamed(ctx, '/orders/\$orderId');
         }
       }`,
      'pushNamed',
    )
    expect(e).toBeDefined()
    const exprs = e?.arg_expressions as Array<{ kind: string; staticPattern?: string }> | null
    // argExpressions는 모든 인자를 포함. 두 번째 인자가 template이어야 함
    const templateExpr = exprs?.find(x => x.kind === 'template')
    expect(templateExpr).toBeDefined()
    expect(templateExpr!.staticPattern).toBe('/orders/:orderId')
  })

  it('ARG-DART-05: Get.toNamed("/users/$id") — staticPattern=/users/:id', () => {
    const e = getCallEdge(
      `import 'package:get/get.dart';
       class C {
         void f(String id) { Get.toNamed('/users/\$id'); }
       }`,
      'toNamed',
    )
    expect(e).toBeDefined()
    const exprs = e?.arg_expressions as Array<{ kind: string; staticPattern?: string }> | null
    expect(exprs).not.toBeNull()
    expect(exprs![0].kind).toBe('template')
    expect(exprs![0].staticPattern).toBe('/users/:id')
  })

  it('ARG-DART-06: 기존 chain_path/first_arg 동작 불변', () => {
    // 기존 테스트와 동일한 패턴 — regression 방지
    const r = parse(
      `import 'package:dio/dio.dart' show Dio;
       class C { final Dio d; C(this.d);
         void f() { d.get('/orders'); }
       }`,
    )
    const e = r.edges.find(x => x.relation === 'calls' && x.target_symbol === 'get')
    expect(e).toBeDefined()
    expect(e?.first_arg).toBe('/orders')
    expect(e?.chain_path).toBe('d')  // this. prefix 없음 — 필드 직접 참조
  })

  it('ARG-DART-07: ${user.profile.id} 보간은 마지막 segment를 route param으로 사용하고 identifiers를 모두 보존', () => {
    const e = getCallEdge(
      `import 'package:dio/dio.dart' show Dio;
       class User { Profile profile = Profile(); }
       class Profile { String id = 'u1'; }
       class C { final Dio d; C(this.d);
         void f(User user) { d.get('/api/users/\${user.profile.id}'); }
       }`,
      'get',
    )
    const exprs = e?.arg_expressions as Array<{ kind: string; staticPattern?: string; identifiers?: string[] }> | null
    expect(exprs).not.toBeNull()
    expect(exprs![0].kind).toBe('template')
    expect(exprs![0].staticPattern).toBe('/api/users/:id')
    expect(exprs![0].identifiers).toEqual(['user', 'profile', 'id'])
  })

  it('ARG-DART-08: call/object/array/unknown 인자를 종류별로 보존한다', () => {
    const e = getCallEdge(
      `import 'package:dio/dio.dart' show Dio;
       class C { final Dio d; C(this.d);
         void f() { d.get(Uri.parse('/orders'), {'a': 1}, [1], 42); }
       }`,
      'get',
    )
    const exprs = e?.arg_expressions as Array<{ kind: string; raw: string }> | null
    expect(exprs?.map((x) => x.kind)).toEqual(['call', 'object', 'array', 'unknown'])
  })

  it('ARG-DART-09: literal_args는 floating point literal도 JSON number로 보존한다', () => {
    const e = getCallEdge(
      `import 'package:dio/dio.dart' show Dio;
       class C { final Dio d; C(this.d);
         void f() { d.get('/orders', 1.25); }
       }`,
      'get',
    )
    expect(e?.literal_args).toBe('["/orders",1.25]')
  })
})
