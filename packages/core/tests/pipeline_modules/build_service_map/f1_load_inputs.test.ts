import { describe, expect, it } from 'vitest'

import { codeRelations } from '@/db/schema/build_relations.js'
import { codeBundles, entryPoints } from '@/db/schema/build_route.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { loadInputs } from '@/pipeline_modules/build_service_map/f1_load_inputs.js'
import { STATIC_ANALYSIS_PATTERN_PROFILE_PHASE } from '@/pipeline_modules/shared/static_config/index.js'
import { createTestDb } from '../../server/helpers.js'

describe('build_service_map F1 loadInputs', () => {
  it('loads repo static config repoAffinity as anchored api target hints without creating edges', async () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-config', name: 'Project Config' }).run()
    db.insert(repositories).values([
      { id: 'frontend', projectId: 'project-config', name: 'frontend', repoPath: '/repos/frontend' },
      { id: 'backend', projectId: 'project-config', name: 'backend', repoPath: '/repos/backend' },
    ]).run()
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'frontend',
      phase: STATIC_ANALYSIS_PATTERN_PROFILE_PHASE,
      builtFromCommit: null,
      validity: 'fresh',
      meta: {
        staticAnalysisPatternProfile: {
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
          serviceMapHints: {
            apiBasePaths: [],
            generatedClientMappings: [],
            repoAffinity: [{
              sourcePattern: 'GET /api/orders',
              targetRepoId: 'backend',
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
          },
          diagnostics: [],
        },
      },
    }).run()

    const input = await loadInputs({ db, projectId: 'project-config' })

    expect(input.apiTargetRepoHints).toContainEqual({
      sourceRepoId: 'frontend',
      method: 'GET',
      path: '/api/orders',
      targetRepoId: 'backend',
    })
    expect(input.codeRelations).toEqual([])
  })

  it('ignores stale or deterministic_only repo static config hints', async () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-config', name: 'Project Config' }).run()
    db.insert(repositories).values([
      { id: 'fresh-disabled', projectId: 'project-config', name: 'fresh-disabled', repoPath: '/repos/fresh-disabled' },
      { id: 'stale-source', projectId: 'project-config', name: 'stale-source', repoPath: '/repos/stale-source' },
      { id: 'backend', projectId: 'project-config', name: 'backend', repoPath: '/repos/backend' },
    ]).run()
    const baseConfig = {
      version: 1,
      generatedAt: '2026-05-22T00:00:00.000Z',
      builtFromCommit: null,
      validity: 'fresh',
      graphSchemaVersion: 'static-config-graph-v1',
      language: 'typescript',
      frameworks: [],
      sources: { defaultConfigVersion: 'test' },
      routePatterns: { customDecorators: {}, routingFiles: [] },
      relationPatterns: { dbClients: [], apiClients: [], functionWrappers: [], sdkAliases: [] },
      serviceMapHints: {
        apiBasePaths: [],
        generatedClientMappings: [],
        repoAffinity: [{
          sourcePattern: 'GET /api/orders',
          targetRepoId: 'backend',
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
      },
      diagnostics: [],
    }
    db.insert(repositoryPhaseStatus).values([
      {
        repositoryId: 'fresh-disabled',
        phase: STATIC_ANALYSIS_PATTERN_PROFILE_PHASE,
        builtFromCommit: null,
        validity: 'fresh',
        meta: {
          staticAnalysisPatternProfile: {
            ...baseConfig,
            analysisMode: 'deterministic_only',
          },
        },
      },
      {
        repositoryId: 'stale-source',
        phase: STATIC_ANALYSIS_PATTERN_PROFILE_PHASE,
        builtFromCommit: null,
        validity: 'stale',
        meta: {
          staticAnalysisPatternProfile: {
            ...baseConfig,
            analysisMode: 'deterministic_with_pattern_profile',
          },
        },
      },
    ]).run()

    const input = await loadInputs({ db, projectId: 'project-config' })

    expect(input.apiTargetRepoHints).toEqual([])
  })

  it('excludes soft-deleted repositories from project-scope inputs', async () => {
    const db = createTestDb()
    const now = new Date().toISOString()

    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values([
      { id: 'repo-alive', projectId: 'project-1', name: 'alive', repoPath: '/repos/alive' },
      { id: 'repo-deleted', projectId: 'project-1', name: 'deleted', repoPath: '/repos/deleted', deletedAt: now },
    ]).run()
    db.insert(codeNodes).values([
      { id: 'repo-alive:handler', repoId: 'repo-alive', type: 'function', filePath: 'src/alive.ts', name: 'aliveHandler' },
      { id: 'repo-deleted:handler', repoId: 'repo-deleted', type: 'function', filePath: 'src/deleted.ts', name: 'deletedHandler' },
    ]).run()
    db.insert(entryPoints).values([
      {
        id: 'ep-alive',
        repoId: 'repo-alive',
        framework: 'nestjs',
        kind: 'api',
        httpMethod: 'GET',
        path: '/alive',
        fullPath: '/alive',
        handlerNodeId: 'repo-alive:handler',
        detectionSource: 'rule:test',
        confidence: 'high',
      },
      {
        id: 'ep-deleted',
        repoId: 'repo-deleted',
        framework: 'nestjs',
        kind: 'api',
        httpMethod: 'GET',
        path: '/deleted',
        fullPath: '/deleted',
        handlerNodeId: 'repo-deleted:handler',
        detectionSource: 'rule:test',
        confidence: 'high',
      },
    ]).run()
    db.insert(codeBundles).values([
      { entryPointId: 'ep-alive', nodeId: 'repo-alive:handler', depth: 0 },
      { entryPointId: 'ep-deleted', nodeId: 'repo-deleted:handler', depth: 0 },
    ]).run()
    db.insert(codeRelations).values([
      {
        id: 'rel-alive',
        repoId: 'repo-alive',
        sourceNodeId: 'repo-alive:handler',
        kind: 'api_call',
        canonicalTarget: 'GET /alive',
        payload: {},
        evidenceNodeIds: [],
        confidence: 'high',
      },
      {
        id: 'rel-deleted',
        repoId: 'repo-deleted',
        sourceNodeId: 'repo-deleted:handler',
        kind: 'api_call',
        canonicalTarget: 'GET /deleted',
        payload: {},
        evidenceNodeIds: [],
        confidence: 'high',
      },
    ]).run()

    const input = await loadInputs({ db, projectId: 'project-1' })

    expect(input.repoIds).toEqual(['repo-alive'])
    expect(input.entryPoints.map((entry) => entry.id)).toEqual(['ep-alive'])
    expect(input.codeBundles.map((bundle) => bundle.entryPointId)).toEqual(['ep-alive'])
    expect(input.codeRelations.map((relation) => relation.id)).toEqual(['rel-alive'])
  })

  it('loads code node ownership metadata for reachability', async () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-ownership', name: 'Project Ownership' }).run()
    db.insert(repositories).values({
      id: 'repo-ownership',
      projectId: 'project-ownership',
      name: 'ownership',
      repoPath: '/repos/ownership',
    }).run()
    db.insert(codeNodes).values([
      {
        id: 'node-handler',
        repoId: 'repo-ownership',
        type: 'function',
        filePath: 'src/route.ts',
        name: 'POST',
      },
      {
        id: 'node-callback',
        repoId: 'repo-ownership',
        type: 'function',
        filePath: 'src/route.ts',
        name: 'POST.$transaction_12_20',
        parentNodeId: 'node-handler',
        originKind: 'callback',
        role: 'transactionCallback',
      },
    ]).run()

    const input = await loadInputs({ db, repoId: 'repo-ownership' })

    expect(input.graphNodes.find((node) => node.id === 'node-callback')).toMatchObject({
      parentNodeId: 'node-handler',
      originKind: 'callback',
      role: 'transactionCallback',
    })
  })
})
