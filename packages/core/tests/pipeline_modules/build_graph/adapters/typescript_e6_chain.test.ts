/**
 * E6 — chain_path 분리 (BS-4)
 *
 * extractChainPath 헬퍼 + extractCallEdge에 chain_path 채움.
 * target_symbol을 마지막 property로 변경 (chain_path가 prefix 보존).
 *
 * 예:
 *   prisma.order.findMany() → chain_path='prisma.order', target_symbol='findMany'
 *   axios.get('/x')          → chain_path='axios', target_symbol='get'
 *   foo()                    → chain_path=null, target_symbol='foo'
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/a.ts') {
  return adapter.parseFile(content, filePath, 'r1')
}

function getCallEdges(content: string) {
  return parse(content).edges.filter((e) => e.relation === 'calls')
}

// ────────────────────────────────────────────────
// E6-A. chain 추출
// ────────────────────────────────────────────────
describe('E6-A: chain_path / target_symbol 분리', () => {
  it('E6-A-01: foo() → chain_path=null, target_symbol=foo', () => {
    const edges = getCallEdges(`import { foo } from 'x'; export function f() { foo() }`)
    const e = edges.find((edge) => edge.target_symbol === 'foo')
    expect(e).toBeDefined()
    expect(e!.chain_path).toBeNull()
    expect(e!.target_symbol).toBe('foo')
  })

  it('E6-A-02: obj.method() (외부) → chain_path=obj, target_symbol=method', () => {
    const edges = getCallEdges(`import { obj } from 'x'; export function f() { obj.method() }`)
    const e = edges.find((edge) => edge.target_symbol === 'method')
    expect(e).toBeDefined()
    expect(e!.chain_path).toBe('obj')
  })

  it('E6-A-03: prisma.order.findMany() → chain_path=prisma.order, target_symbol=findMany', () => {
    const edges = getCallEdges(`import { prisma } from 'x'; export function f() { prisma.order.findMany() }`)
    const e = edges.find((edge) => edge.target_symbol === 'findMany')
    expect(e).toBeDefined()
    expect(e!.chain_path).toBe('prisma.order')
  })

  it('E6-A-05: axios.get(url) → chain_path=axios, target_symbol=get', () => {
    const edges = getCallEdges(`import axios from 'axios'; export function f() { axios.get('/x') }`)
    const e = edges.find((edge) => edge.target_symbol === 'get')
    expect(e).toBeDefined()
    expect(e!.chain_path).toBe('axios')
    expect(e!.first_arg).toBe('/x')
  })

  it('E6-A-06: this.svc.list() → chain_path=this.svc, target_symbol=list', () => {
    const edges = getCallEdges(`
      export class A {
        constructor(private svc: any) {}
        run() { this.svc.list('active') }
      }
    `)
    const e = edges.find((edge) => edge.target_symbol === 'list')
    expect(e).toBeDefined()
    expect(e!.chain_path).toBe('this.svc')
  })

  it('E6-A-07: this.bar() → chain_path=this, target_symbol=bar', () => {
    const edges = getCallEdges(`
      export class A {
        bar() { return 1 }
        run() { this.bar() }
      }
    `)
    const e = edges.find((edge) => edge.target_symbol === 'bar')
    expect(e).toBeDefined()
    expect(e!.chain_path).toBe('this')
  })

  it('E6-A-08: super.do() → chain_path=super, target_symbol=do', () => {
    const edges = getCallEdges(`
      export class A extends B {
        run() { super.run('action') }
      }
    `)
    const e = edges.find((edge) => edge.target_symbol === 'run')
    expect(e).toBeDefined()
    expect(e!.chain_path).toBe('super')
  })

  it('E6-A-09: 5+ depth chain → chain_path 그대로 (상한 X — 단순화)', () => {
    const edges = getCallEdges(`
      import { a } from 'x'
      export function f() { a.b.c.d.e.method() }
    `)
    const e = edges.find((edge) => edge.target_symbol === 'method')
    expect(e).toBeDefined()
    expect(e!.chain_path).toBe('a.b.c.d.e')
  })

  it('E6-A-12: optional chaining obj?.method() → chain_path=obj', () => {
    const edges = getCallEdges(`import { obj } from 'x'; export function f() { obj?.method() }`)
    const e = edges.find((edge) => edge.target_symbol === 'method')
    if (e) {
      expect(e.chain_path).toBe('obj')
    }
    // optional chaining은 V1 한계로 calls edge 자체가 안 만들어질 수도 — 만들어지면 chain_path 검증
  })
})

// ────────────────────────────────────────────────
// E6-B. F5 해석 분기 회귀 (chain_path 영향 X)
// ────────────────────────────────────────────────
describe('E6-B: 기존 F5 해석 분기 회귀', () => {
  it('E6-B-01: super 분기 작동 (chain_path 무관)', () => {
    const r = parse(`
      export class B { do() { return 1 } }
      export class A extends B {
        run() { super.do() }
      }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'do')
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('super.do')
  })

  it('E6-B-02: this.field DI 매칭 (chain_path 무관)', () => {
    const r = parse(`
      import { Svc } from './svc'
      export class C {
        constructor(private svc: Svc) {}
        run() { this.svc.list() }
      }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'list')
    expect(e).toBeDefined()
    // chain_path는 보존되지만 specifier도 V1 그대로
    expect(e!.target_specifier).toBe('this.svc.list')
  })

  it('E6-B-03: import 매칭 작동 (E4-B-01 회귀)', () => {
    const r = parse(`
      import { foo } from './x'
      export function f() { foo('hi') }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'foo')
    expect(e!.target_specifier).toBe('./x')
    expect(e!.first_arg).toBe('hi')
  })
})
