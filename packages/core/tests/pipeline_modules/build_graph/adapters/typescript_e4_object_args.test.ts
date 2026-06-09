/**
 * E4 — 객체 인자 walk (BS-1)
 *
 * extractObjectLiteralArg 헬퍼 + extractCallArgs 보강:
 *   - 객체 안 string/number/boolean property → 그대로 보존
 *   - 식별자/template/computed/spread → null
 *   - 1-depth nested 객체 walk (depth 한도 = 2)
 *   - 깊이 2 초과 → null
 *   - 배열도 walk
 *   - length 상한, NUL 바이트 처리
 *
 * SOT: specs/build_graph/architecture.md §0 + build-graph-coverage.md BS-1
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/a.ts') {
  return adapter.parseFile(content, filePath, 'r1')
}

function getCallEdge(content: string, targetSymbolOrChain: string) {
  // E6: target_symbol은 마지막 property만. chain_path가 prefix.
  // 매칭: 'fetch' or 'axios.post' or 'eventBus.emit' 등 입력 시
  //   - '.' 포함 → chain.prop 형태로 분해해 chain_path/target_symbol 매칭
  //   - 없으면 target_symbol만 매칭
  const r = parse(content)
  if (targetSymbolOrChain.includes('.')) {
    const idx = targetSymbolOrChain.lastIndexOf('.')
    const chain = targetSymbolOrChain.slice(0, idx)
    const sym = targetSymbolOrChain.slice(idx + 1)
    return r.edges.find(
      (e) => e.relation === 'calls' && e.chain_path === chain && e.target_symbol === sym,
    )
  }
  return r.edges.find((e) => e.relation === 'calls' && e.target_symbol === targetSymbolOrChain)
}

// ────────────────────────────────────────────────
// E4-A. extractObjectLiteralArg 단위 (객체 안 property walk)
// ────────────────────────────────────────────────
describe('E4-A: 객체 인자 walk — property별', () => {
  it('E4-A-01: { method: "POST" } → {method:"POST"}', () => {
    const e = getCallEdge(`import { fetch } from 'x'; export function f() { fetch('/a', { method: 'POST' }) }`, 'fetch')
    expect(e?.literal_args).toBe(JSON.stringify(['/a', { method: 'POST' }]))
  })

  it('E4-A-02: 다중 string property', () => {
    const e = getCallEdge(`import { fetch } from 'x'; export function f() { fetch('/a', { method: 'POST', url: '/x' }) }`, 'fetch')
    expect(e?.literal_args).toBe(JSON.stringify(['/a', { method: 'POST', url: '/x' }]))
  })

  it('E4-A-03: number/boolean property → 그대로 보존', () => {
    const e = getCallEdge(`import { cfg } from 'x'; export function f() { cfg({ retry: true, timeout: 5000, debug: false }) }`, 'cfg')
    expect(e?.literal_args).toBe(JSON.stringify([{ retry: true, timeout: 5000, debug: false }]))
  })

  it('E4-A-04: null literal → null', () => {
    const e = getCallEdge(`import { cfg } from 'x'; export function f() { cfg({ data: null }) }`, 'cfg')
    expect(e?.literal_args).toBe(JSON.stringify([{ data: null }]))
  })

  it('E4-A-05: 식별자 value → null', () => {
    const e = getCallEdge(`import { post } from 'x'; export function f(orderData: any) { post('/x', { body: orderData }) }`, 'post')
    expect(e?.literal_args).toBe(JSON.stringify(['/x', { body: null }]))
  })

  it('E4-A-06: 1-depth nested 객체 walk', () => {
    const e = getCallEdge(`import { fetch } from 'x'; export function f() { fetch('/a', { headers: { 'X-Auth': 'token' } }) }`, 'fetch')
    expect(e?.literal_args).toBe(JSON.stringify(['/a', { headers: { 'X-Auth': 'token' } }]))
  })

  it('E4-A-07: 2-depth 초과 → null (깊이 한도)', () => {
    const e = getCallEdge(`import { f } from 'x'; export function g() { f({ a: { b: { c: 1 } } }) }`, 'f')
    expect(e?.literal_args).toBe(JSON.stringify([{ a: { b: null } }]))
  })

  it('E4-A-08: 배열 string literal → 보존', () => {
    const e = getCallEdge(`import { f } from 'x'; export function g() { f({ items: ['a', 'b'] }) }`, 'f')
    expect(e?.literal_args).toBe(JSON.stringify([{ items: ['a', 'b'] }]))
  })

  it('E4-A-09: 배열 mixed (string + 식별자) → 식별자만 null', () => {
    const e = getCallEdge(`import { f } from 'x'; export function g(v: any) { f({ items: ['a', v] }) }`, 'f')
    expect(e?.literal_args).toBe(JSON.stringify([{ items: ['a', null] }]))
  })

  it('E4-A-10: spread {...x} → spread는 무시', () => {
    const e = getCallEdge(`import { f } from 'x'; export function g(o: any) { f({ ...o, name: 'x' }) }`, 'f')
    // spread는 결과에 포함 X. name은 보존.
    expect(e?.literal_args).toBe(JSON.stringify([{ name: 'x' }]))
  })

  it('E4-A-11: computed key { [k]: "v" } → 무시', () => {
    const e = getCallEdge(`import { f } from 'x'; export function g(k: string) { f({ [k]: 'v', name: 'a' }) }`, 'f')
    expect(e?.literal_args).toBe(JSON.stringify([{ name: 'a' }]))
  })

  it('E4-A-12: template literal value → null', () => {
    const e = getCallEdge('import { f } from "x"; export function g(x: string) { f({ method: `GET ${x}` }) }', 'f')
    expect(e?.literal_args).toBe(JSON.stringify([{ method: null }]))
  })

  it('E4-A-13: 빈 객체 {} → {}', () => {
    const e = getCallEdge(`import { f } from 'x'; export function g() { f({}) }`, 'f')
    expect(e?.literal_args).toBe(JSON.stringify([{}]))
  })

  it('E4-A-14: shorthand { x } → {x:null} (식별자 reference라 null)', () => {
    const e = getCallEdge(`import { f } from 'x'; export function g(x: string) { f({ x }) }`, 'f')
    expect(e?.literal_args).toBe(JSON.stringify([{ x: null }]))
  })

  it('E4-A-15: string property value 500자 초과 → null', () => {
    const long = 'x'.repeat(600)
    const e = getCallEdge(`import { f } from 'x'; export function g() { f({ key: '${long}' }) }`, 'f')
    expect(e?.literal_args).toBe(JSON.stringify([{ key: null }]))
  })

  it('E4-A-16: NUL 바이트 포함 property → null', () => {
    const e = getCallEdge(`import { f } from 'x'; export function g() { f({ key: 'a\\x00b' }) }`, 'f')
    expect(e?.literal_args).toBe(JSON.stringify([{ key: null }]))
  })

  it('E4-A-17: 직렬화 길이 2000 초과 → 전체 literal_args=null', () => {
    const props = Array.from({ length: 200 }, (_, i) => `k${i}: '${'v'.repeat(20)}'`).join(', ')
    const e = getCallEdge(`import { f } from 'x'; export function g() { f({ ${props} }) }`, 'f')
    expect(e?.literal_args).toBeNull()
  })
})

// ────────────────────────────────────────────────
// E4-B. calls edge 통합
// ────────────────────────────────────────────────
describe('E4-B: calls edge 통합', () => {
  it("E4-B-01: fetch('/api', { method: 'POST' })", () => {
    const e = getCallEdge(`
      import { fetch } from 'node-fetch'
      export function f() { fetch('/api', { method: 'POST' }) }
    `, 'fetch')
    expect(e?.first_arg).toBe('/api')
    expect(e?.literal_args).toBe(JSON.stringify(['/api', { method: 'POST' }]))
  })

  it("E4-B-02: axios.post('/x', { body: data })", () => {
    const e = getCallEdge(`
      import axios from 'axios'
      export function f(data: any) { axios.post('/x', { body: data }) }
    `, 'axios.post')
    expect(e?.first_arg).toBe('/x')
    expect(e?.literal_args).toBe(JSON.stringify(['/x', { body: null }]))
  })

  it("E4-B-03: emit('event', { source: 'api' })", () => {
    const e = getCallEdge(`
      import { eventBus } from './bus'
      export function f() { eventBus.emit('event', { source: 'api' }) }
    `, 'eventBus.emit')
    expect(e?.first_arg).toBe('event')
    expect(e?.literal_args).toBe(JSON.stringify(['event', { source: 'api' }]))
  })

  it('E4-B-04: 단일 객체 인자 (URL 없는 호출)', () => {
    const e = getCallEdge(`
      import { setOptions } from 'x'
      export function f() { setOptions({ timeout: 5000, retry: true }) }
    `, 'setOptions')
    expect(e?.first_arg).toBeNull()  // 첫 인자가 객체 → first_arg=null
    expect(e?.literal_args).toBe(JSON.stringify([{ timeout: 5000, retry: true }]))
  })

  it('E4-B-05: string-only 호출 (회귀 — E1 동작 그대로)', () => {
    const e = getCallEdge(`
      import { foo } from './x'
      export function f() { foo('a', 'b') }
    `, 'foo')
    expect(e?.first_arg).toBe('a')
    expect(e?.literal_args).toBe(JSON.stringify(['a', 'b']))
  })
})

// ────────────────────────────────────────────────
// E4-C. decorator 통합 (literal_args 일관성)
// ────────────────────────────────────────────────
describe('E4-C: decorator literal_args 일관성', () => {
  it('E4-C-01: @Cache({ ttl: 300, key: "users" })', () => {
    const r = parse(`
      import { Cache } from '@/decorators'
      export class S {
        @Cache({ ttl: 300, key: 'users' })
        find() { return [] }
      }
    `)
    const e = r.edges.find((edge) => edge.relation === 'decorates' && edge.target_symbol === 'Cache')
    expect(e?.literal_args).toBe(JSON.stringify([{ ttl: 300, key: 'users' }]))
  })

  it('E4-C-02: @Module({ controllers: [X] }) — depends_on 분리는 E2 그대로', () => {
    const r = parse(`
      import { Module } from '@nestjs/common'
      import { OrderController } from './c'
      @Module({ controllers: [OrderController] })
      export class M {}
    `)
    const dec = r.edges.find((edge) => edge.relation === 'decorates' && edge.target_symbol === 'Module')
    // identifier가 배열에 있어 null로 표시
    expect(dec?.literal_args).toBe(JSON.stringify([{ controllers: [null] }]))
    // depends_on은 E2 그대로 작동
    expect(r.edges.some((edge) => edge.relation === 'depends_on' && edge.target_symbol === 'OrderController')).toBe(true)
  })
})

// ────────────────────────────────────────────────
// ARG-TS: argExpressions 캡처 (Step 4)
// ────────────────────────────────────────────────
describe('ARG-TS: argExpressions 캡처', () => {
  it('ARG-TS-01: axios.get("/api/users") — string argExpression + firstArg 유지', () => {
    const e = getCallEdge(
      `import { axios } from 'axios'; export function f() { axios.get('/api/users') }`,
      'axios.get',
    )
    expect(e?.first_arg).toBe('/api/users')
    const exprs = e?.arg_expressions as Array<{ index: number; kind: string; raw: string; value?: string }> | null
    expect(exprs).not.toBeNull()
    expect(exprs).toHaveLength(1)
    expect(exprs![0].index).toBe(0)
    expect(exprs![0].kind).toBe('string')
    expect(exprs![0].value).toBe('/api/users')
  })

  it('ARG-TS-02: axios.get(`/api/users/${id}`) — template: firstArg=null, staticPattern=/api/users/:id', () => {
    const e = getCallEdge(
      `import { axios } from 'axios'; export function f(id: string) { axios.get(\`/api/users/\${id}\`) }`,
      'axios.get',
    )
    expect(e?.first_arg).toBeNull()
    const exprs = e?.arg_expressions as Array<{ index: number; kind: string; staticPattern?: string; identifiers?: string[] }> | null
    expect(exprs).not.toBeNull()
    expect(exprs![0].kind).toBe('template')
    expect(exprs![0].staticPattern).toBe('/api/users/:id')
    expect(exprs![0].identifiers).toContain('id')
  })

  it('ARG-TS-03: fetch(`/api/orders/${order.id}`) — staticPattern=/api/orders/:id', () => {
    const e = getCallEdge(
      `import { fetch } from 'x'; export function f(order: any) { fetch(\`/api/orders/\${order.id}\`) }`,
      'fetch',
    )
    const exprs = e?.arg_expressions as Array<{ staticPattern?: string; identifiers?: string[] }> | null
    expect(exprs![0].staticPattern).toBe('/api/orders/:id')
    expect(exprs![0].identifiers).toContain('id')
  })

  it('ARG-TS-04: router.push(`/users/${id}`) — staticPattern=/users/:id', () => {
    const e = getCallEdge(
      `import { router } from 'x'; export function f(id: string) { router.push(\`/users/\${id}\`) }`,
      'router.push',
    )
    const exprs = e?.arg_expressions as Array<{ staticPattern?: string }> | null
    expect(exprs![0].staticPattern).toBe('/users/:id')
  })

  it('ARG-TS-05: eventEmitter.emit(`order.${type}`) — staticPattern=order.:type', () => {
    const e = getCallEdge(
      `import { eventEmitter } from 'x'; export function f(type: string) { eventEmitter.emit(\`order.\${type}\`) }`,
      'eventEmitter.emit',
    )
    const exprs = e?.arg_expressions as Array<{ staticPattern?: string; identifiers?: string[] }> | null
    expect(exprs![0].staticPattern).toBe('order.:type')
    expect(exprs![0].identifiers).toContain('type')
  })

  it('ARG-TS-06: prisma.user.findUnique({ where: { id } }) — object raw preserved', () => {
    const e = getCallEdge(
      `import { prisma } from 'x'; export function f(id: string) { prisma.user.findUnique({ where: { id } }) }`,
      'prisma.user.findUnique',
    )
    const exprs = e?.arg_expressions as Array<{ kind: string; raw: string }> | null
    expect(exprs).not.toBeNull()
    expect(exprs![0].kind).toBe('object')
    expect(exprs![0].raw).toContain('where')
  })

  it('ARG-TS-07: client.request({ method: "POST", url: `/api/orders/${id}` }) — object raw', () => {
    const e = getCallEdge(
      `import { client } from 'x'; export function f(id: string) { client.request({ method: 'POST', url: \`/api/orders/\${id}\` }) }`,
      'client.request',
    )
    const exprs = e?.arg_expressions as Array<{ kind: string; raw: string }> | null
    expect(exprs![0].kind).toBe('object')
    expect(exprs![0].raw).toContain('method')
  })

  it('ARG-TS-08: identifier arg — kind=identifier, no staticPattern', () => {
    const e = getCallEdge(
      `import { fn } from 'x'; export function f(url: string) { fn(url) }`,
      'fn',
    )
    const exprs = e?.arg_expressions as Array<{ kind: string; staticPattern?: string }> | null
    expect(exprs![0].kind).toBe('identifier')
    expect(exprs![0].staticPattern).toBeUndefined()
  })

  it('ARG-TS-09: huge expression over limit — argExpressions=null', () => {
    const hugeId = 'x'.repeat(600)
    const e = getCallEdge(
      `import { fn } from 'x'; export function f() { fn(\`/prefix/\${${hugeId}}\`) }`,
      'fn',
    )
    // argExpressions는 raw 길이 한도 초과 시 null
    const exprs = e?.arg_expressions
    expect(exprs == null || (Array.isArray(exprs) && exprs.length === 0)).toBe(true)
  })

  it('ARG-TS-10: 기존 first_arg/literal_args 동작 불변 — string 인자', () => {
    const e = getCallEdge(
      `import { fn } from 'x'; export function f() { fn('/api/test', { method: 'GET' }) }`,
      'fn',
    )
    expect(e?.first_arg).toBe('/api/test')
    expect(e?.literal_args).toBe(JSON.stringify(['/api/test', { method: 'GET' }]))
  })

  it('ARG-TS-11: local const string arg — identifier.resolved에 정적 값 저장', () => {
    const e = getCallEdge(
      `import { fetch } from 'x'; export function f() { const path = '/api/users'; fetch(path) }`,
      'fetch',
    )
    const expr = e?.arg_expressions?.[0]

    expect(expr).toMatchObject({
      kind: 'identifier',
      raw: 'path',
      resolution: 'static',
      resolved: { kind: 'string', value: '/api/users', resolution: 'static' },
    })
    expect(e?.first_arg).toBeNull()
  })

  it('ARG-TS-12: local object member arg — member.resolved에 property string 저장', () => {
    const e = getCallEdge(
      `import { axios } from 'axios'; export function f() { const API_ROUTES = { orders: '/api/orders' }; axios.get(API_ROUTES.orders) }`,
      'axios.get',
    )
    const expr = e?.arg_expressions?.[0]

    expect(expr).toMatchObject({
      kind: 'member',
      raw: 'API_ROUTES.orders',
      resolution: 'static',
      resolved: { kind: 'string', value: '/api/orders', resolution: 'static' },
    })
  })

  it('ARG-TS-13: local object config arg — identifier.resolved.properties 저장', () => {
    const e = getCallEdge(
      `import axios from 'axios'; export function f() { const config = { url: '/api/users', method: 'post' }; axios.request(config) }`,
      'axios.request',
    )
    const expr = e?.arg_expressions?.[0]

    expect(expr).toMatchObject({
      kind: 'identifier',
      raw: 'config',
      resolution: 'static',
      resolved: {
        kind: 'object',
        resolution: 'static',
        properties: {
          url: { kind: 'string', value: '/api/users', resolution: 'static' },
          method: { kind: 'string', value: 'post', resolution: 'static' },
        },
      },
    })
  })

  it('ARG-TS-14: dynamic local const arg — resolved 생략', () => {
    const e = getCallEdge(
      `import { fetch } from 'x'; export function f(id: string) { const path = '/api/users/' + id; fetch(path) }`,
      'fetch',
    )
    const expr = e?.arg_expressions?.[0]

    expect(expr).toMatchObject({ kind: 'identifier', raw: 'path', resolution: 'dynamic' })
    expect(expr?.resolved).toBeUndefined()
  })

  it('ARG-TS-15: shadowing — 가장 가까운 const initializer를 사용', () => {
    const e = getCallEdge(
      `const path = '/outer'; import { fetch } from 'x'; export function f() { const path = '/inner'; fetch(path) }`,
      'fetch',
    )
    const expr = e?.arg_expressions?.[0]

    expect(expr).toMatchObject({
      kind: 'identifier',
      raw: 'path',
      resolution: 'static',
      resolved: { kind: 'string', value: '/inner' },
    })
  })

  it('ARG-TS-16: declaration order — 참조 이후 선언된 const는 resolve하지 않음', () => {
    const e = getCallEdge(
      `import { fetch } from 'x'; export function f() { fetch(path); const path = '/api/late' }`,
      'fetch',
    )
    const expr = e?.arg_expressions?.[0]

    expect(expr).toMatchObject({ kind: 'identifier', raw: 'path', resolution: 'dynamic' })
    expect(expr?.resolved).toBeUndefined()
  })

  it('ARG-TS-17: mutable let/var initializer는 resolve하지 않음', () => {
    const letEdge = getCallEdge(
      `import { fetch } from 'x'; export function f() { let path = '/api/let'; fetch(path) }`,
      'fetch',
    )
    const varEdge = getCallEdge(
      `import { fetch } from 'x'; export function f() { var path = '/api/var'; fetch(path) }`,
      'fetch',
    )

    expect(letEdge?.arg_expressions?.[0]).toMatchObject({ kind: 'identifier', raw: 'path', resolution: 'dynamic' })
    expect(letEdge?.arg_expressions?.[0]?.resolved).toBeUndefined()
    expect(varEdge?.arg_expressions?.[0]).toMatchObject({ kind: 'identifier', raw: 'path', resolution: 'dynamic' })
    expect(varEdge?.arg_expressions?.[0]?.resolved).toBeUndefined()
  })

  it('ARG-TS-18: object property dynamic 섞임 — static property는 보존하고 object는 partial', () => {
    const e = getCallEdge(
      `import axios from 'axios'; export function f(method: string) { const config = { url: '/api/users', method }; axios.request(config) }`,
      'axios.request',
    )
    const resolved = e?.arg_expressions?.[0]?.resolved

    expect(resolved).toMatchObject({
      kind: 'object',
      resolution: 'partial',
      properties: {
        url: { kind: 'string', value: '/api/users', resolution: 'static' },
        method: { kind: 'identifier', raw: 'method', resolution: 'dynamic' },
      },
    })
  })

  it('ARG-TS-19: computed member access는 resolve하지 않음', () => {
    const e = getCallEdge(
      `import axios from 'axios'; export function f(key: string) { const API_ROUTES = { orders: '/api/orders' }; axios.get(API_ROUTES[key]) }`,
      'axios.get',
    )
    const expr = e?.arg_expressions?.[0]

    expect(expr).toMatchObject({ kind: 'unknown', resolution: 'dynamic' })
    expect(expr?.resolved).toBeUndefined()
  })

  it('ARG-TS-20: nested object member는 depth 한도 안에서 resolve', () => {
    const e = getCallEdge(
      `import { fetch } from 'x'; export function f() { const ROUTES = { api: { users: '/api/users' } }; fetch(ROUTES.api.users) }`,
      'fetch',
    )
    const expr = e?.arg_expressions?.[0]

    expect(expr).toMatchObject({
      kind: 'member',
      raw: 'ROUTES.api.users',
      resolution: 'static',
      resolved: { kind: 'string', value: '/api/users' },
    })
  })

  it('ARG-TS-21: imported const는 이번 resolver 범위에서 resolve하지 않음', () => {
    const e = getCallEdge(
      `import { API_ROUTES } from './routes'; import axios from 'axios'; export function f() { axios.get(API_ROUTES.users) }`,
      'axios.get',
    )
    const expr = e?.arg_expressions?.[0]

    expect(expr).toMatchObject({ kind: 'member', raw: 'API_ROUTES.users', resolution: 'dynamic' })
    expect(expr?.resolved).toBeUndefined()
  })

  it('ARG-TS-22: property count limit — 큰 object는 앞쪽 property만 저장해 JSON 폭발 방지', () => {
    const props = Array.from({ length: 25 }, (_, i) => `p${i}: '${i}'`).join(', ')
    const e = getCallEdge(
      `import { fn } from 'x'; export function f() { fn({ ${props} }) }`,
      'fn',
    )
    const properties = e?.arg_expressions?.[0]?.properties ?? {}

    expect(Object.keys(properties)).toHaveLength(20)
    expect(properties.p0).toMatchObject({ kind: 'string', value: '0' })
    expect(properties.p19).toMatchObject({ kind: 'string', value: '19' })
    expect(properties.p20).toBeUndefined()
  })

  it('ARG-TS-23: node count invariant — const/object resolve가 code_nodes를 늘리지 않음', () => {
    const r = parse(`
      import axios from 'axios'
      export function f() {
        const API_ROUTES = { orders: '/api/orders' }
        const config = { url: API_ROUTES.orders, method: 'post' }
        axios.request(config)
      }
    `)

    expect(r.nodes.map((n) => n.name)).toEqual(['f'])
    expect(r.edges.some((e) => e.relation === 'calls' && e.target_symbol === 'request')).toBe(true)
  })
})
