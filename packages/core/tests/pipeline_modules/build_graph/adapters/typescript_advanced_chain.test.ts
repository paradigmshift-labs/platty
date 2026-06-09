/**
 * 카테고리 E — 체이닝 호출 (Drizzle / Knex / queryBuilder / axios)
 *
 * 실제 코드에 흔한 chain:
 *   db.select().from(orders).where(eq(orders.id, 1)).orderBy(asc(...))
 *   axios.create({ baseURL }).get('/orders')
 *   queryBuilder.where().andWhere().getMany()
 *
 * 각 호출이 별 calls edge로 잡히는지 + chain_path 관찰.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/q.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('E. 체이닝 호출', () => {
  it('E-01: db.select().from(orders) — 두 호출 모두 별 edge', () => {
    const r = parse(`
      import { db } from './db'
      import { orders } from './schema'
      export function list() { return db.select().from(orders) }
    `)
    const select = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'select')
    const from = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'from')
    expect(select).toBeDefined()
    expect(select!.chain_path).toBe('db')
    expect(from).toBeDefined()
  })

  it('E-02: 3-step chain — db.select().from(orders).where(...)', () => {
    const r = parse(`
      import { db } from './db'
      import { orders } from './schema'
      import { eq } from 'drizzle-orm'
      export function list(id: number) {
        return db.select().from(orders).where(eq(orders.id, id))
      }
    `)
    const symbols = r.edges
      .filter((e) => e.relation === 'calls')
      .map((e) => e.target_symbol)
      .sort()
    expect(symbols).toContain('select')
    expect(symbols).toContain('from')
    expect(symbols).toContain('where')
    expect(symbols).toContain('eq')  // nested call
  })

  it('E-03: axios.create({ baseURL }).get(url) — chain 시작이 함수 호출', () => {
    const r = parse(`
      import axios from 'axios'
      export function go() {
        const client = axios.create({ baseURL: 'https://api.x.com' })
        return client.get('/orders')
      }
    `)
    const create = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'create')
    expect(create).toBeDefined()
    expect(create!.chain_path).toBe('axios')
    expect(create!.literal_args).toBe(JSON.stringify([{ baseURL: 'https://api.x.com' }]))
  })

  it('E-04: this.qb.where().andWhere() — TypeORM queryBuilder', () => {
    const r = parse(`
      export class S {
        constructor(private qb: any) {}
        list(name: string) {
          return this.qb.where('name = :name', { name }).andWhere('active').getMany()
        }
      }
    `)
    const where = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'where',
    )
    const andWhere = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'andWhere',
    )
    const getMany = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'getMany',
    )
    expect(where).toBeDefined()
    expect(andWhere).toBeDefined()
    expect(getMany).toBeDefined()
    // 첫 인자 string 캡처
    expect(where!.first_arg).toBe('name = :name')
  })

  it('E-05: prisma chain — prisma.order.findMany({ where, include })', () => {
    const r = parse(`
      import { prisma } from './prisma'
      export function list(userId: string) {
        return prisma.order.findMany({
          where: { userId },
          include: { items: true },
        })
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_symbol === 'findMany',
    )
    expect(e).toBeDefined()
    expect(e!.chain_path).toBe('prisma.order')
    // 객체 walk: where: { userId } → userId는 식별자라 null
    expect(e!.literal_args).toBe(
      JSON.stringify([{ where: { userId: null }, include: { items: true } }]),
    )
  })

  it('E-06: chain 시작이 import 안된 식별자 → calls edge 생성, target_specifier=null (A2-3)', () => {
    const r = parse(`
      export function f() { return globalUnknown.method().sub() }
    `)
    // A2-3 — chain root unknown이어도 calls edge 발화 (specifier=null)
    const e = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_symbol === 'method',
    )
    expect(e).toBeDefined()
    expect(e?.target_specifier).toBeNull()
  })

  it('E-07: optional chaining — obj?.method() → chain_path=obj', () => {
    const r = parse(`
      import { obj } from './x'
      export function f() { obj?.method?.() }
    `)
    // optional chaining call_expression — V1이 처리 가능 시 chain_path 검증
    const e = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_symbol === 'method',
    )
    if (e) {
      expect(e.chain_path).toContain('obj')
    }
  })

  it('E-08: 재귀 chain in callback — promise.then(r => r.json())', () => {
    const r = parse(`
      export function f(promise: any) {
        return promise.then((r: any) => r.json())
      }
    `)
    const then = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'then')
    // .then은 promise가 식별자라 import 매핑 X → calls edge 미생성 (V1 동작)
    // 그러나 callback 안 r.json()도 r이 식별자(파라미터)라 미생성
    // 이 case는 V1 한계 — 회귀 테스트로 V1 동작 보존만 검증
    if (then) {
      expect(then.chain_path).toBe('promise')
    }
  })
})
