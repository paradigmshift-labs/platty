import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../../server/helpers.js'
import { projects, repositories } from '@/db/schema/core.js'
import { pipelineRuns } from '@/db/schema/pipeline_runs.js'

const persistFailure = vi.hoisted(() => ({ value: new Error('persist boom') as unknown }))

vi.mock('@/pipeline_modules/build_route/f8_persist_results.js', () => ({
  persistResults: vi.fn(() => {
    throw persistFailure.value
  }),
}))

const { runBuildRoute } = await import('@/pipeline_modules/build_route/index.js')

describe('runBuildRoute — failure recording', () => {
  function setupDb() {
    const db = createTestDb()
    db.insert(projects).values({ id: 'p1', name: 'p' }).run()
    db.insert(repositories).values({
      id: 'r1',
      projectId: 'p1',
      name: 'r',
      repoPath: '.',
      framework: 'nestjs',
    }).run()
    return db
  }

  it('marks the pipeline run failed when a post-start step throws', async () => {
    persistFailure.value = new Error('persist boom')
    const db = setupDb()

    await expect(runBuildRoute({ db, repoId: 'r1' })).rejects.toThrow('persist boom')

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, 'build_route')).get()
    expect(run).toMatchObject({
      projectId: 'p1',
      repoId: 'r1',
      status: 'failed',
      errorMessage: 'persist boom',
    })
  })

  it('records non-Error failures as strings', async () => {
    persistFailure.value = 'persist string'
    const db = setupDb()

    await expect(runBuildRoute({ db, repoId: 'r1' })).rejects.toBe('persist string')

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, 'build_route')).get()
    expect(run).toMatchObject({
      status: 'failed',
      errorMessage: 'persist string',
    })
  })
})
