import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { evaluateDbAccessRuleForPromotion } from '@/pipeline_modules/build_relations/rule_authoring/db_access_promote_gate.js'
import type { DbAccessRuleCandidate } from '@/pipeline_modules/build_relations/rule_authoring/db_access_types.js'

// Deterministic referee for agent-authored db_access (ORM) rules. Resolves a (table, operation) tuple by
// REUSING the engine's extractModelName; detection is import-based so a NEW ORM can be graded.

let edgeId = 1
function node(p: Partial<CodeNodeLike> & Pick<CodeNodeLike, 'id' | 'type' | 'filePath'>): CodeNodeLike {
  return { repoId: 'r1', name: p.id, lineStart: 1, lineEnd: 50, isTest: false, parseStatus: 'ok', ...p } as CodeNodeLike
}
function edge(p: Partial<CodeEdgeLike> & Pick<CodeEdgeLike, 'sourceId' | 'relation'>): CodeEdgeLike {
  return {
    id: edgeId++, repoId: 'r1', targetId: null, targetSpecifier: null, targetSymbol: null, typeRefSubtype: null,
    chainPath: null, firstArg: null, literalArgs: null, argExpressions: null, resolveStatus: 'resolved', confidence: null, source: 'static', ...p,
  } as CodeEdgeLike
}
function inputsOf(nodes: CodeNodeLike[], edges: CodeEdgeLike[]): BuildRelationsInputs {
  return { repoId: 'r1', repoPath: null, includeTestSources: false, nodes, edges, models: [] }
}

// prisma anchor: repo.ts imports @prisma/client; svc() calls prisma.user.findMany / prisma.order.create
function prismaAnchor() {
  edgeId = 1
  const file = node({ id: 'r1:repo.ts', type: 'file', filePath: 'repo.ts' })
  const fn = node({ id: 'r1:repo.ts:svc', type: 'function', filePath: 'repo.ts' })
  const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: '@prisma/client', targetSymbol: 'PrismaClient' })
  const find = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'findMany', chainPath: 'prisma.user' })
  const create = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'create', chainPath: 'prisma.order' })
  const inputs = inputsOf([file, fn], [imp, find, create])
  return { inputs, index: buildSemanticIndex(inputs), findId: find.id, createId: create.id }
}

function prismaCandidate(over: Partial<DbAccessRuleCandidate> = {}): DbAccessRuleCandidate {
  return {
    id: 'rel.db_access.prisma',
    ormLabel: 'prisma',
    clientPackages: ['@prisma/client'],
    operationByMethod: { findMany: 'select', create: 'insert', update: 'update', delete: 'delete' },
    anchorFixture: 'test/prisma',
    anchorEvidenceEdgeIds: [],
    anchorExpectedCanonical: ['db:user:select', 'db:order:insert'],
    support: { matched: 2, examples: ['findMany', 'create'] },
    ...over,
  }
}

// foreign mongoose repo: imports mongoose, calls userModel.find() — a NON-prisma ORM call.
function mongooseForeign() {
  const file = node({ id: 'r2:m.ts', type: 'file', filePath: 'm.ts' })
  const fn = node({ id: 'r2:m.ts:q', type: 'function', filePath: 'm.ts' })
  const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'mongoose' })
  const find = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'find', chainPath: 'userModel' })
  const inputs = inputsOf([file, fn], [imp, find])
  return { fixture: 'test/mongoose', inputs, index: buildSemanticIndex(inputs) }
}

