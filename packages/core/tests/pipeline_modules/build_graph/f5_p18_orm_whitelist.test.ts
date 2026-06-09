/**
 * P18: 조건부 ORM 화이트리스트 (C 하이브리드)
 *
 * 조건: method 이름이 ORM 화이트리스트 + target_specifier가 this.* 아님 (this.X는 P15-Lite 영역)
 *      → failed 결과를 external로 elevate (정직한 추정)
 *
 * 화이트리스트 외 method, this.X 분기, 우리 class 정의된 동명 method는 영향 없음 (false positive 방지).
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
  const edges = await resolveCalls(allEdges, allNodes, diMap, new Map(), allOrigins)
  return { nodes: allNodes, edges }
}

function findCall(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.find(
    (e) => e.relation === 'calls' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

describe('P18-A: ORM 화이트리스트 elevate (external)', () => {
  it('A1 — local var의 deleteMany (specifier=null) → external', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class Repo {
              async fn(prisma: any) {
                await prisma.user.deleteMany({ where: {} })
              }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'deleteMany', ':Repo.fn')
    expect(e!.resolve_status).toBe('external')
  })

  it('A2 — local var의 await chain (findMany) → external', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class Repo {
              async fn(prisma: any) {
                const users = await prisma.user.findMany()
                return users
              }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'findMany', ':Repo.fn')
    expect(e!.resolve_status).toBe('external')
  })

  it('A3 — kysely selectFrom chain (specifier=null) → external', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class Repo {
              fn(kysely: any) {
                return kysely.selectFrom('users').where('id', '=', 1).execute()
              }
            }
          `,
        },
      ],
    })
    expect(findCall(edges, 'selectFrom', ':Repo.fn')!.resolve_status).toBe('external')
    expect(findCall(edges, 'where', ':Repo.fn')!.resolve_status).toBe('external')
    expect(findCall(edges, 'execute', ':Repo.fn')!.resolve_status).toBe('external')
  })

  it('A4 — import으로 가져온 함수 결과의 $queryRaw → external', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/util.ts',
          source: `export function getPrismaDB(tx?: any): any { return null }`,
        },
        {
          filePath: 'src/x.ts',
          source: `
            import { getPrismaDB } from 'src/util'
            export class Repo {
              fn(tx: any) {
                return getPrismaDB(tx).$queryRaw\`SELECT 1\`
              }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, '$queryRaw', ':Repo.fn')
    expect(e!.resolve_status).toBe('external')
  })
})

describe('P18-B: False positive 방지 — this.X / 우리 class 정의는 그대로', () => {
  it('B1 — 우리 class에 create 정의 + this.svc.create() (svc=우리 graph) → resolved (P15-Lite 우선)', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class UserService {
              create(data: any) { return data }
            }
            export class Owner {
              constructor(private readonly svc: UserService) {}
              fn() { this.svc.create({}) }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'create', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
  })

  it('B2 — 같은 class self call this.create() (정의 있음) → resolved', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class S {
              create(data: any) { return data }
              fn() { this.create({}) }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'create', ':S.fn')
    expect(e!.resolve_status).toBe('resolved')
  })

  it('B3 — 우리 graph에 deleteMany method 있는 class + DI 호출 → resolved (P15-Lite 우선)', async () => {
    // 우리 wrapper class도 deleteMany 같은 이름 쓸 수 있음
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class CustomWrapper {
              deleteMany(filter: any) { return filter }
            }
            export class Owner {
              constructor(private readonly w: CustomWrapper) {}
              fn() { this.w.deleteMany({}) }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'deleteMany', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
  })
})

describe('P18-C: 화이트리스트 외 method', () => {
  it('C1 — local var의 unknownOrmMethod (화이트리스트 외) → failed (보존)', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class Repo {
              fn(obj: any) {
                obj.totallyMadeUpMethod()
              }
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'totallyMadeUpMethod', ':Repo.fn')
    expect(e!.resolve_status).toBe('failed')
  })
})
