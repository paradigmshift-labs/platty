/**
 * P17 (P16-C2): 동명 class 여러 개일 때 owner file의 import path로 정확한 class 매칭
 *
 * heroines 패턴: SolapiService가 src/apiv1/, src/apiv1.1/, src/services/ 세 file에 동명 정의됨.
 * Owner는 import 문으로 어느 SolapiService를 쓰는지 명시 — 그 path 따라가서 정확한 class 매칭.
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

  for (const f of opts.files) {
    const r = await adapter.parseFile(f.source, f.filePath, 'r1')
    const fileNode: CodeNodeRaw = {
      id: `r1:${f.filePath}`, repo_id: 'r1', type: 'file', file_path: f.filePath, name: 'file',
      line_start: null, line_end: null, signature: null, exported: false, parse_status: 'ok',
      is_test: false, test_type: null, is_async: false, jsdoc: null,
    }
    allNodes.push(fileNode, ...r.nodes)
    allEdges.push(...r.edges)
    for (const cp of r.constructorParams) {
      const cls = r.nodes.find((n) => n.type === 'class' && n.name === cp.className)
      if (cls) diMap.set(cls.id, cp.params)
    }
    if (r.fieldOrigins) for (const [k, v] of r.fieldOrigins) allOrigins.set(k, v)
  }

  // imports edge target_id를 미리 채움 (F3a 시뮬레이션) — 동명 file path 매칭
  for (const e of allEdges) {
    if (e.relation !== 'imports') continue
    if (e.target_id) continue
    const spec = e.target_specifier
    if (!spec) continue
    // 'src/foo/bar' → 'src/foo/bar.ts' lookup
    const candidates = [`${spec}.ts`, `${spec}/index.ts`]
    for (const c of candidates) {
      const f = allNodes.find((n) => n.type === 'file' && n.file_path === c)
      if (f) { e.target_id = f.id; e.resolve_status = 'resolved'; break }
    }
  }

  const edges = await resolveCalls(allEdges, allNodes, diMap, new Map(), allOrigins)
  return { nodes: allNodes, edges }
}

function findCall(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.find(
    (e) => e.relation === 'calls' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

describe('P17 (C2): import path로 동명 class 정확 매칭', () => {
  it('IM-01 — 동명 class 2개, owner는 v2에서 import → v2 class의 method 매칭 (resolved)', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/apiv1/svc.ts',
          source: `
            export class SolapiService {
              // sendFriendTalk 정의 없음 (v1)
              other() { return 1 }
            }
          `,
        },
        {
          filePath: 'src/services/svc.ts',
          source: `
            export class SolapiService {
              sendFriendTalk(msg: string) { return msg }
            }
          `,
        },
        {
          filePath: 'src/usecase.ts',
          source: `
            import { SolapiService } from 'src/services/svc'
            export class Owner {
              constructor(private readonly solapiService: SolapiService) {}
              fn() { this.solapiService.sendFriendTalk('hi') }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'sendFriendTalk', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
    // target은 services/svc.ts 의 SolapiService.sendFriendTalk이어야 (apiv1/svc.ts 아님)
    expect(e!.target_id).toMatch(/services\/svc\.ts:SolapiService\.sendFriendTalk$/)
  })

  it('IM-02 — 동명 class 2개, owner가 사전순 first(apiv1)에서 import → apiv1 class 매칭', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/apiv1/svc.ts',
          source: `
            export class SolapiService {
              sendFriendTalk(msg: string) { return msg }
            }
          `,
        },
        {
          filePath: 'src/services/svc.ts',
          source: `
            export class SolapiService {
              other() { return 1 }
              // sendFriendTalk 없음 (v2 변경됨)
            }
          `,
        },
        {
          filePath: 'src/usecase.ts',
          source: `
            import { SolapiService } from 'src/apiv1/svc'
            export class Owner {
              constructor(private readonly solapi: SolapiService) {}
              fn() { this.solapi.sendFriendTalk('hi') }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'sendFriendTalk', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toMatch(/apiv1\/svc\.ts:SolapiService\.sendFriendTalk$/)
  })

  it('IM-03 — 동명 class 1개 (회귀 방지) → 기존 동작 그대로 resolved', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/svc.ts',
          source: `export class Svc { method(x: number) { return x } }`,
        },
        {
          filePath: 'src/usecase.ts',
          source: `
            import { Svc } from 'src/svc'
            export class Owner {
              constructor(private readonly svc: Svc) {}
              fn() { this.svc.method(1) }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'method', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
  })

  it('IM-04 — owner의 import에 typeName 없음 (이상 케이스) → fallback 첫 매칭', async () => {
    // typeName이 import-bound 아닌 경우 (e.g. 같은 file 안 정의) — 첫 매칭으로 fallback
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/apiv1/svc.ts',
          source: `
            export class SolapiService {
              other() { return 1 }
            }
          `,
        },
        {
          filePath: 'src/usecase.ts',
          source: `
            export class SolapiService {
              sendFriendTalk(msg: string) { return msg }
            }
            export class Owner {
              constructor(private readonly solapi: SolapiService) {}
              fn() { this.solapi.sendFriendTalk('hi') }
            }
          `,
        },
      ],
    })
    // owner와 같은 file 안 SolapiService 매칭 (import 안 거침)
    const e = findCall(edges, 'sendFriendTalk', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toMatch(/usecase\.ts:SolapiService\.sendFriendTalk$/)
  })
})
