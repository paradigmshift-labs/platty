import { describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createTestDb } from '../../server/helpers.js'
import { documents, generationEvents, generationRuns, generationTasks } from '@/db/schema/build_docs.js'
import { buildEpicsDrafts, epicDocumentLinks } from '@/db/schema/build_epics.js'
import { projectPhaseStatus, projects, repositories } from '@/db/schema/core.js'
import { BuildEpicsCliRuntime } from '@/pipeline_modules/build_epics_cli_runtime/runtime.js'

describe('build_epics CLI runtime storage', () => {
  it('stores build_epics generation tasks and editable draft snapshots', () => {
    const db = createTestDb()
    const now = new Date().toISOString()
    db.insert(projects).values({ id: 'project:test', name: 'Project', createdAt: now, updatedAt: now }).run()
    db.insert(repositories).values({ id: 'repo:test', projectId: 'project:test', name: 'Repo', repoPath: '/repo', createdAt: now, updatedAt: now }).run()

    db.insert(generationRuns).values({
      id: 'gen:epics:test',
      projectId: 'project:test',
      stage: 'build_epics',
      status: 'running',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
      sourceCommit: 'commit:test',
      maxConcurrentTasks: 1,
      createdAt: now,
      updatedAt: now,
    }).run()

    db.insert(generationTasks).values({
      id: 'task:taxonomy:1',
      runId: 'gen:epics:test',
      projectId: 'project:test',
      repositoryId: 'repo:test',
      documentType: 'taxonomy_candidate',
      targetKey: 'taxonomy:chunk:1',
      targetDocumentId: 'taxonomy:chunk:1',
      primaryEntryPointId: 'taxonomy:chunk:1',
      targetJson: { task_type: 'taxonomy_candidate', document_ids: ['doc:api:1'] },
      status: 'completed',
      retryCount: 0,
      maxRetries: 1,
      createdAt: now,
      updatedAt: now,
    }).run()

    db.insert(buildEpicsDrafts).values({
      id: 'draft:gen:epics:test',
      runId: 'gen:epics:test',
      projectId: 'project:test',
      status: 'ready',
      draftJson: {
        projectId: 'project:test',
        domains: [],
        epics: [],
        reviewBuckets: {
          unassignedApiDocIds: [],
          unassignedScreenDocIds: [],
          unassignedEventDocIds: [],
          unassignedScheduleDocIds: [],
          orphanEventDocIds: [],
          orphanScheduleDocIds: [],
          unresolvedScreenApiCalls: [],
        },
        coverage: { assignedApiDocs: 0, totalApiDocs: 0 },
        validationIssues: [],
        judgeResults: [],
      },
      validationJson: { fatal: [], warnings: [] },
      createdAt: now,
      updatedAt: now,
    }).run()

    expect(db.select().from(generationTasks).where(eq(generationTasks.id, 'task:taxonomy:1')).get()?.documentType).toBe('taxonomy_candidate')
    expect(db.select().from(buildEpicsDrafts).where(eq(buildEpicsDrafts.id, 'draft:gen:epics:test')).get()?.status).toBe('ready')
  })
})

