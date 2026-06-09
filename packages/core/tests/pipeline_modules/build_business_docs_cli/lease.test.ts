import { count, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../server/helpers.js'
import { documents } from '../../../src/db/schema/build_docs.js'
import { epicDocumentLinks } from '../../../src/db/schema/build_epics.js'
import { epics, projects } from '../../../src/db/schema/core.js'
import {
  businessDocContextBundles,
  businessDocContextPages,
  businessDocGenerationRuns,
  businessDocGenerationTasks,
} from '../../../src/db/schema/build_business_docs_generation.js'
import { startBusinessDocsGeneration } from '../../../src/pipeline_modules/build_business_docs_cli/start.js'
import {
  getBusinessDocsContextBundle,
  getBusinessDocsContextPage,
  heartbeatBusinessDocsTask,
  leaseBusinessDocsTasks,
} from '../../../src/pipeline_modules/build_business_docs_cli/lease.js'
import type {
  BusinessDocsContextBundleResult,
  BusinessDocsContextPageResult,
  BusinessDocsHeartbeatResult,
  BusinessDocsLeaseResult,
} from '../../../src/pipeline_modules/build_business_docs_cli/types.js'

const projectId = 'project:platty'
const now = '2026-06-04T00:00:00.000Z'
const later = '2026-06-04T00:10:00.000Z'

type TestDb = ReturnType<typeof createTestDb>

describe('build_business_docs_cli lease and context read', () => {
  it('rejects missing and terminal runs before leasing', () => {
    const db = createRunnableProject()
    const missing = leaseBusinessDocsTasks(db, {
      projectId,
      runId: 'run:missing',
      workerId: 'codex-1',
      now: fixedNow,
    })
    expect(missing).toMatchObject({
      ok: false,
      code: 'BUSINESS_DOCS_RUN_NOT_FOUND',
    })

    const runId = startRun(db)
    db.update(businessDocGenerationRuns)
      .set({ status: 'completed', updatedAt: now })
      .where(eq(businessDocGenerationRuns.id, runId))
      .run()

    const terminal = leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      now: fixedNow,
    })
    expect(terminal).toMatchObject({
      ok: false,
      code: 'BUSINESS_DOCS_RUN_NOT_LEASEABLE',
    })
    expect(countLeasedTasks(db)).toBe(0)
  })

  it('rejects invalid lease limits', () => {
    const db = createRunnableProject()
    const runId = startRun(db)

    expect(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      limit: 0,
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_INVALID_LIMIT' })

    expect(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      limit: 99,
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_INVALID_LIMIT' })
  })

  it('leases ready source-first tasks in deterministic order and stores lease fields', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const result = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      limit: 2,
      leaseTtlMs: 15 * 60 * 1000,
      now: fixedNow,
      makeLeaseToken: makeSequentialLeaseTokens(),
    }))

    expect(result).toMatchObject({
      run: { id: runId, projectId, status: 'running' },
      worker: { id: 'codex-1' },
      lease: {
        requested: 2,
        granted: 2,
        activeLeaseLimit: 20,
        activeLeasesBefore: 0,
        leaseTtlMs: 15 * 60 * 1000,
      },
      nextAction: { type: 'read_context' },
    })
    expect(result.tasks.map((task) => task.taskType)).toEqual(['business_rules', 'data_dictionary'])
    expect(result.tasks.map((task) => task.leaseToken)).toEqual(['lease:1', 'lease:2'])
    expect(result.tasks.every((task) => task.contextHandle && task.contextPageTokens.includes('target'))).toBe(true)
    expect(result.tasks.every((task) => task.attemptNo === 0)).toBe(true)

    const leasedRows = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.status, 'leased'))
      .all()
    expect(leasedRows).toHaveLength(2)
    expect(leasedRows.every((task) => task.workerId === 'codex-1')).toBe(true)
    expect(leasedRows.every((task) => task.leaseExpiresAt === '2026-06-04T00:15:00.000Z')).toBe(true)
  })

  it('leases up to the default 20-task business-docs cap when enough tasks are ready', () => {
    const db = createRunnableProject({ epicCount: 5 })
    const runId = startRun(db)

    const result = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-batch',
      limit: 20,
      now: fixedNow,
      makeLeaseToken: makeSequentialLeaseTokens(),
    }))

    expect(result.lease).toMatchObject({
      requested: 20,
      granted: 20,
      activeLeaseLimit: 20,
      activeLeasesBefore: 0,
    })
    expect(result.tasks).toHaveLength(20)
    expect(countLeasedTasks(db)).toBe(20)
  })

  it('respects active lease cap and returns no-ready success when cap is full', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    db.update(businessDocGenerationRuns)
      .set({ policyJson: { ...defaultPolicy(), approvedActiveLeases: 2 } })
      .where(eq(businessDocGenerationRuns.id, runId))
      .run()

    const first = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      limit: 2,
      now: fixedNow,
      makeLeaseToken: makeSequentialLeaseTokens(),
    }))
    expect(first.tasks).toHaveLength(2)

    const second = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-2',
      limit: 2,
      now: () => new Date(later),
      makeLeaseToken: makeSequentialLeaseTokens('second'),
    }))
    expect(second).toMatchObject({
      lease: {
        requested: 2,
        granted: 0,
        activeLeaseLimit: 2,
        activeLeasesBefore: 2,
      },
      tasks: [],
      nextAction: { type: 'no_ready_tasks' },
    })
  })

  it('recovers expired active leases before selecting business-docs tasks', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const first = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      limit: 4,
      now: fixedNow,
      makeLeaseToken: makeSequentialLeaseTokens('first'),
    }))
    expect(first.tasks).toHaveLength(4)

    db.update(businessDocGenerationTasks)
      .set({
        leaseExpiresAt: '2026-06-04T00:05:00.000Z',
        updatedAt: '2026-06-04T00:05:00.000Z',
      })
      .where(eq(businessDocGenerationTasks.status, 'leased'))
      .run()

    const second = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-2',
      limit: 4,
      now: () => new Date(later),
      makeLeaseToken: makeSequentialLeaseTokens('second'),
    }))

    expect(second).toMatchObject({
      lease: {
        requested: 4,
        granted: 4,
        activeLeasesBefore: 0,
      },
      nextAction: { type: 'read_context' },
    })
    expect(second.tasks.map((task) => task.leaseToken)).toEqual(['second:1', 'second:2', 'second:3', 'second:4'])

    const rows = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.status, 'leased'))
      .all()
    expect(rows).toHaveLength(4)
    expect(rows.every((task) => task.workerId === 'codex-2')).toBe(true)
    expect(rows.every((task) => task.lastErrorJson?.code === 'LEASE_EXPIRED')).toBe(true)
  })

  it('does not lease dependency-gated tasks until manifest and dependencies are ready', () => {
    const db = createRunnableProject()
    const runId = startRun(db)

    const initial = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      limit: 8,
      now: fixedNow,
      makeLeaseToken: makeSequentialLeaseTokens(),
    }))
    expect(initial.tasks.map((task) => task.taskType).sort()).toEqual([
      'business_rules',
      'data_dictionary',
      'system_design',
      'use_case_list',
    ])

    resetAllTaskLeases(db)
    markSourceFirstSavedExceptUseCaseList(db)
    markRefineManifestReady(db)
    const unsavedDependency = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-2',
      limit: 8,
      now: fixedNow,
      makeLeaseToken: makeSequentialLeaseTokens('unsaved'),
    }))
    expect(unsavedDependency.tasks.map((task) => task.taskType)).not.toContain('use_case_list_refine')

    resetAllTaskLeases(db)
    markTaskStatus(db, 'use_case_list', 'saved')
    const readyDependency = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-3',
      limit: 8,
      now: fixedNow,
      makeLeaseToken: makeSequentialLeaseTokens('ready'),
    }))
    expect(readyDependency.tasks.map((task) => task.taskType)).toContain('use_case_list_refine')
  })

  it('rolls back all lease updates when a conditional update loses the lease race during a batch', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const dataDictionary = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.taskType, 'data_dictionary'))
      .get()
    expect(dataDictionary).toBeTruthy()
    let calls = 0

    expect(() => leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      limit: 2,
      now: fixedNow,
      makeLeaseToken: () => {
        calls += 1
        if (calls === 2) {
          db.update(businessDocGenerationTasks)
            .set({
              status: 'leased',
              workerId: 'race-worker',
              leaseToken: 'race-token',
              leaseExpiresAt: '2026-06-04T00:15:00.000Z',
              updatedAt: now,
            })
            .where(eq(businessDocGenerationTasks.id, dataDictionary!.id))
            .run()
        }
        return `lease:${calls}`
      },
    })).toThrow('lost race')

    expect(countLeasedTasks(db)).toBe(0)
    expect(db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, dataDictionary!.id))
      .get()?.status).toBe('pending')
  })

  it('rejects a run that becomes terminal before task lease updates are written', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    let calls = 0

    const result = leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      limit: 2,
      now: fixedNow,
      makeLeaseToken: () => {
        calls += 1
        if (calls === 2) {
          db.update(businessDocGenerationRuns)
            .set({ status: 'completed', updatedAt: now })
            .where(eq(businessDocGenerationRuns.id, runId))
            .run()
        }
        return `lease:${calls}`
      },
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'BUSINESS_DOCS_RUN_NOT_LEASEABLE',
    })
    expect(countLeasedTasks(db)).toBe(0)
    expect(db.select().from(businessDocGenerationRuns)
      .where(eq(businessDocGenerationRuns.id, runId))
      .get()?.status).toBe('completed')
  })

  it('heartbeats an active lease and rejects wrong or expired tokens', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const leased = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      limit: 1,
      leaseTtlMs: 15 * 60 * 1000,
      now: fixedNow,
      makeLeaseToken: makeSequentialLeaseTokens(),
    }))
    const task = leased.tasks[0]

    const heartbeat = mustHeartbeat(heartbeatBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      leaseTtlMs: 30 * 60 * 1000,
      now: () => new Date(later),
    }))
    expect(heartbeat).toMatchObject({
      task: {
        id: task.id,
        status: 'leased',
        workerId: 'codex-1',
        leaseExpiresAt: '2026-06-04T00:40:00.000Z',
      },
      lease: {
        leaseToken: task.leaseToken,
        leaseTtlMs: 30 * 60 * 1000,
      },
    })

    expect(heartbeatBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: 'wrong',
      now: () => new Date(later),
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_LEASE_CONFLICT' })

    expect(heartbeatBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      now: () => new Date('2026-06-04T01:00:00.000Z'),
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_LEASE_CONFLICT' })
  })

  it('returns context bundle metadata and one context page for a valid lease token', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      limit: 1,
      now: fixedNow,
      makeLeaseToken: makeSequentialLeaseTokens(),
    })).tasks[0]

    const bundle = mustBundle(getBusinessDocsContextBundle(db, {
      contextHandle: task.contextHandle,
      leaseToken: task.leaseToken,
      now: fixedNow,
    }))
    expect(bundle).toMatchObject({
      run: { id: runId, projectId },
      task: {
        id: task.id,
        status: 'leased',
        contextHandle: task.contextHandle,
      },
      manifest: {
        runId,
        taskId: task.id,
      },
    })
    expect(bundle.pages.map((page) => page.pageToken)).toEqual(task.contextPageTokens)
    expect(JSON.stringify(bundle.pages)).not.toContain('contentJson')
    expect(JSON.stringify(bundle.pages)).not.toContain('"content"')

    const page = mustPage(getBusinessDocsContextPage(db, {
      contextHandle: task.contextHandle,
      pageToken: 'target',
      leaseToken: task.leaseToken,
      now: fixedNow,
    }))
    expect(page.page).toMatchObject({
      pageToken: 'target',
      pageKind: 'target',
      content: {
        runId,
        taskId: task.id,
      },
    })
    expect(page.manifest).toMatchObject({
      schemaVersion: 'business-docs-context.v1',
      evidenceIdNamespace: `${runId}:${task.id}`,
    })
  })

  it('rejects context reads with wrong tokens, expired leases, missing contexts, and missing pages', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      limit: 1,
      leaseTtlMs: 15 * 60 * 1000,
      now: fixedNow,
      makeLeaseToken: makeSequentialLeaseTokens(),
    })).tasks[0]

    expect(getBusinessDocsContextBundle(db, {
      contextHandle: task.contextHandle,
      leaseToken: 'wrong',
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_LEASE_CONFLICT' })

    expect(getBusinessDocsContextPage(db, {
      contextHandle: task.contextHandle,
      pageToken: 'target',
      leaseToken: task.leaseToken,
      now: () => new Date('2026-06-04T01:00:00.000Z'),
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_LEASE_CONFLICT' })

    expect(getBusinessDocsContextBundle(db, {
      contextHandle: 'context:missing',
      leaseToken: task.leaseToken,
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_CONTEXT_NOT_FOUND' })

    expect(getBusinessDocsContextPage(db, {
      contextHandle: task.contextHandle,
      pageToken: 'missing',
      leaseToken: task.leaseToken,
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_CONTEXT_PAGE_NOT_FOUND' })
  })

  it('does not expose forbidden source strings through context reads', () => {
    const db = createRunnableProject({
      dangerousLowerDocument: true,
    })
    const runId = startRun(db)
    const task = mustLease(leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'codex-1',
      limit: 1,
      now: fixedNow,
      makeLeaseToken: makeSequentialLeaseTokens(),
    })).tasks[0]

    const bundle = mustBundle(getBusinessDocsContextBundle(db, {
      contextHandle: task.contextHandle,
      leaseToken: task.leaseToken,
      now: fixedNow,
    }))
    const sourcePage = mustPage(getBusinessDocsContextPage(db, {
      contextHandle: task.contextHandle,
      pageToken: 'source_document_cards',
      leaseToken: task.leaseToken,
      now: fixedNow,
    }))
    const workerVisibleContext = JSON.stringify({ bundle, sourcePage })

    // Redaction policy: ONLY env/secret material and absolute host paths / on-disk DB
    // files are redacted before reaching the worker. Business prose + SQL pass through.
    expect(workerVisibleContext).not.toContain('sk-live-must-not-leak')
    expect(workerVisibleContext).not.toContain('platty.sqlite')
    expect(workerVisibleContext).not.toContain('/Users/pshift')
    expect(workerVisibleContext).toContain('create an order and update it')
  })
})

function createRunnableProject(input: { dangerousLowerDocument?: boolean; epicCount?: number } = {}): TestDb {
  const db = createTestDb()
  seedProject(db)
  const epicCount = input.epicCount ?? 1
  for (let index = 1; index <= epicCount; index += 1) {
    const suffix = index === 1 ? 'orders' : `orders-${index}`
    seedEpic(db, {
      id: `epic:${suffix}`,
      name: `Orders ${index}`,
      stableKey: suffix,
      summary: 'Order checkout and fulfillment.',
    })
    seedLowerDocument(db, {
      id: `doc:${suffix}-api`,
      type: 'api_spec',
      status: 'passed',
      summary: 'Create an order from cart items.',
      content: {
        id: `doc:${suffix}-api`,
        type: 'api_spec',
        title: 'Create order API',
        summary: 'Create an order from cart items.',
        identity: {
          method: 'POST',
          path: '/orders',
          handler: 'OrdersController.create',
          file_path: 'src/server/orders.ts',
        },
        flow: ['Validate cart', 'Persist order'],
        rules: ['Orders require at least one item.'],
        relations: {
          tables: [{ table: 'Order', operation: 'insert' }],
        },
      },
    })
    linkEpicDocument(db, { epicId: `epic:${suffix}`, documentId: `doc:${suffix}-api`, documentType: 'api_spec' })
  }
  if (input.dangerousLowerDocument) {
    seedLowerDocument(db, {
      id: 'doc:dangerous-screen',
      type: 'screen_spec',
      summary: 'User can create an order and update it. SELECT * FROM documents. API_KEY=sk-live-must-not-leak. Local file /Users/pshift/private/platty.sqlite',
      content: {
        identity: {
          route_path: '/orders',
          screen_name: 'OrdersPage',
        },
        dbPath: '/Users/pshift/private/platty.sqlite',
        rawSql: 'SELECT * FROM documents',
        localSourceInstruction: 'open src/server/db.ts and read it directly',
        flow: ['Safe checkout flow'],
      },
    })
    linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:dangerous-screen', documentType: 'screen_spec' })
  }
  return db
}

function startRun(db: TestDb): string {
  const result = startBusinessDocsGeneration(db, {
    projectId,
    now: fixedNow,
    makeId: makeSequentialIds(),
  })
  if (!result.ok) throw new Error(`Expected start ok, got ${result.code}`)
  return result.data.run.id
}

function fixedNow(): Date {
  return new Date(now)
}

function makeSequentialIds(): () => string {
  let next = 0
  return () => `id:${++next}`
}

function makeSequentialLeaseTokens(prefix = 'lease'): () => string {
  let next = 0
  return () => `${prefix}:${++next}`
}

function countLeasedTasks(db: TestDb): number {
  return Number(db.select({ value: count() }).from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.status, 'leased'))
    .get()?.value ?? 0)
}

function defaultPolicy() {
  return {
    workerRuntime: 'external_cli',
    workerProvider: 'codex',
    maxWorkerCount: 20,
    approvedActiveLeases: 20,
    epicSchedulingConcurrency: 4,
    writerSoftLimit: 6,
    ucsChunkSize: 1,
    ucsSchedulingConcurrency: 16,
    maxRepairAttempts: 1,
    persistMode: 'incremental',
    projectGlossaryMode: 'auto',
    judgeMode: 'off',
    outputLanguage: 'ko',
  } as const
}

function resetAllTaskLeases(db: TestDb): void {
  db.update(businessDocGenerationTasks)
    .set({
      status: 'pending',
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .run()
}

function markSourceFirstSavedExceptUseCaseList(db: TestDb): void {
  for (const taskType of ['system_design', 'data_dictionary', 'business_rules'] as const) {
    markTaskStatus(db, taskType, 'saved')
  }
}

function markTaskStatus(db: TestDb, taskType: string, status: 'pending' | 'saved' | 'proposal_created'): void {
  db.update(businessDocGenerationTasks)
    .set({ status, updatedAt: now })
    .where(eq(businessDocGenerationTasks.taskType, taskType))
    .run()
}

function markRefineManifestReady(db: TestDb): void {
  const refine = db.select().from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.taskType, 'use_case_list_refine'))
    .get()
  if (!refine?.contextHandle) throw new Error('Missing refine task')
  const bundle = db.select().from(businessDocContextBundles)
    .where(eq(businessDocContextBundles.contextHandle, refine.contextHandle))
    .get()
  if (!bundle) throw new Error('Missing refine bundle')
  db.update(businessDocContextBundles)
    .set({
      manifestJson: {
        ...bundle.manifestJson,
        dependencyPagesReady: true,
        deferredPages: [],
      },
    })
    .where(eq(businessDocContextBundles.contextHandle, refine.contextHandle))
    .run()
}

function mustLease(result: { ok: true; data: BusinessDocsLeaseResult } | { ok: false; code: string }): BusinessDocsLeaseResult {
  if (!result.ok) throw new Error(`Expected lease ok, got ${result.code}`)
  return result.data
}

function mustHeartbeat(
  result: { ok: true; data: BusinessDocsHeartbeatResult } | { ok: false; code: string },
): BusinessDocsHeartbeatResult {
  if (!result.ok) throw new Error(`Expected heartbeat ok, got ${result.code}`)
  return result.data
}

function mustBundle(
  result: { ok: true; data: BusinessDocsContextBundleResult } | { ok: false; code: string },
): BusinessDocsContextBundleResult {
  if (!result.ok) throw new Error(`Expected context bundle ok, got ${result.code}`)
  return result.data
}

function mustPage(
  result: { ok: true; data: BusinessDocsContextPageResult } | { ok: false; code: string },
): BusinessDocsContextPageResult {
  if (!result.ok) throw new Error(`Expected context page ok, got ${result.code}`)
  return result.data
}

function seedProject(db: TestDb): void {
  db.insert(projects).values({
    id: projectId,
    name: 'Platty',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedEpic(
  db: TestDb,
  overrides: { id: string; confirmedAt?: string | null; name?: string; stableKey?: string; summary?: string },
): void {
  db.insert(epics).values({
    id: overrides.id,
    projectId,
    name: overrides.name ?? overrides.id.replace('epic:', ''),
    abbr: 'EP',
    stableKey: overrides.stableKey ?? overrides.id.replace('epic:', ''),
    summary: overrides.summary ?? null,
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: overrides.confirmedAt === undefined ? now : overrides.confirmedAt,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedLowerDocument(
  db: TestDb,
  input: {
    id: string
    type: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
    status?: 'active' | 'passed'
    scopeId?: string
    summary?: string
    content?: Record<string, unknown>
  },
): void {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: 'technical',
    scope: input.type,
    scopeId: input.scopeId ?? input.id,
    status: input.status ?? 'passed',
    validity: 'fresh',
    summary: input.summary ?? input.id,
    content: input.content ?? { id: input.id },
    rawLlmOutput: '',
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function linkEpicDocument(
  db: TestDb,
  input: { epicId: string; documentId: string; documentType: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec' },
): void {
  db.insert(epicDocumentLinks).values({
    epicId: input.epicId,
    documentId: input.documentId,
    documentType: input.documentType,
    role: 'primary',
    reason: 'test link',
    confidence: 'high',
    createdAt: now,
  }).run()
}
