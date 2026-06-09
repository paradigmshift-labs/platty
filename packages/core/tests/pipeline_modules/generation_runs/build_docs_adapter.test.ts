import { afterEach, describe, expect, it } from 'vitest'
import { generationRuns } from '@/db/schema/build_docs.js'
import { projects } from '@/db/schema/core.js'
import { createTestPlattyDb, type TestPlattyDb } from '@/db/testing.js'
import { resolveUnifiedRunAdapter } from '@/pipeline_modules/generation_runs/index.js'

const clients: TestPlattyDb[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.cleanup()))
})

describe('build docs generation run adapter dispatch', () => {
  it('dispatches shared build_docs runs by stage', async () => {
    const client = createTrackedTestDb()
    client.db.insert(projects).values({ id: 'project:test', name: 'Project' }).run()
    client.db.insert(generationRuns).values({
      id: 'gen:docs:test',
      projectId: 'project:test',
      stage: 'build_docs',
      status: 'running',
      outputLanguage: 'ko',
      requestedBy: 'user:test',
      sourceCommit: 'commit:test',
      maxConcurrentTasks: 1,
    }).run()

    const adapter = resolveUnifiedRunAdapter(client.db, {
      projectId: 'project:test',
      runId: 'gen:docs:test',
    })

    expect(adapter.kind).toBe('build_docs')
    expect(typeof adapter.status).toBe('function')
    expect(typeof adapter.resume).toBe('function')
    expect(typeof adapter.retry).toBe('function')
    expect(typeof adapter.releaseLeases).toBe('function')
    await expect(adapter.status({ projectId: 'project:test', runId: 'gen:docs:test' })).resolves.toMatchObject({
      kind: 'build_docs',
      runId: 'gen:docs:test',
      nextAction: { type: 'lease_tasks' },
    })
  })

  it('reports RUN_NOT_FOUND when no supported generation run exists', () => {
    const client = createTrackedTestDb()

    expect(() => resolveUnifiedRunAdapter(client.db, {
      projectId: 'project:test',
      runId: 'missing',
    })).toThrowError(expect.objectContaining({ code: 'RUN_NOT_FOUND' }))
  })
})

function createTrackedTestDb(): TestPlattyDb {
  const client = createTestPlattyDb()
  clients.push(client)
  return client
}
