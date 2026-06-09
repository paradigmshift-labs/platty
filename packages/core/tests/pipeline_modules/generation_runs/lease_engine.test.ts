import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { generationRuns, generationTasks } from '@/db/schema/build_docs.js'
import { projects, repositories } from '@/db/schema/core.js'
import { createSharedGenerationLeaseEngine } from '@/pipeline_modules/generation_runs/lease_engine.js'
import { createTestPlattyDb, type TestPlattyDb } from '@/db/testing.js'
import type { DB } from '@/db/client.js'

const clients: TestPlattyDb[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.cleanup()))
})

describe('createSharedGenerationLeaseEngine', () => {
  it('does not lease the same task twice when workers race', () => {
    const client = createTrackedTestDb()
    const db = client.db
    seedRunWithTasks(db)
    const engine = createSharedGenerationLeaseEngine({ db, stage: 'build_docs' })

    const first = engine.acquireLeases({
      runId: 'gen:lease:test',
      workerId: 'worker:first',
      limit: 1,
      taskKinds: ['api_spec'],
    })
    const second = engine.acquireLeases({
      runId: 'gen:lease:test',
      workerId: 'worker:second',
      limit: 1,
      taskKinds: ['api_spec'],
    })

    expect(first.leasedTasks).toHaveLength(1)
    expect(second.leasedTasks).toHaveLength(0)
    expect(first.leasedTasks[0]!.taskId).toBe('task:lease:api')
    const row = db.select().from(generationTasks).where(eq(generationTasks.id, 'task:lease:api')).get()
    expect(row).toMatchObject({
      status: 'leased',
      leasedBy: 'worker:first',
      leaseToken: first.leasedTasks[0]!.leaseToken,
    })
  })
})

function seedRunWithTasks(db: DB) {
  db.insert(projects).values({
    id: 'project:lease',
    name: 'Lease Test',
    slug: 'lease-test',
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
  }).run()
  db.insert(repositories).values({
    id: 'repo:lease',
    projectId: 'project:lease',
    name: 'lease-service',
    repoPath: '/tmp/lease-service',
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
  }).run()
  db.insert(generationRuns).values({
    id: 'gen:lease:test',
    projectId: 'project:lease',
    stage: 'build_docs',
    status: 'running',
    requestedBy: 'user:test',
    outputLanguage: 'ko',
    maxConcurrentTasks: 1,
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
  }).run()
  db.insert(generationTasks).values({
    id: 'task:lease:api',
    runId: 'gen:lease:test',
    projectId: 'project:lease',
    repositoryId: 'repo:lease',
    documentType: 'api_spec',
    targetKey: 'api:GET:/orders',
    targetDocumentId: 'doc:api:orders',
    primaryEntryPointId: 'ep:api:orders',
    targetJson: {},
    status: 'pending',
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
  }).run()
}

function createTrackedTestDb(): TestPlattyDb {
  const client = createTestPlattyDb()
  clients.push(client)
  return client
}
