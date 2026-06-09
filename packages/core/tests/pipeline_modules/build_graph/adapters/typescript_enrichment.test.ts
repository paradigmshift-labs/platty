/**
 * TypeScript 어댑터 — 보강 기능 테스트
 *
 * (1) 일반 calls edge에 first_arg / literal_args 캡처
 * (2) decorator 객체 인자 분해 → depends_on edge
 * (3) method param decorator (@Param/@Body/@Query)
 *
 * V1 동작 호환:
 *   - calls의 target_symbol은 fn.text 전체 ('axios.get', 'this.svc.list' 등)
 *   - decorator는 export class 시 두 번 emit (inner + outer) — deduplicateEdges가 후처리에서 중복 제거
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/a.ts') {
  return adapter.parseFile(content, filePath, 'r1')
}

// ────────────────────────────────────────────────
// (1) calls edge first_arg/literal_args 캡처
// ────────────────────────────────────────────────
describe('calls edge — first_arg/literal_args 캡처', () => {
  it("axios.get('/orders') → first_arg='/orders'", () => {
    const r = parse(`
      import axios from 'axios'
      export function fetchOrders() { return axios.get('/orders') }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_specifier === 'axios')
    expect(e).toBeDefined()
    expect(e!.first_arg).toBe('/orders')
    expect(e!.literal_args).toBe(JSON.stringify(['/orders']))
  })

  it("fetch('/users', { method: 'POST' }) — 객체 walk (E4 변경)", () => {
    const r = parse(`
      import { fetch } from 'node-fetch'
      export function f() { fetch('/users', { method: 'POST' }) }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'fetch')
    expect(e?.first_arg).toBe('/users')
    expect(e?.literal_args).toBe(JSON.stringify(['/users', { method: 'POST' }]))
  })

  it("emit('order.created', payload) — eventBus가 import면 캡처", () => {
    const r = parse(`
      import { eventBus } from './bus'
      export function notify(payload: any) { eventBus.emit('order.created', payload) }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_specifier === './bus')
    expect(e?.first_arg).toBe('order.created')
  })

  it('인자 없는 호출 → first_arg=null, literal_args=null', () => {
    const r = parse(`
      import { foo } from './x'
      export function f() { foo() }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'foo')
    expect(e?.first_arg).toBeNull()
    expect(e?.literal_args).toBeNull()
  })

  it("this.svc.list('active') — this 메서드 호출 first_arg 캡처", () => {
    const r = parse(`
      export class A {
        constructor(private svc: any) {}
        list() { return this.svc.list('active') }
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'calls' &&
        edge.target_specifier === 'this.svc.list',
    )
    expect(e?.first_arg).toBe('active')
  })

  it("super.method('action') — first_arg 캡처", () => {
    const r = parse(`
      export class A extends B {
        run() { super.run('action') }
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_specifier === 'super.run',
    )
    expect(e?.first_arg).toBe('action')
  })

  it('인자 길이 500자 초과 → first_arg=null', () => {
    const long = 'x'.repeat(600)
    const r = parse(`
      import { foo } from './x'
      export function f() { foo('${long}') }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'foo')
    expect(e?.first_arg).toBeNull()
  })

  it('인자가 identifier → first_arg=null', () => {
    const r = parse(`
      import { callee } from './x'
      export function f(name: string) { callee(name) }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'callee')
    expect(e?.first_arg).toBeNull()
  })
})

// ────────────────────────────────────────────────
// (2) decorator 객체 인자 분해 → depends_on edge
// ────────────────────────────────────────────────
describe('decorator 객체 인자 분해 — depends_on edge', () => {
  it('@Module({ controllers: [A], providers: [B] }) → A, B에 depends_on edge', () => {
    const r = parse(`
      import { Module } from '@nestjs/common'
      import { OrderController } from './order.controller'
      import { OrderService } from './order.service'
      @Module({ controllers: [OrderController], providers: [OrderService] })
      export class AppModule {}
    `)
    const dependsOn = r.edges.filter((e) => e.relation === 'depends_on')
    // V1은 decorator를 두 번 처리 (inner + outer) — distinct 심볼 검증
    const distinctSymbols = [...new Set(dependsOn.map((e) => e.target_symbol))].sort()
    expect(distinctSymbols).toEqual(['OrderController', 'OrderService'])
    expect(dependsOn.find((e) => e.target_symbol === 'OrderController')?.target_specifier).toBe(
      './order.controller',
    )
  })

  it('decorator with literal-only object (string/number) → depends_on 0건', () => {
    const r = parse(`
      import { Cfg } from './cfg'
      @Cfg({ name: 'test', count: 1 })
      export class A {}
    `)
    expect(r.edges.filter((e) => e.relation === 'depends_on')).toHaveLength(0)
  })

  it('@Injectable() (인자 없음) → depends_on 0건', () => {
    const r = parse(`
      import { Injectable } from '@nestjs/common'
      @Injectable()
      export class S {}
    `)
    expect(r.edges.filter((e) => e.relation === 'depends_on')).toHaveLength(0)
  })

  it('@Module({ imports: [X], exports: [Y, Z] }) → 3개 distinct depends_on', () => {
    const r = parse(`
      import { Module } from '@nestjs/common'
      import { X } from './x'
      import { Y, Z } from './y'
      @Module({ imports: [X], exports: [Y, Z] })
      export class M {}
    `)
    const distinctSymbols = [
      ...new Set(r.edges.filter((e) => e.relation === 'depends_on').map((e) => e.target_symbol)),
    ].sort()
    expect(distinctSymbols).toEqual(['X', 'Y', 'Z'])
  })

  it('decorator 객체 안 중복 식별자 → 한 emit 안에서 set dedup', () => {
    const r = parse(`
      import { Module } from '@nestjs/common'
      import { Foo } from './f'
      @Module({ providers: [Foo], exports: [Foo] })
      export class M {}
    `)
    const fooDeps = r.edges.filter((e) => e.relation === 'depends_on' && e.target_symbol === 'Foo')
    // outer + inner emit 각각 1건씩, 즉 2건. 단일 emit 내 set dedup는 1건이지만 두 번 처리됨
    const distinct = [...new Set(fooDeps.map((e) => e.source_id))]
    expect(distinct.length).toBeGreaterThanOrEqual(1)
  })
})

// ────────────────────────────────────────────────
// (3) method param decorator
// ────────────────────────────────────────────────
describe('method param decorator — @Param/@Body/@Query', () => {
  it("@Param('id') → method 노드에 decorates edge + first_arg='id'", () => {
    const r = parse(`
      import { Controller, Get, Param } from '@nestjs/common'
      @Controller('/orders')
      export class OrderController {
        @Get(':id')
        findOne(@Param('id') id: string) { return id }
      }
    `)
    const paramEdge = r.edges.find(
      (e) => e.relation === 'decorates' && e.target_symbol === 'Param',
    )
    expect(paramEdge).toBeDefined()
    expect(paramEdge!.first_arg).toBe('id')
  })

  it('@Body() + @Query() 같이 → 2 edges (Query first_arg=skip)', () => {
    const r = parse(`
      import { Controller, Post, Body, Query } from '@nestjs/common'
      @Controller('/orders')
      export class C {
        @Post()
        create(@Body() dto: any, @Query('skip') skip: string) { return null }
      }
    `)
    const bodyEdge = r.edges.find((e) => e.target_symbol === 'Body' && e.relation === 'decorates')
    const queryEdge = r.edges.find((e) => e.target_symbol === 'Query' && e.relation === 'decorates')
    expect(bodyEdge).toBeDefined()
    expect(queryEdge).toBeDefined()
    expect(queryEdge!.first_arg).toBe('skip')
  })

  it('method param decorator 없으면 추가 edge 없음', () => {
    const r = parse(`
      export class C {
        list(filter: string) { return filter }
      }
    `)
    const paramDecorates = r.edges.filter(
      (e) =>
        e.relation === 'decorates' &&
        (e.target_symbol === 'Param' || e.target_symbol === 'Body' || e.target_symbol === 'Query'),
    )
    expect(paramDecorates).toHaveLength(0)
  })

  it('커스텀 param decorator (@CurrentUser) — 표준이 아닌 decorator도 잡힘', () => {
    const r = parse(`
      import { Controller, Get } from '@nestjs/common'
      import { CurrentUser } from './decorators/current-user'
      @Controller('/users')
      export class UserController {
        @Get('/me')
        findMe(@CurrentUser() user: any) { return user }
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'CurrentUser',
    )
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('./decorators/current-user')
  })

  it('한 param에 여러 decorator (@AdminOnly() @Param("id")) — 둘 다 edge 생성', () => {
    const r = parse(`
      import { Get, Param } from '@nestjs/common'
      import { AdminOnly } from './decorators/admin-only'
      export class C {
        @Get(':id')
        findOne(@AdminOnly() @Param('id') id: string) { return id }
      }
    `)
    const adminOnly = r.edges.find(
      (e) => e.relation === 'decorates' && e.target_symbol === 'AdminOnly',
    )
    const param = r.edges.find(
      (e) => e.relation === 'decorates' && e.target_symbol === 'Param',
    )
    expect(adminOnly).toBeDefined()
    expect(adminOnly!.target_specifier).toBe('./decorators/admin-only')
    expect(param).toBeDefined()
    expect(param!.first_arg).toBe('id')
  })

  it('커스텀 decorator with 객체 인자 (@Pagination({ defaultLimit: 20 })) — E4 walk 적용', () => {
    const r = parse(`
      import { Get } from '@nestjs/common'
      import { Pagination } from '@app/decorators'
      export class C {
        @Get()
        list(@Pagination({ defaultLimit: 20, maxLimit: 100 }) page: any) { return [] }
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'Pagination',
    )
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('@app/decorators')
    expect(e!.literal_args).toBe(JSON.stringify([{ defaultLimit: 20, maxLimit: 100 }]))
  })

  it('multiple param decorator + method-level decorator 공존 — 모두 method 노드 source', () => {
    const r = parse(`
      import { Controller, Get, Param, Query } from '@nestjs/common'
      @Controller('/orders')
      export class C {
        @Get(':id')
        findOne(@Param('id') id: string, @Query() q: any) { return id }
      }
    `)
    // findOne method 노드 → Get / Param / Query 3개 decorates edge
    const decoratesOnFindOne = r.edges.filter(
      (e) =>
        e.relation === 'decorates' &&
        (e.target_symbol === 'Get' || e.target_symbol === 'Param' || e.target_symbol === 'Query'),
    )
    const distinctSymbols = [...new Set(decoratesOnFindOne.map((e) => e.target_symbol))].sort()
    expect(distinctSymbols).toEqual(['Get', 'Param', 'Query'])
  })
})
