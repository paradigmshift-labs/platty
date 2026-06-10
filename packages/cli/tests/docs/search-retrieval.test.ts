import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestPlattyDb, schema, type DB, type TestPlattyDb } from '@platty/core'
import { runPlattyCommand } from '../../src/main.js'

let rootDir: string
let db: DB
let client: TestPlattyDb

const { documentItemDocumentLinks, documents, documentItems } = schema
const now = '2026-06-10T00:00:00.000Z'

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), 'platty-cli-docs-search-'))
  vi.stubEnv('PLATTY_HOME', join(rootDir, '.platty'))
  client = createTestPlattyDb()
  db = client.db
  await runPlattyCommand(['init', '--json'], { cwd: rootDir, db })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await client.cleanup()
  rmSync(rootDir, { recursive: true, force: true })
})

describe('platty docs retrieval commands', () => {
  it('lists compact document candidates with filters and freshness metadata', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedDocument(projectId, {
      id: 'doc:project-glossary',
      type: 'glossary',
      scope: 'project',
      scopeId: projectId,
      title: 'Project Glossary',
      summary: 'Shared business terms',
      sourceCommit: 'commit:fresh',
    })
    seedDocument(projectId, {
      id: 'doc:epic-glossary',
      type: 'glossary',
      scope: 'epic',
      scopeId: 'epic:orders',
      title: 'Orders Glossary',
      summary: 'Order terms',
    })
    seedDocument(projectId, {
      id: 'doc:orders-br',
      type: 'br',
      scope: 'epic',
      scopeId: 'epic:orders',
      title: 'Order Rules',
      summary: 'Order business rules',
    })

    const command = await runPlattyCommand([
      'docs',
      'list',
      '--project',
      'Commerce',
      '--type',
      'glossary',
      '--track',
      'business',
      '--scope',
      'project',
      '--compact',
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result.data?.documents).toEqual([
      {
        id: 'doc:project-glossary',
        type: 'glossary',
        track: 'business',
        scope: 'project',
        scopeId: projectId,
        status: 'active',
        title: 'Project Glossary',
        summary: 'Shared business terms',
        itemCount: 0,
        freshness: {
          validity: 'fresh',
          isStale: false,
          sourceCommit: 'commit:fresh',
          sourceRunId: null,
          staticSnapshotId: null,
          documentSourceHash: null,
          updatedAt: now,
        },
      },
    ])
  })

  it('returns parent document freshness for matching documents and items', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedDocument(projectId, {
      id: 'doc:kakao-glossary',
      type: 'glossary',
      scope: 'project',
      scopeId: projectId,
      title: 'Kakao Glossary',
      summary: '카카오 로그인 용어',
      validity: 'stale',
      sourceCommit: 'commit:old',
      staticSnapshotId: 'snapshot:old',
      documentSourceHash: 'hash:old',
    })
    db.insert(documentItems).values({
      id: 'item:kakao-auth',
      documentId: 'doc:kakao-glossary',
      projectId,
      itemType: 'term',
      stableKey: 'term:kakao-auth',
      ordinal: 1,
      title: '카카오 인증 코드 교환',
      summary: 'Kakao authorization code exchange',
      content: { aliases: ['Kakao auth', 'authorization code'] },
      contentHash: 'hash:item:kakao-auth',
      status: 'active',
      createdBy: 'system',
      updatedBy: 'system',
      updatedAt: now,
    }).run()

    const command = await runPlattyCommand([
      'docs',
      'search',
      '--project',
      'Commerce',
      '카카오',
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result.data?.results).toEqual([
      expect.objectContaining({
        kind: 'document',
        documentId: 'doc:kakao-glossary',
        title: 'Kakao Glossary',
        freshness: expect.objectContaining({
          validity: 'stale',
          isStale: true,
          sourceCommit: 'commit:old',
          staticSnapshotId: 'snapshot:old',
          documentSourceHash: 'hash:old',
        }),
      }),
      expect.objectContaining({
        kind: 'item',
        documentId: 'doc:kakao-glossary',
        itemId: 'item:kakao-auth',
        title: '카카오 인증 코드 교환',
        freshness: expect.objectContaining({
          validity: 'stale',
          isStale: true,
          sourceCommit: 'commit:old',
          staticSnapshotId: 'snapshot:old',
          documentSourceHash: 'hash:old',
        }),
      }),
    ])
  })

  it('shows a document with active items and related traversal links', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedDocument(projectId, {
      id: 'doc:ucl:orders',
      type: 'ucl',
      scope: 'epic',
      scopeId: 'epic:orders',
      title: 'Order Use Cases',
      summary: 'Order use case list',
    })
    seedDocument(projectId, {
      id: 'doc:ucs:create-order',
      type: 'ucs',
      scope: 'use_case',
      scopeId: 'epic:epic:orders:use_case:uc:create-order',
      title: 'Create Order',
      summary: 'Create order details',
    })
    db.insert(documentItems).values({
      id: 'item:ucl:create-order',
      documentId: 'doc:ucl:orders',
      projectId,
      itemType: 'use_case',
      stableKey: 'uc:create-order',
      ordinal: 1,
      title: 'Create order',
      summary: 'Create order.',
      content: { use_case_id: 'uc:create-order' },
      contentHash: 'hash:item:ucl:create-order',
      status: 'active',
      createdBy: 'system',
      updatedBy: 'system',
      updatedAt: now,
    }).run()
    db.insert(documentItemDocumentLinks).values({
      fromItemId: 'item:ucl:create-order',
      toDocumentId: 'doc:ucs:create-order',
      linkType: 'expands_use_case',
      role: 'primary',
      createdBy: 'business_graph_materializer_v1',
      createdAt: now,
    }).run()

    const show = await runPlattyCommand([
      'docs',
      'show',
      '--project',
      'Commerce',
      '--document',
      'doc:ucl:orders',
      '--json',
    ], { cwd: rootDir, db })
    const related = await runPlattyCommand([
      'docs',
      'related',
      '--project',
      'Commerce',
      '--document',
      'doc:ucl:orders',
      '--json',
    ], { cwd: rootDir, db })

    expect(show.exitCode).toBe(0)
    expect(show.result.data).toMatchObject({
      document: {
        id: 'doc:ucl:orders',
        type: 'ucl',
        freshness: { isStale: false },
      },
      items: [
        expect.objectContaining({
          id: 'item:ucl:create-order',
          targetDocumentLinks: [
            expect.objectContaining({
              documentId: 'doc:ucs:create-order',
              linkType: 'expands_use_case',
              target: expect.objectContaining({ id: 'doc:ucs:create-order', type: 'ucs' }),
            }),
          ],
        }),
      ],
    })
    expect(related.exitCode).toBe(0)
    expect(related.result.data).toMatchObject({
      documentId: 'doc:ucl:orders',
      itemDocumentLinks: [
        expect.objectContaining({
          fromItemId: 'item:ucl:create-order',
          documentId: 'doc:ucs:create-order',
          linkType: 'expands_use_case',
        }),
      ],
    })
  })

  it('shows DD model and field links on document items', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedDocument(projectId, {
      id: 'doc:orders-dd',
      type: 'data_dictionary',
      scope: 'epic',
      scopeId: 'epic:orders',
      title: 'Order Data Dictionary',
      summary: 'Order data entities',
    })
    seedRepository(projectId)
    db.insert(schema.models).values({
      id: 'repo:test:Order',
      repositoryId: 'repo:test',
      name: 'Order',
      tableName: 'orders',
      comment: null,
      description: 'Stores placed orders.',
      fields: [
        { name: 'id', type: 'String', nullable: false, primary: true, unique: true, line: 1 },
        { name: 'status', type: 'String', nullable: false, primary: false, unique: false, line: 2 },
      ],
      relations: [],
      isDeprecated: false,
      sourceFile: 'prisma/schema.prisma',
      lineStart: 10,
      lineEnd: 20,
      orm: 'prisma',
      builtFromCommit: 'commit:model',
      validity: 'fresh',
      createdAt: now,
      updatedAt: now,
    }).run()
    db.insert(documentItems).values({
      id: 'item:dd:order',
      documentId: 'doc:orders-dd',
      projectId,
      itemType: 'entity',
      stableKey: 'entity:order',
      ordinal: 1,
      title: 'Order',
      summary: 'Order business entity.',
      content: { entity: 'Order' },
      contentHash: 'hash:item:dd:order',
      status: 'active',
      createdBy: 'system',
      updatedBy: 'system',
      updatedAt: now,
    }).run()
    db.insert(schema.documentItemModelLinks).values([
      {
        projectId,
        itemId: 'item:dd:order',
        modelId: 'repo:test:Order',
        fieldName: null,
        linkType: 'describes_model',
        role: 'primary',
        evidenceJson: { source: 'dd-storage' },
        createdBy: 'business_graph_materializer_v1',
        createdAt: now,
      },
      {
        projectId,
        itemId: 'item:dd:order',
        modelId: 'repo:test:Order',
        fieldName: 'status',
        linkType: 'describes_field',
        role: 'primary',
        evidenceJson: { source: 'dd-field' },
        createdBy: 'business_graph_materializer_v1',
        createdAt: now,
      },
    ]).run()

    const show = await runPlattyCommand([
      'docs',
      'show',
      '--project',
      'Commerce',
      '--document',
      'doc:orders-dd',
      '--json',
    ], { cwd: rootDir, db })

    expect(show.exitCode).toBe(0)
    expect(show.result.data).toMatchObject({
      items: [
        expect.objectContaining({
          id: 'item:dd:order',
          modelLinks: [
            expect.objectContaining({
              modelId: 'repo:test:Order',
              modelName: 'Order',
              tableName: 'orders',
              fieldName: null,
              linkType: 'describes_model',
            }),
            expect.objectContaining({
              modelId: 'repo:test:Order',
              modelName: 'Order',
              tableName: 'orders',
              fieldName: 'status',
              linkType: 'describes_field',
              field: expect.objectContaining({ name: 'status', type: 'String' }),
            }),
          ],
        }),
      ],
    })
  })

  it('shows API code node file locations for technical documents', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedCodeEvidence(projectId)
    seedDocument(projectId, {
      id: 'doc:api:list-orders',
      type: 'api_spec',
      scope: 'endpoint',
      scopeId: 'ep:api:listOrders',
      title: 'GET /api/orders',
      summary: 'List orders API',
    })

    const show = await runPlattyCommand([
      'docs',
      'show',
      '--project',
      'Commerce',
      '--document',
      'doc:api:list-orders',
      '--json',
    ], { cwd: rootDir, db })

    expect(show.exitCode).toBe(0)
    expect(show.result.data).toMatchObject({
      code: {
        primaryNode: {
          nodeId: 'node:controller:listOrders',
          kind: 'method',
          symbol: 'OrdersController.listOrders',
          filePath: 'src/orders.controller.ts',
          startLine: 10,
          endLine: 24,
        },
        relatedNodes: [
          expect.objectContaining({
            nodeId: 'node:service:listOrders',
            role: 'reachable',
            symbol: 'OrdersService.listOrders',
            filePath: 'src/orders.service.ts',
            startLine: 30,
            endLine: 55,
          }),
        ],
      },
    })
  })

  it('finds and shows unmatched frontend API calls stored on screen specs', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedDocument(projectId, {
      id: 'doc:screen:login',
      type: 'screen_spec',
      scope: 'route',
      scopeId: '/login',
      title: 'Login Screen',
      summary: 'Kakao login screen',
      content: {
        title: 'Login Screen',
        relations: {
          api_calls: [
            { method: 'POST', path: '/api/auth/kakao' },
          ],
        },
      },
    })

    const search = await runPlattyCommand([
      'docs',
      'search',
      '--project',
      'Commerce',
      '/api/auth/kakao',
      '--json',
    ], { cwd: rootDir, db })
    const show = await runPlattyCommand([
      'docs',
      'show',
      '--project',
      'Commerce',
      '--document',
      'doc:screen:login',
      '--json',
    ], { cwd: rootDir, db })
    const related = await runPlattyCommand([
      'docs',
      'related',
      '--project',
      'Commerce',
      '--document',
      'doc:screen:login',
      '--json',
    ], { cwd: rootDir, db })

    expect(search.exitCode).toBe(0)
    expect(search.result.data?.results).toEqual([
      expect.objectContaining({
        kind: 'document',
        documentId: 'doc:screen:login',
        type: 'screen_spec',
        title: 'Login Screen',
      }),
    ])
    expect(show.exitCode).toBe(0)
    expect(show.result.data).toMatchObject({
      document: {
        id: 'doc:screen:login',
        type: 'screen_spec',
        content: {
          relations: {
            api_calls: [
              { method: 'POST', path: '/api/auth/kakao' },
            ],
          },
        },
      },
    })
    expect(related.exitCode).toBe(0)
    expect(related.result.data).toMatchObject({
      outgoingDocumentLinks: [],
      incomingDocumentLinks: [],
      itemDocumentLinks: [],
    })
  })
})

