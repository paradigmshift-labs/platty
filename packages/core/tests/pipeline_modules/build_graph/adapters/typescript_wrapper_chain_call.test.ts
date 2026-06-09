/**
 * Wrapper-chain DB call extraction (WC-01 ~ WC-06)
 *
 * SOT: `getPrismaDB(tx).<model>.<method>()` 처럼 member chain 의 최심 receiver 가
 *      call_expression(또는 new_expression)인 경우, build_graph 는 마지막 method 를
 *      `calls` edge 로 발화해야 한다.
 *
 *      build_relations(REL-S28, db_access_semantic.test.ts)는 이미 이 edge
 *      (chain_path='getPrismaDB(tx).order', target_symbol='create')를 db_access 관계로
 *      변환할 준비가 되어 있다 — build_graph 발화만 누락이었다.
 *
 * 일반화 규칙(특정 repo/fixture 비의존):
 *   fn 이 member_expression 이고 obj 도 member_expression 이며, 그 chain root 가
 *   call/new 표현식이면(this/super 루트 제외) chain method 를 발화한다.
 *   chain root identifier 가 import-bound 이면 specifier 를 채우고, 아니면 null
 *   (P13 화이트리스트가 받음). 동적 subscript 접근 getPrismaDB(tx)[m].x() 은 범위 밖.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/test.ts', repoId = 'repo1') {
  return adapter.parseFile(content, filePath, repoId)
}

describe('Wrapper-chain DB call: getPrismaDB(tx).model.method()', () => {
  it('WC-01: getPrismaDB(tx).user.update() → calls edge target_symbol=update, chain_path=getPrismaDB(tx).user', () => {
    const r = parse(`
import { getPrismaDB } from './common'
export function f(tx: any) {
  return getPrismaDB(tx).user.update({ where: { id: 1 } })
}
`)
    const e = r.edges.find(
      (edge: any) => edge.relation === 'calls' && edge.target_symbol === 'update',
    )
    expect(e, 'update calls edge should be emitted').toBeDefined()
    expect(e?.chain_path).toBe('getPrismaDB(tx).user')
  })

  it('WC-02: getPrismaDB(tx).feed.updateMany() → calls edge target_symbol=updateMany, chain_path=getPrismaDB(tx).feed', () => {
    const r = parse(`
import { getPrismaDB } from './common'
export function f(tx: any) {
  return getPrismaDB(tx).feed.updateMany({ data: {} })
}
`)
    const e = r.edges.find(
      (edge: any) => edge.relation === 'calls' && edge.target_symbol === 'updateMany',
    )
    expect(e, 'updateMany calls edge should be emitted').toBeDefined()
    expect(e?.chain_path).toBe('getPrismaDB(tx).feed')
  })

  it('WC-03: import-bound wrapper → target_specifier resolves to import source', () => {
    const r = parse(`
import { getPrismaDB } from './common'
export function f(tx: any) {
  return getPrismaDB(tx).user.update({})
}
`)
    const e = r.edges.find(
      (edge: any) => edge.relation === 'calls' && edge.target_symbol === 'update',
    )
    expect(e?.target_specifier).toBe('./common')
  })

  it('WC-04 (regression lock): identifier-rooted namespace chain user.friend.get() still emits', () => {
    const r = parse(`
export function f(user: any) {
  return user.friend.get()
}
`)
    const e = r.edges.find(
      (edge: any) => edge.relation === 'calls' && edge.target_symbol === 'get',
    )
    expect(e, 'get calls edge (identifier-rooted) should still emit').toBeDefined()
    expect(e?.chain_path).toBe('user.friend')
  })

  it('WC-05: deeper wrapper chain getPrismaDB(tx).user.profile.upsert() → last method emitted', () => {
    const r = parse(`
import { getPrismaDB } from './common'
export function f(tx: any) {
  return getPrismaDB(tx).user.profile.upsert({})
}
`)
    const e = r.edges.find(
      (edge: any) => edge.relation === 'calls' && edge.target_symbol === 'upsert',
    )
    expect(e, 'upsert calls edge should be emitted').toBeDefined()
    expect(e?.chain_path).toBe('getPrismaDB(tx).user.profile')
    expect(e?.target_specifier).toBe('./common')
  })

  it('WC-06 (guard): this-rooted call chain this.client().user.find() does not emit a resolved root edge', () => {
    const r = parse(`
export class Svc {
  client() { return null as any }
  run() {
    return this.client().user.find()
  }
}
`)
    // this-rooted: findChainRootIdentifier → null → no import-bound emit (preserves prior behavior)
    const resolved = r.edges.find(
      (edge: any) =>
        edge.relation === 'calls' &&
        edge.target_symbol === 'find' &&
        edge.target_specifier != null,
    )
    expect(resolved, 'no spuriously-resolved find edge for this-rooted chain').toBeUndefined()
  })
})
