import { describe, expect, it } from 'vitest'
import { extractPatternProfileRouteEntries } from '@/pipeline_modules/build_route/profile_dsl.js'
import type { CodeEdge, CodeNode } from '@/db/schema/code_graph.js'
import {
  createTestOnlyProfileWithCandidateRules,
  type StaticAnalysisPatternProfile,
} from '@/pipeline_modules/shared/static_config/index.js'

const node: CodeNode = {
  id: 'r1:src/routes.tsx:AppRoutes',
  repoId: 'r1',
  type: 'function',
  filePath: 'src/routes.tsx',
  name: 'AppRoutes',
  signature: null,
  lineStart: 1,
  lineEnd: 10,
  exported: false,
  isDefaultExport: false,
  isAsync: false,
  isTest: false,
  testType: null,
  docComment: null,
  parseStatus: 'ok',
  codeHash: null,
}

function edge(partial: Partial<CodeEdge>): CodeEdge {
  return {
    id: 1,
    repoId: 'r1',
    sourceId: node.id,
    targetId: null,
    relation: 'renders',
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
    ...partial,
  }
}

const profile: StaticAnalysisPatternProfile = {
  version: 1,
  generatedAt: '2026-05-24T00:00:00.000Z',
  builtFromCommit: null,
  validity: 'fresh',
  graphSchemaVersion: 'static-config-graph-v1',
  analysisMode: 'deterministic_with_pattern_profile',
  language: 'typescript',
  frameworks: ['react'],
  sources: { defaultConfigVersion: 'test' },
  routePatterns: { customDecorators: {}, routingFiles: [] },
  relationPatterns: { dbClients: [], apiClients: [], functionWrappers: [], sdkAliases: [] },
  serviceMapHints: { apiBasePaths: [], generatedClientMappings: [], repoAffinity: [] },
  rules: [{
    id: 'route.jsx.app-route',
    state: 'active',
    source: 'user',
    target: 'route.entrypoint',
    match: {
      relation: 'renders',
      targetSymbolIn: ['AppRoute'],
    },
    emit: {
      targetFrom: 'literalArg:path',
      operationValue: 'GET',
    },
  }],
  diagnostics: [],
}

describe('build_route pattern DSL adapter', () => {
  it('creates route entrypoints from JSX wrapper graph evidence', () => {
    const result = extractPatternProfileRouteEntries({
      repoId: 'r1',
      profile,
      nodes: [node],
      edges: [edge({
        targetSymbol: 'AppRoute',
        literalArgs: '[{"path":"/admin/users","component":null}]',
      })],
    })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0]).toMatchObject({
      framework: 'pattern_dsl',
      kind: 'api',
      httpMethod: 'GET',
      path: '/admin/users',
      fullPath: '/admin/users',
      handlerNodeId: node.id,
      detectionSource: 'dsl:route.jsx.app-route',
      metadata: {
        configPatternId: 'route.jsx.app-route',
        configSource: 'user',
        source: 'user_config',
      },
    })
  })

  it('does not emit from candidate rules', () => {
    const result = extractPatternProfileRouteEntries({
      repoId: 'r1',
      profile: {
        ...profile,
        rules: [{ ...profile.rules[0]!, state: 'candidate' }],
      },
      nodes: [node],
      edges: [edge({
        targetSymbol: 'AppRoute',
        literalArgs: '[{"path":"/admin/users"}]',
      })],
    })

    expect(result.entryPoints).toEqual([])
  })

  it('extracts routes from promoted candidate DSL rules without route adapters', () => {
    const promotedProfile = createTestOnlyProfileWithCandidateRules({
      ...profile,
      rules: [],
      candidateConfig: {
        rules: [{
          id: 'route.internal.auth_get',
          state: 'candidate',
          source: 'agent_candidate',
          target: 'route.entrypoint',
          match: {
            relation: 'calls',
            targetSymbolIn: ['AuthGet'],
          },
          emit: {
            targetFrom: 'firstArg',
            operationValue: 'GET',
          },
        }],
        rejectedRules: [],
        diagnostics: [],
      },
    })

    const result = extractPatternProfileRouteEntries({
      repoId: 'r1',
      profile: promotedProfile,
      nodes: [node],
      edges: [edge({
        relation: 'calls',
        targetSymbol: 'AuthGet',
        firstArg: '/admin/users',
      })],
    })

    expect(result.entryPoints).toEqual([
      expect.objectContaining({
        framework: 'pattern_dsl',
        httpMethod: 'GET',
        fullPath: '/admin/users',
        detectionSource: 'dsl:route.internal.auth_get',
        metadata: expect.objectContaining({
          configPatternId: 'route.internal.auth_get',
          configSource: 'fixture',
        }),
      }),
    ])
  })
})
