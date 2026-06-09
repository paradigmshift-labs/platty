/**
 * build_relations — DB wrapper RETURN-tracing, honest end-to-end (NO synthetic injection).
 *
 * Unlike db_access_wrapper_chain_e2e.test.ts (which injects the wrapper's import edge
 * synthetically), this test PARSES the wrapper file with the real adapter, so the wrapper's
 * db_client identity must be derived from what build_graph actually emits — the
 * `getPrismaDB --depends_on--> prisma(@prisma/client)` edge.
 *
 * Spec: specs/build_relations/wrapper-return-tracing.md
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { normalizeRelations } from '@/pipeline_modules/build_relations/normalize_relations.js'
import type {
  BuildRelationsInputs,
  CodeEdgeLike,
  CodeNodeLike,
  ModelLookup,
} from '@/pipeline_modules/build_relations/types.js'

const REPO_ID = 'r'
const adapter = new TypeScriptParserAdapter()

interface FileSpec { path: string; src: string }

// raw(snake_case) → like(camelCase): mirrors Drizzle's column→key mapping on DB read.
function mapParsed(files: FileSpec[]): { nodes: CodeNodeLike[]; edges: CodeEdgeLike[] } {
  const nodes: CodeNodeLike[] = []
  const edges: CodeEdgeLike[] = []
  let edgeId = 1
  for (const f of files) {
    const parsed = adapter.parseFile(f.src, f.path, REPO_ID) as { nodes: any[]; edges: any[] }
    for (const n of parsed.nodes) {
      nodes.push({
        id: n.id,
        repoId: n.repo_id,
        type: n.type,
        name: n.name,
        filePath: n.file_path,
        lineStart: n.line_start,
        lineEnd: n.line_end,
        isTest: n.is_test,
        parseStatus: n.parse_status,
      })
    }
    for (const e of parsed.edges) {
      edges.push({
        id: edgeId++,
        repoId: e.repo_id,
        sourceId: e.source_id,
        targetId: e.target_id,
        relation: e.relation,
        targetSpecifier: e.target_specifier,
        targetSymbol: e.target_symbol,
        typeRefSubtype: e.type_ref_subtype ?? null,
        chainPath: e.chain_path ?? null,
        firstArg: e.first_arg ?? null,
        literalArgs: e.literal_args ?? null,
        argExpressions: e.arg_expressions ?? null,
        resolveStatus: e.resolve_status === 'n/a' ? 'pending' : e.resolve_status,
        confidence: e.confidence ?? null,
        source: e.source ?? 'static',
      })
    }
  }
  return { nodes, edges }
}

function runRelations(files: FileSpec[], models: ModelLookup[]) {
  const { nodes, edges } = mapParsed(files)
  const inputs: BuildRelationsInputs = {
    repoId: REPO_ID,
    repoPath: null,
    includeTestSources: false,
    nodes,
    edges,
    models,
  }
  const index = buildSemanticIndex(inputs)
  const candidates = extractCandidates(inputs, index)
  const extracted = resolveCandidates(candidates, index, { resolveConstant: () => null })
  return normalizeRelations(extracted)
}

const FEED: ModelLookup = { modelName: 'Feed', tableName: 'feeds', orm: 'prisma' }
const USER: ModelLookup = { modelName: 'User', tableName: 'users', orm: 'prisma' }
const ORDER: ModelLookup = { modelName: 'Order', tableName: 'orders', orm: 'prisma' }

describe('db_access wrapper return-tracing (real parse, no injection)', () => {
  it('WRT-01: function getPrismaDB (local const) → getPrismaDB(tx).feed.updateMany() → db_access(feeds, update)', () => {
    const relations = runRelations(
      [
        {
          path: 'src/common.ts',
          src: `import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
export function getPrismaDB(tx?: any) { return tx ?? prisma }`,
        },
        {
          path: 'src/feed.service.ts',
          src: `import { getPrismaDB } from './common'
export async function bumpFeeds(tx: any) {
  return getPrismaDB(tx).feed.updateMany({ data: { pinned: false } })
}`,
        },
      ],
      [FEED],
    )
    const rel = relations.find((r) => r.kind === 'db_access' && r.target === 'feeds')
    expect(rel, 'db_access(feeds) from real wrapper parse').toBeDefined()
    expect(rel?.operation).toBe('update')
  })

  it('WRT-02: function getDb returns new PrismaClient() → getDb().user.create() → db_access(users, insert)', () => {
    const relations = runRelations(
      [
        {
          path: 'src/db.ts',
          src: `import { PrismaClient } from '@prisma/client'
export function getDb() { return new PrismaClient() }`,
        },
        {
          path: 'src/user.service.ts',
          src: `import { getDb } from './db'
export async function createUser(name: string) {
  return getDb().user.create({ data: { name } })
}`,
        },
      ],
      [USER],
    )
    const rel = relations.find((r) => r.kind === 'db_access' && r.target === 'users')
    expect(rel, 'db_access(users) from getDb()').toBeDefined()
    expect(rel?.operation).toBe('insert')
  })

  it('WRT-03: GENERIC NAME (conn) — name-crutch removed → conn(tx).order.findMany() → db_access(orders, select)', () => {
    const relations = runRelations(
      [
        {
          path: 'src/conn.ts',
          src: `import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
export function conn(tx?: any) { return tx ?? db }`,
        },
        {
          path: 'src/order.service.ts',
          src: `import { conn } from './conn'
export async function listOrders(tx: any) {
  return conn(tx).order.findMany({})
}`,
        },
      ],
      [ORDER],
    )
    const rel = relations.find((r) => r.kind === 'db_access' && r.target === 'orders')
    expect(rel, 'db_access(orders) from generic-named wrapper conn()').toBeDefined()
    expect(rel?.operation).toBe('select')
  })

  it('WRT-05 (negative): function that USES but does not RETURN a db client → no false db_access via wrapper path', () => {
    // doStuff() returns void; calling doStuff().x.y() is not a thing → must NOT mint a wrapper db_access.
    const relations = runRelations(
      [
        {
          path: 'src/use.ts',
          src: `import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
export function doStuff() { prisma.feed.findMany({}); }`,
        },
        {
          path: 'src/caller.ts',
          src: `import { doStuff } from './use'
export function go() { doStuff() }`,
        },
      ],
      [FEED],
    )
    // doStuff itself legitimately accesses feeds (direct prisma). That's fine.
    // The point: go() -> doStuff() must not produce an EXTRA wrapper-chain db_access for go().
    const goRels = relations.filter(
      (r) => r.kind === 'db_access' && r.sourceNodeId.startsWith(`${REPO_ID}:src/caller.ts`),
    )
    expect(goRels, 'caller go() must have no db_access').toHaveLength(0)
  })

  it('WRT-04: depends_on marking is generic over db package (knex) — wrapper marked db_client', () => {
    const { nodes, edges } = mapParsed([
      {
        path: 'src/conn.ts',
        src: `import knex from 'knex'
const k = knex({})
export function getConn() { return k }`,
      },
    ])
    const index = buildSemanticIndex({
      repoId: REPO_ID,
      repoPath: null,
      includeTestSources: false,
      nodes,
      edges,
      models: [],
    })
    const getConn = nodes.find((n) => n.name === 'getConn')!
    const wrapper = index.wrapperFunctions.get(getConn.id)
    expect(wrapper?.kind, 'getConn() marked db_client via depends_on→knex').toBe('db_client')
    expect(wrapper?.targetPackage).toBe('knex')
  })

  it('WRT-07 (boundary): imported prisma instance — `import {prisma}; function getDb(){return prisma}`', () => {
    // depends_on specifier resolves to the LOCAL module (`./client`), not `@prisma/client`.
    // A bounded 2-hop trace (getDb → prisma → @prisma/client) recovers it.
    const relations = runRelations(
      [
        {
          path: 'src/client.ts',
          src: `import { PrismaClient } from '@prisma/client'
export const prisma = new PrismaClient()`,
        },
        {
          path: 'src/db.ts',
          src: `import { prisma } from './client'
export function getDb() { return prisma }`,
        },
        {
          path: 'src/user.service.ts',
          src: `import { getDb } from './db'
export async function createUser(name: string) {
  return getDb().user.create({ data: { name } })
}`,
        },
      ],
      [USER],
    )
    const rel = relations.find((r) => r.kind === 'db_access' && r.target === 'users')
    expect(rel, 'db_access(users) from imported-instance wrapper').toBeDefined()
    expect(rel?.operation).toBe('insert')
  })

  it('WRT-08: arrow-const wrapper `const getDb=(tx)=>tx??prisma` → getDb(tx).feed.updateMany() → db_access(feeds, update)', () => {
    const relations = runRelations(
      [
        {
          path: 'src/db.ts',
          src: `import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
export const getDb = (tx?: any) => tx ?? prisma`,
        },
        {
          path: 'src/feed.service.ts',
          src: `import { getDb } from './db'
export async function bump(tx: any) { return getDb(tx).feed.updateMany({}) }`,
        },
      ],
      [FEED],
    )
    const rel = relations.find((r) => r.kind === 'db_access' && r.target === 'feeds')
    expect(rel, 'db_access(feeds) from arrow-const wrapper').toBeDefined()
    expect(rel?.operation).toBe('update')
  })

  it('WRT-09: namespace-member wrapper `getX(){return SGlobal.prismaPrimary}` → getX().user.create() → db_access(users, insert)', () => {
    // heroines SGlobal.prismaPrimary (323x). Wrapper returns a NAMESPACE MEMBER db client.
    const relations = runRelations(
      [
        {
          path: 'src/SGlobal.ts',
          src: `import { PrismaClient } from '@prisma/client'
export namespace SGlobal {
  export const prismaPrimary = new PrismaClient()
}`,
        },
        {
          path: 'src/db.ts',
          src: `import { SGlobal } from './SGlobal'
export function getX() { return SGlobal.prismaPrimary }`,
        },
        {
          path: 'src/user.service.ts',
          src: `import { getX } from './db'
export async function createUser(name: string) { return getX().user.create({ data: { name } }) }`,
        },
      ],
      [USER],
    )
    const rel = relations.find((r) => r.kind === 'db_access' && r.target === 'users')
    expect(rel, 'db_access(users) from namespace-member wrapper').toBeDefined()
    expect(rel?.operation).toBe('insert')
  })

  it('WRT-06 (negative): non-db wrapper getConfig() → returns plain config → no db_access', () => {
    const relations = runRelations(
      [
        {
          path: 'src/config.ts',
          src: `const config = { x: 1 }
export function getConfig() { return config }`,
        },
        {
          path: 'src/use-config.ts',
          src: `import { getConfig } from './config'
export function read() { return getConfig().feed.value }`,
        },
      ],
      [FEED],
    )
    const rel = relations.find((r) => r.kind === 'db_access')
    expect(rel, 'no db_access from non-db wrapper').toBeUndefined()
  })
})
