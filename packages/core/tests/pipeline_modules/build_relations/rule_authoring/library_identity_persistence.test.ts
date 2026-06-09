import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/core.js'
import { saveLibraryIdentities, loadLibraryIdentities, savePromotedRelationRules, loadPromotedRelationRules } from '@/pipeline_modules/build_relations/rule_authoring/persistence.js'
import { createPersistentLibraryClassifier } from '@/pipeline_modules/build_relations/rule_authoring/live_runner.js'
import type { LibraryClassifier } from '@/pipeline_modules/build_relations/rule_authoring/autonomous_loop.js'

// classify-first GROWTH: the agent's library classifications are persisted into a per-repo identity rulebook
// that grows, so a package is asked to the LLM at most once across runs — the hand-written seed denylist
// shrinks toward an agent-grown cache (the user's "명단 = agent가 키운 캐시" direction).

const REPO = 'r'
const gap = { packageSpecifier: 'x', files: [] }

describe('library identity rulebook persistence', () => {
  let db: DB
  beforeEach(() => {
    db = createTestDb()
    db.insert(projects).values({ id: 'p', name: 'p' }).run()
    db.insert(repositories).values({ id: REPO, projectId: 'p', name: 'r', repoPath: '/m' }).run()
  })

  it('save → load roundtrip; merge keeps both; re-save overwrites a key', () => {
    saveLibraryIdentities({ db, repoId: REPO, identities: { redaxios: 'http_client' } })
    expect(loadLibraryIdentities({ db, repoId: REPO })?.identities).toEqual({ redaxios: 'http_client' })
    saveLibraryIdentities({ db, repoId: REPO, identities: { stripe: 'vendor_service' } })
    expect(loadLibraryIdentities({ db, repoId: REPO })?.identities).toEqual({ redaxios: 'http_client', stripe: 'vendor_service' })
    saveLibraryIdentities({ db, repoId: REPO, identities: { redaxios: 'db_client' } })
    expect(loadLibraryIdentities({ db, repoId: REPO })?.identities.redaxios).toBe('db_client')
  })

  it('shares the build_relations phase meta with promotedRelationRules without clobbering it', () => {
    savePromotedRelationRules({ db, repoId: REPO, apiCall: [{ clientLabel: 'redaxios', clientPackages: ['redaxios'], methodBySymbol: { get: 'GET' } }] })
    saveLibraryIdentities({ db, repoId: REPO, identities: { redaxios: 'http_client' } })
    expect(loadPromotedRelationRules({ db, repoId: REPO })?.apiCall.map((r) => r.clientLabel)).toEqual(['redaxios'])
    expect(loadLibraryIdentities({ db, repoId: REPO })?.identities.redaxios).toBe('http_client')
  })

  it('persistent classifier: LLM asked once per package, then cached + persisted (rulebook grows)', async () => {
    let calls = 0
    const base: LibraryClassifier = async (pkg) => { calls++; return { kind: pkg === 'redaxios' ? 'http_client' : 'unknown', reason: 'stub' } }
    const c1 = createPersistentLibraryClassifier(db, REPO, base)
    expect((await c1('redaxios', gap, {} as never)).kind).toBe('http_client')
    expect((await c1('redaxios', gap, {} as never)).kind).toBe('http_client')
    expect(calls).toBe(1)
    const c2 = createPersistentLibraryClassifier(db, REPO, base) // a later run
    const id = await c2('redaxios', gap, {} as never)
    expect(id.kind).toBe('http_client')
    expect(id.reason).toContain('persisted')
    expect(calls).toBe(1) // never re-asked — loaded from the grown rulebook
  })

  it("'unknown' is NOT cached — re-tryable so a future seed/LLM improvement isn't blocked", async () => {
    let calls = 0
    const base: LibraryClassifier = async () => { calls++; return { kind: 'unknown', reason: 'stub' } }
    const c = createPersistentLibraryClassifier(db, REPO, base)
    await c('mystery', gap, {} as never)
    await c('mystery', gap, {} as never)
    expect(calls).toBe(2)
    expect(loadLibraryIdentities({ db, repoId: REPO })).toBeNull()
  })
})