describe('build_epics CLI runtime fake-worker flow', () => {
  it('creates an editable draft without persisting final EPIC rows', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })

    const preview = await runtime.preview({ projectId: 'project:test', outputLanguage: 'ko' })
    expect(preview.documentCounts.api_spec).toBe(4)
    expect(preview.blockers).toEqual([])

    const started = await runtime.start({
      projectId: 'project:test',
      policy: preview.recommendedPolicy,
      requestedBy: 'user:test',
    })
    expect(started.status).toBe('running')

    const initialBatch = await runtime.leaseTasks({ runId: started.runId, limit: 10, workerId: 'worker:batch' })
    expect(initialBatch.leasedTasks.map((task) => task.taskType)).toEqual(['taxonomy_candidate'])
    const taxonomyTask = initialBatch.leasedTasks[0]!
    const taxonomyContext = await runtime.getContext({ taskId: taxonomyTask.taskId, leaseToken: taxonomyTask.leaseToken })
    const taxonomySubmit = await runtime.submitTask({
      taskId: taxonomyTask.taskId,
      leaseToken: taxonomyTask.leaseToken,
      result: fakeWorkerResult(taxonomyContext.content.taskType, taxonomyContext.content.cards, taxonomyContext.content.epics),
    })
    expect(taxonomySubmit.status).toBe('completed')

    for (;;) {
      const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:fake' })
      if (lease.leasedTasks.length === 0) break
      const task = lease.leasedTasks[0]!
      const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
      const result = fakeWorkerResult(context.content.taskType, context.content.cards, context.content.epics)
      const submit = await runtime.submitTask({ taskId: task.taskId, leaseToken: task.leaseToken, result })
      expect(submit.status).toBe('completed')
    }

    const status = await runtime.status({ runId: started.runId })
    expect(status.runStatus).toBe('completed')
    expect(status.draftStatus).toBe('ready')

    const draft = await runtime.showDraft({ runId: started.runId })
    expect(draft?.plan).toMatchObject({
      projectId: 'project:test',
      coverage: { assignedApiDocs: 4, totalApiDocs: 4 },
    })
    expect((draft?.plan as { epics?: unknown[] } | undefined)?.epics?.length).toBeGreaterThan(0)
    expect(db.select().from(buildEpicsDrafts).all()).toHaveLength(1)
    expect(db.select().from(generationTasks).where(eq(generationTasks.runId, started.runId)).all().every((task) => task.status === 'completed')).toBe(true)
  })

  it('rejects direct start when build_docs has failed rows', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    db.insert(documents).values({
      ...buildDocsRow('api:failed', 'GET /failed', 'Failed API.'),
      id: 'api:failed',
      status: 'failed',
    }).run()
    const runtime = new BuildEpicsCliRuntime({ db })

    await expect(runtime.start({ projectId: 'project:test', requestedBy: 'user:test' })).rejects.toMatchObject({ code: 'DOCS_INCOMPLETE' })
  })

  it('rejects build_docs run ids from build_epics runtime methods', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const now = new Date().toISOString()
    db.insert(generationRuns).values({
      id: 'gen:build-docs:test',
      projectId: 'project:test',
      stage: 'build_docs',
      status: 'running',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
      sourceCommit: 'commit:test',
      maxConcurrentTasks: 1,
      createdAt: now,
      updatedAt: now,
    }).run()
    db.insert(generationTasks).values({
      id: 'task:build-docs:test',
      runId: 'gen:build-docs:test',
      projectId: 'project:test',
      repositoryId: 'repo:test',
      documentType: 'api_spec',
      targetKey: 'api:GET:/orders',
      targetDocumentId: 'doc:api:orders',
      primaryEntryPointId: 'ep:api:orders',
      targetJson: {},
      status: 'leased',
      leaseToken: 'lease:build-docs',
      leasedBy: 'worker:docs',
      leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      retryCount: 0,
      maxRetries: 1,
      createdAt: now,
      updatedAt: now,
    }).run()
    const runtime = new BuildEpicsCliRuntime({ db })

    await expect(runtime.leaseTasks({ runId: 'gen:build-docs:test', limit: 1, workerId: 'worker:epics' })).rejects.toThrow('BUILD_EPICS_RUN_STAGE_MISMATCH')
    await expect(runtime.cancel({ runId: 'gen:build-docs:test' })).rejects.toThrow('BUILD_EPICS_RUN_STAGE_MISMATCH')
    expect(db.select().from(generationTasks).where(eq(generationTasks.id, 'task:build-docs:test')).get()).toMatchObject({
      status: 'leased',
      leaseToken: 'lease:build-docs',
      leasedBy: 'worker:docs',
    })
    expect(db.select().from(generationEvents).where(eq(generationEvents.runId, 'gen:build-docs:test')).all()).toEqual([])
  })

  it('fails pending assignment tasks when taxonomy generation exhausts retries', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({ projectId: 'project:test', requestedBy: 'user:test', policy: { maxRepairPasses: 0 } })
    const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:bad-taxonomy' })
    const task = lease.leasedTasks[0]!

    const submit = await runtime.submitTask({ taskId: task.taskId, leaseToken: task.leaseToken, result: { domains: [] } })
    expect(submit.status).toBe('failed')

    const tasks = db.select().from(generationTasks).where(eq(generationTasks.runId, started.runId)).all()
    expect(tasks.filter((row) => row.documentType === 'taxonomy_consolidation').every((row) => row.status === 'failed')).toBe(true)
    expect(tasks.filter((row) => row.documentType === 'document_assignment').every((row) => row.status === 'failed')).toBe(true)
    const status = await runtime.status({ runId: started.runId })
    expect(status.runStatus).toBe('failed')
    expect(status.draftStatus).toBe('invalid')
  })

  it('does not lease assignments when consolidation task is missing', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({ projectId: 'project:test', requestedBy: 'user:test' })
    const firstLease = await runtime.leaseTasks({ runId: started.runId, limit: 20, workerId: 'worker:test' })

    for (const task of firstLease.leasedTasks) {
      await runtime.submitTask({
        taskId: task.taskId,
        leaseToken: task.leaseToken,
        result: fakeTaxonomyResult(),
      })
    }
    db.delete(generationTasks)
      .where(and(eq(generationTasks.runId, started.runId), eq(generationTasks.documentType, 'taxonomy_consolidation')))
      .run()

    const lease = await runtime.leaseTasks({ runId: started.runId, limit: 20, workerId: 'worker:test' })
    expect(lease.leasedTasks).toEqual([])
  })

  it('rejects task access when the lease expires exactly now', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({ projectId: 'project:test', requestedBy: 'user:test' })
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

  it('leases taxonomy consolidation before assignment and cross-domain work', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({ projectId: 'project:test', requestedBy: 'user:test' })
    const now = new Date().toISOString()
    db.insert(generationTasks).values({
      id: 'task:cross:ordering',
      runId: started.runId,
      projectId: 'project:test',
      repositoryId: 'repo:test',
      documentType: 'cross_domain_link',
      targetKey: 'cross:ordering',
      targetDocumentId: 'cross:ordering',
      primaryEntryPointId: 'cross:ordering',
      targetJson: { task_type: 'cross_domain_link', cards: [] },
      status: 'pending',
      retryCount: 0,
      maxRetries: 1,
      createdAt: now,
      updatedAt: now,
    }).run()

    const firstLease = await runtime.leaseTasks({ runId: started.runId, limit: 20, workerId: 'worker:test' })
    expect(new Set(firstLease.leasedTasks.map((task) => task.taskType))).toEqual(new Set(['taxonomy_candidate']))

    for (const task of firstLease.leasedTasks) {
      await runtime.submitTask({
        taskId: task.taskId,
        leaseToken: task.leaseToken,
        result: fakeTaxonomyResult(),
      })
    }

    const secondLease = await runtime.leaseTasks({ runId: started.runId, limit: 20, workerId: 'worker:test' })
    expect(secondLease.leasedTasks).toHaveLength(1)
    const consolidationTask = secondLease.leasedTasks[0]!
    expect(consolidationTask.taskType).toBe('taxonomy_consolidation')

    const beforeConsolidationSubmit = await runtime.leaseTasks({ runId: started.runId, limit: 20, workerId: 'worker:test' })
    expect(beforeConsolidationSubmit.leasedTasks).toEqual([])

    const consolidationSubmit = await runtime.submitTask({
      taskId: consolidationTask.taskId,
      leaseToken: consolidationTask.leaseToken,
      result: fakeWorkerResult('taxonomy_consolidation', []),
    })
    expect(consolidationSubmit.status).toBe('completed')

    const assignmentLease = await runtime.leaseTasks({ runId: started.runId, limit: 20, workerId: 'worker:test' })
    expect(new Set(assignmentLease.leasedTasks.map((task) => task.taskType))).toEqual(new Set(['document_assignment']))

    const beforeAssignmentSubmit = await runtime.leaseTasks({ runId: started.runId, limit: 20, workerId: 'worker:test' })
    expect(beforeAssignmentSubmit.leasedTasks).toEqual([])

    for (const task of assignmentLease.leasedTasks) {
      const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
      const submit = await runtime.submitTask({
        taskId: task.taskId,
        leaseToken: task.leaseToken,
        result: fakeWorkerResult(context.content.taskType, context.content.cards, context.content.epics),
      })
      expect(submit.status).toBe('completed')
    }

    const crossDomainLease = await runtime.leaseTasks({ runId: started.runId, limit: 20, workerId: 'worker:test' })
    expect(new Set(crossDomainLease.leasedTasks.map((task) => task.taskType))).toEqual(new Set(['cross_domain_link']))
  })

  it('returns taxonomy consolidation context with candidate taxonomy submissions and repair metadata', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({ projectId: 'project:test', requestedBy: 'user:test' })
    const taxonomyLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:taxonomy' })
    const taxonomyTask = taxonomyLease.leasedTasks[0]!

    await runtime.submitTask({
      taskId: taxonomyTask.taskId,
      leaseToken: taxonomyTask.leaseToken,
      result: fakeRawTaxonomyResult(),
    })

    const consolidationLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:consolidation' })
    const consolidationTask = consolidationLease.leasedTasks[0]!
    const context = await runtime.getContext({ taskId: consolidationTask.taskId, leaseToken: consolidationTask.leaseToken })

    expect(context.content).toMatchObject({
      taskType: 'taxonomy_consolidation',
      cards: expect.any(Array),
      repair: {
        retryCount: 0,
        maxRetries: expect.any(Number),
        validationErrors: [],
      },
    })
    expect(context.content.taxonomyCandidates).toEqual([
      expect.objectContaining({
        epics: expect.arrayContaining([
          expect.objectContaining({ stableKey: 'orders_raw' }),
          expect.objectContaining({ stableKey: 'users_raw' }),
        ]),
      }),
    ])
    expect(context.content.instruction).toContain('Merge duplicate or overlapping candidate EPICs into one MECE taxonomy')
    expect(context.content.instruction).toContain('Do not assign documents')
  })

  it('accepts raw taxonomy alias sources in consolidation output and uses consolidated keys for assignments', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({ projectId: 'project:test', requestedBy: 'user:test' })
    const taxonomyLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:taxonomy' })
    const taxonomyTask = taxonomyLease.leasedTasks[0]!

    await runtime.submitTask({
      taskId: taxonomyTask.taskId,
      leaseToken: taxonomyTask.leaseToken,
      result: fakeRawTaxonomyResult(),
    })

    const consolidationLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:consolidation' })
    const consolidationTask = consolidationLease.leasedTasks[0]!
    const consolidationSubmit = await runtime.submitTask({
      taskId: consolidationTask.taskId,
      leaseToken: consolidationTask.leaseToken,
      result: fakeConsolidatedTaxonomyResultWithRawAliases(),
    })
    expect(consolidationSubmit.status).toBe('completed')

    const assignmentLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:assignment' })
    const assignmentTask = assignmentLease.leasedTasks[0]!
    const context = await runtime.getContext({ taskId: assignmentTask.taskId, leaseToken: assignmentTask.leaseToken })

    expect(context.content.epics.map((epic: { stableKey: string }) => epic.stableKey).sort()).toEqual(['orders', 'users'])

    const submit = await runtime.submitTask({
      taskId: assignmentTask.taskId,
      leaseToken: assignmentTask.leaseToken,
      result: {
        assignments: context.content.cards.map((card: { documentId: string; title: string }) => ({
          documentId: card.documentId,
          epicKey: card.documentId.includes('orders') ? 'orders' : 'users',
          role: 'owner',
          confidence: 'high',
          reason: `Assigned ${card.title}.`,
        })),
      },
    })

    expect(submit.status).toBe('completed')
  })

  it('requests repair when assignment targets an unknown EPIC key', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({ projectId: 'project:test', requestedBy: 'user:test', policy: { maxRepairPasses: 1 } })

    await completeFirstTaxonomyTask(runtime, started.runId)
    const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:bad-assignment' })
    const task = lease.leasedTasks[0]!
    const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
    const apiCard = context.content.cards.find((card: { type: string }) => card.type === 'api_spec')!

    const submit = await runtime.submitTask({
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      result: {
        assignments: [{
          documentId: apiCard.documentId,
          epicKey: 'invented_epic',
          role: 'owner',
          confidence: 'high',
          reason: 'bad key',
        }],
      },
    })

    expect(submit.status).toBe('repair_requested')
    expect(submit.validationErrors).toContainEqual(expect.objectContaining({
      code: 'UNKNOWN_ASSIGNMENT_EPIC',
      documentId: apiCard.documentId,
    }))
  })

  it('returns previous validation errors in repair context', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({ projectId: 'project:test', requestedBy: 'user:test', policy: { maxRepairPasses: 1 } })

    await completeFirstTaxonomyTask(runtime, started.runId)
    const firstLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:first' })
    const firstTask = firstLease.leasedTasks[0]!
    await runtime.submitTask({
      taskId: firstTask.taskId,
      leaseToken: firstTask.leaseToken,
      result: { assignments: [] },
    })

    const repairLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:repair' })
    const repairTask = repairLease.leasedTasks[0]!
    const context = await runtime.getContext({ taskId: repairTask.taskId, leaseToken: repairTask.leaseToken })

    expect(context.content.repair).toMatchObject({
      retryCount: 1,
      maxRetries: 1,
    })
    expect(context.content.repair.validationErrors).toContainEqual(expect.objectContaining({
      code: 'MISSING_API_ASSIGNMENT',
    }))
  })

  it('requests repair when an API card is missing an owner assignment', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({ projectId: 'project:test', requestedBy: 'user:test', policy: { maxRepairPasses: 1 } })

    await completeFirstTaxonomyTask(runtime, started.runId)
    const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:missing-api' })
    const task = lease.leasedTasks[0]!

    const submit = await runtime.submitTask({
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      result: { assignments: [] },
    })

    expect(submit.status).toBe('repair_requested')
    expect(submit.validationErrors.map((error) => error.code)).toContain('MISSING_API_ASSIGNMENT')
  })

  it('processes cross-domain tasks after assignments and stores draft links', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({ projectId: 'project:test', requestedBy: 'user:test', policy: { crossDomainChunkSize: 100 } })

    for (;;) {
      const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:cross' })
      if (lease.leasedTasks.length === 0) break
      const task = lease.leasedTasks[0]!
      const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
      const result = context.content.taskType === 'cross_domain_link'
        ? {
            links: [{
              sourceDocumentId: context.content.cards.find((card: { documentId: string }) => card.documentId.includes('orders'))!.documentId,
              targetTempEpicId: context.content.epics.find((epic: { stableKey: string }) => epic.stableKey === 'users')!.tempEpicId,
              kind: 'shared_user_journey',
              role: 'reference',
              confidence: 'medium',
              reason: 'Orders and users share account journey context.',
            }],
          }
        : fakeWorkerResult(context.content.taskType, context.content.cards, context.content.epics)
      const submit = await runtime.submitTask({ taskId: task.taskId, leaseToken: task.leaseToken, result })
      expect(submit.status).toBe('completed')
    }

    const status = await runtime.status({ runId: started.runId })
    expect(status.runStatus).toBe('completed')
    expect(status.taskCountsByStatus.completed).toBeGreaterThan(2)

    const draft = await runtime.showDraft({ runId: started.runId })
    const ownerWithCrossLink = (draft?.plan.epics ?? []).find((epic) => epic.crossLinks.length > 0)
    expect(ownerWithCrossLink?.dependencies).toEqual([expect.objectContaining({ kind: 'cross_screen' })])
  })

  it('requests repair when cross-domain output links a document to its owner EPIC', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({ projectId: 'project:test', requestedBy: 'user:test', policy: { maxRepairPasses: 1 } })

    const task = await completeTaxonomyAndAssignments(runtime, started.runId)
    if (!task) throw new Error('Expected cross-domain task')
    const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
    const source = context.content.cards.find((card: { documentId: string }) => card.documentId.includes('orders'))!

    const submit = await runtime.submitTask({
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      result: {
        links: [{
          sourceDocumentId: source.documentId,
          targetTempEpicId: context.content.owners[source.documentId],
          kind: 'shared_user_journey',
          role: 'impact',
          confidence: 'medium',
          reason: 'Self link should be repaired.',
        }],
      },
    })

    expect(submit.status).toBe('repair_requested')
    expect(submit.validationErrors).toContainEqual(expect.objectContaining({ code: 'SELF_CROSS_LINK' }))
  })

  it('uses runtime policy when validating per-document cross-domain link capacity', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({
      projectId: 'project:test',
      requestedBy: 'user:test',
      policy: { maxCrossLinksPerDocument: 4 },
    })

    const taxonomyLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:wide-taxonomy' })
    const taxonomyTask = taxonomyLease.leasedTasks[0]!
    const taxonomyContext = await runtime.getContext({ taskId: taxonomyTask.taskId, leaseToken: taxonomyTask.leaseToken })
    expect(await runtime.submitTask({
      taskId: taxonomyTask.taskId,
      leaseToken: taxonomyTask.leaseToken,
      result: wideTaxonomyResult(),
    })).toMatchObject({ status: 'completed' })

    const consolidationLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:wide-taxonomy' })
    const consolidationTask = consolidationLease.leasedTasks[0]!
    expect(taxonomyContext.content.taskType).toBe('taxonomy_candidate')
    expect(await runtime.submitTask({
      taskId: consolidationTask.taskId,
      leaseToken: consolidationTask.leaseToken,
      result: wideTaxonomyResult(),
    })).toMatchObject({ status: 'completed' })

    const assignmentLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:wide-assignment' })
    const assignmentTask = assignmentLease.leasedTasks[0]!
    const assignmentContext = await runtime.getContext({ taskId: assignmentTask.taskId, leaseToken: assignmentTask.leaseToken })
    expect(await runtime.submitTask({
      taskId: assignmentTask.taskId,
      leaseToken: assignmentTask.leaseToken,
      result: {
        assignments: assignmentContext.content.cards.map((card: { documentId: string; title: string }) => ({
          documentId: card.documentId,
          epicKey: 'orders',
          role: 'owner',
          confidence: 'high',
          reason: `Assigned ${card.title} to Orders.`,
        })),
      },
    })).toMatchObject({ status: 'completed' })

    const crossLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:wide-cross' })
    const crossTask = crossLease.leasedTasks[0]!
    const crossContext = await runtime.getContext({ taskId: crossTask.taskId, leaseToken: crossTask.leaseToken })
    const sourceDocumentId = crossContext.content.cards[0].documentId
    const targetEpicIds = crossContext.content.epics
      .filter((epic: { stableKey: string }) => epic.stableKey !== 'orders')
      .slice(0, 4)
      .map((epic: { tempEpicId: string }) => epic.tempEpicId)

    const submit = await runtime.submitTask({
      taskId: crossTask.taskId,
      leaseToken: crossTask.leaseToken,
      result: {
        links: targetEpicIds.map((targetTempEpicId: string) => ({
          sourceDocumentId,
          targetTempEpicId,
          kind: 'operational_dependency',
          role: 'supporting',
          confidence: 'medium',
          reason: 'Order flow can affect adjacent operational EPICs.',
        })),
      },
    })

    expect(submit.status).toBe('completed')
  })

  it('uses the approved runtime policy when refreshing draft validation', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({
      projectId: 'project:test',
      requestedBy: 'user:test',
      policy: { maxReviewRatioWarning: 0.2, maxReviewRatioFatal: 0.8 },
    })

    for (;;) {
      const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:policy' })
      if (lease.leasedTasks.length === 0) break
      const task = lease.leasedTasks[0]!
      const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
      const result = context.content.taskType === 'document_assignment'
        ? {
            assignments: context.content.cards.map((card: { documentId: string; title: string }, index: number) => ({
              documentId: card.documentId,
              epicKey: card.documentId.includes('orders') ? 'orders' : 'users',
              role: 'owner',
              confidence: index === 0 ? 'high' : 'medium',
              reason: `Assigned ${card.title}.`,
            })),
          }
        : fakeWorkerResult(context.content.taskType, context.content.cards, context.content.epics)
      const submit = await runtime.submitTask({ taskId: task.taskId, leaseToken: task.leaseToken, result })
      expect(submit.status).toBe('completed')
    }

    const draft = await runtime.showDraft({ runId: started.runId })
    const validationCodes = ((draft?.validation as { fatal?: Array<{ code: string }>; warnings?: Array<{ code: string }> } | undefined)?.fatal ?? []).map((issue) => issue.code)
    const warningCodes = ((draft?.validation as { fatal?: Array<{ code: string }>; warnings?: Array<{ code: string }> } | undefined)?.warnings ?? []).map((issue) => issue.code)
    const planIssueCodes = ((draft?.plan as { validationIssues?: Array<{ code: string }> } | undefined)?.validationIssues ?? []).map((issue) => issue.code)

    expect(validationCodes).not.toContain('REVIEW_RATIO_FATAL')
    expect(warningCodes).not.toContain('REVIEW_RATIO_WARNING')
    expect(planIssueCodes).not.toContain('REVIEW_RATIO_FATAL')
  })

  it('edits a ready draft through typed commands and rejects stale versions', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await completeFakeWorkerRun(runtime)

    const edited = await runtime.editDraft({
      runId: started.runId,
      expectedVersion: 1,
      commands: [{
        type: 'rename_epic',
        epicId: 'epic:orders',
        name: 'Order Management',
        reason: 'User requested clearer naming.',
      }],
      requestedBy: 'user:test',
    })

    expect(edited.previousVersion).toBe(1)
    expect(edited.nextVersion).toBe(2)
    expect(edited.validation.fatal).toEqual([])
    expect((await runtime.showDraft({ runId: started.runId }))?.plan).toMatchObject({
      version: 2,
      epics: expect.arrayContaining([expect.objectContaining({ tempEpicId: 'epic:orders', name: 'Order Management' })]),
    })
    expect(await runtime.status({ runId: started.runId })).toMatchObject({ draftStatus: 'ready' })
    expect(await runtime.validate({ runId: started.runId })).toMatchObject({ fatal: [] })
    expect((await runtime.showDraft({ runId: started.runId }))?.plan).toMatchObject({
      version: 2,
      epics: expect.arrayContaining([expect.objectContaining({ tempEpicId: 'epic:orders', name: 'Order Management' })]),
    })

    await expect(runtime.editDraft({
      runId: started.runId,
      expectedVersion: 1,
      commands: [],
      requestedBy: 'user:test',
    })).rejects.toThrow('DRAFT_VERSION_CONFLICT')
  })

  it('persists runtime fatal validation issues after editing an invalid draft', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await completeFakeWorkerRun(runtime)
    const draft = await runtime.showDraft({ runId: started.runId })

    db.update(buildEpicsDrafts)
      .set({
        draftJson: {
          ...draft!.plan,
          reviewBuckets: {
            ...draft!.plan.reviewBuckets,
            unassignedApiDocIds: ['api:orders:list'],
          },
          validationIssues: [],
        },
      })
      .where(eq(buildEpicsDrafts.runId, started.runId))
      .run()

    const edited = await runtime.editDraft({
      runId: started.runId,
      expectedVersion: 1,
      commands: [{
        type: 'rename_epic',
        epicId: 'epic:orders',
        name: 'Order Management',
        reason: 'User requested clearer naming.',
      }],
      requestedBy: 'user:test',
    })
    const shown = await runtime.showDraft({ runId: started.runId })

    expect(edited.draftStatus).toBe('invalid')
    expect(edited.validation.fatal.map((issue) => issue.code)).toContain('MISSING_API_OWNER')
    expect(shown?.plan.validationIssues).toEqual(edited.validation.fatal)
  })

  it('confirms a ready draft through existing EPIC persistence and document links', async () => {
    const db = createTestDb()
    seedRuntimeProject(db, { includeLinkedDocs: true })
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await completeFakeWorkerRun(runtime)
    const draft = await runtime.showDraft({ runId: started.runId })
    const draftLinks = (draft!.plan.epics ?? []).flatMap((epic) => [
      ...epic.apiLinks.map((link) => link.apiDocId),
      ...epic.screenLinks.map((link) => link.screenDocId),
      ...epic.eventLinks.map((link) => link.eventDocId),
      ...epic.scheduleLinks.map((link) => link.scheduleDocId),
    ])

    const confirmed = await runtime.confirmDraft({ runId: started.runId, requestedBy: 'user:test' })
    const persistedLinks = db.select().from(epicDocumentLinks).all()
    const phase = db.select().from(projectPhaseStatus).where(eq(projectPhaseStatus.phase, 'build_epics')).get()

    expect(draftLinks).toEqual(expect.arrayContaining([
      'api:orders:list',
      'screen:orders:index',
      'event:orders:created',
      'schedule:orders:sync',
    ]))
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.persistResult.confirmedCount).toBeGreaterThan(0)
    expect(confirmed.persistResult.linkCount).toBe(draftLinks.length)
    expect(persistedLinks.map((link) => link.documentType)).toEqual(expect.arrayContaining([
      'api_spec',
      'screen_spec',
      'event_spec',
      'schedule_spec',
    ]))
    expect(persistedLinks).toHaveLength(draftLinks.length)
    expect(phase?.meta).toMatchObject({
      confirmedAt: expect.any(String),
      confirmedCount: confirmed.persistResult.confirmedCount,
      rejectedCount: confirmed.persistResult.rejectedCount,
      persistResult: confirmed.persistResult,
    })

    const confirmedAgain = await runtime.confirmDraft({ runId: started.runId, requestedBy: 'user:test' })
    const persistedLinksAfterSecondConfirm = db.select().from(epicDocumentLinks).all()

    expect(confirmedAgain.status).toBe('confirmed')
    expect(confirmedAgain.persistResult.linkCount).toBe(draftLinks.length)
    expect(persistedLinksAfterSecondConfirm).toHaveLength(draftLinks.length)
  })

  it('rejects editing a draft after it has been confirmed', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await completeFakeWorkerRun(runtime)

    await runtime.confirmDraft({ runId: started.runId, requestedBy: 'user:test' })

    await expect(runtime.editDraft({
      runId: started.runId,
      expectedVersion: 1,
      commands: [{
        type: 'rename_epic',
        epicId: 'epic:orders',
        name: 'Order Management',
        reason: 'User requested clearer naming.',
      }],
      requestedBy: 'user:test',
    })).rejects.toThrow('BUILD_EPICS_DRAFT_ALREADY_CONFIRMED')
  })

  it('materializes cross-domain tasks once when assignment submissions finish concurrently', async () => {
    const db = createTestDb()
    seedRuntimeProject(db)
    const runtime = new BuildEpicsCliRuntime({ db })
    const started = await runtime.start({
      projectId: 'project:test',
      policy: {
        taxonomyChunkSize: 100,
        assignmentChunkMinSize: 2,
        assignmentChunkMaxSize: 2,
        crossDomainChunkSize: 2,
        maxWorkerCount: 20,
      },
      requestedBy: 'user:test',
    })

    const taxonomyLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:taxonomy' })
    expect(taxonomyLease.leasedTasks.map((task) => task.taskType)).toEqual(['taxonomy_candidate'])
    const taxonomyTask = taxonomyLease.leasedTasks[0]!
    const taxonomyContext = await runtime.getContext({ taskId: taxonomyTask.taskId, leaseToken: taxonomyTask.leaseToken })
    const taxonomySubmit = await runtime.submitTask({
      taskId: taxonomyTask.taskId,
      leaseToken: taxonomyTask.leaseToken,
      result: fakeWorkerResult(taxonomyContext.content.taskType, taxonomyContext.content.cards, taxonomyContext.content.epics),
    })
    expect(taxonomySubmit.status).toBe('completed')

    const consolidationLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:taxonomy' })
    expect(consolidationLease.leasedTasks.map((task) => task.taskType)).toEqual(['taxonomy_consolidation'])
    const consolidationTask = consolidationLease.leasedTasks[0]!
    const consolidationContext = await runtime.getContext({ taskId: consolidationTask.taskId, leaseToken: consolidationTask.leaseToken })
    const consolidationSubmit = await runtime.submitTask({
      taskId: consolidationTask.taskId,
      leaseToken: consolidationTask.leaseToken,
      result: fakeWorkerResult(consolidationContext.content.taskType, consolidationContext.content.cards, consolidationContext.content.epics),
    })
    expect(consolidationSubmit.status).toBe('completed')

    const assignmentLease = await runtime.leaseTasks({ runId: started.runId, limit: 2, workerId: 'worker:assignment' })
    expect(assignmentLease.leasedTasks.map((task) => task.taskType)).toEqual(['document_assignment', 'document_assignment'])
    const prepared = await Promise.all(assignmentLease.leasedTasks.map(async (task) => {
      const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
      return {
        task,
        result: fakeWorkerResult(context.content.taskType, context.content.cards, context.content.epics),
      }
    }))

    await expect(Promise.all(prepared.map(({ task, result }) =>
      runtime.submitTask({ taskId: task.taskId, leaseToken: task.leaseToken, result }),
    ))).resolves.toEqual([
      { status: 'completed', validationErrors: [] },
      { status: 'completed', validationErrors: [] },
    ])

    const status = await runtime.status({ runId: started.runId })
    expect(status.taskCountsByStatus.pending).toBeGreaterThan(0)
  })
})

