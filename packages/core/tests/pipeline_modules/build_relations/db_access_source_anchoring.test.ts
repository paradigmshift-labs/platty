import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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

const REPO_ID = 'repo_db_anchor'
let edgeId = 1

function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id,
    repoId: REPO_ID,
    type: 'method',
    name: id.split(':').pop() ?? id,
    filePath: 'src/feed.usecase.ts',
    lineStart: 1,
    lineEnd: 20,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

function makeEdge(sourceId: string, relation: CodeEdgeLike['relation'], opts: Partial<CodeEdgeLike> = {}): CodeEdgeLike {
  return {
    id: edgeId++,
    repoId: REPO_ID,
    sourceId,
    targetId: null,
    relation,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    argExpressions: null,
    resolveStatus: 'resolved',
    confidence: null,
    source: 'static',
    ...opts,
  }
}

function makeInputs(partial: {
  nodes: CodeNodeLike[]
  edges: CodeEdgeLike[]
  models?: ModelLookup[]
  repoPath?: string | null
}): BuildRelationsInputs {
  return {
    repoId: REPO_ID,
    repoPath: partial.repoPath ?? null,
    includeTestSources: false,
    nodes: partial.nodes,
    edges: partial.edges,
    models: partial.models ?? [],
  }
}

function runPipeline(inputs: BuildRelationsInputs) {
  const index = buildSemanticIndex(inputs)
  const candidates = extractCandidates(inputs, index)
  const extracted = resolveCandidates(candidates, index, { resolveConstant: () => null })
  return normalizeRelations(extracted)
}

function makeSglobalPrismaEvidence() {
  const fileNode = makeNode(`${REPO_ID}:src/SGlobal.ts`, {
    type: 'file',
    name: 'src/SGlobal.ts',
    filePath: 'src/SGlobal.ts',
    lineStart: null,
    lineEnd: null,
  })
  const classNode = makeNode(`${REPO_ID}:src/SGlobal.ts:SGlobal`, {
    type: 'class',
    name: 'SGlobal',
    filePath: 'src/SGlobal.ts',
  })
  const prismaClientNode = makeNode(`${REPO_ID}:src/SGlobal.ts:SGlobal.prismaClient`, {
    type: 'property',
    name: 'SGlobal.prismaClient',
    filePath: 'src/SGlobal.ts',
  })
  const prismaNode = makeNode(`${REPO_ID}:src/SGlobal.ts:SGlobal.prisma`, {
    type: 'property',
    name: 'SGlobal.prisma',
    filePath: 'src/SGlobal.ts',
  })
  const nodes = [fileNode, classNode, prismaClientNode, prismaNode]
  const edges = [
    makeEdge(fileNode.id, 'imports', {
      targetSpecifier: '@prisma/client',
      targetSymbol: 'PrismaClient',
    }),
    makeEdge(classNode.id, 'contains', {
      targetId: prismaClientNode.id,
      targetSymbol: 'prismaClient',
    }),
    makeEdge(classNode.id, 'contains', {
      targetId: prismaNode.id,
      targetSymbol: 'prisma',
    }),
    makeEdge(prismaClientNode.id, 'calls', {
      targetSymbol: 'PrismaClient',
    }),
  ]
  return { nodes, edges }
}

