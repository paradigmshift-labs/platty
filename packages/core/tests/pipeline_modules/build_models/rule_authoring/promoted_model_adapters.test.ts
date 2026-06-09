import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/index.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { loadSchemaSources, DEFAULT_ADAPTER_REGISTRY } from '@/pipeline_modules/build_models/f1_load_schema_sources.js'
import { parseModels } from '@/pipeline_modules/build_models/f2_parse_models.js'
import { composeModelAdapterRegistry, buildPromotedModelAdapterRegistry } from '@/pipeline_modules/build_models/rule_authoring/promoted_model_adapters.js'
import type { ModelAdapterSpec } from '@/pipeline_modules/build_models/rule_authoring/types.js'

// promote → production wiring: a promoted graph-query spec, composed into the adapter registry, is resolved
// by f1 and produces models through the normal f1→f2 path (given a schemaSource with its orm).

const REPO = 'repo_p'
const newOrmSpec: ModelAdapterSpec = {
  id: 'model.adapter.neworm', orm: 'neworm', clientPackages: ['@neworm/core'],
  entityDecorators: ['Model'], tableNameArgKey: 'name', columnDecorators: ['Id', 'Field'], primaryDecorators: ['Id'], relationDecoratorTypes: {},
}

function seed(db: DB): void {
  db.insert(projects).values({ id: 'p', name: 'p' }).run()
  db.insert(repositories).values({
    id: REPO, projectId: 'p', name: 'r', repoPath: '/mock',
    schemaSources: [{ orm: 'neworm', provider: 'postgresql', schema_paths: [], label: 'NewORM' }],
  }).run()
  db.insert(codeNodes).values({ id: `${REPO}:src/e.ts`, repoId: REPO, type: 'file', name: 'e.ts', filePath: 'src/e.ts', exported: false }).run()
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:src/e.ts`, targetId: null, relation: 'imports', targetSpecifier: '@neworm/core', resolveStatus: 'resolved', source: 'static' }).run()
  db.insert(codeNodes).values({ id: `${REPO}:User`, repoId: REPO, type: 'class', name: 'User', filePath: 'src/e.ts', lineStart: 1, lineEnd: 10, exported: true }).run()
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:User`, targetId: null, relation: 'decorates', targetSymbol: 'Model', firstArg: "'users'", resolveStatus: 'resolved', source: 'static' }).run()
  db.insert(codeNodes).values({ id: `${REPO}:User.id`, repoId: REPO, type: 'property', name: 'id', filePath: 'src/e.ts', lineStart: 2, exported: false }).run()
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:User`, targetId: `${REPO}:User.id`, relation: 'contains', resolveStatus: 'resolved', source: 'static' }).run()
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:User.id`, targetId: null, relation: 'decorates', targetSymbol: 'Id', resolveStatus: 'resolved', source: 'static' }).run()
}

describe('promoted_model_adapters registry integration', () => {
  let db: DB
  beforeEach(() => { db = createTestDb() })

  it('composeModelAdapterRegistry: hand-written adapters win on a name collision', () => {
    const collide: ModelAdapterSpec = { ...newOrmSpec, orm: 'typeorm' }
    const composed = composeModelAdapterRegistry(DEFAULT_ADAPTER_REGISTRY, [collide])
    expect(composed.get('typeorm')!().orm).toBe('typeorm')
    // promoted-only orm is added
    const composed2 = composeModelAdapterRegistry(DEFAULT_ADAPTER_REGISTRY, [newOrmSpec])
    expect(composed2.get('neworm')).toBeDefined()
  })

  it('buildPromotedModelAdapterRegistry: each spec → GraphQuerySpecAdapter factory keyed by orm', () => {
    const reg = buildPromotedModelAdapterRegistry([newOrmSpec])
    expect(reg.get('neworm')!().strategy).toBe('graph-query')
  })

  it('promoted spec produces models through the real f1→f2 path', async () => {
    seed(db)
    const registry = composeModelAdapterRegistry(DEFAULT_ADAPTER_REGISTRY, [newOrmSpec])
    const loaded = loadSchemaSources(
      { id: REPO, repoPath: '/mock', schemaSources: [{ orm: 'neworm', provider: 'postgresql', schema_paths: [], label: 'NewORM' }] },
      registry,
    )
    expect(loaded.map((l) => l.source.orm)).toEqual(['neworm'])
    const { bySource } = await parseModels(loaded, db, REPO, '/mock')
    const models = bySource.flatMap((b) => b.models)
    const user = models.find((m) => m.name === 'User')
    expect(user?.table_name).toBe('users')
    expect(user?.fields.find((f) => f.name === 'id')?.primary).toBe(true)
  })
})
