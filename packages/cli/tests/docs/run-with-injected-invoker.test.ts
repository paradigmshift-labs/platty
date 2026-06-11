import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestPlattyDb, schema, type DB, type TestPlattyDb } from '@platty/core'
import { runPlattyCommand } from '../../src/main.js'

let rootDir: string
let db: DB
let client: TestPlattyDb

const now = '2026-06-02T00:00:00.000Z'

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), 'platty-cli-docs-'))
  vi.stubEnv('PLATTY_HOME', join(rootDir, '.platty'))
  client = createTestPlattyDb()
  db = client.db
  await runPlattyCommand(['init', '--json'], { cwd: rootDir, db })
  seedProject(db, rootDir)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await client.cleanup()
  rmSync(rootDir, { recursive: true, force: true })
})

describe('platty docs CLI worker runtime', () => {
  it('runs build_docs through an injected invoker without spawning Codex', async () => {
    const calls: Array<{ taskId: string; documentType: string; provider: string; workDir: string }> = []

    const command = await runPlattyCommand([
      'docs',
      'run',
      '--project',
      'project:docs-cli',
      '--provider',
      'codex_cli',
      '--workers',
      '1',
      '--document-types',
      'api_spec',
      '--json',
    ], {
      cwd: rootDir,
      db,
      docsTaskInvoker: async ({ taskId, documentType, model, workDir }) => {
        calls.push({ taskId, documentType, provider: model.provider, workDir })
        return {
          title: 'List Orders API',
          summary: 'Lists orders from the OrdersController handler.',
          access: 'No explicit auth guard evidence.',
          flow: ['OrdersController.listOrders reads the request and returns order data.'],
          rules: [],
          source_link_selection: { access: [], input: [], response: [] },
        }
      },
    })

    expect(command.exitCode).toBe(0)
    expect(command.result.data).toMatchObject({
      runStatus: 'completed',
      savedDocumentCount: 1,
      taskStats: { saved: 1 },
    })
    expect(calls).toEqual([
      expect.objectContaining({
        documentType: 'api_spec',
        provider: 'codex_cli',
        workDir: expect.stringContaining(join(rootDir, '.platty', 'tmp', 'build_docs_runs')),
      }),
    ])
    expect(calls[0]?.workDir).not.toContain(join('.platty', '.platty'))
  })
})

function seedProject(db: DB, repoRoot: string): void {
  writeSource(repoRoot)
  db.insert(schema.projects).values({
    id: 'project:docs-cli',
    name: 'Docs CLI Fixture',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(schema.repositories).values({
    id: 'repo:api',
    projectId: 'project:docs-cli',
    name: 'api-service',
    repoPath: repoRoot,
    framework: 'nestjs',
    analysisBranch: 'main',
    lastSyncedCommit: 'commit:docs-cli',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(schema.codeNodes).values([
    node('node:controller:listOrders', 'method', 'src/orders.controller.ts', 'OrdersController.listOrders', 'async listOrders(req)'),
    node('node:service:listOrders', 'method', 'src/orders.service.ts', 'OrdersService.listOrders', 'async listOrders()'),
  ]).run()
  db.insert(schema.entryPoints).values({
    id: 'ep:api:listOrders',
    repoId: 'repo:api',
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
  db.insert(schema.codeEdges).values({
    repoId: 'repo:api',
    sourceId: 'node:controller:listOrders',
    targetId: 'node:service:listOrders',
    relation: 'calls',
    targetSpecifier: 'OrdersService.listOrders',
    targetSymbol: 'OrdersService.listOrders',
    chainPath: 'OrdersService.listOrders',
    resolveStatus: 'resolved',
    confidence: 'high',
    source: 'static',
    createdAt: now,
  }).run()
  db.insert(schema.codeRelations).values({
    id: 'rel:api:listOrders:orders',
    repoId: 'repo:api',
    sourceNodeId: 'node:controller:listOrders',
    kind: 'db_access',
    target: 'orders',
    operation: 'select',
    canonicalTarget: 'db:orders:select',
    payload: { table: 'orders' },
    evidenceNodeIds: ['node:service:listOrders'],
    confidence: 'high',
    createdAt: now,
  }).run()
  seedRepositoryPhases(db)
  seedServiceMapPhase(db)
}

function writeSource(repoRoot: string): void {
  mkdirSync(join(repoRoot, 'src'), { recursive: true })
  writeFileSync(join(repoRoot, 'src/orders.controller.ts'), [
    'import { OrdersService } from "./orders.service"',
    'export class OrdersController {',
    '  async listOrders(req) {',
    '    return OrdersService.listOrders(req.query)',
    '  }',
    '}',
  ].join('\n'), 'utf8')
  writeFileSync(join(repoRoot, 'src/orders.service.ts'), [
    'export class OrdersService {',
    '  static async listOrders(query) {',
    '    return db.order.findMany({ where: query })',
    '  }',
    '}',
  ].join('\n'), 'utf8')
}

function node(id: string, type: 'method', filePath: string, name: string, signature: string) {
  return {
    id,
    repoId: 'repo:api',
    type,
    filePath,
    name,
    lineStart: 1,
    lineEnd: 5,
    signature,
    docComment: null,
    exported: true,
    isDefaultExport: false,
    isAsync: signature.includes('async'),
    isTest: false,
    parseStatus: 'ok' as const,
    createdAt: now,
  }
}

function seedRepositoryPhases(db: DB): void {
  const phases = ['build_graph', 'build_pattern_profile', 'build_models', 'build_route', 'build_relations'] as const
  db.insert(schema.repositoryPhaseStatus).values(phases.map((phase) => ({
    repositoryId: 'repo:api',
    phase,
    builtAt: phase === 'build_relations' ? now : '2026-06-01T00:00:00.000Z',
    builtFromCommit: 'commit:docs-cli',
    confirmedAt: phase === 'build_route' ? '2026-06-02T01:00:00.000Z' : null,
    validity: 'fresh' as const,
    status: 'passed' as const,
    sourceRunId: `run:repo:api:${phase}`,
    sourceCommit: 'commit:docs-cli',
    updatedAt: now,
  }))).run()
}

function seedServiceMapPhase(db: DB): void {
  db.insert(schema.projectPhaseStatus).values({
    projectId: 'project:docs-cli',
    phase: 'build_service_map',
    status: 'passed',
    sourceRunId: 'run:service-map',
    sourceCommit: 'commit:service-map',
    updatedAt: Date.parse('2026-06-03T00:00:00.000Z'),
    upstreamVersions: null,
    meta: null,
  }).run()
}
