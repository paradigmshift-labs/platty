import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { runDbAccessRule } from '@/pipeline_modules/build_relations/rule_authoring/db_access_promote_gate.js'
import type { DbAccessRuleCandidate } from '@/pipeline_modules/build_relations/rule_authoring/db_access_types.js'

// Faithfulness keystone: the db_access referee's (table, operation) resolution must agree with the REAL
// pipeline (extractCandidates → resolveCandidates) for an EXISTING ORM (prisma), so an agent-authored NEW
// ORM is graded the same way the engine would treat it.

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
const uniqSort = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort()

describe('faithfulness: db_access referee vs real pipeline (existing ORM = prisma)', () => {
  it('a prisma rule reproduces the real pipeline db_access relations', async () => {
    edgeId = 1
    // repo.ts imports @prisma/client; const prisma = new PrismaClient(); prisma.user.findMany / prisma.order.create
    const file = node({ id: 'r1:repo.ts', type: 'file', filePath: 'repo.ts' })
    const fn = node({ id: 'r1:repo.ts:svc', type: 'function', filePath: 'repo.ts' })
    const edges: CodeEdgeLike[] = [
      edge({ sourceId: file.id, relation: 'imports', targetSpecifier: '@prisma/client', targetSymbol: 'PrismaClient' }),
      // const prisma = new PrismaClient()  → calls edge to PrismaClient (same-file ORM evidence anchor)
      edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'PrismaClient', chainPath: null }),
      edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'findMany', chainPath: 'prisma.user' }),
      edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'create', chainPath: 'prisma.order' }),
    ]
    const inputs: BuildRelationsInputs = { repoId: 'r1', repoPath: null, includeTestSources: false, nodes: [file, fn], edges, models: [] }
    const index = buildSemanticIndex(inputs)

    // REAL pipeline: extract → resolve → db_access canonicalTargets
    const realCands = extractCandidates(inputs, index)
    const realCanonical = uniqSort(
      resolveCandidates(realCands, index, { resolveConstant: () => null })
        .filter((r) => r.kind === 'db_access')
        .map((r) => r.canonicalTarget),
    )

    // REFEREE matcher: a prisma rule serializing the engine's method→operation classification
    const prismaRule: DbAccessRuleCandidate = {
      id: 'rel.db_access.prisma', ormLabel: 'prisma', clientPackages: ['@prisma/client'],
      operationByMethod: { findMany: 'select', create: 'insert' },
      anchorFixture: 'synthetic/prisma', anchorEvidenceEdgeIds: [], support: { matched: 2, examples: ['findMany', 'create'] },
    }
    const mineCanonical = uniqSort(runDbAccessRule(prismaRule, inputs, index).canonicalTargets)

    // the real pipeline must produce the prisma relations, and the referee must reproduce them exactly
    expect(realCanonical).toContain('db:user:select')
    expect(realCanonical).toContain('db:order:insert')
    expect(mineCanonical).toEqual(realCanonical)
  })
})
