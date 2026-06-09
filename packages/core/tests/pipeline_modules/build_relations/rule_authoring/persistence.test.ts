import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { savePromotedRelationRules, loadPromotedRelationRules } from '@/pipeline_modules/build_relations/rule_authoring/persistence.js'
import type { DbAccessEmitRule } from '@/pipeline_modules/build_relations/rule_authoring/db_access_promote_gate.js'
import { eq } from 'drizzle-orm'

const REPO = 'repo_rp'
const rule: DbAccessEmitRule = { ormLabel: 'neworm', clientPackages: ['@neworm/db'], operationByMethod: { insert: 'insert' }, tableSource: 'first_arg' }

function seed(db: DB): void {
  db.insert(projects).values({ id: 'p', name: 'p' }).run()
  db.insert(repositories).values({ id: REPO, projectId: 'p', name: 'r', repoPath: '/mock' }).run()
}

describe('build_relations promoted-rule persistence', () => {
  let db: DB
  beforeEach(() => { db = createTestDb(); seed(db) })

  it('save → load roundtrip, dedupe by ormLabel, version bumps on change', () => {
    expect(loadPromotedRelationRules({ db, repoId: REPO })).toBeNull()
    const a = savePromotedRelationRules({ db, repoId: REPO, dbAccess: [rule] })
    expect(a.version).toBe(1)
    expect(loadPromotedRelationRules({ db, repoId: REPO })?.dbAccess.map((r) => r.ormLabel)).toEqual(['neworm'])
    // re-save same → no bump
    expect(savePromotedRelationRules({ db, repoId: REPO, dbAccess: [rule] }).version).toBe(1)
    // change → bump, still one (dedupe by ormLabel)
    const c = savePromotedRelationRules({ db, repoId: REPO, dbAccess: [{ ...rule, operationByMethod: { insert: 'insert', save: 'insert' } }] })
    expect(c.version).toBe(2)
    expect(c.dbAccess).toHaveLength(1)
  })

  it('does not clobber other meta keys on the build_relations phase row', () => {
    db.insert(repositoryPhaseStatus).values({ repositoryId: REPO, phase: 'build_relations', meta: { other: 'keep' } }).run()
    savePromotedRelationRules({ db, repoId: REPO, dbAccess: [rule] })
    const row = db.select().from(repositoryPhaseStatus).where(eq(repositoryPhaseStatus.repositoryId, REPO)).all()
      .find((r) => r.phase === 'build_relations')
    expect((row?.meta as Record<string, unknown>)?.other).toBe('keep')
  })
})
