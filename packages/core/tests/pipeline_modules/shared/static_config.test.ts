import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createTestDb } from '../../server/helpers.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { repositoryStaticAnalysisConfigs } from '@/db/schema/static_analysis_configs.js'
import { codeEdges, codeNodes } from '@/db/schema/code_graph.js'
import {
  DEFAULT_STATIC_CONFIG_GRAPH_SCHEMA_VERSION,
  STATIC_ANALYSIS_PATTERN_PROFILE_PHASE,
  StaticAnalysisUserConfigError,
  composeAndSaveStaticAnalysisPatternProfile,
  composeStaticAnalysisPatternProfile,
  loadFreshStaticAnalysisPatternProfile,
  mergeCustomDecorators,
  mergeRoutingFiles,
  saveStaticAnalysisPatternProfile,
} from '@/pipeline_modules/shared/static_config/index.js'
import type {
  StaticAnalysisPatternProfileInput,
  ResolvedConfigSource,
} from '@/pipeline_modules/shared/static_config/types.js'

const baseInput: StaticAnalysisPatternProfileInput = {
  version: 1,
  language: 'typescript',
  frameworks: ['nestjs'],
  routePatterns: {
    customDecorators: {
      ApiGet: { resolvesTo: 'Get', source: 'src/decorators.ts' },
    },
    routingFiles: [{ path: 'src/routes.ts', reason: 'fixture' }],
  },
  relationPatterns: {
    dbClients: [
      { receiver: 'this.prisma', orm: 'prisma', ownerType: 'PrismaService' },
    ],
    apiClients: [
      { receiver: 'apiClient', protocol: 'rest', basePath: '/api', methods: { get: 'GET' } },
    ],
  },
  serviceMapHints: {
    apiBasePaths: [{ basePath: '/api' }],
  },
}

