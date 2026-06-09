// build_route 메인 orchestrator E2E
// repositories + code_nodes/edges → DB → runBuildRoute → entry_points DB 검증

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type DB } from '../../server/helpers.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { pipelineRuns, pipelineSteps } from '@/db/schema/pipeline_runs.js'
import {
  entryPoints,
  frameworkDetections,
} from '@/db/schema/build_route.js'
import { evaluateSourceAnalyzers, runBuildRoute } from '@/pipeline_modules/build_route/index.js'
import {
  STATIC_ANALYSIS_PATTERN_PROFILE_PHASE,
  type StaticAnalysisPatternProfile,
} from '@/pipeline_modules/shared/static_config/index.js'

const PROJECT = 'p1'
const REPO = 'r1'
let db: DB

function setupRepo(framework: string, apiBasePaths?: string[], repoPath = '.') {
  db = createTestDb()
  db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
  db.insert(repositories).values({
    id: REPO,
    projectId: PROJECT,
    name: 'r',
    repoPath,
    framework: framework as never,
    apiBasePaths,
  }).run()
}

function setupRepoWithCustomDecorators(
  customDecorators: Record<string, unknown> = {
    ApiGet: { resolvesTo: 'Get', source: '@my/lib' },
  },
) {
  db = createTestDb()
  db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
  db.insert(repositories).values({
    id: REPO,
    projectId: PROJECT,
    name: 'r',
    repoPath: '.',
    framework: 'nestjs',
    customDecorators: customDecorators as never,
  }).run()
}

function insertFreshRouteConfig(
  config: Pick<StaticAnalysisPatternProfile, 'routePatterns' | 'serviceMapHints'>,
  analysisMode: StaticAnalysisPatternProfile['analysisMode'] = 'deterministic_with_pattern_profile',
) {
  db.insert(repositoryPhaseStatus).values({
    repositoryId: REPO,
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
        analysisMode,
        language: 'typescript',
        frameworks: ['nestjs'],
        sources: { defaultConfigVersion: 'test' },
        relationPatterns: { dbClients: [], apiClients: [], functionWrappers: [], sdkAliases: [] },
        diagnostics: [],
        ...config,
      } satisfies StaticAnalysisPatternProfile,
    },
  }).run()
}

describe('runBuildRoute — NestJS 단순 케이스', () => {
  it('uses analyze_repo schema customDecorators when resolving wrapper route decorators', async () => {
    setupRepoWithCustomDecorators({
      IgnoredDecorator: null,
      ApiGet: {
        expands_to: ['Get'],
        file: 'src/decorators/api-get.ts',
        dynamic: false,
        fallback_to_llm: false,
      },
    })

    db.insert(codeNodes).values([
      { id: 'r1:src/o.ts:OrderController', repoId: REPO, type: 'class', filePath: 'src/o.ts', name: 'OrderController' },
      { id: 'r1:src/o.ts:OrderController.items', repoId: REPO, type: 'method', filePath: 'src/o.ts', name: 'items' },
    ]).run()

    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: null, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/orders' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: 'r1:src/o.ts:OrderController.items', relation: 'contains' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController.items', targetId: null, relation: 'decorates', targetSymbol: 'ApiGet', firstArg: '/items' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0]).toMatchObject({
      httpMethod: 'GET',
      fullPath: '/orders/items',
    })
  })

  it('uses default decorator metadata when customDecorators omit source/file', async () => {
    setupRepoWithCustomDecorators({
      ApiGet: { resolvesTo: 'Get' },
      ApiPost: { expands_to: ['Post'] },
    })

    db.insert(codeNodes).values([
      { id: 'r1:src/o.ts:OrderController', repoId: REPO, type: 'class', filePath: 'src/o.ts', name: 'OrderController' },
      { id: 'r1:src/o.ts:OrderController.list', repoId: REPO, type: 'method', filePath: 'src/o.ts', name: 'list' },
      { id: 'r1:src/o.ts:OrderController.create', repoId: REPO, type: 'method', filePath: 'src/o.ts', name: 'create' },
    ]).run()

    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: null, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/orders' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: 'r1:src/o.ts:OrderController.list', relation: 'contains' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: 'r1:src/o.ts:OrderController.create', relation: 'contains' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController.list', targetId: null, relation: 'decorates', targetSymbol: 'ApiGet', firstArg: '/list' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController.create', targetId: null, relation: 'decorates', targetSymbol: 'ApiPost', firstArg: '/create' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.httpMethod).sort()).toEqual(['GET', 'POST'])
  })

  it('uses repository customDecorators when resolving wrapper route decorators', async () => {
    setupRepoWithCustomDecorators()

    db.insert(codeNodes).values([
      { id: 'r1:src/o.ts:OrderController', repoId: REPO, type: 'class', filePath: 'src/o.ts', name: 'OrderController' },
      { id: 'r1:src/o.ts:OrderController.items', repoId: REPO, type: 'method', filePath: 'src/o.ts', name: 'items' },
    ]).run()

    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: null, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/orders' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: 'r1:src/o.ts:OrderController.items', relation: 'contains' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController.items', targetId: null, relation: 'decorates', targetSymbol: 'ApiGet', firstArg: '/items' },
    ]).run()

    const result = await runBuildRoute({
      db,
      repoId: REPO,
      opts: { reachabilityCaps: { maxDepth: 0 } },
    })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0]).toMatchObject({
      httpMethod: 'GET',
      fullPath: '/orders/items',
    })
  })

  it('uses fresh static config customDecorators and apiBasePaths without LLM', async () => {
    setupRepo('nestjs')
    insertFreshRouteConfig({
      routePatterns: {
        customDecorators: {
          ApiGet: {
            resolvesTo: 'Get',
            source: 'fixture-config',
            configSource: 'user',
            evidence: {
              confidence: 'high',
              source: 'manual',
              evidenceNodeIds: ['edge:cfg'],
              filePaths: ['src/decorators.ts'],
              builtFromCommit: null,
              reason: 'fixture config',
            },
          },
        },
        routingFiles: [],
      },
      serviceMapHints: {
        apiBasePaths: [{
          basePath: '/api',
          configSource: 'user',
          evidence: {
            confidence: 'high',
            source: 'manual',
            evidenceNodeIds: ['edge:base'],
            filePaths: [],
            builtFromCommit: null,
            reason: 'fixture config',
          },
        }],
        generatedClientMappings: [],
        repoAffinity: [],
      },
    })

    db.insert(codeNodes).values([
      { id: 'r1:src/o.ts:OrderController', repoId: REPO, type: 'class', filePath: 'src/o.ts', name: 'OrderController' },
      { id: 'r1:src/o.ts:OrderController.items', repoId: REPO, type: 'method', filePath: 'src/o.ts', name: 'items' },
    ]).run()

    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: null, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/orders' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: 'r1:src/o.ts:OrderController.items', relation: 'contains' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController.items', targetId: null, relation: 'decorates', targetSymbol: 'ApiGet', firstArg: '/items' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0]).toMatchObject({
      httpMethod: 'GET',
      fullPath: '/api/orders/items',
    })
  })

  it('keeps repository customDecorator when static config conflicts', async () => {
    setupRepoWithCustomDecorators({
      ApiGet: { resolvesTo: 'Get', source: 'repo-metadata' },
    })
    insertFreshRouteConfig({
      routePatterns: {
        customDecorators: {
          ApiGet: {
            resolvesTo: 'Post',
            source: 'fixture-config',
            configSource: 'user',
            evidence: {
              confidence: 'high',
              source: 'manual',
              evidenceNodeIds: ['edge:cfg'],
              filePaths: [],
              builtFromCommit: null,
              reason: 'fixture config',
            },
          },
        },
        routingFiles: [],
      },
      serviceMapHints: { apiBasePaths: [], generatedClientMappings: [], repoAffinity: [] },
    })

    db.insert(codeNodes).values([
      { id: 'r1:src/o.ts:OrderController', repoId: REPO, type: 'class', filePath: 'src/o.ts', name: 'OrderController' },
      { id: 'r1:src/o.ts:OrderController.items', repoId: REPO, type: 'method', filePath: 'src/o.ts', name: 'items' },
    ]).run()

    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: null, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/orders' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: 'r1:src/o.ts:OrderController.items', relation: 'contains' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController.items', targetId: null, relation: 'decorates', targetSymbol: 'ApiGet', firstArg: '/items' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0]?.httpMethod).toBe('GET')
  })

  it('does not consume static config route patterns in deterministic_only mode', async () => {
    setupRepo('nestjs')
    insertFreshRouteConfig({
      routePatterns: {
        customDecorators: {
          ApiGet: {
            resolvesTo: 'Get',
            source: 'fixture-config',
            configSource: 'user',
            evidence: {
              confidence: 'high',
              source: 'manual',
              evidenceNodeIds: ['edge:cfg'],
              filePaths: [],
              builtFromCommit: null,
              reason: 'fixture config',
            },
          },
        },
        routingFiles: [],
      },
      serviceMapHints: { apiBasePaths: [], generatedClientMappings: [], repoAffinity: [] },
    }, 'deterministic_only')

    db.insert(codeNodes).values([
      { id: 'r1:src/o.ts:OrderController', repoId: REPO, type: 'class', filePath: 'src/o.ts', name: 'OrderController' },
      { id: 'r1:src/o.ts:OrderController.items', repoId: REPO, type: 'method', filePath: 'src/o.ts', name: 'items' },
    ]).run()

    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: null, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/orders' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: 'r1:src/o.ts:OrderController.items', relation: 'contains' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController.items', targetId: null, relation: 'decorates', targetSymbol: 'ApiGet', firstArg: '/items' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints).toEqual([])
  })

  it('evaluateSourceAnalyzers merges legacy fallback and semantic analyzer diagnostics', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-route-source-analyzers-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })

    const result = evaluateSourceAnalyzers({
      repoPath,
      repoId: REPO,
      stackInfo: { framework: 'express', routingLibs: [] },
      detections: [],
      graphNodes: [],
    })

    expect(result).toMatchObject({
      entryPoints: [],
      suspected: [],
    })
    expect(result.diagnostics).toMatchObject({
      'legacy_source_fallbacks.sourceFallbackEntries': 0,
    })
    expect(result.diagnostics.filesRead).toBeGreaterThanOrEqual(1)
  })

  it('routing_files unmatched → STATIC LIMIT: surfaced as suspected, NO entry, no F5 step', async () => {
    setupRepo('flutter')

    db.insert(codeNodes).values([
      { id: 'r1:lib/router.dart', repoId: REPO, type: 'file', filePath: 'lib/router.dart', name: 'router.dart' },
    ]).run()
    db.update(repositories)
      .set({ routingFiles: ['lib/router.dart'] })
      .where(eq(repositories.id, REPO))
      .run()

    // build_route is PURE STATIC — the F5 LLM fallback was removed. An unmatched routing_file is surfaced as a
    // `suspected` gap (enriched later by the route CLI / agent, outside the engine), not an entry point.
    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.suspected).toHaveLength(1)
    expect(result.entryPoints).toEqual([])
    expect(db.select().from(entryPoints).where(eq(entryPoints.repoId, REPO)).all()).toHaveLength(0)

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, 'build_route')).get()
    expect(db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, run!.id)).all().map((step) => step.step))
      .not.toContain('F5:llmFallback')
  })

  it('OrderController @Get(/list) → entry_points 1건 저장', async () => {
    setupRepo('nestjs')

    // OrderController class + list method
    db.insert(codeNodes).values([
      { id: 'r1:src/o.ts:OrderController', repoId: REPO, type: 'class', filePath: 'src/o.ts', name: 'OrderController' },
      { id: 'r1:src/o.ts:OrderController.list', repoId: REPO, type: 'method', filePath: 'src/o.ts', name: 'list' },
    ]).run()

    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: null, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/orders' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController', targetId: 'r1:src/o.ts:OrderController.list', relation: 'contains' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OrderController.list', targetId: null, relation: 'decorates', targetSymbol: 'Get', firstArg: '/list' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    // DB에 저장됐는지 확인
    const eps = db.select().from(entryPoints).where(eq(entryPoints.repoId, REPO)).all()
    expect(eps).toHaveLength(1)
    expect(eps[0].framework).toBe('nestjs')
    expect(eps[0].path).toBe('/list')

    // framework_detections 도 저장
    const dets = db.select().from(frameworkDetections).where(eq(frameworkDetections.repoId, REPO)).all()
    expect(dets).toHaveLength(1)
    expect(dets[0].framework).toBe('nestjs')

    // 결과도 반환
    expect(result.entryPoints).toHaveLength(1)

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, 'build_route')).get()
    expect(run).toMatchObject({ projectId: PROJECT, repoId: REPO, status: 'done' })
    const phase = db.select().from(repositoryPhaseStatus)
      .where(eq(repositoryPhaseStatus.repositoryId, REPO))
      .all()
      .find((row) => row.phase === 'build_route')
    expect(phase).toMatchObject({
      status: 'passed',
      sourceRunId: run!.id,
      meta: {
        patternDslTelemetry: expect.any(Object),
      },
    })
    expect(phase?.builtAt).toBeTruthy()
    expect(db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, run!.id)).all().map((step) => step.step)).toEqual([
      'F0:loadRouteContext',
      'F2:patternDslRoutes',
      'F1:activateAdapters',
      'F2:loadAdapters',
      'F3:runRuleEngine',
      'F4:evaluateSourceFallbacks',
      'F4:evaluateSourceAnalyzers',
      'F6:composeEntryPoints',
      'F7:resolveReachability',
      'F8:persistResults',
    ])
  })

  it('idempotent: 두 번 실행 → 1 row', async () => {
    setupRepo('nestjs')
    db.insert(codeNodes).values([
      { id: 'r1:src/o.ts:OC', repoId: REPO, type: 'class', filePath: 'src/o.ts', name: 'OC' },
      { id: 'r1:src/o.ts:OC.list', repoId: REPO, type: 'method', filePath: 'src/o.ts', name: 'list' },
    ]).run()
    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/o.ts:OC', relation: 'decorates', targetSymbol: 'Controller', firstArg: '/x' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OC', targetId: 'r1:src/o.ts:OC.list', relation: 'contains' },
      { repoId: REPO, sourceId: 'r1:src/o.ts:OC.list', relation: 'decorates', targetSymbol: 'Get', firstArg: '/y' },
    ]).run()

    await runBuildRoute({ db, repoId: REPO })
    await runBuildRoute({ db, repoId: REPO })
    expect(db.select().from(entryPoints).all()).toHaveLength(1)
  })

  it('apiBasePaths가 있으면 api entry fullPath에 prefix 적용', async () => {
    setupRepo('nestjs', ['/api'])
    db.insert(codeNodes).values([
      { id: 'r1:src/app.ts:AppController', repoId: REPO, type: 'class', filePath: 'src/app.ts', name: 'AppController' },
      { id: 'r1:src/app.ts:AppController.root', repoId: REPO, type: 'method', filePath: 'src/app.ts', name: 'root' },
    ]).run()
    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/app.ts:AppController', relation: 'decorates', targetSymbol: 'Controller', firstArg: null },
      { repoId: REPO, sourceId: 'r1:src/app.ts:AppController', targetId: 'r1:src/app.ts:AppController.root', relation: 'contains' },
      { repoId: REPO, sourceId: 'r1:src/app.ts:AppController.root', relation: 'decorates', targetSymbol: 'Get', firstArg: null },
    ]).run()

    await runBuildRoute({ db, repoId: REPO })

    const eps = db.select().from(entryPoints).where(eq(entryPoints.repoId, REPO)).all()
    expect(eps).toHaveLength(1)
    expect(eps[0].path).toBe('/')
    expect(eps[0].fullPath).toBe('/api')
  })

  it('extracts Controller object path values', async () => {
    setupRepo('nestjs')
    db.insert(codeNodes).values([
      { id: 'r1:src/users.ts:UsersController', repoId: REPO, type: 'class', filePath: 'src/users.ts', name: 'UsersController' },
      { id: 'r1:src/users.ts:UsersController.me', repoId: REPO, type: 'method', filePath: 'src/users.ts', name: 'me' },
    ]).run()
    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/users.ts:UsersController', relation: 'decorates', targetSymbol: 'Controller', firstArg: "{ path: 'users', version: '1' }" },
      { repoId: REPO, sourceId: 'r1:src/users.ts:UsersController', targetId: 'r1:src/users.ts:UsersController.me', relation: 'contains' },
      { repoId: REPO, sourceId: 'r1:src/users.ts:UsersController.me', relation: 'decorates', targetSymbol: 'Get', firstArg: 'me' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    }))).toEqual([{ method: 'GET', path: '/users/me' }])
  })

  it('falls back to source parsing when graph loses Controller object first_arg', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-nest-controller-object-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/users.controller.ts'),
      `
        import { Controller, Get } from '@nestjs/common'

        @Controller({
          path: 'users',
          version: '1',
        })
        export class UsersController {
          @Get('me')
          getCurrentUser() {
            return {}
          }
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories).values({
      id: REPO,
      projectId: PROJECT,
      name: 'r',
      repoPath,
      framework: 'nestjs' as never,
    }).run()
    db.insert(codeNodes).values([
      { id: 'r1:src/users.controller.ts', repoId: REPO, type: 'file', filePath: 'src/users.controller.ts', name: 'src/users.controller.ts' },
      { id: 'r1:src/users.controller.ts:UsersController', repoId: REPO, type: 'class', filePath: 'src/users.controller.ts', name: 'UsersController' },
      { id: 'r1:src/users.controller.ts:UsersController.getCurrentUser', repoId: REPO, type: 'method', filePath: 'src/users.controller.ts', name: 'UsersController.getCurrentUser' },
    ]).run()
    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/users.controller.ts:UsersController', relation: 'decorates', targetSymbol: 'Controller', firstArg: null },
      { repoId: REPO, sourceId: 'r1:src/users.controller.ts:UsersController', targetId: 'r1:src/users.controller.ts:UsersController.getCurrentUser', relation: 'contains' },
      { repoId: REPO, sourceId: 'r1:src/users.controller.ts:UsersController.getCurrentUser', relation: 'decorates', targetSymbol: 'Get', firstArg: 'me' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    // G6: @Controller({ version: '1', path: 'users' }) → /v1/users/me (versioning prefix 적용)
    expect(result.entryPoints.some((entry) => entry.httpMethod === 'GET' && entry.fullPath === '/v1/users/me')).toBe(true)
  })
})

describe('runBuildRoute — Express api base paths', () => {
  it('applies a single analyzed apiBasePath to unprefixed Express routes only', async () => {
    setupRepo('express', ['/api'])
    db.insert(codeNodes).values([
      { id: 'r1:src/main.ts', repoId: REPO, type: 'file', filePath: 'src/main.ts', name: 'src/main.ts' },
    ]).run()
    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/main.ts', relation: 'imports', targetSpecifier: 'express' },
      { repoId: REPO, sourceId: 'r1:src/main.ts', relation: 'calls', targetSymbol: 'get', chainPath: 'app.get', firstArg: '/' },
      { repoId: REPO, sourceId: 'r1:src/main.ts', relation: 'calls', targetSymbol: 'get', chainPath: 'app.get', firstArg: '/health' },
      { repoId: REPO, sourceId: 'r1:src/main.ts', relation: 'calls', targetSymbol: 'get', chainPath: 'app.get', firstArg: '/articles' },
      { repoId: REPO, sourceId: 'r1:src/main.ts', relation: 'calls', targetSymbol: 'get', chainPath: 'app.get', firstArg: '/api-docs' },
      { repoId: REPO, sourceId: 'r1:src/main.ts', relation: 'calls', targetSymbol: 'post', chainPath: 'app.post', firstArg: '/api/users' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => a.path!.localeCompare(b.path!))).toEqual([
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/api-docs' },
      { method: 'GET', path: '/api/articles' },
      { method: 'POST', path: '/api/users' },
      { method: 'GET', path: '/health' },
    ])
  })

  it('keeps standalone monitoring mounts outside analyzed apiBasePath', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-monitoring-base-'))
    mkdirSync(join(repoPath, 'src/routes'), { recursive: true })
    writeFileSync(join(repoPath, 'src/app.ts'), `
      import express from 'express'
      import monitoringRoutes from './routes/monitoring.routes'
      const app = express()
      app.use('/api/monitoring', monitoringRoutes)
      app.use('/monitoring', monitoringRoutes)
    `)
    writeFileSync(join(repoPath, 'src/routes/monitoring.routes.ts'), `
      import { Router } from 'express'
      const router = Router()
      router.get('/health', health)
      router.post('/alerts', alerts)
      export default router
    `)

    setupRepo('express', ['/api'], repoPath)
    db.insert(codeNodes).values([
      { id: 'r1:src/app.ts', repoId: REPO, type: 'file', filePath: 'src/app.ts', name: 'src/app.ts' },
      { id: 'r1:src/routes/monitoring.routes.ts', repoId: REPO, type: 'file', filePath: 'src/routes/monitoring.routes.ts', name: 'src/routes/monitoring.routes.ts' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`))).toEqual([
      { method: 'POST', path: '/api/monitoring/alerts' },
      { method: 'GET', path: '/api/monitoring/health' },
      { method: 'POST', path: '/monitoring/alerts' },
      { method: 'GET', path: '/monitoring/health' },
    ])
  })
})

