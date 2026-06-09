import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/index.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { evaluateModelAdapterForPromotion } from '@/pipeline_modules/build_models/rule_authoring/promote_gate.js'
import type { ModelAdapterSpec, ModelShape } from '@/pipeline_modules/build_models/rule_authoring/types.js'

// Referee for agent-authored ModelAdapterSpec — runs the spec through the real GraphQuerySpecAdapter on a
// seeded anchor graph and checks reproduction / precision / cross-clean / non-degenerate.

let n = 0
function freshRepo(db: DB): string {
  const repo = `repo_${n++}`
  db.insert(projects).values({ id: `${repo}_p`, name: 'p' }).run()
  db.insert(repositories).values({ id: repo, projectId: `${repo}_p`, name: repo, repoPath: '/mock' }).run()
  return repo
}
function cls(db: DB, repo: string, id: string, name: string): void {
  db.insert(codeNodes).values({ id, repoId: repo, type: 'class', name, filePath: 'src/e.ts', lineStart: 1, lineEnd: 20, exported: true }).run()
}
function prop(db: DB, repo: string, id: string, name: string): void {
  db.insert(codeNodes).values({ id, repoId: repo, type: 'property', name, filePath: 'src/e.ts', lineStart: 5, exported: false }).run()
}
function fileNode(db: DB, repo: string): void {
  db.insert(codeNodes).values({ id: `${repo}:src/e.ts`, repoId: repo, type: 'file', name: 'e.ts', filePath: 'src/e.ts', exported: false }).run()
}
function imports(db: DB, repo: string, spec: string): void {
  db.insert(codeEdges).values({ repoId: repo, sourceId: `${repo}:src/e.ts`, targetId: null, relation: 'imports', targetSpecifier: spec, resolveStatus: 'resolved', source: 'static' }).run()
}
function decorates(db: DB, repo: string, sourceId: string, sym: string, firstArg: string | null = null): void {
  db.insert(codeEdges).values({ repoId: repo, sourceId, targetId: null, relation: 'decorates', targetSymbol: sym, firstArg, resolveStatus: 'resolved', source: 'static' }).run()
}
function contains(db: DB, repo: string, classId: string, propId: string): void {
  db.insert(codeEdges).values({ repoId: repo, sourceId: classId, targetId: propId, relation: 'contains', resolveStatus: 'resolved', source: 'static' }).run()
}

// '@neworm/core' anchor: User(@Model 'users') { @Id id; @Field email }
function seedNewOrmAnchor(db: DB): string {
  const repo = freshRepo(db)
  fileNode(db, repo)
  imports(db, repo, '@neworm/core')
  cls(db, repo, `${repo}:User`, 'User'); decorates(db, repo, `${repo}:User`, 'Model', "'users'")
  prop(db, repo, `${repo}:User.id`, 'id'); contains(db, repo, `${repo}:User`, `${repo}:User.id`); decorates(db, repo, `${repo}:User.id`, 'Id')
  prop(db, repo, `${repo}:User.email`, 'email'); contains(db, repo, `${repo}:User`, `${repo}:User.email`); decorates(db, repo, `${repo}:User.email`, 'Field')
  return repo
}
// a foreign typeorm repo: Account(@Entity) { @PrimaryColumn id }
function seedTypeormForeign(db: DB): { fixture: string; db: DB; repoId: string } {
  const repo = freshRepo(db)
  fileNode(db, repo)
  imports(db, repo, 'typeorm')
  cls(db, repo, `${repo}:Account`, 'Account'); decorates(db, repo, `${repo}:Account`, 'Entity')
  prop(db, repo, `${repo}:Account.id`, 'id'); contains(db, repo, `${repo}:Account`, `${repo}:Account.id`); decorates(db, repo, `${repo}:Account.id`, 'PrimaryColumn')
  return { fixture: 'typeorm', db, repoId: repo }
}

const newOrmSpec: ModelAdapterSpec = {
  id: 'model.adapter.neworm', orm: 'neworm', clientPackages: ['@neworm/core'],
  entityDecorators: ['Model'], tableNameArgKey: 'name',
  columnDecorators: ['Id', 'Field'], primaryDecorators: ['Id'],
  relationDecoratorTypes: {},
}
const newOrmExpected: ModelShape[] = [
  { name: 'User', table_name: 'users', fields: [{ name: 'email', primary: false }, { name: 'id', primary: true }], relations: [] },
]

describe('evaluateModelAdapterForPromotion', () => {
  let db: DB
  beforeEach(() => { db = createTestDb(); n = 0 })

  it('S2 happy: good spec reproduces anchor, clean, non-degenerate → promote', async () => {
    const repo = seedNewOrmAnchor(db)
    const v = await evaluateModelAdapterForPromotion({
      candidate: newOrmSpec, anchorDb: db, anchorRepoId: repo, anchorExpected: newOrmExpected,
      foreign: [seedTypeormForeign(db)],
    })
    expect(v.promote).toBe(true)
    expect(v.checks.anchorReproduction.pass).toBe(true)
    expect(v.checks.crossClean.pass).toBe(true)
  })

  it('S5 empty clientPackages → reject', async () => {
    const repo = seedNewOrmAnchor(db)
    const v = await evaluateModelAdapterForPromotion({
      candidate: { ...newOrmSpec, clientPackages: [] }, anchorDb: db, anchorRepoId: repo,
      anchorExpected: newOrmExpected, foreign: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.clientPackagesNonEmpty.pass).toBe(false)
  })

  it('S3 precision: over-broad entityDecorators grabs a non-entity class → over_extract → reject', async () => {
    const repo = seedNewOrmAnchor(db)
    // add an @Injectable service class in the same repo (NOT a model)
    cls(db, repo, `${repo}:Svc`, 'Svc'); decorates(db, repo, `${repo}:Svc`, 'Injectable')
    const v = await evaluateModelAdapterForPromotion({
      candidate: { ...newOrmSpec, entityDecorators: ['Model', 'Injectable'] }, // BUG: Injectable is not an entity
      anchorDb: db, anchorRepoId: repo, anchorExpected: newOrmExpected, foreign: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.precision.pass).toBe(false)
    expect(v.checks.precision.extra).toContain('Svc')
  })

  it('S4 crossClean: over-broad clientPackages fires on a foreign ORM repo → cross_pollution → reject', async () => {
    const repo = seedNewOrmAnchor(db)
    const foreign = seedTypeormForeign(db)
    const v = await evaluateModelAdapterForPromotion({
      // BUG: claims 'typeorm' too + 'Entity' → fires on the typeorm foreign repo
      candidate: { ...newOrmSpec, clientPackages: ['@neworm/core', 'typeorm'], entityDecorators: ['Model', 'Entity'] },
      anchorDb: db, anchorRepoId: repo, anchorExpected: newOrmExpected, foreign: [foreign],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.crossClean.pass).toBe(false)
    expect(v.checks.crossClean.polluted).toContain('typeorm')
  })

  it('anchor not reproduced (wrong primary decorator) → reject', async () => {
    const repo = seedNewOrmAnchor(db)
    const v = await evaluateModelAdapterForPromotion({
      candidate: { ...newOrmSpec, primaryDecorators: ['Field'] }, // BUG: Field is not the primary
      anchorDb: db, anchorRepoId: repo, anchorExpected: newOrmExpected, foreign: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.anchorReproduction.pass).toBe(false)
    expect(v.checks.anchorReproduction.mismatched).toContain('User')
  })
})
