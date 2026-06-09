/**
 * F5-2: pickClassNodeByImport — import miss 시 method-aware fallback
 *
 * 현재 (P17): 동명 class 다중일 때 owner file의 imports edge resolved → 정확 매칭.
 *             import 못 찾으면 owner file 자체 정의 → 사전순 첫 매칭 fallback.
 *
 * 문제: imports edge가 pending/failed면 사전순 첫 매칭 → 잘못된 class 선택 가능.
 * fix: 사전순 첫 매칭 전에 'method 정의가 있는 class' 우선 시도.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap, FieldOriginsMap } from '@/pipeline_modules/build_graph/types'

interface FileSpec { filePath: string; source: string }

async function runE2E(opts: { files: FileSpec[]; resolveImports?: boolean }) {
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
  if (opts.resolveImports !== false) {
    for (const e of allEdges) {
      if (e.relation !== 'imports' || e.target_id) continue
      const spec = e.target_specifier
      if (!spec || !spec.startsWith('src/')) continue
      const candidates = [`${spec}.ts`, `${spec}/index.ts`]
      for (const c of candidates) {
        const f = allNodes.find((n) => n.type === 'file' && n.file_path === c)
        if (f) { e.target_id = f.id; e.resolve_status = 'resolved'; break }
      }
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

describe('F5-2: pickClassNodeByImport — import miss 시 method-aware fallback', () => {
  it('PC-1 — 동명 class 3개 + imports pending(F3a 미해결) + 한 곳만 method 정의 → method-aware 선택', async () => {
    const { edges } = await runE2E({
      resolveImports: false,  // imports edge pending 유지
      files: [
        {
          filePath: 'src/apiv1/svc.ts',
          source: `export class SolapiService { other() { return 1 } }`,
        },
        {
          filePath: 'src/apiv1.1/svc.ts',
          source: `export class SolapiService { other2() { return 2 } }`,
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
    // fix 후: method 정의된 services/svc.ts SolapiService 매칭
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toMatch(/services\/svc\.ts:SolapiService\.sendFriendTalk$/)
  })

  it('PC-2 — 동명 class 3개 + imports resolved + 정확한 file 매칭 (P17 정상 회귀)', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/apiv1/svc.ts',
          source: `export class SolapiService { sendFriendTalk(m: string) { return m } }`,
        },
        {
          filePath: 'src/services/svc.ts',
          source: `export class SolapiService { sendFriendTalk(m: string) { return 'v2' } }`,
        },
        {
          filePath: 'src/usecase.ts',
          source: `
            import { SolapiService } from 'src/services/svc'
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
    // import path가 'src/services/svc'이라 v2 우선
    expect(e!.target_id).toMatch(/services\/svc\.ts:SolapiService\.sendFriendTalk$/)
  })

  it('PC-3 — 동명 class 3개 + 모두 method 정의 + import 못 찾음 → 첫 매칭(현 동작 유지)', async () => {
    const { edges } = await runE2E({
      resolveImports: false,
      files: [
        {
          filePath: 'src/a/svc.ts',
          source: `export class S { method() { return 'a' } }`,
        },
        {
          filePath: 'src/b/svc.ts',
          source: `export class S { method() { return 'b' } }`,
        },
        {
          filePath: 'src/usecase.ts',
          source: `
            export class Owner {
              constructor(private readonly s: S) {}
              fn() { this.s.method() }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'method', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
    // 모두 method 정의 — fallback 첫 매칭(사전순)이라도 OK (LLM은 method 정의 본문 본다)
  })

  it('PC-4 — 동명 class 2개 + 한 곳만 method 정의 + owner 같은 file에 다른 동명 → method-aware 우선', async () => {
    const { edges } = await runE2E({
      resolveImports: false,
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class Svc { other() { return 1 } }
            export class Owner {
              constructor(private readonly svc: Svc) {}
              fn() { this.svc.findOne() }
            }
          `,
        },
        {
          filePath: 'src/y.ts',
          source: `export class Svc { findOne() { return null } }`,
        },
      ],
    })
    const e = findCall(edges, 'findOne', ':Owner.fn')
    // fix 전: same-file Svc 우선 (사전순보다 same-file fallback) → other만 있으니 method 없음 → failed
    // fix 후: method-aware 우선 → src/y.ts의 Svc 매칭
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toMatch(/y\.ts:Svc\.findOne$/)
  })
})