describe('runBuildRoute — Express route tables', () => {
  it('extracts destructured RouteConfig array mounts with router.route chains', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-route-config-array-'))
    mkdirSync(join(repoPath, 'src/modules/user'), { recursive: true })
    writeFileSync(join(repoPath, 'src/app.ts'), `
      import express from 'express'
      import routes from './routes'
      const app = express()
      app.use('/v1', routes)
    `)
    writeFileSync(join(repoPath, 'src/routes.ts'), `
      import express from 'express'
      import userRoute from './modules/user/user.route'
      const router = express.Router()
      const routes: Array<{ path: string; route: express.Router }> = [
        { path: '/users', route: userRoute },
      ]
      routes.forEach(({ path, route, middleware = [] }) => {
        if (middleware.length > 0) {
          router.use(path, middleware, route)
        } else {
          router.use(path, route)
        }
      })
      export default router
    `)
    writeFileSync(join(repoPath, 'src/modules/user/user.route.ts'), `
      import express from 'express'
      const router = express.Router()
      router
        .route('/')
        .post(createUser)
        .get(getUsers)
      router
        .route('/:userId')
        .get(getUser)
        .patch(updateUser)
        .delete(deleteUser)
      export default router
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes).values([
      { id: 'r1:src/app.ts', repoId: REPO, type: 'file', filePath: 'src/app.ts', name: 'src/app.ts' },
      { id: 'r1:src/routes.ts', repoId: REPO, type: 'file', filePath: 'src/routes.ts', name: 'src/routes.ts' },
      { id: 'r1:src/modules/user/user.route.ts', repoId: REPO, type: 'file', filePath: 'src/modules/user/user.route.ts', name: 'src/modules/user/user.route.ts' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`))).toEqual([
      { method: 'GET', path: '/v1/users' },
      { method: 'POST', path: '/v1/users' },
      { method: 'DELETE', path: '/v1/users/:userId' },
      { method: 'GET', path: '/v1/users/:userId' },
      { method: 'PATCH', path: '/v1/users/:userId' },
    ])
  })

  it('extracts exported AppRoutes path/method/action arrays', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-route-table-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(join(repoPath, 'src/routes.ts'), `
      import { postGetAllAction } from './controller/PostGetAllAction'
      export const AppRoutes = [
        { path: "/posts", method: "get", action: postGetAllAction },
        { path: "/posts/:id", method: "get", action: postGetByIdAction },
        { path: "/posts", method: "post", action: postSaveAction }
      ];
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes).values([
      { id: 'r1:src/routes.ts', repoId: REPO, type: 'file', filePath: 'src/routes.ts', name: 'src/routes.ts' },
      { id: 'r1:src/controller/PostGetAllAction.ts:postGetAllAction', repoId: REPO, type: 'function', filePath: 'src/controller/PostGetAllAction.ts', name: 'postGetAllAction', exported: true },
      { id: 'r1:src/controller/PostGetByIdAction.ts:postGetByIdAction', repoId: REPO, type: 'function', filePath: 'src/controller/PostGetByIdAction.ts', name: 'postGetByIdAction', exported: true },
      { id: 'r1:src/controller/PostSaveAction.ts:postSaveAction', repoId: REPO, type: 'function', filePath: 'src/controller/PostSaveAction.ts', name: 'postSaveAction', exported: true },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
      handlerNodeId: entry.handlerNodeId,
    })).sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`))).toEqual([
      {
        method: 'GET',
        path: '/posts',
        handlerNodeId: 'r1:src/controller/PostGetAllAction.ts:postGetAllAction',
      },
      {
        method: 'GET',
        path: '/posts/:id',
        handlerNodeId: 'r1:src/controller/PostGetByIdAction.ts:postGetByIdAction',
      },
      {
        method: 'POST',
        path: '/posts',
        handlerNodeId: 'r1:src/controller/PostSaveAction.ts:postSaveAction',
      },
    ])
  })
})

describe('runBuildRoute — Express direct app routes', () => {
  it('extracts direct app routes from quoted and static template-literal paths', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-direct-app-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(join(repoPath, 'src/server.ts'), `
      import express, { Request } from 'express'
      const app = express()
      app.use(express.json())
      app.post('/user', createUser)
      app.get(\`/:userId/nearby-places\`, listNearbyPlaces)
      app.get(\`/dynamic/\${kind}\`, dynamicRoute)
      // app.options('*', cors())
      /*
       * app.delete('/disabled', removeDisabled)
       */
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes).values([
      { id: 'r1:src/server.ts', repoId: REPO, type: 'file', filePath: 'src/server.ts', name: 'src/server.ts' },
    ]).run()
    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:src/server.ts', relation: 'calls', targetSymbol: 'post', chainPath: 'app', firstArg: '/user' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`))).toEqual([
      { method: 'GET', path: '/:userId/nearby-places' },
      { method: 'POST', path: '/user' },
    ])
  })

  it('extracts direct app routes from string constants', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-direct-app-const-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(join(repoPath, 'src/app.ts'), `
      import express, { type Request } from 'express'
      const app = express()
      app.use(express.json())
      const metricsEndpoint = '/metrics'
      app.get(metricsEndpoint, metrics)
      app.get(dynamicEndpoint, dynamic)
      app.get('/ping', ping)
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes).values([
      { id: 'r1:src/app.ts', repoId: REPO, type: 'file', filePath: 'src/app.ts', name: 'src/app.ts' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`))).toEqual([
      { method: 'GET', path: '/metrics' },
      { method: 'GET', path: '/ping' },
    ])
  })

  it('extracts Swagger UI middleware mounts as standalone docs routes', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-swagger-middleware-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(join(repoPath, 'src/swagger.ts'), `
      import swaggerUi from 'swagger-ui-express'
      import { Express } from 'express'
      export const setupSwagger = (app: Express) => {
        app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerSpec))
      }
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes).values([
      { id: 'r1:src/swagger.ts', repoId: REPO, type: 'file', filePath: 'src/swagger.ts', name: 'src/swagger.ts' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    }))).toEqual([
      { method: 'ALL', path: '/swagger' },
    ])
  })
})

describe('runBuildRoute — Express REST controller maps', () => {
  it('expands Object.entries(routes) standard REST controller guards', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-rest-map-'))
    mkdirSync(join(repoPath, 'express'), { recursive: true })
    writeFileSync(join(repoPath, 'express/app.js'), `
      const express = require('express')
      const routes = {
        users: require('./routes/users'),
        instruments: require('./routes/instruments'),
      }
      const app = express()
      for (const [routeName, routeController] of Object.entries(routes)) {
        if (routeController.getAll) app.get(\`/api/\${routeName}\`, routeController.getAll)
        if (routeController.getById) app.get(\`/api/\${routeName}/:id\`, routeController.getById)
        if (routeController.create) app.post(\`/api/\${routeName}\`, routeController.create)
        if (routeController.update) app.put(\`/api/\${routeName}/:id\`, routeController.update)
        if (routeController.remove) app.delete(\`/api/\${routeName}/:id\`, routeController.remove)
      }
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes).values([
      { id: 'r1:express/app.js', repoId: REPO, type: 'file', filePath: 'express/app.js', name: 'express/app.js' },
    ]).run()
    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:express/app.js', relation: 'imports', targetSpecifier: 'express' },
      { repoId: REPO, sourceId: 'r1:express/app.js', relation: 'calls', targetSymbol: 'express', chainPath: null, firstArg: null },
      { repoId: REPO, sourceId: 'r1:express/app.js', relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: '/' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`))).toEqual([
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/api/instruments' },
      { method: 'POST', path: '/api/instruments' },
      { method: 'DELETE', path: '/api/instruments/:id' },
      { method: 'GET', path: '/api/instruments/:id' },
      { method: 'PUT', path: '/api/instruments/:id' },
      { method: 'GET', path: '/api/users' },
      { method: 'POST', path: '/api/users' },
      { method: 'DELETE', path: '/api/users/:id' },
      { method: 'GET', path: '/api/users/:id' },
      { method: 'PUT', path: '/api/users/:id' },
    ])
  })
})

