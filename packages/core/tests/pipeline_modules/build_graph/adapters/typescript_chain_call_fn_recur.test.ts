// P2: chain call_expression — Cron(expr)(target,key,descriptor) 패턴
// 외부 call의 fn이 call_expression일 때 그 call_expression 자체도 calls edge로 발화
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/x.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('P2: chain call_expression fn 재귀 — Cron(expr)(...)', () => {
  it('CC-01: Cron(cronExpression)(target, key, descriptor) — 내부 Cron 호출도 calls edge', () => {
    const r = parse(`
      import { Cron } from '@nestjs/schedule'
      export function CustomCron(cronExpression: string) {
        return (target: object, key: string, descriptor: PropertyDescriptor) => {
          return Cron(cronExpression)(target, key, descriptor)
        }
      }
    `)
    // Cron(expr)(...) 의 chain root 호출(Cron(expr))도 calls edge 로 발화돼야 한다 (P2 재귀).
    // 단, 이 호출은 CustomCron 이 반환하는 화살표(returnedFunction) 본문 안에서 일어나므로,
    // nested-executable 설계상 그 화살표는 별도 노드가 되고 Cron 호출은 그 노드에 귀속된다.
    // (CustomCron --contains--> 반환콜백 --calls--> Cron 으로 도달 가능 — 도달성 손실 없음.)
    const cronCall = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_symbol === 'Cron',
    )
    expect(cronCall, 'Cron(cronExpression) 내부 호출 → calls edge 발화').toBeDefined()
    // 소유자 = CustomCron 의 반환 콜백 노드
    const owner = r.nodes.find((n) => n.id === cronCall!.source_id)
    expect(owner?.name, 'Cron 호출 소유자 = CustomCron 의 반환 콜백').toContain('CustomCron')
    // CustomCron 이 그 콜백을 contains → CustomCron 에서 Cron 까지 도달 가능
    const contains = r.edges.find(
      (e) =>
        e.relation === 'contains' &&
        e.source_id.endsWith(':CustomCron') &&
        e.target_id === cronCall!.source_id,
    )
    expect(contains, 'CustomCron --contains--> 반환 콜백 (도달 가능)').toBeDefined()
  })

  it('CC-02: a()(b)(c) — 3-level chain의 모든 fn 호출 발화', () => {
    const r = parse(`
      function helper() { return null }
      export function fn() {
        return helper()(arg1)(arg2)
      }
    `)
    const helperCall = r.edges.find(
      (edge) =>
        edge.relation === 'calls' &&
        edge.target_symbol === 'helper' &&
        edge.source_id.endsWith(':fn'),
    )
    expect(helperCall, 'helper() 호출 (chain root)').toBeDefined()
  })
})