async function completeFakeWorkerRun(runtime: BuildEpicsCliRuntime) {
  const preview = await runtime.preview({ projectId: 'project:test', outputLanguage: 'ko' })
  const started = await runtime.start({
    projectId: 'project:test',
    policy: preview.recommendedPolicy,
    requestedBy: 'user:test',
  })

  for (;;) {
    const lease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:fake' })
    if (lease.leasedTasks.length === 0) break
    const task = lease.leasedTasks[0]!
    const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
    const result = fakeWorkerResult(context.content.taskType, context.content.cards, context.content.epics)
    const submit = await runtime.submitTask({ taskId: task.taskId, leaseToken: task.leaseToken, result })
    expect(submit.status).toBe('completed')
  }

  expect(await runtime.status({ runId: started.runId })).toMatchObject({
    runStatus: 'completed',
    draftStatus: 'ready',
  })
  return started
}

async function completeFirstTaxonomyTask(runtime: BuildEpicsCliRuntime, runId: string): Promise<void> {
  const lease = await runtime.leaseTasks({ runId, limit: 1, workerId: 'worker:taxonomy' })
  const task = lease.leasedTasks[0]!
  const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
  const submit = await runtime.submitTask({
    taskId: task.taskId,
    leaseToken: task.leaseToken,
    result: fakeWorkerResult(context.content.taskType, context.content.cards, context.content.epics),
  })
  expect(submit.status).toBe('completed')

  const consolidationLease = await runtime.leaseTasks({ runId, limit: 1, workerId: 'worker:taxonomy' })
  const consolidationTask = consolidationLease.leasedTasks[0]
  if (consolidationTask?.taskType !== 'taxonomy_consolidation') return
  const consolidationContext = await runtime.getContext({ taskId: consolidationTask.taskId, leaseToken: consolidationTask.leaseToken })
  const consolidationSubmit = await runtime.submitTask({
    taskId: consolidationTask.taskId,
    leaseToken: consolidationTask.leaseToken,
    result: fakeWorkerResult(consolidationContext.content.taskType, consolidationContext.content.cards, consolidationContext.content.epics),
  })
  expect(consolidationSubmit.status).toBe('completed')
}

