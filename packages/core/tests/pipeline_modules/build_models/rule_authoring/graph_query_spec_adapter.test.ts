import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/index.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { GraphQuerySpecAdapter } from '@/pipeline_modules/build_models/rule_authoring/graph_query_spec_adapter.js'
import { TypeOrmGraphAdapter } from '@/pipeline_modules/build_models/adapters/typeorm.js'
import { toModelShape } from '@/pipeline_modules/build_models/rule_authoring/types.js'
import type { ModelAdapterSpec } from '@/pipeline_modules/build_models/rule_authoring/types.js'

const REPO = 'repo_m'
const PROJ = 'proj_m'

function seedRepo(db: DB): void {
  db.insert(projects).values({ id: PROJ, name: 'M' }).run()
  db.insert(repositories).values({ id: REPO, projectId: PROJ, name: 'm', repoPath: '/mock/repo' }).run()
}
function cls(db: DB, id: string, name: string, file = 'src/e.ts'): void {
  db.insert(codeNodes).values({ id, repoId: REPO, type: 'class', name, filePath: file, lineStart: 1, lineEnd: 30, exported: true }).run()
}
function prop(db: DB, id: string, name: string, file = 'src/e.ts'): void {
  db.insert(codeNodes).values({ id, repoId: REPO, type: 'property', name, filePath: file, lineStart: 5, exported: false }).run()
}
function imports(db: DB, spec: string): void {
  db.insert(codeEdges).values({ repoId: REPO, sourceId: `${REPO}:src/e.ts`, targetId: null, relation: 'imports', targetSpecifier: spec, resolveStatus: 'resolved', source: 'static' }).run()
}
function decorates(db: DB, sourceId: string, sym: string, firstArg: string | null = null): void {
  db.insert(codeEdges).values({ repoId: REPO, sourceId, targetId: null, relation: 'decorates', targetSymbol: sym, firstArg, resolveStatus: 'resolved', source: 'static' }).run()
}
function contains(db: DB, classId: string, propId: string): void {
  db.insert(codeEdges).values({ repoId: REPO, sourceId: classId, targetId: propId, relation: 'contains', resolveStatus: 'resolved', source: 'static' }).run()
}
function typeRef(db: DB, propId: string, sym: string): void {
  db.insert(codeEdges).values({ repoId: REPO, sourceId: propId, targetId: null, relation: 'type_ref', targetSymbol: sym, resolveStatus: 'pending', source: 'static' }).run()
}

// TypeORM-like anchor: User(@Entity 'users') { @PrimaryGeneratedColumn id; @Column email; @OneToMany(()=>Order) orders } + Order(@Entity)
function seedTypeormAnchor(db: DB): void {
  seedRepo(db)
  imports(db, 'typeorm')
  cls(db, `${REPO}:User`, 'User'); decorates(db, `${REPO}:User`, 'Entity', "'users'")
  prop(db, `${REPO}:User.id`, 'id'); contains(db, `${REPO}:User`, `${REPO}:User.id`); decorates(db, `${REPO}:User.id`, 'PrimaryGeneratedColumn')
  prop(db, `${REPO}:User.email`, 'email'); contains(db, `${REPO}:User`, `${REPO}:User.email`); decorates(db, `${REPO}:User.email`, 'Column')
  prop(db, `${REPO}:User.orders`, 'orders'); contains(db, `${REPO}:User`, `${REPO}:User.orders`); decorates(db, `${REPO}:User.orders`, 'OneToMany', '() => Order'); typeRef(db, `${REPO}:User.orders`, 'Order')
  cls(db, `${REPO}:Order`, 'Order'); decorates(db, `${REPO}:Order`, 'Entity')
  prop(db, `${REPO}:Order.id`, 'id'); contains(db, `${REPO}:Order`, `${REPO}:Order.id`); decorates(db, `${REPO}:Order.id`, 'PrimaryColumn')
}

const typeormSpec: ModelAdapterSpec = {
  id: 'model.adapter.typeorm', orm: 'typeorm', clientPackages: ['typeorm'],
  entityDecorators: ['Entity', 'ChildEntity'], tableNameArgKey: 'name',
  columnDecorators: ['Column', 'PrimaryColumn', 'PrimaryGeneratedColumn', 'CreateDateColumn', 'UpdateDateColumn'],
  primaryDecorators: ['PrimaryColumn', 'PrimaryGeneratedColumn'],
  relationDecoratorTypes: { OneToMany: 'oneToMany', ManyToOne: 'manyToOne', OneToOne: 'oneToOne', ManyToMany: 'manyToMany' },
}

describe('GraphQuerySpecAdapter', () => {
  let db: DB
  beforeEach(() => { db = createTestDb() })

  it('S8: runs a spec against the code graph → ModelRaw (entity/column/relation/table_name)', async () => {
    seedTypeormAnchor(db)
    const models = await new GraphQuerySpecAdapter(typeormSpec).queryFromGraph(db, REPO)
    const user = models.find((m) => m.name === 'User')
    expect(user?.table_name).toBe('users') // from @Entity('users')
    expect(user?.fields.map((f) => f.name).sort()).toEqual(['email', 'id'])
    expect(user?.fields.find((f) => f.name === 'id')?.primary).toBe(true)
    expect(user?.relations).toEqual([{ name: 'orders', target_model: 'Order', type: 'oneToMany', line: 0 }])
    const order = models.find((m) => m.name === 'Order')
    expect(order?.table_name).toBe('order') // snake_case(Order) fallback (no entity arg)
  })

  it('cross-ORM gate: returns [] when the repo does not import any clientPackage', async () => {
    seedTypeormAnchor(db) // imports 'typeorm'
    const otherSpec: ModelAdapterSpec = { ...typeormSpec, id: 'x', orm: 'neworm', clientPackages: ['@neworm/core'] }
    const models = await new GraphQuerySpecAdapter(otherSpec).queryFromGraph(db, REPO)
    expect(models).toEqual([])
  })

  it('S9 faithfulness keystone: spec adapter shape == TypeOrmGraphAdapter shape on the same graph', async () => {
    seedTypeormAnchor(db)
    const specModels = await new GraphQuerySpecAdapter(typeormSpec).queryFromGraph(db, REPO)
    const realModels = await new TypeOrmGraphAdapter().queryFromGraph(db, REPO)
    const shapeByName = (ms: Awaited<ReturnType<TypeOrmGraphAdapter['queryFromGraph']>>) =>
      Object.fromEntries(ms.map((m) => [m.name, toModelShape(m)]))
    expect(shapeByName(specModels)).toEqual(shapeByName(realModels))
  })
})