describe('runBuildRoute — Express mounted router variables', () => {
  it('follows require variables through nested router.use mounts and router.route chains', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-var-mount-'))
    mkdirSync(join(repoPath, 'config'), { recursive: true })
    mkdirSync(join(repoPath, 'server/user'), { recursive: true })
    writeFileSync(join(repoPath, 'config/express.js'), `
      const express = require('express')
      const routes = require('../index.route')
      const app = express()
      app.use('/api', routes)
    `)
    writeFileSync(join(repoPath, 'index.route.js'), `
      const express = require('express')
      const userRoutes = require('./server/user/user.route')
      const router = express.Router()
      router.get('/health-check', (_req, res) => res.send('OK'))
      router.use('/users', userRoutes)
      module.exports = router
    `)
    writeFileSync(join(repoPath, 'server/user/user.route.js'), `
      const express = require('express')
      const router = express.Router()
      router.route('/')
        .get(userCtrl.list)
        .post(userCtrl.create)
      router.route('/:userId')
        .get(userCtrl.get)
        .put(userCtrl.update)
        .delete(userCtrl.remove)
      module.exports = router
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes).values([
      { id: 'r1:config/express.js', repoId: REPO, type: 'file', filePath: 'config/express.js', name: 'config/express.js' },
      { id: 'r1:index.route.js', repoId: REPO, type: 'file', filePath: 'index.route.js', name: 'index.route.js' },
      { id: 'r1:server/user/user.route.js', repoId: REPO, type: 'file', filePath: 'server/user/user.route.js', name: 'server/user/user.route.js' },
    ]).run()
    db.insert(codeEdges).values([
      { repoId: REPO, sourceId: 'r1:config/express.js', relation: 'calls', targetSymbol: 'use', chainPath: 'app', firstArg: '/api' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`))).toEqual([
      { method: 'GET', path: '/api/health-check' },
      { method: 'GET', path: '/api/users' },
      { method: 'POST', path: '/api/users' },
      { method: 'DELETE', path: '/api/users/:userId' },
      { method: 'GET', path: '/api/users/:userId' },
      { method: 'PUT', path: '/api/users/:userId' },
    ])
  })

  it('follows named imported routers through barrel re-exports', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-import-mount-'))
    mkdirSync(join(repoPath, 'app/controllers'), { recursive: true })
    writeFileSync(join(repoPath, 'app/server.js'), `
      import express from 'express'
      import { AuthorController } from './controllers/index.js'
      const app = express()
      app.get('/', home)
      app.use('/author', AuthorController)
    `)
    writeFileSync(join(repoPath, 'app/controllers/index.js'), `
      export * from './author.controller.js'
    `)
    writeFileSync(join(repoPath, 'app/controllers/author.controller.js'), `
      import { Router } from 'express'
      const router = Router()
      router.get('/', list)
      router.put('/:id', update)
      export { router as AuthorController }
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes).values([
      { id: 'r1:app/server.js', repoId: REPO, type: 'file', filePath: 'app/server.js', name: 'app/server.js' },
      { id: 'r1:app/controllers/index.js', repoId: REPO, type: 'file', filePath: 'app/controllers/index.js', name: 'app/controllers/index.js' },
      { id: 'r1:app/controllers/author.controller.js', repoId: REPO, type: 'file', filePath: 'app/controllers/author.controller.js', name: 'app/controllers/author.controller.js' },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`))).toEqual([
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/author' },
      { method: 'PUT', path: '/author/:id' },
    ])
  })

  it('follows named imported routers mounted without an explicit base path', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-import-root-mount-'))
    mkdirSync(join(repoPath, 'src/routes'), { recursive: true })
    writeFileSync(join(repoPath, 'src/index.ts'), `
      import express from 'express'
      import { postRouter } from './routes/post.routes'
      const app = express()
      app.use(postRouter)
    `)
    writeFileSync(join(repoPath, 'src/routes/post.routes.ts'), `
      import { Router } from 'express'
      export const postRouter = Router()
      postRouter.get('/feed', list)
      postRouter.post('/post', create)
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes)
      .values([
        { id: 'r1:src/index.ts', repoId: REPO, type: 'file', filePath: 'src/index.ts', name: 'src/index.ts' },
        {
          id: 'r1:src/routes/post.routes.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'src/routes/post.routes.ts',
          name: 'src/routes/post.routes.ts',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`))).toEqual([
      { method: 'GET', path: '/feed' },
      { method: 'POST', path: '/post' },
    ])
  })

  it('follows imported routers mounted from a custom Express app variable', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-custom-app-var-'))
    mkdirSync(join(repoPath, 'src/apps'), { recursive: true })
    mkdirSync(join(repoPath, 'src/routes'), { recursive: true })
    writeFileSync(join(repoPath, 'src/apps/web.ts'), `
      import express from 'express'
      import { publicRouter } from '../routes/public-api'
      import { apiRouter } from '../routes/api'
      export const web = express()
      web.use(express.json())
      web.use(publicRouter)
      web.use(apiRouter)
    `)
    writeFileSync(join(repoPath, 'src/routes/public-api.ts'), `
      import express from 'express'
      export const publicRouter = express.Router()
      publicRouter.post('/api/users', register)
      publicRouter.post('/api/users/login', login)
    `)
    writeFileSync(join(repoPath, 'src/routes/api.ts'), `
      import express from 'express'
      export const apiRouter = express.Router()
      apiRouter.get('/api/users/current', getCurrent)
      apiRouter.patch('/api/users/current', updateCurrent)
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes)
      .values([
        { id: 'r1:src/apps/web.ts', repoId: REPO, type: 'file', filePath: 'src/apps/web.ts', name: 'src/apps/web.ts' },
        {
          id: 'r1:src/routes/public-api.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'src/routes/public-api.ts',
          name: 'src/routes/public-api.ts',
        },
        {
          id: 'r1:src/routes/api.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'src/routes/api.ts',
          name: 'src/routes/api.ts',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`))).toEqual([
      { method: 'GET', path: '/api/users/current' },
      { method: 'PATCH', path: '/api/users/current' },
      { method: 'POST', path: '/api/users' },
      { method: 'POST', path: '/api/users/login' },
    ])
  })

  it('follows imported routers mounted through route arrays', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-route-array-mount-'))
    mkdirSync(join(repoPath, 'src/routes/v1'), { recursive: true })
    writeFileSync(join(repoPath, 'src/app.ts'), `
      import express from 'express'
      import routes from './routes/v1'
      const app = express()
      app.use('/v1', routes)
    `)
    writeFileSync(join(repoPath, 'src/routes/v1/index.ts'), `
      import express from 'express'
      import authRoute from './auth.route'
      import userRoute from './user.route'

      const router = express.Router()
      const defaultRoutes = [
        { path: '/auth', route: authRoute },
        { path: '/users', route: userRoute },
      ]

      defaultRoutes.forEach((route) => {
        router.use(route.path, route.route)
      })

      export default router
    `)
    writeFileSync(join(repoPath, 'src/routes/v1/auth.route.ts'), `
      import express from 'express'
      const router = express.Router()
      router.post('/login', login)
      export default router
    `)
    writeFileSync(join(repoPath, 'src/routes/v1/user.route.ts'), `
      import express from 'express'
      const router = express.Router()
      router
        .route('/')
        .get(list)
        .post(create)
      router
        .route('/:userId')
        .patch(update)
        .delete(remove)
      export default router
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes)
      .values([
        { id: 'r1:src/app.ts', repoId: REPO, type: 'file', filePath: 'src/app.ts', name: 'src/app.ts' },
        {
          id: 'r1:src/routes/v1/index.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'src/routes/v1/index.ts',
          name: 'src/routes/v1/index.ts',
        },
        {
          id: 'r1:src/routes/v1/auth.route.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'src/routes/v1/auth.route.ts',
          name: 'src/routes/v1/auth.route.ts',
        },
        {
          id: 'r1:src/routes/v1/user.route.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'src/routes/v1/user.route.ts',
          name: 'src/routes/v1/user.route.ts',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`))).toEqual([
      { method: 'POST', path: '/v1/auth/login' },
      { method: 'GET', path: '/v1/users' },
      { method: 'POST', path: '/v1/users' },
      { method: 'DELETE', path: '/v1/users/:userId' },
      { method: 'PATCH', path: '/v1/users/:userId' },
    ])
  })

  it('follows imported routers mounted through an app.use router array and Apollo GraphQL middleware', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-router-array-variable-'))
    mkdirSync(join(repoPath, 'src/modules/auth/routes'), { recursive: true })
    mkdirSync(join(repoPath, 'src/modules/user/routes'), { recursive: true })
    mkdirSync(join(repoPath, 'src/graphql'), { recursive: true })
    writeFileSync(join(repoPath, 'src/app.ts'), `
      import express, { Router } from 'express'
      import { initApolloGraphqlServer } from '@/graphql/index.js'
      import { authRouter } from '@/modules/auth/routes/index.js'
      import { userRouter } from '@/modules/user/routes/index.js'
      const app = express()
      const routers: Router[] = [
        authRouter,
        userRouter,
      ]
      app.use(routers)
      initApolloGraphqlServer(app)
    `)
    writeFileSync(join(repoPath, 'src/graphql/index.ts'), `
      import { Express } from 'express'
      import { expressMiddleware } from '@apollo/server/express4'
      export const initApolloGraphqlServer = async (app: Express) => {
        const GRAPHQL_PATH = '/graphql'
        app.use(GRAPHQL_PATH, expressMiddleware(apolloServer))
      }
    `)
    writeFileSync(join(repoPath, 'src/modules/auth/routes/index.ts'), `
      import express from 'express'
      const router = express.Router()
      router.post('/api/v1/auth/login', login)
      if (!env.isProduction) {
        router.get('/api/v1/auth/logout', logout)
        router.get('/api/v1/auth/login/superadmin', loginSuperadmin)
      }
      export const authRouter = router
    `)
    writeFileSync(join(repoPath, 'src/modules/user/routes/index.ts'), `
      import express from 'express'
      const router = express.Router()
      router.get('/api/v1/users', list)
      router.get('/api/v1/users/:userId', show)
      export const userRouter = router
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes)
      .values([
        { id: 'r1:src/app.ts', repoId: REPO, type: 'file', filePath: 'src/app.ts', name: 'src/app.ts' },
        { id: 'r1:src/graphql/index.ts', repoId: REPO, type: 'file', filePath: 'src/graphql/index.ts', name: 'src/graphql/index.ts' },
        {
          id: 'r1:src/modules/auth/routes/index.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'src/modules/auth/routes/index.ts',
          name: 'src/modules/auth/routes/index.ts',
        },
        {
          id: 'r1:src/modules/user/routes/index.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'src/modules/user/routes/index.ts',
          name: 'src/modules/user/routes/index.ts',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`))).toEqual([
      { method: 'ALL', path: '/graphql' },
      { method: 'GET', path: '/api/v1/auth/login/superadmin' },
      { method: 'GET', path: '/api/v1/auth/logout' },
      { method: 'GET', path: '/api/v1/users' },
      { method: 'GET', path: '/api/v1/users/:userId' },
      { method: 'POST', path: '/api/v1/auth/login' },
    ])
  })

  it('extracts class field router route chains', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-class-router-'))
    mkdirSync(join(repoPath, 'src/routes'), { recursive: true })
    writeFileSync(join(repoPath, 'src/routes/index.ts'), `
      import { Application } from 'express'
      import courseRouter from './CourseRoutes'
      export default class Routes {
        constructor(app: Application) {
          app.use('/api/courses', courseRouter)
        }
      }
    `)
    writeFileSync(join(repoPath, 'src/routes/CourseRoutes.ts'), `
      import { Router } from 'express'
      class CourseRoutes {
        router = Router()
        constructor() {
          this.router.route('/').get(list).post(create)
          this.router.route('/:id')
            .get(getOne)
            .delete(remove)
        }
      }
      export default new CourseRoutes().router
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes)
      .values([
        { id: 'r1:src/routes/index.ts', repoId: REPO, type: 'file', filePath: 'src/routes/index.ts', name: 'src/routes/index.ts' },
        {
          id: 'r1:src/routes/CourseRoutes.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'src/routes/CourseRoutes.ts',
          name: 'src/routes/CourseRoutes.ts',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`))).toEqual([
      { method: 'GET', path: '/api/courses' },
      { method: 'POST', path: '/api/courses' },
      { method: 'DELETE', path: '/api/courses/:id' },
      { method: 'GET', path: '/api/courses/:id' },
    ])
  })
})

