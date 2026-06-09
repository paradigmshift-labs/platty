import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../server/helpers.js'
import { documents } from '@/db/schema/build_docs.js'
import { epicDependencies, epicDocumentLinks } from '@/db/schema/build_epics.js'
import { epicDomains, epics, projects } from '@/db/schema/core.js'
import { loadPersistedBuildEpicsPlan } from '@/pipeline_modules/build_epics_sync/persisted_plan.js'

describe('loadPersistedBuildEpicsPlan', () => {
  it('loads live EPICs with document links and dependencies while skipping deleted EPIC rows', () => {
    const db = createTestDb()
    const now = '2026-06-08T00:00:00.000Z'
    db.insert(projects).values({ id: 'p1', name: 'Project', createdAt: now, updatedAt: now }).run()
    db.insert(epicDomains).values({ id: 'domain:orders', projectId: 'p1', name: 'Commerce', stableKey: 'commerce', summary: 'Commerce domain', status: 'confirmed', source: 'build_epics', sortOrder: 0, confirmedAt: now, createdAt: now, updatedAt: now }).run()
    db.insert(epics).values([
      epic('epic:orders', 'domain:orders', 'orders', 'Orders'),
      epic('epic:billing', 'domain:orders', 'billing', 'Billing'),
      { ...epic('epic:old', null, 'old', 'Old'), deletedAt: now },
    ]).run()
    db.insert(documents).values([
      doc('doc:orders', 'api_spec'),
      doc('doc:screen', 'screen_spec'),
      doc('doc:billing', 'api_spec'),
    ]).run()
    db.insert(epicDocumentLinks).values([
      link('epic:orders', 'doc:orders', 'api_spec', 'owner'),
      link('epic:orders', 'doc:screen', 'screen_spec', 'primary'),
      link('epic:billing', 'doc:billing', 'api_spec', 'owner'),
    ]).run()
    db.insert(epicDependencies).values({ sourceEpicId: 'epic:orders', targetEpicId: 'epic:billing', kind: 'external_call', reason: 'Orders calls billing.' }).run()

    const plan = loadPersistedBuildEpicsPlan({ db, projectId: 'p1' })

    expect(plan.epics.map((epic) => epic.stableKey).sort()).toEqual(['billing', 'orders'])
    expect(plan.epics.find((epic) => epic.stableKey === 'orders')).toMatchObject({
      tempEpicId: 'epic:orders',
      apiLinks: [expect.objectContaining({ apiDocId: 'doc:orders', role: 'owner' })],
      screenLinks: [expect.objectContaining({ screenDocId: 'doc:screen', role: 'primary' })],
      dependencies: [expect.objectContaining({ targetTempEpicId: 'epic:billing', kind: 'external_call' })],
    })
    expect(plan.domains?.[0]).toMatchObject({ domainId: 'domain:orders', stableKey: 'commerce', epicIds: ['epic:billing', 'epic:orders'] })
  })

  it('clears domainId when a live EPIC references a deleted domain', () => {
    const db = createTestDb()
    const now = '2026-06-08T00:00:00.000Z'
    db.insert(projects).values({ id: 'p1', name: 'Project', createdAt: now, updatedAt: now }).run()
    db.insert(epicDomains).values([
      { id: 'domain:live', projectId: 'p1', name: 'Live', stableKey: 'live', summary: 'Live domain', status: 'confirmed', source: 'build_epics', sortOrder: 0, confirmedAt: now, createdAt: now, updatedAt: now },
      { id: 'domain:deleted', projectId: 'p1', name: 'Deleted', stableKey: 'deleted', summary: 'Deleted domain', status: 'confirmed', source: 'build_epics', sortOrder: 1, confirmedAt: now, deletedAt: now, createdAt: now, updatedAt: now },
    ]).run()
    db.insert(epics).values(epic('epic:orphaned-domain', 'domain:deleted', 'orphaned-domain', 'Orphaned Domain')).run()

    const plan = loadPersistedBuildEpicsPlan({ db, projectId: 'p1' })

    expect(plan.domains?.map((domain) => domain.domainId)).toEqual(['domain:live'])
    expect(plan.epics[0]).toMatchObject({ tempEpicId: 'epic:orphaned-domain', domainId: undefined })
  })

  it('normalizes invalid persisted document link roles per document type', () => {
    const db = createTestDb()
    const now = '2026-06-08T00:00:00.000Z'
    db.insert(projects).values({ id: 'p1', name: 'Project', createdAt: now, updatedAt: now }).run()
    db.insert(epics).values(epic('epic:orders', null, 'orders', 'Orders')).run()
    db.insert(documents).values([
      doc('doc:api', 'api_spec'),
      doc('doc:screen', 'screen_spec'),
      doc('doc:event', 'event_spec'),
      doc('doc:schedule', 'schedule_spec'),
    ]).run()
    db.insert(epicDocumentLinks).values([
      link('epic:orders', 'doc:api', 'api_spec', 'supporting'),
      link('epic:orders', 'doc:screen', 'screen_spec', 'event_owner'),
      link('epic:orders', 'doc:event', 'event_spec', 'job_owner'),
      link('epic:orders', 'doc:schedule', 'schedule_spec', 'primary'),
    ]).run()

    const plan = loadPersistedBuildEpicsPlan({ db, projectId: 'p1' })

    expect(plan.epics[0]).toMatchObject({
      apiLinks: [expect.objectContaining({ apiDocId: 'doc:api', role: 'owner' })],
      screenLinks: [expect.objectContaining({ screenDocId: 'doc:screen', role: 'unknown' })],
      eventLinks: [expect.objectContaining({ eventDocId: 'doc:event', role: 'unknown' })],
      scheduleLinks: [expect.objectContaining({ scheduleDocId: 'doc:schedule', role: 'unknown' })],
    })
  })

  it('does not load links or dependencies attached to deleted EPICs', () => {
    const db = createTestDb()
    const now = '2026-06-08T00:00:00.000Z'
    db.insert(projects).values({ id: 'p1', name: 'Project', createdAt: now, updatedAt: now }).run()
    db.insert(epics).values([
      epic('epic:orders', null, 'orders', 'Orders'),
      epic('epic:billing', null, 'billing', 'Billing'),
      { ...epic('epic:old', null, 'old', 'Old'), deletedAt: now },
    ]).run()
    db.insert(documents).values([
      doc('doc:orders', 'api_spec'),
      doc('doc:old', 'api_spec'),
    ]).run()
    db.insert(epicDocumentLinks).values([
      link('epic:orders', 'doc:orders', 'api_spec', 'owner'),
      link('epic:old', 'doc:old', 'api_spec', 'owner'),
    ]).run()
    db.insert(epicDependencies).values([
      { sourceEpicId: 'epic:orders', targetEpicId: 'epic:billing', kind: 'external_call', reason: 'Orders calls billing.' },
      { sourceEpicId: 'epic:orders', targetEpicId: 'epic:old', kind: 'external_call', reason: 'Orders calls old.' },
      { sourceEpicId: 'epic:old', targetEpicId: 'epic:orders', kind: 'external_call', reason: 'Old calls orders.' },
    ]).run()

    const plan = loadPersistedBuildEpicsPlan({ db, projectId: 'p1' })
    const ordersEpic = plan.epics.find((epic) => epic.tempEpicId === 'epic:orders')

    expect(plan.epics.map((epic) => epic.tempEpicId)).not.toContain('epic:old')
    expect(plan.epics.flatMap((epic) => epic.apiLinks.map((link) => link.apiDocId))).toEqual(['doc:orders'])
    expect(ordersEpic?.dependencies).toEqual([expect.objectContaining({ targetTempEpicId: 'epic:billing' })])
  })
})

function epic(id: string, domainId: string | null, stableKey: string, name: string) {
  return {
    id,
    projectId: 'p1',
    domainId,
    name,
    abbr: stableKey.toUpperCase(),
    description: `${name} summary`,
    stableKey,
    summary: `${name} summary`,
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: '2026-06-08T00:00:00.000Z',
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
  }
}

function doc(id: string, type: string) {
  return { id, projectId: 'p1', type, track: 'technical', scope: 'route', scopeId: id, status: 'passed', validity: 'fresh', summary: id, content: { title: id }, rawLlmOutput: '{}' }
}

function link(epicId: string, documentId: string, documentType: string, role: string) {
  return { epicId, documentId, documentType, role, reason: `${documentId} belongs to ${epicId}.`, confidence: 'high' }
}
