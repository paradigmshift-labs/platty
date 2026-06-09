import { describe, expect, it } from 'vitest'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractPatternProfileRelationCandidates } from '@/pipeline_modules/build_relations/adapters/profile_dsl.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { normalizeRelations } from '@/pipeline_modules/build_relations/normalize_relations.js'
import type {
  BuildRelationsInputs,
  CodeEdgeLike,
  CodeNodeLike,
} from '@/pipeline_modules/build_relations/types.js'
import {
  composeStaticAnalysisPatternProfile,
  createTestOnlyProfileWithCandidateRules,
  type StaticAnalysisPatternProfile,
} from '@/pipeline_modules/shared/static_config/index.js'

const REPO_ID = 'profile_dsl_rel'

function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id,
    repoId: REPO_ID,
    type: 'method',
    name: id.split(':').pop() ?? id,
    filePath: 'src/service.ts',
    lineStart: 1,
    lineEnd: 10,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

let edgeId = 5000
function makeEdge(sourceId: string, relation: string, opts: Partial<CodeEdgeLike> = {}): CodeEdgeLike {
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

function makeConfig(partial: Partial<StaticAnalysisPatternProfile>): StaticAnalysisPatternProfile {
  return {
    version: 1,
    generatedAt: '2026-05-22T00:00:00.000Z',
    builtFromCommit: null,
    validity: 'fresh',
    graphSchemaVersion: 'static-config-graph-v1',
    analysisMode: 'deterministic_with_pattern_profile',
    language: 'typescript',
    frameworks: [],
    sources: { defaultConfigVersion: 'test' },
    routePatterns: { customDecorators: {}, routingFiles: [] },
    relationPatterns: { dbClients: [], apiClients: [], functionWrappers: [], sdkAliases: [] },
    serviceMapHints: { apiBasePaths: [], generatedClientMappings: [], repoAffinity: [] },
    rules: [],
    diagnostics: [],
    ...partial,
  }
}

function runPipeline(inputs: BuildRelationsInputs) {
  const index = buildSemanticIndex(inputs)
  const candidates = extractCandidates(inputs, index)
  const extracted = resolveCandidates(candidates, index, { resolveConstant: () => null })
  return normalizeRelations(extracted)
}

describe('profile_dsl relation extractor', () => {
  it('creates db_access candidates from generic pattern profile rules', () => {
    const handler = makeNode(`${REPO_ID}:src/users.ts:listUsers`)
    const result = runPipeline({
      repoId: REPO_ID,
      repoPath: null,
      includeTestSources: false,
      nodes: [handler],
      edges: [
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'findMany',
          chainPath: 'prisma.user',
        }),
      ],
      models: [{ modelName: 'User', tableName: 'users', orm: 'prisma' }],
      staticAnalysisPatternProfile: makeConfig({
        rules: [{
          id: 'db.prisma.direct',
          state: 'active',
          source: 'default',
          target: 'relation.db_access',
          match: {
            relation: 'calls',
            targetSymbolIn: ['findMany'],
            chainPathPattern: '{client}.{model}',
          },
          emit: {
            targetFrom: 'chainPathSegment:model',
            operationFrom: 'targetSymbol',
          },
        }],
      }),
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'users',
      operation: 'select',
      payload: {
        orm: 'prisma',
        adapter: 'pattern_dsl',
        configPatternId: 'db.prisma.direct',
      },
    })
  })

  it('attributes composed user-config rules from the user layer even when input source is mistagged', () => {
    const handler = makeNode(`${REPO_ID}:src/messages.ts:sendMessage`)
    const profile = composeStaticAnalysisPatternProfile({
      repoId: REPO_ID,
      builtFromCommit: null,
      mode: 'deterministic_with_pattern_profile',
      userConfig: {
        version: 1,
        rules: [{
          id: 'postmark.send.user_config',
          state: 'active',
          source: 'default',
          target: 'relation.api_call',
          match: {
            relation: 'calls',
            targetSymbolIn: ['sendEmail'],
            chainPathEquals: 'postmarkClient',
          },
          emit: {
            targetFrom: 'targetSymbol',
            operationValue: 'POST',
          },
        }],
      },
      graphEvidence: { nodeIds: [handler.id], edgeIds: [], filePaths: ['src/messages.ts'] },
    })
    const result = runPipeline({
      repoId: REPO_ID,
      repoPath: null,
      includeTestSources: false,
      nodes: [handler],
      edges: [
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'sendEmail',
          chainPath: 'postmarkClient',
        }),
      ],
      models: [],
      staticAnalysisPatternProfile: profile,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: 'sendEmail',
      payload: {
        configPatternId: 'postmark.send.user_config',
        configSource: 'user',
        source: 'user_config',
      },
    })
  })

  it('uses generic db_access DSL operationValue before the raw call symbol', () => {
    const handler = makeNode(`${REPO_ID}:src/messages.ts:listMessages`)
    const result = runPipeline({
      repoId: REPO_ID,
      repoPath: null,
      includeTestSources: false,
      nodes: [handler],
      edges: [
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'selectFrom',
          chainPath: 'db',
          firstArg: 'message_delivery',
        }),
      ],
      models: [],
      staticAnalysisPatternProfile: makeConfig({
        rules: [{
          id: 'kysely.select_from.user_config',
          state: 'active',
          source: 'user',
          target: 'relation.db_access',
          match: {
            relation: 'calls',
            targetSymbolIn: ['selectFrom'],
            chainPathEquals: 'db',
          },
          emit: {
            targetFrom: 'firstArg',
            operationValue: 'select',
          },
        }],
      }),
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'message_delivery',
      operation: 'select',
      canonicalTarget: 'db:message_delivery:select',
      payload: {
        method: 'select',
        configPatternId: 'kysely.select_from.user_config',
        source: 'user_config',
      },
    })
  })

  it('creates db_access candidates only from graph call evidence plus config pattern', () => {
    const handler = makeNode(`${REPO_ID}:src/orders.ts:listOrders`)
    const inputs: BuildRelationsInputs = {
      repoId: REPO_ID,
      repoPath: null,
      includeTestSources: false,
      nodes: [handler],
      edges: [
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'findMany',
          chainPath: 'this.prisma.order',
        }),
      ],
      models: [{ modelName: 'Order', tableName: 'orders', orm: 'prisma' }],
      staticAnalysisPatternProfile: makeConfig({
        relationPatterns: {
          dbClients: [{
            receiver: 'this.prisma',
            orm: 'prisma',
            ownerType: 'PrismaService',
            configSource: 'user',
            evidence: {
              confidence: 'high',
              source: 'manual',
              evidenceNodeIds: ['edge:cfg'],
              filePaths: [],
              builtFromCommit: null,
              reason: 'fixture config',
            },
          }],
          apiClients: [],
          functionWrappers: [],
          sdkAliases: [],
        },
      }),
    }

    const result = runPipeline(inputs)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'db_access',
      target: 'orders',
      operation: 'select',
      canonicalTarget: 'db:orders:select',
      payload: {
        adapter: 'profile_dsl_db_client',
        configPatternId: 'profile-dsl:db:this.prisma',
        configSource: 'user',
        source: 'user_config',
      },
    })
    expect(result[0].payload.configEvidenceRef).toMatchObject({
      evidenceNodeIds: ['edge:cfg'],
      builtFromCommit: null,
      graphSchemaVersion: 'static-config-graph-v1',
    })
    expect(result[0].evidenceNodeIds[0]).toMatch(/^edge:\d+$/)
  })

  it('resolves multiple approved DSL relation patterns in the same repo', () => {
    const handler = makeNode(`${REPO_ID}:src/services/dashboard.ts:loadDashboard`)
    const result = runPipeline({
      repoId: REPO_ID,
      repoPath: null,
      includeTestSources: false,
      nodes: [handler],
      edges: [
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'findMany',
          chainPath: 'prisma.user',
        }),
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'selectFrom',
          chainPath: 'db.selectFrom',
          firstArg: 'orders',
        }),
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'get',
          chainPath: 'apiClient',
          firstArg: '/orders',
        }),
      ],
      models: [{ modelName: 'User', tableName: 'users', orm: 'prisma' }],
      staticAnalysisPatternProfile: makeConfig({
        rules: [
          {
            id: 'db.prisma.direct',
            state: 'active',
            source: 'default',
            target: 'relation.db_access',
            match: {
              relation: 'calls',
              targetSymbolIn: ['findMany'],
              chainPathPattern: 'prisma.{model}',
            },
            emit: {
              targetFrom: 'chainPathSegment:model',
              operationFrom: 'targetSymbol',
            },
          },
          {
            id: 'db.kysely.selectFrom',
            state: 'active',
            source: 'user',
            target: 'relation.db_access',
            match: {
              relation: 'calls',
              targetSymbolIn: ['selectFrom'],
              chainPathEquals: 'db.selectFrom',
            },
            emit: {
              targetFrom: 'firstArg',
              operationValue: 'select',
            },
          },
          {
            id: 'api.internal.get',
            state: 'active',
            source: 'user',
            target: 'relation.api_call',
            match: {
              relation: 'calls',
              targetSymbolIn: ['get'],
              chainPathEquals: 'apiClient',
            },
            emit: {
              targetFrom: 'firstArg',
              operationValue: 'GET',
            },
          },
        ],
      }),
    })

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'db_access',
        target: 'users',
        payload: expect.objectContaining({ configPatternId: 'db.prisma.direct' }),
      }),
      expect.objectContaining({
        kind: 'db_access',
        target: 'orders',
        payload: expect.objectContaining({ configPatternId: 'db.kysely.selectFrom' }),
      }),
      expect.objectContaining({
        kind: 'api_call',
        target: '/orders',
        operation: 'GET',
        payload: expect.objectContaining({ configPatternId: 'api.internal.get' }),
      }),
    ]))
  })

  it('extracts relation candidates from promoted candidate DSL rules without legacy candidate adapters', () => {
    const handler = makeNode(`${REPO_ID}:src/services/dashboard.ts:loadDashboard`)
    const inputs: BuildRelationsInputs = {
      repoId: REPO_ID,
      repoPath: null,
      includeTestSources: false,
      nodes: [handler],
      edges: [
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'findMany',
          chainPath: 'prisma.user',
        }),
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'selectFrom',
          chainPath: 'db',
          firstArg: 'orders',
        }),
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'insertInto',
          chainPath: 'db',
          firstArg: 'auditLogs',
        }),
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'get',
          chainPath: 'apiClient',
          firstArg: '/orders',
        }),
      ],
      models: [{ modelName: 'User', tableName: 'users', orm: 'prisma' }],
      staticAnalysisPatternProfile: createTestOnlyProfileWithCandidateRules(makeConfig({
        rules: [],
        candidateConfig: {
          rules: [
            {
              id: 'db.prisma.direct_candidate',
              state: 'candidate',
              source: 'agent_candidate',
              target: 'relation.db_access',
              match: {
                relation: 'calls',
                targetSymbolIn: ['findMany'],
                chainPathPattern: 'prisma.{model}',
              },
              emit: {
                targetFrom: 'chainPathSegment:model',
                operationFrom: 'targetSymbol',
              },
            },
            {
              id: 'db.kysely.select_from_candidate',
              state: 'candidate',
              source: 'agent_candidate',
              target: 'relation.db_access',
              match: {
                relation: 'calls',
                targetSymbolIn: ['selectFrom'],
                chainPathEquals: 'db',
              },
              emit: {
                targetFrom: 'firstArg',
                operationValue: 'select',
              },
            },
            {
              id: 'db.kysely.insert_into_candidate',
              state: 'candidate',
              source: 'agent_candidate',
              target: 'relation.db_access',
              match: {
                relation: 'calls',
                targetSymbolIn: ['insertInto'],
                chainPathEquals: 'db',
              },
              emit: {
                targetFrom: 'firstArg',
                operationValue: 'insert',
              },
            },
            {
              id: 'api.internal_client.get_candidate',
              state: 'candidate',
              source: 'agent_candidate',
              target: 'relation.api_call',
              match: {
                relation: 'calls',
                targetSymbolIn: ['get'],
                chainPathEquals: 'apiClient',
              },
              emit: {
                targetFrom: 'firstArg',
                operationValue: 'GET',
              },
            },
          ],
          rejectedRules: [],
          diagnostics: [],
        },
      })),
    }
    const index = buildSemanticIndex(inputs)

    const candidates = extractPatternProfileRelationCandidates(inputs, index)

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'db_access',
        chainPath: 'prisma.user',
        payload: expect.objectContaining({
          adapter: 'pattern_dsl',
          configPatternId: 'db.prisma.direct_candidate',
        }),
      }),
      expect.objectContaining({
        kind: 'db_access',
        firstArg: 'orders',
        payload: expect.objectContaining({
          adapter: 'pattern_dsl',
          configPatternId: 'db.kysely.select_from_candidate',
        }),
      }),
      expect.objectContaining({
        kind: 'db_access',
        firstArg: 'auditLogs',
        payload: expect.objectContaining({
          adapter: 'pattern_dsl',
          configPatternId: 'db.kysely.insert_into_candidate',
        }),
      }),
      expect.objectContaining({
        kind: 'api_call',
        rawTarget: '/orders',
        payload: expect.objectContaining({
          adapter: 'pattern_dsl',
          configPatternId: 'api.internal_client.get_candidate',
        }),
      }),
    ]))
    expect(candidates.every((candidate) => candidate.payload.adapter === 'pattern_dsl')).toBe(true)
  })

  it('does not create a relation from config text without a call edge', () => {
    const handler = makeNode(`${REPO_ID}:src/orders.ts:listOrders`)
    const result = runPipeline({
      repoId: REPO_ID,
      repoPath: null,
      includeTestSources: false,
      nodes: [handler],
      edges: [],
      models: [{ modelName: 'Order', tableName: 'orders', orm: 'prisma' }],
      staticAnalysisPatternProfile: makeConfig({
        relationPatterns: {
          dbClients: [{
            receiver: 'this.prisma',
            orm: 'prisma',
            configSource: 'user',
            evidence: {
              confidence: 'high',
              source: 'manual',
              evidenceNodeIds: ['edge:cfg'],
              filePaths: [],
              builtFromCommit: null,
              reason: 'fixture config',
            },
          }],
          apiClients: [],
          functionWrappers: [],
          sdkAliases: [],
        },
      }),
    })

    expect(result).toEqual([])
  })

  it('maps configured API client methods without package-specific hardcoding', () => {
    const handler = makeNode(`${REPO_ID}:src/orders.ts:listOrders`)
    const result = runPipeline({
      repoId: REPO_ID,
      repoPath: null,
      includeTestSources: false,
      nodes: [handler],
      edges: [
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'get',
          chainPath: 'apiClient',
          firstArg: '/orders',
        }),
      ],
      models: [],
      staticAnalysisPatternProfile: makeConfig({
        relationPatterns: {
          dbClients: [],
          apiClients: [{
            receiver: 'apiClient',
            protocol: 'rest',
            basePath: '/api',
            methods: { get: 'GET' },
            configSource: 'user',
            evidence: {
              confidence: 'high',
              source: 'manual',
              evidenceNodeIds: ['edge:cfg-api'],
              filePaths: [],
              builtFromCommit: null,
              reason: 'fixture config',
            },
          }],
          functionWrappers: [],
          sdkAliases: [],
        },
      }),
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/orders',
      operation: 'GET',
      canonicalTarget: 'GET /api/orders',
      payload: {
        adapter: 'profile_dsl_api_client',
        configPatternId: 'profile-dsl:api:apiClient',
        configSource: 'user',
        source: 'user_config',
      },
    })
  })

  it('does not consume llm_candidate evidence before approval', () => {
    const handler = makeNode(`${REPO_ID}:src/orders.ts:listOrders`)
    const result = runPipeline({
      repoId: REPO_ID,
      repoPath: null,
      includeTestSources: false,
      nodes: [handler],
      edges: [
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'findMany',
          chainPath: 'this.prisma.order',
        }),
      ],
      models: [{ modelName: 'Order', tableName: 'orders', orm: 'prisma' }],
      staticAnalysisPatternProfile: makeConfig({
        relationPatterns: {
          dbClients: [{
            receiver: 'this.prisma',
            orm: 'prisma',
            configSource: 'agent_candidate',
            evidence: {
              confidence: 'high',
              source: 'llm_candidate',
              evidenceNodeIds: ['edge:cfg-candidate'],
              filePaths: [],
              builtFromCommit: null,
              reason: 'candidate only',
            },
          }],
          apiClients: [],
          functionWrappers: [],
          sdkAliases: [],
        },
      }),
    })

    expect(result).toEqual([])
  })

  it('ignores custom relation patterns in deterministic_only mode', () => {
    const handler = makeNode(`${REPO_ID}:src/orders.ts:listOrders`)
    const result = runPipeline({
      repoId: REPO_ID,
      repoPath: null,
      includeTestSources: false,
      nodes: [handler],
      edges: [
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'get',
          chainPath: 'apiClient',
          firstArg: '/orders',
        }),
      ],
      models: [],
      staticAnalysisPatternProfile: makeConfig({
        analysisMode: 'deterministic_only',
        relationPatterns: {
          dbClients: [],
          apiClients: [{
            receiver: 'apiClient',
            protocol: 'rest',
            basePath: '/api',
            methods: { get: 'GET' },
            configSource: 'user',
            evidence: {
              confidence: 'high',
              source: 'manual',
              evidenceNodeIds: ['edge:cfg-api'],
              filePaths: [],
              builtFromCommit: null,
              reason: 'fixture config',
            },
          }],
          functionWrappers: [],
          sdkAliases: [],
        },
      }),
    })

    expect(result).toEqual([])
  })

  it('supports Dart client wrappers through the same generic API config shape', () => {
    const handler = makeNode(`${REPO_ID}:lib/services/orders.dart:loadOrders`, {
      filePath: 'lib/services/orders.dart',
      name: 'loadOrders',
    })
    const result = runPipeline({
      repoId: REPO_ID,
      repoPath: null,
      includeTestSources: false,
      nodes: [handler],
      edges: [
        makeEdge(handler.id, 'calls', {
          targetSymbol: 'get',
          chainPath: 'dio',
          firstArg: '/orders',
        }),
      ],
      models: [],
      staticAnalysisPatternProfile: makeConfig({
        language: 'dart',
        frameworks: ['flutter'],
        relationPatterns: {
          dbClients: [],
          apiClients: [{
            receiver: 'dio',
            protocol: 'rest',
            basePath: '/v1',
            methods: { get: 'GET' },
            configSource: 'fixture',
            evidence: {
              confidence: 'high',
              source: 'manual',
              evidenceNodeIds: ['edge:cfg-dart'],
              filePaths: ['lib/services/orders.dart'],
              builtFromCommit: null,
              reason: 'dart fixture config',
            },
          }],
          functionWrappers: [],
          sdkAliases: [],
        },
      }),
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      canonicalTarget: 'GET /v1/orders',
      payload: {
        adapter: 'profile_dsl_api_client',
        configSource: 'fixture',
        source: 'fixture_config',
      },
    })
  })
})
