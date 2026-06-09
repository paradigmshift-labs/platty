// P8: DI class의 arrow fn field (property 타입) → resolveDICall 매칭
// 사용자 누락 의문 — heroines SlackClient.errorMessage = (title) => ... 패턴
// 어댑터는 property 노드로 발화 → F5 methodsByClassId만 lookup해서 fail
import { describe, it, expect } from 'vitest'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls.js'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap } from '@/pipeline_modules/build_graph/types.js'

function mkNode(o: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string }): CodeNodeRaw {
  return { repo_id: 'r1', line_start: 1, line_end: 5, signature: null, exported: true, parse_status: 'ok', is_test: false, test_type: null, is_async: false, jsdoc: null, ...o }
}
function mkEdge(o: Partial<CodeEdgeRaw> & { source_id: string; relation: CodeEdgeRaw['relation'] }): CodeEdgeRaw {
  return { repo_id: 'r1', target_id: null, target_specifier: null, target_symbol: null, source: 'static', resolve_status: 'pending', ...o }
}

describe('P8: DI class의 arrow fn field property → resolveDICall 매칭', () => {
  it('DP-01: SlackClient.errorMessage = arrow fn (property type) — DI chain resolve', async () => {
    const SLACK = 'src/slack.client.ts'
    const USECASE = 'src/usecase.ts'
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${SLACK}`, type: 'file', name: 'file', file_path: SLACK }),
      mkNode({ id: `r1:${SLACK}:SlackClient`, type: 'class', name: 'SlackClient', file_path: SLACK }),
      // arrow fn field — property type (heroines 패턴)
      mkNode({ id: `r1:${SLACK}:SlackClient.errorMessage`, type: 'property', name: 'SlackClient.errorMessage', file_path: SLACK }),
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase`, type: 'class', name: 'Usecase', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase.run`, type: 'method', name: 'Usecase.run', file_path: USECASE }),
    ]
    const constructorDIMap: ConstructorDIMap = new Map([
      [`r1:${USECASE}:Usecase`, [{ fieldName: 'slackClient', typeName: 'SlackClient' }]],
    ])
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}:Usecase.run`,
        relation: 'calls',
        target_specifier: 'this.slackClient.errorMessage',
        target_symbol: 'errorMessage',
        chain_path: 'this.slackClient',
      }),
    ]
    const result = await resolveCalls(edges, nodes, constructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls')
    expect(callEdge!.resolve_status).toBe('resolved')
    expect(callEdge!.target_id).toBe(`r1:${SLACK}:SlackClient.errorMessage`)
  })

  it('DP-02: 같은 class에 method + property 둘 다 — method 우선 (regression)', async () => {
    const SVC = 'src/svc.ts'
    const USECASE = 'src/usecase.ts'
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${SVC}`, type: 'file', name: 'file', file_path: SVC }),
      mkNode({ id: `r1:${SVC}:Svc`, type: 'class', name: 'Svc', file_path: SVC }),
      mkNode({ id: `r1:${SVC}:Svc.run`, type: 'method', name: 'Svc.run', file_path: SVC }),  // method
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase`, type: 'class', name: 'Usecase', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:Usecase.fn`, type: 'method', name: 'Usecase.fn', file_path: USECASE }),
    ]
    const constructorDIMap: ConstructorDIMap = new Map([
      [`r1:${USECASE}:Usecase`, [{ fieldName: 'svc', typeName: 'Svc' }]],
    ])
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}:Usecase.fn`,
        relation: 'calls',
        target_specifier: 'this.svc.run',
        target_symbol: 'run',
        chain_path: 'this.svc',
      }),
    ]
    const result = await resolveCalls(edges, nodes, constructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls')
    expect(callEdge!.resolve_status).toBe('resolved')
    expect(callEdge!.target_id).toBe(`r1:${SVC}:Svc.run`)
  })
})
