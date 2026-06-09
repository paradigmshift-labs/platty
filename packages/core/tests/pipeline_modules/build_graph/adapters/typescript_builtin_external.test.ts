// P10: JS builtin global symbol → external 분류
// new Date(), Number(), Map() 등은 import 없이 사용 (globalThis)
// 어댑터 → resolveCalls(F5) 통과 후 분류 검증
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls.js'
import type { CodeNodeRaw, ConstructorDIMap } from '@/pipeline_modules/build_graph/types.js'

async function parseAndResolve(content: string, filePath = 'src/x.ts') {
  const adapter = new TypeScriptParserAdapter()
  const result = adapter.parseFile(content, filePath, 'r1')
  const fileNode: CodeNodeRaw = {
    id: `r1:${filePath}`, repo_id: 'r1', type: 'file', file_path: filePath, name: 'file',
    line_start: null, line_end: null, signature: null, exported: false, parse_status: 'ok',
    is_test: false, test_type: null, is_async: false, jsdoc: null,
  }
  const allNodes: CodeNodeRaw[] = [fileNode, ...result.nodes]
  const diMap: ConstructorDIMap = new Map()
  for (const cp of result.constructorParams) {
    const cls = result.nodes.find((n) => n.type === 'class' && n.name === cp.className)
    if (cls) diMap.set(cls.id, cp.params)
  }
  const edges = await resolveCalls(result.edges, allNodes, diMap, result.enumValues)
  return { nodes: allNodes, edges }
}

describe('P10: JS builtin global → external 분류', () => {
  it('BI-01: new Date() — Date는 builtin → external', async () => {
    const r = await parseAndResolve(`
      export function fn() {
        return new Date()
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_symbol === 'Date',
    )
    expect(e, 'Date calls edge').toBeDefined()
    expect(e!.resolve_status).toBe('external')
  })

  it('BI-02: new Map() — Map builtin → external', async () => {
    const r = await parseAndResolve(`
      export function fn() {
        return new Map<string, number>()
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_symbol === 'Map',
    )
    expect(e!.resolve_status).toBe('external')
  })

  it('BI-03: Number(x) — type cast builtin → external', async () => {
    const r = await parseAndResolve(`
      export function fn(x: unknown) {
        return Number(x)
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_symbol === 'Number',
    )
    expect(e!.resolve_status).toBe('external')
  })

  it('BI-04: 사용자 정의 Date alias — import-bound면 builtin 분류 안 거침', async () => {
    const r = await parseAndResolve(`
      import { Date as MyDate } from './my-date'
      export function fn() {
        return new MyDate()
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_symbol === 'MyDate',
    )
    expect(e).toBeDefined()
    expect(e!.resolve_status === 'external').toBe(false)
  })
})
