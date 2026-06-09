/**
 * D-3: pattern matching switch expression (Dart 3.0)
 *
 * tree-sitter-dart WASM grammar가 `switch (v) { ... }` 자체를 multiplicative_expression
 * (switch=identifier + selector(arg) + set_or_map_literal)로 잘못 처리.
 * → switch arms의 arrow 패턴은 ERROR로 들어가지만 인접 expression(string_literal 등)은 보존.
 * 한계: switch expression 의미 추적 불가. method 자체 + 다른 calls는 정상 처리.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

describe('D-3: pattern matching switch expression (grammar 한계 회복)', () => {
  it('PM-1 — switch expression 있는 method도 method node 발화', async () => {
    const r = await parse(`
      class Repo {
        String label(int v) {
          return switch (v) {
            0 => 'zero',
            int i when i > 0 => 'positive',
            _ => 'other',
          };
        }
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'label')).toBe(true)
  })

  it.skip('PM-2 — switch expression 옆 method body 안 다른 호출 추적 (grammar cascading 한계)', async () => {
    // switch expression이 method body 전체를 misparse — 인접 statement의 calls도 walk 안 됨.
    // 실측: `final x = compute(v); return switch (x) { ... };` — compute 발화 안 됨.
    // 우회: switch arms를 별도 method로 분리 (의도된 변경 권장) 또는 grammar 업그레이드 대기.
    const r = await parse(`
      class Repo {
        int compute(int v) { return v + 1; }
        String label(int v) {
          final x = compute(v);
          return switch (x) {
            0 => 'zero',
            _ => 'other',
          };
        }
      }
    `)
    const cm = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'compute' && e.source_id.endsWith(':Repo.label'),
    )
    expect(cm).toBeDefined()
  })

  it.skip('PM-3 — switch arm 안 호출 추적 (grammar 한계, 별 milestone)', async () => {
    // switch arms은 ERROR로 인식되어 그 안 호출은 calls walk가 들어가지 못함.
    const r = await parse(`
      class Repo {
        String process(int v) {
          return switch (v) {
            0 => zeroHandler(),
            _ => otherHandler(),
          };
        }
      }
    `)
    const cm = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'zeroHandler',
    )
    expect(cm).toBeDefined()
  })
})
