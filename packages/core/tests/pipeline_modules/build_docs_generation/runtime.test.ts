import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { createTestDb, type DB } from '../../server/helpers.js'
import { docDeps, docRelationLinks, documentLinkEvidence, documentLinks, documents, generationContextPages, generationRuns, generationTasks } from '@/db/schema/build_docs.js'
import { codeRelations } from '@/db/schema/build_relations.js'
import { codeEdges, codeNodes } from '@/db/schema/code_graph.js'
import { codeBundles, entryPoints } from '@/db/schema/build_route.js'
import { projectPhaseStatus, projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { serviceMapEdges } from '@/db/schema/build_service_map.js'
import { docSyncCandidates, staticMerkleSnapshots } from '@/db/schema/sync.js'
import { BuildDocsGenerationRuntime, BuildDocsGenerationRuntimeError } from '@/pipeline_modules/build_docs_generation/runtime.js'
import { buildDocumentLookup, DOCUMENT_GRAPH_MATERIALIZER_CREATED_BY } from '@/pipeline_modules/build_docs_generation/materialize_document_graph.js'
import type { BuildDocsGenerationContextResponse } from '@/pipeline_modules/build_docs_generation/types.js'
import { upsertAnalysisReviewDecision } from '@/pipeline_modules/build_route/review_decisions.js'
import { createDocSyncPlan } from '@/pipeline_modules/sync/doc_sync.js'
import { createViennaChainFixture, leaseApiTask } from './helpers.js'

describe('BuildDocsGenerationRuntime', () => {
  it('rejects start when build_service_map is missing or older than build_relations', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: false })
    const runtime = new BuildDocsGenerationRuntime({ db })

    await expect(runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })).rejects.toMatchObject({
      code: 'BUILD_DOCS_PRECONDITION_FAILED',
      details: {
        missing: expect.arrayContaining(['project:build_service_map']),
      },
      nextAction: {
        type: 'run_required_stage',
        stage: 'build_service_map',
      },
    })

    seedServiceMapPhase(db, 'project:docs-generation', Date.parse('2026-06-01T00:00:00.000Z'))

    await expect(runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })).rejects.toMatchObject({
      code: 'BUILD_DOCS_PRECONDITION_FAILED',
      details: {
        stale: expect.arrayContaining(['project:build_service_map']),
      },
      nextAction: {
        type: 'run_required_stage',
        stage: 'build_service_map',
      },
    })
  })

  it('starts a duplicate-safe task plan only after build_service_map is ready', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    const runtime = new BuildDocsGenerationRuntime({ db })

    const start = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })

    expect(start).toMatchObject({ status: 'awaiting_approval', active_run: false })
    const tasks = db.select().from(generationTasks).where(eq(generationTasks.runId, start.run_id)).all()
    expect(tasks.map((task) => `${task.repositoryId}:${task.targetKey}`).sort()).toEqual([
      'repo:api:api:GET:/api/orders',
      'repo:web:screen:/orders:OrdersPage',
    ])
    expect(new Set(tasks.map((task) => task.targetDocumentId)).size).toBe(2)
  })

  it('does not create build_docs tasks for deprecated review targets', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedTechnicalDocument(db, {
      id: 'doc:orders',
      type: 'api_spec',
      scope: 'route',
      scopeId: 'ep:api:listOrders',
      documentSourceHash: 'hash:api:listOrders:v1',
    })
    upsertAnalysisReviewDecision(db, {
      projectId: 'project:docs-generation',
      repoId: 'repo:api',
      targetType: 'route',
      targetId: 'ep:api:listOrders',
      decision: 'deprecated',
      reason: 'user_manual',
      decidedAt: '2026-06-05T00:00:00.000Z',
    })
    const runtime = new BuildDocsGenerationRuntime({ db })

    const start = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })

    const tasks = db.select().from(generationTasks).where(eq(generationTasks.runId, start.run_id)).all()
    expect(tasks.map((task) => `${task.repositoryId}:${task.targetKey}`).sort()).toEqual([
      'repo:web:screen:/orders:OrdersPage',
    ])
    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders')).get()).toMatchObject({
      status: 'deleted',
      validity: 'orphaned',
    })
    await expect(runtime.preview({ runId: start.run_id })).resolves.toMatchObject({
      incremental: {
        mode: 'full',
        deprecated: 1,
      },
    })
  })

  it('creates tasks again after an include review decision restores the target', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    upsertAnalysisReviewDecision(db, {
      projectId: 'project:docs-generation',
      repoId: 'repo:api',
      targetType: 'route',
      targetId: 'ep:api:listOrders',
      decision: 'deprecated',
      reason: 'user_manual',
      decidedAt: '2026-06-05T00:00:00.000Z',
    })
    upsertAnalysisReviewDecision(db, {
      projectId: 'project:docs-generation',
      repoId: 'repo:api',
      targetType: 'route',
      targetId: 'ep:api:listOrders',
      decision: 'include',
      reason: 'restored',
      decidedAt: '2026-06-05T00:01:00.000Z',
    })
    const runtime = new BuildDocsGenerationRuntime({ db })

    const start = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })

    const tasks = db.select().from(generationTasks).where(eq(generationTasks.runId, start.run_id)).all()
    expect(tasks.map((task) => `${task.repositoryId}:${task.targetKey}`).sort()).toEqual([
      'repo:api:api:GET:/api/orders',
      'repo:web:screen:/orders:OrdersPage',
    ])
  })

  it('starts incremental build_docs tasks only for sync2 stale candidates and skips unchanged targets', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedIncrementalSnapshots(db)
    seedTechnicalDocument(db, {
      id: 'doc:orders',
      type: 'api_spec',
      scope: 'route',
      scopeId: 'ep:api:listOrders',
      documentSourceHash: 'hash:api:listOrders:v1',
    })
    seedTechnicalDocument(db, {
      id: 'doc:orders-screen',
      type: 'screen_spec',
      scope: 'screen',
      scopeId: 'ep:web:orders',
      documentSourceHash: 'hash:screen:orders:v1',
    })
    const runtime = new BuildDocsGenerationRuntime({ db })

    const start = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })

    expect(start).toMatchObject({ status: 'awaiting_approval', active_run: false })
    const tasks = db.select().from(generationTasks).where(eq(generationTasks.runId, start.run_id)).all()
    expect(tasks.map((task) => task.targetKey).sort()).toEqual([
      'api:GET:/api/orders',
    ])
    expect(tasks[0]?.targetJson).toMatchObject({
      sync: {
        candidate_kind: 'stale',
        old_hash: 'hash:api:listOrders:v1',
        new_hash: 'hash:api:listOrders:v2',
      },
    })
    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders')).get()).toMatchObject({
      validity: 'stale',
    })
    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders-screen')).get()).toMatchObject({
      validity: 'fresh',
    })
    await expect(runtime.preview({ runId: start.run_id })).resolves.toMatchObject({
      total_task_count: 1,
      skip_fresh_task_count: 1,
      incremental: {
        mode: 'sync2',
        stale: 1,
        unchanged: 1,
        task_planned: 1,
        skipped_fresh: 1,
      },
    })
  })

  it('plans unchanged sync2 targets when the generated document is missing', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedUnchangedIncrementalSnapshots(db)
    seedTechnicalDocument(db, {
      id: 'doc:orders-screen',
      type: 'screen_spec',
      scope: 'screen',
      scopeId: 'ep:web:orders',
      documentSourceHash: 'hash:screen:orders:v2',
    })
    const runtime = new BuildDocsGenerationRuntime({ db })

    const start = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })

    expect(start).toMatchObject({ status: 'awaiting_approval', active_run: false })
    const tasks = db.select().from(generationTasks).where(eq(generationTasks.runId, start.run_id)).all()
    expect(tasks.map((task) => task.targetKey)).toEqual(['api:GET:/api/orders'])
    expect(tasks[0]?.targetJson).toMatchObject({
      sync: {
        candidate_kind: 'source_unchanged_rebuild',
        new_hash: 'hash:api:listOrders:v2',
      },
    })
    await expect(runtime.preview({ runId: start.run_id })).resolves.toMatchObject({
      total_task_count: 1,
      skip_fresh_task_count: 1,
      incremental: {
        mode: 'sync2',
        unchanged: 2,
        task_planned: 1,
        skipped_fresh: 1,
        source_unchanged_rebuild: 1,
      },
    })
  })

  it('plans unchanged sync2 targets when the generated document source hash is stale', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedUnchangedIncrementalSnapshots(db)
    seedTechnicalDocument(db, {
      id: 'doc:orders',
      type: 'api_spec',
      scope: 'route',
      scopeId: 'ep:api:listOrders',
      documentSourceHash: 'hash:api:listOrders:v1',
    })
    seedTechnicalDocument(db, {
      id: 'doc:orders-screen',
      type: 'screen_spec',
      scope: 'screen',
      scopeId: 'ep:web:orders',
      documentSourceHash: 'hash:screen:orders:v2',
    })
    const runtime = new BuildDocsGenerationRuntime({ db })

    const start = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })

    const tasks = db.select().from(generationTasks).where(eq(generationTasks.runId, start.run_id)).all()
    expect(tasks.map((task) => task.targetKey)).toEqual(['api:GET:/api/orders'])
    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders')).get()).toMatchObject({
      validity: 'stale',
    })
    await expect(runtime.preview({ runId: start.run_id })).resolves.toMatchObject({
      total_task_count: 1,
      skip_fresh_task_count: 1,
      incremental: {
        source_unchanged_rebuild: 1,
      },
    })
  })

  it('does not regenerate non-pending candidates from an explicit sync2 plan', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedIncrementalSnapshots(db)
    seedTechnicalDocument(db, {
      id: 'doc:orders',
      type: 'api_spec',
      scope: 'route',
      scopeId: 'ep:api:listOrders',
      documentSourceHash: 'hash:api:listOrders:v1',
    })
    seedTechnicalDocument(db, {
      id: 'doc:orders-screen',
      type: 'screen_spec',
      scope: 'screen',
      scopeId: 'ep:web:orders',
      documentSourceHash: 'hash:screen:orders:v1',
    })
    const plan = createDocSyncPlan({
      db,
      projectId: 'project:docs-generation',
      fromSnapshotId: 'last_applied',
      toSnapshotId: 'latest',
      scope: { track: 'technical' },
    })
    db.update(docSyncCandidates)
      .set({ status: 'staged', updatedAt: '2026-06-04T00:01:00.000Z' })
      .where(eq(docSyncCandidates.planId, plan.planId))
      .run()
    const runtime = new BuildDocsGenerationRuntime({ db })

    const start = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
      syncPlanId: plan.planId,
    })

    expect(start).toMatchObject({ status: 'completed', active_run: false })
    expect(db.select().from(generationTasks).where(eq(generationTasks.runId, start.run_id)).all()).toHaveLength(0)
    await expect(runtime.preview({ runId: start.run_id })).resolves.toMatchObject({
      total_task_count: 0,
      incremental: {
        mode: 'sync2',
        stale: 1,
        task_planned: 0,
      },
    })
  })

  it('marks sync2 orphan documents orphaned without creating build_docs tasks', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedIncrementalSnapshotsWithOrphan(db)
    seedTechnicalDocument(db, {
      id: 'doc:orders',
      type: 'api_spec',
      scope: 'route',
      scopeId: 'ep:api:listOrders',
      documentSourceHash: 'hash:api:listOrders:v2',
    })
    seedTechnicalDocument(db, {
      id: 'doc:orders-screen',
      type: 'screen_spec',
      scope: 'screen',
      scopeId: 'ep:web:orders',
      documentSourceHash: 'hash:screen:orders:v1',
    })
    const runtime = new BuildDocsGenerationRuntime({ db })

    const start = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })

    expect(db.select().from(generationTasks).where(eq(generationTasks.runId, start.run_id)).all()).toHaveLength(0)
    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders-screen')).get()).toMatchObject({
      status: 'deleted',
      validity: 'orphaned',
    })
    await expect(runtime.preview({ runId: start.run_id })).resolves.toMatchObject({
      incremental: {
        orphan_document: 1,
        orphaned_without_task: 1,
      },
    })
  })

  it('holds sync2 stale candidates for review unless forced', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedIncrementalSnapshots(db)
    seedTechnicalDocument(db, {
      id: 'doc:orders',
      type: 'api_spec',
      scope: 'route',
      scopeId: 'ep:api:listOrders',
      documentSourceHash: 'hash:api:listOrders:manual',
    })
    seedTechnicalDocument(db, {
      id: 'doc:orders-screen',
      type: 'screen_spec',
      scope: 'screen',
      scopeId: 'ep:web:orders',
      documentSourceHash: 'hash:screen:orders:v1',
    })
    const runtime = new BuildDocsGenerationRuntime({ db })

    const start = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })

    expect(db.select().from(generationTasks).where(eq(generationTasks.runId, start.run_id)).all()).toHaveLength(0)
    await expect(runtime.preview({ runId: start.run_id })).resolves.toMatchObject({
      incremental: {
        stale_candidate: 1,
        review_needed: 1,
      },
    })
  })

  it('keeps full mode as explicit all-target generation', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedIncrementalSnapshots(db)
    const runtime = new BuildDocsGenerationRuntime({ db })

    const start = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
      mode: 'full',
    })

    const tasks = db.select().from(generationTasks).where(eq(generationTasks.runId, start.run_id)).all()
    expect(tasks.map((task) => task.targetKey).sort()).toEqual([
      'api:GET:/api/orders',
      'screen:/orders:OrdersPage',
    ])
    await expect(runtime.preview({ runId: start.run_id })).resolves.toMatchObject({
      incremental: {
        mode: 'full',
        task_planned: 2,
      },
    })
  })

  it('returns source context, code facts, outgoing service-map facts, incoming related edges, and the draft schema', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedServiceMapEdges(db)
    const runtime = new BuildDocsGenerationRuntime({ db })
    const task = await leaseFirstTask(runtime, 'api_spec')

    const context = await runtime.getContext({
      taskId: task.task_id,
      leaseToken: task.lease_token,
    })

    expect(context.content.target).toMatchObject({
      document_type: 'api_spec',
      method: 'GET',
      path: '/api/orders',
    })
    expect(context.content.source_context).toEqual([
      expect.objectContaining({
        node_id: 'node:api:listOrders',
        file_path: 'src/orders/order.controller.ts',
        source_excerpt: expect.stringContaining('listOrders'),
      }),
    ])
    expect(context.content.source_link_candidates).toEqual([
      expect.objectContaining({
        candidate_id: 'source_link_candidate:001',
        node_id: 'node:api:listOrders',
        role_hints: expect.arrayContaining(['entrypoint']),
      }),
    ])
    expect(context.manifest.optional_pages).toEqual(expect.arrayContaining(['source_link_candidates']))
    const sourceLinkPage = db.select().from(generationContextPages)
      .where(and(
        eq(generationContextPages.contextHandle, context.manifest.context_handle),
        eq(generationContextPages.pageId, 'source_link_candidates'),
      ))
      .get()
    expect(sourceLinkPage).toMatchObject({
      pageKind: 'source_link_candidates',
      pageOrder: 3,
      evidenceIdsJson: [context.content.source_link_candidates?.[0]?.evidence_id],
      contentJson: {
        source_link_candidates: [
          expect.objectContaining({
            candidate_id: 'source_link_candidate:001',
            node_id: 'node:api:listOrders',
          }),
        ],
      },
    })
    const persistedTask = db.select().from(generationTasks).where(eq(generationTasks.id, task.task_id)).get()
    if (!persistedTask) throw new Error('expected persisted task')
    const readPersistedContext = (runtime as unknown as {
      readPersistedContext(task: typeof generationTasks.$inferSelect): BuildDocsGenerationContextResponse | null
    }).readPersistedContext.bind(runtime)
    const persistedContext = readPersistedContext(persistedTask)
    expect(persistedContext?.content.source_link_candidates).toEqual([
      expect.objectContaining({
        candidate_id: 'source_link_candidate:001',
        node_id: 'node:api:listOrders',
      }),
    ])
    expect(context.content.code_relation_facts).toEqual([
      expect.objectContaining({
        relation_id: 'rel:api:listOrders:orders',
        kind: 'db_access',
        source: 'deterministic',
      }),
    ])
    expect(context.content.service_map_facts).toEqual([
      expect.objectContaining({
        relation_id: 'edge:api:listOrders:db',
        kind: 'db_access',
        source: 'service_map',
      }),
      expect.objectContaining({
        relation_id: 'edge:api:listOrders:external',
        kind: 'external_service',
        source: 'service_map',
      }),
    ])
    expect(context.content.service_map_facts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ relation_id: 'edge:screen:orders:api' }),
    ]))
    expect(context.content.related_edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'edge:screen:orders:api',
        direction: 'incoming',
        kind: 'calls_api',
      }),
    ]))
    expect(context.content.schema).toMatchObject({
      schema_version: 'build_docs_cli_generation_v2',
      llm_output_shape: {
        title: 'string',
        summary: 'string',
        flow: expect.any(Array),
        rules: expect.any(Array),
      },
      system_injected_fields: expect.arrayContaining([
        'id',
        'type',
        'identity',
        'source_links',
        'relations',
        'evidence_refs',
        'relation_evidence_checked',
      ]),
    })
  })

  it('includes repo source slices and bundled dependency source in CLI context', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'platty-docs-generation-source-'))
    try {
      const sourcePath = join(repoRoot, 'src/orders/order.controller.ts')
      mkdirSync(join(repoRoot, 'src/orders'), { recursive: true })
      writeFileSync(sourcePath, [
        'import { OrderService } from "./order.service"',
        '',
        'export async function listOrders(req, res) {',
        '  const rows = await OrderService.listOrders()',
        '  return res.json({ count: rows.length, items: rows })',
        '}',
        '',
        'export const unrelated = true',
        '',
        'export async function mapOrder(row) {',
        '  return { id: row.id, status: row.status }',
        '}',
      ].join('\n'), 'utf8')

      const db = createTestDb()
      seedProject(db, { serviceMapReady: true, repoPath: repoRoot })
      db.insert(codeNodes).values({
        id: 'node:api:mapOrder',
        repoId: 'repo:api',
        type: 'function',
        filePath: 'src/orders/order.controller.ts',
        name: 'mapOrder',
        lineStart: 10,
        lineEnd: 12,
        signature: 'async function mapOrder(row)',
        docComment: null,
        exported: true,
        isDefaultExport: false,
        isAsync: true,
        isTest: false,
        parseStatus: 'ok',
        createdAt: '2026-06-02T00:00:00.000Z',
      }).run()
      db.insert(codeBundles).values({
        entryPointId: 'ep:api:listOrders',
        nodeId: 'node:api:mapOrder',
        depth: 1,
        edgePath: ['node:api:listOrders', 'node:api:mapOrder'],
      }).run()
      const runtime = new BuildDocsGenerationRuntime({ db })
      const task = await leaseFirstTask(runtime, 'api_spec')

      const context = await runtime.getContext({
        taskId: task.task_id,
        leaseToken: task.lease_token,
      })

      expect(context.content.source_context).toEqual(expect.arrayContaining([
        expect.objectContaining({
          node_id: 'node:api:listOrders',
          dep_type: 'entrypoint',
          source_missing: false,
          source_excerpt: expect.stringContaining('return res.json({ count: rows.length, items: rows })'),
        }),
        expect.objectContaining({
          node_id: 'node:api:mapOrder',
          dep_type: 'dependency',
          hop: 1,
          source_missing: false,
          source_excerpt: expect.stringContaining('return { id: row.id, status: row.status }'),
        }),
      ]))
    } finally {
      if (existsSync(repoRoot)) rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('injects shared_context and compacts covered source nodes', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    db.insert(codeNodes).values([
      node('node:web:ProfilePage', 'repo:web', 'src/app/profile/page.tsx', 'ProfilePage', 'export default function ProfilePage()'),
      node('node:web:SettingsPage', 'repo:web', 'src/app/settings/page.tsx', 'SettingsPage', 'export default function SettingsPage()'),
      node('node:web:Button', 'repo:web', 'src/ui/Button.tsx', 'Button', 'export function Button(props)'),
      node('node:web:buttonClassName', 'repo:web', 'src/ui/Button.tsx', 'buttonClassName', 'export const buttonClassName'),
    ]).run()
    db.insert(entryPoints).values([
      entryPoint('ep:web:profile', 'repo:web', 'page', null, '/profile', 'node:web:ProfilePage'),
      entryPoint('ep:web:settings', 'repo:web', 'page', null, '/settings', 'node:web:SettingsPage'),
    ]).run()
    db.insert(codeBundles).values([
      bundle('ep:web:orders', 'node:web:OrdersPage', 0),
      bundle('ep:web:orders', 'node:web:Button', 1),
      bundle('ep:web:orders', 'node:web:buttonClassName', 2),
      bundle('ep:web:profile', 'node:web:ProfilePage', 0),
      bundle('ep:web:profile', 'node:web:Button', 1),
      bundle('ep:web:profile', 'node:web:buttonClassName', 2),
      bundle('ep:web:settings', 'node:web:SettingsPage', 0),
      bundle('ep:web:settings', 'node:web:Button', 1),
      bundle('ep:web:settings', 'node:web:buttonClassName', 2),
    ]).run()
    const runtime = new BuildDocsGenerationRuntime({ db })
    const task = await leaseFirstTask(runtime, 'screen_spec')

    const context = await runtime.getContext({
      taskId: task.task_id,
      leaseToken: task.lease_token,
    })

    expect(context.content.shared_context).toEqual([
      expect.objectContaining({
        root_node_id: 'node:web:Button',
        used_by_entrypoint_count: 3,
      }),
    ])
    expect(context.content.shared_context?.[0]).not.toHaveProperty('covered_node_ids')
    expect(context.content.shared_context?.[0]).not.toHaveProperty('used_by_entrypoints')
    expect(context.content.source_context.some((item) => item.node_id === 'node:web:Button')).toBe(false)
    expect(context.manifest.optional_pages).toContain('shared_context')
    expect(context.manifest.source_context_compaction).toMatchObject({
      omitted_node_count: 2,
      segment_ids: expect.any(Array),
    })
    const sharedContextPage = db.select().from(generationContextPages)
      .where(and(
        eq(generationContextPages.contextHandle, context.manifest.context_handle),
        eq(generationContextPages.pageId, 'shared_context'),
      ))
      .get()
    expect(sharedContextPage).toMatchObject({
      pageKind: 'shared_context',
      pageOrder: 3,
      contentJson: {
        shared_context: [
          expect.not.objectContaining({
            covered_node_ids: expect.any(Array),
            used_by_entrypoints: expect.any(Array),
          }),
        ],
      },
    })
  })

  it('removes shared-owned subtree internals from route source context', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    db.insert(codeNodes).values([
      node('node:web:ProfilePage', 'repo:web', 'src/app/profile/page.tsx', 'ProfilePage', 'export default function ProfilePage()'),
      node('node:web:SettingsPage', 'repo:web', 'src/app/settings/page.tsx', 'SettingsPage', 'export default function SettingsPage()'),
      node('node:web:SharedPanel', 'repo:web', 'src/ui/SharedPanel.tsx', 'SharedPanel', 'export function SharedPanel(props)'),
      node('node:web:useSharedMutation', 'repo:web', 'src/ui/useSharedMutation.ts', 'useSharedMutation', 'export function useSharedMutation()'),
      node('node:web:SharedDto', 'repo:web', 'src/ui/SharedDto.ts', 'SharedDto', 'export interface SharedDto'),
    ]).run()
    db.insert(entryPoints).values([
      entryPoint('ep:web:profile', 'repo:web', 'page', null, '/profile', 'node:web:ProfilePage'),
      entryPoint('ep:web:settings', 'repo:web', 'page', null, '/settings', 'node:web:SettingsPage'),
    ]).run()
    db.insert(codeBundles).values([
      bundle('ep:web:orders', 'node:web:OrdersPage', 0),
      bundle('ep:web:orders', 'node:web:SharedPanel', 1),
      bundle('ep:web:orders', 'node:web:useSharedMutation', 2),
      bundle('ep:web:orders', 'node:web:SharedDto', 3),
      bundle('ep:web:profile', 'node:web:ProfilePage', 0),
      bundle('ep:web:profile', 'node:web:SharedPanel', 1),
      bundle('ep:web:profile', 'node:web:useSharedMutation', 2),
      bundle('ep:web:profile', 'node:web:SharedDto', 3),
      bundle('ep:web:settings', 'node:web:SettingsPage', 0),
      bundle('ep:web:settings', 'node:web:SharedPanel', 1),
      bundle('ep:web:settings', 'node:web:useSharedMutation', 2),
      bundle('ep:web:settings', 'node:web:SharedDto', 3),
    ]).run()
    db.insert(codeEdges).values([
      edge('repo:web', 'node:web:OrdersPage', 'node:web:SharedPanel'),
      edge('repo:web', 'node:web:SharedPanel', 'node:web:useSharedMutation'),
      edge('repo:web', 'node:web:useSharedMutation', 'node:web:SharedDto'),
    ]).run()
    const runtime = new BuildDocsGenerationRuntime({ db })
    const task = await leaseFirstTask(runtime, 'screen_spec')

    const context = await runtime.getContext({
      taskId: task.task_id,
      leaseToken: task.lease_token,
    })

    expect(context.content.shared_context).toEqual([
      expect.objectContaining({
        root_node_id: 'node:web:SharedPanel',
      }),
    ])
    expect(context.content.shared_context?.[0]).not.toHaveProperty('covered_node_ids')
    expect(context.content.shared_context?.[0]).not.toHaveProperty('used_by_entrypoints')
    expect(context.content.source_context.map((item) => item.node_id)).toEqual(['node:web:OrdersPage'])
    expect(context.manifest.source_context_compaction).toMatchObject({
      original_source_context_count: 4,
      compacted_source_context_count: 1,
      omitted_node_count: 3,
    })
  })

  it('retains a shared-covered node when the target has a separate direct edge to it', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    db.insert(codeNodes).values([
      node('node:web:ProfilePage', 'repo:web', 'src/app/profile/page.tsx', 'ProfilePage', 'export default function ProfilePage()'),
      node('node:web:SettingsPage', 'repo:web', 'src/app/settings/page.tsx', 'SettingsPage', 'export default function SettingsPage()'),
      node('node:web:SharedPanel', 'repo:web', 'src/ui/SharedPanel.tsx', 'SharedPanel', 'export function SharedPanel(props)'),
      node('node:web:useSharedMutation', 'repo:web', 'src/ui/useSharedMutation.ts', 'useSharedMutation', 'export function useSharedMutation()'),
      node('node:web:SharedDto', 'repo:web', 'src/ui/SharedDto.ts', 'SharedDto', 'export interface SharedDto'),
    ]).run()
    db.insert(entryPoints).values([
      entryPoint('ep:web:profile', 'repo:web', 'page', null, '/profile', 'node:web:ProfilePage'),
      entryPoint('ep:web:settings', 'repo:web', 'page', null, '/settings', 'node:web:SettingsPage'),
    ]).run()
    db.insert(codeBundles).values([
      bundle('ep:web:orders', 'node:web:OrdersPage', 0),
      bundle('ep:web:orders', 'node:web:SharedPanel', 1),
      bundle('ep:web:orders', 'node:web:useSharedMutation', 2),
      bundle('ep:web:orders', 'node:web:SharedDto', 3),
      bundle('ep:web:profile', 'node:web:ProfilePage', 0),
      bundle('ep:web:profile', 'node:web:SharedPanel', 1),
      bundle('ep:web:profile', 'node:web:useSharedMutation', 2),
      bundle('ep:web:profile', 'node:web:SharedDto', 3),
      bundle('ep:web:settings', 'node:web:SettingsPage', 0),
      bundle('ep:web:settings', 'node:web:SharedPanel', 1),
      bundle('ep:web:settings', 'node:web:useSharedMutation', 2),
      bundle('ep:web:settings', 'node:web:SharedDto', 3),
    ]).run()
    db.insert(codeEdges).values([
      edge('repo:web', 'node:web:OrdersPage', 'node:web:SharedPanel'),
      edge('repo:web', 'node:web:SharedPanel', 'node:web:useSharedMutation'),
      edge('repo:web', 'node:web:useSharedMutation', 'node:web:SharedDto'),
      edge('repo:web', 'node:web:OrdersPage', 'node:web:SharedDto'),
    ]).run()
    const runtime = new BuildDocsGenerationRuntime({ db })
    const task = await leaseFirstTask(runtime, 'screen_spec')

    const context = await runtime.getContext({
      taskId: task.task_id,
      leaseToken: task.lease_token,
    })

    expect(context.content.source_context.map((item) => item.node_id)).toEqual([
      'node:web:OrdersPage',
      'node:web:SharedDto',
    ])
  })

  it('materializes service-map edges into document_links when the run completes', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedServiceMapEdges(db)
    const runtime = new BuildDocsGenerationRuntime({ db })

    const start = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })
    await runtime.approve({ runId: start.run_id, maxConcurrentTasks: 2, approvedBy: 'user:test' })

    // Drive both technical documents to 'saved' so the run completes.
    const apiTask = await runtime.leaseTask({ runId: start.run_id, workerId: 'w:api', documentTypes: ['api_spec'] })
    if (apiTask.type !== 'task') throw new Error('expected api task lease')
    await runtime.getContext({ taskId: apiTask.task_id, leaseToken: apiTask.lease_token })
    await runtime.submitTask({
      taskId: apiTask.task_id,
      leaseToken: apiTask.lease_token,
      document: {
        title: 'Orders API',
        summary: 'Lists orders with source-backed behavior and charges Stripe when needed.',
        access: 'No access evidence: source context does not show a guard.',
        flow: ['Reads orders, calls Stripe charge, and returns them.'],
        rules: [],
      },
    })

    const screenTask = await runtime.leaseTask({ runId: start.run_id, workerId: 'w:web', documentTypes: ['screen_spec'] })
    if (screenTask.type !== 'task') throw new Error('expected screen task lease')
    await runtime.getContext({ taskId: screenTask.task_id, leaseToken: screenTask.lease_token })
    await runtime.submitTask({
      taskId: screenTask.task_id,
      leaseToken: screenTask.lease_token,
      document: {
        title: 'Orders screen',
        summary: 'Shows orders from GET /api/orders and links to Stripe docs.',
        ascii_ui: '+ OrdersPage\n  + Orders list',
        layout: [{ name: 'Orders list', type: 'list', fields: ['order id'] }],
        state: [{ name: 'orders', source: 'query' }],
        actions: [
          { name: 'Load orders', trigger: 'mount', result: 'calls GET /api/orders' },
          { name: 'Open Stripe docs', trigger: 'click', result: 'opens https://docs.stripe.com' },
        ],
        flow: ['Loads orders from GET /api/orders and renders the Stripe docs link.'],
        rules: [],
      },
    })

    // Run completed → the service-map calls_api edge (web/orders → api/listOrders) is brought as-is
    // from build_service_map and materialized as a document_link. The doc-gen does not re-derive it.
    const links = db.select().from(documentLinks)
      .where(eq(documentLinks.createdBy, DOCUMENT_GRAPH_MATERIALIZER_CREATED_BY)).all()
    expect(links.some((link) => link.linkType === 'calls_api')).toBe(true)

    // every generated link traces back to its originating service-map edge
    const evidence = db.select().from(documentLinkEvidence)
      .where(eq(documentLinkEvidence.createdBy, DOCUMENT_GRAPH_MATERIALIZER_CREATED_BY)).all()
    expect(evidence.length).toBeGreaterThan(0)
    expect(evidence.every((row) => typeof row.sourceEdgeId === 'string' && row.sourceEdgeId.length > 0)).toBe(true)
  })

  it('materializes document_links even when the run ends failed (sibling task failed, link pair saved)', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedServiceMapEdges(db)
    const ts = '2026-06-02T00:00:00.000Z'

    // Two technical documents already saved (the calls_api link pair: web/orders -> api/listOrders).
    const passedDoc = (id: string, type: string, scope: string, scopeId: string) => ({
      id, projectId: 'project:docs-generation', type, track: 'technical', scope, scopeId,
      status: 'passed', validity: 'fresh', content: { id, type }, sourceRunId: 'gen:mixed',
      sourceCommit: 'c', updatedBy: 'llm' as const, updatedAt: ts,
    })
    db.insert(documents).values([
      passedDoc('doc:web:orders', 'screen_spec', 'screen', 'ep:web:orders'),
      passedDoc('doc:api:listOrders', 'api_spec', 'api', 'ep:api:listOrders'),
    ]).run()

    // A run whose tasks are all terminal but MIXED: one saved + one failed → run becomes 'failed'.
    db.insert(generationRuns).values({
      id: 'gen:mixed', projectId: 'project:docs-generation', stage: 'build_docs', status: 'running',
      outputLanguage: 'ko', requestedBy: 'user:test', sourceCommit: 'c', createdAt: ts, updatedAt: ts,
    }).run()
    const taskRow = (id: string, status: string, documentType: string, primaryEntryPointId: string) => ({
      id, runId: 'gen:mixed', projectId: 'project:docs-generation', repositoryId: 'repo:api',
      documentType, targetKey: id, targetDocumentId: `target:${id}`, primaryEntryPointId,
      targetJson: {}, status, retryCount: 0, maxRetries: 2, createdAt: ts, updatedAt: ts,
    })
    db.insert(generationTasks).values([
      taskRow('task:saved', 'saved', 'api_spec', 'ep:api:listOrders'),
      taskRow('task:failed', 'failed', 'screen_spec', 'ep:web:orders'),
    ]).run()

    const runtime = new BuildDocsGenerationRuntime({ db })
    // status() triggers refreshRunCompletion → run transitions running → 'failed'.
    const result = await runtime.status({ runId: 'gen:mixed' })
    expect(result.run_status).toBe('failed')

    // A single failed sibling must NOT blank the whole document graph — the saved docs still link.
    const links = db.select().from(documentLinks)
      .where(eq(documentLinks.createdBy, DOCUMENT_GRAPH_MATERIALIZER_CREATED_BY)).all()
    expect(links.some((link) => link.linkType === 'calls_api')).toBe(true)
  })

  it('does not materialize service-map links to deprecated technical documents', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedServiceMapEdges(db)
    upsertAnalysisReviewDecision(db, {
      projectId: 'project:docs-generation',
      repoId: 'repo:api',
      targetType: 'route',
      targetId: 'ep:api:listOrders',
      decision: 'deprecated',
      reason: 'user_manual',
      decidedAt: '2026-06-05T00:00:00.000Z',
    })
    db.insert(documents).values({
      id: 'doc:old-api',
      projectId: 'project:docs-generation',
      type: 'api_spec',
      track: 'technical',
      scope: 'route',
      scopeId: 'ep:api:listOrders',
      status: 'passed',
      validity: 'fresh',
      summary: 'Old API doc',
      content: { id: 'doc:old-api', type: 'api_spec', title: 'Old API', summary: 'Old API doc' },
      rawLlmOutput: '{}',
      sourceRunId: 'old-run',
      sourceCommit: 'old-commit',
      updatedAt: '2026-06-04T00:00:00.000Z',
    }).run()
    db.insert(docDeps).values({
      documentId: 'doc:old-api',
      codeNodeId: 'node:api:listOrders',
      depType: 'entrypoint',
    }).run()
    const deprecatedLookup = buildDocumentLookup({
      documents: db.select().from(documents).all(),
      docDeps: db.select().from(docDeps).all(),
      deprecatedEntryPointIds: new Set(['ep:api:listOrders']),
    })
    expect(deprecatedLookup.byScopeId.get('ep:api:listOrders')).toBeUndefined()
    expect(deprecatedLookup.byCodeNodeId.get('node:api:listOrders')).toBeUndefined()
    const runtime = new BuildDocsGenerationRuntime({ db })

    const start = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })
    await runtime.approve({ runId: start.run_id, maxConcurrentTasks: 1, approvedBy: 'user:test' })

    const screenTask = await runtime.leaseTask({ runId: start.run_id, workerId: 'w:web', documentTypes: ['screen_spec'] })
    if (screenTask.type !== 'task') throw new Error('expected screen task lease')
    await runtime.getContext({ taskId: screenTask.task_id, leaseToken: screenTask.lease_token })
    await runtime.submitTask({
      taskId: screenTask.task_id,
      leaseToken: screenTask.lease_token,
      document: {
        title: 'Orders screen',
        summary: 'Shows orders from GET /api/orders.',
        ascii_ui: '+ OrdersPage\n  + Orders list',
        layout: [{ name: 'Orders list', type: 'list', fields: ['order id'] }],
        state: [{ name: 'orders', source: 'query' }],
        actions: [{ name: 'Load orders', trigger: 'mount', result: 'calls GET /api/orders' }],
        flow: ['Loads orders from GET /api/orders.'],
        rules: [],
      },
    })

    expect(db.select().from(documentLinks)
      .where(eq(documentLinks.createdBy, DOCUMENT_GRAPH_MATERIALIZER_CREATED_BY)).all()).toEqual([])
    expect(db.select().from(documentLinkEvidence)
      .where(eq(documentLinkEvidence.createdBy, DOCUMENT_GRAPH_MATERIALIZER_CREATED_BY)).all()).toEqual([])
  })

  it('validates the draft and persists merged documents plus code relation links', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedServiceMapEdges(db)
    const runtime = new BuildDocsGenerationRuntime({ db })
    const task = await leaseFirstTask(runtime, 'api_spec')
    const context = await runtime.getContext({
      taskId: task.task_id,
      leaseToken: task.lease_token,
    })

    const submit = await runtime.submitTask({
      taskId: task.task_id,
      leaseToken: task.lease_token,
      document: {
        title: 'Orders API',
        summary: 'Lists orders with source-backed behavior and charges Stripe when needed.',
        access: 'No access evidence: source context does not show a guard.',
        flow: ['Reads orders, calls Stripe charge, and returns them.'],
        rules: [],
        source_link_selection: {
          input: ['source_link_candidate:001'],
          response: ['source_link_candidate:001'],
        },
      },
    })

    expect(submit).toMatchObject({
      status: 'saved',
      saved_document_id: context.content.target.document_id,
    })

    const saved = db.select().from(documents).where(eq(documents.id, context.content.target.document_id)).get()
    expect(saved).toMatchObject({
      projectId: 'project:docs-generation',
      type: 'api_spec',
      track: 'technical',
      status: 'passed',
      sourceRunId: task.run_id,
    })
    expect(saved?.content).toMatchObject({
      id: context.content.target.document_id,
      type: 'api_spec',
      identity: {
        method: 'GET',
        path: '/api/orders',
        handler: 'listOrders',
        file_path: 'src/orders/order.controller.ts',
      },
      relations: {
        tables: [{ table: 'orders', operation: 'select' }],
        external_calls: [{ system: 'Stripe', operation: 'charge' }],
      },
      source_links: {
        access: [],
        input: ['node:api:listOrders'],
        response: ['node:api:listOrders'],
      },
      access: 'No access evidence: source context does not show a guard.',
      evidence_refs: context.manifest.evidence_ids,
      relation_evidence_checked: true,
    })
    expect(saved?.content).not.toHaveProperty('source_link_selection')
    expect(saved?.content).not.toHaveProperty('input')
    expect(saved?.content).not.toHaveProperty('response')
    expect(saved?.content).not.toHaveProperty('contracts')

    expect(db.select().from(docDeps).where(eq(docDeps.documentId, context.content.target.document_id)).all()).toEqual([
      expect.objectContaining({
        codeNodeId: 'node:api:listOrders',
        depType: 'entrypoint',
      }),
    ])
    expect(db.select().from(docRelationLinks).where(eq(docRelationLinks.documentId, context.content.target.document_id)).all()).toEqual([
      expect.objectContaining({
        relationId: 'rel:api:listOrders:orders',
        kind: 'db_access',
        target: 'orders',
      }),
      expect.objectContaining({
        relationId: null,
        kind: 'db_access',
        target: 'orders',
        canonicalTarget: 'db:orders:select',
      }),
      expect.objectContaining({
        relationId: null,
        kind: 'external_service',
        target: 'Stripe',
        canonicalTarget: 'external_service:Stripe:charge',
      }),
    ])
  })

  it('stamps saved technical docs with sync2 scope and static source hash when a snapshot exists', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedStaticSnapshot(db)
    const runtime = new BuildDocsGenerationRuntime({ db })

    const apiTask = await leaseFirstTask(runtime, 'api_spec')
    const apiContext = await runtime.getContext({
      taskId: apiTask.task_id,
      leaseToken: apiTask.lease_token,
    })
    await runtime.submitTask({
      taskId: apiTask.task_id,
      leaseToken: apiTask.lease_token,
      document: {
        title: 'Orders API',
        summary: 'Lists orders with source-backed behavior.',
        access: 'No access evidence: source context does not show a guard.',
        flow: ['Reads orders and returns them.'],
        rules: [],
        source_link_selection: {
          input: ['source_link_candidate:001'],
          response: ['source_link_candidate:001'],
        },
      },
    })

    const screenTask = await leaseFirstTask(runtime, 'screen_spec')
    const screenContext = await runtime.getContext({
      taskId: screenTask.task_id,
      leaseToken: screenTask.lease_token,
    })
    await runtime.submitTask({
      taskId: screenTask.task_id,
      leaseToken: screenTask.lease_token,
      document: {
        title: 'Orders screen',
        summary: 'Shows the orders screen.',
        ascii_ui: '+ OrdersPage\n  + Orders list',
        layout: [{ name: 'Orders list', type: 'list', fields: ['order id'] }],
        state: [{ name: 'orders', source: 'query' }],
        flow: ['Renders the orders page.'],
        rules: [],
      },
    })

    const apiDoc = db.select().from(documents).where(eq(documents.id, apiContext.content.target.document_id)).get()
    const screenDoc = db.select().from(documents).where(eq(documents.id, screenContext.content.target.document_id)).get()

    expect(apiDoc).toMatchObject({
      scope: 'route',
      scopeId: 'ep:api:listOrders',
      documentSourceHash: 'hash:api:listOrders:v1',
      staticSnapshotId: 'static_merkle:docs-generation:v1',
    })
    expect(screenDoc).toMatchObject({
      scope: 'screen',
      scopeId: 'ep:web:orders',
      documentSourceHash: 'hash:screen:orders:v1',
      staticSnapshotId: 'static_merkle:docs-generation:v1',
    })
  })

  it('saves a narrative-only API draft when path params, response evidence, and relation facts exist', async () => {
    const fixture = createViennaChainFixture()
    try {
      const task = await leaseApiTask(fixture.runtime)
      const context = await fixture.runtime.getContext({
        taskId: task.task_id,
        leaseToken: task.lease_token,
      })
      const requestCandidate = context.content.source_link_candidates?.find((candidate) => candidate.symbol === 'OrderRequestDto')
      const responseCandidate = context.content.source_link_candidates?.find((candidate) => candidate.symbol === 'OrderResponseDto')
      if (!requestCandidate || !responseCandidate) throw new Error('expected request and response source link candidates')

      const submit = await fixture.runtime.submitTask({
        taskId: task.task_id,
        leaseToken: task.lease_token,
        document: {
          title: 'Order detail API',
          summary: 'Reads orders through OrderRepository.findById and returns a source-backed detail.',
          access: 'No access evidence: source context does not show a guard.',
          flow: [
            'OrderController.getOrder reads orderId and includeItems.',
            'OrderRepository.findById selects orders and mapOrderResponse builds OrderResponseDto.',
          ],
          rules: ['orderId selects the orders record.'],
          source_link_selection: {
            input: [requestCandidate.candidate_id],
            response: [responseCandidate.candidate_id],
          },
        },
      })

      expect(submit).toMatchObject({
        status: 'saved',
        saved_document_id: context.content.target.document_id,
      })

      const saved = fixture.db.select().from(documents).where(eq(documents.id, context.content.target.document_id)).get()
      expect(saved?.content).toMatchObject({
        identity: {
          method: 'GET',
          path: '/api/orders/:orderId',
          handler: 'OrderController.getOrder',
        },
        relations: {
          tables: [{ table: 'orders', operation: 'select' }],
        },
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('requests repair instead of saving when a draft includes system-owned fields', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    const runtime = new BuildDocsGenerationRuntime({ db })
    const task = await leaseFirstTask(runtime, 'api_spec')
    await runtime.getContext({
      taskId: task.task_id,
      leaseToken: task.lease_token,
    })

    const submit = await runtime.submitTask({
      taskId: task.task_id,
      leaseToken: task.lease_token,
      document: {
        id: 'llm:wrong-id',
        type: 'screen_spec',
        identity: { method: 'POST', path: '/made-up' },
        relations: { tables: [{ table: 'llm_guess', operation: 'select' }] },
        relation_facts: [{ relation_id: 'llm:invented' }],
        evidence_refs: ['llm:invented'],
        raw_evidence_pages: [{ page: 'source_context', content: 'raw source' }],
        title: 'Orders API',
        summary: 'Lists orders with source-backed behavior.',
        access: { required: null, mechanisms: [], roles: [] },
        input: { path: {}, query: {}, body: {} },
        response: {},
        flow: ['Reads orders and returns them.'],
        rules: [],
      },
    })

    expect(submit).toMatchObject({
      status: 'repair_requested',
      saved_document_id: null,
      validation_errors: expect.arrayContaining([
        expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.id' }),
      ]),
    })
  })

  it('requests repair instead of saving when an API draft includes non-narrative alias fields', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    const runtime = new BuildDocsGenerationRuntime({ db })
    const task = await leaseFirstTask(runtime, 'api_spec')
    await runtime.getContext({
      taskId: task.task_id,
      leaseToken: task.lease_token,
    })

    const submit = await runtime.submitTask({
      taskId: task.task_id,
      leaseToken: task.lease_token,
      document: {
        title: 'Orders API',
        summary: 'Lists orders with source-backed behavior.',
        flow: ['Reads orders and returns them.'],
        rules: [],
        method: 'GET',
        request: { query: { includeItems: 'boolean' } },
        tables: [{ table: 'orders', operation: 'select' }],
      },
    })

    expect(submit).toMatchObject({
      status: 'repair_requested',
      saved_document_id: null,
      validation_errors: expect.arrayContaining([
        expect.objectContaining({ code: 'FORBIDDEN_DRAFT_FIELD', path: '$.method' }),
        expect.objectContaining({ code: 'FORBIDDEN_DRAFT_FIELD', path: '$.request' }),
        expect.objectContaining({ code: 'FORBIDDEN_DRAFT_FIELD', path: '$.tables' }),
      ]),
    })
  })

  it('maps screen outgoing service-map facts without treating external links as external calls', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    seedServiceMapEdges(db)
    const runtime = new BuildDocsGenerationRuntime({ db })
    const task = await leaseFirstTask(runtime, 'screen_spec')
    const context = await runtime.getContext({
      taskId: task.task_id,
      leaseToken: task.lease_token,
    })

    const submit = await runtime.submitTask({
      taskId: task.task_id,
      leaseToken: task.lease_token,
      document: {
        title: 'Orders screen',
        summary: 'Shows orders from GET /api/orders and links to Stripe docs.',
        ascii_ui: '+ OrdersPage\n  + Orders list',
        layout: [{ name: 'Orders list', type: 'list', fields: ['order id'] }],
        state: [{ name: 'orders', source: 'query' }],
        actions: [
          { name: 'Load orders', trigger: 'mount', result: 'calls GET /api/orders' },
          { name: 'Open Stripe docs', trigger: 'click', result: 'opens https://docs.stripe.com' },
        ],
        flow: ['Loads orders from GET /api/orders and renders the Stripe docs link.'],
        rules: [],
      },
    })

    expect(submit).toMatchObject({
      status: 'saved',
      saved_document_id: context.content.target.document_id,
    })

    const saved = db.select().from(documents).where(eq(documents.id, context.content.target.document_id)).get()
    expect(saved?.content).toMatchObject({
      type: 'screen_spec',
      identity: {
        route_path: '/orders',
        screen_name: 'OrdersPage',
        component: 'OrdersPage',
      },
      relations: {
        api_calls: [{ method: 'GET', path: '/api/orders' }],
        external_links: [{ target: 'https://docs.stripe.com' }],
        external_calls: [],
      },
      relation_evidence_checked: true,
    })
  })

  it('requests repair when a draft is submitted before context preparation', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    const runtime = new BuildDocsGenerationRuntime({ db })
    const task = await leaseFirstTask(runtime, 'api_spec')

    const submit = await runtime.submitTask({
      taskId: task.task_id,
      leaseToken: task.lease_token,
      document: {
        title: 'Orders API',
        summary: 'Submitted too early.',
        access: {},
        input: {},
        response: {},
        flow: ['No context yet.'],
        rules: [],
      },
    })

    expect(submit).toMatchObject({
      status: 'repair_requested',
      saved_document_id: null,
      validation_errors: [
        expect.objectContaining({
          code: 'CONTEXT_NOT_PREPARED',
          path: '$.context',
        }),
      ],
    })
  })

  it('requests repair when source_link_selection includes unknown persisted candidates', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    const runtime = new BuildDocsGenerationRuntime({ db })
    const task = await leaseFirstTask(runtime, 'api_spec')
    await runtime.getContext({
      taskId: task.task_id,
      leaseToken: task.lease_token,
    })

    const submit = await runtime.submitTask({
      taskId: task.task_id,
      leaseToken: task.lease_token,
      document: {
        title: 'Order API',
        summary: 'Returns orders.',
        access: 'No access evidence: no guard is present in the context.',
        flow: ['The handler returns orders.'],
        rules: [],
        source_link_selection: {
          input: ['source_link_candidate:999'],
        },
      },
    })

    expect(submit).toMatchObject({
      status: 'repair_requested',
      validation_errors: [
        expect.objectContaining({
          code: 'UNKNOWN_SOURCE_LINK_CANDIDATE',
          path: '$.source_link_selection.input[0]',
        }),
      ],
    })
  })

  it('reports only draft shape errors for malformed source_link_selection entries', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    const runtime = new BuildDocsGenerationRuntime({ db })
    const task = await leaseFirstTask(runtime, 'api_spec')
    await runtime.getContext({
      taskId: task.task_id,
      leaseToken: task.lease_token,
    })

    const submit = await runtime.submitTask({
      taskId: task.task_id,
      leaseToken: task.lease_token,
      document: {
        title: 'Order API',
        summary: 'Returns orders.',
        access: 'No access evidence: no guard is present in the context.',
        flow: ['The handler returns orders.'],
        rules: [],
        source_link_selection: {
          input: [123],
        },
      },
    })

    expect(submit).toMatchObject({
      status: 'repair_requested',
      validation_errors: [
        expect.objectContaining({
          code: 'QUALITY_FIELD_SHAPE',
          path: '$.source_link_selection.input[0]',
        }),
      ],
    })
    expect(
      submit.validation_errors.filter((error) => error.path === '$.source_link_selection.input[0]'),
    ).toEqual([
      expect.objectContaining({
        code: 'QUALITY_FIELD_SHAPE',
        path: '$.source_link_selection.input[0]',
      }),
    ])
  })

  it('exposes a typed error class for CLI error mapping', () => {
    const error = new BuildDocsGenerationRuntimeError('BUILD_DOCS_PRECONDITION_FAILED', 'Build docs cannot start.', {
      missing: ['project:build_service_map'],
    })

    expect(error).toMatchObject({
      code: 'BUILD_DOCS_PRECONDITION_FAILED',
      details: { missing: ['project:build_service_map'] },
    })
  })

  it('recovers stale leases before reporting build_docs runtime status', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    const ts = '2026-06-02T00:00:00.000Z'
    db.insert(generationRuns).values({
      id: 'gen:stale-status',
      projectId: 'project:docs-generation',
      stage: 'build_docs',
      status: 'running',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
      sourceCommit: 'commit:test',
      maxConcurrentTasks: 1,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    db.insert(generationTasks).values({
      id: 'task:stale-status',
      runId: 'gen:stale-status',
      projectId: 'project:docs-generation',
      repositoryId: 'repo:api',
      documentType: 'api_spec',
      targetKey: 'api:GET:/orders',
      targetDocumentId: 'doc:orders',
      primaryEntryPointId: 'ep:api:listOrders',
      targetJson: {},
      status: 'leased',
      leaseToken: 'lease:old',
      leasedBy: 'worker:old',
      leaseExpiresAt: ts,
      retryCount: 0,
      maxRetries: 1,
      createdAt: ts,
      updatedAt: ts,
    }).run()

    const result = await new BuildDocsGenerationRuntime({ db }).status({ runId: 'gen:stale-status' })

    expect(result.task_counts_by_status).toMatchObject({ expired: 1, leased: 0 })
    expect(db.select().from(generationTasks).where(eq(generationTasks.id, 'task:stale-status')).get()).toMatchObject({
      status: 'expired',
      leaseToken: null,
      leasedBy: null,
      leaseExpiresAt: null,
    })
  })

  it('does not overwrite an already leased task when the local task snapshot is stale', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    const runtime = new BuildDocsGenerationRuntime({ db })
    const started = await runtime.start({
      projectId: 'project:docs-generation',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
    })
    await runtime.approve({
      runId: started.run_id,
      maxConcurrentTasks: 10,
      approvedBy: 'user:test',
    })

    const staleSnapshot = db.select().from(generationTasks).where(eq(generationTasks.runId, started.run_id)).all()
    const protectedTask = staleSnapshot.find((task) => task.documentType === 'api_spec')
    if (!protectedTask) throw new Error('expected api_spec task')
    db.update(generationTasks)
      .set({
        status: 'leased',
        leaseToken: 'lease:other-worker',
        leasedBy: 'worker:other',
        leaseExpiresAt: '2099-01-01T00:00:00.000Z',
      })
      .where(eq(generationTasks.id, protectedTask.id))
      .run()
    vi.spyOn(runtime as unknown as { tasksForRun: (runId: string) => typeof staleSnapshot }, 'tasksForRun')
      .mockReturnValue(staleSnapshot)

    const lease = await runtime.leaseTasks({
      runId: started.run_id,
      workerGroupId: 'worker:current',
      limit: 10,
    })

    if (lease.type !== 'tasks') throw new Error(`expected tasks result, got ${lease.type}`)
    expect(lease.leased_tasks.map((task) => task.task_id)).not.toContain(protectedTask.id)
    expect(db.select().from(generationTasks).where(eq(generationTasks.id, protectedTask.id)).get()).toMatchObject({
      status: 'leased',
      leaseToken: 'lease:other-worker',
      leasedBy: 'worker:other',
    })
  })

  it('rejects task access when the lease expires exactly now', async () => {
    const db = createTestDb()
    seedProject(db, { serviceMapReady: true })
    const runtime = new BuildDocsGenerationRuntime({ db })
    const task = await leaseFirstTask(runtime, 'api_spec')
    const now = '2026-06-09T00:00:00.000Z'
    db.update(generationTasks)
      .set({ leaseExpiresAt: now })
      .where(eq(generationTasks.id, task.task_id))
      .run()

    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))
    try {
      await expect(runtime.getContext({ taskId: task.task_id, leaseToken: task.lease_token }))
        .rejects.toMatchObject({ code: 'LEASE_EXPIRED' })
    } finally {
      vi.useRealTimers()
    }
  })
})

