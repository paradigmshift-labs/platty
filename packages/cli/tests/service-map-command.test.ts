import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTestPlattyDb, schema, type DB, type TestPlattyDb } from '@platty/core'
import { runPlattyCommand } from '../src/main.js'

let rootDir: string
let outDir: string
let client: TestPlattyDb
let db: DB

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), 'platty-service-map-cli-'))
  outDir = join(rootDir, 'graph')
  vi.stubEnv('PLATTY_HOME', join(rootDir, '.platty'))
  client = createTestPlattyDb()
  db = client.db
  await runPlattyCommand(['init', '--json'], { cwd: rootDir, db })
})

afterEach(() => {
  vi.unstubAllEnvs()
  client.close()
  rmSync(rootDir, { recursive: true, force: true })
})

describe('service-map CLI', () => {
  it('exports one service map artifact with business context when available', async () => {
    const created = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(created.result.data?.id)
    seedServiceMapAndBusinessDocs(db, projectId)

    const command = await runPlattyCommand(
      ['service-map', 'export', '--project', projectId, '--out', outDir, '--json'],
      {
        cwd: rootDir,
        db,
        now: () => new Date('2026-06-10T00:00:00.000Z'),
      },
    )

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        project: {
          id: projectId,
          name: 'Commerce',
        },
        artifact: {
          summary: {
            nodeCount: 2,
            edgeCount: 1,
          },
          businessSummary: {
            domainCount: 1,
            epicCount: 1,
            businessDocumentCount: 1,
            serviceNodeCount: 2,
          },
        },
        written: {
          jsonPath: join(outDir, 'service-map.json'),
          htmlPath: join(outDir, 'service-map.html'),
          reportPath: join(outDir, 'GRAPH_REPORT.md'),
        },
      },
      evidenceRefs: [
        { label: 'service-map-json', path: join(outDir, 'service-map.json') },
        { label: 'service-map-html', path: join(outDir, 'service-map.html') },
        { label: 'service-map-report', path: join(outDir, 'GRAPH_REPORT.md') },
      ],
    })
    expect(existsSync(join(outDir, 'service-map.json'))).toBe(true)
    expect(existsSync(join(outDir, 'service-map.html'))).toBe(true)
    expect(existsSync(join(outDir, 'GRAPH_REPORT.md'))).toBe(true)
    expect(existsSync(join(outDir, 'business-map.html'))).toBe(false)
    expect(existsSync(join(outDir, 'index.html'))).toBe(false)
    const html = readFileSync(join(outDir, 'service-map.html'), 'utf8')
    expect(html).toContain('window.__PLATTY_SERVICE_MAP__')
    expect(html).toContain('Business Context')
    expect(html).toContain('Document Viewer (1)')
    expect(html).toContain('id="docViewerOverlay"')
    expect(html).toContain('Orders')
    const json = JSON.parse(readFileSync(join(outDir, 'service-map.json'), 'utf8')) as Record<string, unknown>
    expect(json).toMatchObject({
      businessSummary: {
        domainCount: 1,
        epicCount: 1,
      },
    })
  }, 10_000)
})

function seedServiceMapAndBusinessDocs(db: DB, projectId: string) {
  db.insert(schema.repositories).values({
    id: 'repo-api',
    projectId,
    name: 'api',
    repoPath: '/tmp/api',
  }).run()
  db.insert(schema.serviceMapNodes).values([
    {
      id: 'node-screen',
      projectId,
      repoId: 'repo-api',
      type: 'screen',
      nodeId: 'screen:home',
      sourceKind: 'entry_point',
      sourceId: 'screen:home',
      canonicalKey: 'screen:home',
      label: 'Home',
    },
    {
      id: 'node-api',
      projectId,
      repoId: 'repo-api',
      type: 'api',
      nodeId: 'api:get-users',
      sourceKind: 'entry_point',
      sourceId: 'api:get-users',
      canonicalKey: 'api:get-users',
      label: 'GET /users',
    },
  ]).run()
  db.insert(schema.serviceMapEdges).values({
    id: 'edge-1',
    projectId,
    repoId: 'repo-api',
    sourceRepoId: 'repo-api',
    targetRepoId: 'repo-api',
    runId: 'run-1',
    sourceNodeId: 'node-screen',
    sourceType: 'screen',
    sourceId: 'screen:home',
    sourceLabel: 'Home',
    targetNodeId: 'node-api',
    targetType: 'api',
    targetId: 'api:get-users',
    targetLabel: 'GET /users',
    kind: 'calls_api',
    canonicalTarget: 'GET /users',
    confidence: 'high',
    source: 'deterministic',
    evidence: {},
  }).run()
  db.insert(schema.epicDomains).values({
    id: 'domain-commerce',
    projectId,
    name: 'Commerce',
    stableKey: 'commerce',
    summary: 'Commerce domain.',
    sortOrder: 1,
  }).run()
  db.insert(schema.epics).values({
    id: 'epic-orders',
    projectId,
    domainId: 'domain-commerce',
    name: 'Orders',
    stableKey: 'orders',
    summary: 'Orders epic.',
  }).run()
  db.insert(schema.documents).values([
    {
      id: 'doc-orders-br',
      projectId,
      type: 'br',
      track: 'business',
      scope: 'epic',
      scopeId: 'epic-orders',
      status: 'active',
      validity: 'fresh',
      summary: 'Orders business rules.',
      content: {
        title: 'Orders BR',
        summary: 'Rules for orders.',
      },
    },
    {
      id: 'doc-orders-api',
      projectId,
      type: 'api_spec',
      track: 'technical',
      scope: 'api',
      scopeId: 'api:get-users',
      status: 'active',
      validity: 'fresh',
      summary: 'Orders API.',
      content: {
        title: 'Orders API',
      },
    },
  ]).run()
  db.insert(schema.documentLinks).values({
    fromDocumentId: 'doc-orders-br',
    toDocumentId: 'doc-orders-api',
    linkType: 'derives_from',
  }).run()
}
