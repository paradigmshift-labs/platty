/**
 * DOC-2: namespace export chain calls edge (SGlobal.X.fn)
 *
 * `SGlobal.calculator.calculate(x)` 같은 nested namespace member 호출이 calls edge로
 * 추적 안 됨. heroines 14개 chain 누락 실측.
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

describe('DOC-2: namespace export chain calls edge', () => {
  it('NC-1 — SGlobal.calculate(x) (depth 2: namespace member function) → calls resolved', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/global.ts',
          source: `
            export namespace SGlobal {
              export function calculate(x: number) { return x * 2 }
            }
          `,
        },
        {
          filePath: 'src/x.ts',
          source: `
            import { SGlobal } from 'src/global'
            export class Owner {
              fn() { return SGlobal.calculate(1) }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'calculate', ':Owner.fn')
    expect(e?.resolve_status).toBe('resolved')
    expect(e?.target_id).toMatch(/global\.ts:SGlobal\.calculate$/)
  })

  it('NC-2 — Domain.UserRules.validate(u) (depth 3: nested namespace member) → calls 발화', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/domain.ts',
          source: `
            export namespace Domain {
              export namespace UserRules {
                export function validate(u: any) { return true }
              }
            }
          `,
        },
        {
          filePath: 'src/x.ts',
          source: `
            import { Domain } from 'src/domain'
            export class Owner {
              fn() { return Domain.UserRules.validate({}) }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'validate', ':Owner.fn')
    expect(e).toBeDefined()
    // 단언 약함 — 정확한 target_id 매핑은 cross-file nested namespace 추적 필요
    // 적어도 calls edge 발화는 되어야
  })

  it('NC-3 — namespace const arrow fn (`export const fn = (x) => ...`) → calls 발화', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/util.ts',
          source: `
            export namespace Util {
              export const upper = (s: string) => s.toUpperCase()
            }
          `,
        },
        {
          filePath: 'src/x.ts',
          source: `
            import { Util } from 'src/util'
            export function caller() { return Util.upper('hi') }
          `,
        },
      ],
    })
    const e = findCall(edges, 'upper', ':caller')
    expect(e).toBeDefined()
  })
})
