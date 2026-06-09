/**
 * build_relations DB access 시나리오 테스트
 * SOT: specs/build_relations/architecture.md §5.1, §8.3 Phase 2
 * 시나리오: REL-S01, REL-S13, REL-S14, REL-S27, REL-S28, REL-S29
 *           REL-N09, REL-N10, REL-N12, REL-N16
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, SemanticIndex, RelationCandidate } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { detectOrmFromPackage } from '@/pipeline_modules/build_relations/candidates/db_access.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { normalizeRelations } from '@/pipeline_modules/build_relations/normalize_relations.js'
import type { CodeNodeLike, CodeEdgeLike, ModelLookup } from '@/pipeline_modules/build_relations/types.js'

// ── helpers ──────────────────────────────────────────────

const REPO_ID = 'repo_db'

function makeInputs(partial: {
  nodes: CodeNodeLike[]
  edges: CodeEdgeLike[]
  models?: ModelLookup[]
  repoPath?: string | null
}): BuildRelationsInputs {
  return {
    repoId: REPO_ID,
    repoPath: partial.repoPath ?? null,
    includeTestSources: false,
    nodes: partial.nodes,
    edges: partial.edges,
    models: partial.models ?? [],
  }
}

let edgeId = 1
function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id,
    repoId: REPO_ID,
    type: 'method',
    name: id.split(':').pop() ?? id,
    filePath: 'src/service.ts',
    lineStart: 1,
    lineEnd: 10,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

function makeEdge(sourceId: string, relation: string, opts: Partial<CodeEdgeLike> = {}): CodeEdgeLike {
  return {
    id: edgeId++,
    repoId: REPO_ID,
    sourceId,
    targetId: null,
    relation,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    argExpressions: null,
    resolveStatus: 'resolved',
    confidence: null,
    source: 'static',
    ...opts,
  }
}

function runPipeline(inputs: BuildRelationsInputs) {
  const index = buildSemanticIndex(inputs)
  const candidates = extractCandidates(inputs, index)
  const extracted = resolveCandidates(candidates, index, { resolveConstant: () => null })
  return normalizeRelations(extracted)
}

// ── REL-S01: Prisma DI db_access ─────────────────────────

describe('REL-S01: Prisma DI — this.prisma.order.create()', () => {
  it('Nest DI PrismaService + calls edge → db_access insert high', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/service.ts:createOrder`)
    const prismaServiceNode = makeNode(`${REPO_ID}:src/prisma.service.ts:PrismaService`, {
      type: 'class',
      name: 'PrismaService',
      filePath: 'src/prisma.service.ts',
    })

    const nodes = [handlerNode, prismaServiceNode]
    const edges = [
      // PrismaService extends PrismaClient
      makeEdge(prismaServiceNode.id, 'extends', {
        targetSymbol: 'PrismaClient',
        targetSpecifier: '@prisma/client',
        targetId: null,
      }),
      // constructor DI: constructor(private prisma: PrismaService)
      makeEdge(handlerNode.id, 'uses_type', {
        targetSymbol: 'PrismaService',
        targetSpecifier: null,
        targetId: prismaServiceNode.id,
      }),
      // this.prisma.order.create(...)
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'this.prisma.order',
        firstArg: null,
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes, edges, models: [{ modelName: 'Order', tableName: 'orders', orm: 'prisma' }] }))

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('db_access')
    expect(result[0].target).toBe('orders')
    expect(result[0].operation).toBe('insert')
    expect(result[0].canonicalTarget).toBe('db:orders:insert')
    expect(result[0].confidence).toBe('high')
    expect(result[0].payload).toMatchObject({ orm: 'prisma' })
  })
})

// ── REL-S01 variant: findMany → select ───────────────────

describe('REL-S01 variant: Prisma findMany → select', () => {
  it('this.prisma.user.findMany() → db_access select high', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/service.ts:getUsers`)
    const prismaServiceNode = makeNode(`${REPO_ID}:src/prisma.service.ts:PrismaService`, {
      type: 'class', name: 'PrismaService', filePath: 'src/prisma.service.ts',
    })

    const edges = [
      makeEdge(prismaServiceNode.id, 'extends', {
        targetSymbol: 'PrismaClient', targetSpecifier: '@prisma/client', targetId: null,
      }),
      makeEdge(handlerNode.id, 'uses_type', {
        targetSymbol: 'PrismaService', targetSpecifier: null, targetId: prismaServiceNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findMany', chainPath: 'this.prisma.user', targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, prismaServiceNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'prisma' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('db_access')
    expect(result[0].target).toBe('users')
    expect(result[0].operation).toBe('select')
    expect(result[0].canonicalTarget).toBe('db:users:select')
    expect(result[0].confidence).toBe('high')
  })
})

// ── REL-S13: Drizzle transaction alias ───────────────────

describe('REL-S13: Drizzle transaction alias', () => {
  it('db.transaction(tx => tx.insert(orders)) → db_access insert high', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/service.ts:placeOrder`)
    const drizzleNode = makeNode(`${REPO_ID}:src/db.ts:db`, { type: 'variable', name: 'db', filePath: 'src/db.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'drizzle-orm', targetSymbol: 'drizzle', targetId: drizzleNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'transaction',
        chainPath: 'db',
        targetId: null,
      }),
      // db.transaction(async (tx) => { tx.insert(orders).values(...) })
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insert',
        chainPath: 'tx',
        firstArg: 'orders',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, drizzleNode],
      edges,
      models: [{ modelName: 'Order', tableName: 'orders', orm: 'drizzle' }],
    }))

    // drizzle transaction alias: tx.insert(orders)
    const dbRelation = result.find((r) => r.kind === 'db_access' && r.target === 'orders')
    expect(dbRelation).toBeDefined()
    expect(dbRelation?.operation).toBe('insert')
    expect(dbRelation?.confidence).toBe('high')
  })
})

// ── REL-S14: Mongoose model injection ────────────────────

describe('REL-S14: Mongoose @InjectModel DI', () => {
  it('@InjectModel(User.name) + this.userModel.find() → db_access select mongoose high', () => {
    const serviceNode = makeNode(`${REPO_ID}:src/users.service.ts:UserService`, { type: 'class', name: 'UserService', filePath: 'src/users.service.ts' })
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:findAll`, { filePath: 'src/users.service.ts' })

    const edges = [
      makeEdge(serviceNode.id, 'imports', {
        targetSpecifier: 'mongoose', targetSymbol: 'InjectModel', targetId: null,
      }),
      // @InjectModel(User.name) decorator on field/constructor param
      makeEdge(handlerNode.id, 'decorates', {
        targetSymbol: 'InjectModel',
        firstArg: 'User',
        targetId: null,
      }),
      // this.userModel.find()
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'find',
        chainPath: 'this.userModel',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [serviceNode, handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'mongoose' }],
    }))

    const rel = result.find((r) => r.kind === 'db_access')
    expect(rel).toBeDefined()
    expect(rel?.target).toBe('users')
    expect(rel?.operation).toBe('select')
    expect(rel?.payload).toMatchObject({ orm: 'mongoose' })
    expect(rel?.confidence).toBe('high')
  })
})

// ── REL-S27: Redis cache ──────────────────────────────────

describe('REL-S27: Redis cache set', () => {
  it('ioredis import + this.redis.set(key, value) → db_access insert redis', () => {
    const serviceNode = makeNode(`${REPO_ID}:src/cache.service.ts:CacheService`, { type: 'class', name: 'CacheService', filePath: 'src/cache.service.ts' })
    const handlerNode = makeNode(`${REPO_ID}:src/cache.service.ts:setUser`, { filePath: 'src/cache.service.ts' })

    const edges = [
      makeEdge(serviceNode.id, 'imports', {
        targetSpecifier: 'ioredis', targetSymbol: 'Redis', targetId: null,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'set',
        chainPath: 'this.redis',
        firstArg: 'user:123',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [serviceNode, handlerNode], edges }))

    const rel = result.find((r) => r.kind === 'db_access')
    expect(rel).toBeDefined()
    expect(rel?.payload).toMatchObject({ orm: 'redis', adapter: 'redis' })
    expect(rel?.confidence).toMatch(/high|medium/)
  })
})

// ── REL-N09: dynamic model no-emit ───────────────────────

describe('REL-N09: dynamic model — no-emit', () => {
  it('prisma[model].findMany() → no relation stored', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/generic.service.ts:query`)
    const prismaServiceNode = makeNode(`${REPO_ID}:src/prisma.service.ts:PrismaService`, {
      type: 'class', name: 'PrismaService', filePath: 'src/prisma.service.ts',
    })

    const edges = [
      makeEdge(prismaServiceNode.id, 'extends', { targetSymbol: 'PrismaClient', targetSpecifier: '@prisma/client' }),
      makeEdge(handlerNode.id, 'uses_type', { targetSymbol: 'PrismaService', targetId: prismaServiceNode.id }),
      // dynamic model: chainPath has bracket notation → no static model name
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findMany',
        chainPath: 'this.prisma[model]',  // dynamic bracket access
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode, prismaServiceNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

// ── REL-N12: transaction alias outside scope no-emit ─────

describe('REL-N12: tx alias without transaction evidence — no-emit', () => {
  it('tx.user.findMany() without db.transaction call evidence → no db_access', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/service.ts:leakedTx`)

    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'drizzle-orm', targetSymbol: 'drizzle', targetId: null,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findMany',
        chainPath: 'tx.user',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

// ── REL-N10: no anchor no-emit ────────────────────────────

describe('REL-N10: no import/DI anchor — no-emit', () => {
  it('User.find() without any anchor evidence → no relation', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/handler.ts:handler`)

    const edges = [
      // call edge만 있고 import/DI/extends anchor 없음
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'find',
        chainPath: 'User',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

// ── REL-N16: shadowed client no-emit ─────────────────────

describe('REL-N16: shadowed prisma variable — no-emit', () => {
  it('const prisma = fakeClient: shadowed after reassignment → no db_access', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/handler.ts:test`)
    // no extends/imports edge for PrismaClient/PrismaService on this node
    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findMany',
        chainPath: 'prisma.user',  // prisma is local variable, not DI
        targetId: null,
      }),
    ]

    // 아무 import/DI anchor도 없으므로 no-emit
    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })

  it('imported non-DB client does not inherit same-file Prisma evidence', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/crm.ts:syncContact`, {
      filePath: 'src/crm.ts',
    })
    const fileNode = makeNode(`${REPO_ID}:src/crm.ts:imports`, {
      type: 'file',
      filePath: 'src/crm.ts',
    })
    const hubspotNode = makeNode(`${REPO_ID}:src/hubspot.ts:hubspotClient`, {
      type: 'variable',
      name: 'hubspotClient',
      filePath: 'src/hubspot.ts',
    })
    const hubspotFileNode = makeNode(`${REPO_ID}:src/hubspot.ts:imports`, {
      type: 'file',
      filePath: 'src/hubspot.ts',
    })
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: './hubspot',
        targetSymbol: 'hubspotClient',
        targetId: hubspotNode.id,
      }),
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: './prisma',
        targetSymbol: 'prisma',
      }),
      makeEdge(hubspotFileNode.id, 'imports', {
        targetSpecifier: '@hubspot/api-client',
        targetSymbol: 'hubspot',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'hubspotClient.crm.contacts.basicApi',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode, fileNode, hubspotNode, hubspotFileNode], edges }))

    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

// ── REL-S28: wrapper function db_client ──────────────────

describe('REL-S28: getPrismaDB() wrapper function', () => {
  it('wrapper node marked db_client + .order.create() call → db_access insert high', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/order.service.ts:createOrder`)
    const wrapperNode = makeNode(`${REPO_ID}:src/db.ts:getPrismaDB`, { type: 'function', name: 'getPrismaDB', filePath: 'src/db.ts' })

    const edges = [
      // wrapper imports prisma
      makeEdge(wrapperNode.id, 'imports', {
        targetSpecifier: '@prisma/client', targetSymbol: 'PrismaClient', targetId: null,
      }),
      // handler calls wrapper: getPrismaDB(tx).order.create(...)
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'getPrismaDB(tx).order',
        targetId: wrapperNode.id,
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, wrapperNode],
      edges,
      models: [{ modelName: 'Order', tableName: 'orders', orm: 'prisma' }],
    }))

    const rel = result.find((r) => r.kind === 'db_access' && r.target === 'orders')
    expect(rel).toBeDefined()
    expect(rel?.operation).toBe('insert')
    expect(rel?.confidence).toBe('high')
  })
})

describe('Prisma adapter graph trace', () => {
  it('traces imported Prisma singleton through its target file evidence', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/user.service.ts:listUsers`, {
      filePath: 'src/user.service.ts',
    })
    const importNode = makeNode(`${REPO_ID}:src/user.service.ts:imports`, {
      type: 'file',
      name: 'user.service.ts',
      filePath: 'src/user.service.ts',
    })
    const prismaNode = makeNode(`${REPO_ID}:src/db.ts:prisma`, {
      type: 'variable',
      name: 'prisma',
      filePath: 'src/db.ts',
    })
    const dbFileNode = makeNode(`${REPO_ID}:src/db.ts:imports`, {
      type: 'file',
      name: 'db.ts',
      filePath: 'src/db.ts',
    })
    const edges = [
      makeEdge(importNode.id, 'imports', {
        targetSymbol: 'prisma',
        targetSpecifier: './db',
        targetId: prismaNode.id,
      }),
      makeEdge(dbFileNode.id, 'imports', {
        targetSymbol: 'PrismaClient',
        targetSpecifier: '@prisma/client',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findMany',
        chainPath: 'prisma.user',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, importNode, prismaNode, dbFileNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'prisma' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'prisma', adapter: 'prisma' },
    })
  })

  it('traces getPrisma() wrapper calls through Prisma package evidence', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/order.service.ts:createOrder`)
    const wrapperNode = makeNode(`${REPO_ID}:src/db.ts:getPrisma`, {
      type: 'function',
      name: 'getPrisma',
      filePath: 'src/db.ts',
    })
    const edges = [
      makeEdge(wrapperNode.id, 'imports', {
        targetSpecifier: '@prisma/client',
        targetSymbol: 'PrismaClient',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'getPrisma().order',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, wrapperNode],
      edges,
      models: [{ modelName: 'Order', tableName: 'orders', orm: 'prisma' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'orders',
      operation: 'insert',
      payload: { orm: 'prisma', adapter: 'prisma' },
    })
  })

  it('traces imported aliases for exported Prisma clients', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/audit.service.ts:listAuditLogs`, {
      filePath: 'src/audit.service.ts',
    })
    const importNode = makeNode(`${REPO_ID}:src/audit.service.ts:imports`, {
      type: 'file',
      filePath: 'src/audit.service.ts',
    })
    const prismaNode = makeNode(`${REPO_ID}:src/db.ts:prisma`, {
      type: 'variable',
      name: 'prisma',
      filePath: 'src/db.ts',
    })
    const dbFileNode = makeNode(`${REPO_ID}:src/db.ts:imports`, {
      type: 'file',
      filePath: 'src/db.ts',
    })
    const edges = [
      makeEdge(importNode.id, 'imports', {
        targetSymbol: 'client',
        targetSpecifier: './db',
        targetId: prismaNode.id,
      }),
      makeEdge(dbFileNode.id, 'imports', {
        targetSymbol: 'PrismaClient',
        targetSpecifier: '@prisma/client',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findFirst',
        chainPath: 'client.auditLog',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, importNode, prismaNode, dbFileNode],
      edges,
      models: [{ modelName: 'auditLog', tableName: 'audit_logs', orm: 'prisma' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'audit_logs',
      operation: 'select',
      payload: { orm: 'prisma', adapter: 'prisma' },
    })
  })

  it('traces constructor field origin when the field name matches PrismaService', () => {
    const serviceNode = makeNode(`${REPO_ID}:src/user.service.ts:UserService`, {
      type: 'class',
      name: 'UserService',
      filePath: 'src/user.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/user.service.ts:countUsers`, {
      filePath: 'src/user.service.ts',
    })
    const edges = [
      makeEdge(serviceNode.id, 'contains', { targetId: handlerNode.id }),
      makeEdge(handlerNode.id, 'uses_type', {
        targetSymbol: 'PrismaService',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'count',
        chainPath: 'this.prismaService.user',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [serviceNode, handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'prisma' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'prisma', adapter: 'prisma' },
    })
  })

  it('resolves tx.<model> Prisma transaction alias calls when Prisma evidence is in the file', () => {
    const importNode = makeNode(`${REPO_ID}:src/order.service.ts:imports`, {
      type: 'file',
      filePath: 'src/order.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/order.service.ts:placeOrder`, {
      filePath: 'src/order.service.ts',
    })
    const edges = [
      makeEdge(importNode.id, 'imports', {
        targetSymbol: 'PrismaClient',
        targetSpecifier: '@prisma/client',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: '$transaction',
        chainPath: 'prisma',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'tx.order',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [importNode, handlerNode],
      edges,
      models: [{ modelName: 'Order', tableName: 'orders', orm: 'prisma' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'orders',
      operation: 'insert',
      payload: { orm: 'prisma', adapter: 'prisma' },
    })
  })

  it('resolves tx.<model> Prisma aliases from SGlobal.prisma.$transaction evidence', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/order.service.ts:placeOrder`, {
      filePath: 'src/order.service.ts',
    })
    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: '$transaction',
        chainPath: 'SGlobal.prisma',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'tx.adisonPointPaymentLog',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'adisonPointPaymentLog', tableName: 'adison_point_payment_logs', orm: 'prisma' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'adison_point_payment_logs',
      operation: 'insert',
      payload: { orm: 'prisma' },
    })
  })

  it('maps representative Prisma method families to operations', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/order.service.ts:syncOrders`)
    const prismaServiceNode = makeNode(`${REPO_ID}:src/prisma.service.ts:PrismaService`, {
      type: 'class',
      name: 'PrismaService',
      filePath: 'src/prisma.service.ts',
    })
    const edges = [
      makeEdge(prismaServiceNode.id, 'extends', {
        targetSymbol: 'PrismaClient',
        targetSpecifier: '@prisma/client',
      }),
      makeEdge(handlerNode.id, 'uses_type', {
        targetSymbol: 'PrismaService',
        targetId: prismaServiceNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'createMany',
        chainPath: 'this.prisma.order',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'updateMany',
        chainPath: 'this.prisma.order',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'deleteMany',
        chainPath: 'this.prisma.order',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'aggregate',
        chainPath: 'this.prisma.order',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, prismaServiceNode],
      edges,
      models: [{ modelName: 'Order', tableName: 'orders', orm: 'prisma' }],
    }))

    expect(result.map((r) => r.operation).sort()).toEqual(['delete', 'insert', 'select', 'update'])
    expect(result.every((r) => r.payload.adapter === 'prisma')).toBe(true)
  })

  it('maps Prisma interactive transaction method families with tx.<model> chains', () => {
    const importNode = makeNode(`${REPO_ID}:src/order.service.ts:imports`, {
      type: 'file',
      filePath: 'src/order.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/order.service.ts:syncInTransaction`, {
      filePath: 'src/order.service.ts',
    })
    const edges = [
      makeEdge(importNode.id, 'imports', {
        targetSymbol: 'PrismaClient',
        targetSpecifier: '@prisma/client',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: '$transaction',
        chainPath: 'prisma',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findMany',
        chainPath: 'tx.order',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'updateMany',
        chainPath: 'tx.order',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'deleteMany',
        chainPath: 'tx.order',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [importNode, handlerNode],
      edges,
      models: [{ modelName: 'Order', tableName: 'orders', orm: 'prisma' }],
    }))

    expect(result.map((r) => r.operation).sort()).toEqual(['delete', 'select', 'update'])
    expect(result.every((r) => r.payload.adapter === 'prisma')).toBe(true)
  })

  it('does not emit leaked Prisma tx aliases without $transaction evidence', () => {
    const importNode = makeNode(`${REPO_ID}:src/order.service.ts:imports`, {
      type: 'file',
      filePath: 'src/order.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/order.service.ts:leakedTx`, {
      filePath: 'src/order.service.ts',
    })
    const edges = [
      makeEdge(importNode.id, 'imports', {
        targetSymbol: 'PrismaClient',
        targetSpecifier: '@prisma/client',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findMany',
        chainPath: 'tx.order',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [importNode, handlerNode],
      edges,
      models: [{ modelName: 'Order', tableName: 'orders', orm: 'prisma' }],
    }))

    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })

  it('does not emit Prisma raw SQL when the table is not statically visible', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/report.service.ts:runReport`)
    const prismaServiceNode = makeNode(`${REPO_ID}:src/prisma.service.ts:PrismaService`, {
      type: 'class',
      name: 'PrismaService',
      filePath: 'src/prisma.service.ts',
    })
    const edges = [
      makeEdge(prismaServiceNode.id, 'extends', {
        targetSymbol: 'PrismaClient',
        targetSpecifier: '@prisma/client',
      }),
      makeEdge(handlerNode.id, 'uses_type', {
        targetSymbol: 'PrismaService',
        targetId: prismaServiceNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: '$queryRaw',
        chainPath: 'this.prisma',
        firstArg: 'query',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode, prismaServiceNode], edges }))

    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

describe('TypeORM adapter graph trace', () => {
  it('@InjectRepository(User) + this.userRepository.find() resolves repository model', () => {
    const serviceNode = makeNode(`${REPO_ID}:src/users.service.ts:UsersService`, {
      type: 'class',
      name: 'UsersService',
      filePath: 'src/users.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:listUsers`, {
      filePath: 'src/users.service.ts',
    })
    const edges = [
      makeEdge(serviceNode.id, 'imports', {
        targetSpecifier: '@nestjs/typeorm',
        targetSymbol: 'InjectRepository',
      }),
      makeEdge(serviceNode.id, 'contains', { targetId: handlerNode.id }),
      makeEdge(handlerNode.id, 'decorates', {
        targetSymbol: 'InjectRepository',
        firstArg: 'User',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'find',
        chainPath: 'this.userRepository',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [serviceNode, handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'typeorm' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'typeorm', adapter: 'typeorm' },
    })
  })

  it('Repository<User> type evidence + this.userRepository.save() resolves model from generic type', () => {
    const serviceNode = makeNode(`${REPO_ID}:src/users.service.ts:UsersService`, {
      type: 'class',
      name: 'UsersService',
      filePath: 'src/users.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:createUser`, {
      filePath: 'src/users.service.ts',
    })
    const edges = [
      makeEdge(serviceNode.id, 'contains', { targetId: handlerNode.id }),
      makeEdge(handlerNode.id, 'type_resolved', {
        targetSymbol: 'Repository<User>',
        targetSpecifier: 'typeorm',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'save',
        chainPath: 'this.userRepository',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [serviceNode, handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'typeorm' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'insert',
      payload: { orm: 'typeorm', adapter: 'typeorm' },
    })
  })

  it('DataSource.getRepository(User).findOne() resolves repository factory chain', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:getUser`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'typeorm',
        targetSymbol: 'DataSource',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findOne',
        chainPath: 'dataSource.getRepository(User)',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'typeorm' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'typeorm', adapter: 'typeorm' },
    })
  })

  it('EntityManager.find(User) resolves model from first argument', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:listUsersWithManager`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'typeorm',
        targetSymbol: 'EntityManager',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'find',
        chainPath: 'manager',
        firstArg: 'User',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'typeorm' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'typeorm', adapter: 'typeorm' },
    })
  })

  it('transaction manager em.update(User) resolves with transaction evidence', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:updateInTransaction`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'typeorm',
        targetSymbol: 'DataSource',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'transaction',
        chainPath: 'dataSource',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'update',
        chainPath: 'em',
        firstArg: 'User',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'typeorm' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'update',
      payload: { orm: 'typeorm', adapter: 'typeorm' },
    })
  })

  it('createQueryBuilder("user").delete() resolves alias through from(User)', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:deleteByBuilder`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'typeorm',
        targetSymbol: 'DataSource',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'from',
        chainPath: 'dataSource.createQueryBuilder().delete()',
        firstArg: 'User',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'typeorm' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'delete',
      payload: { orm: 'typeorm', adapter: 'typeorm', queryBuilder: true },
    })
  })

  it('does not emit dynamic getRepository(entity) calls', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:dynamicRepo`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'typeorm',
        targetSymbol: 'DataSource',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'find',
        chainPath: 'dataSource.getRepository(entity)',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })

  it('does not emit leaked em aliases without transaction evidence', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:leakedManager`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'typeorm',
        targetSymbol: 'EntityManager',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'find',
        chainPath: 'em',
        firstArg: 'User',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'typeorm' }],
    }))

    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

describe('Mongoose adapter graph trace', () => {
  it('@InjectModel(User.name) + this.userModel.find() resolves injected model', () => {
    const serviceNode = makeNode(`${REPO_ID}:src/users.service.ts:UsersService`, {
      type: 'class',
      name: 'UsersService',
      filePath: 'src/users.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:listUsers`, {
      filePath: 'src/users.service.ts',
    })
    const edges = [
      makeEdge(serviceNode.id, 'imports', {
        targetSpecifier: '@nestjs/mongoose',
        targetSymbol: 'InjectModel',
      }),
      makeEdge(serviceNode.id, 'contains', { targetId: handlerNode.id }),
      makeEdge(handlerNode.id, 'decorates', {
        targetSymbol: 'InjectModel',
        firstArg: 'User.name',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'find',
        chainPath: 'this.userModel',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [serviceNode, handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'mongoose' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'mongoose', adapter: 'mongoose' },
    })
  })

  it('Model<UserDocument> type evidence + this.userModel.create() resolves generic model', () => {
    const serviceNode = makeNode(`${REPO_ID}:src/users.service.ts:UsersService`, {
      type: 'class',
      name: 'UsersService',
      filePath: 'src/users.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:createUser`, {
      filePath: 'src/users.service.ts',
    })
    const edges = [
      makeEdge(serviceNode.id, 'contains', { targetId: handlerNode.id }),
      makeEdge(handlerNode.id, 'type_resolved', {
        targetSymbol: 'Model<UserDocument>',
        targetSpecifier: 'mongoose',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'this.userModel',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [serviceNode, handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'mongoose' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'insert',
      payload: { orm: 'mongoose', adapter: 'mongoose' },
    })
  })

  it('imported UserModel.findOneAndUpdate() resolves model from imported receiver', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:updateUser`, {
      filePath: 'src/users.service.ts',
    })
    const importNode = makeNode(`${REPO_ID}:src/users.service.ts:imports`, {
      type: 'file',
      filePath: 'src/users.service.ts',
    })
    const modelNode = makeNode(`${REPO_ID}:src/user.model.ts:UserModel`, {
      type: 'variable',
      name: 'UserModel',
      filePath: 'src/user.model.ts',
    })
    const modelFileNode = makeNode(`${REPO_ID}:src/user.model.ts:imports`, {
      type: 'file',
      filePath: 'src/user.model.ts',
    })
    const edges = [
      makeEdge(importNode.id, 'imports', {
        targetSpecifier: './user.model',
        targetSymbol: 'UserModel',
        targetId: modelNode.id,
      }),
      makeEdge(modelFileNode.id, 'imports', {
        targetSpecifier: 'mongoose',
        targetSymbol: 'model',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findOneAndUpdate',
        chainPath: 'UserModel',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, importNode, modelNode, modelFileNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'mongoose' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'update',
      payload: { orm: 'mongoose', adapter: 'mongoose' },
    })
  })

  it('connection.model(User.name).deleteOne() resolves model factory chain', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:deleteUser`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'mongoose',
        targetSymbol: 'Connection',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'deleteOne',
        chainPath: 'connection.model(User.name)',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'mongoose' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'delete',
      payload: { orm: 'mongoose', adapter: 'mongoose' },
    })
  })

  it('session transaction updateMany() resolves with adapter metadata', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:updateInSession`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'mongoose',
        targetSymbol: 'startSession',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'withTransaction',
        chainPath: 'session',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'updateMany',
        chainPath: 'this.userModel',
      }),
      makeEdge(handlerNode.id, 'decorates', {
        targetSymbol: 'InjectModel',
        firstArg: 'User',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'mongoose' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'update',
      payload: { orm: 'mongoose', adapter: 'mongoose' },
    })
  })

  it('does not emit dynamic connection.model(modelName) calls', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:dynamicModel`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'mongoose',
        targetSymbol: 'Connection',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'find',
        chainPath: 'connection.model(modelName)',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

describe('Drizzle adapter graph trace', () => {
  it('db.select().from(users) resolves table from from() argument', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:listUsers`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'drizzle-orm',
        targetSymbol: 'drizzle',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'from',
        chainPath: 'db.select()',
        firstArg: 'users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'drizzle', adapter: 'drizzle' },
    })
  })

  it('db.insert(users), update(users), and delete(users) map to write operations', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:syncUsers`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'drizzle-orm',
        targetSymbol: 'drizzle',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insert',
        chainPath: 'db',
        firstArg: 'users',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'update',
        chainPath: 'db',
        firstArg: 'users',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'delete',
        chainPath: 'db',
        firstArg: 'users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result.map((r) => r.operation).sort()).toEqual(['delete', 'insert', 'update'])
    expect(result.every((r) => r.target === 'users')).toBe(true)
    expect(result.every((r) => r.payload.adapter === 'drizzle')).toBe(true)
  })

  it('uses a single imported table dependency when Drizzle call firstArg is unavailable', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders.repo.ts:createOrder`)
    const dbNode = makeNode(`${REPO_ID}:src/db/client.ts:db`, { type: 'variable', name: 'db', filePath: 'src/db/client.ts' })
    const ordersNode = makeNode(`${REPO_ID}:src/db/schema.ts:orders`, { type: 'variable', name: 'orders', filePath: 'src/db/schema.ts' })
    const edges = [
      makeEdge(dbNode.id, 'calls', {
        targetSpecifier: 'drizzle-orm/postgres-js',
        targetSymbol: 'drizzle',
      }),
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '../db/client',
        targetSymbol: 'db',
        targetId: dbNode.id,
      }),
      makeEdge(handlerNode.id, 'depends_on', {
        targetSpecifier: '../db/schema',
        targetSymbol: 'orders',
        targetId: ordersNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insert',
        chainPath: 'db',
        firstArg: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode, dbNode, ordersNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'orders',
      operation: 'insert',
      payload: { orm: 'drizzle', adapter: 'drizzle' },
    })
  })

  it('does not guess a Drizzle table from dependencies when multiple tables are referenced', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders.repo.ts:syncOrder`)
    const dbNode = makeNode(`${REPO_ID}:src/db/client.ts:db`, { type: 'variable', name: 'db', filePath: 'src/db/client.ts' })
    const ordersNode = makeNode(`${REPO_ID}:src/db/schema.ts:orders`, { type: 'variable', name: 'orders', filePath: 'src/db/schema.ts' })
    const customersNode = makeNode(`${REPO_ID}:src/db/schema.ts:customers`, { type: 'variable', name: 'customers', filePath: 'src/db/schema.ts' })
    const edges = [
      makeEdge(dbNode.id, 'calls', {
        targetSpecifier: 'drizzle-orm/postgres-js',
        targetSymbol: 'drizzle',
      }),
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '../db/client',
        targetSymbol: 'db',
        targetId: dbNode.id,
      }),
      makeEdge(handlerNode.id, 'depends_on', {
        targetSpecifier: '../db/schema',
        targetSymbol: 'orders',
        targetId: ordersNode.id,
      }),
      makeEdge(handlerNode.id, 'depends_on', {
        targetSpecifier: '../db/schema',
        targetSymbol: 'customers',
        targetId: customersNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insert',
        chainPath: 'db',
        firstArg: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode, dbNode, ordersNode, customersNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })

  it('transaction alias tx.insert(orders) resolves only with transaction evidence', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders.repo.ts:createOrder`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'drizzle-orm',
        targetSymbol: 'drizzle',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'transaction',
        chainPath: 'db',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insert',
        chainPath: 'tx',
        firstArg: 'orders',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'orders',
      operation: 'insert',
      payload: { orm: 'drizzle', adapter: 'drizzle' },
    })
  })

  it('db.query.users.findMany() resolves relational query table from chain', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:listUsersRelational`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'drizzle-orm',
        targetSymbol: 'drizzle',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findMany',
        chainPath: 'db.query.users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'drizzle', adapter: 'drizzle' },
    })
  })

  it('does not emit dynamic table variables', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:dynamicTable`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'drizzle-orm',
        targetSymbol: 'drizzle',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insert',
        chainPath: 'db',
        firstArg: 'table',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

describe('Kysely adapter graph trace', () => {
  it('db.selectFrom("users") resolves select table', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:listUsers`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'kysely',
        targetSymbol: 'Kysely',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'selectFrom',
        chainPath: 'db',
        firstArg: 'users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'kysely', adapter: 'kysely' },
    })
  })

  it('does not emit duplicate db_access for Kysely execute terminal calls', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/invoices.repo.ts:listInvoices`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'kysely',
        targetSymbol: 'Kysely',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'selectFrom',
        chainPath: 'db',
        firstArg: 'invoices',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'execute',
        chainPath: "db.selectFrom('invoices').selectAll()",
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'invoices',
      operation: 'select',
      payload: { orm: 'kysely', adapter: 'kysely' },
    })
  })

  it('insertInto, updateTable, and deleteFrom map to write operations', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:syncUsers`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'kysely',
        targetSymbol: 'Kysely',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insertInto',
        chainPath: 'db',
        firstArg: 'users',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'updateTable',
        chainPath: 'db',
        firstArg: 'users',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'deleteFrom',
        chainPath: 'db',
        firstArg: 'users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result.map((r) => r.operation).sort()).toEqual(['delete', 'insert', 'update'])
    expect(result.every((r) => r.target === 'users')).toBe(true)
    expect(result.every((r) => r.payload.adapter === 'kysely')).toBe(true)
  })

  it('trx.insertInto("orders") resolves with transaction evidence', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders.repo.ts:createOrder`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'kysely',
        targetSymbol: 'Kysely',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'transaction',
        chainPath: 'db',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insertInto',
        chainPath: 'trx',
        firstArg: 'orders',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'orders',
      operation: 'insert',
      payload: { orm: 'kysely', adapter: 'kysely' },
    })
  })

  it('does not emit dynamic table arguments', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:dynamicTable`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'kysely',
        targetSymbol: 'Kysely',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'selectFrom',
        chainPath: 'db',
        firstArg: 'tableName',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

describe('Sqflite adapter graph trace', () => {
  it("database.query('notes') emits local db_access select", () => {
    const fileNode = makeNode(`${REPO_ID}:lib/services/notes_repository.dart`, {
      type: 'file',
      filePath: 'lib/services/notes_repository.dart',
    })
    const handlerNode = makeNode(`${REPO_ID}:lib/services/notes_repository.dart:NotesRepository.loadNotes`, {
      filePath: 'lib/services/notes_repository.dart',
    })
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: 'package:sqflite/sqflite.dart',
        targetSymbol: 'openDatabase',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'query',
        chainPath: 'database',
        firstArg: 'notes',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [fileNode, handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'notes',
      operation: 'select',
      canonicalTarget: 'db:notes:select',
      payload: { orm: 'sqflite', adapter: 'sqflite', modelName: 'notes' },
    })
  })

  it('rawQuery with static SQL emits local db_access select', () => {
    const fileNode = makeNode(`${REPO_ID}:lib/services/notes_repository.dart`, {
      type: 'file',
      filePath: 'lib/services/notes_repository.dart',
    })
    const handlerNode = makeNode(`${REPO_ID}:lib/services/notes_repository.dart:NotesRepository.searchNotes`, {
      filePath: 'lib/services/notes_repository.dart',
    })
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: 'package:sqflite/sqflite.dart',
        targetSymbol: 'Database',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'rawQuery',
        chainPath: 'database',
        firstArg: 'SELECT * FROM notes WHERE archived = 0',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [fileNode, handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'notes',
      operation: 'select',
      payload: { orm: 'sqflite', adapter: 'sqflite' },
    })
  })

  it('dynamic sqflite table names are not emitted', () => {
    const fileNode = makeNode(`${REPO_ID}:lib/services/notes_repository.dart`, {
      type: 'file',
      filePath: 'lib/services/notes_repository.dart',
    })
    const handlerNode = makeNode(`${REPO_ID}:lib/services/notes_repository.dart:NotesRepository.loadDynamic`, {
      filePath: 'lib/services/notes_repository.dart',
    })
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: 'package:sqflite/sqflite.dart',
        targetSymbol: 'Database',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'query',
        chainPath: 'database',
        firstArg: 'tableName',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [fileNode, handlerNode], edges }))

    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

describe('Knex adapter graph trace', () => {
  it('knex(users).select() resolves table from callable receiver', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:listUsers`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'knex',
        targetSymbol: 'knex',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'select',
        chainPath: 'knex(users)',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'knex', adapter: 'knex' },
    })
  })

  it('knex.table(users) maps insert, update, and delete operations', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:syncUsers`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'knex',
        targetSymbol: 'knex',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insert',
        chainPath: 'knex.table(users)',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'update',
        chainPath: 'knex.table(users)',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'delete',
        chainPath: 'knex.table(users)',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result.map((r) => r.operation).sort()).toEqual(['delete', 'insert', 'update'])
    expect(result.every((r) => r.target === 'users')).toBe(true)
    expect(result.every((r) => r.payload.adapter === 'knex')).toBe(true)
  })

  it('trx(orders).insert() resolves with transaction evidence', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders.repo.ts:createOrder`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'knex',
        targetSymbol: 'knex',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'transaction',
        chainPath: 'knex',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insert',
        chainPath: 'trx(orders)',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'orders',
      operation: 'insert',
      payload: { orm: 'knex', adapter: 'knex' },
    })
  })

  it('does not emit dynamic table function arguments', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:dynamicTable`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'knex',
        targetSymbol: 'knex',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'select',
        chainPath: 'knex(tableName)',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

describe('Supabase DB adapter graph trace', () => {
  it('supabase.from(users).select() resolves table select', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:listUsers`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@supabase/supabase-js',
        targetSymbol: 'createClient',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'select',
        chainPath: 'supabase.from(users)',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'supabase', adapter: 'supabase' },
    })
  })

  it('supabase_flutter package evidence resolves Dart Supabase table reads', () => {
    const handlerNode = makeNode(`${REPO_ID}:lib/profile_repository.dart:loadProfiles`, {
      filePath: 'lib/profile_repository.dart',
    })
    const fileNode = makeNode(`${REPO_ID}:lib/profile_repository.dart:file`, {
      type: 'file',
      filePath: 'lib/profile_repository.dart',
    })
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: 'package:supabase_flutter/supabase_flutter.dart',
        targetSymbol: 'Supabase',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'select',
        chainPath: 'Supabase.instance.client.from(profiles)',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode, fileNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'profiles',
      operation: 'select',
      payload: { orm: 'supabase', adapter: 'supabase' },
    })
  })

  it('recovers Supabase table names from split Dart builder call edges', () => {
    const handlerNode = makeNode(`${REPO_ID}:lib/profile_repository.dart:loadProfiles`, {
      filePath: 'lib/profile_repository.dart',
    })
    const fileNode = makeNode(`${REPO_ID}:lib/profile_repository.dart:file`, {
      type: 'file',
      filePath: 'lib/profile_repository.dart',
    })
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: 'package:supabase_flutter/supabase_flutter.dart',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'from',
        chainPath: 'client',
        firstArg: 'profiles',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'select',
        chainPath: 'client.from()',
        firstArg: '*',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode, fileNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'profiles',
      operation: 'select',
      payload: { orm: 'supabase', adapter: 'supabase' },
    })
  })

  it('insert, update, upsert, and delete map to write operations', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:syncUsers`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@supabase/supabase-js',
        targetSymbol: 'createClient',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insert',
        chainPath: 'supabase.from(users)',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'update',
        chainPath: 'supabase.from(users)',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'upsert',
        chainPath: 'supabase.from(users)',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'delete',
        chainPath: 'supabase.from(users)',
      }),
    ]

    const inputs = makeInputs({ nodes: [handlerNode], edges })
    const candidates = extractCandidates(inputs, buildSemanticIndex(inputs))
      .filter((candidate) => candidate.kind === 'db_access' && candidate.payload.adapter === 'supabase')
    const result = runPipeline(inputs)

    expect(candidates.map((candidate) => candidate.payload.method).sort()).toEqual(['delete', 'insert', 'update', 'upsert'])
    expect(result.map((r) => r.operation).sort()).toEqual(['delete', 'insert', 'update'])
    expect(result.every((r) => r.target === 'users')).toBe(true)
    expect(result.every((r) => r.payload.adapter === 'supabase')).toBe(true)
  })

  it('imported supabase singleton traces package evidence from target file', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:listUsers`, {
      filePath: 'src/users.repo.ts',
    })
    const importNode = makeNode(`${REPO_ID}:src/users.repo.ts:imports`, {
      type: 'file',
      filePath: 'src/users.repo.ts',
    })
    const clientNode = makeNode(`${REPO_ID}:src/supabase.ts:supabase`, {
      type: 'variable',
      name: 'supabase',
      filePath: 'src/supabase.ts',
    })
    const clientFileNode = makeNode(`${REPO_ID}:src/supabase.ts:imports`, {
      type: 'file',
      filePath: 'src/supabase.ts',
    })
    const edges = [
      makeEdge(importNode.id, 'imports', {
        targetSpecifier: './supabase',
        targetSymbol: 'supabase',
        targetId: clientNode.id,
      }),
      makeEdge(clientFileNode.id, 'imports', {
        targetSpecifier: '@supabase/supabase-js',
        targetSymbol: 'createClient',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'select',
        chainPath: 'supabase.from(users)',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode, importNode, clientNode, clientFileNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'supabase', adapter: 'supabase' },
    })
  })

  it('does not emit dynamic from(tableName) calls', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:dynamicTable`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@supabase/supabase-js',
        targetSymbol: 'createClient',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'select',
        chainPath: 'supabase.from(tableName)',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

describe('Sequelize adapter graph trace', () => {
  it('imported User.findAll() resolves static model select', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:listUsers`, {
      filePath: 'src/users.repo.ts',
    })
    const importNode = makeNode(`${REPO_ID}:src/users.repo.ts:imports`, {
      type: 'file',
      filePath: 'src/users.repo.ts',
    })
    const modelNode = makeNode(`${REPO_ID}:src/user.model.ts:User`, {
      type: 'class',
      name: 'User',
      filePath: 'src/user.model.ts',
    })
    const modelFileNode = makeNode(`${REPO_ID}:src/user.model.ts:imports`, {
      type: 'file',
      filePath: 'src/user.model.ts',
    })
    const edges = [
      makeEdge(importNode.id, 'imports', {
        targetSpecifier: './user.model',
        targetSymbol: 'User',
        targetId: modelNode.id,
      }),
      makeEdge(modelFileNode.id, 'imports', {
        targetSpecifier: 'sequelize-typescript',
        targetSymbol: 'Model',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findAll',
        chainPath: 'User',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, importNode, modelNode, modelFileNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'sequelize' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'sequelize', adapter: 'sequelize' },
    })
  })

  it('static create, update, upsert, and destroy map write operations', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:syncUsers`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'sequelize-typescript',
        targetSymbol: 'Model',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'User',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'update',
        chainPath: 'User',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'upsert',
        chainPath: 'User',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'destroy',
        chainPath: 'User',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'sequelize' }],
    }))

    expect(result.map((r) => r.operation).sort()).toEqual(['delete', 'insert', 'update'])
    expect(result.every((r) => r.target === 'users')).toBe(true)
    expect(result.every((r) => r.payload.adapter === 'sequelize')).toBe(true)
  })

  it('@InjectModel(User) + this.userModel.findByPk() resolves injected model', () => {
    const serviceNode = makeNode(`${REPO_ID}:src/users.service.ts:UsersService`, {
      type: 'class',
      name: 'UsersService',
      filePath: 'src/users.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:getUser`, {
      filePath: 'src/users.service.ts',
    })
    const edges = [
      makeEdge(serviceNode.id, 'imports', {
        targetSpecifier: '@nestjs/sequelize',
        targetSymbol: 'InjectModel',
      }),
      makeEdge(serviceNode.id, 'contains', { targetId: handlerNode.id }),
      makeEdge(handlerNode.id, 'decorates', {
        targetSymbol: 'InjectModel',
        firstArg: 'User',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findByPk',
        chainPath: 'this.userModel',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [serviceNode, handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'sequelize' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'sequelize', adapter: 'sequelize' },
    })
  })

  it('ModelCtor<User> type evidence + this.userModel.bulkCreate() resolves generic model', () => {
    const serviceNode = makeNode(`${REPO_ID}:src/users.service.ts:UsersService`, {
      type: 'class',
      name: 'UsersService',
      filePath: 'src/users.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/users.service.ts:createUsers`, {
      filePath: 'src/users.service.ts',
    })
    const edges = [
      makeEdge(serviceNode.id, 'contains', { targetId: handlerNode.id }),
      makeEdge(handlerNode.id, 'type_resolved', {
        targetSymbol: 'ModelCtor<User>',
        targetSpecifier: 'sequelize-typescript',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'bulkCreate',
        chainPath: 'this.userModel',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [serviceNode, handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'sequelize' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'insert',
      payload: { orm: 'sequelize', adapter: 'sequelize' },
    })
  })

  it('does not emit dynamic lower-case model receivers', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:dynamicModel`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'sequelize-typescript',
        targetSymbol: 'Model',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findAll',
        chainPath: 'model',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

describe('MikroORM adapter graph trace', () => {
  it('em.find(User) resolves EntityManager select', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:listUsers`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@mikro-orm/core',
        targetSymbol: 'EntityManager',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'find',
        chainPath: 'em',
        firstArg: 'User',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'mikroorm' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'mikroorm', adapter: 'mikroorm' },
    })
  })

  it('persistAndFlush(new User()) and nativeInsert(User) map to insert', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:createUsers`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@mikro-orm/core',
        targetSymbol: 'EntityManager',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'persistAndFlush',
        chainPath: 'em',
        firstArg: 'new User()',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'nativeInsert',
        chainPath: 'em',
        firstArg: 'User',
      }),
    ]

    const inputs = makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'mikroorm' }],
    })
    const candidates = extractCandidates(inputs, buildSemanticIndex(inputs))
      .filter((candidate) => candidate.kind === 'db_access' && candidate.payload.adapter === 'mikroorm')
    const result = runPipeline(inputs)

    expect(candidates.map((candidate) => candidate.payload.method).sort()).toEqual(['nativeInsert', 'persistAndFlush'])
    expect(result.every((r) => r.kind === 'db_access')).toBe(true)
    expect(result.every((r) => r.operation === 'insert')).toBe(true)
    expect(result.every((r) => r.payload.adapter === 'mikroorm')).toBe(true)
  })

  it('nativeUpdate(User) and nativeDelete(User) map write operations', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:syncUsers`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@mikro-orm/core',
        targetSymbol: 'EntityManager',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'nativeUpdate',
        chainPath: 'em',
        firstArg: 'User',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'nativeDelete',
        chainPath: 'em',
        firstArg: 'User',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'mikroorm' }],
    }))

    expect(result.map((r) => r.operation).sort()).toEqual(['delete', 'update'])
    expect(result.every((r) => r.target === 'users')).toBe(true)
    expect(result.every((r) => r.payload.adapter === 'mikroorm')).toBe(true)
  })

  it('em.getRepository(User).findAll() resolves repository factory chain', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:listUsersFromRepo`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@mikro-orm/core',
        targetSymbol: 'EntityManager',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findAll',
        chainPath: 'em.getRepository(User)',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'mikroorm' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'mikroorm', adapter: 'mikroorm' },
    })
  })

  it('EntityRepository<User> + this.userRepository.findOne() resolves generic model', () => {
    const serviceNode = makeNode(`${REPO_ID}:src/users.repo.ts:UsersRepo`, {
      type: 'class',
      name: 'UsersRepo',
      filePath: 'src/users.repo.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:getUser`, {
      filePath: 'src/users.repo.ts',
    })
    const edges = [
      makeEdge(serviceNode.id, 'contains', { targetId: handlerNode.id }),
      makeEdge(handlerNode.id, 'type_resolved', {
        targetSymbol: 'EntityRepository<User>',
        targetSpecifier: '@mikro-orm/core',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findOne',
        chainPath: 'this.userRepository',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [serviceNode, handlerNode],
      edges,
      models: [{ modelName: 'User', tableName: 'users', orm: 'mikroorm' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'mikroorm', adapter: 'mikroorm' },
    })
  })

  it('does not emit dynamic entity arguments', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.repo.ts:dynamicEntity`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@mikro-orm/core',
        targetSymbol: 'EntityManager',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'find',
        chainPath: 'em',
        firstArg: 'entity',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

describe('Redis adapter graph trace', () => {
  it('maps representative string/hash/sorted-set commands to operations and key prefixes', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/cache.service.ts:syncCache`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'ioredis',
        targetSymbol: 'Redis',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'redis',
        firstArg: 'user:1',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'set',
        chainPath: 'redis',
        firstArg: 'session:1',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'hset',
        chainPath: 'redis',
        firstArg: 'profile:1',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'zrem',
        chainPath: 'redis',
        firstArg: 'leaderboard:global',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result.map((r) => `${r.target}:${r.operation}`).sort()).toEqual([
      'leaderboard:delete',
      'profile:insert',
      'session:insert',
      'user:select',
    ])
    expect(result.every((r) => r.payload.adapter === 'redis')).toBe(true)
  })

  it('normalizes template literal keys to their static prefix', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/cache.service.ts:getUser`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'redis',
        targetSymbol: 'createClient',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'redis',
        firstArg: '`user:${id}`',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'user',
      operation: 'select',
      payload: { orm: 'redis', adapter: 'redis' },
    })
  })

  it('traces imported redis singleton through its target file evidence', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/cache.service.ts:setUser`, {
      filePath: 'src/cache.service.ts',
    })
    const importNode = makeNode(`${REPO_ID}:src/cache.service.ts:imports`, {
      type: 'file',
      filePath: 'src/cache.service.ts',
    })
    const redisNode = makeNode(`${REPO_ID}:src/redis.ts:redis`, {
      type: 'variable',
      name: 'redis',
      filePath: 'src/redis.ts',
    })
    const redisFileNode = makeNode(`${REPO_ID}:src/redis.ts:imports`, {
      type: 'file',
      filePath: 'src/redis.ts',
    })
    const edges = [
      makeEdge(importNode.id, 'imports', {
        targetSpecifier: './redis',
        targetSymbol: 'redis',
        targetId: redisNode.id,
      }),
      makeEdge(redisFileNode.id, 'imports', {
        targetSpecifier: 'ioredis',
        targetSymbol: 'Redis',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'set',
        chainPath: 'redis',
        firstArg: 'user:1',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode, importNode, redisNode, redisFileNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'user',
      operation: 'insert',
      payload: { orm: 'redis', adapter: 'redis' },
    })
  })

  it('does not emit opaque dynamic key variables', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/cache.service.ts:dynamicKey`)
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'ioredis',
        targetSymbol: 'Redis',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'redis',
        firstArg: 'cacheKey',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'db_access')).toHaveLength(0)
  })
})

describe('DB access anchor edge branches', () => {
  it('uses parent class imports for tx alias calls inside a contained method', () => {
    const serviceNode = makeNode(`${REPO_ID}:src/order.service.ts:OrderService`, {
      type: 'class',
      name: 'OrderService',
      filePath: 'src/order.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/order.service.ts:placeOrder`, {
      filePath: 'src/order.service.ts',
    })
    const edges = [
      makeEdge(serviceNode.id, 'imports', {
        targetSpecifier: 'knex',
        targetSymbol: 'knex',
      }),
      makeEdge(serviceNode.id, 'contains', {
        targetId: handlerNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'transaction',
        chainPath: 'knex',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insert',
        chainPath: 'tx',
        firstArg: 'orders',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [serviceNode, handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'orders',
      operation: 'insert',
      payload: { orm: 'knex' },
    })
  })

  it('uses constructor field origins for this.<field> ORM calls', () => {
    const serviceNode = makeNode(`${REPO_ID}:src/order.service.ts:OrderService`, {
      type: 'class',
      name: 'OrderService',
      filePath: 'src/order.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/order.service.ts:createOrder`, {
      filePath: 'src/order.service.ts',
    })
    const edges = [
      makeEdge(serviceNode.id, 'contains', {
        targetId: handlerNode.id,
      }),
      makeEdge(handlerNode.id, 'type_resolved', {
        targetSymbol: 'DataSource',
        targetSpecifier: 'typeorm',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'this.dataSource.order',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [serviceNode, handlerNode],
      edges,
      models: [{ modelName: 'Order', tableName: 'orders', orm: 'typeorm' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'orders',
      operation: 'insert',
      payload: { orm: 'typeorm' },
    })
  })

  it('uses same-file ORM imports for this.<field> calls without DI metadata', () => {
    const importNode = makeNode(`${REPO_ID}:src/user.service.ts:imports`, {
      type: 'file',
      name: 'user.service.ts',
      filePath: 'src/user.service.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/user.service.ts:listUsers`, {
      filePath: 'src/user.service.ts',
    })
    const edges = [
      makeEdge(importNode.id, 'imports', {
        targetSpecifier: 'typeorm',
        targetSymbol: 'Repository',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'find',
        chainPath: 'this.userRepository',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [importNode, handlerNode],
      edges,
      models: [{ modelName: 'userRepository', tableName: 'users', orm: 'typeorm' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: { orm: 'typeorm' },
    })
  })
})

describe('detectOrmFromPackage', () => {
  it('classifies supported ORM package families and unknown values', () => {
    expect(detectOrmFromPackage(null)).toBe('unknown')
    expect(detectOrmFromPackage('@prisma/client')).toBe('prisma')
    expect(detectOrmFromPackage('@nestjs/typeorm')).toBe('typeorm')
    expect(detectOrmFromPackage('mongoose')).toBe('mongoose')
    expect(detectOrmFromPackage('@nestjs/sequelize')).toBe('sequelize')
    expect(detectOrmFromPackage('drizzle-orm')).toBe('drizzle')
    expect(detectOrmFromPackage('knex')).toBe('knex')
    expect(detectOrmFromPackage('kysely')).toBe('kysely')
    expect(detectOrmFromPackage('ioredis')).toBe('redis')
    expect(detectOrmFromPackage('redis')).toBe('redis')
    expect(detectOrmFromPackage('@supabase/supabase-js')).toBe('supabase')
    expect(detectOrmFromPackage('@mikro-orm/core')).toBe('mikroorm')
    expect(detectOrmFromPackage('pg')).toBe('unknown')
  })
})

describe('real project regressions: SGlobal Prisma singleton', () => {
  function sglobalPrismaEvidence() {
    const fileNode = makeNode(`${REPO_ID}:src/SGlobal.ts`, {
      type: 'file',
      name: 'src/SGlobal.ts',
      filePath: 'src/SGlobal.ts',
      lineStart: null,
      lineEnd: null,
    })
    const classNode = makeNode(`${REPO_ID}:src/SGlobal.ts:SGlobal`, {
      type: 'class',
      name: 'SGlobal',
      filePath: 'src/SGlobal.ts',
    })
    const prismaClientNode = makeNode(`${REPO_ID}:src/SGlobal.ts:SGlobal.prismaClient`, {
      type: 'property',
      name: 'SGlobal.prismaClient',
      filePath: 'src/SGlobal.ts',
    })
    const prismaNode = makeNode(`${REPO_ID}:src/SGlobal.ts:SGlobal.prisma`, {
      type: 'property',
      name: 'SGlobal.prisma',
      filePath: 'src/SGlobal.ts',
    })
    const prismaPrimaryNode = makeNode(`${REPO_ID}:src/SGlobal.ts:SGlobal.prismaPrimary`, {
      type: 'property',
      name: 'SGlobal.prismaPrimary',
      filePath: 'src/SGlobal.ts',
    })
    const nodes = [fileNode, classNode, prismaClientNode, prismaNode, prismaPrimaryNode]
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: '@prisma/client',
        targetSymbol: 'PrismaClient',
      }),
      makeEdge(classNode.id, 'contains', {
        targetId: prismaClientNode.id,
        targetSymbol: 'prismaClient',
        resolveStatus: 'resolved',
      }),
      makeEdge(classNode.id, 'contains', {
        targetId: prismaNode.id,
        targetSymbol: 'prisma',
        resolveStatus: 'resolved',
      }),
      makeEdge(classNode.id, 'contains', {
        targetId: prismaPrimaryNode.id,
        targetSymbol: 'prismaPrimary',
        resolveStatus: 'resolved',
      }),
      makeEdge(prismaClientNode.id, 'calls', {
        targetSymbol: 'PrismaClient',
      }),
      makeEdge(prismaPrimaryNode.id, 'calls', {
        targetSymbol: '$primary',
        chainPath: 'this.prismaClient',
      }),
    ]
    return { nodes, edges }
  }

  it('SGlobal.prisma.sellerMember.findUnique() emits db_access select', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/guards/seller-auth.strategy.ts:validate`, {
      filePath: 'src/guards/seller-auth.strategy.ts',
    })
    const evidence = sglobalPrismaEvidence()
    const edges = [
      ...evidence.edges,
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findUnique',
        chainPath: 'SGlobal.prisma.sellerMember',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, ...evidence.nodes],
      edges,
      models: [{ modelName: 'sellerMember', tableName: 'seller_members', orm: 'prisma' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'seller_members',
      operation: 'select',
      payload: { orm: 'prisma' },
    })
  })

  it('SGlobal.prismaPrimary.rewardPointLog.findMany() emits db_access select', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/apiv1/point/point.repository.ts:list`, {
      filePath: 'src/apiv1/point/point.repository.ts',
    })
    const evidence = sglobalPrismaEvidence()
    const edges = [
      ...evidence.edges,
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findMany',
        chainPath: 'SGlobal.prismaPrimary.rewardPointLog',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, ...evidence.nodes],
      edges,
      models: [{ modelName: 'rewardPointLog', tableName: 'reward_point_logs', orm: 'prisma' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'reward_point_logs',
      operation: 'select',
      payload: { orm: 'prisma' },
    })
  })

  it('SGlobal.prisma 이름만 있고 PrismaClient evidence가 없으면 db_access를 만들지 않는다', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/fake.ts:run`, {
      filePath: 'src/fake.ts',
    })
    const fakeGlobalNode = makeNode(`${REPO_ID}:src/SGlobal.ts:SGlobal.prisma`, {
      type: 'property',
      name: 'SGlobal.prisma',
      filePath: 'src/SGlobal.ts',
    })
    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findUnique',
        chainPath: 'SGlobal.prisma.sellerMember',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, fakeGlobalNode],
      edges,
      models: [{ modelName: 'sellerMember', tableName: 'seller_members', orm: 'prisma' }],
    }))

    expect(result).toHaveLength(0)
  })
})

describe('real project regressions: Kysely table aliases', () => {
  function sglobalKyselyEvidence() {
    const fileNode = makeNode(`${REPO_ID}:src/SGlobal.ts`, {
      type: 'file',
      name: 'src/SGlobal.ts',
      filePath: 'src/SGlobal.ts',
      lineStart: null,
      lineEnd: null,
    })
    const classNode = makeNode(`${REPO_ID}:src/SGlobal.ts:SGlobal`, {
      type: 'class',
      name: 'SGlobal',
      filePath: 'src/SGlobal.ts',
    })
    const kyselyNode = makeNode(`${REPO_ID}:src/SGlobal.ts:SGlobal.kysely`, {
      type: 'property',
      name: 'SGlobal.kysely',
      filePath: 'src/SGlobal.ts',
    })
    const nodes = [fileNode, classNode, kyselyNode]
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: 'kysely',
        targetSymbol: 'Kysely',
      }),
      makeEdge(classNode.id, 'contains', {
        targetId: kyselyNode.id,
        targetSymbol: 'kysely',
        resolveStatus: 'resolved',
      }),
      makeEdge(kyselyNode.id, 'calls', {
        targetSymbol: 'Kysely',
      }),
    ]
    return { nodes, edges }
  }

  it("SGlobal.kysely.selectFrom('boards') emits db_access select", () => {
    const handlerNode = makeNode(`${REPO_ID}:src/batch/board.best.selection.batch.usecase.ts:selectBestPostsForAgeGroup`, {
      filePath: 'src/batch/board.best.selection.batch.usecase.ts',
    })
    const evidence = sglobalKyselyEvidence()
    const edges = [
      ...evidence.edges,
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'selectFrom',
        chainPath: 'SGlobal.kysely',
        firstArg: 'boards',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, ...evidence.nodes],
      edges,
      models: [{ modelName: 'boards', tableName: 'boards', orm: 'kysely' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'boards',
      operation: 'select',
      payload: { orm: 'kysely', adapter: 'kysely' },
    })
  })

  it("db.selectFrom('sellerSettlementItem as ssi') strips SQL alias before target mapping", () => {
    const handlerNode = makeNode(`${REPO_ID}:src/batch/settlement.scheduler.ts:run`, {
      filePath: 'src/batch/settlement.scheduler.ts',
    })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'kysely',
        targetSymbol: 'Kysely',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'selectFrom',
        chainPath: 'db',
        firstArg: 'sellerSettlementItem as ssi',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'sellerSettlementItem', tableName: 'seller_settlement_items', orm: 'kysely' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'seller_settlement_items',
      operation: 'select',
      payload: { orm: 'kysely', adapter: 'kysely' },
    })
  })

  it("source fallback (generic kysely import) selectFrom('sellerSettlementItem as ssi') strips SQL alias before target mapping", () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'relations-kysely-source-'))
    mkdirSync(join(repoPath, 'src/batch'), { recursive: true })
    writeFileSync(join(repoPath, 'src/batch/settlement.scheduler.ts'), `
import { Kysely } from 'kysely'

export async function executeSettlement() {
  return db
    .selectFrom('sellerSettlementItem as ssi')
    .selectAll()
}
`)
    const handlerNode = makeNode(`${REPO_ID}:src/batch/settlement.scheduler.ts:executeSettlement`, {
      filePath: 'src/batch/settlement.scheduler.ts',
      lineStart: 4,
      lineEnd: 8,
    })

    const result = runPipeline(makeInputs({
      repoPath,
      nodes: [handlerNode],
      edges: [],
      models: [{ modelName: 'sellerSettlementItem', tableName: 'seller_settlement_items', orm: 'kysely' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'seller_settlement_items',
      operation: 'select',
      payload: { orm: 'kysely', adapter: 'source_static_db_call' },
    })
  })

  it("db.insertInto('boardBestLogs') emits db_access insert", () => {
    const handlerNode = makeNode(`${REPO_ID}:src/batch/board.best.selection.batch.usecase.ts:run`, {
      filePath: 'src/batch/board.best.selection.batch.usecase.ts',
    })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'kysely',
        targetSymbol: 'Kysely',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insertInto',
        chainPath: 'db',
        firstArg: 'boardBestLogs',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode],
      edges,
      models: [{ modelName: 'boardBestLogs', tableName: 'board_best_logs', orm: 'kysely' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'board_best_logs',
      operation: 'insert',
      payload: { orm: 'kysely', adapter: 'kysely' },
    })
  })

  it("SGlobal.kysely.transaction() lets trx.insertInto('boardBestLogs') emit db_access insert", () => {
    const handlerNode = makeNode(`${REPO_ID}:src/batch/board.best.selection.batch.usecase.ts:weeklyBestPostSelectionBatch`, {
      filePath: 'src/batch/board.best.selection.batch.usecase.ts',
    })
    const evidence = sglobalKyselyEvidence()
    const edges = [
      ...evidence.edges,
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'transaction',
        chainPath: 'SGlobal.kysely',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'insertInto',
        chainPath: 'trx',
        firstArg: 'boardBestLogs',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [handlerNode, ...evidence.nodes],
      edges,
      models: [{ modelName: 'boardBestLogs', tableName: 'board_best_logs', orm: 'kysely' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'board_best_logs',
      operation: 'insert',
      payload: { orm: 'kysely', adapter: 'kysely' },
    })
  })

  it("this.kysely alias initialized from SGlobal.kysely emits db_access from graph evidence", () => {
    const classNode = makeNode(`${REPO_ID}:src/batch/track.deliveries.batch.usecase.ts:TrackDeliveriesBatchUsecase`, {
      type: 'class',
      name: 'TrackDeliveriesBatchUsecase',
      filePath: 'src/batch/track.deliveries.batch.usecase.ts',
    })
    const fieldNode = makeNode(`${REPO_ID}:src/batch/track.deliveries.batch.usecase.ts:TrackDeliveriesBatchUsecase.kysely`, {
      type: 'property',
      name: 'TrackDeliveriesBatchUsecase.kysely',
      filePath: 'src/batch/track.deliveries.batch.usecase.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/batch/track.deliveries.batch.usecase.ts:TrackDeliveriesBatchUsecase.getTargetDeliveries`, {
      filePath: 'src/batch/track.deliveries.batch.usecase.ts',
    })
    const evidence = sglobalKyselyEvidence()
    const edges = [
      ...evidence.edges,
      makeEdge(classNode.id, 'contains', {
        targetId: fieldNode.id,
        targetSymbol: 'kysely',
        resolveStatus: 'resolved',
      }),
      makeEdge(classNode.id, 'contains', {
        targetId: handlerNode.id,
        targetSymbol: 'getTargetDeliveries',
        resolveStatus: 'resolved',
      }),
      makeEdge(fieldNode.id, 'type_ref', {
        targetSymbol: 'SGlobal',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'selectFrom',
        chainPath: 'this.kysely',
        firstArg: 'shoppingDeliveryShippers as sds',
      }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [classNode, fieldNode, handlerNode, ...evidence.nodes],
      edges,
      models: [{ modelName: 'shoppingDeliveryShippers', tableName: 'shopping_delivery_shippers', orm: 'kysely' }],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'shopping_delivery_shippers',
      operation: 'select',
      payload: { orm: 'kysely', adapter: 'kysely' },
    })
  })
})

// ── REL-S30: module-level Prisma singleton const, default-imported ─────────
//
// 실사례 (express-ts-auth-service): `config/prisma.ts` 가
//   import { PrismaClient } from '@prisma/client'
//   const prismaClient: PrismaClient = new PrismaClient()
//   export default prismaClient
// 를 정의하고, 컨트롤러가 `import prismaClient from '../config/prisma'` 후
// `prismaClient.user.findMany()` 호출.
//
// const 노드(prismaClient)는 typeRef/call(`PrismaClient|@prisma/client`)로 db_client 증거를
// 갖지만 import edge 는 파일 노드에 달려 있어 wrapper.targetPackage 가 null 이 된다. receiver
// trace 가 이 wrapper 를 이름으로 매칭하면서 orm='unknown' 으로 조기 단락(short-circuit)하면
// 더 깊은 typeRef 증거를 보지 못하고 후보가 버려진다 (RED). receiver 이름이 'prisma' 인
// realworld 변형은 통과하는데 'prismaClient' 인 이 경우만 누락되던 비대칭 버그.
describe('REL-S30: module-level Prisma singleton const (default import)', () => {
  function singletonScenario(receiverName: 'prismaClient' | 'prisma') {
    const clientFile = `src/config/${receiverName}.ts`
    const clientNode = makeNode(`${REPO_ID}:${clientFile}:${receiverName}`, {
      type: 'variable', name: receiverName, filePath: clientFile,
    })
    const handlerNode = makeNode(`${REPO_ID}:src/controller/user.controller.ts:handleGetUser`, {
      type: 'function', name: 'handleGetUser', filePath: 'src/controller/user.controller.ts',
    })

    const edges = [
      // config/prisma.ts: `import { PrismaClient } from '@prisma/client'` — file 노드에 달림
      makeEdge(`${REPO_ID}:${clientFile}`, 'imports', {
        targetSpecifier: '@prisma/client', targetSymbol: 'PrismaClient', targetId: null,
      }),
      // const prismaClient: PrismaClient = new PrismaClient() — const 노드의 typeRef/call
      makeEdge(clientNode.id, 'type_ref', {
        targetSymbol: 'PrismaClient', targetSpecifier: '@prisma/client',
      }),
      makeEdge(clientNode.id, 'calls', {
        targetSymbol: 'PrismaClient', targetSpecifier: '@prisma/client',
      }),
      // controller: `import prismaClient from '../config/prisma'` (default import) → 파일 노드에 달림
      makeEdge(`${REPO_ID}:src/controller/user.controller.ts`, 'imports', {
        targetSpecifier: '../config/prisma', targetSymbol: 'default', targetId: clientNode.id,
      }),
      // prismaClient.user.findMany()
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'findMany', chainPath: `${receiverName}.user`, targetId: null,
      }),
    ]

    return runPipeline(makeInputs({
      nodes: [
        clientNode,
        makeNode(`${REPO_ID}:${clientFile}`, { type: 'file', name: clientFile, filePath: clientFile }),
        handlerNode,
        makeNode(`${REPO_ID}:src/controller/user.controller.ts`, {
          type: 'file', name: 'src/controller/user.controller.ts', filePath: 'src/controller/user.controller.ts',
        }),
      ],
      edges,
      models: [{ modelName: 'User', tableName: 'User', orm: 'prisma' }],
    }))
  }

  it("receiver 'prismaClient' (const named prismaClient) → db:User:select", () => {
    const result = singletonScenario('prismaClient')
    const rel = result.find((r) => r.kind === 'db_access')
    expect(rel, 'expected db:User:select but build_relations emitted nothing').toBeDefined()
    expect(rel?.target).toBe('User')
    expect(rel?.operation).toBe('select')
    expect(rel?.canonicalTarget).toBe('db:User:select')
    expect(rel?.payload).toMatchObject({ orm: 'prisma' })
  })

  it("receiver 'prisma' (const named prisma) → db:User:select (control, already worked)", () => {
    const result = singletonScenario('prisma')
    const rel = result.find((r) => r.kind === 'db_access')
    expect(rel).toBeDefined()
    expect(rel?.canonicalTarget).toBe('db:User:select')
  })
})