describe('static_config composition', () => {
  it('separates user-authored input from evidence-backed resolved config', () => {
    const resolved = composeStaticAnalysisPatternProfile({
      repoId: 'repo-1',
      builtFromCommit: 'abc123',
      language: 'typescript',
      frameworks: ['nestjs'],
      mode: 'deterministic_with_pattern_profile',
      defaultConfig: { version: 1, routePatterns: { customDecorators: {} } },
      userConfig: baseInput,
      graphEvidence: {
        nodeIds: ['node:controller'],
        edgeIds: ['edge:1'],
        filePaths: ['src/decorators.ts', 'src/routes.ts'],
      },
    })

    expect(resolved.validity).toBe('fresh')
    expect(resolved.builtFromCommit).toBe('abc123')
    expect(resolved.graphSchemaVersion).toBe(DEFAULT_STATIC_CONFIG_GRAPH_SCHEMA_VERSION)
    expect(resolved.routePatterns.customDecorators.ApiGet?.evidence).toMatchObject({
      confidence: 'high',
      source: 'manual',
      builtFromCommit: 'abc123',
    })
    expect(resolved.routePatterns.customDecorators.ApiGet?.evidence.evidenceNodeIds).toContain('edge:1')
    expect(resolved.relationPatterns.dbClients[0]?.evidence.filePaths).toContain('src/decorators.ts')
  })

  it('skips user custom config in deterministic_only mode but keeps defaults', () => {
    const resolved = composeStaticAnalysisPatternProfile({
      repoId: 'repo-1',
      builtFromCommit: null,
      language: 'typescript',
      frameworks: ['nestjs'],
      mode: 'deterministic_only',
      defaultConfig: {
        version: 1,
        routePatterns: {
          customDecorators: {
            DefaultGet: { resolvesTo: 'Get', source: '@nestjs/common' },
          },
        },
      },
      userConfig: baseInput,
      graphEvidence: { nodeIds: ['node:default'], edgeIds: ['edge:2'], filePaths: [] },
    })

    expect(resolved.routePatterns.customDecorators.DefaultGet).toBeDefined()
    expect(resolved.routePatterns.customDecorators.ApiGet).toBeUndefined()
    expect(resolved.diagnostics.some((diag) => diag.code === 'custom_config_disabled')).toBe(true)
  })

  it('keeps only default and repository_metadata rules in deterministic_only mode', () => {
    const rule = {
      state: 'active' as const,
      target: 'relation.api_call' as const,
      match: { relation: 'calls', targetSymbolIn: ['get'] },
      emit: { targetFrom: 'firstArg' as const, operationValue: 'GET' },
    }
    const resolved = composeStaticAnalysisPatternProfile({
      repoId: 'repo-1',
      builtFromCommit: null,
      mode: 'deterministic_only',
      defaultConfig: {
        version: 1,
        rules: [{ ...rule, id: 'default.api.get', source: 'default' }],
      },
      repositoryConfig: {
        version: 1,
        rules: [{ ...rule, id: 'repo.api.get', source: 'repository_metadata' }],
      },
      userConfig: {
        version: 1,
        rules: [{ ...rule, id: 'user.api.get', source: 'user' }],
      },
      graphEvidence: { nodeIds: [], edgeIds: [], filePaths: [] },
    })

    expect(resolved.rules.map((item) => item.id)).toEqual(['default.api.get', 'repo.api.get'])
  })

  it('stamps active rules with the owning config layer source', () => {
    const rule = {
      state: 'active' as const,
      target: 'relation.api_call' as const,
      match: { relation: 'calls', targetSymbolIn: ['send'] },
      emit: { targetFrom: 'targetSymbol' as const, operationValue: 'POST' },
    }
    const resolved = composeStaticAnalysisPatternProfile({
      repoId: 'repo-1',
      builtFromCommit: null,
      mode: 'deterministic_with_pattern_profile',
      userConfig: {
        version: 1,
        rules: [{ ...rule, id: 'user.mistagged.default', source: 'default' }],
      },
      approvedConfig: {
        version: 1,
        rules: [{ ...rule, id: 'approved.mistagged.user', source: 'user' }],
      },
      fixtureConfig: {
        version: 1,
        rules: [{ ...rule, id: 'fixture.mistagged.approved', source: 'approved' }],
      },
      graphEvidence: { nodeIds: [], edgeIds: [], filePaths: [] },
    })

    expect(resolved.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'user.mistagged.default', source: 'user' }),
      expect.objectContaining({ id: 'approved.mistagged.user', source: 'approved' }),
      expect.objectContaining({ id: 'fixture.mistagged.approved', source: 'fixture' }),
    ]))
  })

  it('normalizes duplicates and reports conflicts without letting config overwrite repository metadata', () => {
    const sources: ResolvedConfigSource[] = []
    const merged = mergeCustomDecorators(
      {
        ApiGet: {
          resolvesTo: 'Get',
          source: 'repo-metadata',
          evidence: {
            confidence: 'high',
            source: 'deterministic',
            evidenceNodeIds: ['edge:repo'],
            filePaths: [],
            builtFromCommit: null,
            reason: 'repository metadata',
          },
          configSource: 'repository_metadata',
        },
      },
      {
        ApiGet: {
          resolvesTo: 'Post',
          source: 'user-config',
          evidence: {
            confidence: 'high',
            source: 'manual',
            evidenceNodeIds: ['edge:user'],
            filePaths: [],
            builtFromCommit: null,
            reason: 'user config',
          },
          configSource: 'user',
        },
        ApiPost: {
          resolvesTo: 'Post',
          source: 'user-config',
          evidence: {
            confidence: 'high',
            source: 'manual',
            evidenceNodeIds: ['edge:user-post'],
            filePaths: [],
            builtFromCommit: null,
            reason: 'user config',
          },
          configSource: 'user',
        },
      },
      sources,
    )

    expect(merged.customDecorators.ApiGet?.resolvesTo).toBe('Get')
    expect(merged.customDecorators.ApiPost?.resolvesTo).toBe('Post')
    expect(merged.diagnostics).toContainEqual(expect.objectContaining({
      code: 'custom_decorator_conflict',
      severity: 'warning',
    }))
    expect(sources).toEqual(expect.arrayContaining(['repository_metadata', 'user']))
  })

  it('dedupes routing files and records ignored invalid paths', () => {
    const merged = mergeRoutingFiles(
      ['src/routes.ts', 'src/app.ts'],
      [
        { path: 'src/routes.ts', reason: 'duplicate' },
        { path: '../escape.ts', reason: 'invalid' },
        { path: 'lib/router.dart', reason: 'dart fixture' },
      ],
    )

    expect(merged.routingFiles).toEqual(['src/routes.ts', 'src/app.ts', 'lib/router.dart'])
    expect(merged.diagnostics).toContainEqual(expect.objectContaining({
      code: 'invalid_routing_file',
      severity: 'warning',
    }))
  })

  it('downgrades unknown relation client families without custom namespace', () => {
    const resolved = composeStaticAnalysisPatternProfile({
      repoId: 'repo-1',
      builtFromCommit: null,
      language: 'typescript',
      frameworks: [],
      mode: 'deterministic_with_pattern_profile',
      userConfig: {
        version: 1,
        relationPatterns: {
          dbClients: [{ receiver: 'this.db', orm: 'prisam' }],
        },
      },
      graphEvidence: { nodeIds: ['node:service'], edgeIds: ['edge:db'], filePaths: ['src/service.ts'] },
    })

    expect(resolved.relationPatterns.dbClients).toHaveLength(0)
    expect(resolved.diagnostics).toContainEqual(expect.objectContaining({
      code: 'unknown_db_client_family',
      severity: 'warning',
    }))
  })

  it('saves resolved config into build_pattern_profile phase meta without replacing unrelated metadata', () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values({ id: 'repo-1', projectId: 'project-1', name: 'repo', repoPath: '/repo' }).run()
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'repo-1',
      phase: STATIC_ANALYSIS_PATTERN_PROFILE_PHASE,
      builtFromCommit: 'abc123',
      validity: 'fresh',
      meta: { existing: true },
    }).run()

    const config = composeStaticAnalysisPatternProfile({
      repoId: 'repo-1',
      builtFromCommit: 'abc123',
      language: 'typescript',
      frameworks: [],
      graphEvidence: { nodeIds: ['node:1'], edgeIds: ['edge:1'], filePaths: [] },
    })

    saveStaticAnalysisPatternProfile({ db, repoId: 'repo-1', config })

    const row = db.select().from(repositoryPhaseStatus).where(and(
      eq(repositoryPhaseStatus.repositoryId, 'repo-1'),
      eq(repositoryPhaseStatus.phase, STATIC_ANALYSIS_PATTERN_PROFILE_PHASE),
    )).get()
    expect(row?.validity).toBe('fresh')
    expect(row?.builtFromCommit).toBe('abc123')
    expect(row?.meta).toMatchObject({
      existing: true,
      staticAnalysisPatternProfile: {
        builtFromCommit: 'abc123',
        validity: 'fresh',
      },
    })
  })

  it('composes and stores repository metadata after build_graph into build_pattern_profile phase', () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values({
      id: 'repo-1',
      projectId: 'project-1',
      name: 'repo',
      repoPath: '/repo',
      language: 'dart',
      framework: 'flutter',
      customDecorators: {
        RoutePage: { resolvesTo: 'Get', source: 'lib/routing.dart' },
      },
      routingFiles: ['lib/router.dart'],
      apiBasePaths: ['/v1'],
    }).run()
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'repo-1',
      phase: 'build_graph',
      builtFromCommit: 'def456',
      validity: 'fresh',
      meta: { graph: { nodeCount: 1 } },
    }).run()
    db.insert(codeNodes).values({
      id: 'repo-1:lib/router.dart:RoutePage',
      repoId: 'repo-1',
      type: 'function',
      filePath: 'lib/router.dart',
      name: 'RoutePage',
    }).run()

    const config = composeAndSaveStaticAnalysisPatternProfile({ db, repoId: 'repo-1' })
    const row = db.select().from(repositoryPhaseStatus).where(and(
      eq(repositoryPhaseStatus.repositoryId, 'repo-1'),
      eq(repositoryPhaseStatus.phase, STATIC_ANALYSIS_PATTERN_PROFILE_PHASE),
    )).get()

    expect(config).toMatchObject({
      language: 'dart',
      frameworks: ['flutter'],
      builtFromCommit: 'def456',
      routePatterns: {
        routingFiles: [expect.objectContaining({ path: 'lib/router.dart' })],
      },
      serviceMapHints: {
        apiBasePaths: [expect.objectContaining({ basePath: '/v1' })],
      },
    })
    expect(row?.meta).toMatchObject({
      staticAnalysisPatternProfile: {
        language: 'dart',
        graphSchemaVersion: DEFAULT_STATIC_CONFIG_GRAPH_SCHEMA_VERSION,
      },
    })
  })

  it('activates SaaS-generic default DSL rules from official package evidence', () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values({
      id: 'repo-1',
      projectId: 'project-1',
      name: 'repo',
      repoPath: '/repo',
      language: 'typescript',
      framework: 'react',
    }).run()
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'repo-1',
      phase: 'build_graph',
      builtFromCommit: 'abc123',
      validity: 'fresh',
      meta: {},
    }).run()
    db.insert(codeNodes).values({
      id: 'repo-1:src/app.ts',
      repoId: 'repo-1',
      type: 'file',
      filePath: 'src/app.ts',
      name: 'src/app.ts',
    }).run()
    db.insert(codeEdges).values([
      {
        repoId: 'repo-1',
        sourceId: 'repo-1:src/app.ts',
        relation: 'imports',
        targetSpecifier: '@prisma/client',
        resolveStatus: 'external',
      },
      {
        repoId: 'repo-1',
        sourceId: 'repo-1:src/app.ts',
        relation: 'imports',
        targetSpecifier: 'axios',
        resolveStatus: 'external',
      },
    ]).run()

    const config = composeAndSaveStaticAnalysisPatternProfile({ db, repoId: 'repo-1' })

    expect(config?.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'db.prisma.direct',
        source: 'default',
        target: 'relation.db_access',
      }),
      expect.objectContaining({
        id: 'api.axios.get',
        source: 'default',
        target: 'relation.api_call',
      }),
      expect.objectContaining({
        id: 'route.react.jsx-route',
        source: 'default',
        target: 'route.entrypoint',
      }),
    ]))
  })

  it('does not activate default DSL rules without official role registry evidence', () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values({
      id: 'repo-1',
      projectId: 'project-1',
      name: 'repo',
      repoPath: '/repo',
      language: 'typescript',
      framework: 'unknown',
    }).run()
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'repo-1',
      phase: 'build_graph',
      builtFromCommit: 'abc123',
      validity: 'fresh',
      meta: {},
    }).run()

    const config = composeAndSaveStaticAnalysisPatternProfile({ db, repoId: 'repo-1' })

    expect(config?.rules.filter((rule) => rule.source === 'default')).toEqual([])
  })

  it('keeps llm candidate output as non-consumable proposal metadata', () => {
    const resolved = composeStaticAnalysisPatternProfile({
      repoId: 'repo-1',
      builtFromCommit: null,
      language: 'typescript',
      frameworks: [],
      candidateConfig: {
        source: 'llm',
        proposedAt: '2026-05-22T00:00:00.000Z',
        reason: 'Possible custom client pattern, not approved.',
        status: 'candidate_only',
        routePatterns: {
          customDecorators: {
            MaybeGet: { resolvesTo: 'Get', source: 'llm' },
          },
        },
      },
      graphEvidence: { nodeIds: ['node:1'], edgeIds: [], filePaths: [] },
    })

    expect(resolved.candidateConfig?.source).toBe('llm')
    expect(resolved.routePatterns.customDecorators.MaybeGet).toBeUndefined()
  })

  it('downgrades active agent candidate rules before they can enter active rules', () => {
    const resolved = composeStaticAnalysisPatternProfile({
      repoId: 'repo-1',
      builtFromCommit: 'abc123',
      language: 'typescript',
      frameworks: [],
      userConfig: {
        version: 1,
        rules: [{
          id: 'agent.leaked-active',
          state: 'active',
          source: 'agent_candidate',
          target: 'relation.api_call',
          match: { relation: 'calls', targetSymbolIn: ['get'] },
          emit: { targetFrom: 'firstArg', operationValue: 'GET' },
        }],
      },
      graphEvidence: { nodeIds: ['node:1'], edgeIds: ['edge:1'], filePaths: [] },
    })

    expect(resolved.rules).toEqual([])
    expect(resolved.candidateConfig?.rules?.[0]).toMatchObject({
      id: 'agent.leaked-active',
      state: 'candidate',
      source: 'agent_candidate',
    })
    expect(resolved.candidateConfig?.ruleEntries?.[0]).toMatchObject({
      rule: {
        id: 'agent.leaked-active',
        state: 'candidate',
        source: 'agent_candidate',
      },
      discoveredFromCommit: 'abc123',
      discoveredFromGraphSchemaVersion: DEFAULT_STATIC_CONFIG_GRAPH_SCHEMA_VERSION,
      status: 'candidate',
    })
    expect(resolved.diagnostics).toContainEqual(expect.objectContaining({
      code: 'agent_candidate_promotion_blocked',
      severity: 'warning',
    }))
  })

  it('preserves candidate config when composing and saving after build_graph reruns', () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values({
      id: 'repo-1',
      projectId: 'project-1',
      name: 'repo',
      repoPath: '/repo',
      language: 'typescript',
      framework: 'react',
    }).run()
    const existingConfig = composeStaticAnalysisPatternProfile({
      repoId: 'repo-1',
      builtFromCommit: 'abc123',
      language: 'typescript',
      frameworks: ['react'],
      candidateConfig: {
        source: 'agent',
        proposedAt: '2026-05-24T00:00:00.000Z',
        reason: 'candidate fixture',
        status: 'candidate_only',
        rules: [{
          id: 'candidate.route.app-route',
          state: 'candidate',
          source: 'agent_candidate',
          target: 'route.entrypoint',
          match: { relation: 'renders', targetSymbolIn: ['AppRoute'] },
          emit: { targetFrom: 'literalArg:path', operationValue: 'GET' },
        }],
      },
      graphEvidence: { nodeIds: [], edgeIds: [], filePaths: [] },
    })
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'repo-1',
      phase: 'build_graph',
      builtFromCommit: 'abc123',
      validity: 'fresh',
      meta: { staticAnalysisPatternProfile: existingConfig },
    }).run()

    const recomposed = composeAndSaveStaticAnalysisPatternProfile({ db, repoId: 'repo-1' })

    expect(recomposed?.candidateConfig?.rules?.[0]).toMatchObject({
      id: 'candidate.route.app-route',
      state: 'candidate',
    })
    const row = db.select().from(repositoryPhaseStatus).where(eq(repositoryPhaseStatus.repositoryId, 'repo-1')).get()
    expect(row?.meta).toMatchObject({
      staticAnalysisPatternProfile: {
        candidateConfig: {
          rules: [expect.objectContaining({ id: 'candidate.route.app-route' })],
        },
      },
    })
  })

  it('loads active DB-backed user config only during profile composition', () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values({
      id: 'repo-1',
      projectId: 'project-1',
      name: 'repo',
      repoPath: '/repo',
      language: 'typescript',
      framework: 'nestjs',
    }).run()
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'repo-1',
      phase: 'build_graph',
      builtFromCommit: 'abc123',
      validity: 'fresh',
      meta: {},
    }).run()
    db.insert(codeNodes).values({
      id: 'repo-1:src/users.ts:UsersController',
      repoId: 'repo-1',
      type: 'class',
      filePath: 'src/users.ts',
      name: 'UsersController',
    }).run()
    db.insert(repositoryStaticAnalysisConfigs).values({
      id: 'config-1',
      repositoryId: 'repo-1',
      schemaVersion: 1,
      configJson: {
        version: 1,
        routePatterns: {
          customDecorators: {
            AuthGet: { resolvesTo: 'Get', source: 'src/auth-route.ts' },
          },
        },
        relationPatterns: {
          apiClients: [
            { receiver: 'apiClient', protocol: 'rest', basePath: '/api', methods: { get: 'GET' } },
          ],
        },
      },
      version: 1,
      status: 'active',
      createdBy: 'test',
    }).run()

    const config = composeAndSaveStaticAnalysisPatternProfile({ db, repoId: 'repo-1' })

    expect(config?.sources.userCustomConfigVersion).toBe('1')
    expect(config?.routePatterns.customDecorators.AuthGet).toMatchObject({
      resolvesTo: 'Get',
      configSource: 'user',
    })
    expect(config?.relationPatterns.apiClients[0]).toMatchObject({
      receiver: 'apiClient',
      configSource: 'user',
    })
  })

  it('rejects invalid active DB-backed user config before saving a profile', () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values({
      id: 'repo-1',
      projectId: 'project-1',
      name: 'repo',
      repoPath: '/repo',
      language: 'typescript',
      framework: 'nestjs',
    }).run()
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'repo-1',
      phase: 'build_graph',
      builtFromCommit: 'abc123',
      validity: 'fresh',
      meta: { existing: true },
    }).run()
    db.insert(repositoryStaticAnalysisConfigs).values({
      id: 'config-1',
      repositoryId: 'repo-1',
      schemaVersion: 1,
      configJson: { version: 2 },
      version: 1,
      status: 'active',
      createdBy: 'test',
    }).run()

    expect(() => composeAndSaveStaticAnalysisPatternProfile({ db, repoId: 'repo-1' }))
      .toThrow(StaticAnalysisUserConfigError)

    const row = db.select().from(repositoryPhaseStatus).where(eq(repositoryPhaseStatus.repositoryId, 'repo-1')).get()
    expect(row?.meta).toEqual({ existing: true })
  })

  it('rejects malformed nested DB-backed user config before saving a profile', () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values({
      id: 'repo-1',
      projectId: 'project-1',
      name: 'repo',
      repoPath: '/repo',
      language: 'typescript',
      framework: 'nestjs',
    }).run()
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'repo-1',
      phase: 'build_graph',
      builtFromCommit: 'abc123',
      validity: 'fresh',
      meta: { existing: true },
    }).run()
    db.insert(repositoryStaticAnalysisConfigs).values({
      id: 'config-1',
      repositoryId: 'repo-1',
      schemaVersion: 1,
      configJson: {
        version: 1,
        relationPatterns: {
          apiClients: [
            { receiver: 'apiClient', protocol: 'rest', methods: 'GET' },
          ],
        },
      },
      version: 1,
      status: 'active',
      createdBy: 'test',
    }).run()

    expect(() => composeAndSaveStaticAnalysisPatternProfile({ db, repoId: 'repo-1' }))
      .toThrow(StaticAnalysisUserConfigError)

    const row = db.select().from(repositoryPhaseStatus).where(eq(repositoryPhaseStatus.repositoryId, 'repo-1')).get()
    expect(row?.meta).toEqual({ existing: true })
  })

  it('loads only fresh commit-bound config with matching graph schema version', () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values({ id: 'repo-1', projectId: 'project-1', name: 'repo', repoPath: '/repo' }).run()
    const config = composeStaticAnalysisPatternProfile({
      repoId: 'repo-1',
      builtFromCommit: 'abc123',
      language: 'typescript',
      frameworks: [],
      graphEvidence: { nodeIds: ['node:1'], edgeIds: ['edge:1'], filePaths: [] },
    })
    saveStaticAnalysisPatternProfile({ db, repoId: 'repo-1', config })

    expect(loadFreshStaticAnalysisPatternProfile({ db, repoId: 'repo-1', currentCommit: 'abc123' })).toMatchObject({
      builtFromCommit: 'abc123',
    })
    expect(loadFreshStaticAnalysisPatternProfile({ db, repoId: 'repo-1', currentCommit: 'other' })).toBeNull()
    expect(loadFreshStaticAnalysisPatternProfile({
      db,
      repoId: 'repo-1',
      currentCommit: 'abc123',
      graphSchemaVersion: 'other-schema',
    })).toBeNull()
  })
})
