/**
 * D-8: Dart super constructor initializer list calls edge
 *
 * `Foo(int x) : super(x)` 또는 `Foo.alt() : super.named('hi')` 형태에서
 * initializers > initializer_list_entry 안 super 호출이 calls edge로 발화 안 됨.
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

describe('D-8: super constructor initializer list', () => {
  it('SU-1 — Foo(int x) : super(x) — super default constructor calls edge', async () => {
    const r = await parse(`
      class Base {
        Base(int x);
      }
      class Foo extends Base {
        Foo(int x) : super(x);
      }
    `)
    // super(x) → super 타입의 calls edge (target_symbol='Base'를 chain_path='super'로 또는 'super')
    // 단언: chain_path 시작이 'super'인 calls edge 1개 이상
    const superCall = r.edges.find(
      (e) => e.relation === 'calls' &&
             e.chain_path === 'super' &&
             e.source_id.endsWith(':Foo.Foo'),
    )
    expect(superCall).toBeDefined()
  })

  it('SU-2 — Foo.alt() : super.named(\'hi\') — super.named calls edge', async () => {
    const r = await parse(`
      class Base {
        Base.named(String s);
      }
      class Foo extends Base {
        Foo.alt() : super.named('hi');
      }
    `)
    const e = call(r.edges, 'named', ':Foo.Foo.alt')
    expect(e).toBeDefined()
    expect(e!.chain_path).toBe('super')
  })

  it('SU-3 — multi initializer (super + assert) — super calls edge 1개', async () => {
    const r = await parse(`
      class Base {
        Base(int x);
      }
      class Foo extends Base {
        Foo(int x) : super(x), assert(x >= 0);
      }
    `)
    const supers = r.edges.filter(
      (e) => e.relation === 'calls' &&
             e.chain_path === 'super' &&
             e.source_id.endsWith(':Foo.Foo'),
    )
    expect(supers.length).toBe(1)
  })

  it('SU-4 — constructor body 안 super.method() (initializer 아님) — 기존 동작 유지', async () => {
    const r = await parse(`
      class Base {
        void method() {}
      }
      class Foo extends Base {
        Foo() {
          super.method();
        }
      }
    `)
    // body 안 super.method() — 기존 chain 처리. super 키워드 처리 안 되면 미발화 OK
    // 회귀 안전망: 어댑터가 깨지지 않음
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'Foo')).toBe(true)
  })
})
