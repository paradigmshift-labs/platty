/**
 * DOC-3: DI instance method chain — extends chain 따라 부모 method 매칭
 *
 * `this.svc.method()` — svc=Svc(우리 graph), method가 Svc 부모(BaseSvc)에 정의된 경우.
 * 현재 P11/P12는 직접 정의만 매칭. extends edge 따라 부모 method까지 lookup.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'
import { resolveTypeRefs } from '@/pipeline_modules/build_graph/f4_resolve_type_refs'
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
  const sourceFiles = opts.files.map((f) => ({ path: f.filePath, content: f.source, isTest: false }))
  const afterF4 = await resolveTypeRefs(allEdges, allNodes, sourceFiles)
  const edges = await resolveCalls(afterF4, allNodes, diMap, new Map(), allOrigins)
  return { nodes: allNodes, edges }
}

function findCall(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.find(
    (e) => e.relation === 'calls' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

describe('DOC-3: DI extends chain — 부모 class method 매칭', () => {
  it('DE-1 — this.svc.method() — Svc extends BaseSvc, method가 BaseSvc에 정의 → resolved (BaseSvc.method)', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class BaseSvc {
              method() { return 1 }
            }
            export class Svc extends BaseSvc {
              other() { return 2 }
            }
            export class Owner {
              constructor(private readonly svc: Svc) {}
              fn() { return this.svc.method() }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'method', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
    // 부모 BaseSvc.method 매핑
    expect(e!.target_id).toMatch(/BaseSvc\.method$/)
  })

  it('DE-2 — this.svc.X.Y() (P12 deep chain, 회귀 안전망) — 직접 정의 있을 때', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class Inner { run() { return 1 } }
            export class Svc { inner: Inner = new Inner() }
            export class Owner {
              constructor(private readonly svc: Svc) {}
              fn() { return this.svc.inner.run() }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'run', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
  })

  it('DE-3 — DI 없이 field initializer (`private slack = new SlackClient()`) — P15-Lite resolved', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class SlackClient { send(msg: string) { return msg } }
            export class Owner {
              private slack = new SlackClient()
              fn() { return this.slack.send('hi') }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'send', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
  })

  it('DE-4 — extends chain 깊이 2 (Svc → BaseSvc → RootSvc, method가 RootSvc에 정의) → resolved', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class RootSvc {
              method() { return 1 }
            }
            export class BaseSvc extends RootSvc {}
            export class Svc extends BaseSvc {}
            export class Owner {
              constructor(private readonly svc: Svc) {}
              fn() { return this.svc.method() }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'method', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toMatch(/RootSvc\.method$/)
  })
})
