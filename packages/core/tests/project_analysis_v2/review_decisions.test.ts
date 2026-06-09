import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type DB } from '../server/helpers.js'
import { projects, repositories } from '@/db/schema/core.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import { entryPoints } from '@/db/schema/build_route.js'
import { analysisReviewDecisions } from '@/db/schema/project_analysis_v2.js'
import {
  applyReviewDecisionsToDocumentTargets,
  isDeprecatedDocumentScope,
  listAnalysisReviewDecisions,
  listDeprecatedEntryPointIds,
  mapEntryPointKindToReviewTarget,
  upsertAnalysisReviewDecision,
} from '@/project_analysis_v2/review_decisions.js'
import type { DocumentTarget } from '@/pipeline_modules/build_docs_generation/types.js'

let db: DB

beforeEach(() => {
  db = createTestDb()
  db.insert(projects).values({ id: 'p1', name: 'Platty Project' }).run()
  db.insert(projects).values({ id: 'p2', name: 'Other Project' }).run()
  db.insert(repositories).values({ id: 'r1', projectId: 'p1', name: 'api', repoPath: '/repo/api' }).run()
  db.insert(repositories).values({ id: 'r2', projectId: 'p2', name: 'other', repoPath: '/repo/other' }).run()
  db.insert(codeNodes).values([
    { id: 'node:api', repoId: 'r1', type: 'function', filePath: 'src/orders.ts', name: 'getOrder' },
    { id: 'node:screen', repoId: 'r1', type: 'function', filePath: 'src/orders.tsx', name: 'OrderScreen' },
    { id: 'node:job', repoId: 'r1', type: 'function', filePath: 'src/jobs.ts', name: 'syncOrders' },
    { id: 'node:event', repoId: 'r1', type: 'function', filePath: 'src/events.ts', name: 'onOrderCreated' },
    { id: 'node:other', repoId: 'r2', type: 'function', filePath: 'src/other.ts', name: 'other' },
  ]).run()
  db.insert(entryPoints).values([
    {
      id: 'ep:api',
      repoId: 'r1',
      framework: 'nestjs',
      kind: 'api',
      httpMethod: 'GET',
      path: '/orders/:id',
      fullPath: '/orders/:id',
      handlerNodeId: 'node:api',
      detectionSource: 'rule:nestjs',
      confidence: 'high',
    },
    {
      id: 'ep:screen',
      repoId: 'r1',
      framework: 'nextjs',
      kind: 'page',
      path: '/orders',
      fullPath: '/orders',
      handlerNodeId: 'node:screen',
      detectionSource: 'rule:nextjs',
      confidence: 'medium',
    },
    {
      id: 'ep:job',
      repoId: 'r1',
      framework: 'bullmq',
      kind: 'job',
      path: 'orders.sync',
      fullPath: 'orders.sync',
      handlerNodeId: 'node:job',
      detectionSource: 'rule:bullmq',
      confidence: 'medium',
    },
    {
      id: 'ep:event',
      repoId: 'r1',
      framework: 'nestjs',
      kind: 'event',
      path: 'order.created',
      fullPath: 'order.created',
      handlerNodeId: 'node:event',
      detectionSource: 'rule:event',
      confidence: 'medium',
    },
    {
      id: 'ep:other',
      repoId: 'r2',
      framework: 'nestjs',
      kind: 'api',
      httpMethod: 'GET',
      path: '/other',
      fullPath: '/other',
      handlerNodeId: 'node:other',
      detectionSource: 'rule:nestjs',
      confidence: 'high',
    },
  ]).run()
})

describe('analysis review decisions', () => {
  it('maps entry point kinds to review target types', () => {
    expect(mapEntryPointKindToReviewTarget('api')).toBe('route')
    expect(mapEntryPointKindToReviewTarget('page')).toBe('screen')
    expect(mapEntryPointKindToReviewTarget('job')).toBe('job')
    expect(mapEntryPointKindToReviewTarget('event')).toBe('event')
  })

  it('upserts an include/deprecated decision per project repo target', () => {
    const first = upsertAnalysisReviewDecision(db, {
      projectId: 'p1',
      repoId: 'r1',
      targetType: 'route',
      targetId: 'ep:api',
      decision: 'deprecated',
      reason: 'user_manual',
      decidedBy: 'u1',
      sourceRunId: 'run-static',
    })
    const second = upsertAnalysisReviewDecision(db, {
      projectId: 'p1',
      repoId: 'r1',
      targetType: 'route',
      targetId: 'ep:api',
      decision: 'include',
      reason: 'restored',
      decidedBy: 'u1',
    })

    expect(second.id).toBe(first.id)
    expect(db.select().from(analysisReviewDecisions).all()).toHaveLength(1)
    expect(listAnalysisReviewDecisions(db, { projectId: 'p1', repoId: 'r1' })[0]).toMatchObject({
      targetId: 'ep:api',
      targetType: 'route',
      decision: 'include',
      reason: 'restored',
      decidedBy: 'u1',
    })
  })

  it('rejects decisions for repos outside the project', () => {
    expect(() => upsertAnalysisReviewDecision(db, {
      projectId: 'p1',
      repoId: 'r2',
      targetType: 'route',
      targetId: 'ep:other',
      decision: 'deprecated',
      reason: 'user_manual',
    })).toThrow(/REPOSITORY_NOT_IN_PROJECT/)
  })

  it('rejects decisions whose target type does not match entry point kind', () => {
    expect(() => upsertAnalysisReviewDecision(db, {
      projectId: 'p1',
      repoId: 'r1',
      targetType: 'screen',
      targetId: 'ep:api',
      decision: 'deprecated',
      reason: 'user_manual',
    })).toThrow(/TARGET_TYPE_MISMATCH/)
  })

  it('cascades decisions when an entry point is deleted', () => {
    upsertAnalysisReviewDecision(db, {
      projectId: 'p1',
      repoId: 'r1',
      targetType: 'route',
      targetId: 'ep:api',
      decision: 'deprecated',
      reason: 'user_manual',
    })

    db.delete(entryPoints).where(eq(entryPoints.id, 'ep:api')).run()

    expect(db.select().from(analysisReviewDecisions).all()).toHaveLength(0)
  })
})

