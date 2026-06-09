import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/index.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import {
  knownModelPackages, runLiveModelAdapterDiscovery,
} from '@/pipeline_modules/build_models/rule_authoring/live_runner.js'
import type { ModelRuleAuthor } from '@/pipeline_modules/build_models/rule_authoring/autonomous_loop.js'
import { GraphQuerySpecAdapter } from '@/pipeline_modules/build_models/rule_authoring/graph_query_spec_adapter.js'
import { toModelShape } from '@/pipeline_modules/build_models/rule_authoring/types.js'
import { loadPromotedModelAdapters } from '@/pipeline_modules/build_models/rule_authoring/persistence.js'

const REPO = 'repo_lr'
function seed(db: DB): void {
  db.insert(projects).values({ id: 'p', name: 'p' }).run()
  db.insert(repositories).values({ id: REPO, projectId: 'p', name: 'r', repoPath: '/mock' }).run()
  db.insert(codeNodes).values({ id: `${REPO}:src/e.ts`, repoId: REPO, type: 'file', name: 'e.ts', filePath: 'src/e.ts', exported: false }).run()
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:src/e.ts`, targetId: null, relation: 'imports', targetSpecifier: '@neworm/core', resolveStatus: 'resolved', source: 'static' }).run()
  // typeorm is also imported (built-in) — must be excluded from gaps
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:src/e.ts`, targetId: null, relation: 'imports', targetSpecifier: 'typeorm', resolveStatus: 'resolved', source: 'static' }).run()
  db.insert(codeNodes).values({ id: `${REPO}:User`, repoId: REPO, type: 'class', name: 'User', filePath: 'src/e.ts', lineStart: 1, lineEnd: 10, exported: true }).run()
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:User`, targetId: null, relation: 'decorates', targetSymbol: 'Model', firstArg: "'users'", resolveStatus: 'resolved', source: 'static' }).run()
  db.insert(codeNodes).values({ id: `${REPO}:User.id`, repoId: REPO, type: 'property', name: 'id', filePath: 'src/e.ts', lineStart: 2, exported: false }).run()
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:User`, targetId: `${REPO}:User.id`, relation: 'contains', resolveStatus: 'resolved', source: 'static' }).run()
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:User.id`, targetId: null, relation: 'decorates', targetSymbol: 'Id', resolveStatus: 'resolved', source: 'static' }).run()
}

// LLM-FREE: a deterministic injected author (the test seam that stands in for the agent-driven `dsl` CLI's
// promote path). It authors a declarative spec and GROUNDS the anchor in the spec's real output on the graph,
// exactly as the production author path does — no LLM in this import graph.
function stubAuthor(): ModelRuleAuthor {
  return async (gap, ctx) => {
    if (gap.packageSpecifier !== '@neworm/core') return null
    const spec = {
      id: 'model.adapter.neworm', orm: 'neworm', clientPackages: ['@neworm/core'],
      entityDecorators: ['Model'], tableNameArgKey: 'name' as string | null,
      columnDecorators: ['Id', 'Field'], primaryDecorators: ['Id'], relationDecoratorTypes: {},
    }
    const produced = await new GraphQuerySpecAdapter(spec).queryFromGraph(ctx.db, ctx.repoId)
    return { spec, anchorDb: ctx.db, anchorRepoId: ctx.repoId, anchorExpected: produced.map(toModelShape) }
  }
}

describe('build_models live_runner', () => {
  let db: DB
  beforeEach(() => { db = createTestDb() })

  it('knownModelPackages excludes built-in ORM packages', () => {
    seed(db)
    expect(knownModelPackages(db, REPO)).toContain('typeorm')
  })

  it('ACTIVATION: runs the loop with an injected author and PERSISTS the promotion', async () => {
    seed(db)
    const result = await runLiveModelAdapterDiscovery({ db, repoId: REPO, author: stubAuthor() })

    // only the unknown ORM is a gap (typeorm excluded)
    expect(result.gaps.map((g) => g.packageSpecifier)).toEqual(['@neworm/core'])
    expect(result.promoted.map((s) => s.id)).toEqual(['model.adapter.neworm'])
    // persisted → survives for the next runBuildModels
    expect(loadPromotedModelAdapters({ db, repoId: REPO })?.specs.map((s) => s.id)).toEqual(['model.adapter.neworm'])
  })

  it('idempotent: a second run sees the persisted rule id as known → no re-promote', async () => {
    seed(db)
    await runLiveModelAdapterDiscovery({ db, repoId: REPO, author: stubAuthor() })
    const second = await runLiveModelAdapterDiscovery({ db, repoId: REPO, author: stubAuthor() })
    // @neworm/core now covered by the persisted spec's clientPackages → not even a gap anymore
    expect(second.gaps.map((g) => g.packageSpecifier)).toEqual([])
    expect(second.promoted).toEqual([])
  })
})
