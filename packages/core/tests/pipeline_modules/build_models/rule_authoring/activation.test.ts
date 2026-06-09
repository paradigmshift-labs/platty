import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { models } from '@/db/schema/build_models.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { runBuildModels } from '@/pipeline_modules/build_models/index.js'
import { savePromotedModelAdapters, loadPromotedModelAdapters } from '@/pipeline_modules/build_models/rule_authoring/persistence.js'
import type { ModelAdapterSpec } from '@/pipeline_modules/build_models/rule_authoring/types.js'
import { eq } from 'drizzle-orm'

const REPO = 'repo_act'
const newOrmSpec: ModelAdapterSpec = {
  id: 'model.adapter.neworm', orm: 'neworm', clientPackages: ['@neworm/core'],
  entityDecorators: ['Model'], tableNameArgKey: 'name', columnDecorators: ['Id', 'Field'], primaryDecorators: ['Id'], relationDecoratorTypes: {},
}

function seedRepoOnly(db: DB): void {
  db.insert(projects).values({ id: 'p', name: 'p' }).run()
  db.insert(repositories).values({
    id: REPO, projectId: 'p', name: 'r', repoPath: '/mock',
    schemaSources: [{ orm: 'neworm', provider: 'postgresql', schema_paths: [], label: 'NewORM' }],
  }).run()
}
function seedGraph(db: DB): void {
  db.insert(repositoryPhaseStatus).values({ repositoryId: REPO, phase: 'build_graph', builtAt: '2026-05-08T00:00:00Z' }).onConflictDoNothing().run()
  db.insert(codeNodes).values({ id: `${REPO}:src/e.ts`, repoId: REPO, type: 'file', name: 'e.ts', filePath: 'src/e.ts', exported: false }).run()
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:src/e.ts`, targetId: null, relation: 'imports', targetSpecifier: '@neworm/core', resolveStatus: 'resolved', source: 'static' }).run()
  db.insert(codeNodes).values({ id: `${REPO}:User`, repoId: REPO, type: 'class', name: 'User', filePath: 'src/e.ts', lineStart: 1, lineEnd: 10, exported: true }).run()
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:User`, targetId: null, relation: 'decorates', targetSymbol: 'Model', firstArg: "'users'", resolveStatus: 'resolved', source: 'static' }).run()
  db.insert(codeNodes).values({ id: `${REPO}:User.id`, repoId: REPO, type: 'property', name: 'id', filePath: 'src/e.ts', lineStart: 2, exported: false }).run()
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:User`, targetId: `${REPO}:User.id`, relation: 'contains', resolveStatus: 'resolved', source: 'static' }).run()
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:User.id`, targetId: null, relation: 'decorates', targetSymbol: 'Id', resolveStatus: 'resolved', source: 'static' }).run()
}

