import { describe, it, expect } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/index.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { evaluateModelAdapterForPromotion } from '@/pipeline_modules/build_models/rule_authoring/promote_gate.js'
import { PROMOTED_MODEL_ADAPTERS } from '@/pipeline_modules/build_models/rule_authoring/promoted_model_adapters.js'
import type { ModelAdapterSpec, ModelShape } from '@/pipeline_modules/build_models/rule_authoring/types.js'

// Keystone: every graph-query spec in the build_models rulebook must PROMOTE on a representative anchor
// AND stay clean on the other ORMs' anchors (the import gate is the only thing that distinguishes them —
// decorator names like Entity/OneToMany overlap across ORMs). The anchor is built generically from each
// spec's own decorator names, so the expected shape is identical across ORMs and a wrong decorator list
// can't slip through. Tested-by-construction — mirrors build_relations' promoted_*_rules keystone.

// The hand-known shape every anchor must reproduce (fields/relations pre-sorted by name, as toModelShape does).
const EXPECTED: ModelShape[] = [
  {
    name: 'User', table_name: 'users',
    fields: [{ name: 'email', primary: false }, { name: 'id', primary: true }],
    relations: [{ name: 'orders', type: 'oneToMany', target_model: 'Order' }],
  },
  { name: 'Order', table_name: 'order', fields: [{ name: 'id', primary: true }], relations: [] },
]

function nonPrimaryColumnDecorator(spec: ModelAdapterSpec): string {
  const d = spec.columnDecorators.find((c) => !spec.primaryDecorators.includes(c))
  if (!d) throw new Error(`${spec.id}: no non-primary column decorator`)
  return d
}
function oneToManyDecorator(spec: ModelAdapterSpec): string {
  const entry = Object.entries(spec.relationDecoratorTypes).find(([, v]) => v === 'oneToMany')
  if (!entry) throw new Error(`${spec.id}: no oneToMany relation decorator`)
  return entry[0]
}

function cls(db: DB, repoId: string, id: string, name: string): void {
  db.insert(codeNodes).values({ id, repoId, type: 'class', name, filePath: 'src/e.ts', lineStart: 1, lineEnd: 30, exported: true }).run()
}
function prop(db: DB, repoId: string, id: string): void {
  db.insert(codeNodes).values({ id, repoId, type: 'property', name: id.split('.').pop()!, filePath: 'src/e.ts', lineStart: 5, exported: false }).run()
}
function imports(db: DB, repoId: string, spec: string): void {
  db.insert(codeEdges).values({ repoId, sourceId: `${repoId}:src/e.ts`, targetId: null, relation: 'imports', targetSpecifier: spec, resolveStatus: 'resolved', source: 'static' }).run()
}
function decorates(db: DB, repoId: string, sourceId: string, sym: string, firstArg: string | null = null): void {
  db.insert(codeEdges).values({ repoId, sourceId, targetId: null, relation: 'decorates', targetSymbol: sym, firstArg, resolveStatus: 'resolved', source: 'static' }).run()
}
function contains(db: DB, repoId: string, classId: string, propId: string): void {
  db.insert(codeEdges).values({ repoId, sourceId: classId, targetId: propId, relation: 'contains', resolveStatus: 'resolved', source: 'static' }).run()
}
function typeRef(db: DB, repoId: string, propId: string, sym: string): void {
  db.insert(codeEdges).values({ repoId, sourceId: propId, targetId: null, relation: 'type_ref', targetSymbol: sym, resolveStatus: 'pending', source: 'static' }).run()
}

// Build a representative anchor from the spec's OWN decorator names:
//   import <pkg>; @<Entity>('users') class User { @<Primary> id; @<Column> email; @<OneToMany>(()=>Order) orders }
//   @<Entity> class Order { @<Primary> id }   → reproduces EXPECTED for any decorator ORM.
function seedAnchor(spec: ModelAdapterSpec): { db: DB; repoId: string } {
  const db = createTestDb()
  const repoId = `repo_${spec.orm.replace(/[^a-z0-9]/gi, '_')}`
  db.insert(projects).values({ id: `${repoId}_p`, name: repoId }).run()
  db.insert(repositories).values({ id: repoId, projectId: `${repoId}_p`, name: repoId, repoPath: '/m' }).run()
  imports(db, repoId, spec.clientPackages[0])
  const entityDec = spec.entityDecorators[0]
  const primaryDec = spec.primaryDecorators[0]
  const colDec = nonPrimaryColumnDecorator(spec)
  const relDec = oneToManyDecorator(spec)

  cls(db, repoId, `${repoId}:User`, 'User'); decorates(db, repoId, `${repoId}:User`, entityDec, "'users'")
  prop(db, repoId, `${repoId}:User.id`); contains(db, repoId, `${repoId}:User`, `${repoId}:User.id`); decorates(db, repoId, `${repoId}:User.id`, primaryDec)
  prop(db, repoId, `${repoId}:User.email`); contains(db, repoId, `${repoId}:User`, `${repoId}:User.email`); decorates(db, repoId, `${repoId}:User.email`, colDec)
  prop(db, repoId, `${repoId}:User.orders`); contains(db, repoId, `${repoId}:User`, `${repoId}:User.orders`); decorates(db, repoId, `${repoId}:User.orders`, relDec, '() => Order'); typeRef(db, repoId, `${repoId}:User.orders`, 'Order')
  cls(db, repoId, `${repoId}:Order`, 'Order'); decorates(db, repoId, `${repoId}:Order`, entityDec)
  prop(db, repoId, `${repoId}:Order.id`); contains(db, repoId, `${repoId}:Order`, `${repoId}:Order.id`); decorates(db, repoId, `${repoId}:Order.id`, primaryDec)
  return { db, repoId }
}

describe('promoted model adapters — keystone (every spec promotes + mutually clean)', () => {
  it('rulebook is non-empty (verified graph-query specs)', () => {
    expect(PROMOTED_MODEL_ADAPTERS.length).toBeGreaterThan(0)
    expect(PROMOTED_MODEL_ADAPTERS.map((s) => s.orm)).toEqual(expect.arrayContaining(['typeorm', 'mikro-orm']))
  })

  const anchors = new Map(PROMOTED_MODEL_ADAPTERS.map((s) => [s.id, seedAnchor(s)]))
  for (const spec of PROMOTED_MODEL_ADAPTERS) {
    it(`${spec.id} → PROMOTE on its anchor, clean on other ORMs`, async () => {
      const mine = anchors.get(spec.id)!
      const foreign = PROMOTED_MODEL_ADAPTERS.filter((s) => s.id !== spec.id).map((s) => {
        const a = anchors.get(s.id)!
        return { fixture: s.orm, db: a.db, repoId: a.repoId }
      })
      const v = await evaluateModelAdapterForPromotion({
        candidate: spec, anchorDb: mine.db, anchorRepoId: mine.repoId, anchorExpected: EXPECTED, foreign,
      })
      expect({ promote: v.promote, reason: v.reason }).toMatchObject({ promote: true })
    })
  }
})