describe('DB access source anchoring', () => {
  it('anchors class-sourced Prisma DB access to nearest executable method in the same class', () => {
    const classNode = makeNode(`${REPO_ID}:src/feed.usecase.ts:FeedUsecase`, {
      type: 'class',
      name: 'FeedUsecase',
      lineStart: 1,
      lineEnd: 40,
    })
    const executeNode = makeNode(`${REPO_ID}:src/feed.usecase.ts:FeedUsecase.execute`, {
      type: 'method',
      name: 'FeedUsecase.execute',
      lineStart: 12,
      lineEnd: 18,
    })
    const sglobalEvidence = makeSglobalPrismaEvidence()

    const result = runPipeline(makeInputs({
      nodes: [classNode, executeNode, ...sglobalEvidence.nodes],
      edges: [
        makeEdge(classNode.id, 'contains', {
          targetId: executeNode.id,
          targetSymbol: 'execute',
        }),
        ...sglobalEvidence.edges,
        makeEdge(classNode.id, 'calls', {
          targetSymbol: 'findMany',
          chainPath: 'SGlobal.prisma.feed',
          resolveStatus: 'external',
        }),
      ],
      models: [{ modelName: 'feed', tableName: 'feed', orm: 'prisma' }],
    }))

    expect(result).toHaveLength(1)
    expect(result.map((relation) => ({
      kind: relation.kind,
      sourceNodeId: relation.sourceNodeId,
      target: relation.target,
      operation: relation.operation,
      canonicalTarget: relation.canonicalTarget,
      payload: {
        orm: relation.payload.orm,
        method: relation.payload.method,
        modelName: relation.payload.modelName,
        tableName: relation.payload.tableName,
        sourceAnchoring: relation.payload.sourceAnchoring,
      },
    }))).toEqual([
      {
        kind: 'db_access',
        sourceNodeId: executeNode.id,
        target: 'feed',
        operation: 'select',
        canonicalTarget: 'db:feed:select',
        payload: {
          orm: 'prisma',
          method: 'findMany',
          modelName: 'feed',
          tableName: 'feed',
          sourceAnchoring: {
            rawSourceNodeId: classNode.id,
            anchoredSourceNodeId: executeNode.id,
            strategy: 'nearest_executable_ancestor',
          },
        },
      },
    ])
  })

  // (The prisma SGlobal source-static case moved to the GENERIC path — see db_access_semantic SGlobal tests.
  // The source-static ANCHORING mechanism is still exercised here via the remaining kysely source-static scan.)
  it('anchors source-static (kysely) DB access candidates to nearest executable method', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'platty-db-anchor-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(join(repoPath, 'src/feed.usecase.ts'), [
      "import { Kysely } from 'kysely'",
      'export class FeedUsecase {',
      '  async execute() {',
      "    return db.selectFrom('feed').selectAll().execute()",
      '  }',
      '}',
    ].join('\n'))

    const classNode = makeNode(`${REPO_ID}:src/feed.usecase.ts:FeedUsecase`, {
      type: 'class',
      name: 'FeedUsecase',
      lineStart: 2,
      lineEnd: 6,
    })
    const executeNode = makeNode(`${REPO_ID}:src/feed.usecase.ts:FeedUsecase.execute`, {
      type: 'method',
      name: 'FeedUsecase.execute',
      lineStart: 3,
      lineEnd: 5,
    })

    const result = runPipeline(makeInputs({
      repoPath,
      nodes: [classNode, executeNode],
      edges: [
        makeEdge(classNode.id, 'contains', {
          targetId: executeNode.id,
          targetSymbol: 'execute',
        }),
      ],
      models: [],
    }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      sourceNodeId: executeNode.id,
      target: 'feed',
      operation: 'select',
      canonicalTarget: 'db:feed:select',
      payload: {
        orm: 'kysely',
        sourceAnchoring: {
          rawSourceNodeId: classNode.id,
          anchoredSourceNodeId: executeNode.id,
          strategy: 'nearest_executable_ancestor',
        },
      },
    })
  })

  it('keeps property initializer source when no executable owner exists', () => {
    const classNode = makeNode(`${REPO_ID}:src/cache.ts:Cache`, {
      type: 'class',
      name: 'Cache',
      filePath: 'src/cache.ts',
      lineStart: 1,
      lineEnd: 8,
    })
    const propertyNode = makeNode(`${REPO_ID}:src/cache.ts:Cache.seed`, {
      type: 'property',
      name: 'Cache.seed',
      filePath: 'src/cache.ts',
      lineStart: 3,
      lineEnd: 3,
    })
    const sglobalEvidence = makeSglobalPrismaEvidence()

    const result = runPipeline(makeInputs({
      nodes: [classNode, propertyNode, ...sglobalEvidence.nodes],
      edges: [
        makeEdge(classNode.id, 'contains', {
          targetId: propertyNode.id,
          targetSymbol: 'seed',
        }),
        ...sglobalEvidence.edges,
        makeEdge(propertyNode.id, 'calls', {
          targetSymbol: 'findMany',
          chainPath: 'SGlobal.prisma.feed',
          resolveStatus: 'external',
        }),
      ],
      models: [{ modelName: 'feed', tableName: 'feed', orm: 'prisma' }],
    }))

    expect(result).toHaveLength(1)
    expect(result.map((relation) => ({
      kind: relation.kind,
      sourceNodeId: relation.sourceNodeId,
      target: relation.target,
      operation: relation.operation,
      canonicalTarget: relation.canonicalTarget,
      payload: {
        orm: relation.payload.orm,
        method: relation.payload.method,
        modelName: relation.payload.modelName,
        tableName: relation.payload.tableName,
        sourceAnchoring: relation.payload.sourceAnchoring,
      },
    }))).toEqual([
      {
        kind: 'db_access',
        sourceNodeId: propertyNode.id,
        target: 'feed',
        operation: 'select',
        canonicalTarget: 'db:feed:select',
        payload: {
          orm: 'prisma',
          method: 'findMany',
          modelName: 'feed',
          tableName: 'feed',
          sourceAnchoring: undefined,
        },
      },
    ])
  })

  it('does not attach a class-level Board update relation to a sibling Feed count method', () => {
    const controllerClass = makeNode(`${REPO_ID}:src/feed-board.controller.ts:FeedBoardController`, {
      type: 'class',
      name: 'FeedBoardController',
      filePath: 'src/feed-board.controller.ts',
      lineStart: 1,
      lineEnd: 30,
    })
    const feedCountNode = makeNode(`${REPO_ID}:src/feed-board.controller.ts:FeedController.getFeedCount`, {
      type: 'method',
      name: 'FeedController.getFeedCount',
      filePath: 'src/feed-board.controller.ts',
      lineStart: 5,
      lineEnd: 8,
    })
    const boardUpdateNode = makeNode(`${REPO_ID}:src/feed-board.controller.ts:BoardController.updateBoard`, {
      type: 'method',
      name: 'BoardController.updateBoard',
      filePath: 'src/feed-board.controller.ts',
      lineStart: 14,
      lineEnd: 18,
    })
    const sglobalEvidence = makeSglobalPrismaEvidence()

    const result = runPipeline(makeInputs({
      nodes: [controllerClass, feedCountNode, boardUpdateNode, ...sglobalEvidence.nodes],
      edges: [
        makeEdge(controllerClass.id, 'contains', {
          targetId: feedCountNode.id,
          targetSymbol: 'getFeedCount',
        }),
        makeEdge(controllerClass.id, 'contains', {
          targetId: boardUpdateNode.id,
          targetSymbol: 'updateBoard',
        }),
        ...sglobalEvidence.edges,
        makeEdge(feedCountNode.id, 'calls', {
          targetSymbol: 'count',
          chainPath: 'SGlobal.prisma.feed',
          resolveStatus: 'external',
        }),
        makeEdge(controllerClass.id, 'calls', {
          targetSymbol: 'update',
          chainPath: 'SGlobal.prisma.board',
          resolveStatus: 'external',
        }),
      ],
      models: [
        { modelName: 'feed', tableName: 'Feed', orm: 'prisma' },
        { modelName: 'board', tableName: 'Board', orm: 'prisma' },
      ],
    }))

    const feedCountRelations = result
      .filter((relation) => relation.sourceNodeId === feedCountNode.id)
      .map((relation) => relation.canonicalTarget)
    const boardUpdateRelations = result
      .filter((relation) => relation.sourceNodeId === boardUpdateNode.id)
      .map((relation) => relation.canonicalTarget)

    expect(feedCountRelations).toContain('db:Feed:select')
    expect(feedCountRelations).not.toContain('db:Board:update')
    expect(boardUpdateRelations).toContain('db:Board:update')
  })
})
