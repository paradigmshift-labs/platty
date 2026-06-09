/**
 * F5-1: explicit_gap → D9/whitelist fallback 차단 conflict 해소
 *
 * 문제: tryFieldOriginDispatch가 origin=internal(X) + X에 method 누락 시 explicit_gap=true 리턴.
 *      이후 dispatchCallsEdge에서 D9/P13/P18 모두 `!result.explicit_gap` 조건으로 차단.
 *      → cross-file에 같은 symbol 있어도 missed (false negative).
 *
 * fix: tryFieldOriginDispatch가 explicit_gap을 표시하더라도 D9 cross-file lookup은 시도.
 *      cross-file resolved되면 그 결과 우선. 모두 실패 시 explicit_gap failed 유지.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap, FieldOriginsMap } from '@/pipeline_modules/build_graph/types'

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
  // imports edge resolve simulation
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
  const edges = await resolveCalls(allEdges, allNodes, diMap, new Map(), allOrigins)
  return { nodes: allNodes, edges }
}

function findCall(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.find(
    (e) => e.relation === 'calls' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

describe('F5-1: explicit_gap → D9 fallback 차단 conflict', () => {
  it('EG-1 — 우리 graph 안 type method 누락 + cross-file 같은 이름 free function 있음 → failed 유지 (정직)', async () => {
    // 검토 결과: explicit_gap=failed가 false positive 방지에 정직.
    // 'this.svc.method'는 svc.method 호출 의도 — Svc에 정의 없으면 진짜 갭.
    // cross-file에 'method' free function이 있어도 그건 의미 다름 (false positive 위험).
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/svc.ts',
          source: `
            export class Svc { other() { return 1 } }
            export function method(x: number) { return x }
          `,
        },
        {
          filePath: 'src/x.ts',
          source: `
            import { Svc, method } from 'src/svc'
            export class Owner {
              constructor(private readonly svc: Svc) {}
              fn() {
                method(1);  // free function 호출 (정확)
                this.svc.method(1);  // Svc.method — 진짜 갭
              }
            }
          `,
        },
      ],
    })
    // free 'method(1)' 호출은 cross-file resolved
    const free = edges.find(
      (e) => e.relation === 'calls' &&
             e.target_symbol === 'method' &&
             e.target_specifier === 'src/svc' &&
             e.source_id.endsWith(':Owner.fn'),
    )
    expect(free?.resolve_status).toBe('resolved')

    // 'this.svc.method' chain은 Svc에 method 없음 → failed (진짜 갭, 정직)
    const chained = edges.find(
      (e) => e.relation === 'calls' &&
             e.target_symbol === 'method' &&
             e.target_specifier === 'this.svc.method' &&
             e.source_id.endsWith(':Owner.fn'),
    )
    expect(chained?.resolve_status).toBe('failed')
  })

  it('EG-2 — 우리 graph 안 type 확실 + 어디에도 unknownMethod 없음 → failed (진짜 갭, 보존)', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class Svc { other() { return 1 } }
            export class Owner {
              constructor(private readonly svc: Svc) {}
              fn() { this.svc.unknownMethod(1) }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'unknownMethod', ':Owner.fn')
    expect(e!.resolve_status).toBe('failed')  // 진짜 갭
  })

  it('EG-3 — 우리 wrapper의 method 정의 있음 → resolved (P15-Lite 그대로)', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class CacheWrapper { set(k: string, v: any) { return v } }
            export class Owner {
              constructor(private readonly cache: CacheWrapper) {}
              fn() { this.cache.set('k', 'v') }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
  })

  it('EG-4 — 우리 wrapper에 ORM method 누락 + ORM whitelist symbol → external (P18 elevate)', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class CacheWrapper { other() { return 1 } }
            export class Owner {
              constructor(private readonly cache: CacheWrapper) {}
              fn() { this.cache.deleteMany({}) }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'deleteMany', ':Owner.fn')
    // 현재: explicit_gap=true → P18 ORM whitelist 차단 → failed
    // fix 후: P18 elevate → external (Prisma deleteMany 추정)
    // 단 Owner.cache의 type이 우리 graph 안 CacheWrapper라 의미상 internal로 봐야 — failed가 정직?
    //   → 결정: explicit_gap 유지 (우리 graph 안 type 확신 + method 없음 = 진짜 갭).
    //   ORM whitelist는 'this.X' 분기 자체에서 제외(현재 동작) — 시나리오 자체가 충돌.
    // 따라서 EG-4는 'failed' 유지가 정직 (우리 wrapper인데 ORM method라고 추정하면 false positive)
    expect(e!.resolve_status).toBe('failed')
  })
})
