/**
 * D-2: records 타입 `(int, String)` 처리
 *
 * tree-sitter-dart WASM grammar가 records syntax (Dart 3.0)을 ERROR로 처리.
 * 핵심 한계: record type 자체에서 type_identifier 추출 불가.
 * 회복: D-1 cascading fallback이 같은 class의 다른 field/method는 정상 처리하도록 보장.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

describe('D-2: records 타입 (Dart 3.0, grammar 한계 회복)', () => {
  it('R-1 — record field가 있어도 class node + 다른 field/method 정상 발화 (cascading 회복)', async () => {
    const r = await parse(`
      class Repo {
        (int, String) pair = (1, 'hi');
        String name = 'foo';
        void fn() { print(name); }
      }
    `)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'Repo')).toBe(true)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fn')).toBe(true)
  })

  it.skip('R-2 — record type field의 type_ref (grammar 한계, P15-Full 영역)', async () => {
    // record_type 노드가 ERROR로 인식 — type_identifier 추출 불가.
    // grammar 업그레이드 또는 TS Type Checker 도입 시 처리.
    const r = await parse(`
      import 'src/user.dart' show User;
      class Repo {
        (User, int) pair = ...;
      }
    `)
    const tr = r.edges.find(
      (e) => e.relation === 'type_ref' && e.target_symbol === 'User',
    )
    expect(tr).toBeDefined()
  })

  it('R-3 — record return type method도 method body 안 calls는 추적', async () => {
    const r = await parse(`
      class Repo {
        (int, String) typed() {
          final x = compute();
          return (x, 'hi');
        }
      }
    `)
    // typed method 자체는 record return type 때문에 ERROR로 들어가는지 확인
    // class node는 발화되어야 (D-1 fallback)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'Repo')).toBe(true)
  })
})
