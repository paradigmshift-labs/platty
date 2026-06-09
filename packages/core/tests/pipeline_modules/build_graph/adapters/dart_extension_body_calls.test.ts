/**
 * D-10: Dart extension method body 안 calls 추적
 *
 * extension method body에서 호출되는 함수가 calls edge로 발화되는지 검증.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

describe('D-10: extension method body calls', () => {
  it('EB-1 — extension method 안 함수 호출 → calls edge', async () => {
    const r = await parse(`
      extension StringExt on String {
        String upper() {
          return this.toUpperCase();
        }
      }
    `)
    // upper method 자체 발화
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'upper')).toBe(true)
    // body 안 toUpperCase 호출 (chain method)
    const cm = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'toUpperCase' && e.source_id.endsWith(':StringExt.upper'),
    )
    expect(cm).toBeDefined()
  })

  it('EB-2 — extension on User에서 우리 method 호출', async () => {
    const r = await parse(`
      class User {
        String _name = '';
        String getName() { return this._name; }
      }
      extension UserExt on User {
        String label() {
          return this.getName();
        }
      }
    `)
    // label body의 this.getName() 호출
    const cm = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'getName' && e.source_id.endsWith(':UserExt.label'),
    )
    expect(cm).toBeDefined()
  })
})
