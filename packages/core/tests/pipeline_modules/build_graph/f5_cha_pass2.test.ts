/**
 * BS-13 + BS-14 — F5 CHA Pass 2: type_resolved edge 생성 + fan-out 50 상한
 *
 * 인터페이스 → 구현체 매핑이 type_resolved edge로 명시:
 *   class StripePayment implements IPayment {}
 *   constructor(p: IPayment) → IPayment의 구현체 StripePayment 추적
 *
 * 시나리오:
 *   BS-13-01: implements 1개 → confidence='high' type_resolved edge
 *   BS-13-02: implements 0개 (interface만 있고 구현체 없음) → type_resolved 없음
 *   BS-13-03: implements 2개 → 각각 type_resolved edge (confidence='low')
 *   BS-13-04: type_ref subtype = method_param → type_resolved 생성
 *   BS-13-05: type_ref subtype = method_param → type_resolved 생성
 *   BS-13-06: type_ref subtype = return_type → type_resolved 생성 (BS-13-05에 통합)
 *   BS-13-07: type_ref가 일반 클래스(인터페이스 X) → type_resolved 없음
 *   BS-13-08: cross-file 인터페이스 → 구현체 (다른 파일)
 *   BS-13-09: 인터페이스에 구현체 chain (abstract→class) — 단계 1만 (V2 스코프 외 — V1 spec 보류 항목)
 *   BS-13-10: type_resolved edge resolve_status = 'resolved'
 *   BS-14-01: 구현체 50 이하 → 모든 type_resolved 생성
 *   BS-14-02: 구현체 51개 → emit X + 동작은 정상 (후속 calls는 안 끊김)
 *   BS-14-03: pending 0 불변식 — type_resolved는 'resolved'로 끝 (BS-13-10에 통합)
 */
import { describe, it, expect } from 'vitest'
import type { CodeNodeRaw, CodeEdgeRaw } from '@/pipeline_modules/build_graph/types.js'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls.js'

const REPO = 'r1'

function n(opts: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string }): CodeNodeRaw {
  return {
    id: opts.id,
    repo_id: REPO,
    type: opts.type,
    file_path: opts.file_path ?? 'src/a.ts',
    name: opts.name,
    line_start: opts.line_start ?? 1,
    line_end: opts.line_end ?? 10,
    signature: opts.signature ?? null,
    exported: opts.exported ?? true,
    parse_status: 'ok',
    is_test: false,
    test_type: null,
    is_async: false,
    jsdoc: null,
  }
}

function e(opts: Partial<CodeEdgeRaw> & { source_id: string; relation: CodeEdgeRaw['relation'] }): CodeEdgeRaw {
  return {
    repo_id: REPO,
    source_id: opts.source_id,
    target_id: opts.target_id ?? null,
    relation: opts.relation,
    target_specifier: opts.target_specifier ?? null,
    target_symbol: opts.target_symbol ?? null,
    resolve_status: opts.resolve_status ?? 'pending',
    first_arg: null,
    literal_args: null,
  }
}