async function completeTaxonomyAndAssignments(runtime: BuildEpicsCliRuntime, runId: string): Promise<{ taskId: string; leaseToken: string } | null> {
  for (;;) {
    const lease = await runtime.leaseTasks({ runId, limit: 1, workerId: 'worker:setup' })
    if (lease.leasedTasks.length === 0) break
    const task = lease.leasedTasks[0]!
    const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
    if (context.content.taskType === 'cross_domain_link') return task
    const submit = await runtime.submitTask({
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      result: fakeWorkerResult(context.content.taskType, context.content.cards, context.content.epics),
    })
    expect(submit.status).toBe('completed')
  }
  return null
}

function seedRuntimeProject(db: ReturnType<typeof createTestDb>, options: { includeLinkedDocs?: boolean } = {}): void {
  const now = new Date().toISOString()
  db.insert(projects).values({ id: 'project:test', name: 'Runtime Project', createdAt: now, updatedAt: now }).run()
  db.insert(repositories).values({ id: 'repo:test', projectId: 'project:test', name: 'repo', repoPath: '/repo', createdAt: now, updatedAt: now }).run()
  db.insert(documents).values([
    buildDocsRow('api:orders:list', 'GET /orders', 'List orders.'),
    buildDocsRow('api:orders:create', 'POST /orders', 'Create orders.'),
    buildDocsRow('api:users:list', 'GET /users', 'List users.'),
    buildDocsRow('api:users:create', 'POST /users', 'Create users.'),
    ...(options.includeLinkedDocs
      ? [
          buildDocsRow('screen:orders:index', 'Orders screen', 'Browse orders.', 'screen_spec'),
          buildDocsRow('event:orders:created', 'OrderCreated', 'Order created event.', 'event_spec'),
          buildDocsRow('schedule:orders:sync', 'ordersSync', 'Sync orders on a schedule.', 'schedule_spec'),
        ]
      : []),
  ]).run()
}

