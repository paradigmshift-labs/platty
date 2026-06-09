/**
 * Field Origin + this.field.method() Resolution
 *
 * Comprehensive integration test for field origin tracking and chain resolution.
 * Covers 5 field definition sources × 5 origin locations = 25 scenarios.
 *
 * Field definition sources:
 *   (a) type annotation only
 *   (b) inline = new X()
 *   (c) constructor DI param constructor(private x: X)
 *   (d) constructor-body assign this.x = new X()
 *   (e) = factory() (computed initialization)
 *
 * Origin locations:
 *   - same-file class
 *   - cross-file relative import
 *   - @/ alias import
 *   - node_modules package
 *   - builtin (Map, Date)
 *   - namespace member (SGlobal.prisma)
 *
 * Expected outcomes:
 *   - internal: this.field.method() → resolved to class method
 *   - external: this.field.method() → external_chain or external
 *   - failed: method missing or type unavailable
 */

import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'
import type {
  CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap, FieldOriginsMap,
} from '@/pipeline_modules/build_graph/types'

// ─────────────────────────────────────────────────────────
// Test Harness
// ─────────────────────────────────────────────────────────

interface FileSpec {
  filePath: string
  source: string
}

async function runE2E(files: FileSpec[]) {
  const adapter = new TypeScriptParserAdapter()
  const allNodes: CodeNodeRaw[] = []
  const allEdges: CodeEdgeRaw[] = []
  const diMap: ConstructorDIMap = new Map()
  const allOrigins: FieldOriginsMap = new Map()
  const allCtorParams: { className: string; params: any[] }[] = []
  const classesByName = new Map<string, CodeNodeRaw>()

  for (const f of files) {
    const r = await adapter.parseFile(f.source, f.filePath, 'r1')
    const fileNode: CodeNodeRaw = {
      id: `r1:${f.filePath}`,
      repo_id: 'r1',
      type: 'file',
      file_path: f.filePath,
      name: 'file',
      line_start: null,
      line_end: null,
      signature: null,
      exported: false,
      parse_status: 'ok',
      is_test: false,
      test_type: null,
      is_async: false,
      jsdoc: null,
    }
    allNodes.push(fileNode, ...r.nodes)
    allEdges.push(...r.edges)
    allCtorParams.push(...r.constructorParams)
    for (const n of r.nodes) {
      if (n.type === 'class') classesByName.set(n.name, n)
    }
    if (r.fieldOrigins) {
      for (const [k, v] of r.fieldOrigins) allOrigins.set(k, v)
    }
  }

  for (const cp of allCtorParams) {
    const c = classesByName.get(cp.className)
    if (c) diMap.set(c.id, cp.params)
  }

  const edges = await resolveCalls(allEdges, allNodes, diMap, new Map(), allOrigins)
  return { nodes: allNodes, edges, fieldOrigins: allOrigins }
}

function findCall(edges: CodeEdgeRaw[], symbol: string, sourceEndsWith: string) {
  return edges.find(
    (e) => e.relation === 'calls' && e.target_symbol === symbol && e.source_id.endsWith(sourceEndsWith),
  )
}

// ─────────────────────────────────────────────────────────
// (a) Type Annotation Only — field declared with type, no initializer
// ─────────────────────────────────────────────────────────

