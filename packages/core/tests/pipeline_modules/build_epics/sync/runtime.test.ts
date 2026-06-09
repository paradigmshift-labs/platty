import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { documents, generationRuns, generationTasks } from '@/db/schema/build_docs.js'
import { epicDocumentLinks } from '@/db/schema/build_epics.js'
import { epics, projects, repositories } from '@/db/schema/core.js'
import { docSyncCandidates, docSyncPlans } from '@/db/schema/sync.js'
import { BuildEpicsSyncRuntime } from '@/pipeline_modules/build_epics/sync/runtime.js'

describe('BuildEpicsSyncRuntime', () => {
  it('creates a ready deletion-only draft and confirms through existing persistence', async () => {
    const db = createTestDb()
    seedProject(db)
    seedExistingOrdersEpic(db)
    seedDeletedOrdersDocumentSync(db)
    const runtime = new BuildEpicsSyncRuntime({ db })

    const started = await runtime.start({ projectId: 'p1', docSyncPlanId: 'plan:sync', requestedBy: 'user:test' })

    expect(started.status).toBe('ready')
    expect(db.select().from(generationTasks).where(eq(generationTasks.runId, started.runId)).all()).toEqual([])

    const draft = await runtime.showDraft({ runId: started.runId })
    expect(draft?.plan.epics).toEqual([])
    expect(draft?.plan.syncMetadata).toMatchObject({
      docSyncPlanId: 'plan:sync',
      removedEpicIds: ['epic:orders'],
      removedDocumentIds: ['doc:orders'],
    })

    const confirmed = await runtime.confirmDraft({ runId: started.runId, requestedBy: 'user:test' })
    expect(confirmed.status).toBe('confirmed')
    expect(db.select().from(epics).where(eq(epics.id, 'epic:orders')).get()?.deletedAt).toEqual(expect.any(String))
    expect(db.select().from(epicDocumentLinks).all()).toEqual([])
    expect(db.select().from(generationRuns).where(eq(generationRuns.id, started.runId)).get()?.status).toBe('completed')
  })

  it('creates assignment tasks for new and changed documents', async () => {
    const db = createTestDb()
    seedProject(db)
    seedExistingOrdersEpic(db)
    seedNewReturnsDocumentSync(db)
    const runtime = new BuildEpicsSyncRuntime({ db })

    const started = await runtime.start({ projectId: 'p1', docSyncPlanId: 'plan:sync', requestedBy: 'user:test' })

    expect(started.status).toBe('running')
    expect(db.select().from(generationTasks).where(eq(generationTasks.runId, started.runId)).all()).toEqual([
      expect.objectContaining({
        documentType: 'document_assignment',
        targetKey: 'sync:assignment:1',
        targetJson: expect.objectContaining({
          task_type: 'epic_sync_assignment',
          impactedDocumentIds: ['doc:returns'],
        }),
      }),
    ])
  })

  it('chunks assignment tasks and creates cross-link task only after every assignment chunk completes', async () => {
    const db = createTestDb()
    seedProject(db)
    seedExistingOrdersEpic(db)
    seedManyNewDocumentsSync(db)
    const runtime = new BuildEpicsSyncRuntime({ db })

    const started = await runtime.start({
      projectId: 'p1',
      docSyncPlanId: 'plan:sync',
      requestedBy: 'user:test',
      policy: { maxAssignmentBatchSize: 2 },
    })

    expect(started.status).toBe('running')
    const initialTasks = db.select().from(generationTasks).where(eq(generationTasks.runId, started.runId)).all()
    expect(initialTasks).toEqual([
      expect.objectContaining({
        targetKey: 'sync:assignment:001',
        targetJson: expect.objectContaining({ impactedDocumentIds: ['doc:returns', 'doc:refunds'] }),
      }),
      expect.objectContaining({
        targetKey: 'sync:assignment:002',
        targetJson: expect.objectContaining({ impactedDocumentIds: ['doc:exchanges'] }),
      }),
    ])

    const firstLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:sync' })
    const firstTask = firstLease.leasedTasks[0]!
    await runtime.submitTask({
      taskId: firstTask.taskId,
      leaseToken: firstTask.leaseToken,
      result: {
        assignments: [
          assignmentForNewApi('doc:returns', 'returns'),
          assignmentForNewApi('doc:refunds', 'refunds'),
        ],
      },
    })

    expect(await runtime.status({ runId: started.runId })).toMatchObject({
      runStatus: 'running',
      draftStatus: 'building',
      taskCountsByStatus: { completed: 1, pending: 1 },
    })
    expect(db.select().from(generationTasks).where(eq(generationTasks.runId, started.runId)).all())
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ targetKey: 'sync:cross_links:1' })]))

    const secondLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:sync' })
    const secondTask = secondLease.leasedTasks[0]!
    await runtime.submitTask({
      taskId: secondTask.taskId,
      leaseToken: secondTask.leaseToken,
      result: {
        assignments: [
          assignmentForNewApi('doc:exchanges', 'exchanges'),
        ],
      },
    })

    expect(await runtime.status({ runId: started.runId })).toMatchObject({
      runStatus: 'running',
      draftStatus: 'building',
      taskCountsByStatus: { completed: 2, pending: 1 },
    })
    expect(db.select().from(generationTasks).where(eq(generationTasks.runId, started.runId)).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetKey: 'sync:cross_links:1',
        targetJson: expect.objectContaining({
          affectedDocumentIds: ['doc:returns', 'doc:refunds', 'doc:exchanges'],
        }),
      }),
    ]))
  })

  it('creates a pending cross-link task after assignment output updates the draft', async () => {
    const db = createTestDb()
    seedProject(db)
    seedExistingOrdersEpic(db)
    seedNewReturnsDocumentSync(db)
    const runtime = new BuildEpicsSyncRuntime({ db })
    const started = await runtime.start({ projectId: 'p1', docSyncPlanId: 'plan:sync', requestedBy: 'user:test' })
    const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:sync' })
    const task = lease.leasedTasks[0]!
    const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })

    expect(context.content).toMatchObject({
      taskType: 'epic_sync_assignment',
      impactedCards: [expect.objectContaining({ documentId: 'doc:returns' })],
      existingEpics: [expect.objectContaining({ stableKey: 'orders' })],
    })

    const submitted = await runtime.submitTask({
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      result: {
        assignments: [{
          documentId: 'doc:returns',
          documentType: 'api_spec',
          action: 'create_epic',
          role: 'owner',
          confidence: 'medium',
          reason: 'Returns is a separate customer capability.',
          newEpic: { stableKey: 'returns', name: 'Returns', abbr: 'RET', summary: 'Return request and refund initiation.' },
        }],
      },
    })

    expect(submitted.status).toBe('completed')
    expect(await runtime.status({ runId: started.runId })).toMatchObject({
      runStatus: 'running',
      draftStatus: 'building',
      taskCountsByStatus: { completed: 1, pending: 1 },
    })
    expect(db.select().from(generationTasks).where(eq(generationTasks.runId, started.runId)).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        documentType: 'document_assignment',
        targetKey: 'sync:cross_links:1',
        targetJson: expect.objectContaining({
          task_type: 'epic_sync_cross_links',
          affectedDocumentIds: ['doc:returns'],
        }),
      }),
    ]))
  })

  it('rejects task access when the lease expires exactly now', async () => {
    const db = createTestDb()
    seedProject(db)
    seedExistingOrdersEpic(db)
    seedNewReturnsDocumentSync(db)
    const runtime = new BuildEpicsSyncRuntime({ db })
    const started = await runtime.start({ projectId: 'p1', docSyncPlanId: 'plan:sync', requestedBy: 'user:test' })
    const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:boundary' })
    const task = lease.leasedTasks[0]!
    const now = '2026-06-09T00:00:00.000Z'
    db.update(generationTasks)
      .set({ leaseExpiresAt: now })
      .where(eq(generationTasks.id, task.taskId))
      .run()

    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))
    try {
      await expect(runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken }))
        .rejects.toThrow('LEASE_EXPIRED')
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies cross-link output after assignment and then makes the draft ready', async () => {
    const db = createTestDb()
    seedProject(db)
    seedExistingOrdersEpic(db)
    seedNewReturnsDocumentSync(db)
    const runtime = new BuildEpicsSyncRuntime({ db })
    const started = await runtime.start({ projectId: 'p1', docSyncPlanId: 'plan:sync', requestedBy: 'user:test' })
    const assignmentLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:sync' })
    const assignmentTask = assignmentLease.leasedTasks[0]!

    await runtime.submitTask({
      taskId: assignmentTask.taskId,
      leaseToken: assignmentTask.leaseToken,
      result: {
        assignments: [{
          documentId: 'doc:returns',
          documentType: 'api_spec',
          action: 'create_epic',
          role: 'owner',
          confidence: 'medium',
          reason: 'Returns is a separate customer capability.',
          newEpic: { stableKey: 'returns', name: 'Returns', abbr: 'RET', summary: 'Return request and refund initiation.' },
        }],
      },
    })

    const crossLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:sync' })
    const crossTask = crossLease.leasedTasks[0]!
    expect(crossTask.taskType).toBe('epic_sync_cross_links')
    const context = await runtime.getContext({ taskId: crossTask.taskId, leaseToken: crossTask.leaseToken })

    expect(context.content).toMatchObject({
      taskType: 'epic_sync_cross_links',
      affectedCards: [expect.objectContaining({ documentId: 'doc:returns' })],
      existingEpics: expect.arrayContaining([
        expect.objectContaining({ stableKey: 'orders' }),
        expect.objectContaining({ stableKey: 'returns' }),
      ]),
    })

    const submitted = await runtime.submitTask({
      taskId: crossTask.taskId,
      leaseToken: crossTask.leaseToken,
      result: {
        links: [{
          sourceDocumentId: 'doc:returns',
          targetEpicStableKey: 'orders',
          kind: 'operational_dependency',
          role: 'impact',
          confidence: 'medium',
          reason: 'Returns depends on the original order state.',
        }],
      },
    })

    expect(submitted.status).toBe('completed')
    expect(await runtime.status({ runId: started.runId })).toMatchObject({
      runStatus: 'completed',
      draftStatus: 'ready',
      taskCountsByStatus: { completed: 2 },
    })
    const draft = await runtime.showDraft({ runId: started.runId })
    expect(draft?.plan.epics.find((epic) => epic.stableKey === 'returns')).toMatchObject({
      crossLinks: [expect.objectContaining({ sourceDocumentId: 'doc:returns', targetTempEpicId: 'epic:orders' })],
      dependencies: [expect.objectContaining({ targetTempEpicId: 'epic:orders', kind: 'external_call' })],
    })
  })

  it('requests repair when assignment output omits an impacted document', async () => {
    const db = createTestDb()
    seedProject(db)
    seedExistingOrdersEpic(db)
    seedTwoNewDocumentsSync(db)
    const runtime = new BuildEpicsSyncRuntime({ db })
    const started = await runtime.start({ projectId: 'p1', docSyncPlanId: 'plan:sync', requestedBy: 'user:test' })
    const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:sync' })
    const task = lease.leasedTasks[0]!

    const submitted = await runtime.submitTask({
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      result: {
        assignments: [{
          documentId: 'doc:returns',
          documentType: 'api_spec',
          action: 'create_epic',
          role: 'owner',
          confidence: 'medium',
          reason: 'Returns is a separate customer capability.',
          newEpic: { stableKey: 'returns', name: 'Returns', abbr: 'RET', summary: 'Return request and refund initiation.' },
        }],
      },
    })

    expect(submitted).toMatchObject({
      status: 'repair_requested',
      validationErrors: [
        expect.objectContaining({
          code: 'MISSING_SYNC_ASSIGNMENT_DOCUMENT',
          documentId: 'doc:refunds',
        }),
      ],
    })
    expect((await runtime.status({ runId: started.runId })).draftStatus).toBe('building')
  })

  it('fails the run when assignment repair retries are exhausted', async () => {
    const db = createTestDb()
    seedProject(db)
    seedExistingOrdersEpic(db)
    seedTwoNewDocumentsSync(db)
    const runtime = new BuildEpicsSyncRuntime({ db })
    const started = await runtime.start({
      projectId: 'p1',
      docSyncPlanId: 'plan:sync',
      requestedBy: 'user:test',
      policy: { maxRepairPasses: 0 },
    })
    const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:sync' })
    const task = lease.leasedTasks[0]!

    const submitted = await runtime.submitTask({
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      result: {
        assignments: [{
          documentId: 'doc:returns',
          documentType: 'api_spec',
          action: 'create_epic',
          role: 'owner',
          confidence: 'medium',
          reason: 'Returns is a separate customer capability.',
          newEpic: { stableKey: 'returns', name: 'Returns', abbr: 'RET', summary: 'Return request and refund initiation.' },
        }],
      },
    })

    expect(submitted).toMatchObject({
      status: 'failed',
      validationErrors: [
        expect.objectContaining({
          code: 'MISSING_SYNC_ASSIGNMENT_DOCUMENT',
          documentId: 'doc:refunds',
        }),
      ],
    })
    expect(await runtime.status({ runId: started.runId })).toMatchObject({
      runStatus: 'failed',
      draftStatus: 'invalid',
      taskCountsByStatus: { failed: 1 },
    })
  })

  it('fails the run when a leased sync task is failed by the worker runner', async () => {
    const db = createTestDb()
    seedProject(db)
    seedExistingOrdersEpic(db)
    seedNewReturnsDocumentSync(db)
    const runtime = new BuildEpicsSyncRuntime({ db })
    const started = await runtime.start({ projectId: 'p1', docSyncPlanId: 'plan:sync', requestedBy: 'user:test' })
    const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:sync' })
    const task = lease.leasedTasks[0]!

    const failed = await runtime.failTask({
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      reason: 'build_epics sync worker invocation failed',
    })

    expect(failed).toMatchObject({
      status: 'failed',
      validationErrors: [expect.objectContaining({ code: 'SYNC_WORKER_INVOCATION_FAILED' })],
    })
    expect(await runtime.status({ runId: started.runId })).toMatchObject({
      runStatus: 'failed',
      draftStatus: 'invalid',
      taskCountsByStatus: { failed: 1 },
    })
  })

  it('confirms a mixed sync that deletes an empty EPIC and creates a new EPIC', async () => {
    const db = createTestDb()
    seedProject(db)
    seedExistingOrdersEpic(db)
    seedDeletedOrdersAndNewReturnsSync(db)
    const runtime = new BuildEpicsSyncRuntime({ db })
    const started = await runtime.start({ projectId: 'p1', docSyncPlanId: 'plan:sync', requestedBy: 'user:test' })
    const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:sync' })
    const task = lease.leasedTasks[0]!

    const submitted = await runtime.submitTask({
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      result: {
        assignments: [{
          documentId: 'doc:returns',
          documentType: 'api_spec',
          action: 'create_epic',
          role: 'owner',
          confidence: 'medium',
          reason: 'Returns is a separate customer capability.',
          newEpic: { stableKey: 'returns', name: 'Returns', abbr: 'RET', summary: 'Return request and refund initiation.' },
        }],
      },
    })

    expect(submitted.status).toBe('completed')
    const draft = await runtime.showDraft({ runId: started.runId })
    expect(draft?.plan.syncMetadata).toMatchObject({
      removedDocumentIds: ['doc:orders'],
      removedEpicIds: ['epic:orders'],
    })

    const crossLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:sync' })
    const crossTask = crossLease.leasedTasks[0]!
    expect(crossTask.taskType).toBe('epic_sync_cross_links')
    expect(await runtime.submitTask({
      taskId: crossTask.taskId,
      leaseToken: crossTask.leaseToken,
      result: { links: [] },
    })).toMatchObject({ status: 'completed' })

    const confirmed = await runtime.confirmDraft({ runId: started.runId, requestedBy: 'user:test' })

    expect(confirmed.status).toBe('confirmed')
    expect(db.select().from(epics).where(eq(epics.id, 'epic:orders')).get()?.deletedAt).toEqual(expect.any(String))
    expect(db.select().from(epics).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Returns', stableKey: 'api:doc:returns', deletedAt: null }),
    ]))
    expect(db.select().from(epicDocumentLinks).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ documentId: 'doc:returns', role: 'owner' }),
    ]))
  })
})