function buildDocsRow(id: string, title: string, summary: string, type = 'api_spec') {
  const [method, path] = title.split(' ')
  return {
    id,
    projectId: 'project:test',
    type,
    track: 'technical',
    scope: type === 'api_spec' ? 'endpoint' : type,
    scopeId: id,
    status: 'passed',
    validity: 'fresh',
    summary,
    content: {
      title,
      summary,
      method,
      path,
      handler: `${id.replaceAll(':', '_')}Handler`,
      business_logic: [summary],
    },
    rawLlmOutput: '{}',
    sourceRunId: 'run:docs',
    sourceCommit: 'commit:test',
  }
}

function fakeWorkerResult(
  taskType: string,
  cards: Array<{ documentId: string; title: string }>,
  epics: Array<{ stableKey: string; tempEpicId?: string }> = [],
) {
  if (taskType === 'taxonomy_candidate') {
    return fakeTaxonomyResult()
  }
  if (taskType === 'taxonomy_consolidation') {
    return fakeConsolidatedTaxonomyResult()
  }
  if (taskType === 'cross_domain_link') {
    const source = cards.find((card) => card.documentId.includes('orders'))
    const target = epics.find((epic) => epic.stableKey === 'users')
    return source && target?.tempEpicId
      ? {
          links: [{
            sourceDocumentId: source.documentId,
            targetTempEpicId: target.tempEpicId,
            kind: 'shared_user_journey',
            role: 'reference',
            confidence: 'medium',
            reason: `Linked ${source.title} to ${target.stableKey}.`,
          }],
        }
      : { links: [] }
  }

  return {
    assignments: cards.map((card) => ({
      documentId: card.documentId,
      epicKey: card.documentId.includes('orders') ? 'orders' : card.documentId.includes('users') ? 'users' : epics[0]?.stableKey ?? 'users',
      role: 'owner',
      confidence: 'high',
      reason: `Assigned ${card.title}.`,
    })),
  }
}

