/**
 * P16: heroines 잔여 failed 처리
 *
 * 1. specifier 멀티라인 공백 — `this.kysely\n      .selectFrom` fieldName 추출 실패 (~290건)
 * 2. arrow fn field self call — `private _fn = async () => {}` + `this._fn()` (~30건)
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'
import type {
  CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap, FieldOriginsMap,
} from '@/pipeline_modules/build_graph/types'

interface FileSpec { filePath: string; source: string }

async function runE2E(opts: { files: FileSpec[] }) {
  const adapter = new TypeScriptParserAdapter()
  const allNodes: CodeNodeRaw[] = []
  const allEdges: CodeEdgeRaw[] = []
  const diMap: ConstructorDIMap = new Map()
  const allOrigins: FieldOriginsMap = new Map()
  const classByName = new Map<string, CodeNodeRaw>()

  for (const f of opts.files) {
    const r = await adapter.parseFile(f.source, f.filePath, 'r1')
    const fileNode: CodeNodeRaw = {
      id: `r1:${f.filePath}`, repo_id: 'r1', type: 'file', file_path: f.filePath, name: 'file',
      line_start: null, line_end: null, signature: null, exported: false, parse_status: 'ok',
      is_test: false, test_type: null, is_async: false, jsdoc: null,
    }
    allNodes.push(fileNode, ...r.nodes)
    allEdges.push(...r.edges)
    for (const n of r.nodes) if (n.type === 'class') classByName.set(n.name, n)
    for (const cp of r.constructorParams) {
      const cls = r.nodes.find((n) => n.type === 'class' && n.name === cp.className)
      if (cls) diMap.set(cls.id, cp.params)
    }
    if (r.fieldOrigins) for (const [k, v] of r.fieldOrigins) allOrigins.set(k, v)
  }
  const edges = await resolveCalls(allEdges, allNodes, diMap, new Map(), allOrigins)
  return { nodes: allNodes, edges }
}

function findCall(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.find(
    (e) => e.relation === 'calls' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

describe('P16-A: specifier 멀티라인 공백 normalize', () => {
  it('A1 — `this.kysely\\n  .selectFrom` (DI Kysely 외부) → external_chain', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            import { Kysely } from 'kysely'
            export class Usecase {
              constructor(private readonly kysely: Kysely<any>) {}
              fn() {
                const q = this.kysely
                  .selectFrom('users')
                return q
              }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'selectFrom', ':Usecase.fn')
    expect(e!.resolve_status).toBe('external_chain')
  })

  it('A2 — `this.svc\\n  .method` (DI 우리 graph) → resolved', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class Svc { method(x: number) { return x } }
            export class Owner {
              constructor(private readonly svc: Svc) {}
              fn() {
                return this.svc
                  .method(1)
              }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'method', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
  })

  it('A3 — `this.kysely\\n  .selectFrom(...)\\n  .innerJoin(...)` (depth 3+ 멀티라인) → 모두 external_chain', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            import { Kysely } from 'kysely'
            export class Usecase {
              constructor(private readonly kysely: Kysely<any>) {}
              fn() {
                const q = this.kysely
                  .selectFrom('users')
                  .innerJoin('orders', 'users.id', 'orders.userId')
                return q
              }
            }
          `,
        },
      ],
    })
    expect(findCall(edges, 'selectFrom', ':Usecase.fn')?.resolve_status).toBe('external_chain')
    expect(findCall(edges, 'innerJoin', ':Usecase.fn')?.resolve_status).toBe('external_chain')
  })
})

describe('P16-B: arrow fn field self call', () => {
  it('B1 — `private _fn = async () => {}` + `this._fn()` 같은 class → resolved (target=Class._fn property)', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class S {
              private _helper = async (x: number) => x + 1
              public async caller() {
                return this._helper(5)
              }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, '_helper', ':S.caller')
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toMatch(/S\._helper$/)
  })

  it('B2 — arrow fn field + 정의 없는 method 호출 → failed (진짜 갭)', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class S {
              private _helper = async () => 1
              public caller() {
                return this._undefined()
              }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, '_undefined', ':S.caller')
    expect(e!.resolve_status).toBe('failed')
  })
})
