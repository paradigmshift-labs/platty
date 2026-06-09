import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../../server/helpers.js'
import { documents } from '@/db/schema/build_docs.js'
import { entryPoints } from '@/db/schema/build_route.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import { projects, repositories } from '@/db/schema/core.js'
import { loadDocIndex } from '@/pipeline_modules/build_epics/core/f1_load_doc_index.js'
import { upsertAnalysisReviewDecision } from '@/pipeline_modules/build_route/review_decisions.js'

describe('loadDocIndex review decisions', () => {
  it('ignores passed API docs whose entry point scope is currently deprecated', async () => {
    const db = createTestDb()
    seedProject(db)

    upsertAnalysisReviewDecision(db, {
      projectId: 'p1',
      repoId: 'r1',
      targetType: 'route',
      targetId: 'ep:legacy',
      decision: 'deprecated',
      reason: 'user_manual',
      decidedAt: '2026-06-01T00:00:00.000Z',
    })

    const deprecatedIndex = await loadDocIndex({ db, projectId: 'p1', documentScope: 'all' })

    expect(deprecatedIndex.apis.map((api) => api.documentId)).toEqual(['doc:active'])

    upsertAnalysisReviewDecision(db, {
      projectId: 'p1',
      repoId: 'r1',
      targetType: 'route',
      targetId: 'ep:legacy',
      decision: 'include',
      reason: 'restored',
      decidedAt: '2026-06-02T00:00:00.000Z',
    })

    const restoredIndex = await loadDocIndex({ db, projectId: 'p1', documentScope: 'all' })

    expect(restoredIndex.apis.map((api) => api.documentId).sort()).toEqual(['doc:active', 'doc:legacy'])
  })

  it('auto scope falls back to active frontend docs when the only backend doc is deprecated', async () => {
    const db = createTestDb()
    seedDeprecatedBackendWithActiveScreen(db)

    upsertAnalysisReviewDecision(db, {
      projectId: 'p1',
      repoId: 'r1',
      targetType: 'route',
      targetId: 'ep:legacy',
      decision: 'deprecated',
      reason: 'user_manual',
      decidedAt: '2026-06-01T00:00:00.000Z',
    })

    const index = await loadDocIndex({ db, projectId: 'p1' })

    expect(index.apis).toEqual([])
    expect(index.screens.map((screen) => screen.documentId)).toEqual(['doc:screen'])
  })

  it('ignores passed technical docs that are not fresh', async () => {
    const db = createTestDb()
    seedProject(db)
    db.insert(documents).values([
      apiDoc('doc:stale', 'ep:stale', 'GET', '/stale', 'Stale API.', { validity: 'stale' }),
      apiDoc('doc:deleted', 'ep:deleted', 'GET', '/deleted', 'Deleted API.', { status: 'deleted', validity: 'orphaned' }),
    ]).run()

    const index = await loadDocIndex({ db, projectId: 'p1', documentScope: 'all' })

    expect(index.apis.map((api) => api.documentId).sort()).toEqual(['doc:active', 'doc:legacy'])
  })

  it('auto scope falls back to active frontend docs when the only backend doc is stale', async () => {
    const db = createTestDb()
    seedStaleBackendWithActiveScreen(db)

    const index = await loadDocIndex({ db, projectId: 'p1' })

    expect(index.apis).toEqual([])
    expect(index.screens.map((screen) => screen.documentId)).toEqual(['doc:screen'])
  })

  it('loads v2 API access summaries for downstream epic classification', async () => {
    const db = createTestDb()
    seedProject(db)

    const index = await loadDocIndex({ db, projectId: 'p1', documentScope: 'all' })

    expect(index.apis.find((api) => api.documentId === 'doc:active')).toMatchObject({
      access: 'Admin-only: AdminGuard is applied.',
      authRequired: true,
    })
    expect(index.apis.find((api) => api.documentId === 'doc:legacy')).toMatchObject({
      access: 'No access evidence: no guard was found.',
      authRequired: null,
    })
  })
})