describe('review decision overlay helpers', () => {
  it('returns only deprecated target ids for the requested project and repo', () => {
    upsertAnalysisReviewDecision(db, {
      projectId: 'p1',
      repoId: 'r1',
      targetType: 'route',
      targetId: 'ep:api',
      decision: 'deprecated',
      reason: 'user_manual',
      decidedAt: '2026-06-05T00:00:00.000Z',
    })
    upsertAnalysisReviewDecision(db, {
      projectId: 'p1',
      repoId: 'r1',
      targetType: 'screen',
      targetId: 'ep:screen',
      decision: 'include',
      reason: 'restored',
      decidedAt: '2026-06-05T00:01:00.000Z',
    })
    upsertAnalysisReviewDecision(db, {
      projectId: 'p2',
      repoId: 'r2',
      targetType: 'route',
      targetId: 'ep:other',
      decision: 'deprecated',
      reason: 'user_manual',
      decidedAt: '2026-06-05T00:02:00.000Z',
    })

    expect([...listDeprecatedEntryPointIds(db, { projectId: 'p1' })].sort()).toEqual(['ep:api'])
    expect([...listDeprecatedEntryPointIds(db, { projectId: 'p1', repoId: 'r1' })].sort()).toEqual(['ep:api'])
    expect([...listDeprecatedEntryPointIds(db, { projectId: 'p2' })].sort()).toEqual(['ep:other'])
  })

  it('treats only documents with deprecated entry point scope ids as excluded', () => {
    const deprecated = new Set(['ep:api'])

    expect(isDeprecatedDocumentScope({ scopeId: 'ep:api' }, deprecated)).toBe(true)
    expect(isDeprecatedDocumentScope({ scopeId: 'ep:screen' }, deprecated)).toBe(false)
    expect(isDeprecatedDocumentScope({ scopeId: null }, deprecated)).toBe(false)
  })
})

describe('applyReviewDecisionsToDocumentTargets', () => {
  const target = (documentId: string, entryPointIds: string[]): DocumentTarget => ({
    documentId,
    documentType: 'api_spec',
    seedNodeIds: [],
    entryPointIds,
    primaryEntryPointId: entryPointIds[0]!,
    targetKey: documentId,
    metadata: {},
  })

  it('keeps targets when no decision exists', () => {
    const result = applyReviewDecisionsToDocumentTargets([target('doc:a', ['ep:api'])], [])

    expect(result.included.map((item) => item.documentId)).toEqual(['doc:a'])
    expect(result.excluded).toEqual([])
  })

  it('excludes a document target when any entry point is deprecated', () => {
    const result = applyReviewDecisionsToDocumentTargets(
      [target('doc:a', ['ep:api', 'ep:screen']), target('doc:b', ['ep:event'])],
      [
        { targetId: 'ep:screen', decision: 'deprecated', decidedAt: '2026-05-20T00:00:00.000Z' },
      ],
    )

    expect(result.included.map((item) => item.documentId)).toEqual(['doc:b'])
    expect(result.excluded).toEqual([{
      target: target('doc:a', ['ep:api', 'ep:screen']),
      excludedEntryPointIds: ['ep:screen'],
    }])
  })

  it('uses the latest decision per target id', () => {
    const result = applyReviewDecisionsToDocumentTargets(
      [target('doc:a', ['ep:api'])],
      [
        { targetId: 'ep:api', decision: 'deprecated', decidedAt: '2026-05-20T00:00:00.000Z' },
        { targetId: 'ep:api', decision: 'include', decidedAt: '2026-05-20T00:01:00.000Z' },
      ],
    )

    expect(result.included.map((item) => item.documentId)).toEqual(['doc:a'])
    expect(result.excluded).toEqual([])
  })
})
