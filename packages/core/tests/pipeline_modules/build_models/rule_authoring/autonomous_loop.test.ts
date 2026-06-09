import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/index.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { findModelAdapterGaps, runModelAdapterDiscovery, type ModelRuleAuthor } from '@/pipeline_modules/build_models/rule_authoring/autonomous_loop.js'
import type { ModelAdapterSpec, ModelShape } from '@/pipeline_modules/build_models/rule_authoring/types.js'

// The autonomous loop: scan a repo → find imported ORM packages no adapter covers (with a decorated-class
// signal) → author a spec per gap → referee → auto-promote. Author stubbed for determinism.

let n = 0
function freshRepo(db: DB): string {
  const repo = `repo_${n++}`
  db.insert(projects).values({ id: `${repo}_p`, name: 'p' }).run()
  db.insert(repositories).values({ id: repo, projectId: `${repo}_p`, name: repo, repoPath: '/mock' }).run()
  return repo
}
function fileNode(db: DB, repo: string, file: string): void {
  db.insert(codeNodes).values({ id: `${repo}:${file}`, repoId: repo, type: 'file', name: file, filePath: file, exported: false }).run()
}
function cls(db: DB, repo: string, id: string, name: string, file: string): void {
  db.insert(codeNodes).values({ id, repoId: repo, type: 'class', name, filePath: file, lineStart: 1, lineEnd: 20, exported: true }).run()
}
function prop(db: DB, repo: string, id: string, name: string, file: string): void {
  db.insert(codeNodes).values({ id, repoId: repo, type: 'property', name, filePath: file, lineStart: 5, exported: false }).run()
}
function imports(db: DB, repo: string, file: string, spec: string): void {
  db.insert(codeEdges).values({ repoId: repo, sourceId: `${repo}:${file}`, targetId: null, relation: 'imports', targetSpecifier: spec, resolveStatus: 'resolved', source: 'static' }).run()
}
function decorates(db: DB, repo: string, sourceId: string, sym: string, firstArg: string | null = null): void {
  db.insert(codeEdges).values({ repoId: repo, sourceId, targetId: null, relation: 'decorates', targetSymbol: sym, firstArg, resolveStatus: 'resolved', source: 'static' }).run()
}
function contains(db: DB, repo: string, classId: string, propId: string): void {
  db.insert(codeEdges).values({ repoId: repo, sourceId: classId, targetId: propId, relation: 'contains', resolveStatus: 'resolved', source: 'static' }).run()
}

// repo imports '@neworm/core' (decorated @Model entity), 'typeorm' (known), and 'lodash' (no decorated class)
function seedRepoWithGaps(db: DB): string {
  const repo = freshRepo(db)
  fileNode(db, repo, 'src/e.ts'); fileNode(db, repo, 'src/util.ts')
  imports(db, repo, 'src/e.ts', '@neworm/core')
  imports(db, repo, 'src/e.ts', 'typeorm')      // known → not a gap
  imports(db, repo, 'src/util.ts', 'lodash')    // no decorated class in util.ts → not a gap
  cls(db, repo, `${repo}:User`, 'User', 'src/e.ts'); decorates(db, repo, `${repo}:User`, 'Model', "'users'")
  prop(db, repo, `${repo}:User.id`, 'id', 'src/e.ts'); contains(db, repo, `${repo}:User`, `${repo}:User.id`); decorates(db, repo, `${repo}:User.id`, 'Id')
  prop(db, repo, `${repo}:User.email`, 'email', 'src/e.ts'); contains(db, repo, `${repo}:User`, `${repo}:User.email`); decorates(db, repo, `${repo}:User.email`, 'Field')
  return repo
}

const newOrmSpec: ModelAdapterSpec = {
  id: 'model.adapter.neworm', orm: 'neworm', clientPackages: ['@neworm/core'],
  entityDecorators: ['Model'], tableNameArgKey: 'name', columnDecorators: ['Id', 'Field'], primaryDecorators: ['Id'], relationDecoratorTypes: {},
}
const newOrmExpected: ModelShape[] = [
  { name: 'User', table_name: 'users', fields: [{ name: 'email', primary: false }, { name: 'id', primary: true }], relations: [] },
]

// stub author: a good spec for '@neworm/core' (anchor = the scanned repo itself); null otherwise
const stubAuthor: ModelRuleAuthor = async (gap, ctx) => {
  if (gap.packageSpecifier === '@neworm/core') {
    return { spec: newOrmSpec, anchorDb: ctx.db, anchorRepoId: ctx.repoId, anchorExpected: newOrmExpected }
  }
  return null
}

describe('runModelAdapterDiscovery — the build_models autonomous loop', () => {
  let db: DB
  beforeEach(() => { db = createTestDb(); n = 0 })

  it('S1: detects unknown ORM packages with a decorated-class signal (excludes known + non-decorator imports)', () => {
    const repo = seedRepoWithGaps(db)
    const gaps = findModelAdapterGaps(db, repo, new Set(['typeorm']))
    expect(gaps.map((g) => g.packageSpecifier)).toEqual(['@neworm/core']) // typeorm known, lodash has no decorated class
    expect(gaps[0].classDecoratorHints).toContain('Model')
  })

  it('S7: gap → author → referee → auto-promote', async () => {
    const repo = seedRepoWithGaps(db)
    const result = await runModelAdapterDiscovery({
      db, repoId: repo, knownPackages: ['typeorm'], knownRuleIds: [], foreign: [], authorCandidate: stubAuthor,
    })
    expect(result.gaps.map((g) => g.packageSpecifier)).toEqual(['@neworm/core'])
    expect(result.promoted.map((s) => s.id)).toEqual(['model.adapter.neworm'])
    expect(result.rejected).toEqual([])
  })

  it('S6: re-authored rule whose id is already known → rejected (duplicate)', async () => {
    const repo = seedRepoWithGaps(db)
    const result = await runModelAdapterDiscovery({
      db, repoId: repo, knownPackages: ['typeorm'], knownRuleIds: ['model.adapter.neworm'], foreign: [], authorCandidate: stubAuthor,
    })
    expect(result.promoted).toEqual([])
    expect(result.rejected).toEqual([{ ruleId: 'model.adapter.neworm', reason: 'duplicate_id' }])
  })

  it('rejects an authored spec that fails the referee (empty clientPackages)', async () => {
    const repo = seedRepoWithGaps(db)
    const badAuthor: ModelRuleAuthor = async (gap, ctx) =>
      gap.packageSpecifier === '@neworm/core'
        ? { spec: { ...newOrmSpec, clientPackages: [] }, anchorDb: ctx.db, anchorRepoId: ctx.repoId, anchorExpected: newOrmExpected }
        : null
    const result = await runModelAdapterDiscovery({
      db, repoId: repo, knownPackages: ['typeorm'], knownRuleIds: [], foreign: [], authorCandidate: badAuthor,
    })
    expect(result.promoted).toEqual([])
    expect(result.rejected[0]?.reason).toBe('empty_client_packages')
  })
})