function fakeTaxonomyResult() {
  return {
    domains: [{ domainId: 'domain:product', stableKey: 'product', name: 'Product', summary: 'Product operations.' }],
    epics: [
      { tempEpicId: 'epic:orders', domainId: 'domain:product', stableKey: 'orders', name: 'Orders', abbr: 'ORD', summary: 'Order operations.' },
      { tempEpicId: 'epic:users', domainId: 'domain:product', stableKey: 'users', name: 'Users', abbr: 'USR', summary: 'User operations.' },
    ],
  }
}

function fakeRawTaxonomyResult() {
  return {
    domains: [{ domainId: 'domain:raw-product', stableKey: 'raw_product', name: 'Raw Product', summary: 'Raw product operations.' }],
    epics: [
      { tempEpicId: 'epic:orders_raw', domainId: 'domain:raw-product', stableKey: 'orders_raw', name: 'Orders Raw', abbr: 'ORR', summary: 'Raw order operations.' },
      { tempEpicId: 'epic:users_raw', domainId: 'domain:raw-product', stableKey: 'users_raw', name: 'Users Raw', abbr: 'USR', summary: 'Raw user operations.' },
    ],
  }
}

function fakeConsolidatedTaxonomyResult() {
  return {
    domains: [{ domainId: 'domain:product', stableKey: 'product', name: 'Product', summary: 'Product operations.' }],
    epics: [
      { tempEpicId: 'epic:orders', domainId: 'domain:product', stableKey: 'orders', name: 'Orders', abbr: 'ORD', summary: 'Order operations.' },
      { tempEpicId: 'epic:users', domainId: 'domain:product', stableKey: 'users', name: 'Users', abbr: 'USR', summary: 'User operations.' },
    ],
    aliases: [],
    boundaryNotes: [],
  }
}

