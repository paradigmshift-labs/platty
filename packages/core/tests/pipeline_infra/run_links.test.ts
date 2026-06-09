import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type DB } from '../server/helpers.js'
import { projects, repositories } from '@/db/schema/core.js'
import { pipelineRuns } from '@/db/schema/pipeline_runs.js'
import { pipelineRunLinks } from '@/db/schema/project_analysis_v2.js'
import {
  linkPipelineRun,
  listChildRunLinks,
  listParentRunLinks,
} from '@/pipeline_infra/execution/run_links.js'

let db: DB

beforeEach(() => {
  db = createTestDb()
  db.insert(projects).values({ id: 'p1', name: 'Platty Project' }).run()
  db.insert(repositories).values({ id: 'r1', projectId: 'p1', name: 'api', repoPath: '/repo/api' }).run()
  db.insert(pipelineRuns).values([
    { id: 'run:parent', projectId: 'p1', kind: 'analyze_project', status: 'running' },
    { id: 'run:child', projectId: 'p1', repoId: 'r1', kind: 'build_graph', status: 'done' },
    { id: 'run:retry', projectId: 'p1', repoId: 'r1', kind: 'build_graph', status: 'done' },
  ]).run()
})

describe('pipeline run links', () => {
  it('links parent wrapper runs to child module runs idempotently', () => {
    const first = linkPipelineRun(db, {
      parentRunId: 'run:parent',
      childRunId: 'run:child',
      relation: 'orchestrates',
      phase: 'build_graph',
      repoId: 'r1',
    })
    const second = linkPipelineRun(db, {
      parentRunId: 'run:parent',
      childRunId: 'run:child',
      relation: 'orchestrates',
      phase: 'build_graph',
      repoId: 'r1',
    })

    expect(second.id).toBe(first.id)
    expect(db.select().from(pipelineRunLinks).all()).toHaveLength(1)
    expect(listChildRunLinks(db, 'run:parent')[0]).toMatchObject({
      parentRunId: 'run:parent',
      childRunId: 'run:child',
      relation: 'orchestrates',
      phase: 'build_graph',
      repoId: 'r1',
    })
    expect(listParentRunLinks(db, 'run:child').map((row) => row.parentRunId)).toEqual(['run:parent'])
  })

  it('allows the same child run to be linked with a different relation', () => {
    linkPipelineRun(db, {
      parentRunId: 'run:parent',
      childRunId: 'run:child',
      relation: 'orchestrates',
    })
    linkPipelineRun(db, {
      parentRunId: 'run:parent',
      childRunId: 'run:child',
      relation: 'retries',
    })

    expect(db.select().from(pipelineRunLinks).all()).toHaveLength(2)
  })

  it('rejects links when parent or child runs are missing', () => {
    expect(() => linkPipelineRun(db, {
      parentRunId: 'missing',
      childRunId: 'run:child',
      relation: 'orchestrates',
    })).toThrow(/PARENT_RUN_NOT_FOUND/)

    expect(() => linkPipelineRun(db, {
      parentRunId: 'run:parent',
      childRunId: 'missing',
      relation: 'orchestrates',
    })).toThrow(/CHILD_RUN_NOT_FOUND/)
  })

  it('rejects repo metadata that does not exist', () => {
    expect(() => linkPipelineRun(db, {
      parentRunId: 'run:parent',
      childRunId: 'run:child',
      relation: 'orchestrates',
      repoId: 'missing',
    })).toThrow(/REPOSITORY_NOT_FOUND/)
  })

  it('cascades links when a run is deleted', () => {
    linkPipelineRun(db, {
      parentRunId: 'run:parent',
      childRunId: 'run:child',
      relation: 'orchestrates',
    })

    db.delete(pipelineRuns).where(eq(pipelineRuns.id, 'run:child')).run()

    expect(db.select().from(pipelineRunLinks).all()).toHaveLength(0)
  })
})
