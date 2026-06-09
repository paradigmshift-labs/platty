/**
 * D-5: Dart factory constructor 처리 (Flutter DTO 진입점)
 *
 * factory_constructor_signature가 method_signature 안에 들어있음.
 * extractMethodSigInfo가 'function_signature'/'getter_signature'/'setter_signature'만 처리.
 * → factory_constructor_signature 분기 추가.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'
import type { CodeEdgeRaw } from '@/pipeline_modules/build_graph/types'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

function call(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.find(
    (e) => e.relation === 'calls' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

describe('D-5: factory constructor', () => {
  it('FC-1 — factory Foo.fromJson(Map m) — method node "fromJson" 발화', async () => {
    const r = await parse(`
      class Foo {
        final int x;
        Foo._internal(this.x);
        factory Foo.fromJson(Map<String, dynamic> m) => Foo._internal(m['x']);
      }
    `)
    const m = r.nodes.find((n) => n.type === 'method' && n.name === 'fromJson' && n.id.includes('Foo'))
    expect(m).toBeDefined()
  })

  it('FC-2 — factory body 안 호출 (Foo._internal) — calls edge', async () => {
    const r = await parse(`
      class Foo {
        Foo._internal();
        factory Foo.create() => Foo._internal();
      }
    `)
    const c = call(r.edges, '_internal', ':Foo.create')
    expect(c).toBeDefined()
  })

  it('FC-3 — factory param type → type_ref edge', async () => {
    const r = await parse(`
      import 'package:json/json.dart' show Map;
      class Foo {
        Foo._();
        factory Foo.fromJson(Map<String, dynamic> m) => Foo._();
      }
    `)
    // Map type_ref 발화 (formal_parameter 안 type_identifier)
    const tr = r.edges.find(
      (e) => e.relation === 'type_ref' && e.target_symbol === 'Map' && e.source_id.endsWith(':Foo.fromJson'),
    )
    expect(tr).toBeDefined()
  })

  it.skip('FC-4 — redirecting factory `factory Foo.empty() = _EmptyFoo` (LOW: function_body 없어서 현재 미처리)', async () => {
    // known limitation: redirecting factory는 function_body 없이 redirect target만 있음.
    // 현재 어댑터는 method_signature + function_body pair 처리. redirect는 별도 patten.
    // 빈도 낮아 skip. 추후 D-5b로 분리.
    const r = await parse(`
      class Foo {
        const Foo();
        const factory Foo.empty() = _EmptyFoo;
      }
      class _EmptyFoo extends Foo {
        const _EmptyFoo() : super();
      }
    `)
    const m = r.nodes.find((n) => n.type === 'method' && n.name === 'empty' && n.id.includes('Foo'))
    expect(m).toBeDefined()
  })
})
