/**
 * D-1: Dart 3.0 modifier class (sealed/final/interface/base) 처리
 *
 * 현재 WASM grammar가 'sealed'/'final'/'interface'/'base' modifier를 ERROR로 처리.
 * → ERROR 노드 안에서 'class' 키워드 + identifier 패턴 추출 fallback 추가.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

describe('D-1: Dart 3.0 modifier class', () => {
  it('SC-1 — sealed class CounterState — class node 발화', async () => {
    const r = await parse(`sealed class CounterState {}`)
    const cls = r.nodes.find((n) => n.type === 'class' && n.name === 'CounterState')
    expect(cls).toBeDefined()
  })

  it('SC-2 — sealed parent + 자식 extends — extends edge 발화', async () => {
    const r = await parse(`
      sealed class CounterState {}
      class CounterValue extends CounterState {
        final int count;
        CounterValue(this.count);
      }
    `)
    const ex = r.edges.find(
      (e) => e.relation === 'extends' && e.target_symbol === 'CounterState' && e.source_id.endsWith(':CounterValue'),
    )
    expect(ex).toBeDefined()
  })

  it('SC-3 — final class — class node 발화', async () => {
    const r = await parse(`final class FinalThing {}`)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'FinalThing')).toBe(true)
  })

  it('SC-4 — interface class — class node 발화', async () => {
    const r = await parse(`interface class Movable {}`)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'Movable')).toBe(true)
  })

  it('SC-5 — base class — class node 발화', async () => {
    const r = await parse(`base class BaseThing {}`)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'BaseThing')).toBe(true)
  })
})
