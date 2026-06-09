import { describe, expect, it } from 'vitest'

import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import { loadInputs } from '@/pipeline_modules/build_relations/load_inputs.js'
import { createTestDb } from '../../server/helpers.js'

describe('build_relations loadInputs static config', () => {
  it('loads only fresh build_pattern_profile repo static analysis config', async () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values({
      id: 'repo-1',
      projectId: 'project-1',
      name: 'repo',
      repoPath: '/repo',
    }).run()
    db.insert(codeNodes).values({
      id: 'repo-1:src/service.ts:listOrders',
      repoId: 'repo-1',
      type: 'function',
      filePath: 'src/service.ts',
      name: 'listOrders',
    }).run()
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'repo-1',
      phase: 'build_pattern_profile',
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
          serviceMapHints: { apiBasePaths: [], generatedClientMappings: [], repoAffinity: [] },
          diagnostics: [],
        },
      },
    }).run()

    const input = await loadInputs({ db, repoId: 'repo-1' })

    expect(input.staticAnalysisPatternProfile?.relationPatterns.apiClients[0]).toMatchObject({
      receiver: 'apiClient',
      basePath: '/api',
    })
  })

  it('drops stale build_pattern_profile static config before relation extraction', async () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
    db.insert(repositories).values({
      id: 'repo-1',
      projectId: 'project-1',
      name: 'repo',
      repoPath: '/repo',
    }).run()
    db.insert(repositoryPhaseStatus).values({
      repositoryId: 'repo-1',
      phase: 'build_pattern_profile',
      builtFromCommit: 'abc123',
      validity: 'stale',
      meta: {
        staticAnalysisPatternProfile: {
          version: 1,
          generatedAt: '2026-05-22T00:00:00.000Z',
          builtFromCommit: 'abc123',
          validity: 'fresh',
          graphSchemaVersion: 'static-config-graph-v1',
          analysisMode: 'deterministic_with_pattern_profile',
          language: 'typescript',
          frameworks: [],
          sources: { defaultConfigVersion: 'test' },
          routePatterns: { customDecorators: {}, routingFiles: [] },
          relationPatterns: { dbClients: [], apiClients: [], functionWrappers: [], sdkAliases: [] },
          serviceMapHints: { apiBasePaths: [], generatedClientMappings: [], repoAffinity: [] },
          diagnostics: [],
        },
      },
    }).run()

    const input = await loadInputs({ db, repoId: 'repo-1' })

    expect(input.staticAnalysisPatternProfile).toBeNull()
  })
})