describe('BS-13: type_resolved edge 생성 (CHA Pass 2)', () => {
  it('BS-13-01: implements 1개 → confidence="high" type_resolved edge', async () => {
    const nodes: CodeNodeRaw[] = [
      n({ id: 'r1:src/a.ts:IPayment', type: 'interface', name: 'IPayment', file_path: 'src/a.ts' }),
      n({ id: 'r1:src/a.ts:StripePayment', type: 'class', name: 'StripePayment', file_path: 'src/a.ts' }),
      n({ id: 'r1:src/a.ts:Order', type: 'class', name: 'Order', file_path: 'src/a.ts' }),
    ]
    const edges: CodeEdgeRaw[] = [
      e({
        source_id: 'r1:src/a.ts:StripePayment',
        relation: 'implements',
        target_id: 'r1:src/a.ts:IPayment',
        resolve_status: 'resolved',
      }),
      // type_ref edge: Order의 constructor가 IPayment 사용
      e({
        source_id: 'r1:src/a.ts:Order',
        relation: 'type_ref',
        target_id: 'r1:src/a.ts:IPayment',
        target_symbol: 'constructor_param',
        resolve_status: 'resolved',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const tr = result.find((r) => r.relation === 'type_resolved')
    expect(tr).toBeDefined()
    expect(tr!.source_id).toBe('r1:src/a.ts:Order')
    expect(tr!.target_id).toBe('r1:src/a.ts:StripePayment')
    expect(tr!.confidence).toBe('high')
    expect(tr!.resolve_status).toBe('resolved')
  })

  it('BS-13-02: implements 0개 (interface만 있고 구현체 없음) → type_resolved 없음', async () => {
    const nodes: CodeNodeRaw[] = [
      n({ id: 'r1:src/a.ts:IPayment', type: 'interface', name: 'IPayment' }),
      n({ id: 'r1:src/a.ts:Order', type: 'class', name: 'Order' }),
    ]
    const edges: CodeEdgeRaw[] = [
      e({
        source_id: 'r1:src/a.ts:Order',
        relation: 'type_ref',
        target_id: 'r1:src/a.ts:IPayment',
        target_symbol: 'constructor_param',
        resolve_status: 'resolved',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    expect(result.find((r) => r.relation === 'type_resolved')).toBeUndefined()
  })

  it('BS-13-03: implements 2개 → 각각 type_resolved edge (confidence="low")', async () => {
    const nodes: CodeNodeRaw[] = [
      n({ id: 'r1:src/a.ts:IPayment', type: 'interface', name: 'IPayment' }),
      n({ id: 'r1:src/a.ts:Stripe', type: 'class', name: 'Stripe' }),
      n({ id: 'r1:src/a.ts:Paypal', type: 'class', name: 'Paypal' }),
      n({ id: 'r1:src/a.ts:Order', type: 'class', name: 'Order' }),
    ]
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:Stripe', relation: 'implements', target_id: 'r1:src/a.ts:IPayment', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:Paypal', relation: 'implements', target_id: 'r1:src/a.ts:IPayment', resolve_status: 'resolved' }),
      e({
        source_id: 'r1:src/a.ts:Order',
        relation: 'type_ref',
        target_id: 'r1:src/a.ts:IPayment',
        target_symbol: 'constructor_param',
        resolve_status: 'resolved',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const trs = result.filter((r) => r.relation === 'type_resolved')
    expect(trs).toHaveLength(2)
    const targets = trs.map((t) => t.target_id).sort()
    expect(targets).toEqual(['r1:src/a.ts:Paypal', 'r1:src/a.ts:Stripe'])
    expect(trs.every((t) => t.confidence === 'low')).toBe(true)
  })

  it('BS-13-04: type_ref subtype = method_param → type_resolved 생성', async () => {
    const nodes: CodeNodeRaw[] = [
      n({ id: 'r1:src/a.ts:IDto', type: 'interface', name: 'IDto' }),
      n({ id: 'r1:src/a.ts:UserDto', type: 'class', name: 'UserDto' }),
      n({ id: 'r1:src/a.ts:Svc.create', type: 'method', name: 'Svc.create' }),
    ]
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:UserDto', relation: 'implements', target_id: 'r1:src/a.ts:IDto', resolve_status: 'resolved' }),
      e({
        source_id: 'r1:src/a.ts:Svc.create',
        relation: 'type_ref',
        target_id: 'r1:src/a.ts:IDto',
        target_symbol: 'method_param',
        resolve_status: 'resolved',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    expect(result.find((r) => r.relation === 'type_resolved' && r.target_id === 'r1:src/a.ts:UserDto')).toBeDefined()
  })

  it('BS-13-05: type_ref subtype = return_type → type_resolved 생성', async () => {
    const nodes: CodeNodeRaw[] = [
      n({ id: 'r1:src/a.ts:IResult', type: 'interface', name: 'IResult' }),
      n({ id: 'r1:src/a.ts:OkResult', type: 'class', name: 'OkResult' }),
      n({ id: 'r1:src/a.ts:fn', type: 'function', name: 'fn' }),
    ]
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:OkResult', relation: 'implements', target_id: 'r1:src/a.ts:IResult', resolve_status: 'resolved' }),
      e({
        source_id: 'r1:src/a.ts:fn',
        relation: 'type_ref',
        target_id: 'r1:src/a.ts:IResult',
        target_symbol: 'return_type',
        resolve_status: 'resolved',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    expect(result.find((r) => r.relation === 'type_resolved')).toBeDefined()
  })

  it('BS-13-07: type_ref가 일반 클래스(interface 아님) → type_resolved 없음', async () => {
    const nodes: CodeNodeRaw[] = [
      n({ id: 'r1:src/a.ts:User', type: 'class', name: 'User' }),
      n({ id: 'r1:src/a.ts:fn', type: 'function', name: 'fn' }),
    ]
    const edges: CodeEdgeRaw[] = [
      e({
        source_id: 'r1:src/a.ts:fn',
        relation: 'type_ref',
        target_id: 'r1:src/a.ts:User',
        target_symbol: 'method_param',
        resolve_status: 'resolved',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    expect(result.find((r) => r.relation === 'type_resolved')).toBeUndefined()
  })

  it('BS-13-08: cross-file 인터페이스 → 구현체', async () => {
    const nodes: CodeNodeRaw[] = [
      n({ id: 'r1:src/iface.ts:IRepo', type: 'interface', name: 'IRepo', file_path: 'src/iface.ts' }),
      n({ id: 'r1:src/impl.ts:UserRepo', type: 'class', name: 'UserRepo', file_path: 'src/impl.ts' }),
      n({ id: 'r1:src/use.ts:Svc', type: 'class', name: 'Svc', file_path: 'src/use.ts' }),
    ]
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/impl.ts:UserRepo', relation: 'implements', target_id: 'r1:src/iface.ts:IRepo', resolve_status: 'resolved' }),
      e({
        source_id: 'r1:src/use.ts:Svc',
        relation: 'type_ref',
        target_id: 'r1:src/iface.ts:IRepo',
        target_symbol: 'constructor_param',
        resolve_status: 'resolved',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const tr = result.find((r) => r.relation === 'type_resolved')
    expect(tr?.target_id).toBe('r1:src/impl.ts:UserRepo')
  })

  it('BS-13-10: type_resolved edge resolve_status="resolved" (pending 0 보장)', async () => {
    const nodes: CodeNodeRaw[] = [
      n({ id: 'r1:src/a.ts:IPayment', type: 'interface', name: 'IPayment' }),
      n({ id: 'r1:src/a.ts:Stripe', type: 'class', name: 'Stripe' }),
      n({ id: 'r1:src/a.ts:Order', type: 'class', name: 'Order' }),
    ]
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:Stripe', relation: 'implements', target_id: 'r1:src/a.ts:IPayment', resolve_status: 'resolved' }),
      e({
        source_id: 'r1:src/a.ts:Order',
        relation: 'type_ref',
        target_id: 'r1:src/a.ts:IPayment',
        target_symbol: 'constructor_param',
        resolve_status: 'resolved',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const trs = result.filter((r) => r.relation === 'type_resolved')
    expect(trs.length).toBeGreaterThan(0)
    expect(trs.every((t) => t.resolve_status === 'resolved')).toBe(true)
  })

  it('BS-13-11: resolved type_ref라도 target_id가 없으면 type_resolved를 만들지 않는다', async () => {
    const nodes: CodeNodeRaw[] = [
      n({ id: 'r1:src/a.ts:Order', type: 'class', name: 'Order' }),
    ]
    const edges: CodeEdgeRaw[] = [
      e({
        source_id: 'r1:src/a.ts:Order',
        relation: 'type_ref',
        target_id: null,
        target_symbol: 'constructor_param',
        resolve_status: 'resolved',
      }),
    ]

    const result = await resolveCalls(edges, nodes, new Map(), new Map())

    expect(result.find((r) => r.relation === 'type_resolved')).toBeUndefined()
  })

  it('BS-13-12: 같은 source/interface type_ref가 중복돼도 구현체 type_resolved는 한 번만 emit한다', async () => {
    const nodes: CodeNodeRaw[] = [
      n({ id: 'r1:src/a.ts:IRepo', type: 'interface', name: 'IRepo' }),
      n({ id: 'r1:src/a.ts:Repo', type: 'class', name: 'Repo' }),
      n({ id: 'r1:src/a.ts:Svc', type: 'class', name: 'Svc' }),
    ]
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:Repo', relation: 'implements', target_id: 'r1:src/a.ts:IRepo', resolve_status: 'resolved' }),
      e({
        source_id: 'r1:src/a.ts:Svc',
        relation: 'type_ref',
        target_id: 'r1:src/a.ts:IRepo',
        target_symbol: 'constructor_param',
        resolve_status: 'resolved',
      }),
      e({
        source_id: 'r1:src/a.ts:Svc',
        relation: 'type_ref',
        target_id: 'r1:src/a.ts:IRepo',
        target_symbol: 'property',
        resolve_status: 'resolved',
      }),
    ]

    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const trs = result.filter((r) => r.relation === 'type_resolved')

    expect(trs).toHaveLength(1)
    expect(trs[0].target_id).toBe('r1:src/a.ts:Repo')
  })
})

describe('BS-14: fan-out 50 상한', () => {
  it('BS-14-01: 구현체 50개 → 모든 type_resolved 생성', async () => {
    const nodes: CodeNodeRaw[] = [
      n({ id: 'r1:src/a.ts:ILogger', type: 'interface', name: 'ILogger' }),
      n({ id: 'r1:src/a.ts:Order', type: 'class', name: 'Order' }),
    ]
    const edges: CodeEdgeRaw[] = [
      e({
        source_id: 'r1:src/a.ts:Order',
        relation: 'type_ref',
        target_id: 'r1:src/a.ts:ILogger',
        target_symbol: 'constructor_param',
        resolve_status: 'resolved',
      }),
    ]
    for (let i = 0; i < 50; i++) {
      const id = `r1:src/a.ts:Logger${i}`
      nodes.push(n({ id, type: 'class', name: `Logger${i}` }))
      edges.push(e({ source_id: id, relation: 'implements', target_id: 'r1:src/a.ts:ILogger', resolve_status: 'resolved' }))
    }
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const trs = result.filter((r) => r.relation === 'type_resolved')
    expect(trs).toHaveLength(50)
  })

  it('BS-14-02: 구현체 51개 → emit X (fan-out 초과)', async () => {
    const nodes: CodeNodeRaw[] = [
      n({ id: 'r1:src/a.ts:ILogger', type: 'interface', name: 'ILogger' }),
      n({ id: 'r1:src/a.ts:Order', type: 'class', name: 'Order' }),
    ]
    const edges: CodeEdgeRaw[] = [
      e({
        source_id: 'r1:src/a.ts:Order',
        relation: 'type_ref',
        target_id: 'r1:src/a.ts:ILogger',
        target_symbol: 'constructor_param',
        resolve_status: 'resolved',
      }),
    ]
    for (let i = 0; i < 51; i++) {
      const id = `r1:src/a.ts:Logger${i}`
      nodes.push(n({ id, type: 'class', name: `Logger${i}` }))
      edges.push(e({ source_id: id, relation: 'implements', target_id: 'r1:src/a.ts:ILogger', resolve_status: 'resolved' }))
    }
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    // 51개 → fan-out 초과 → emit 0
    const trs = result.filter((r) => r.relation === 'type_resolved')
    expect(trs).toHaveLength(0)
  })
})