function assignmentForNewApi(documentId: string, stableKey: string) {
  return {
    documentId,
    documentType: 'api_spec',
    action: 'create_epic',
    role: 'owner',
    confidence: 'medium',
    reason: `${stableKey} is a separate customer capability.`,
    newEpic: {
      stableKey,
      name: stableKey[0]!.toUpperCase() + stableKey.slice(1),
      abbr: stableKey.slice(0, 3).toUpperCase(),
      summary: `${stableKey} capability.`,
    },
  }
}

function seedProject(db: DB) {
  const now = '2026-06-08T00:00:00.000Z'
  db.insert(projects).values({ id: 'p1', name: 'Project', createdAt: now, updatedAt: now }).run()
  db.insert(repositories).values({
    id: 'repo:main',
    projectId: 'p1',
    name: 'Repo',
    repoPath: '/repo',
    lastSyncedCommit: 'commit:new',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedExistingOrdersEpic(db: DB) {
  const now = '2026-06-08T00:00:00.000Z'
  db.insert(documents).values(apiDoc({
    id: 'doc:orders',
    scopeId: 'route:orders',
    status: 'passed',
    validity: 'fresh',
    title: 'POST /orders',
    summary: 'Create an order.',
  })).run()
  db.insert(epics).values({
    id: 'epic:orders',
    projectId: 'p1',
    name: 'Orders',
    abbr: 'ORD',
    description: 'Orders summary',
    stableKey: 'orders',
    summary: 'Orders summary',
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(epicDocumentLinks).values({
    epicId: 'epic:orders',
    documentId: 'doc:orders',
    documentType: 'api_spec',
    role: 'owner',
    reason: 'Orders owner.',
    confidence: 'high',
    createdAt: now,
  }).run()
}

function seedDeletedOrdersDocumentSync(db: DB) {
  db.update(documents)
    .set({ status: 'deleted', validity: 'orphaned', updatedAt: '2026-06-08T00:01:00.000Z' })
    .where(eq(documents.id, 'doc:orders'))
    .run()
  seedDocSyncPlan(db)
  db.insert(docSyncCandidates).values(candidate({
    id: 'cand:deleted',
    kind: 'orphan_document',
    scopeId: 'route:orders',
    oldHash: 'hash:old',
    newHash: null,
    decision: 'orphan',
  })).run()
}

function seedNewReturnsDocumentSync(db: DB) {
  db.insert(documents).values(apiDoc({
    id: 'doc:returns',
    scopeId: 'route:returns',
    status: 'passed',
    validity: 'fresh',
    title: 'POST /returns',
    summary: 'Create a return request.',
  })).run()
  seedDocSyncPlan(db)
  db.insert(docSyncCandidates).values(candidate({
    id: 'cand:new',
    kind: 'new_document',
    scopeId: 'route:returns',
    oldHash: null,
    newHash: 'hash:new',
  })).run()
}

function seedTwoNewDocumentsSync(db: DB) {
  db.insert(documents).values([
    apiDoc({
      id: 'doc:returns',
      scopeId: 'route:returns',
      status: 'passed',
      validity: 'fresh',
      title: 'POST /returns',
      summary: 'Create a return request.',
    }),
    apiDoc({
      id: 'doc:refunds',
      scopeId: 'route:refunds',
      status: 'passed',
      validity: 'fresh',
      title: 'POST /refunds',
      summary: 'Create a refund request.',
    }),
  ]).run()
  seedDocSyncPlan(db)
  db.insert(docSyncCandidates).values([
    candidate({
      id: 'cand:returns',
      kind: 'new_document',
      scopeId: 'route:returns',
      oldHash: null,
      newHash: 'hash:returns',
    }),
    candidate({
      id: 'cand:refunds',
      kind: 'new_document',
      scopeId: 'route:refunds',
      oldHash: null,
      newHash: 'hash:refunds',
    }),
  ]).run()
}

function seedManyNewDocumentsSync(db: DB) {
  db.insert(documents).values([
    apiDoc({
      id: 'doc:returns',
      scopeId: 'route:returns',
      status: 'passed',
      validity: 'fresh',
      title: 'POST /returns',
      summary: 'Create a return request.',
    }),
    apiDoc({
      id: 'doc:refunds',
      scopeId: 'route:refunds',
      status: 'passed',
      validity: 'fresh',
      title: 'POST /refunds',
      summary: 'Create a refund request.',
    }),
    apiDoc({
      id: 'doc:exchanges',
      scopeId: 'route:exchanges',
      status: 'passed',
      validity: 'fresh',
      title: 'POST /exchanges',
      summary: 'Create an exchange request.',
    }),
  ]).run()
  seedDocSyncPlan(db)
  db.insert(docSyncCandidates).values([
    candidate({
      id: 'cand:returns',
      kind: 'new_document',
      scopeId: 'route:returns',
      oldHash: null,
      newHash: 'hash:returns',
    }),
    candidate({
      id: 'cand:refunds',
      kind: 'new_document',
      scopeId: 'route:refunds',
      oldHash: null,
      newHash: 'hash:refunds',
    }),
    candidate({
      id: 'cand:exchanges',
      kind: 'new_document',
      scopeId: 'route:exchanges',
      oldHash: null,
      newHash: 'hash:exchanges',
    }),
  ]).run()
}

function seedDeletedOrdersAndNewReturnsSync(db: DB) {
  db.update(documents)
    .set({ status: 'deleted', validity: 'orphaned', updatedAt: '2026-06-08T00:01:00.000Z' })
    .where(eq(documents.id, 'doc:orders'))
    .run()
  db.insert(documents).values(apiDoc({
    id: 'doc:returns',
    scopeId: 'route:returns',
    status: 'passed',
    validity: 'fresh',
    title: 'POST /returns',
    summary: 'Create a return request.',
  })).run()
  seedDocSyncPlan(db)
  db.insert(docSyncCandidates).values([
    candidate({
      id: 'cand:deleted',
      kind: 'orphan_document',
      scopeId: 'route:orders',
      oldHash: 'hash:orders',
      newHash: null,
      decision: 'orphan',
    }),
    candidate({
      id: 'cand:new',
      kind: 'new_document',
      scopeId: 'route:returns',
      oldHash: null,
      newHash: 'hash:returns',
    }),
  ]).run()
}

function seedDocSyncPlan(db: DB) {
  db.insert(docSyncPlans).values({
    id: 'plan:sync',
    projectId: 'p1',
    toSnapshotId: 'snap:new',
    status: 'applied',
  }).run()
}

function apiDoc(input: {
  id: string
  scopeId: string
  status: string
  validity: string
  title: string
  summary: string
}) {
  return {
    id: input.id,
    projectId: 'p1',
    type: 'api_spec',
    track: 'technical',
    scope: 'route',
    scopeId: input.scopeId,
    status: input.status,
    validity: input.validity,
    summary: input.summary,
    content: {
      title: input.title,
      summary: input.summary,
      identity: { method: 'POST', path: input.scopeId.replace('route:', '/') },
      relation_evidence_checked: true,
    },
    rawLlmOutput: '{}',
  }
}

function candidate(input: {
  id: string
  kind: 'new_document' | 'stale' | 'stale_candidate' | 'orphan_document'
  scopeId: string
  oldHash: string | null
  newHash: string | null
  decision?: 'fresh' | 'orphan' | 'skip'
}) {
  return {
    id: input.id,
    planId: 'plan:sync',
    phase: 'technical',
    kind: input.kind,
    status: input.decision ? 'resolved' : 'staged',
    targetJson: { track: 'technical', type: 'api_spec', scope: 'route', scopeId: input.scopeId },
    oldHash: input.oldHash,
    newHash: input.newHash,
    reasonInputsJson: {},
    decision: input.decision ?? null,
  }
}
