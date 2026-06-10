import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type DB } from '../../server/helpers.js'
import { projects, repositories } from '@/db/schema/core.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import { entryPoints } from '@/db/schema/build_route.js'
import {
  listDocsTargets,
  upsertAnalysisReviewDecision,
} from '@/index.js'

let db: DB

beforeEach(() => {
  db = createTestDb()
  db.insert(projects).values({ id: 'p1', name: 'Project' }).run()
  db.insert(repositories).values({ id: 'r1', projectId: 'p1', name: 'repo', repoPath: '/repo' }).run()
  db.insert(codeNodes).values([
    { id: 'node:api', repoId: 'r1', type: 'function', filePath: 'src/orders.ts', name: 'listOrders' },
    { id: 'node:screen', repoId: 'r1', type: 'function', filePath: 'src/orders.tsx', name: 'OrdersScreen' },
    { id: 'node:job', repoId: 'r1', type: 'function', filePath: 'src/jobs.ts', name: 'syncOrders' },
    { id: 'node:event', repoId: 'r1', type: 'function', filePath: 'src/events.ts', name: 'onOrderCreated' },
  ]).run()
  db.insert(entryPoints).values([
    entryPoint('ep:api', 'api', 'GET', '/orders', 'node:api'),
    entryPoint('ep:screen', 'page', null, '/orders', 'node:screen'),
    entryPoint('ep:job', 'job', null, 'orders.sync', 'node:job'),
    entryPoint('ep:event', 'event', null, 'order.created', 'node:event'),
  ]).run()
})

describe('listDocsTargets', () => {
  it('lists all technical target kinds when no kind is specified', () => {
    const listed = listDocsTargets(db, { projectId: 'p1' })

    expect('code' in listed).toBe(false)
    if ('code' in listed) return
    expect(listed.summary).toMatchObject({
      total: 4,
      api: 1,
      screen: 1,
      job: 1,
      event: 1,
      deprecated: 0,
    })
    expect(listed.targets.map((target) => target.kind).sort()).toEqual(['api', 'event', 'job', 'screen'])
  })

  it('filters active and deprecated targets by review decision', () => {
    upsertAnalysisReviewDecision(db, {
      projectId: 'p1',
      repoId: 'r1',
      targetType: 'event',
      targetId: 'ep:event',
      decision: 'deprecated',
      reason: 'user_manual',
      decidedAt: '2026-06-10T00:00:00.000Z',
    })

    const deprecated = listDocsTargets(db, { projectId: 'p1', status: 'deprecated' })
    const active = listDocsTargets(db, { projectId: 'p1', status: 'active' })

    expect('code' in deprecated).toBe(false)
    expect('code' in active).toBe(false)
    if ('code' in deprecated || 'code' in active) return
    expect(deprecated.targets.map((target) => target.id)).toEqual(['ep:event'])
    expect(active.targets.map((target) => target.id).sort()).toEqual(['ep:api', 'ep:job', 'ep:screen'])
    expect(deprecated.summary).toMatchObject({ total: 1, event: 1, deprecated: 1 })
    expect(active.summary).toMatchObject({ total: 3, event: 0, deprecated: 0 })
  })
})

function entryPoint(
  id: string,
  kind: 'api' | 'page' | 'job' | 'event',
  httpMethod: string | null,
  path: string,
  handlerNodeId: string,
): typeof entryPoints.$inferInsert {
  return {
    id,
    repoId: 'r1',
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