describe('runBuildRoute — Next.js file-based', () => {
  it('app/dashboard/page.tsx 의 default export function → entry_points page 1건', async () => {
    // 어댑터가 node_type='function' + is_default_export=true 로 변경됨.
    setupRepo('nextjs')
    db.insert(codeNodes).values([
      {
        id: 'r1:app/dashboard/page.tsx',
        repoId: REPO, type: 'file',
        filePath: 'app/dashboard/page.tsx',
        name: 'page.tsx',
        isDefaultExport: false, exported: false,
      },
      {
        id: 'r1:app/dashboard/page.tsx:DashboardPage',
        repoId: REPO, type: 'function',
        filePath: 'app/dashboard/page.tsx',
        name: 'DashboardPage',
        isDefaultExport: true, exported: true,
      },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })
    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0].path).toBe('/dashboard')
    expect(result.entryPoints[0].handlerNodeId).toBe('r1:app/dashboard/page.tsx:DashboardPage')
  })

  it('app route.ts named re-exports produce method-specific API entries', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-next-route-reexport-'))
    mkdirSync(join(repoPath, 'app/api/auth/[...nextauth]'), { recursive: true })
    writeFileSync(
      join(repoPath, 'app/api/auth/[...nextauth]/route.ts'),
      `export { GET, POST } from "@/auth";\n`,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories).values({
      id: REPO,
      projectId: PROJECT,
      name: 'r',
      repoPath,
      framework: 'nextjs' as never,
    }).run()
    db.insert(codeNodes).values([
      {
        id: 'r1:app/api/auth/[...nextauth]/route.ts',
        repoId: REPO,
        type: 'file',
        filePath: 'app/api/auth/[...nextauth]/route.ts',
        name: 'route.ts',
        isDefaultExport: false,
        exported: false,
      },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })
    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.path,
    })).sort((a, b) => String(a.method).localeCompare(String(b.method)))).toEqual([
      { method: 'GET', path: '/api/auth/:nextauth*' },
      { method: 'POST', path: '/api/auth/:nextauth*' },
    ])
  })

  it('follows default imported routers through nested mounts and static template prefixes', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-default-nested-mount-'))
    mkdirSync(join(repoPath, 'src/routes/v1'), { recursive: true })
    writeFileSync(join(repoPath, 'src/index.ts'), `
      import express from 'express'
      import routes from './routes'
      const app = express()
      app.use('/', routes)
    `)
    writeFileSync(join(repoPath, 'src/routes/index.ts'), `
      import { Router } from 'express'
      import v1 from './v1/'
      import pageRoot from './pages/root'
      import page404 from './pages/404'
      const router = Router()
      router.use(\`/v1\`, v1)
      router.use(pageRoot)
      router.use(page404)
      export default router
    `)
    mkdirSync(join(repoPath, 'src/routes/pages'), { recursive: true })
    writeFileSync(join(repoPath, 'src/routes/pages/root.ts'), `
      import { Router } from 'express'
      const router = Router()
      router.get('/', home)
      export default router
    `)
    writeFileSync(join(repoPath, 'src/routes/pages/404.ts'), `
      import { Router } from 'express'
      const router = Router()
      router.get('*', notFound)
      export default router
    `)
    writeFileSync(join(repoPath, 'src/routes/v1/index.ts'), `
      import { Router } from 'express'
      import auth from './auth'
      import users from './users'
      const router = Router()
      router.use('/auth', auth)
      router.use('/users', users)
      export default router
    `)
    writeFileSync(join(repoPath, 'src/routes/v1/auth.ts'), `
      import { Router } from 'express'
      const router = Router()
      router.post('/login', login)
      export default router
    `)
    writeFileSync(join(repoPath, 'src/routes/v1/users.ts'), `
      import { Router } from 'express'
      const router = Router()
      router.get('/:id([0-9]+)', show)
      export default router
    `)

    setupRepo('express', ['/v1'], repoPath)
    db.insert(codeNodes)
      .values([
        { id: 'r1:src/index.ts', repoId: REPO, type: 'file', filePath: 'src/index.ts', name: 'src/index.ts' },
        { id: 'r1:src/routes/index.ts', repoId: REPO, type: 'file', filePath: 'src/routes/index.ts', name: 'src/routes/index.ts' },
        { id: 'r1:src/routes/pages/root.ts', repoId: REPO, type: 'file', filePath: 'src/routes/pages/root.ts', name: 'src/routes/pages/root.ts' },
        { id: 'r1:src/routes/pages/404.ts', repoId: REPO, type: 'file', filePath: 'src/routes/pages/404.ts', name: 'src/routes/pages/404.ts' },
        { id: 'r1:src/routes/v1/index.ts', repoId: REPO, type: 'file', filePath: 'src/routes/v1/index.ts', name: 'src/routes/v1/index.ts' },
        { id: 'r1:src/routes/v1/auth.ts', repoId: REPO, type: 'file', filePath: 'src/routes/v1/auth.ts', name: 'src/routes/v1/auth.ts' },
        { id: 'r1:src/routes/v1/users.ts', repoId: REPO, type: 'file', filePath: 'src/routes/v1/users.ts', name: 'src/routes/v1/users.ts' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`))).toEqual([
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/*' },
      { method: 'GET', path: '/v1/users/:id([0-9]+)' },
      { method: 'POST', path: '/v1/auth/login' },
    ])
  })

  it('follows class field app mounts with dynamic template prefixes', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-class-app-template-mount-'))
    mkdirSync(join(repoPath, 'src/modules/users'), { recursive: true })
    writeFileSync(join(repoPath, 'src/app.ts'), `
      import express from 'express'
      import home from './home'
      import routes from '@/modules'

      class App {
        public express = express()
        setRoutes() {
          const version = 'v1'
          const env = 'development'
          this.express.use('/', home)
          this.express.use(\`/api/\${version}/\${env}\`, routes)
        }
      }
    `)
    writeFileSync(join(repoPath, 'src/home.ts'), `
      import { Router } from 'express'
      const home = Router()
      home.get('/', homePage)
      export default home
    `)
    writeFileSync(join(repoPath, 'src/modules/index.ts'), `
      import { Router } from 'express'
      import users from './users/users.route'
      const router = Router()
      router.use('/users', users)
      export default router
    `)
    writeFileSync(join(repoPath, 'src/modules/users/users.route.ts'), `
      import { Router } from 'express'
      const users = Router()
      users.post('/create', createUser)
      export default users
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes)
      .values([
        { id: 'r1:src/app.ts', repoId: REPO, type: 'file', filePath: 'src/app.ts', name: 'src/app.ts' },
        { id: 'r1:src/home.ts', repoId: REPO, type: 'file', filePath: 'src/home.ts', name: 'src/home.ts' },
        { id: 'r1:src/modules/index.ts', repoId: REPO, type: 'file', filePath: 'src/modules/index.ts', name: 'src/modules/index.ts' },
        { id: 'r1:src/modules/users/users.route.ts', repoId: REPO, type: 'file', filePath: 'src/modules/users/users.route.ts', name: 'src/modules/users/users.route.ts' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`))).toEqual([
      { method: 'GET', path: '/' },
      { method: 'POST', path: '/api/v1/:env/users/create' },
    ])
  })

  it('follows class instance app routers into mounted getRouter classes', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-class-instance-router-'))
    mkdirSync(join(repoPath, 'src/app/modules/user/routes'), { recursive: true })
    writeFileSync(join(repoPath, 'src/app/index.ts'), `
      import express from 'express'
      import AppRouter from './router'
      class App {
        private readonly app = express()
        registerRoutes(): void {
          new AppRouter(this.app).loadRouters()
        }
      }
    `)
    writeFileSync(join(repoPath, 'src/app/router.ts'), `
      import { Express, Request, Response } from 'express'
      import LoadUserRouters from './modules/user/routes'
      class AppRouter {
        private readonly userRouters: LoadUserRouters
        constructor(private readonly app: Express) {
          this.userRouters = new LoadUserRouters(this.app)
        }
        loadRouters(): void {
          this.healthCheck(this.app)
          this.userRouters.loadRouters()
        }
        private healthCheck(app: Express): void {
          app.get('/', (_req: Request, res: Response) => res.json({ ok: true }))
        }
      }
      export default AppRouter
    `)
    writeFileSync(join(repoPath, 'src/app/modules/user/routes/index.ts'), `
      import { Express } from 'express'
      import AuthRouter from './auth.routes'
      import UserRouter from './user.routes'
      class LoadUserRouters {
        private authRouter: AuthRouter
        private userRouter: UserRouter
        constructor(private readonly router: Express) {
          this.authRouter = new AuthRouter()
          this.userRouter = new UserRouter()
        }
        loadRouters(): void {
          this.router.use('/api/v1/auth', this.authRouter.getRouter())
          this.router.use('/api/v1/user', this.userRouter.getRouter())
        }
      }
      export default LoadUserRouters
    `)
    writeFileSync(join(repoPath, 'src/app/modules/user/routes/auth.routes.ts'), `
      import { Router } from 'express'
      class AuthRouter {
        private router: Router
        constructor() {
          this.router = Router()
          this.initializeRoutes()
        }
        private initializeRoutes(): void {
          this.router.post('/register', registerUser)
          this.router.get('/logout', logoutUser)
        }
        getRouter(): Router {
          return this.router
        }
      }
      export default AuthRouter
    `)
    writeFileSync(join(repoPath, 'src/app/modules/user/routes/user.routes.ts'), `
      import { Router } from 'express'
      class UserRouter {
        private router: Router
        constructor() {
          this.router = Router()
          this.initializeRoutes()
        }
        initializeRoutes(): void {
          this.router.get('/', getAllUsers)
          this.router.get('/me', getMe)
        }
        getRouter(): Router {
          return this.router
        }
      }
      export default UserRouter
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes)
      .values([
        { id: 'r1:src/app/index.ts', repoId: REPO, type: 'file', filePath: 'src/app/index.ts', name: 'src/app/index.ts' },
        { id: 'r1:src/app/router.ts', repoId: REPO, type: 'file', filePath: 'src/app/router.ts', name: 'src/app/router.ts' },
        { id: 'r1:src/app/modules/user/routes/index.ts', repoId: REPO, type: 'file', filePath: 'src/app/modules/user/routes/index.ts', name: 'src/app/modules/user/routes/index.ts' },
        { id: 'r1:src/app/modules/user/routes/auth.routes.ts', repoId: REPO, type: 'file', filePath: 'src/app/modules/user/routes/auth.routes.ts', name: 'src/app/modules/user/routes/auth.routes.ts' },
        { id: 'r1:src/app/modules/user/routes/user.routes.ts', repoId: REPO, type: 'file', filePath: 'src/app/modules/user/routes/user.routes.ts', name: 'src/app/modules/user/routes/user.routes.ts' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`))).toEqual([
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/api/v1/auth/logout' },
      { method: 'GET', path: '/api/v1/user' },
      { method: 'GET', path: '/api/v1/user/me' },
      { method: 'POST', path: '/api/v1/auth/register' },
    ])
  })

  it('extracts the same imported router mounted under multiple prefixes', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-reused-router-mount-'))
    mkdirSync(join(repoPath, 'src/routes'), { recursive: true })
    writeFileSync(join(repoPath, 'src/app.ts'), `
      import express from 'express'
      import monitoringRoutes from './routes/monitoring'
      const app = express()
      app.use('/api/monitoring', monitoringRoutes)
      app.use('/monitoring', monitoringRoutes)
    `)
    writeFileSync(join(repoPath, 'src/routes/monitoring.ts'), `
      import { Router } from 'express'
      const router = Router()
      router.get('/health', health)
      export default router
    `)

    setupRepo('express', undefined, repoPath)
    db.insert(codeNodes)
      .values([
        { id: 'r1:src/app.ts', repoId: REPO, type: 'file', filePath: 'src/app.ts', name: 'src/app.ts' },
        { id: 'r1:src/routes/monitoring.ts', repoId: REPO, type: 'file', filePath: 'src/routes/monitoring.ts', name: 'src/routes/monitoring.ts' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`))).toEqual([
      { method: 'GET', path: '/api/monitoring/health' },
      { method: 'GET', path: '/monitoring/health' },
    ])
  })

  it('resolves mounted routers re-exported from local barrel imports', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-express-local-barrel-router-'))
    mkdirSync(join(repoPath, 'src/routes/v1'), { recursive: true })
    writeFileSync(join(repoPath, 'src/app.ts'), `
      import express from 'express'
      import { authRouter, passwordRouter } from './routes/v1'
      const app = express()
      app.use('/api/v1/auth', authRouter)
      app.use('/api/v1', passwordRouter)
      app.get('/secret', isAuth, handler)
    `)
    writeFileSync(join(repoPath, 'src/routes/v1/index.ts'), `
      import authRouter from './auth.route'
      import passwordRouter from './password.route'
      export { authRouter, passwordRouter }
    `)
    writeFileSync(join(repoPath, 'src/routes/v1/auth.route.ts'), `
      import { Router } from 'express'
      const authRouter = Router()
      authRouter.post('/signup', signup)
      authRouter.post('/login', login)
      export default authRouter
    `)
    writeFileSync(join(repoPath, 'src/routes/v1/password.route.ts'), `
      import { Router } from 'express'
      const passwordRouter = Router()
      passwordRouter.post('/reset-password/:token', reset)
      export default passwordRouter
    `)

    setupRepo('express', ['/api/v1'], repoPath)
    db.insert(codeNodes)
      .values([
        { id: 'r1:src/app.ts', repoId: REPO, type: 'file', filePath: 'src/app.ts', name: 'src/app.ts' },
        { id: 'r1:src/routes/v1/index.ts', repoId: REPO, type: 'file', filePath: 'src/routes/v1/index.ts', name: 'src/routes/v1/index.ts' },
        { id: 'r1:src/routes/v1/auth.route.ts', repoId: REPO, type: 'file', filePath: 'src/routes/v1/auth.route.ts', name: 'src/routes/v1/auth.route.ts' },
        { id: 'r1:src/routes/v1/password.route.ts', repoId: REPO, type: 'file', filePath: 'src/routes/v1/password.route.ts', name: 'src/routes/v1/password.route.ts' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      method: entry.httpMethod,
      path: entry.fullPath,
    })).sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`))).toEqual([
      { method: 'GET', path: '/secret' },
      { method: 'POST', path: '/api/v1/auth/login' },
      { method: 'POST', path: '/api/v1/auth/signup' },
      { method: 'POST', path: '/api/v1/reset-password/:token' },
    ])
  })
})

