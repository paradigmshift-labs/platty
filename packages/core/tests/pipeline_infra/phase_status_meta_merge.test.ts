import { describe, it, expect, beforeEach } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { createTestDb, type DB } from '../server/helpers.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { upsertRepositoryPhaseStatus } from '@/pipeline_infra/phase/phase_status.js'

// phase_status.meta is a shared multi-key JSON blob (staticAnalysisApprovedConfig, promotedModelAdapters,
// promotedRelationRules, promotedRouteRules, …). A phase write must MERGE its key into the blob, not
// overwrite the whole thing — otherwise a module's completion write wipes a loop-promoted rule another
// writer stored under the same phase (the bug found live: build_route clobbered its own promotedRouteRules).

const REPO = 'r1'
function meta(db: DB): Record<string, unknown> | null {
  const row = db.select().from(repositoryPhaseStatus)
    .where(and(eq(repositoryPhaseStatus.repositoryId, REPO), eq(repositoryPhaseStatus.phase, 'build_route'))).get()
  return (row?.meta as Record<string, unknown> | null) ?? null
}

describe('upsertRepositoryPhaseStatus — meta merge', () => {
  let db: DB
  beforeEach(() => {
    db = createTestDb()
    db.insert(projects).values({ id: 'p', name: 'p' }).run()
    db.insert(repositories).values({ id: REPO, projectId: 'p', name: 'r', repoPath: '/m' }).run()
  })

  it('a write with meta=null PRESERVES the existing blob (does not wipe other writers keys)', () => {
    upsertRepositoryPhaseStatus(db, REPO, 'build_route', { status: 'passed', meta: { promotedRouteRules: { version: 1 } } })
    expect(meta(db)?.promotedRouteRules).toEqual({ version: 1 })
    // a later completion write that carries no meta must NOT clobber the promoted rules
    upsertRepositoryPhaseStatus(db, REPO, 'build_route', { status: 'passed', meta: null })
    expect(meta(db)?.promotedRouteRules).toEqual({ version: 1 })
  })

  it('a write MERGES its key into the existing blob (both keys survive)', () => {
    upsertRepositoryPhaseStatus(db, REPO, 'build_route', { status: 'passed', meta: { keyA: 1 } })
    upsertRepositoryPhaseStatus(db, REPO, 'build_route', { status: 'passed', meta: { keyB: 2 } })
    expect(meta(db)).toMatchObject({ keyA: 1, keyB: 2 })
  })

  it('a write OVERWRITES its own key with the new value', () => {
    upsertRepositoryPhaseStatus(db, REPO, 'build_route', { status: 'passed', meta: { keyA: 1 } })
    upsertRepositoryPhaseStatus(db, REPO, 'build_route', { status: 'passed', meta: { keyA: 9 } })
    expect(meta(db)?.keyA).toBe(9)
  })
})