describe('build_models loop activation (persist → load → produce)', () => {
  let db: DB
  beforeEach(() => { db = createTestDb() })

  it('persistence: save → load roundtrip, dedupe by id, version bumps on change', () => {
    seedRepoOnly(db)
    const a = savePromotedModelAdapters({ db, repoId: REPO, specs: [newOrmSpec] })
    expect(a.version).toBe(1)
    expect(loadPromotedModelAdapters({ db, repoId: REPO })?.specs.map((s) => s.id)).toEqual(['model.adapter.neworm'])
    // re-save same → no version bump
    const b = savePromotedModelAdapters({ db, repoId: REPO, specs: [newOrmSpec] })
    expect(b.version).toBe(1)
    // change a spec field → version bumps, still one spec (dedupe by id)
    const c = savePromotedModelAdapters({ db, repoId: REPO, specs: [{ ...newOrmSpec, orm: 'neworm2' }] })
    expect(c.version).toBe(2)
    expect(c.specs).toHaveLength(1)
  })

  it('does not clobber other meta keys on the same phase row', () => {
    seedRepoOnly(db)
    db.insert(repositoryPhaseStatus).values({ repositoryId: REPO, phase: 'build_models', meta: { other: 'keep' } }).run()
    savePromotedModelAdapters({ db, repoId: REPO, specs: [newOrmSpec] })
    const row = db.select().from(repositoryPhaseStatus)
      .where(eq(repositoryPhaseStatus.repositoryId, REPO)).all()
      .find((r) => r.phase === 'build_models')
    expect((row?.meta as Record<string, unknown>)?.other).toBe('keep')
  })

  it('END-TO-END: a persisted promoted spec makes runBuildModels produce models for the new ORM', async () => {
    seedRepoOnly(db)
    seedGraph(db)
    // BEFORE promotion: neworm has no adapter → no models
    await runBuildModels({ repoId: REPO, db })
    expect(db.select().from(models).where(eq(models.repositoryId, REPO)).all()).toHaveLength(0)

    // the loop promotes + persists the spec
    savePromotedModelAdapters({ db, repoId: REPO, specs: [newOrmSpec] })

    // AFTER promotion: runBuildModels loads it from DB → User model appears
    await runBuildModels({ repoId: REPO, db })
    const rows = db.select().from(models).where(eq(models.repositoryId, REPO)).all()
    const user = rows.find((m) => m.name === 'User')
    expect(user, 'promoted spec must produce the User model').toBeDefined()
    expect(user?.tableName).toBe('users')
    expect(user?.orm).toBe('neworm')
  })

  // REAL-discovery gap (surfaced on a live LoopBack4 repo): analyze_repo never writes a schemaSource for a
  // just-discovered ORM, so loadSchemaSources skips it and the promoted adapter is registered+persisted but
  // never invoked. A promoted graph-query adapter must be always-on + import-self-gated (like build_route's
  // composeRoutePromotedAdapters), NOT dependent on a pre-seeded schemaSource.
  it('END-TO-END (no schemaSource): a persisted promoted spec produces models even when analyze_repo wrote NO schemaSource for the new ORM', async () => {
    db.insert(projects).values({ id: 'p', name: 'p' }).run()
    db.insert(repositories).values({ id: REPO, projectId: 'p', name: 'r', repoPath: '/mock', schemaSources: [] }).run() // NO neworm source
    seedGraph(db)
    savePromotedModelAdapters({ db, repoId: REPO, specs: [newOrmSpec] })
    await runBuildModels({ repoId: REPO, db })
    const user = db.select().from(models).where(eq(models.repositoryId, REPO)).all().find((m) => m.name === 'User')
    expect(user, 'promoted graph-query adapter must run without a seeded schemaSource').toBeDefined()
    expect(user?.orm).toBe('neworm')
  })

  it('promoted graph-query adapter self-gates: NO models when the repo does not import the new ORM package (regression-safe)', async () => {
    db.insert(projects).values({ id: 'p', name: 'p' }).run()
    db.insert(repositories).values({ id: REPO, projectId: 'p', name: 'r', repoPath: '/mock', schemaSources: [] }).run()
    db.insert(repositoryPhaseStatus).values({ repositoryId: REPO, phase: 'build_graph', builtAt: '2026-05-08T00:00:00Z' }).onConflictDoNothing().run()
    db.insert(codeNodes).values({ id: `${REPO}:src/e.ts`, repoId: REPO, type: 'file', name: 'e.ts', filePath: 'src/e.ts', exported: false }).run()
    db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:src/e.ts`, targetId: null, relation: 'imports', targetSpecifier: 'react', resolveStatus: 'resolved', source: 'static' }).run() // NOT @neworm/core
    savePromotedModelAdapters({ db, repoId: REPO, specs: [newOrmSpec] })
    await runBuildModels({ repoId: REPO, db })
    expect(db.select().from(models).where(eq(models.repositoryId, REPO)).all()).toHaveLength(0)
  })
})
