/**
 * DOC-1: 에러 상수 변수 BFS reachable 보장
 *
 * `throw new BadRequestException(STORE_ORDER_NOT_FOUND)` — STORE_ORDER_NOT_FOUND가 import-bound 상수.
 * P19 depends_on edge는 발화하지만 specifier=URI(외부)일 때 target_id=null → BFS reachable에서 제외.
 * fix: 우리 src 정의면 cross-file resolve로 target_id 채워야 LLM build_docs 비엔나 소시지에 포함.
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
  // F4 (type_ref + depends_on resolve) → F5 (calls resolve)
  const sourceFiles = opts.files.map((f) => ({ path: f.filePath, content: f.source, isTest: false }))
  const afterF4 = await resolveTypeRefs(allEdges, allNodes, sourceFiles)
  const edges = await resolveCalls(afterF4, allNodes, diMap, new Map(), allOrigins)
  return { nodes: allNodes, edges }
}

describe('DOC-1: 에러 상수 변수 BFS reachable', () => {
  it('CR-1 — `throw new Err(STORE_ORDER_NOT_FOUND)` + 같은 src 정의 → depends_on resolved (target_id 채움)', async () => {
    const { edges, nodes } = await runE2E({
      files: [
        {
          filePath: 'src/errors.ts',
          source: `export const STORE_ORDER_NOT_FOUND = 'STORE_ORDER_NOT_FOUND'`,
        },
        {
          filePath: 'src/svc.ts',
          source: `
            import { STORE_ORDER_NOT_FOUND } from 'src/errors'
            export class Svc {
              fn() { throw new Error(STORE_ORDER_NOT_FOUND) }
            }
          `,
        },
      ],
    })
    const dep = edges.find(
      (e) => e.relation === 'depends_on' &&
             e.target_symbol === 'STORE_ORDER_NOT_FOUND' &&
             e.source_id.endsWith(':Svc.fn'),
    )
    expect(dep).toBeDefined()
    expect(dep!.resolve_status).toBe('resolved')
    expect(dep!.target_id).toMatch(/errors\.ts:STORE_ORDER_NOT_FOUND$/)
    // BFS 시 reachable: source(Svc.fn) → target(STORE_ORDER_NOT_FOUND variable node) 가능
    const targetNode = nodes.find((n) => n.id === dep!.target_id)
    expect(targetNode).toBeDefined()
    expect(targetNode!.type).toBe('variable')
  })

  it('CR-2 — `return ERROR_CODES.INVALID` + ERROR_CODES src 정의 → root depends_on resolved', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/errors.ts',
          source: `export const ERROR_CODES = { INVALID: 'INVALID', NOT_FOUND: 'NOT_FOUND' } as const`,
        },
        {
          filePath: 'src/svc.ts',
          source: `
            import { ERROR_CODES } from 'src/errors'
            export class Svc {
              fn() { return ERROR_CODES.INVALID }
            }
          `,
        },
      ],
    })
    const dep = edges.find(
      (e) => e.relation === 'depends_on' &&
             e.target_symbol === 'ERROR_CODES' &&
             e.source_id.endsWith(':Svc.fn'),
    )
    expect(dep).toBeDefined()
    expect(dep!.resolve_status).toBe('resolved')
    expect(dep!.target_id).toMatch(/errors\.ts:ERROR_CODES$/)
  })
})
