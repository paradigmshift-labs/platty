/**
 * Namespace / deep member-chain call extraction (NSC-01 ~ NSC-08)
 *
 * 유저 우려: `user.friend.get()` 같은 namespace/딥-멤버 체인 호출이 calls edge 로 빠짐없이 잡히는가.
 *
 * 분류:
 *   - identifier-rooted 체인(`a.b.c.run()`, `svc.user.find()`, `MyApi.Users.list()`)은
 *     call_edge_ops.ts 168 분기가 처리해야 한다(chain_path=object.text, target_symbol=last prop).
 *   - call-rooted 체인(`client().ns.user.find()`)은 이번에 추가한 call/new 분기가 처리.
 *   - optional chaining(`a?.b?.get()`)도 member_expression 으로 파싱되면 동일 처리.
 *
 * 모두 정적 규칙(특정 repo 비의존) — 한 케이스라도 edge 가 빠지면 build_relations 의
 * navigation/api_call/db_access 재료가 사라진다.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/test.ts', repoId = 'repo1') {
  return adapter.parseFile(content, filePath, repoId)
}

function callEdge(r: { edges: readonly any[] }, symbol: string) {
  return r.edges.find((e: any) => e.relation === 'calls' && e.target_symbol === symbol)
}

describe('Namespace / deep member-chain call extraction', () => {
  it('NSC-01: 2-level identifier chain user.friend.get() → chain_path=user.friend', () => {
    const r = parse(`
export function f(user: any) {
  return user.friend.get()
}
`)
    const e = callEdge(r, 'get')
    expect(e, 'get edge').toBeDefined()
    expect(e?.chain_path).toBe('user.friend')
  })

  it('NSC-02: deep identifier chain a.b.c.d.run() → chain_path=a.b.c.d', () => {
    const r = parse(`
export function f(a: any) {
  return a.b.c.d.run()
}
`)
    const e = callEdge(r, 'run')
    expect(e, 'run edge').toBeDefined()
    expect(e?.chain_path).toBe('a.b.c.d')
  })

  it('NSC-03: namespace import — import * as svc; svc.user.find() → target_specifier resolves', () => {
    const r = parse(`
import * as svc from './svc'
export function f() {
  return svc.user.find()
}
`)
    const e = callEdge(r, 'find')
    expect(e, 'find edge').toBeDefined()
    expect(e?.chain_path).toBe('svc.user')
    expect(e?.target_specifier).toBe('./svc')
  })

  it('NSC-04: TS namespace qualified access MyApi.Users.list() → chain_path=MyApi.Users', () => {
    const r = parse(`
export function f() {
  return MyApi.Users.list()
}
`)
    const e = callEdge(r, 'list')
    expect(e, 'list edge').toBeDefined()
    expect(e?.chain_path).toBe('MyApi.Users')
  })

  it('NSC-05: optional chaining user?.friend?.get() → get edge emitted', () => {
    const r = parse(`
export function f(user: any) {
  return user?.friend?.get()
}
`)
    const e = callEdge(r, 'get')
    expect(e, 'optional-chain get edge').toBeDefined()
  })

  it('NSC-06: call-rooted namespace chain buildClient().users.list() → chain_path=buildClient().users', () => {
    const r = parse(`
import { buildClient } from './client'
export function f() {
  return buildClient().users.list()
}
`)
    const e = callEdge(r, 'list')
    expect(e, 'list edge').toBeDefined()
    expect(e?.chain_path).toBe('buildClient().users')
    expect(e?.target_specifier).toBe('./client')
  })

  it('NSC-07: namespace member as call receiver getClient(cfg).ns.user.update() → update edge, chain_path full', () => {
    const r = parse(`
import { getClient } from './client'
export function f(cfg: any) {
  return getClient(cfg).ns.user.update({})
}
`)
    const e = callEdge(r, 'update')
    expect(e, 'update edge').toBeDefined()
    expect(e?.chain_path).toBe('getClient(cfg).ns.user')
    expect(e?.target_specifier).toBe('./client')
  })

  it('NSC-08: namespace-import method on a method result svc.api().list() → list edge emitted (call-rooted)', () => {
    const r = parse(`
import * as svc from './svc'
export function f() {
  return svc.api().list()
}
`)
    const e = callEdge(r, 'list')
    expect(e, 'list edge').toBeDefined()
    expect(e?.target_specifier).toBe('./svc')
  })
})