describe('runBuildRoute — NestJS GraphQL source fallback', () => {
  it('uses method names for code-first resolver decorators without string operation names', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-nest-gql-code-first-'))
    mkdirSync(join(repoPath, 'src/recipes'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/recipes/recipes.resolver.ts'),
      `
        import { UseGuards } from '@nestjs/common'
        import { Query, Resolver, Subscription } from '@nestjs/graphql'

        @Resolver()
        export class RecipesResolver {
          @Query((returns) => String)
          @UseGuards(class Guard {})
          recipe() {
            return 'recipe'
          }

          @Subscription((returns) => String)
          recipeAdded() {
            return null
          }

          @Query(() => String, { name: 'renamedRecipe' })
          findRecipe() {
            return 'recipe'
          }
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'nestjs' as never,
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:src/recipes/recipes.resolver.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'src/recipes/recipes.resolver.ts',
          name: 'src/recipes/recipes.resolver.ts',
        },
        {
          id: 'r1:src/recipes/recipes.resolver.ts:RecipesResolver.recipe',
          repoId: REPO,
          type: 'method',
          filePath: 'src/recipes/recipes.resolver.ts',
          name: 'RecipesResolver.recipe',
        },
        {
          id: 'r1:src/recipes/recipes.resolver.ts:RecipesResolver.recipeAdded',
          repoId: REPO,
          type: 'method',
          filePath: 'src/recipes/recipes.resolver.ts',
          name: 'RecipesResolver.recipeAdded',
        },
        {
          id: 'r1:src/recipes/recipes.resolver.ts:RecipesResolver.findRecipe',
          repoId: REPO,
          type: 'method',
          filePath: 'src/recipes/recipes.resolver.ts',
          name: 'RecipesResolver.findRecipe',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      kind: entry.kind,
      fullPath: entry.fullPath,
      httpMethod: entry.httpMethod,
    })).sort((a, b) => a.fullPath!.localeCompare(b.fullPath!))).toEqual([
      { kind: 'api', fullPath: '/graphql#query.recipe', httpMethod: 'QUERY' },
      { kind: 'api', fullPath: '/graphql#query.renamedRecipe', httpMethod: 'QUERY' },
      { kind: 'event', fullPath: '/graphql#subscription.recipeAdded', httpMethod: 'SUBSCRIPTION' },
    ])
  })

  it('extracts GraphQL SDL root fields from schema strings', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-nest-gql-sdl-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/schema.ts'),
      `
        export const typeDefs = \`
          type Query {
            allUsers: [User!]!
            postById(id: Int): Post
          }

          type Mutation {
            createDraft(data: PostCreateInput!): Post
          }
        \`
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories).values({
      id: REPO,
      projectId: PROJECT,
      name: 'r',
      repoPath,
      framework: 'nestjs' as never,
    }).run()
    db.insert(codeNodes).values([
      {
        id: 'r1:src/schema.ts',
        repoId: REPO,
        type: 'file',
        filePath: 'src/schema.ts',
        name: 'src/schema.ts',
      },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      kind: entry.kind,
      fullPath: entry.fullPath,
      httpMethod: entry.httpMethod,
    })).sort((a, b) => a.fullPath!.localeCompare(b.fullPath!))).toEqual([
      { kind: 'api', fullPath: '/graphql#mutation.createDraft', httpMethod: 'MUTATION' },
      { kind: 'api', fullPath: '/graphql#query.allUsers', httpMethod: 'QUERY' },
      { kind: 'api', fullPath: '/graphql#query.postById', httpMethod: 'QUERY' },
    ])
  })
})

describe('runBuildRoute — NestJS WebSocket gateway source fallback', () => {
  it('extracts SubscribeMessage handlers as event entry points', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-nest-ws-gateway-'))
    mkdirSync(join(repoPath, 'src/events'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/events/events.gateway.ts'),
      `
        import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets'

        @WebSocketGateway(8080)
        export class EventsGateway {
          @SubscribeMessage('events')
          onEvent() {
            return null
          }
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories).values({
      id: REPO,
      projectId: PROJECT,
      name: 'r',
      repoPath,
      framework: 'nestjs' as never,
    }).run()
    db.insert(codeNodes).values([
      {
        id: 'r1:src/events/events.gateway.ts',
        repoId: REPO,
        type: 'file',
        filePath: 'src/events/events.gateway.ts',
        name: 'src/events/events.gateway.ts',
      },
      {
        id: 'r1:src/events/events.gateway.ts:EventsGateway.onEvent',
        repoId: REPO,
        type: 'method',
        filePath: 'src/events/events.gateway.ts',
        name: 'EventsGateway.onEvent',
      },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      kind: entry.kind,
      fullPath: entry.fullPath,
      httpMethod: entry.httpMethod,
    }))).toEqual([
      { kind: 'event', fullPath: 'websocket:8080#events', httpMethod: 'WS' },
    ])
  })
})

describe('runBuildRoute — NestJS microservice source fallback', () => {
  it('extracts MessagePattern and EventPattern handlers as event entry points', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-nest-microservice-'))
    mkdirSync(join(repoPath, 'src/math'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/math/math.controller.ts'),
      `
        import { Controller } from '@nestjs/common'
        import { EventPattern, MessagePattern } from '@nestjs/microservices'

        @Controller()
        export class MathController {
          @MessagePattern({ cmd: 'sum' })
          sum(data: number[]) {
            return data.reduce((a, b) => a + b)
          }

          @EventPattern('math.ready')
          ready() {
            return true
          }
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories).values({
      id: REPO,
      projectId: PROJECT,
      name: 'r',
      repoPath,
      framework: 'nestjs' as never,
    }).run()
    db.insert(codeNodes).values([
      {
        id: 'r1:src/math/math.controller.ts',
        repoId: REPO,
        type: 'file',
        filePath: 'src/math/math.controller.ts',
        name: 'src/math/math.controller.ts',
      },
      {
        id: 'r1:src/math/math.controller.ts:MathController.sum',
        repoId: REPO,
        type: 'method',
        filePath: 'src/math/math.controller.ts',
        name: 'MathController.sum',
      },
      {
        id: 'r1:src/math/math.controller.ts:MathController.ready',
        repoId: REPO,
        type: 'method',
        filePath: 'src/math/math.controller.ts',
        name: 'MathController.ready',
      },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      kind: entry.kind,
      fullPath: entry.fullPath,
      httpMethod: entry.httpMethod,
    })).sort((a, b) => a.fullPath!.localeCompare(b.fullPath!))).toEqual([
      { kind: 'event', fullPath: 'event:math.ready', httpMethod: 'EVENT' },
      { kind: 'event', fullPath: 'message:sum', httpMethod: 'MESSAGE' },
    ])
  })
})

describe('runBuildRoute — NestJS listener/job source fallback', () => {
  it('extracts event-emitter, CQRS, and BullMQ handlers as entry points', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-nest-listener-jobs-'))
    mkdirSync(join(repoPath, 'src/listeners'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/listeners/order.listener.ts'),
      `
        import { OnEvent } from '@nestjs/event-emitter'
        import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
        import { Processor, WorkerHost } from '@nestjs/bullmq'

        export class OrderCreatedEvent {}

        export class OrderListener {
          @OnEvent('order.created', { async: true })
          onOrderCreated() {
            return true
          }
        }

        @EventsHandler(OrderCreatedEvent)
        export class OrderCreatedHandler implements IEventHandler<OrderCreatedEvent> {
          handle(event: OrderCreatedEvent) {
            return event
          }
        }

        @Processor('audio')
        export class AudioWorker extends WorkerHost {
          async process(job: unknown) {
            return job
          }
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories).values({
      id: REPO,
      projectId: PROJECT,
      name: 'r',
      repoPath,
      framework: 'nestjs' as never,
    }).run()
    db.insert(codeNodes).values([
      {
        id: 'r1:src/listeners/order.listener.ts',
        repoId: REPO,
        type: 'file',
        filePath: 'src/listeners/order.listener.ts',
        name: 'src/listeners/order.listener.ts',
      },
      {
        id: 'r1:src/listeners/order.listener.ts:OrderListener.onOrderCreated',
        repoId: REPO,
        type: 'method',
        filePath: 'src/listeners/order.listener.ts',
        name: 'OrderListener.onOrderCreated',
      },
      {
        id: 'r1:src/listeners/order.listener.ts:OrderCreatedHandler.handle',
        repoId: REPO,
        type: 'method',
        filePath: 'src/listeners/order.listener.ts',
        name: 'OrderCreatedHandler.handle',
      },
      {
        id: 'r1:src/listeners/order.listener.ts:AudioWorker.process',
        repoId: REPO,
        type: 'method',
        filePath: 'src/listeners/order.listener.ts',
        name: 'AudioWorker.process',
      },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      kind: entry.kind,
      fullPath: entry.fullPath,
      httpMethod: entry.httpMethod,
    })).sort((a, b) => a.fullPath!.localeCompare(b.fullPath!))).toEqual([
      { kind: 'job', fullPath: 'audio/*', httpMethod: undefined },
      { kind: 'event', fullPath: 'event:OrderCreatedEvent', httpMethod: 'CQRS_EVENT' },
      { kind: 'event', fullPath: 'order.created', httpMethod: 'EVENT' },
    ])
  })

  it('extracts Bull @Process handlers with and without explicit job names', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-nest-bull-process-'))
    mkdirSync(join(repoPath, 'src/queues'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/queues/audio.processor.ts'),
      `
        import { Process, Processor } from '@nestjs/bull'

        @Processor('audio')
        export class AudioProcessor {
          @Process('transcode')
          transcode() {}

          @Process()
          catchAll() {}
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories).values({
      id: REPO,
      projectId: PROJECT,
      name: 'r',
      repoPath,
      framework: 'nestjs' as never,
    }).run()
    db.insert(codeNodes).values([
      {
        id: 'r1:src/queues/audio.processor.ts',
        repoId: REPO,
        type: 'file',
        filePath: 'src/queues/audio.processor.ts',
        name: 'src/queues/audio.processor.ts',
      },
      {
        id: 'r1:src/queues/audio.processor.ts:AudioProcessor.transcode',
        repoId: REPO,
        type: 'method',
        filePath: 'src/queues/audio.processor.ts',
        name: 'AudioProcessor.transcode',
      },
      {
        id: 'r1:src/queues/audio.processor.ts:AudioProcessor.catchAll',
        repoId: REPO,
        type: 'method',
        filePath: 'src/queues/audio.processor.ts',
        name: 'AudioProcessor.catchAll',
      },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      'audio/*',
      'audio/transcode',
    ])
  })
})

describe('runBuildRoute — NestJS gRPC source fallback', () => {
  it('extracts GrpcMethod and GrpcStreamMethod handlers as API entry points', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-nest-grpc-'))
    mkdirSync(join(repoPath, 'src/hero'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/hero/hero.controller.ts'),
      `
        import { Controller } from '@nestjs/common'
        import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices'

        @Controller('hero')
        export class HeroController {
          @GrpcMethod('HeroesService')
          findOne(data: unknown) {
            return data
          }

          @GrpcStreamMethod('HeroesService', 'FindMany')
          findMany(data: unknown) {
            return data
          }
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories).values({
      id: REPO,
      projectId: PROJECT,
      name: 'r',
      repoPath,
      framework: 'nestjs' as never,
    }).run()
    db.insert(codeNodes).values([
      {
        id: 'r1:src/hero/hero.controller.ts',
        repoId: REPO,
        type: 'file',
        filePath: 'src/hero/hero.controller.ts',
        name: 'src/hero/hero.controller.ts',
      },
      {
        id: 'r1:src/hero/hero.controller.ts:HeroController.findOne',
        repoId: REPO,
        type: 'method',
        filePath: 'src/hero/hero.controller.ts',
        name: 'HeroController.findOne',
      },
      {
        id: 'r1:src/hero/hero.controller.ts:HeroController.findMany',
        repoId: REPO,
        type: 'method',
        filePath: 'src/hero/hero.controller.ts',
        name: 'HeroController.findMany',
      },
    ]).run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      kind: entry.kind,
      fullPath: entry.fullPath,
      httpMethod: entry.httpMethod,
    })).sort((a, b) => a.fullPath!.localeCompare(b.fullPath!))).toEqual([
      { kind: 'api', fullPath: 'grpc:HeroesService/FindMany', httpMethod: 'GRPC_STREAM' },
      { kind: 'api', fullPath: 'grpc:HeroesService/findOne', httpMethod: 'GRPC' },
    ])
  })
})

describe('runBuildRoute — 에러 처리', () => {
  it('repository 없음 → throw', async () => {
    db = createTestDb()
    await expect(runBuildRoute({ db, repoId: 'nonexistent' })).rejects.toThrow()
  })

  it('repository.framework 없음 → throw STACK_INFO_MISSING', async () => {
    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories).values({
      id: REPO, projectId: PROJECT, name: 'r', repoPath: '.',
    }).run()
    await expect(runBuildRoute({ db, repoId: REPO })).rejects.toThrow(/STACK_INFO_MISSING/)
  })

  it("framework='other' → 빈 결과 (진입점 없음)", async () => {
    setupRepo('other')
    const result = await runBuildRoute({ db, repoId: REPO })
    expect(result.entryPoints).toEqual([])
  })
})

