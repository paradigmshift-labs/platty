/**
 * P19: 비엔나 소시지 reachability 강화
 *
 * 2. body identifier — 함수 호출 인자 안 객체/배열의 identifier 추적
 *    (예: `axios.post('/orders', { body: orderData })` → orderData를 depends_on으로)
 *
 * 5. import-bound 상수 read — method body 안 import-bound identifier reference 추적
 *    (예: `if (x > ORDER_LIMIT)` → ORDER_LIMIT을 depends_on으로)
 *
 * 둘 다 'depends_on' relation으로 통합 (의미 동일: 노드가 다른 노드를 reference).
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import type { CodeEdgeRaw } from '@/pipeline_modules/build_graph/types'

interface ParseRes {
  edges: CodeEdgeRaw[]
}

async function parse(source: string, filePath = 'src/x.ts'): Promise<ParseRes> {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(source, filePath, 'r1')
}

function dependsOn(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.filter(
    (e) =>
      e.relation === 'depends_on' &&
      e.target_symbol === symbol &&
      e.source_id.endsWith(sourceEnds),
  )
}

describe('P19-A: 함수 호출 인자 안 객체/배열 identifier 추적', () => {
  it('A1 — fn({ body: data }) — 객체 property value의 identifier → depends_on', async () => {
    const r = await parse(`
      import { data } from './data'
      export class Repo {
        fn() { someFn({ body: data }) }
      }
    `)
    expect(dependsOn(r.edges, 'data', ':Repo.fn').length).toBeGreaterThan(0)
  })

  it('A2 — fn({ user, orders }) — shorthand property → 각각 depends_on', async () => {
    const r = await parse(`
      import { user } from './user'
      import { orders } from './orders'
      export class Repo {
        fn() { someFn({ user, orders }) }
      }
    `)
    expect(dependsOn(r.edges, 'user', ':Repo.fn').length).toBeGreaterThan(0)
    expect(dependsOn(r.edges, 'orders', ':Repo.fn').length).toBeGreaterThan(0)
  })

  it('A3 — fn({ nested: { inner: data } }) — 중첩 객체 안 identifier → depends_on', async () => {
    const r = await parse(`
      import { data } from './data'
      export class Repo {
        fn() { someFn({ outer: { inner: data } }) }
      }
    `)
    expect(dependsOn(r.edges, 'data', ':Repo.fn').length).toBeGreaterThan(0)
  })

  it('A4 — fn([item, item2]) — 배열 안 identifier → depends_on', async () => {
    const r = await parse(`
      import { item, item2 } from './items'
      export class Repo {
        fn() { someFn([item, item2]) }
      }
    `)
    expect(dependsOn(r.edges, 'item', ':Repo.fn').length).toBeGreaterThan(0)
    expect(dependsOn(r.edges, 'item2', ':Repo.fn').length).toBeGreaterThan(0)
  })

  it('A5 — fn({ key: "literal" }) — primitive only → 발화 없음', async () => {
    const r = await parse(`
      export class Repo {
        fn() { someFn({ key: 'literal', num: 42, flag: true }) }
      }
    `)
    // 'key', 'num', 'flag' 같은 property name은 식별자가 아님 — depends_on 발화 없어야
    const dep = r.edges.filter(
      (e) => e.relation === 'depends_on' && e.source_id.endsWith(':Repo.fn'),
    )
    expect(dep.length).toBe(0)
  })
})

describe('P19-B: method body 안 import-bound 상수 reference', () => {
  it('B1 — if (x > ORDER_LIMIT) — import-bound 상수 reference → depends_on', async () => {
    const r = await parse(`
      import { ORDER_LIMIT } from './constants'
      export class Repo {
        validate(orders: any[]) {
          if (orders.length > ORDER_LIMIT) throw new Error('too many')
          return ORDER_LIMIT
        }
      }
    `)
    expect(dependsOn(r.edges, 'ORDER_LIMIT', ':Repo.validate').length).toBeGreaterThan(0)
  })

  it('B2 — return ERROR_CODES.INVALID — import-bound + property 접근 → root identifier depends_on', async () => {
    const r = await parse(`
      import { ERROR_CODES } from './errors'
      export class Repo {
        fn() { return ERROR_CODES.INVALID }
      }
    `)
    expect(dependsOn(r.edges, 'ERROR_CODES', ':Repo.fn').length).toBeGreaterThan(0)
  })

  it('B3 — function body 안 import-bound identifier → depends_on', async () => {
    const r = await parse(`
      import { MAX_RETRIES } from './config'
      export function fn() {
        const limit = MAX_RETRIES
        return limit
      }
    `)
    // function 노드 source_id ends with ':fn' (top-level fn name)
    expect(dependsOn(r.edges, 'MAX_RETRIES', ':fn').length).toBeGreaterThan(0)
  })

  it('B4 — local 변수 reference (import-bound 아님) → 발화 없음', async () => {
    // import-bound가 아닌 단순 local var는 depends_on 발화 안 함 (false positive 방지)
    const r = await parse(`
      export class Repo {
        fn() {
          const localVar = 42
          return localVar
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
})