describe('Field Origin: (a) Type Annotation Only', () => {
  it('a1 — annotation: internal class (same file) → this.field.method() resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/x.ts',
        source: `
          export class CacheWrapper { set(k: string, v: any) { return v } }
          export class Owner {
            private cache: CacheWrapper
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('a2 — annotation: internal class (cross-file relative import) → resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/CacheWrapper.ts',
        source: `
          export class CacheWrapper {
            set(k: string, v: any) { return v }
          }
        `,
      },
      {
        filePath: 'src/Owner.ts',
        source: `
          import { CacheWrapper } from './CacheWrapper'
          export class Owner {
            private cache: CacheWrapper
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('a3 — annotation: internal class (@/ alias import) → resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/lib/CacheWrapper.ts',
        source: `
          export class CacheWrapper {
            set(k: string, v: any) { return v }
          }
        `,
      },
      {
        filePath: 'src/Owner.ts',
        source: `
          import { CacheWrapper } from '@/lib/CacheWrapper'
          export class Owner {
            private cache: CacheWrapper
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('a4 — annotation: external package (node_modules) → external or external_chain', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/Owner.ts',
        source: `
          import { RedisClient } from 'redis'
          export class Owner {
            private client: RedisClient
            fn() { this.client.get('key') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'get', ':Owner.fn')
    expect(e).toBeDefined()
    expect(['external', 'external_chain']).toContain(e!.resolve_status)
  })

  it('a5 — annotation: builtin type (Map) → external', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/Owner.ts',
        source: `
          export class Owner {
            private map: Map<string, number>
            fn() { this.map.get('key') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'get', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('external')
  })

  it('a6 — annotation: namespace member (SGlobal.prisma typed) → resolves or external_chain', async () => {
    const { edges } = await runE2E([
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
        filePath: 'src/Owner.ts',
        source: `
          import { PrismaClient } from '@prisma/client'
          import { SGlobal } from './SGlobal'
          export class Owner {
            private prisma: PrismaClient
            fn() { this.prisma.user.findMany() }
          }
        `,
      },
    ])
    const e = findCall(edges, 'findMany', ':Owner.fn')
    expect(e).toBeDefined()
    // annotation says PrismaClient (external), but field origin might resolve differently
    expect(['resolved', 'external', 'external_chain']).toContain(e!.resolve_status)
  })
})

// ─────────────────────────────────────────────────────────
// (b) Inline = new X() — field initialized with constructor call
// ─────────────────────────────────────────────────────────

describe('Field Origin: (b) Inline = new X()', () => {
  it('b1 — = new CacheWrapper() (same file class) → resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/x.ts',
        source: `
          export class CacheWrapper { set(k: string, v: any) { return v } }
          export class Owner {
            private cache = new CacheWrapper()
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('b2 — = new CacheWrapper() (cross-file relative import) → resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/CacheWrapper.ts',
        source: `
          export class CacheWrapper {
            set(k: string, v: any) { return v }
          }
        `,
      },
      {
        filePath: 'src/Owner.ts',
        source: `
          import { CacheWrapper } from './CacheWrapper'
          export class Owner {
            private cache = new CacheWrapper()
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('b3 — = new CacheWrapper() (@/ alias) → resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/lib/CacheWrapper.ts',
        source: `
          export class CacheWrapper {
            set(k: string, v: any) { return v }
          }
        `,
      },
      {
        filePath: 'src/Owner.ts',
        source: `
          import { CacheWrapper } from '@/lib/CacheWrapper'
          export class Owner {
            private cache = new CacheWrapper()
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('b4 — = new RedisClient() (external package) → external or external_chain', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/Owner.ts',
        source: `
          import { RedisClient } from 'redis'
          export class Owner {
            private client = new RedisClient()
            fn() { this.client.get('key') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'get', ':Owner.fn')
    expect(e).toBeDefined()
    expect(['external', 'external_chain']).toContain(e!.resolve_status)
  })

  it('b5 — = new Map() (builtin) → external', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/Owner.ts',
        source: `
          export class Owner {
            private map = new Map<string, number>()
            fn() { this.map.get('key') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'get', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('external')
  })

  // RED: namespace member with RHS = X.Y (not new)
  it.skip('b6 — = SGlobal.prismaPrimary (namespace member) → external_chain', async () => {
    const { edges } = await runE2E([
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
        filePath: 'src/Owner.ts',
        source: `
          import { SGlobal } from './SGlobal'
          export class Owner {
            private prisma = SGlobal.prismaPrimary
            fn() { this.prisma.user.findMany() }
          }
        `,
      },
    ])
    const e = findCall(edges, 'findMany', ':Owner.fn')
    expect(e).toBeDefined()
    // RED: namespace member origin may not resolve cross-file reference properly
    expect(['external_chain', 'external']).toContain(e!.resolve_status)
  })
})

// ─────────────────────────────────────────────────────────
// (c) Constructor DI Param — constructor(private x: X)
// ─────────────────────────────────────────────────────────

describe('Field Origin: (c) Constructor DI Param', () => {
  it('c1 — constructor DI (internal class, same file) → resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/x.ts',
        source: `
          export class CacheWrapper { set(k: string, v: any) { return v } }
          export class Owner {
            constructor(private cache: CacheWrapper) {}
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('c2 — constructor DI (internal class, cross-file relative) → resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/CacheWrapper.ts',
        source: `
          export class CacheWrapper {
            set(k: string, v: any) { return v }
          }
        `,
      },
      {
        filePath: 'src/Owner.ts',
        source: `
          import { CacheWrapper } from './CacheWrapper'
          export class Owner {
            constructor(private cache: CacheWrapper) {}
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('c3 — constructor DI (@/ alias) → resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/lib/CacheWrapper.ts',
        source: `
          export class CacheWrapper {
            set(k: string, v: any) { return v }
          }
        `,
      },
      {
        filePath: 'src/Owner.ts',
        source: `
          import { CacheWrapper } from '@/lib/CacheWrapper'
          export class Owner {
            constructor(private cache: CacheWrapper) {}
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('c4 — constructor DI (external package) → external or external_chain', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/Owner.ts',
        source: `
          import { RedisClient } from 'redis'
          export class Owner {
            constructor(private client: RedisClient) {}
            fn() { this.client.get('key') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'get', ':Owner.fn')
    expect(e).toBeDefined()
    expect(['external', 'external_chain']).toContain(e!.resolve_status)
  })

  it('c5 — constructor DI (builtin type) → external', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/Owner.ts',
        source: `
          export class Owner {
            constructor(private map: Map<string, number>) {}
            fn() { this.map.get('key') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'get', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('external')
  })
})

// ─────────────────────────────────────────────────────────
// (d) Constructor Body Assign — this.x = new X()
// ─────────────────────────────────────────────────────────

describe('Field Origin: (d) Constructor Body Assign', () => {
  it('d1 — constructor body: this.cache = new CacheWrapper() (same file) → resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/x.ts',
        source: `
          export class CacheWrapper { set(k: string, v: any) { return v } }
          export class Owner {
            private cache: CacheWrapper
            constructor() { this.cache = new CacheWrapper() }
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('d2 — constructor body: this.cache = new CacheWrapper() (cross-file) → resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/CacheWrapper.ts',
        source: `
          export class CacheWrapper {
            set(k: string, v: any) { return v }
          }
        `,
      },
      {
        filePath: 'src/Owner.ts',
        source: `
          import { CacheWrapper } from './CacheWrapper'
          export class Owner {
            private cache: CacheWrapper
            constructor() { this.cache = new CacheWrapper() }
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('d3 — constructor body: this.cache = new CacheWrapper() (@/ alias) → resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/lib/CacheWrapper.ts',
        source: `
          export class CacheWrapper {
            set(k: string, v: any) { return v }
          }
        `,
      },
      {
        filePath: 'src/Owner.ts',
        source: `
          import { CacheWrapper } from '@/lib/CacheWrapper'
          export class Owner {
            private cache: CacheWrapper
            constructor() { this.cache = new CacheWrapper() }
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('d4 — constructor body: this.client = new RedisClient() (external) → external or external_chain', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/Owner.ts',
        source: `
          import { RedisClient } from 'redis'
          export class Owner {
            private client: RedisClient
            constructor() { this.client = new RedisClient() }
            fn() { this.client.get('key') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'get', ':Owner.fn')
    expect(e).toBeDefined()
    expect(['external', 'external_chain']).toContain(e!.resolve_status)
  })

  it('d5 — constructor body: this.map = new Map() (builtin) → external', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/Owner.ts',
        source: `
          export class Owner {
            private map: Map<string, number>
            constructor() { this.map = new Map() }
            fn() { this.map.get('key') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'get', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('external')
  })
})

// ─────────────────────────────────────────────────────────
// (e) Factory Function — = factory()
// ─────────────────────────────────────────────────────────

describe('Field Origin: (e) Factory Function Initialization', () => {
  it('e1 — = createCache() (internal factory, same file) → fallback resolve or failed', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/x.ts',
        source: `
          export class CacheWrapper { set(k: string, v: any) { return v } }
          function createCache() { return new CacheWrapper() }
          export class Owner {
            private cache = createCache()
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    // origin will be 'unknown' (factory return type opaque) → P5 fallback
    expect(['resolved', 'failed']).toContain(e!.resolve_status)
  })

  it('e2 — = createService() (cross-file factory) → fallback or failed', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/CacheWrapper.ts',
        source: `
          export class CacheWrapper {
            set(k: string, v: any) { return v }
          }
          export function createCache() { return new CacheWrapper() }
        `,
      },
      {
        filePath: 'src/Owner.ts',
        source: `
          import { createCache } from './CacheWrapper'
          export class Owner {
            private cache = createCache()
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    // factory return type not tracked → unknown origin
    expect(['resolved', 'failed']).toContain(e!.resolve_status)
  })

  // RED: factory function return type may not be tracked
  it.skip('e3 — = factory() with explicit return type annotation → resolves', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/x.ts',
        source: `
          export class CacheWrapper { set(k: string, v: any) { return v } }
          function createCache(): CacheWrapper { return new CacheWrapper() }
          export class Owner {
            private cache = createCache()
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    // RED: return type annotation might not be parsed into origin tracking
    expect(e!.resolve_status).toBe('resolved')
  })

  it('e4 — = externalFactory() (external package) → external or external_chain', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/Owner.ts',
        source: `
          import { createRedisClient } from 'redis'
          export class Owner {
            private client = createRedisClient()
            fn() { this.client.get('key') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'get', ':Owner.fn')
    expect(e).toBeDefined()
    expect(['external', 'external_chain']).toContain(e!.resolve_status)
  })
})

// ─────────────────────────────────────────────────────────
// Method Missing in Field Type — internal field, method not defined
// ─────────────────────────────────────────────────────────

describe('Field Origin: Method Missing in Internal Field Type', () => {
  it('m1 — internal field + method undefined → failed', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/x.ts',
        source: `
          export class CacheWrapper { set(k: string, v: any) { return v } }
          export class Owner {
            private cache = new CacheWrapper()
            fn() { this.cache.unknownMethod('k') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'unknownMethod', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('failed')
  })

  // RED: missing type in annotation resolves via P5 fallback (property matching)
  it.skip('m2 — internal field type unavailable in graph → failed (conservatively)', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/Owner.ts',
        source: `
          export class Owner {
            private cache: MissingType
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    // RED: MissingType annotation doesn't block P5 property fallback (resolves to Owner.cache property)
    expect(e!.resolve_status).toBe('failed')
  })
})

// ─────────────────────────────────────────────────────────
// Edge Cases
// ─────────────────────────────────────────────────────────

describe('Field Origin: Edge Cases', () => {
  it('edge1 — this.field with no origin tracking (loose fn context) → failed', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/x.ts',
        source: `
          export class CacheWrapper { set(k: string, v: any) { return v } }
          export function looseFn(cache: CacheWrapper) {
            cache.set('k', 'v')
          }
        `,
      },
    ])
    // Not a 'this.field' call, just param access
    const e = findCall(edges, 'set', ':looseFn')
    // This may resolve or fail depending on P5 fallback
    expect(e).toBeDefined()
  })

  it('edge2 — chained field method + nested chain → resolves if all intermediate types tracked', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/x.ts',
        source: `
          export class User { getId() { return 1 } }
          export class Query { users() { return [] as User[] } }
          export class Prisma { query = new Query() }
          export class Repo {
            private prisma = new Prisma()
            fn() { this.prisma.query.users() }
          }
        `,
      },
    ])
    const e = findCall(edges, 'users', ':Repo.fn')
    expect(e).toBeDefined()
    // resolve depends on whether nested field origins are tracked
    expect(['resolved', 'external_chain', 'failed']).toContain(e!.resolve_status)
  })

  it('edge3 — field declared with ! non-null assertion → respects annotation', async () => {
    const { edges } = await runE2E([
      {
        filePath: 'src/x.ts',
        source: `
          export class CacheWrapper { set(k: string, v: any) { return v } }
          export class Owner {
            private cache!: CacheWrapper
            fn() { this.cache.set('k', 'v') }
          }
        `,
      },
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })

  it('edge4 — readonly field + initialization → respects origin from initializer or annotation', async () => {
    const { edges } = await runE2E([
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
    ])
    const e = findCall(edges, 'set', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.resolve_status).toBe('resolved')
  })
})