function seedDocument(
  projectId: string,
  input: {
    id: string
    type: string
    scope: string
    scopeId: string
    title: string
    summary: string
    validity?: 'fresh' | 'stale' | 'orphaned'
    sourceCommit?: string
    staticSnapshotId?: string
    documentSourceHash?: string
    content?: Record<string, unknown>
  },
) {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: input.type === 'api_spec' || input.type === 'screen_spec' ? 'technical' : 'business',
    scope: input.scope,
    scopeId: input.scopeId,
    status: 'active',
    validity: input.validity ?? 'fresh',
    summary: input.summary,
    content: input.content ?? { title: input.title },
    rawLlmOutput: '',
    contentHash: `hash:${input.id}`,
    staticSnapshotId: input.staticSnapshotId,
    documentSourceHash: input.documentSourceHash,
    sourceRunId: null,
    sourceCommit: input.sourceCommit,
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function seedRepository(projectId: string) {
  db.insert(schema.repositories).values({
    id: 'repo:test',
    projectId,
    name: 'api-service',
    repoPath: rootDir,
    framework: 'nestjs',
    analysisBranch: 'main',
    lastSyncedCommit: 'commit:code',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedCodeEvidence(projectId: string) {
  seedRepository(projectId)
  db.insert(schema.codeNodes).values([
    codeNode('node:controller:listOrders', 'OrdersController.listOrders', 'src/orders.controller.ts', 10, 24),
    codeNode('node:service:listOrders', 'OrdersService.listOrders', 'src/orders.service.ts', 30, 55),
  ]).run()
  db.insert(schema.entryPoints).values({
    id: 'ep:api:listOrders',
    repoId: 'repo:test',
    framework: 'nestjs',
    kind: 'api',
    httpMethod: 'GET',
    path: '/api/orders',
    fullPath: '/api/orders',
    handlerNodeId: 'node:controller:listOrders',
    metadata: {},
    detectionSource: 'rule:test',
    confidence: 'high',
    detectionEvidence: { matchedNodeIds: ['node:controller:listOrders'] },
    createdAt: now,
  }).run()
  db.insert(schema.codeBundles).values([
    { entryPointId: 'ep:api:listOrders', nodeId: 'node:controller:listOrders', depth: 0, edgePath: ['node:controller:listOrders'] },
    { entryPointId: 'ep:api:listOrders', nodeId: 'node:service:listOrders', depth: 1, edgePath: ['node:controller:listOrders', 'node:service:listOrders'] },
  ]).run()
}

function codeNode(id: string, name: string, filePath: string, lineStart: number, lineEnd: number) {
  return {
    id,
    repoId: 'repo:test',
    type: 'method',
    filePath,
    name,
    lineStart,
    lineEnd,
    normalizedCodeHash: `hash:${id}`,
    signature: `async ${name}()`,
    exported: true,
    isDefaultExport: false,
    isAsync: true,
    isTest: false,
    parseStatus: 'ok',
    createdAt: now,
  }
}
