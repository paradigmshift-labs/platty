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
    content: { title: input.title },
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
