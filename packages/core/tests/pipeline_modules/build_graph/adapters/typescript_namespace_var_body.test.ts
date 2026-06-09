// P1: namespace 안 export const arrow fn body의 calls walk
// SOT: HB-02 BS — userRepository.X.fn() body 안 호출이 graph에 안 들어감
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/x.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('P1: namespace 안 var arrow function body calls walk', () => {
  it('NV-01: namespace 안 export const arrow fn body의 helperFn 호출 → calls edge', () => {
    const r = parse(`
      export namespace ns {
        export const fn = async (id: string) => {
          return helperFn(id)
        }
      }
      function helperFn(_x: string) { return _x }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'calls' &&
        edge.source_id.endsWith(':ns.fn') &&
        edge.target_symbol === 'helperFn',
    )
    expect(e, 'namespace fn body 안 helperFn calls').toBeDefined()
  })

  it('NV-02: nested namespace 안 fn body → calls', () => {
    const r = parse(`
      export namespace outer {
        export namespace inner {
          export const fn = async () => {
            return getPrismaDB()
          }
        }
      }
      function getPrismaDB() { return null }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'calls' &&
        edge.source_id.endsWith(':outer.inner.fn') &&
        edge.target_symbol === 'getPrismaDB',
    )
    expect(e, 'nested namespace fn body calls').toBeDefined()
  })

  it('NV-03: namespace fn body 안 namespace member 호출 (json.transform)', () => {
    const r = parse(`
      export namespace userRepository {
        export namespace json {
          export const transform = (input: any) => input
        }
        export const fn = async () => {
          return json.transform({ id: 1 })
        }
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'calls' &&
        edge.source_id.endsWith(':userRepository.fn') &&
        edge.target_symbol === 'transform',
    )
    expect(e, 'namespace fn body 안 nested namespace member call').toBeDefined()
  })

  it('NV-04: namespace arrow initializer remains owned by namespace var, not callback node', () => {
    const r = parse(`
      export namespace outer {
        export namespace inner {
          export const fn = async () => {
            return service.load()
          }
        }
      }
    `)

    const callbackNodes = r.nodes.filter((node) => node.origin_kind === 'callback')
    expect(callbackNodes).toHaveLength(0)

    const e = r.edges.find(
      (edge) =>
        edge.relation === 'calls' &&
        edge.target_symbol === 'load',
    )
    expect(e).toBeDefined()
    expect(e!.source_id).toBe('r1:src/x.ts:outer.inner.fn')
  })
})
