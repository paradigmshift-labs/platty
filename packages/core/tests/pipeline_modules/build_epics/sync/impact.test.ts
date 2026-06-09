import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../../../server/helpers.js'
import { documents } from '@/db/schema/build_docs.js'
import { projects } from '@/db/schema/core.js'
import { docSyncCandidates, docSyncPlans } from '@/db/schema/sync.js'
import { deriveEpicSyncImpact } from '@/pipeline_modules/build_epics/sync/impact.js'

describe('deriveEpicSyncImpact', () => {
  it('classifies doc sync candidates into new changed and deleted document impacts', () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'p1', name: 'Project', createdAt: '2026-06-08T00:00:00.000Z', updatedAt: '2026-06-08T00:00:00.000Z' }).run()
    db.insert(docSyncPlans).values({ id: 'plan:sync', projectId: 'p1', toSnapshotId: 'snap:new', status: 'applied' }).run()
    db.insert(documents).values([
      doc('doc:new', 'api_spec', 'route:new', 'passed', 'fresh'),
      doc('doc:changed', 'api_spec', 'route:changed', 'passed', 'fresh'),
      doc('doc:deleted', 'api_spec', 'route:deleted', 'deleted', 'orphaned'),
    ]).run()
    db.insert(docSyncCandidates).values([
      candidate('cand:new', 'new_document', 'route:new', null, 'hash:new'),
      candidate('cand:changed', 'stale', 'route:changed', 'hash:old', 'hash:new'),
      candidate('cand:deleted', 'orphan_document', 'route:deleted', 'hash:old', null, 'orphan'),
    ]).run()

    const result = deriveEpicSyncImpact({ db, projectId: 'p1', docSyncPlanId: 'plan:sync' })

    expect(result).toEqual({
      projectId: 'p1',
      docSyncPlanId: 'plan:sync',
      impacts: [
        expect.objectContaining({ documentId: 'doc:new', kind: 'new', documentType: 'api_spec' }),
        expect.objectContaining({ documentId: 'doc:changed', kind: 'changed', documentType: 'api_spec' }),
        expect.objectContaining({ documentId: 'doc:deleted', kind: 'deleted', documentType: 'api_spec' }),
      ],
      counts: { new: 1, changed: 1, deleted: 1 },
    })
    expect(result.impacts.find((impact) => impact.documentId === 'doc:changed')).toMatchObject({
      oldHash: 'hash:old',
      newHash: 'hash:new',
      scope: 'route',
      scopeId: 'route:changed',
    })

    expect(db.select().from(documents).where(eq(documents.id, 'doc:deleted')).get()).toMatchObject({
      status: 'deleted',
      validity: 'orphaned',
    })
  })

  it('excludes non-technical candidates and non-build epics document types', () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'p1', name: 'Project', createdAt: '2026-06-08T00:00:00.000Z', updatedAt: '2026-06-08T00:00:00.000Z' }).run()
    db.insert(docSyncPlans).values({ id: 'plan:sync', projectId: 'p1', toSnapshotId: 'snap:new', status: 'applied' }).run()
    db.insert(documents).values([
      doc('doc:technical', 'api_spec', 'route:technical', 'passed', 'fresh'),
      doc('doc:business-phase', 'api_spec', 'route:business-phase', 'passed', 'fresh'),
      doc('doc:business-track', 'api_spec', 'route:business-track', 'passed', 'fresh', 'business'),
      doc('doc:business-type', 'br', 'route:business-type', 'passed', 'fresh'),
    ]).run()
    db.insert(docSyncCandidates).values([
      candidate('cand:technical', 'stale', 'route:technical', 'hash:old', 'hash:new'),
      candidate('cand:business-phase', 'stale', 'route:business-phase', 'hash:old', 'hash:new', undefined, 'business'),
      candidate('cand:business-track', 'stale', 'route:business-track', 'hash:old', 'hash:new', undefined, 'technical', 'business'),
      candidate('cand:business-type', 'stale', 'route:business-type', 'hash:old', 'hash:new', undefined, 'technical', 'technical', 'br'),
    ]).run()

    expect(deriveEpicSyncImpact({ db, projectId: 'p1', docSyncPlanId: 'plan:sync' })).toMatchObject({
      impacts: [expect.objectContaining({ documentId: 'doc:technical' })],
      counts: { new: 0, changed: 1, deleted: 0 },
    })
  })
})

function doc(id: string, type: string, scopeId: string, status: string, validity: string, track = 'technical') {
  return {
    id,
    projectId: 'p1',
    type,
    track,
    scope: 'route',
    scopeId,
    status,
    validity,
    summary: id,
    content: { title: id, summary: id },
    rawLlmOutput: '{}',
  }
}

function candidate(
  id: string,
  kind: string,
  scopeId: string,
  oldHash: string | null,
  newHash: string | null,
  decision?: string,
  phase = 'technical',
  track = 'technical',
  type = 'api_spec',
) {
  return {
    id,
    planId: 'plan:sync',
    phase,
    kind,
    status: decision ? 'resolved' : 'staged',
    targetJson: { track, type, scope: 'route', scopeId },
    oldHash,
    newHash,
    reasonInputsJson: {},
    decision: decision ?? null,
  }
}
