// P7: 함수 호출 인자의 import-bound identifier → depends_on edge
// 사용자 의도: error 상수 추적 (환각 위험 차단)
// 예: throw new BadRequestException(STORE_ORDER_NOT_FOUND) → STORE_ORDER_NOT_FOUND 노드 graph 연결
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/x.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('P7: 함수 호출 인자의 import-bound identifier → depends_on', () => {
  it('CR-01: throw new BadRequestException(STORE_ORDER_NOT_FOUND) → depends_on STORE_ORDER_NOT_FOUND', () => {
    const r = parse(`
      import { BadRequestException } from '@nestjs/common'
      import { STORE_ORDER_NOT_FOUND } from './error'
      export function fn() {
        throw new BadRequestException(STORE_ORDER_NOT_FOUND)
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'depends_on' &&
        edge.target_symbol === 'STORE_ORDER_NOT_FOUND' &&
        edge.source_id.endsWith(':fn'),
    )
    expect(e, 'STORE_ORDER_NOT_FOUND depends_on edge').toBeDefined()
    expect(e!.target_specifier).toBe('./error')
  })

  it('CR-02: 일반 fn(MY_CONST) 호출 — import-bound identifier 인자 → depends_on', () => {
    const r = parse(`
      import { MY_CONST } from './const'
      export function fn(handler: any) {
        handler(MY_CONST)
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'depends_on' &&
        edge.target_symbol === 'MY_CONST' &&
        edge.source_id.endsWith(':fn'),
    )
    expect(e, 'MY_CONST depends_on edge').toBeDefined()
  })

  it('CR-03: 다중 identifier 인자 — 모두 발화', () => {
    const r = parse(`
      import { A, B } from './consts'
      export function fn() {
        someCall(A, B)
      }
    `)
    const symbols = r.edges
      .filter((e) => e.relation === 'depends_on' && e.source_id.endsWith(':fn'))
      .map((e) => e.target_symbol)
    expect(symbols).toContain('A')
    expect(symbols).toContain('B')
  })

  it('CR-04: local variable 인자는 미발화 (false positive 차단)', () => {
    const r = parse(`
      export function fn() {
        const local = 'x'
        console.log(local)
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'depends_on' && edge.target_symbol === 'local',
    )
    expect(e, 'local var는 depends_on 미발화').toBeUndefined()
  })

  it('CR-05: literal 인자는 무관 (기존 동작)', () => {
    const r = parse(`
      export function fn() {
        someFn('literal-string', 42)
      }
    `)
    const dependsOn = r.edges.filter(
      (e) => e.relation === 'depends_on' && e.source_id.endsWith(':fn'),
    )
    expect(dependsOn.length).toBe(0)
  })
})
