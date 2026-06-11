import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../../server/helpers.js'
import { documents } from '@/db/schema/build_docs.js'
import { epics, projects } from '@/db/schema/core.js'
import { persistConfirmedEpics } from '@/pipeline_modules/build_epics/core/f10_persist_confirmed_epics.js'

describe('persistConfirmedEpics — F-9: cascade soft-delete to business documents', () => {
  it('orphans the business documents of an epic that is dropped from the confirmed plan', async () => {
    const db = createTestDb()
    const now = '2026-06-08T00:00:00.000Z'
    db.insert(projects).values({ id: 'p1', name: 'Project', createdAt: now, updatedAt: now }).run()
    db.insert(epics).values([
      epic('epic:gone', 'gone', 'Gone'),
      epic('epic:keep', 'keep', 'Keep'),
    ]).run()
    db.insert(documents).values([
      bdoc('doc:gone-br', 'br', 'epic', 'epic:gone'),
      bdoc('doc:gone-ucs', 'ucs', 'use_case', 'epic:gone:use_case:login'), // composite scopeId embeds the epic id
      bdoc('doc:keep-br', 'br', 'epic', 'epic:keep'), // a surviving epic's doc must be untouched
      tdoc('doc:gone-tech', 'api_spec', 'epic:gone'), // technical-track doc must be untouched here
    ]).run()

    // Confirm a plan that no longer contains 'gone' -> it becomes stale and is soft-deleted.
    await persistConfirmedEpics({ db, projectId: 'p1', plan: { epics: [confirmedEpic('epic:keep', 'keep', 'Keep')] } as never })

    const gone = db.select().from(epics).where(eq(epics.id, 'epic:gone')).get()
    expect(gone?.deletedAt).not.toBeNull()

    const goneBr = db.select().from(documents).where(eq(documents.id, 'doc:gone-br')).get()
    expect(goneBr).toMatchObject({ status: 'deleted', validity: 'orphaned' })
    const goneUcs = db.select().from(documents).where(eq(documents.id, 'doc:gone-ucs')).get()
    expect(goneUcs).toMatchObject({ status: 'deleted', validity: 'orphaned' })

    // A surviving epic's business doc and the technical-track doc are left alone.
    const keepBr = db.select().from(documents).where(eq(documents.id, 'doc:keep-br')).get()
    expect(keepBr).toMatchObject({ status: 'active' })
    const goneTech = db.select().from(documents).where(eq(documents.id, 'doc:gone-tech')).get()
    expect(goneTech?.status).toBe('passed')
  })
})

function epic(id: string, stableKey: string, name: string) {
  return {
    id, projectId: 'p1', domainId: null, name, abbr: stableKey.toUpperCase(),
    description: `${name} summary`, stableKey, summary: `${name} summary`, status: 'confirmed',
    source: 'build_epics', confidence: 'high',
    confirmedAt: '2026-06-08T00:00:00.000Z', createdAt: '2026-06-08T00:00:00.000Z', updatedAt: '2026-06-08T00:00:00.000Z',
  }
}

function confirmedEpic(tempEpicId: string, stableKey: string, name: string) {
  return {
    tempEpicId, validatedStableKey: stableKey, stableKey, name, abbr: stableKey.toUpperCase(),
    summary: `${name} summary`, domainId: null, confidence: 'high',
    apiLinks: [], screenLinks: [], eventLinks: [], scheduleLinks: [], crossLinks: [], dependencies: [],
  }
}

function bdoc(id: string, type: string, scope: string, scopeId: string) {
  return { id, projectId: 'p1', type, track: 'business', scope, scopeId, status: 'active', validity: 'fresh', summary: id, content: { title: id }, rawLlmOutput: '{}' }
}

function tdoc(id: string, type: string, scopeId: string) {
  return { id, projectId: 'p1', type, track: 'technical', scope: 'route', scopeId, status: 'passed', validity: 'fresh', summary: id, content: { title: id }, rawLlmOutput: '{}' }
}