async function leaseFirstTask(runtime: BuildDocsGenerationRuntime, documentType: 'api_spec' | 'screen_spec') {
  const start = await runtime.start({
    projectId: 'project:docs-generation',
    outputLanguage: 'ko',
    requestedBy: 'user:test',
  })
  await runtime.approve({
    runId: start.run_id,
    maxConcurrentTasks: 1,
    approvedBy: 'user:test',
  })
  const task = await runtime.leaseTask({
    runId: start.run_id,
    workerId: `worker:${documentType}`,
    documentTypes: [documentType],
  })
  if (task.type !== 'task') throw new Error(`expected task lease, got ${task.type}`)
  return { ...task, run_id: start.run_id }
}

function seedProject(db: DB, options: { serviceMapReady: boolean; repoPath?: string }) {
  const now = '2026-06-02T00:00:00.000Z'
  db.insert(projects).values({
    id: 'project:docs-generation',
    name: 'Docs Generation Fixture',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(repositories).values([
    repo('repo:api', 'api-service', 'commit:api', options.repoPath),
    repo('repo:web', 'web-service', 'commit:web'),
  ]).run()
  db.insert(codeNodes).values([
    node('node:api:listOrders', 'repo:api', 'src/orders/order.controller.ts', 'listOrders', 'async function listOrders(req, res)'),
    node('node:web:OrdersPage', 'repo:web', 'src/app/orders/page.tsx', 'OrdersPage', 'export default function OrdersPage()'),
  ]).run()
  db.insert(entryPoints).values([
    entryPoint('ep:api:listOrders', 'repo:api', 'api', 'GET', '/api/orders', 'node:api:listOrders'),
    entryPoint('ep:web:orders', 'repo:web', 'page', null, '/orders', 'node:web:OrdersPage'),
  ]).run()
  db.insert(codeRelations).values({
    id: 'rel:api:listOrders:orders',
    repoId: 'repo:api',
    sourceNodeId: 'node:api:listOrders',
    kind: 'db_access',
    target: 'orders',
    operation: 'select',
    canonicalTarget: 'db:orders:select',
    payload: { table: 'orders' },
    evidenceNodeIds: ['node:api:listOrders'],
    confidence: 'high',
    createdAt: now,
  }).run()
  seedRequiredRepositoryPhases(db, ['repo:api', 'repo:web'])
  if (options.serviceMapReady) seedServiceMapPhase(db, 'project:docs-generation', Date.parse('2026-06-03T00:00:00.000Z'))
}

function repo(id: string, name: string, commit: string, repoPath = '/fixture/docs-generation') {
  return {
    id,
    projectId: 'project:docs-generation',
    name,
    repoPath,
    framework: 'nextjs' as const,
    analysisBranch: 'main',
    lastSyncedCommit: commit,
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
  }
}

function node(id: string, repoId: string, filePath: string, name: string, signature: string) {
  return {
    id,
    repoId,
    type: 'function' as const,
    filePath,
    name,
    lineStart: 1,
    lineEnd: 12,
    signature,
    docComment: `${signature} handles ${name}`,
    exported: true,
    isDefaultExport: false,
    isAsync: signature.startsWith('async'),
    isTest: false,
    parseStatus: 'ok' as const,
    createdAt: '2026-06-02T00:00:00.000Z',
  }
}

function entryPoint(
  id: string,
  repoId: string,
  kind: 'api' | 'page',
  method: string | null,
  path: string,
  handlerNodeId: string,
) {
  return {
    id,
    repoId,
    framework: 'nextjs',
    kind,
    httpMethod: method,
    path,
    fullPath: path,
    handlerNodeId,
    metadata: {},
    detectionSource: 'rule:test',
    confidence: 'high' as const,
    detectionEvidence: { matchedNodeIds: [handlerNodeId] },
    createdAt: '2026-06-02T00:00:00.000Z',
  }
}

function bundle(entryPointId: string, nodeId: string, depth: number) {
  return {
    entryPointId,
    nodeId,
    depth,
    edgePath: depth === 0 ? [nodeId] : [entryPointId, nodeId],
  }
}

function edge(repoId: string, sourceId: string, targetId: string) {
  return {
    repoId,
    sourceId,
    targetId,
    relation: 'calls' as const,
    targetSpecifier: targetId,
    resolveStatus: 'resolved' as const,
    source: 'static' as const,
    createdAt: '2026-06-02T00:00:00.000Z',
  }
}

function seedRequiredRepositoryPhases(db: DB, repositoryIds: string[]) {
  const phases = ['build_graph', 'build_pattern_profile', 'build_models', 'build_route', 'build_relations'] as const
  db.insert(repositoryPhaseStatus).values(repositoryIds.flatMap((repositoryId) =>
    phases.map((phase) => ({
      repositoryId,
      phase,
      builtAt: phase === 'build_relations' ? '2026-06-02T00:00:00.000Z' : '2026-06-01T00:00:00.000Z',
      builtFromCommit: repositoryId === 'repo:api' ? 'commit:api' : 'commit:web',
      confirmedAt: phase === 'build_route' ? '2026-06-02T01:00:00.000Z' : null,
      validity: 'fresh' as const,
      status: 'passed' as const,
      sourceRunId: `run:${repositoryId}:${phase}`,
      sourceCommit: repositoryId === 'repo:api' ? 'commit:api' : 'commit:web',
      updatedAt: '2026-06-02T00:00:00.000Z',
    })),
  )).run()
}

function seedServiceMapPhase(db: DB, projectId: string, updatedAt: number) {
  db.insert(projectPhaseStatus).values({
    projectId,
    phase: 'build_service_map',
    status: 'passed',
    sourceRunId: 'run:service-map',
    sourceCommit: 'commit:service-map',
    updatedAt,
    upstreamVersions: null,
    meta: null,
  }).onConflictDoUpdate({
    target: [projectPhaseStatus.projectId, projectPhaseStatus.phase],
    set: {
      status: 'passed',
      sourceRunId: 'run:service-map',
      sourceCommit: 'commit:service-map',
      updatedAt,
      upstreamVersions: null,
      meta: null,
    },
  }).run()
}

function seedTechnicalDocument(db: DB, input: {
  id: string
  type: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
  scope: string
  scopeId: string
  documentSourceHash: string | null
}) {
  db.insert(documents).values({
    id: input.id,
    projectId: 'project:docs-generation',
    type: input.type,
    track: 'technical',
    scope: input.scope,
    scopeId: input.scopeId,
    status: 'passed',
    validity: 'fresh',
    summary: `${input.type} ${input.scopeId}`,
    content: { title: input.scopeId },
    rawLlmOutput: '{}',
    contentHash: `content:${input.id}`,
    staticSnapshotId: 'static_merkle:docs-generation:v1',
    documentSourceHash: input.documentSourceHash,
    sourceRunId: 'gen:previous',
    sourceCommit: 'commit:previous',
    updatedBy: 'llm',
    updatedAt: '2026-06-03T00:00:00.000Z',
  }).run()
}

function seedIncrementalSnapshots(db: DB) {
  seedStaticSnapshotWithId(db, 'static_merkle:docs-generation:v1', {
    routeDocumentSourceHashes: [
      routeDocHash('route:ep:api:listOrders', 'hash:api:listOrders:v1', {
        type: 'api_spec',
        scope: 'route',
        scopeId: 'ep:api:listOrders',
        repoId: 'repo:api',
      }),
      routeDocHash('screen:ep:web:orders', 'hash:screen:orders:v1', {
        type: 'screen_spec',
        scope: 'screen',
        scopeId: 'ep:web:orders',
        repoId: 'repo:web',
      }),
    ],
  }, '2026-06-03T00:00:00.000Z')
  seedStaticSnapshotWithId(db, 'static_merkle:docs-generation:v2', {
    routeDocumentSourceHashes: [
      routeDocHash('route:ep:api:listOrders', 'hash:api:listOrders:v2', {
        type: 'api_spec',
        scope: 'route',
        scopeId: 'ep:api:listOrders',
        repoId: 'repo:api',
      }),
      routeDocHash('screen:ep:web:orders', 'hash:screen:orders:v1', {
        type: 'screen_spec',
        scope: 'screen',
        scopeId: 'ep:web:orders',
        repoId: 'repo:web',
      }),
    ],
  }, '2026-06-04T00:00:00.000Z')
}

function seedUnchangedIncrementalSnapshots(db: DB) {
  const hashes = [
    routeDocHash('route:ep:api:listOrders', 'hash:api:listOrders:v2', {
      type: 'api_spec',
      scope: 'route',
      scopeId: 'ep:api:listOrders',
      repoId: 'repo:api',
    }),
    routeDocHash('screen:ep:web:orders', 'hash:screen:orders:v2', {
      type: 'screen_spec',
      scope: 'screen',
      scopeId: 'ep:web:orders',
      repoId: 'repo:web',
    }),
  ]
  seedStaticSnapshotWithId(db, 'static_merkle:docs-generation:v1', {
    routeDocumentSourceHashes: hashes,
  }, '2026-06-03T00:00:00.000Z')
  seedStaticSnapshotWithId(db, 'static_merkle:docs-generation:v2', {
    routeDocumentSourceHashes: hashes,
  }, '2026-06-04T00:00:00.000Z')
}

function seedIncrementalSnapshotsWithOrphan(db: DB) {
  seedStaticSnapshotWithId(db, 'static_merkle:docs-generation:v1', {
    routeDocumentSourceHashes: [
      routeDocHash('route:ep:api:listOrders', 'hash:api:listOrders:v2', {
        type: 'api_spec',
        scope: 'route',
        scopeId: 'ep:api:listOrders',
        repoId: 'repo:api',
      }),
      routeDocHash('screen:ep:web:orders', 'hash:screen:orders:v1', {
        type: 'screen_spec',
        scope: 'screen',
        scopeId: 'ep:web:orders',
        repoId: 'repo:web',
      }),
    ],
  }, '2026-06-03T00:00:00.000Z')
  seedStaticSnapshotWithId(db, 'static_merkle:docs-generation:v2', {
    routeDocumentSourceHashes: [
      routeDocHash('route:ep:api:listOrders', 'hash:api:listOrders:v2', {
        type: 'api_spec',
        scope: 'route',
        scopeId: 'ep:api:listOrders',
        repoId: 'repo:api',
      }),
    ],
  }, '2026-06-04T00:00:00.000Z')
}

function seedStaticSnapshotWithId(
  db: DB,
  id: string,
  hashSetJson: Record<string, unknown>,
  createdAt: string,
) {
  db.insert(staticMerkleSnapshots).values({
    id,
    projectId: 'project:docs-generation',
    snapshotKind: 'project',
    analysisBranch: null,
    sourceCommit: null,
    repoCommitPinsJson: [],
    rootHash: `root:${id}`,
    hashSetJson,
    reasonInputsJson: { byKey: {} },
    createdByRunId: `static_map_run:${id}`,
    createdAt,
  }).run()
}

function routeDocHash(key: string, hash: string, target: {
  type: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
  scope: string
  scopeId: string
  repoId: string
}) {
  return {
    key,
    hash,
    target: {
      track: 'technical',
      type: target.type,
      scope: target.scope,
      scopeId: target.scopeId,
      repoId: target.repoId,
    },
  }
}

function seedStaticSnapshot(db: DB) {
  db.insert(staticMerkleSnapshots).values({
    id: 'static_merkle:docs-generation:v1',
    projectId: 'project:docs-generation',
    snapshotKind: 'project',
    analysisBranch: null,
    sourceCommit: null,
    repoCommitPinsJson: [],
    rootHash: 'root:docs-generation:v1',
    hashSetJson: {
      routeDocumentSourceHashes: [
        {
          key: 'route:ep:api:listOrders',
          hash: 'hash:api:listOrders:v1',
          target: {
            track: 'technical',
            type: 'api_spec',
            scope: 'route',
            scopeId: 'ep:api:listOrders',
            repoId: 'repo:api',
          },
        },
        {
          key: 'screen:ep:web:orders',
          hash: 'hash:screen:orders:v1',
          target: {
            track: 'technical',
            type: 'screen_spec',
            scope: 'screen',
            scopeId: 'ep:web:orders',
            repoId: 'repo:web',
          },
        },
      ],
    },
    reasonInputsJson: { byKey: {} },
    createdByRunId: 'static_map_run:docs-generation:v1',
    createdAt: '2026-06-03T00:00:00.000Z',
  }).run()
}

function seedServiceMapEdges(db: DB) {
  db.insert(serviceMapEdges).values([
    {
      id: 'edge:api:listOrders:db',
      projectId: 'project:docs-generation',
      repoId: 'repo:api',
      sourceRepoId: 'repo:api',
      targetRepoId: null,
      runId: 'run:service-map',
      sourceType: 'api',
      sourceId: 'ep:api:listOrders',
      sourceLabel: 'GET /api/orders',
      targetType: 'db',
      targetId: 'db:orders',
      targetLabel: 'orders',
      kind: 'accesses_db',
      canonicalTarget: 'db:orders:select',
      confidence: 'high',
      source: 'deterministic',
      evidence: { relation_ids: ['rel:api:listOrders:orders'] },
      createdAt: '2026-06-03T00:00:00.000Z',
    },
    {
      id: 'edge:api:listOrders:external',
      projectId: 'project:docs-generation',
      repoId: 'repo:api',
      sourceRepoId: 'repo:api',
      targetRepoId: null,
      runId: 'run:service-map',
      sourceType: 'api',
      sourceId: 'ep:api:listOrders',
      sourceLabel: 'GET /api/orders',
      targetType: 'external_service',
      targetId: 'external_service:Stripe',
      targetLabel: 'Stripe',
      kind: 'uses_external_service',
      canonicalTarget: 'external_service:Stripe:charge',
      confidence: 'medium',
      source: 'merged',
      evidence: {},
      createdAt: '2026-06-03T00:00:00.000Z',
    },
    {
      id: 'edge:screen:orders:api',
      projectId: 'project:docs-generation',
      repoId: 'repo:web',
      sourceRepoId: 'repo:web',
      targetRepoId: 'repo:api',
      runId: 'run:service-map',
      sourceType: 'screen',
      sourceId: 'ep:web:orders',
      sourceLabel: '/orders',
      targetType: 'api',
      targetId: 'ep:api:listOrders',
      targetLabel: 'GET /api/orders',
      kind: 'calls_api',
      canonicalTarget: 'GET /api/orders',
      confidence: 'high',
      source: 'deterministic',
      evidence: {},
      createdAt: '2026-06-03T00:00:00.000Z',
    },
    {
      id: 'edge:screen:orders:external-link',
      projectId: 'project:docs-generation',
      repoId: 'repo:web',
      sourceRepoId: 'repo:web',
      targetRepoId: null,
      runId: 'run:service-map',
      sourceType: 'screen',
      sourceId: 'ep:web:orders',
      sourceLabel: '/orders',
      targetType: 'external_link',
      targetId: 'external:https://docs.stripe.com',
      targetLabel: 'Stripe docs',
      kind: 'opens_external_link',
      canonicalTarget: 'https://docs.stripe.com',
      confidence: 'high',
      source: 'deterministic',
      evidence: {},
      createdAt: '2026-06-03T00:00:00.000Z',
    },
    {
      id: 'edge:api:listOrders:ignored-low',
      projectId: 'project:docs-generation',
      repoId: 'repo:api',
      sourceRepoId: 'repo:api',
      targetRepoId: null,
      runId: 'run:service-map',
      sourceType: 'api',
      sourceId: 'ep:api:listOrders',
      sourceLabel: 'GET /api/orders',
      targetType: 'event',
      targetId: 'event:ignored',
      targetLabel: 'ignored',
      kind: 'publishes_event',
      canonicalTarget: 'event:ignored',
      confidence: 'low',
      source: 'deterministic',
      evidence: {},
      createdAt: '2026-06-03T00:00:00.000Z',
    },
  ]).run()

  expect(db.select().from(serviceMapEdges).where(and(
    eq(serviceMapEdges.projectId, 'project:docs-generation'),
    eq(serviceMapEdges.sourceId, 'ep:api:listOrders'),
  )).all()).toHaveLength(3)
}