function wideTaxonomyResult() {
  return {
    domains: [{ domainId: 'domain:product', stableKey: 'product', name: 'Product', summary: 'Product operations.' }],
    epics: [
      { tempEpicId: 'epic:orders', domainId: 'domain:product', stableKey: 'orders', name: 'Orders', abbr: 'ORD', summary: 'Order operations.' },
      { tempEpicId: 'epic:inventory', domainId: 'domain:product', stableKey: 'inventory', name: 'Inventory', abbr: 'INV', summary: 'Inventory operations.' },
      { tempEpicId: 'epic:billing', domainId: 'domain:product', stableKey: 'billing', name: 'Billing', abbr: 'BIL', summary: 'Billing operations.' },
      { tempEpicId: 'epic:fulfillment', domainId: 'domain:product', stableKey: 'fulfillment', name: 'Fulfillment', abbr: 'FUL', summary: 'Fulfillment operations.' },
      { tempEpicId: 'epic:notifications', domainId: 'domain:product', stableKey: 'notifications', name: 'Notifications', abbr: 'NOT', summary: 'Notification operations.' },
    ],
    aliases: [],
    boundaryNotes: [],
  }
}

function fakeConsolidatedTaxonomyResultWithRawAliases() {
  return {
    ...fakeConsolidatedTaxonomyResult(),
    aliases: [
      { fromStableKey: 'orders_raw', toStableKey: 'orders', reason: 'Raw orders candidate was merged into Orders.' },
      { fromStableKey: 'users_raw', toStableKey: 'users', reason: 'Raw users candidate was merged into Users.' },
    ],
  }
}