describe('runBuildRoute — React Router v6 source fallback', () => {
  it('extracts JSX index routes as the root path', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rr-jsx-index-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/App.tsx'),
      `
        import { Routes, Route } from 'react-router-dom'

        export default function App() {
          return (
            <Routes>
              <Route index element={<Home />} />
              <Route path="*" element={<NoMatch />} />
            </Routes>
          )
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'react' as never,
        routingLibs: ['react-router-dom@^6.15.0'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:src/App.tsx',
          repoId: REPO,
          type: 'file',
          filePath: 'src/App.tsx',
          name: 'src/App.tsx',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/*',
    ])
  })

  it('extracts React Router v5 Switch routes from JSX in .js files', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rr-v5-js-routes-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/App.js'),
      `
        import { Route, Switch } from 'react-router-dom'
        import HomePage from './pages/HomePage'
        import UserPage from './pages/UserPage'

        export default function App() {
          return (
            <Switch>
              <Route exact path="/" component={HomePage} />
              <Route path="/:id" component={UserPage} />
            </Switch>
          )
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'react' as never,
        routingLibs: ['react-router-dom@^5.0.1'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:src/App.js',
          repoId: REPO,
          type: 'file',
          filePath: 'src/App.js',
          name: 'src/App.js',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/:id',
    ])
  })

  it('composes nested JSX Route child paths under wildcard parents', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rr-jsx-nested-wildcard-'))
    mkdirSync(join(repoPath, 'src/router'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/router/App.js'),
      `
        import { BrowserRouter, Route, Routes } from 'react-router-dom'

        export default function App() {
          return (
            <BrowserRouter>
              <Routes>
                <Route path="/signIn" element={<SignIn />} />
                <Route element={<PrivateRoutes />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/dashboard/*" element={<Dashboard />}>
                    <Route path="welcome" element={<h3>Welcome</h3>} />
                  </Route>
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          )
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'react' as never,
        routingLibs: ['react-router-dom@^6.2.1'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:src/router/App.js',
          repoId: REPO,
          type: 'file',
          filePath: 'src/router/App.js',
          name: 'src/router/App.js',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/*',
      '/dashboard/*',
      '/dashboard/welcome',
      '/signIn',
    ])
  })

  it('resolves localized JSX Route enum paths from react-intl route messages', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rr-localized-routes-'))
    mkdirSync(join(repoPath, 'src/const'), { recursive: true })
    mkdirSync(join(repoPath, 'src/modules/i18n/localizations'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/App.tsx'),
      `
        import { BrowserRouter, Route, Switch } from 'react-router-dom'
        import { AppRoute } from './const/app-routes'

        export default function App() {
          return (
            <BrowserRouter>
              <Switch>
                <Route exact path={AppRoute.Home}><Home /></Route>
                <Route exact path={AppRoute.Summary}><Summary /></Route>
                <Route path="*"><GeneralError /></Route>
              </Switch>
            </BrowserRouter>
          )
        }
      `,
      'utf-8',
    )
    writeFileSync(
      join(repoPath, 'src/const/app-routes.ts'),
      `
        export enum AppRoute {
          Home = 'routes.home',
          Summary = 'routes.summary'
        }

        export enum AppLanguage {
          English = 'en',
          French = 'fr'
        }
      `,
      'utf-8',
    )
    writeFileSync(
      join(repoPath, 'src/modules/i18n/localizations/base-strings.ts'),
      `
        export const en = {
          'routes.home': '/',
          'routes.summary': '/summary',
        }
      `,
      'utf-8',
    )
    writeFileSync(
      join(repoPath, 'src/modules/i18n/localizations/fr.ts'),
      `
        export const fr = {
          'routes.home': '/',
          'routes.summary': '/sommaire',
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'react' as never,
        routingLibs: ['react-router-dom@^5.2.0'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:src/App.tsx',
          repoId: REPO,
          type: 'file',
          filePath: 'src/App.tsx',
          name: 'src/App.tsx',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/*',
      '/en',
      '/en/summary',
      '/fr',
      '/fr/sommaire',
    ])
  })

  it('extracts route object paths passed to useRoutes()', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rr-route-objects-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/App.tsx'),
      `
        import type { RouteObject } from 'react-router-dom'
        import { useRoutes } from 'react-router-dom'

        export default function App() {
          const routes: RouteObject[] = [
            {
              path: '/',
              children: [
                { index: true, element: <Home /> },
                {
                  path: '/courses',
                  children: [
                    { index: true, element: <CoursesIndex /> },
                    { path: '/courses/:id', element: <Course /> },
                  ],
                },
                { path: '*', element: <NoMatch /> },
              ],
            },
          ]
          return useRoutes(routes)
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'react' as never,
        routingLibs: ['react-router-dom@^6.15.0'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:src/App.tsx',
          repoId: REPO,
          type: 'file',
          filePath: 'src/App.tsx',
          name: 'src/App.tsx',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/*',
      '/courses',
      '/courses/:id',
    ])
  })

  it('extracts React Router RSC route config object arrays', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rr-rsc-routes-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(
      join(repoPath, 'src/routes.ts'),
      `
        import type { unstable_RSCRouteConfig as RSCRouteConfig } from 'react-router'

        export const routes = [
          {
            id: 'root',
            path: '',
            children: [
              { id: 'home', index: true },
              { id: 'about', path: 'about' },
              {
                id: 'parent',
                path: 'parent',
                children: [
                  { id: 'parent-index', index: true },
                  { id: 'child', path: 'child' },
                ],
              },
            ],
          },
        ] satisfies RSCRouteConfig
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'react' as never,
        routingLibs: ['react-router@^7'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:src/routes.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'src/routes.ts',
          name: 'src/routes.ts',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/about',
      '/parent',
      '/parent/child',
    ])
  })

  it('extracts @react-router/dev route config index() and route() entries', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rr-framework-routes-'))
    mkdirSync(join(repoPath, 'app/routes'), { recursive: true })
    writeFileSync(
      join(repoPath, 'app/routes.ts'),
      `
        import { type RouteConfig, index, route } from '@react-router/dev/routes'

        export default [
          index('routes/_index.tsx'),
          route('splittable', 'routes/splittable.tsx'),
          route('semi-splittable', 'routes/semi-splittable.tsx'),
        ] satisfies RouteConfig
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'react' as never,
        routingLibs: ['react-router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:app/routes.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'app/routes.ts',
          name: 'app/routes.ts',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/semi-splittable',
      '/splittable',
    ])
  })

  it('extracts @react-router/dev route config prefix() entries', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rr-framework-prefix-routes-'))
    mkdirSync(join(repoPath, 'app/routes/auth'), { recursive: true })
    mkdirSync(join(repoPath, 'app/routes/api'), { recursive: true })
    writeFileSync(
      join(repoPath, 'app/routes.ts'),
      `
        import { type RouteConfig, index, layout, prefix, route } from '@react-router/dev/routes'

        export default [
          layout('routes/layout.tsx', [
            index('routes/index.tsx'),
            route('account', 'routes/account.tsx'),
          ]),
          ...prefix('auth', [
            layout('routes/auth/layout.tsx', [
              route(':provider/callback', 'routes/auth/provider-callback.ts'),
              route('login', 'routes/auth/login.tsx'),
              route('verify', 'routes/auth/verify.tsx'),
            ]),
            route('logout', 'routes/auth/logout.ts'),
          ]),
          ...prefix('api', [route('color-scheme', 'routes/api/color-scheme.ts')]),
          route('*', 'routes/not-found.tsx'),
        ] satisfies RouteConfig
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'react' as never,
        routingLibs: ['react-router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:app/routes.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'app/routes.ts',
          name: 'app/routes.ts',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/*',
      '/account',
      '/api/color-scheme',
      '/auth/:provider/callback',
      '/auth/login',
      '/auth/logout',
      '/auth/verify',
    ])
  })

  it('extracts @react-router/dev route config entries emitted through local route helpers', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rr-framework-route-helper-'))
    mkdirSync(join(repoPath, 'app/routes'), { recursive: true })
    writeFileSync(
      join(repoPath, 'app/routes.ts'),
      `
        import { type RouteConfig, index, route } from '@react-router/dev/routes'

        const r = (path: string) => route(path, 'routes/route.tsx', { id: path })

        export default [
          index('routes/route.tsx'),
          r('about'),
          r('dashboard/:widgetId'),
        ] satisfies RouteConfig
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'react' as never,
        routingLibs: ['react-router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:app/routes.ts',
          repoId: REPO,
          type: 'file',
          filePath: 'app/routes.ts',
          name: 'app/routes.ts',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/about',
      '/dashboard/:widgetId',
    ])
  })

  it('extracts @react-router/dev route config when the config file is missing from the graph', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rr-framework-routes-no-config-node-'))
    mkdirSync(join(repoPath, 'app/routes'), { recursive: true })
    writeFileSync(
      join(repoPath, 'app/routes.ts'),
      `
        import { type RouteConfig, index } from '@react-router/dev/routes'

        export default [index('routes/home.tsx')] satisfies RouteConfig
      `,
      'utf-8',
    )
    writeFileSync(join(repoPath, 'app/routes/home.tsx'), 'export default function Home() { return null }\n', 'utf-8')

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'react' as never,
        routingLibs: ['react-router@7.12.0'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:app/routes/home.tsx',
          repoId: REPO,
          type: 'file',
          filePath: 'app/routes/home.tsx',
          name: 'app/routes/home.tsx',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      fullPath: entry.fullPath,
      handlerNodeId: entry.handlerNodeId,
    }))).toEqual([
      { fullPath: '/', handlerNodeId: 'r1:app/routes/home.tsx' },
    ])
  })

  it('extracts @react-router/fs-routes flatRoutes() file routes', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rr-flat-routes-'))
    mkdirSync(join(repoPath, 'app/routes'), { recursive: true })
    writeFileSync(
      join(repoPath, 'app/routes.ts'),
      `
        import type { RouteConfig } from '@react-router/dev/routes'
        import { flatRoutes } from '@react-router/fs-routes'

        export default flatRoutes() satisfies RouteConfig
      `,
      'utf-8',
    )
    for (const file of ['_index.tsx', 'client.a.tsx', 'client.a.b.tsx']) {
      writeFileSync(join(repoPath, 'app/routes', file), 'export default function Route() { return null }', 'utf-8')
    }

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'react' as never,
        routingLibs: ['react-router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        { id: 'r1:app/routes.ts', repoId: REPO, type: 'file', filePath: 'app/routes.ts', name: 'app/routes.ts' },
        { id: 'r1:app/routes/_index.tsx', repoId: REPO, type: 'file', filePath: 'app/routes/_index.tsx', name: 'app/routes/_index.tsx' },
        { id: 'r1:app/routes/client.a.tsx', repoId: REPO, type: 'file', filePath: 'app/routes/client.a.tsx', name: 'app/routes/client.a.tsx' },
        { id: 'r1:app/routes/client.a.b.tsx', repoId: REPO, type: 'file', filePath: 'app/routes/client.a.b.tsx', name: 'app/routes/client.a.b.tsx' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      path: entry.fullPath,
      handlerNodeId: entry.handlerNodeId,
    })).sort((a, b) => a.path!.localeCompare(b.path!))).toEqual([
      { path: '/', handlerNodeId: 'r1:app/routes/_index.tsx' },
      { path: '/client/a', handlerNodeId: 'r1:app/routes/client.a.tsx' },
      { path: '/client/a/b', handlerNodeId: 'r1:app/routes/client.a.b.tsx' },
    ])
  })

  it('extracts @react-router/fs-routes route folders without helper-file false positives', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rr-flat-route-folders-'))
    mkdirSync(join(repoPath, 'app/routes/_index'), { recursive: true })
    mkdirSync(join(repoPath, 'app/routes/client-loader'), { recursive: true })
    mkdirSync(join(repoPath, 'app/routes/mdx'), { recursive: true })
    mkdirSync(join(repoPath, 'app/routes/optimistic'), { recursive: true })
    writeFileSync(
      join(repoPath, 'app/routes.ts'),
      `
        import type { RouteConfig } from '@react-router/dev/routes'
        import { flatRoutes } from '@react-router/fs-routes'

        export default flatRoutes() satisfies RouteConfig
      `,
      'utf-8',
    )
    const routeFiles = [
      'app/routes/_index/route.tsx',
      'app/routes/client-loader/route.tsx',
      'app/routes/fixture.client-component/route.tsx',
      'app/routes/mdx-glob.$post/route.tsx',
      'app/routes/mdx-glob._index/route.tsx',
      'app/routes/mdx/route.mdx',
      'app/routes/optimistic/route.tsx',
      'app/routes/_layout-a.route-a.tsx',
    ]
    const helperFiles = [
      'app/routes/optimistic/actions.ts',
      'app/routes/optimistic/form.tsx',
      'app/routes/mdx-glob.$post/posts/posts.ts',
      'app/routes/mdx-glob.$post/posts/hello/hello-component.tsx',
      'app/routes/mdx-glob.$post/posts/hello/hello.mdx',
    ]
    for (const file of [...routeFiles, ...helperFiles]) {
      mkdirSync(join(repoPath, dirname(file)), { recursive: true })
      writeFileSync(join(repoPath, file), 'export default function Route() { return null }', 'utf-8')
    }

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'react' as never,
        routingLibs: ['react-router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        { id: 'r1:app/routes.ts', repoId: REPO, type: 'file', filePath: 'app/routes.ts', name: 'app/routes.ts' },
        ...[...routeFiles, ...helperFiles].map((file) => ({
          id: `r1:${file}`,
          repoId: REPO,
          type: 'file' as const,
          filePath: file,
          name: file,
        })),
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      path: entry.fullPath,
      handlerNodeId: entry.handlerNodeId,
    })).sort((a, b) => a.path!.localeCompare(b.path!))).toEqual([
      { path: '/', handlerNodeId: 'r1:app/routes/_index/route.tsx' },
      { path: '/client-loader', handlerNodeId: 'r1:app/routes/client-loader/route.tsx' },
      { path: '/fixture/client-component', handlerNodeId: 'r1:app/routes/fixture.client-component/route.tsx' },
      { path: '/mdx', handlerNodeId: 'r1:app/routes/mdx/route.mdx' },
      { path: '/mdx-glob', handlerNodeId: 'r1:app/routes/mdx-glob._index/route.tsx' },
      { path: '/mdx-glob/:post', handlerNodeId: 'r1:app/routes/mdx-glob.$post/route.tsx' },
      { path: '/optimistic', handlerNodeId: 'r1:app/routes/optimistic/route.tsx' },
      { path: '/route-a', handlerNodeId: 'r1:app/routes/_layout-a.route-a.tsx' },
    ])
  })
})

describe('runBuildRoute — Flutter GoRouter source fallback', () => {
  it('extracts Flutter bottom tab pages from semantic navigation files outside router files', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-bottom-tabs-'))
    mkdirSync(join(repoPath, 'lib/widgets/home'), { recursive: true })
    writeFileSync(join(repoPath, 'lib/widgets/home/home_shell.dart'), `
      import 'package:flutter/material.dart';

      class HomePage extends StatefulWidget {
        const HomePage({super.key});
      }

      class _HomePageState extends State<HomePage> with SingleTickerProviderStateMixin {
        late final TabController _controller;
        int currentIndex = 0;
        final List<Widget> bodys = [
          const CommunityPage(),
          const BoardPage(),
          const VerificationPage(),
          const SpecialSalePage(),
          const ProfilePage(),
        ];

        @override
        Widget build(BuildContext context) {
          return Scaffold(
            body: TabBarView(controller: _controller, children: bodys),
            bottomNavigationBar: BottomAppBar(child: Row(children: const [])),
          );
        }
      }

      class CommunityPage extends StatelessWidget { const CommunityPage({super.key}); }
      class BoardPage extends StatelessWidget { const BoardPage({super.key}); }
      class VerificationPage extends StatelessWidget { const VerificationPage({super.key}); }
      class SpecialSalePage extends StatelessWidget { const SpecialSalePage({super.key}); }
      class ProfilePage extends StatelessWidget { const ProfilePage({super.key}); }
    `)

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'flutter' as never,
        routingLibs: [],
      })
      .run()
    db.insert(codeNodes)
      .values([
        { id: 'r1:lib/widgets/home/home_shell.dart', repoId: REPO, type: 'file', filePath: 'lib/widgets/home/home_shell.dart', name: 'lib/widgets/home/home_shell.dart' },
        { id: 'r1:lib/widgets/home/home_shell.dart:HomePage', repoId: REPO, type: 'class', filePath: 'lib/widgets/home/home_shell.dart', name: 'HomePage' },
        { id: 'r1:lib/widgets/home/home_shell.dart:CommunityPage', repoId: REPO, type: 'class', filePath: 'lib/widgets/home/home_shell.dart', name: 'CommunityPage' },
        { id: 'r1:lib/widgets/home/home_shell.dart:BoardPage', repoId: REPO, type: 'class', filePath: 'lib/widgets/home/home_shell.dart', name: 'BoardPage' },
        { id: 'r1:lib/widgets/home/home_shell.dart:VerificationPage', repoId: REPO, type: 'class', filePath: 'lib/widgets/home/home_shell.dart', name: 'VerificationPage' },
        { id: 'r1:lib/widgets/home/home_shell.dart:SpecialSalePage', repoId: REPO, type: 'class', filePath: 'lib/widgets/home/home_shell.dart', name: 'SpecialSalePage' },
        { id: 'r1:lib/widgets/home/home_shell.dart:ProfilePage', repoId: REPO, type: 'class', filePath: 'lib/widgets/home/home_shell.dart', name: 'ProfilePage' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      'internal://home/board',
      'internal://home/community',
      'internal://home/profile',
      'internal://home/special-sale',
      'internal://home/verification',
    ])
    expect(result.entryPoints.every((entry) => entry.detectionSource === 'semantic:flutter')).toBe(true)
  })

  it('extracts data-driven Demo(route: ...) child routes passed as demo.route', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-demo-routes-'))
    mkdirSync(join(repoPath, 'lib/src'), { recursive: true })
    writeFileSync(
      join(repoPath, 'lib/src/pages.dart'),
      `
        class DetailsPage {
          static const String routeName = 'details'
        }
      `,
      'utf-8',
    )
    writeFileSync(
      join(repoPath, 'lib/main.dart'),
      `
        import 'package:go_router/go_router.dart';
        import 'src/pages.dart';

        class Demo {
          final String route;
          const Demo({required this.route});
        }

        final demos = [
          Demo(route: 'settings'),
          Demo(route: DetailsPage.routeName),
        ];

        final router = GoRouter(
          routes: [
            GoRoute(
              path: '/',
              routes: [
                for (final demo in demos)
                  GoRoute(path: demo.route),
              ],
            ),
          ],
        );
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'flutter' as never,
        routingLibs: ['go_router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:lib/main.dart',
          repoId: REPO,
          type: 'file',
          filePath: 'lib/main.dart',
          name: 'lib/main.dart',
        },
        {
          id: 'r1:lib/src/pages.dart',
          repoId: REPO,
          type: 'file',
          filePath: 'lib/src/pages.dart',
          name: 'lib/src/pages.dart',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/details',
      '/settings',
    ])
  })

  it('expands NavigationItem paths used by ShellRoute item.path loops', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-navigation-items-'))
    mkdirSync(join(repoPath, 'lib'), { recursive: true })
    writeFileSync(join(repoPath, 'lib/router.dart'), `
      import 'package:go_router/go_router.dart';

      final navigationItems = [
        NavigationItem(
          path: '/products',
          routes: [
            GoRoute(path: ':id'),
          ],
        ),
        NavigationItem(
          path: '/todos',
          routes: [
            GoRoute(path: 'add'),
            GoRoute(
              path: ':id',
              routes: [
                GoRoute(path: 'update'),
              ],
            ),
          ],
        ),
        NavigationItem(path: '/profile'),
      ];

      final router = GoRouter(
        routes: [
          GoRoute(path: '/'),
          GoRoute(path: '/login'),
          ShellRoute(
            routes: [
              for (final item in navigationItems)
                GoRoute(
                  path: item.path,
                  routes: item.routes,
                ),
            ],
          ),
        ],
      );
    `)

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'flutter' as never,
        routingLibs: ['go_router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        { id: 'r1:lib/router.dart', repoId: REPO, type: 'file', filePath: 'lib/router.dart', name: 'lib/router.dart' },
        { id: 'r1:test/router_test.dart', repoId: REPO, type: 'file', filePath: 'test/router_test.dart', name: 'test/router_test.dart' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/login',
      '/products',
      '/products/:id',
      '/profile',
      '/todos',
      '/todos/:id',
      '/todos/:id/update',
      '/todos/add',
    ])
  })

  it('resolves GoRoute path constants from route classes', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-route-constants-'))
    mkdirSync(join(repoPath, 'lib/routing'), { recursive: true })
    writeFileSync(
      join(repoPath, 'lib/routing/routes.dart'),
      `
        abstract final class Routes {
          static const home = '/';
          static const search = '/$searchRelative';
          static const searchRelative = 'search';
        }
      `,
      'utf-8',
    )
    writeFileSync(
      join(repoPath, 'lib/routing/router.dart'),
      `
        import 'package:go_router/go_router.dart';
        import 'routes.dart';

        final router = GoRouter(
          routes: [
            GoRoute(
              path: Routes.home,
              routes: [
                GoRoute(path: Routes.searchRelative),
              ],
            ),
            GoRoute(path: Routes.search),
          ],
        );
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'flutter' as never,
        routingLibs: ['go_router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:lib/routing/routes.dart',
          repoId: REPO,
          type: 'file',
          filePath: 'lib/routing/routes.dart',
          name: 'lib/routing/routes.dart',
        },
        {
          id: 'r1:lib/routing/router.dart',
          repoId: REPO,
          type: 'file',
          filePath: 'lib/routing/router.dart',
          name: 'lib/routing/router.dart',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/search',
    ])
  })

  it('resolves GoRoute lists in separate files and static getter path constants', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-route-getters-'))
    mkdirSync(join(repoPath, 'lib/config/routes'), { recursive: true })
    writeFileSync(
      join(repoPath, 'lib/config/routes/routes_location.dart'),
      `
        class RouteLocation {
          static String get home => '/home';
          static String get createTask => '/createTask';
        }
      `,
      'utf-8',
    )
    writeFileSync(
      join(repoPath, 'lib/config/routes/app_routes.dart'),
      `
        import 'package:go_router/go_router.dart';
        import 'routes_location.dart';

        final appRoutes = [
          GoRoute(path: RouteLocation.home),
          GoRoute(path: RouteLocation.createTask),
        ];
      `,
      'utf-8',
    )
    writeFileSync(
      join(repoPath, 'lib/config/routes/routes_provider.dart'),
      `
        import 'package:go_router/go_router.dart';
        import 'app_routes.dart';

        final router = GoRouter(routes: appRoutes);
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'flutter' as never,
        routingLibs: ['go_router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        { id: 'r1:lib/config/routes/routes_location.dart', repoId: REPO, type: 'file', filePath: 'lib/config/routes/routes_location.dart', name: 'lib/config/routes/routes_location.dart' },
        { id: 'r1:lib/config/routes/app_routes.dart', repoId: REPO, type: 'file', filePath: 'lib/config/routes/app_routes.dart', name: 'lib/config/routes/app_routes.dart' },
        { id: 'r1:lib/config/routes/routes_provider.dart', repoId: REPO, type: 'file', filePath: 'lib/config/routes/routes_provider.dart', name: 'lib/config/routes/routes_provider.dart' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/createTask',
      '/home',
    ])
  })

  it('extracts nested go_router_builder typed routes', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-typed-go-routes-'))
    mkdirSync(join(repoPath, 'lib/features/concepts'), { recursive: true })
    writeFileSync(
      join(repoPath, 'lib/features/concepts/concepts_route.dart'),
      `
        import 'package:go_router/go_router.dart';

        part 'concepts_route.g.dart';

        @TypedGoRoute<ConceptsRoute>(
          path: '/concepts',
          name: 'concepts',
          routes: [
            TypedGoRoute<ConceptRoute>(
              path: ':id',
              name: 'concept',
              routes: [
                TypedGoRoute<ChallengesRoute>(
                  path: 'challenges',
                  name: 'challenges',
                ),
              ],
            ),
          ],
        )
        class ConceptsRoute extends GoRouteData {}
      `,
      'utf-8',
    )
    writeFileSync(
      join(repoPath, 'lib/features/concepts/concepts_route.g.dart'),
      `
        part of 'concepts_route.dart';

        List<RouteBase> get $appRoutes => [
          $conceptsRoute,
        ];

        RouteBase get $conceptsRoute => GoRouteData.$route(
          path: '/concepts',
          name: 'concepts',
          routes: [
            GoRouteData.$route(
              path: ':id',
              name: 'concept',
              routes: [
                GoRouteData.$route(
                  path: 'challenges',
                  name: 'challenges',
                ),
              ],
            ),
          ],
        );
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'flutter' as never,
        routingLibs: ['go_router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        { id: 'r1:lib/features/concepts/concepts_route.dart', repoId: REPO, type: 'file', filePath: 'lib/features/concepts/concepts_route.dart', name: 'lib/features/concepts/concepts_route.dart' },
        { id: 'r1:lib/features/concepts/concepts_route.g.dart', repoId: REPO, type: 'file', filePath: 'lib/features/concepts/concepts_route.g.dart', name: 'lib/features/concepts/concepts_route.g.dart' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/concepts',
      '/concepts/:id',
      '/concepts/:id/challenges',
    ])
  })

  it('resolves unqualified static path constants inside GoRouter helper classes', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-unqualified-static-paths-'))
    mkdirSync(join(repoPath, 'lib'), { recursive: true })
    writeFileSync(
      join(repoPath, 'lib/custom_navigation_helper.dart'),
      `
        import 'package:go_router/go_router.dart';

        class CustomNavigationHelper {
          static const String homePath = '/home';
          static const String searchPath = '/search';
          static const String detailPath = '/detail';

          CustomNavigationHelper._internal() {
            final routes = [
              StatefulShellRoute.indexedStack(
                branches: [
                  StatefulShellBranch(routes: [GoRoute(path: homePath)]),
                  StatefulShellBranch(routes: [GoRoute(path: searchPath)]),
                ],
              ),
              GoRoute(path: detailPath),
            ];

            GoRouter(routes: routes);
          }
        }
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'flutter' as never,
        routingLibs: ['go_router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        { id: 'r1:lib/custom_navigation_helper.dart', repoId: REPO, type: 'file', filePath: 'lib/custom_navigation_helper.dart', name: 'lib/custom_navigation_helper.dart' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/detail',
      '/home',
      '/search',
    ])
  })

  it('resolves GoRoute paths from generated route class constructor super values', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-generated-route-classes-'))
    mkdirSync(join(repoPath, 'lib'), { recursive: true })
    writeFileSync(
      join(repoPath, 'lib/routes.g.dart'),
      `
        class RootRoute extends SimpleRoute {
          const RootRoute() : super('/');
        }

        class DashboardRoute extends SimpleRoute {
          const DashboardRoute() : super('dashboard');
        }

        class ProfileRoute extends SimpleDataRoute<ProfileRouteData> {
          const ProfileRoute() : super('profile/:userId');
        }

        class ProfileEditRoute extends SimpleDataRoute<ProfileEditRouteData> {
          const ProfileEditRoute() : super('edit');
        }
      `,
      'utf-8',
    )
    writeFileSync(
      join(repoPath, 'lib/main.dart'),
      `
        import 'package:go_router/go_router.dart';
        import 'routes.g.dart';

        final router = GoRouter(
          routes: [
            GoRoute(
              path: const RootRoute().path,
              routes: [
                GoRoute(path: const DashboardRoute().path),
              ],
            ),
            GoRoute(
              path: const ProfileRoute().path,
              routes: [
                GoRoute(path: const ProfileEditRoute().path),
              ],
            ),
          ],
        );
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'flutter' as never,
        routingLibs: ['go_router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        { id: 'r1:lib/main.dart', repoId: REPO, type: 'file', filePath: 'lib/main.dart', name: 'lib/main.dart' },
        { id: 'r1:lib/routes.g.dart', repoId: REPO, type: 'file', filePath: 'lib/routes.g.dart', name: 'lib/routes.g.dart' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/dashboard',
      '/profile/:userId',
      '/profile/:userId/edit',
    ])
  })

  it('resolves GoRoute paths from Dart enum constructor path values', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-enum-route-paths-'))
    mkdirSync(join(repoPath, 'lib/core/navigation'), { recursive: true })
    writeFileSync(
      join(repoPath, 'lib/core/navigation/route.dart'),
      `
        enum AppRoute {
          splash('/', requiresAuth: false),
          home('/home', requiresAuth: true),
          settings('/settings', requiresAuth: true),
          auth('/auth');

          const AppRoute(this.path, {this.requiresAuth = false});

          final String path;
          final bool requiresAuth;
        }
      `,
      'utf-8',
    )
    writeFileSync(
      join(repoPath, 'lib/core/navigation/router.dart'),
      `
        import 'package:go_router/go_router.dart';
        import 'route.dart';

        final router = GoRouter(
          routes: [
            GoRoute(path: AppRoute.splash.path),
            GoRoute(path: AppRoute.home.path),
            GoRoute(path: AppRoute.settings.path),
            GoRoute(path: AppRoute.auth.path),
          ],
        );
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'flutter' as never,
        routingLibs: ['go_router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:lib/core/navigation/router.dart',
          repoId: REPO,
          type: 'file',
          filePath: 'lib/core/navigation/router.dart',
          name: 'lib/core/navigation/router.dart',
        },
        {
          id: 'r1:lib/core/navigation/route.dart',
          repoId: REPO,
          type: 'file',
          filePath: 'lib/core/navigation/route.dart',
          name: 'lib/core/navigation/route.dart',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/auth',
      '/home',
      '/settings',
    ])
  })

  it('resolves GoRoute paths from go_router_paths object chains', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-go-router-path-objects-'))
    mkdirSync(join(repoPath, 'lib'), { recursive: true })
    writeFileSync(
      join(repoPath, 'lib/main.dart'),
      `
        import 'package:go_router/go_router.dart';

        class AppPaths {
          static Path get home => Path('home');
          static WelcomePath get welcome => WelcomePath();
          static UsersPath get users => UsersPath();
          static Param<Param> get books => Param('books', 'bookId');
        }

        class WelcomePath extends Path<WelcomePath> {
          WelcomePath() : super('welcome');

          Path get login => Path('login', parent: this);
        }

        class UsersPath extends Path<UsersPath> {
          UsersPath() : super('users');

          UserPath get user => UserPath(this);
        }

        class UserPath extends Param<UserPath> {
          UserPath(UsersPath usersPath) : super.only('userId', parent: usersPath);

          Path get edit => Path('edit', parent: this);
        }

        final router = GoRouter(
          routes: [
            GoRoute(path: AppPaths.home.goRoute),
            GoRoute(
              path: AppPaths.welcome.goRoute,
              routes: [
                GoRoute(path: AppPaths.welcome.login.goRoute),
              ],
            ),
            GoRoute(
              path: AppPaths.users.goRoute,
              routes: [
                GoRoute(
                  path: AppPaths.users.user.goRoute,
                  routes: [
                    GoRoute(path: AppPaths.users.user.edit.goRoute),
                  ],
                ),
              ],
            ),
            GoRoute(path: AppPaths.books.goRoute),
          ],
        );
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'flutter' as never,
        routingLibs: ['go_router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        { id: 'r1:lib/main.dart', repoId: REPO, type: 'file', filePath: 'lib/main.dart', name: 'lib/main.dart' },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/books/:bookId',
      '/home',
      '/users',
      '/users/:userId',
      '/users/:userId/edit',
      '/welcome',
      '/welcome/login',
    ])
  })

  it('ignores Dart comments while extracting GoRoute path arguments', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-commented-routes-'))
    mkdirSync(join(repoPath, 'lib'), { recursive: true })
    writeFileSync(
      join(repoPath, 'lib/main.dart'),
      `
        import 'package:go_router/go_router.dart';

        final router = GoRouter(
          routes: [
            GoRoute(
              // if there's no name, path will be used as name for observers
              path: '/',
              routes: [
                GoRoute(path: 'page2/:p1'),
              ],
            ),
          ],
        );
      `,
      'utf-8',
    )

    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'flutter' as never,
        routingLibs: ['go_router'],
      })
      .run()
    db.insert(codeNodes)
      .values([
        {
          id: 'r1:lib/main.dart',
          repoId: REPO,
          type: 'file',
          filePath: 'lib/main.dart',
          name: 'lib/main.dart',
        },
      ])
      .run()

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/page2/:p1',
    ])
  })
})

describe('runBuildRoute — Flutter additional router source fallback', () => {
  function setupFlutterRepo(repoPath: string, routingLibs: string[], nodes: Array<{
    id: string
    type: 'file' | 'class'
    filePath: string
    name: string
  }>): void {
    db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories)
      .values({
        id: REPO,
        projectId: PROJECT,
        name: 'r',
        repoPath,
        framework: 'flutter' as never,
        routingLibs,
      })
      .run()
    db.insert(codeNodes)
      .values(nodes.map((node) => ({ ...node, repoId: REPO })))
      .run()
  }

  it('extracts Navigator onGenerateRoute switch routes across page files', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-navigator-switch-'))
    mkdirSync(join(repoPath, 'lib/pages'), { recursive: true })
    writeFileSync(join(repoPath, 'lib/main.dart'), `
      import 'package:flutter/material.dart';

      class App extends StatelessWidget {
        const App({super.key});
        @override
        Widget build(BuildContext context) {
          return MaterialApp(
            onGenerateRoute: (settings) {
              switch (settings.name) {
                case '/':
                  return MaterialPageRoute(builder: (_) => const HomePage());
                case '/orders':
                  return MaterialPageRoute(builder: (_) => const OrdersPage());
              }
              return null;
            },
          );
        }
      }
    `)

    setupFlutterRepo(repoPath, [], [
      { id: 'r1:lib/main.dart', type: 'file', filePath: 'lib/main.dart', name: 'lib/main.dart' },
      { id: 'r1:lib/pages/home_page.dart:HomePage', type: 'class', filePath: 'lib/pages/home_page.dart', name: 'HomePage' },
      { id: 'r1:lib/pages/orders_page.dart:OrdersPage', type: 'class', filePath: 'lib/pages/orders_page.dart', name: 'OrdersPage' },
    ])

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      path: entry.fullPath,
      handler: entry.handlerNodeId,
    })).sort((a, b) => a.path!.localeCompare(b.path!))).toEqual([
      { path: '/', handler: 'r1:lib/pages/home_page.dart:HomePage' },
      { path: '/orders', handler: 'r1:lib/pages/orders_page.dart:OrdersPage' },
    ])
  })

  it('extracts external Navigator onGenerateRoute references without LLM fallback', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-external-router-'))
    mkdirSync(join(repoPath, 'lib/pages'), { recursive: true })
    writeFileSync(join(repoPath, 'lib/app.dart'), `
      import 'package:flutter/material.dart';
      import 'pages/app_router.dart';

      class App extends StatelessWidget {
        const App({super.key});
        @override
        Widget build(BuildContext context) {
          return MaterialApp(
            initialRoute: AppRoutes.home,
            onGenerateRoute: AppRouter.onGenerateRoute,
          );
        }
      }
    `)
    writeFileSync(join(repoPath, 'lib/pages/app_router.dart'), `
      import 'package:flutter/material.dart';

      class AppRoutes {
        static const home = '/';
        static const orders = '/orders';
        static const fullscreen = '/fullscreen';
      }

      class AppRouter {
        static Route<dynamic>? onGenerateRoute(RouteSettings settings) {
          switch (settings.name) {
            case AppRoutes.home:
              return MaterialPageRoute(builder: (_) => const HomePage());
            case AppRoutes.orders:
              return PageRouteBuilder(
                settings: settings,
                transitionsBuilder: (_, animation, __, child) =>
                  FadeTransition(opacity: animation, child: child),
                pageBuilder: (_, __, ___) => const OrdersPage(),
              );
            case AppRoutes.fullscreen:
              return PageRouteBuilder(
                settings: settings,
                pageBuilder: (_, __, ___) {
                  return FullscreenPage();
                },
              );
            default:
              return null;
          }
        }
      }
    `)

    setupFlutterRepo(repoPath, [], [
      { id: 'r1:lib/app.dart', type: 'file', filePath: 'lib/app.dart', name: 'lib/app.dart' },
      { id: 'r1:lib/pages/app_router.dart', type: 'file', filePath: 'lib/pages/app_router.dart', name: 'lib/pages/app_router.dart' },
      { id: 'r1:lib/pages/home_page.dart:HomePage', type: 'class', filePath: 'lib/pages/home_page.dart', name: 'HomePage' },
      { id: 'r1:lib/pages/orders_page.dart:OrdersPage', type: 'class', filePath: 'lib/pages/orders_page.dart', name: 'OrdersPage' },
      { id: 'r1:lib/pages/fullscreen_page.dart:FullscreenPage', type: 'class', filePath: 'lib/pages/fullscreen_page.dart', name: 'FullscreenPage' },
    ])

    // PURE STATIC — onGenerateRoute is resolved by the static analyzer, no LLM fallback.
    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      path: entry.fullPath,
      handler: entry.handlerNodeId,
    })).sort((a, b) => a.path!.localeCompare(b.path!))).toEqual([
      { path: '/', handler: 'r1:lib/pages/home_page.dart:HomePage' },
      { path: '/fullscreen', handler: 'r1:lib/pages/fullscreen_page.dart:FullscreenPage' },
      { path: '/orders', handler: 'r1:lib/pages/orders_page.dart:OrdersPage' },
    ])
  })

  it('extracts GetX GetPage routes including nested children', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-getx-'))
    mkdirSync(join(repoPath, 'lib'), { recursive: true })
    writeFileSync(join(repoPath, 'lib/main.dart'), `
      import 'package:get/get.dart';

      final pages = [
        GetPage(
          name: '/dashboard',
          page: () => const DashboardPage(),
          children: [
            GetPage(name: 'users', page: () => const DashboardUsersPage()),
          ],
        ),
      ];
    `)

    setupFlutterRepo(repoPath, ['get'], [
      { id: 'r1:lib/main.dart', type: 'file', filePath: 'lib/main.dart', name: 'lib/main.dart' },
      { id: 'r1:lib/main.dart:DashboardPage', type: 'class', filePath: 'lib/main.dart', name: 'DashboardPage' },
      { id: 'r1:lib/main.dart:DashboardUsersPage', type: 'class', filePath: 'lib/main.dart', name: 'DashboardUsersPage' },
    ])

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/dashboard',
      '/dashboard/users',
    ])
  })

  it('extracts auto_route nested AutoRoute paths and page handlers', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-auto-route-'))
    mkdirSync(join(repoPath, 'lib'), { recursive: true })
    writeFileSync(join(repoPath, 'lib/router.dart'), `
      import 'package:auto_route/auto_route.dart';

      final routes = [
        AutoRoute(path: '/', page: HomeRoute.page),
        AutoRoute(
          path: '/books',
          page: BooksRoute.page,
          children: [
            AutoRoute(path: ':bookId', page: BookDetailRoute.page),
          ],
        ),
      ];
    `)

    setupFlutterRepo(repoPath, ['auto_route'], [
      { id: 'r1:lib/router.dart', type: 'file', filePath: 'lib/router.dart', name: 'lib/router.dart' },
      { id: 'r1:lib/pages/home_page.dart:HomePage', type: 'class', filePath: 'lib/pages/home_page.dart', name: 'HomePage' },
      { id: 'r1:lib/pages/books_page.dart:BooksPage', type: 'class', filePath: 'lib/pages/books_page.dart', name: 'BooksPage' },
      { id: 'r1:lib/pages/book_detail_page.dart:BookDetailPage', type: 'class', filePath: 'lib/pages/book_detail_page.dart', name: 'BookDetailPage' },
    ])

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => ({
      path: entry.fullPath,
      handler: entry.handlerNodeId,
    })).sort((a, b) => a.path!.localeCompare(b.path!))).toEqual([
      { path: '/', handler: 'r1:lib/pages/home_page.dart:HomePage' },
      { path: '/books', handler: 'r1:lib/pages/books_page.dart:BooksPage' },
      { path: '/books/:bookId', handler: 'r1:lib/pages/book_detail_page.dart:BookDetailPage' },
    ])
  })

  it('extracts Beamer pathPatterns getter routes', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-flutter-beamer-'))
    mkdirSync(join(repoPath, 'lib'), { recursive: true })
    writeFileSync(join(repoPath, 'lib/router.dart'), `
      import 'package:beamer/beamer.dart';

      class BooksLocation extends BeamLocation<BeamState> {
        @override
        List<String> get pathPatterns => ['/', '/books', '/books/:bookId'];
      }
    `)

    setupFlutterRepo(repoPath, ['beamer'], [
      { id: 'r1:lib/router.dart', type: 'file', filePath: 'lib/router.dart', name: 'lib/router.dart' },
    ])

    const result = await runBuildRoute({ db, repoId: REPO })

    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/books',
      '/books/:bookId',
    ])
  })
})
