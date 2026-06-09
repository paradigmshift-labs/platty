/**
 * build_relations — wrapper-chain DB access, end-to-end build_graph → build_relations.
 *
 * SOT: REL-S28 (db_access_semantic.test.ts) proves build_relations converts a hand-built
 *      edge {chainPath:'getPrismaDB(tx).order', targetSymbol:'create'} into a db_access relation.
 *      This test closes the loop: the HANDLER is parsed by the real TypeScriptParserAdapter, so
 *      the consumed call edge is produced by build_graph itself (the wrapper-chain emission fixed
 *      in call_edge_ops.ts). The wrapper's db_client identity (build_relations' own concern, already
 *      covered by REL-S28) is supplied synthetically in the same shape REL-S28 uses.
 *
 *      Before the fix, build_graph emitted NO `update`/`updateMany` edge for getPrismaDB(tx).<model>.<m>(),
 *      so build_relations had no material → zero db_access relations. This asserts the material now flows.
 */

import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { normalizeRelations } from '@/pipeline_modules/build_relations/normalize_relations.js'
import type {
  BuildRelationsInputs,
  CodeEdgeLike,
  CodeNodeLike,
  ModelLookup,
} from '@/pipeline_modules/build_relations/types.js'

const REPO_ID = 'repo_wrapper_chain'
const HANDLER_FILE = 'src/order.service.ts'

// raw(snake_case) → like(camelCase): mirrors Drizzle's column→key mapping on DB read.
// (identical mapping to api_call_jvm_spring.test.ts's end-to-end block)
function mapParsed(parsed: { nodes: readonly any[]; edges: readonly any[] }, edgeBase: number) {
  const nodes: CodeNodeLike[] = parsed.nodes.map((n) => ({
    id: n.id,
    repoId: n.repo_id,
    type: n.type,
    name: n.name,
    filePath: n.file_path,
    lineStart: n.line_start,
    lineEnd: n.line_end,
    isTest: n.is_test,
    parseStatus: n.parse_status,
  }))
  let i = edgeBase
  const edges: CodeEdgeLike[] = parsed.edges.map((e) => ({
    id: i++,
    repoId: e.repo_id,
    sourceId: e.source_id,
    targetId: e.target_id,
    relation: e.relation,
    targetSpecifier: e.target_specifier,
    targetSymbol: e.target_symbol,
    typeRefSubtype: e.type_ref_subtype ?? null,
    chainPath: e.chain_path ?? null,
    firstArg: e.first_arg ?? null,
    literalArgs: e.literal_args ?? null,
    argExpressions: e.arg_expressions ?? null,
    resolveStatus: e.resolve_status === 'n/a' ? 'pending' : e.resolve_status,
    confidence: e.confidence ?? null,
    source: e.source ?? 'static',
  }))
  return { nodes, edges }
}

// getPrismaDB wrapper db_client identity — supplied the same way REL-S28 does (import edge on the
// wrapper node). NOT what this test exercises; it's the precondition build_relations already covers.
function wrapperDbClient() {
  const wrapperNode: CodeNodeLike = {
    id: `${REPO_ID}:src/common.ts:getPrismaDB`,
    repoId: REPO_ID,
    type: 'function',
    name: 'getPrismaDB',
    filePath: 'src/common.ts',
    lineStart: 1,
    lineEnd: 5,
    isTest: false,
    parseStatus: 'ok',
  }
  const importEdge: CodeEdgeLike = {
    id: 99_000,
    repoId: REPO_ID,
    sourceId: wrapperNode.id,
    targetId: null,
    relation: 'imports',
    targetSpecifier: '@prisma/client',
    targetSymbol: 'PrismaClient',
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    argExpressions: null,
    resolveStatus: 'resolved',
    confidence: null,
    source: 'static',
  }
  return { wrapperNode, importEdge }
}

function runPipeline(nodes: CodeNodeLike[], edges: CodeEdgeLike[], models: ModelLookup[]) {
  const inputs: BuildRelationsInputs = {
    repoId: REPO_ID,
    repoPath: null,
    includeTestSources: false,
    nodes,
    edges,
    models,
  }
  const index = buildSemanticIndex(inputs)
  const candidates = extractCandidates(inputs, index)
  const extracted = resolveCandidates(candidates, index, { resolveConstant: () => null })
  return normalizeRelations(extracted)
}

const adapter = new TypeScriptParserAdapter()

describe('wrapper-chain DB access — end-to-end build_graph → build_relations', () => {
  it('WC-INT-01: real parse of getPrismaDB(tx).user.update() → db_access update on users', () => {
    const parsed = adapter.parseFile(
      `import { getPrismaDB } from './common'
export async function updateUser(tx: any, id: number) {
  return getPrismaDB(tx).user.update({ where: { id }, data: { name: 'x' } })
}`,
      HANDLER_FILE,
      REPO_ID,
    )
    const { nodes, edges } = mapParsed(parsed, 80_000)
    const { wrapperNode, importEdge } = wrapperDbClient()

    const relations = runPipeline(
      [...nodes, wrapperNode],
      [...edges, importEdge],
      [{ modelName: 'User', tableName: 'users', orm: 'prisma' }],
    )

    const dbRel = relations.find((r) => r.kind === 'db_access' && r.target === 'users')
    expect(dbRel, 'db_access on users from the real wrapper-chain parse').toBeDefined()
    expect(dbRel?.operation).toBe('update')
  })

  it('WC-INT-02: real parse of getPrismaDB(tx).feed.updateMany() → db_access update on feeds', () => {
    const parsed = adapter.parseFile(
      `import { getPrismaDB } from './common'
export async function bumpFeeds(tx: any) {
  return getPrismaDB(tx).feed.updateMany({ data: { pinned: false } })
}`,
      'src/feed.service.ts',
      REPO_ID,
    )
    const { nodes, edges } = mapParsed(parsed, 85_000)
    const { wrapperNode, importEdge } = wrapperDbClient()

    const relations = runPipeline(
      [...nodes, wrapperNode],
      [...edges, importEdge],
      [{ modelName: 'Feed', tableName: 'feeds', orm: 'prisma' }],
    )

    const dbRel = relations.find((r) => r.kind === 'db_access' && r.target === 'feeds')
    expect(dbRel, 'db_access on feeds from the real wrapper-chain parse').toBeDefined()
    expect(dbRel?.operation).toBe('update')
  })
})
