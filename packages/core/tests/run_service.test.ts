import { describe, expect, it } from 'vitest'
import { createTestPlattyDb } from '../src/db/testing.js'
import { pipelineRuns } from '../src/db/schema/pipeline_runs.js'
import { createProject } from '../src/project_service.js'
import { cancelRun, getRun, listRuns } from '../src/run_service.js'

describe('run_service', () => {
  it('lists, reads, and cancels pipeline runs', () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'Demo' })

    client.db.insert(pipelineRuns).values([
      {
        id: 'run-1',
        projectId: project.id,
        kind: 'analyze_repo',
        status: 'done',
        startedAt: '2026-06-09T00:00:00.000Z',
      },
      {
        id: 'run-2',
        projectId: project.id,
        kind: 'build_graph',
        status: 'running',
        startedAt: '2026-06-09T01:00:00.000Z',
      },
    ]).run()

    expect(listRuns(client.db, { projectId: project.id }).map((run) => run.id)).toEqual(['run-2', 'run-1'])
    expect(getRun(client.db, 'run-2')?.status).toBe('running')

    const cancelled = cancelRun(client.db, { runId: 'run-2', reason: 'test cancel' })
    expect(cancelled.kind).toBe('cancelled')
    expect(cancelled.run.status).toBe('cancelled')
    expect(cancelled.run.errorMessage).toBe('test cancel')

    client.close()
  })
})
