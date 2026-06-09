/**
 * D2: Dart 어댑터 depends_on edge 발화 (P19 패턴 포팅)
 *
 * 1. 함수 호출 args 안 객체/배열 identifier (P19-A)
 * 2. method/function body 안 import-bound identifier reference (P19-B)
 *
 * 우선순위: 우리 graph 안 정의된 identifier는 calls/contains로 처리. import-bound만 depends_on.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'
import type { CodeEdgeRaw } from '@/pipeline_modules/build_graph/types'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

function dependsOn(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.filter(
    (e) => e.relation === 'depends_on' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

describe('D2-A: 함수 호출 args 안 identifier', () => {
  it('A1 — fn({"body": data}) — Map literal value 안 identifier → depends_on', async () => {
    const r = await parse(`
      import 'src/data.dart' show data;
      class Repo {
        void fn() {
          someFn({"body": data});
        }
      }
    `)
    expect(dependsOn(r.edges, 'data', ':Repo.fn').length).toBeGreaterThan(0)
  })

  it('A2 — fn([item, item2]) — List literal 안 identifier → depends_on', async () => {
    const r = await parse(`
      import 'src/items.dart' show item, item2;
      class Repo {
        void fn() {
          someFn([item, item2]);
        }
      }
    `)
    expect(dependsOn(r.edges, 'item', ':Repo.fn').length).toBeGreaterThan(0)
    expect(dependsOn(r.edges, 'item2', ':Repo.fn').length).toBeGreaterThan(0)
  })

  it('A3 — fn({"key": "literal"}) — primitive only → 발화 없음', async () => {
    const r = await parse(`
      class Repo {
        void fn() {
          someFn({"key": "literal", "num": 42});
        }
      }
    `)
    const dep = r.edges.filter(
      (e) => e.relation === 'depends_on' && e.source_id.endsWith(':Repo.fn'),
    )
    expect(dep.length).toBe(0)
  })
})

describe('D2-B: method/function body 안 import-bound identifier', () => {
  it('B1 — if (x > ORDER_LIMIT) — import-bound 상수 reference → depends_on', async () => {
    const r = await parse(`
      import 'src/constants.dart' show ORDER_LIMIT;
      class Repo {
        int validate(List<dynamic> orders) {
          if (orders.length > ORDER_LIMIT) throw Exception('too many');
          return ORDER_LIMIT;
        }
      }
    `)
    expect(dependsOn(r.edges, 'ORDER_LIMIT', ':Repo.validate').length).toBeGreaterThan(0)
  })

  it('B2 — return ERROR_CODES.INVALID — import-bound + property 접근 → root identifier depends_on', async () => {
    const r = await parse(`
      import 'src/errors.dart' show ERROR_CODES;
      class Repo {
        String fn() => ERROR_CODES.INVALID;
      }
    `)
    expect(dependsOn(r.edges, 'ERROR_CODES', ':Repo.fn').length).toBeGreaterThan(0)
  })

  it('B3 — local 변수 reference (import-bound 아님) → 발화 없음', async () => {
    const r = await parse(`
      class Repo {
        int fn() {
          final localVar = 42;
          return localVar;
        }
      }
    `)
    const dep = r.edges.filter(
      (e) => e.relation === 'depends_on' &&
             e.source_id.endsWith(':Repo.fn') &&
             e.target_symbol === 'localVar',
    )
    expect(dep.length).toBe(0)
  })

  it('B4 — top-level function body — import-bound identifier → depends_on', async () => {
    const r = await parse(`
      import 'src/config.dart' show MAX_RETRIES;
      int compute() {
        return MAX_RETRIES * 2;
      }
    `)
    expect(dependsOn(r.edges, 'MAX_RETRIES', ':compute').length).toBeGreaterThan(0)
  })
})

describe('D2-C: dedup — 같은 method 안 같은 identifier 여러 번 → depends_on 한 번', async () => {
  it('C1 — ORDER_LIMIT을 method 안에서 3번 사용 → depends_on 1개', async () => {
    const r = await parse(`
      import 'src/constants.dart' show ORDER_LIMIT;
      class Repo {
        int validate(List<dynamic> orders) {
          if (orders.length > ORDER_LIMIT) return -1;
          if (orders.length < ORDER_LIMIT - 10) return -2;
          return ORDER_LIMIT;
        }
      }
    `)
    expect(dependsOn(r.edges, 'ORDER_LIMIT', ':Repo.validate').length).toBe(1)
  })
})