describe('evaluateDbAccessRuleForPromotion', () => {
  it('happy: prisma rule reproduces its anchor, self-gates, clean, resolves db:{table}:{op} → promote', () => {
    const a = prismaAnchor()
    const v = evaluateDbAccessRuleForPromotion({
      candidate: prismaCandidate({ anchorEvidenceEdgeIds: [a.findId, a.createId] }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [mongooseForeign()],
    })
    expect(v.promote).toBe(true)
    expect(v.checks.anchorReproduction.pass).toBe(true)
    expect(v.checks.crossOrmClean.pass).toBe(true)
    expect(v.checks.anchorResolutionPrecision?.pass).toBe(true)
  })

  it('empty clientPackages → rejected', () => {
    const a = prismaAnchor()
    const v = evaluateDbAccessRuleForPromotion({
      candidate: prismaCandidate({ clientPackages: [], anchorEvidenceEdgeIds: [a.findId] }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.clientPackagesNonEmpty.pass).toBe(false)
  })

  it('anchor edge not caught → rejected (anchorReproduction)', () => {
    const a = prismaAnchor()
    const v = evaluateDbAccessRuleForPromotion({
      candidate: prismaCandidate({ anchorEvidenceEdgeIds: [99999] }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.anchorReproduction.pass).toBe(false)
  })

  it('cross-ORM: a prisma rule does NOT fire on a mongoose repo (import gate)', () => {
    const a = prismaAnchor()
    const v = evaluateDbAccessRuleForPromotion({
      candidate: prismaCandidate({ anchorEvidenceEdgeIds: [a.findId, a.createId] }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [mongooseForeign()],
    })
    expect(v.checks.crossOrmClean.pass).toBe(true)
    expect(v.checks.crossOrmClean.polluted).toEqual([])
  })

  it('wrong CRUD op map (create→select) resolves an out-of-key tuple → rejected (precision)', () => {
    const a = prismaAnchor()
    const v = evaluateDbAccessRuleForPromotion({
      candidate: prismaCandidate({
        operationByMethod: { findMany: 'select', create: 'select' }, // BUG: create is an insert
        anchorEvidenceEdgeIds: [a.findId, a.createId],
        anchorExpectedCanonical: ['db:user:select', 'db:order:insert'],
      }),
      anchorInputs: a.inputs, anchorIndex: a.index, foreignInputs: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.anchorResolutionPrecision?.pass).toBe(false)
    expect(v.checks.anchorResolutionPrecision?.overfired).toContain('db:order:select')
  })

  it('NEW ORM (not in the global registry): a rule for it still grades by its declared packages', () => {
    // 'drizzle-fake-orm' is not a known ORM; the rule supplies its packages + method map.
    edgeId = 1
    const file = node({ id: 'r3:d.ts', type: 'file', filePath: 'd.ts' })
    const fn = node({ id: 'r3:d.ts:run', type: 'function', filePath: 'd.ts' })
    const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'drizzle-fake-orm' })
    const sel = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'fetchAll', chainPath: 'db.accounts' })
    const inputs = inputsOf([file, fn], [imp, sel])
    const index = buildSemanticIndex(inputs)
    const v = evaluateDbAccessRuleForPromotion({
      candidate: {
        id: 'rel.db_access.drizzlefake', ormLabel: 'drizzlefake', clientPackages: ['drizzle-fake-orm'],
        operationByMethod: { fetchAll: 'select' }, anchorFixture: 'test/drizzlefake',
        anchorEvidenceEdgeIds: [sel.id], anchorExpectedCanonical: ['db:accounts:select'],
        support: { matched: 1, examples: ['fetchAll'] },
      },
      anchorInputs: inputs, anchorIndex: index, foreignInputs: [mongooseForeign()],
    })
    expect(v.promote).toBe(true) // the loop's value: a NEW ORM the engine didn't know, graded by its rule
  })

  it('tableSource:first_arg (drizzle db.insert(users)): table from the call first arg → db:users:insert', () => {
    // query-builder ORMs put the table in the first arg, not the chain — the loop-surfaced gap, now closed.
    edgeId = 1
    const file = node({ id: 'r1:d.ts', type: 'file', filePath: 'd.ts' })
    const fn = node({ id: 'r1:d.ts:run', type: 'function', filePath: 'd.ts' })
    const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'drizzle-orm' })
    const ins = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'insert', chainPath: 'db', firstArg: 'users' })
    const inputs = inputsOf([file, fn], [imp, ins])
    const index = buildSemanticIndex(inputs)
    const v = evaluateDbAccessRuleForPromotion({
      candidate: {
        id: 'rel.db_access.drizzle', ormLabel: 'drizzle', clientPackages: ['drizzle-orm'],
        operationByMethod: { select: 'select', insert: 'insert', update: 'update', delete: 'delete' },
        tableSource: 'first_arg', anchorFixture: 'test/drizzle', anchorEvidenceEdgeIds: [ins.id],
        anchorExpectedCanonical: ['db:users:insert'], support: { matched: 1, examples: ['insert'] },
      },
      anchorInputs: inputs, anchorIndex: index, foreignInputs: [],
    })
    expect(v.promote).toBe(true)
    expect(v.checks.anchorResolutionPrecision?.pass).toBe(true)
  })
})
