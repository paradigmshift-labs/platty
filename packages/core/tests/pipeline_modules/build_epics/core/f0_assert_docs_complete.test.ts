import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../../server/helpers.js'
import { documents } from '@/db/schema/build_docs.js'
import { projects } from '@/db/schema/core.js'
import { assertBuildDocsComplete } from '@/pipeline_modules/build_epics/core/f0_assert_docs_complete.js'

describe('assertBuildDocsComplete', () => {
  it('requires at least one passed fresh build_docs document', async () => {
    const db = createTestDb()
    db.insert(projects).values({
      id: 'p1',
      name: 'Project',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    }).run()
    db.insert(documents).values([
      doc('doc:stale', 'stale'),
      doc('doc:deleted', 'orphaned', 'deleted'),
    ]).run()

    await expect(assertBuildDocsComplete({ db, projectId: 'p1' })).rejects.toMatchObject({
      code: 'DOCS_INCOMPLETE',
    })
  })
})

function doc(id: string, validity: string, status = 'passed') {
  return {
    id,
    projectId: 'p1',
    type: 'api_spec',
    track: 'technical',
    scope: 'endpoint',
    scopeId: `ep:${id}`,
    status,
    validity,
    summary: id,
    content: { title: id, summary: id },
    rawLlmOutput: '{}',
    sourceRunId: 'run:docs',
    sourceCommit: 'commit:test',
  }
}
