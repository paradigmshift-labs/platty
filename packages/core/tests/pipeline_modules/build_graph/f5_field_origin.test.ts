/**
 * P15-Lite: field origin 추적 — receiver type tracking 휴리스틱
 *
 * 목표: type annotation 없는 field도 RHS origin을 분석해서 외부/우리 graph 안인지 추측.
 *      heroines `private prisma = SGlobal.prismaPrimary` + `this.prisma.X.Y()` 류 처리.
 *
 * 카테고리:
 * - A: 어댑터 unit — parseFile() 호출, fieldOrigins map 검증
 * - B: F5 unit — origin tag로 chain 분류
 * - C: F5 unit — DI param explicit type 우선순위
 * - D: e2e — heroines 실 패턴 fixture
 * - E: F5 unit — false positive 방지
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

interface FileSpec { filePath: string; source: string }

async function parseFiles(files: FileSpec[]) {
  const adapter = new TypeScriptParserAdapter()
  const results = await Promise.all(
    files.map(async (f) => ({ filePath: f.filePath, ...(await adapter.parseFile(f.source, f.filePath, 'r1')) })),
  )
  return results
}

// origin lookup helper — adapter 결과의 fieldOrigins map에서 (className, fieldName)으로 조회
function getOrigin(parseResult: any, className: string, fieldName: string) {
  const fieldOrigins = parseResult.fieldOrigins as
    | Map<string, Map<string, { kind: string; typeName?: string }>>
    | undefined
  if (!fieldOrigins) return undefined
  for (const [classKey, fields] of fieldOrigins) {
    if (classKey.endsWith(`:${className}`) || classKey === className) {
      return fields.get(fieldName)
    }
  }
  return undefined
}

// ─────────────────────────────────────────────────────────
// A. 어댑터 — field origin 추출 (unit)
// ─────────────────────────────────────────────────────────

describe('P15-Lite [A]: field origin 추출 (어댑터 unit)', () => {
  it('A1 — RHS=SGlobal.prismaPrimary (SGlobal=우리 namespace) → 단위 단계는 unknown (F5 cross-file lookup으로 external 결정)', async () => {
    const [, repoRes] = await parseFiles([
      {
        filePath: 'src/SGlobal.ts',
        source: `
          import { PrismaClient } from '@prisma/client'
          export namespace SGlobal {
            export const prismaPrimary = new PrismaClient()
          }
        `,
      },
      {
        filePath: 'src/Repo.ts',
        source: `
          import { SGlobal } from 'src/SGlobal'
          export class Repo {
            private readonly prisma = SGlobal.prismaPrimary
          }
        `,
      },
    ])
    // 어댑터 단위: 'reference' (rootName=SGlobal, memberName=prismaPrimary).
    // F5 resolveFieldOriginsCrossFile에서 namespace member 'SGlobal.prismaPrimary' origin lookup → external로 elevate.
    expect(getOrigin(repoRes, 'Repo', 'prisma')).toEqual({
      kind: 'reference', rootName: 'SGlobal', memberName: 'prismaPrimary',
    })
  })

  it('A2 — RHS=new CacheWrapper() (같은 file class) → internal(CacheWrapper)', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          export class CacheWrapper { set(k: string, v: any) { return v } }
          export class Owner {
            private readonly cache = new CacheWrapper()
          }
        `,
      },
    ])
    expect(getOrigin(res, 'Owner', 'cache')).toEqual({ kind: 'internal', typeName: 'CacheWrapper' })
  })

  it('A3 — RHS=new RedisClient() (RedisClient import 외부) → external', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          import { RedisClient } from 'redis-external'
          export class Cache {
            private readonly client = new RedisClient()
          }
        `,
      },
    ])
    expect(getOrigin(res, 'Cache', 'client')).toEqual({ kind: 'external' })
  })

  it('A5 — RHS=LoggerFactory.create() (LoggerFactory import 외부) → external', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          import { LoggerFactory } from '@nestjs/common'
          export class Svc {
            private readonly logger = LoggerFactory.create()
          }
        `,
      },
    ])
    expect(getOrigin(res, 'Svc', 'logger')).toEqual({ kind: 'external' })
  })

  it('A6 — annotation 우선: cache: CacheWrapper = new CacheWrapper() → internal(CacheWrapper)', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          export class CacheWrapper {}
          export class Owner {
            private readonly cache: CacheWrapper = new CacheWrapper()
          }
        `,
      },
    ])
    expect(getOrigin(res, 'Owner', 'cache')).toEqual({ kind: 'internal', typeName: 'CacheWrapper' })
  })

  it('A7 — annotation 우선: prisma: PrismaClient = SGlobal.prismaPrimary → external', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          import { PrismaClient } from '@prisma/client'
          export class Repo {
            private readonly prisma: PrismaClient = null as any
          }
        `,
      },
    ])
    expect(getOrigin(res, 'Repo', 'prisma')).toEqual({ kind: 'external' })
  })

  it('A8 — RHS=arrow fn → function (chain receiver 아님)', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          export class Svc {
            arrow = async (x: number) => x
          }
        `,
      },
    ])
    expect(getOrigin(res, 'Svc', 'arrow')).toEqual({ kind: 'function' })
  })

  it('A9 — RHS=new Map() (builtin) → external', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          export class Cache {
            private readonly map = new Map<string, number>()
          }
        `,
      },
    ])
    expect(getOrigin(res, 'Cache', 'map')).toEqual({ kind: 'external' })
  })

  it('A10 — initializer 없음 + annotation만(외부 type): prisma!: PrismaClient → external', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          import { PrismaClient } from '@prisma/client'
          export class Repo {
            prisma!: PrismaClient
          }
        `,
      },
    ])
    expect(getOrigin(res, 'Repo', 'prisma')).toEqual({ kind: 'external' })
  })

  it('A11 — namespace export RHS = new ExternalClass() → namespace member origin=external', async () => {
    // SGlobal namespace 자체의 export 'prismaPrimary'에 origin 메타데이터 부여 (다른 file에서 lookup용)
    const [res] = await parseFiles([
      {
        filePath: 'src/SGlobal.ts',
        source: `
          import { PrismaClient } from '@prisma/client'
          export namespace SGlobal {
            export const prismaPrimary = new PrismaClient()
          }
        `,
      },
    ])
    // namespace member도 fieldOrigins에 등록 (key=namespace name, field=member name)
    expect(getOrigin(res, 'SGlobal', 'prismaPrimary')).toEqual({ kind: 'external' })
  })

  it('A12 — namespace export RHS = new InternalThing() → namespace member origin=internal', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          export class InternalThing { fn() { return 1 } }
          export namespace MyNs {
            export const helper = new InternalThing()
          }
        `,
      },
    ])
    expect(getOrigin(res, 'MyNs', 'helper')).toEqual({ kind: 'internal', typeName: 'InternalThing' })
  })

  it('A13 — namespace export 자체 annotation: export const x: ExternalType → external', async () => {
    const [res] = await parseFiles([
      {
        filePath: 'src/x.ts',
        source: `
          import { ExternalType } from 'ext-pkg'
          export namespace MyNs {
            export const x: ExternalType = null as any
          }
        `,
      },
    ])
    expect(getOrigin(res, 'MyNs', 'x')).toEqual({ kind: 'external' })
  })
})

// ─────────────────────────────────────────────────────────
// B/C/E. F5 — origin tag로 chain 분류 (e2e through runBuildGraph 또는 resolveCalls)
// ─────────────────────────────────────────────────────────

import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'
import type {
  CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap, FieldOriginsMap,
} from '@/pipeline_modules/build_graph/types'

interface RunOpts {
  files: FileSpec[]
}

async function runE2EWithOrigins(opts: RunOpts) {
  const adapter = new TypeScriptParserAdapter()
  const allNodes: CodeNodeRaw[] = []
  const allEdges: CodeEdgeRaw[] = []
  const diMap: ConstructorDIMap = new Map()
  const allOrigins: FieldOriginsMap = new Map()
  const allConstructorParams: { className: string; params: any[] }[] = []
  const allClassesByName = new Map<string, CodeNodeRaw>()

  for (const f of opts.files) {
    const r = await adapter.parseFile(f.source, f.filePath, 'r1')
    const fileNode: CodeNodeRaw = {
      id: `r1:${f.filePath}`, repo_id: 'r1', type: 'file', file_path: f.filePath, name: 'file',
      line_start: null, line_end: null, signature: null, exported: false, parse_status: 'ok',
      is_test: false, test_type: null, is_async: false, jsdoc: null,
    }
    allNodes.push(fileNode, ...r.nodes)
    allEdges.push(...r.edges)
    allConstructorParams.push(...r.constructorParams)
    for (const n of r.nodes) {
      if (n.type === 'class') allClassesByName.set(n.name, n)
    }
    if (r.fieldOrigins) {
      for (const [k, v] of r.fieldOrigins) allOrigins.set(k, v)
    }
  }
  for (const cp of allConstructorParams) {
    const cls = allClassesByName.get(cp.className)
    if (cls) diMap.set(cls.id, cp.params)
  }

  const resolved = await resolveCalls(allEdges, allNodes, diMap, new Map(), allOrigins)
  return { nodes: allNodes, edges: resolved, fieldOrigins: allOrigins }
}

function findCallE2E(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.find(
    (e) => e.relation === 'calls' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

function makeNode(overrides: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string }): CodeNodeRaw {
  return {
    repo_id: 'r1',
    line_start: 1,
    line_end: 1,
    signature: null,
    exported: true,
    parse_status: 'ok',
    is_test: false,
    test_type: null,
    is_async: false,
    jsdoc: null,
    ...overrides,
  }
}

function makeCall(overrides: Partial<CodeEdgeRaw> & { source_id: string; target_specifier: string }): CodeEdgeRaw {
  return {
    repo_id: 'r1',
    relation: 'calls',
    target_id: null,
    target_symbol: null,
    resolve_status: 'pending',
    ...overrides,
  }
}

describe('P15-Lite [B]: F5 — field origin tag로 chain 분류 (e2e)', () => {
  it('B1 — field origin=external + this.prisma.user.deleteMany() (DI 매칭 실패) → external_chain (또는 P13으로 external)', async () => {
    const { edges } = await runE2EWithOrigins({
      files: [
        {
          filePath: 'src/SGlobal.ts',
          source: `
            import { PrismaClient } from '@prisma/client'
            export namespace SGlobal {
              export const prismaPrimary = new PrismaClient()
            }
          `,
        },
        {
          filePath: 'src/Repo.ts',
          source: `
            import { SGlobal } from 'src/SGlobal'
            export class Repo {
              private readonly prisma = SGlobal.prismaPrimary
              fn() { this.prisma.user.deleteMany() }
            }
          `,
        },
      ],
    })
    const e = findCallE2E(edges, 'deleteMany', ':Repo.fn')
    expect(['external_chain', 'external']).toContain(e!.resolve_status)
  })

  it('B2 — field origin=external + this.promise.then() (proto 화이트리스트) → external (P13 elevate)', async () => {
    const { edges } = await runE2EWithOrigins({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            import { Promise as ExtPromise } from 'some-promise-lib'
            export class Owner {
              private readonly promise = new ExtPromise()
              fn() { this.promise.then((x: any) => x) }
            }
          `,
        },
      ],
    })
    const e = findCallE2E(edges, 'then', ':Owner.fn')
    expect(e!.resolve_status).toBe('external')
  })

  it('B3 — field origin=internal(CacheWrapper) + this.cache.set() (set 정의됨) → resolved', async () => {
    const { edges } = await runE2EWithOrigins({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class CacheWrapper { set(k: string, v: any) { return v } }
            export class Owner {
              private readonly cache = new CacheWrapper()
              fn() { this.cache.set('k', 'v') }
            }
          `,
        },
      ],
    })
    const e = findCallE2E(edges, 'set', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
  })

  it('B4 — field origin=internal(CacheWrapper) + this.cache.unknown() (정의 없음) → failed (진짜 갭)', async () => {
    const { edges } = await runE2EWithOrigins({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class CacheWrapper { other(k: string) { return k } }
            export class Owner {
              private readonly cache = new CacheWrapper()
              fn() { this.cache.unknownMethod('k') }
            }
          `,
        },
      ],
    })
    const e = findCallE2E(edges, 'unknownMethod', ':Owner.fn')
    expect(e!.resolve_status).toBe('failed')
  })

  it('B5 — reference origin이 namespace member로 풀리지 않으면 unknown으로 낮추고 기존 property fallback만 사용한다', async () => {
    const owner = makeNode({ id: 'r1:src/x.ts:Owner', type: 'class', name: 'Owner', file_path: 'src/x.ts' })
    const fn = makeNode({ id: 'r1:src/x.ts:Owner.fn', type: 'method', name: 'Owner.fn', file_path: 'src/x.ts' })
    const repoField = makeNode({ id: 'r1:src/x.ts:Owner.repo', type: 'property', name: 'Owner.repo', file_path: 'src/x.ts' })
    const call = makeCall({
      source_id: fn.id,
      target_specifier: 'this.repo.findMany',
      target_symbol: 'findMany',
    })
    const origins: FieldOriginsMap = new Map([
      [owner.id, new Map([
        ['repo', { kind: 'reference', rootName: 'MissingNamespace', memberName: 'repo' }],
      ])],
    ])

    const [resolved] = await resolveCalls([call], [owner, fn, repoField], new Map(), new Map(), origins)

    expect(resolved.resolve_status).toBe('resolved')
    expect(resolved.target_id).toBe(repoField.id)
  })

  it('B6 — internal origin typeName이 그래프에 없으면 보수적으로 기존 dispatch에 맡기고 failed로 남긴다', async () => {
    const owner = makeNode({ id: 'r1:src/x.ts:Owner', type: 'class', name: 'Owner', file_path: 'src/x.ts' })
    const fn = makeNode({ id: 'r1:src/x.ts:Owner.fn', type: 'method', name: 'Owner.fn', file_path: 'src/x.ts' })
    const call = makeCall({
      source_id: fn.id,
      target_specifier: 'this.repo.findMany',
      target_symbol: 'findMany',
    })
    const origins: FieldOriginsMap = new Map([
      [owner.id, new Map([
        ['repo', { kind: 'internal', typeName: 'MissingRepo' }],
      ])],
    ])

    const [resolved] = await resolveCalls([call], [owner, fn], new Map(), new Map(), origins)

    expect(resolved.resolve_status).toBe('failed')
    expect(resolved.target_id).toBeNull()
  })

  it('B7 — this field 호출 source가 class method가 아니면 field origin을 적용하지 않는다', async () => {
    const fn = makeNode({ id: 'r1:src/x.ts:looseFn', type: 'function', name: 'looseFn', file_path: 'src/x.ts' })
    const call = makeCall({
      source_id: fn.id,
      target_specifier: 'this.repo.customLookup',
      target_symbol: 'customLookup',
    })
    const origins: FieldOriginsMap = new Map([
      ['r1:src/x.ts:Owner', new Map([
        ['repo', { kind: 'external' }],
      ])],
    ])

    const [resolved] = await resolveCalls([call], [fn], new Map(), new Map(), origins)

    expect(resolved.resolve_status).toBe('failed')
    expect(resolved.target_id).toBeNull()
  })
})

describe('P15-Lite [C]: 우선순위 — DI param explicit type이 origin tag보다 우선', () => {
  it('C1 — constructor DI(cache: CacheWrapper) + this.cache.set() (set 정의) → resolved', async () => {
    const { edges } = await runE2EWithOrigins({
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
    const e = findCallE2E(edges, 'set', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
  })

  it('C3 — DI 매칭 실패 + field origin=external → external_chain (origin fallback)', async () => {
    // field가 DI param이 아니라 직접 initializer (외부 lib)
    const { edges } = await runE2EWithOrigins({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            import { ExternalCache } from 'ext-cache-lib'
            export class Owner {
              private readonly cache = new ExternalCache()
              fn() { this.cache.someMethod('k') }
            }
          `,
        },
      ],
    })
    const e = findCallE2E(edges, 'someMethod', ':Owner.fn')
    expect(e!.resolve_status).toBe('external_chain')
  })
})

describe('P15-Lite [E]: false positive 방지', () => {
  it('E1 — internal field + 정의된 method → resolved', async () => {
    const { edges } = await runE2EWithOrigins({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            export class MyService { process(x: number) { return x } }
            export class Owner {
              private readonly svc = new MyService()
              fn() { this.svc.process(1) }
            }
          `,
        },
      ],
    })
    const e = findCallE2E(edges, 'process', ':Owner.fn')
    expect(e!.resolve_status).toBe('resolved')
  })

  it('E3 — origin=unknown (computeFn return type 모름) → P5 field fallback (resolved, target=Owner.val) — LLM이 val 정의 찾도록', async () => {
    const { edges } = await runE2EWithOrigins({
      files: [
        {
          filePath: 'src/x.ts',
          source: `
            function computeFn() { return null as any }
            export class Owner {
              private readonly val = computeFn()
              fn() { this.val.someUnknown() }
            }
          `,
        },
      ],
    })
    const e = findCallE2E(edges, 'someUnknown', ':Owner.fn')
    // origin=unknown — P15-Lite는 elevate 안 함. 기존 P5 fallback이 val property로 매핑 (LLM에게 chain root 정보 전달).
    expect(e!.resolve_status).toBe('resolved')
    expect(e!.target_id).toMatch(/Owner\.val$/)
  })
})
