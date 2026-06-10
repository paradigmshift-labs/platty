import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestPlattyDb, schema, type DB, type TestPlattyDb } from '@platty/core'
import { runPlattyCommand } from '../../src/main.js'

let rootDir: string
let db: DB
let client: TestPlattyDb

const { codeNodes, entryPoints, repositories } = schema

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), 'platty-cli-docs-targets-'))
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

describe('platty docs targets commands', () => {
  it('lists all target kinds with --kind all and filters by status', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedTargets(projectId)

    const all = await runPlattyCommand([
      'docs',
      'targets',
      'list',
      '--project',
      'Commerce',
      '--kind',
      'all',
      '--json',
    ], { cwd: rootDir, db })

    expect(all.exitCode).toBe(0)
    expect(all.result.data).toMatchObject({
      summary: {
        total: 4,
        api: 1,
        screen: 1,
        job: 1,
        event: 1,
        deprecated: 0,
      },
    })
    expect(all.result.data?.targets.map((target: { kind: string }) => target.kind).sort()).toEqual(['api', 'event', 'job', 'screen'])

    await runPlattyCommand([
      'docs',
      'targets',
      'deprecate',
      '--project',
      'Commerce',
      '--ids',
      'ep:event',
      '--json',
    ], { cwd: rootDir, db })

    const deprecated = await runPlattyCommand([
      'docs',
      'targets',
      'list',
      '--project',
      'Commerce',
      '--status',
      'deprecated',
      '--json',
    ], { cwd: rootDir, db })

    expect(deprecated.exitCode).toBe(0)
    expect(deprecated.result.data?.targets.map((target: { id: string }) => target.id)).toEqual(['ep:event'])
  })

  it('deprecates and includes mixed target kinds with kind summaries', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedTargets(projectId)

    const deprecate = await runPlattyCommand([
      'docs',
      'targets',
      'deprecate',
      '--project',
      'Commerce',
      '--ids',
      'ep:api,ep:screen,ep:job,ep:event',
      '--json',
    ], { cwd: rootDir, db })

    expect(deprecate.exitCode).toBe(0)
    expect(deprecate.result.data).toMatchObject({
      decision: 'deprecated',
      updatedByKind: {
        api: 1,
        screen: 1,
        job: 1,
        event: 1,
      },
      updated_by_kind: {
        api: 1,
        screen: 1,
        job: 1,
        event: 1,
      },
    })

    const include = await runPlattyCommand([
      'docs',
      'targets',
      'include',
      '--project',
      'Commerce',
      '--ids',
      'ep:api,ep:screen,ep:job,ep:event',
      '--json',
    ], { cwd: rootDir, db })

    expect(include.exitCode).toBe(0)
    expect(include.result.data).toMatchObject({
      decision: 'include',
      updatedByKind: {
        api: 1,
        screen: 1,
        job: 1,
        event: 1,
      },
    })
  })
})

function seedTargets(projectId: string): void {
  db.insert(repositories).values({
    id: 'repo:commerce',
    projectId,
    name: 'commerce',
    repoPath: '/repo/commerce',
  }).run()
  db.insert(codeNodes).values([
    { id: 'node:api', repoId: 'repo:commerce', type: 'function', filePath: 'src/orders.ts', name: 'listOrders' },
    { id: 'node:screen', repoId: 'repo:commerce', type: 'function', filePath: 'src/orders.tsx', name: 'OrdersScreen' },
    { id: 'node:job', repoId: 'repo:commerce', type: 'function', filePath: 'src/jobs.ts', name: 'syncOrders' },
    { id: 'node:event', repoId: 'repo:commerce', type: 'function', filePath: 'src/events.ts', name: 'onOrderCreated' },
  ]).run()
  db.insert(entryPoints).values([
    entryPoint('ep:api', 'api', 'GET', '/orders', 'node:api'),
    entryPoint('ep:screen', 'page', null, '/orders', 'node:screen'),
    entryPoint('ep:job', 'job', null, 'orders.sync', 'node:job'),
    entryPoint('ep:event', 'event', null, 'order.created', 'node:event'),
  ]).run()
}

function entryPoint(
  id: string,
  kind: 'api' | 'page' | 'job' | 'event',
  httpMethod: string | null,
  path: string,
  handlerNodeId: string,
): typeof entryPoints.$inferInsert {
  return {
    id,
    repoId: 'repo:commerce',
    framework: 'test',
    kind,
    httpMethod,
    path,
    fullPath: path,
    handlerNodeId,
    detectionSource: 'rule:test',
    confidence: 'high',
  }
}