function seedProject(db: ReturnType<typeof createTestDb>): void {
  const now = '2026-06-01T00:00:00.000Z'
  db.insert(projects).values({ id: 'p1', name: 'Project', createdAt: now, updatedAt: now }).run()
  db.insert(repositories).values({
    id: 'r1',
    projectId: 'p1',
    name: 'Repo',
    repoPath: '/repo',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(codeNodes).values([
    codeNode('node:active', 'listActive'),
    codeNode('node:legacy', 'listLegacy'),
  ]).run()
  db.insert(entryPoints).values([
    entryPoint('ep:active', 'GET', '/active', 'node:active'),
    entryPoint('ep:legacy', 'GET', '/legacy', 'node:legacy'),
  ]).run()
  db.insert(documents).values([
    apiDoc('doc:active', 'ep:active', 'GET', '/active', 'Active API.'),
    apiDoc('doc:legacy', 'ep:legacy', 'GET', '/legacy', 'Legacy API.'),
  ]).run()
}

function seedDeprecatedBackendWithActiveScreen(db: ReturnType<typeof createTestDb>): void {
  const now = '2026-06-01T00:00:00.000Z'
  db.insert(projects).values({ id: 'p1', name: 'Project', createdAt: now, updatedAt: now }).run()
  db.insert(repositories).values({
    id: 'r1',
    projectId: 'p1',
    name: 'Repo',
    repoPath: '/repo',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(codeNodes).values([
    codeNode('node:legacy', 'listLegacy'),
    codeNode('node:screen', 'OrdersScreen'),
  ]).run()
  db.insert(entryPoints).values([
    entryPoint('ep:legacy', 'GET', '/legacy', 'node:legacy'),
    screenEntryPoint('ep:screen', '/orders', 'node:screen'),
  ]).run()
  db.insert(documents).values([
    apiDoc('doc:legacy', 'ep:legacy', 'GET', '/legacy', 'Legacy API.'),
    screenDoc('doc:screen', 'ep:screen', '/orders', 'Orders screen.'),
  ]).run()
}

function seedStaleBackendWithActiveScreen(db: ReturnType<typeof createTestDb>): void {
  const now = '2026-06-01T00:00:00.000Z'
  db.insert(projects).values({ id: 'p1', name: 'Project', createdAt: now, updatedAt: now }).run()
  db.insert(repositories).values({
    id: 'r1',
    projectId: 'p1',
    name: 'Repo',
    repoPath: '/repo',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(documents).values([
    apiDoc('doc:legacy', 'ep:legacy', 'GET', '/legacy', 'Legacy API.', { validity: 'stale' }),
    screenDoc('doc:screen', 'ep:screen', '/orders', 'Orders screen.'),
  ]).run()
}

function codeNode(id: string, name: string) {
  return {
    id,
    repoId: 'r1',
    type: 'function' as const,
    filePath: `src/${name}.ts`,
    name,
    lineStart: 1,
    lineEnd: 3,
    exported: true,
    isDefaultExport: false,
    isAsync: false,
    isTest: false,
    parseStatus: 'ok' as const,
    createdAt: '2026-06-01T00:00:00.000Z',
  }
}

function entryPoint(id: string, method: string, path: string, handlerNodeId: string) {
  return {
    id,
    repoId: 'r1',
    framework: 'express',
    kind: 'api' as const,
    httpMethod: method,
    path,
    fullPath: path,
    handlerNodeId,
    metadata: {},
    detectionSource: 'rule:test',
    confidence: 'high' as const,
    detectionEvidence: { matchedNodeIds: [handlerNodeId] },
    createdAt: '2026-06-01T00:00:00.000Z',
  }
}

function screenEntryPoint(id: string, path: string, handlerNodeId: string) {
  return {
    id,
    repoId: 'r1',
    framework: 'react-router',
    kind: 'page' as const,
    httpMethod: null,
    path,
    fullPath: path,
    handlerNodeId,
    metadata: {},
    detectionSource: 'rule:test',
    confidence: 'high' as const,
    detectionEvidence: { matchedNodeIds: [handlerNodeId] },
    createdAt: '2026-06-01T00:00:00.000Z',
  }
}

function apiDoc(id: string, scopeId: string, method: string, path: string, summary: string, overrides: Partial<{ status: string; validity: string }> = {}) {
  return {
    id,
    projectId: 'p1',
    type: 'api_spec',
    track: 'technical',
    scope: 'endpoint',
    scopeId,
    status: overrides.status ?? 'passed',
    validity: overrides.validity ?? 'fresh',
    summary,
    content: {
      title: `${method} ${path}`,
      summary,
      access: id === 'doc:active'
        ? 'Admin-only: AdminGuard is applied.'
        : 'No access evidence: no guard was found.',
      identity: { method, path, handler: `${id.replaceAll(':', '_')}Handler` },
      business_logic: [summary],
    },
    rawLlmOutput: '{}',
    sourceRunId: 'run:docs',
    sourceCommit: 'commit:test',
  }
}

function screenDoc(id: string, scopeId: string, routePath: string, summary: string) {
  return {
    id,
    projectId: 'p1',
    type: 'screen_spec',
    track: 'technical',
    scope: 'screen',
    scopeId,
    status: 'passed',
    validity: 'fresh',
    summary,
    content: {
      title: 'Orders',
      summary,
      identity: { route_path: routePath, screen_name: 'Orders', component: 'OrdersScreen' },
      business_logic: [summary],
    },
    rawLlmOutput: '{}',
    sourceRunId: 'run:docs',
    sourceCommit: 'commit:test',
  }
}
