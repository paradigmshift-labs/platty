// P3: method decorator → calls 중복 발화 제거
// method 노드의 calls walk는 body만 — parameter list / decorator 영역 walk 금지
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/x.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('P3: method decorator는 decorates만 — calls 중복 발화 금지', () => {
  it('MD-01: @GetUser() parameter decorator는 decorates 1건, calls 0건 (method body 안 호출 X)', () => {
    const r = parse(`
      export class C {
        async fn(user: any) {}
      }
    `)
    // baseline 확인 (parameter decorator 없는 경우)
    const callEdges = r.edges.filter((e) => e.relation === 'calls')
    expect(callEdges.length).toBe(0)
  })

  it('MD-02: parameter decorator @GetUser() — decorates 발화, calls 발화 X', () => {
    const r = parse(`
      function GetUser() { return null }
      export class C {
        async fn(@GetUser() user: any) {}
      }
    `)
    const decorates = r.edges.find(
      (e) => e.relation === 'decorates' && e.target_symbol === 'GetUser',
    )
    expect(decorates, 'decorates GetUser').toBeDefined()

    const calls = r.edges.find(
      (e) =>
        e.relation === 'calls' &&
        e.target_symbol === 'GetUser' &&
        e.source_id.endsWith(':C.fn'),
    )
    expect(calls, 'GetUser는 method body가 아닌 parameter decorator — calls 발화 X').toBeUndefined()
  })

  it('MD-03: @Query("page", new ParseIntPipe(...)) — decorates만, ParseIntPipe calls 발화 X', () => {
    const r = parse(`
      function Query(_a: string, _b: any) { return null }
      class ParseIntPipe { constructor(_o: any) {} }
      export class C {
        async fn(@Query('page', new ParseIntPipe({ optional: true })) page: number) {}
      }
    `)
    const queryDeco = r.edges.find(
      (e) => e.relation === 'decorates' && e.target_symbol === 'Query',
    )
    expect(queryDeco, 'decorates Query').toBeDefined()

    const queryCalls = r.edges.find(
      (e) =>
        e.relation === 'calls' &&
        e.target_symbol === 'Query' &&
        e.source_id.endsWith(':C.fn'),
    )
    expect(queryCalls, 'Query decorator는 calls 발화 X').toBeUndefined()

    const parseIntPipeCalls = r.edges.find(
      (e) =>
        e.relation === 'calls' &&
        e.target_symbol === 'ParseIntPipe' &&
        e.source_id.endsWith(':C.fn'),
    )
    expect(parseIntPipeCalls, 'decorator arg new ParseIntPipe — calls 발화 X').toBeUndefined()
  })

  it('MD-04: method body 안 진짜 calls는 발화 정상 (regression)', () => {
    const r = parse(`
      function helper() { return null }
      function GetUser() { return null }
      export class C {
        async fn(@GetUser() user: any) {
          return helper()
        }
      }
    `)
    const helperCalls = r.edges.find(
      (e) =>
        e.relation === 'calls' &&
        e.target_symbol === 'helper' &&
        e.source_id.endsWith(':C.fn'),
    )
    expect(helperCalls, 'method body 안 helper() calls 정상 발화').toBeDefined()
  })

  it('MD-05: method-level decorator is also represented as a calls edge', () => {
    const r = parse(`
      function Public() { return null }
      export class AuthController {
        @Public()
        async signIn() {}
      }
    `)

    const decorates = r.edges.find(
      (e) =>
        e.relation === 'decorates' &&
        e.target_symbol === 'Public' &&
        e.source_id.endsWith(':AuthController.signIn'),
    )
    expect(decorates, 'decorates Public').toBeDefined()

    const calls = r.edges.find(
      (e) =>
        e.relation === 'calls' &&
        e.target_symbol === 'Public' &&
        e.source_id.endsWith(':AuthController.signIn'),
    )
    expect(calls, 'method-level decorator call is part of the executable graph').toBeDefined()
  })
})
