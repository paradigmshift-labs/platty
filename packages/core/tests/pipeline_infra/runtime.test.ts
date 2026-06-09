import { describe, expect, it } from 'vitest'
import { createPipelineRuntime, createTestPlattyDb, schema } from '../../src/index.js'

describe('PipelineRuntime', () => {
  it('persists a run lifecycle and progress events with an explicit DB instance', async () => {
    const testDb = createTestPlattyDb()
    try {
      testDb.db.insert(schema.projects).values({ id: 'p1', name: 'Project 1' }).run()

      const runtime = createPipelineRuntime({ db: testDb.db, idFactory: () => 'run1' })
      const started = runtime.startRun({
        projectId: 'p1',
        kind: 'analyze_project',
        triggeredBy: 'user',
        totalSteps: 2,
        meta: { source: 'test' },
      })

      expect(started).toMatchObject({
        id: 'run1',
        projectId: 'p1',
        kind: 'analyze_project',
        status: 'running',
        completedSteps: 0,
        totalSteps: 2,
      })

      runtime.recordEvent({
        runId: 'run1',
        message: 'analysis started',
        data: { stage: 'analyze_project' },
      })
      const finished = runtime.finishRun({ runId: 'run1', status: 'done' })

      expect(finished.status).toBe('done')
      expect(finished.finishedAt).toBeTypeOf('string')
      expect(runtime.listEvents('run1')).toHaveLength(1)
    } finally {
      await testDb.cleanup()
    }
  })
})
