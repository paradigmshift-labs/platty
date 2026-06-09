import { describe, expect, it } from 'vitest'
import type { CodeNode } from '@/db/schema/code_graph.js'
import { composeEntryPoints } from '@/pipeline_modules/build_route/f6_compose_entry_points.js'
import type { EntryPointDraft, StackInfoForBuildRoute } from '@/pipeline_modules/build_route/types.js'

const REPO = 'r1'

function node(id: string, type: CodeNode['type']): CodeNode {
  return {
    id,
    repoId: REPO,
    type,
    filePath: `${id}.ts`,
    name: id.split(':').pop() ?? id,
    lineStart: null,
    lineEnd: null,
    signature: null,
    exported: false,
    isDefaultExport: false,
    isAsync: false,
    isTest: false,
    testType: null,
    docComment: null,
    parseStatus: 'ok',
    createdAt: '2026-05-13',
  }
}

function stackInfo(partial: Partial<StackInfoForBuildRoute> = {}): StackInfoForBuildRoute {
  return {
    framework: 'express',
    routingLibs: [],
    ...partial,
  }
}

function entry(partial: Partial<EntryPointDraft> = {}): EntryPointDraft {
  return {
    framework: 'express',
    kind: 'api',
    httpMethod: 'GET',
    path: '/orders',
    fullPath: '/orders',
    handlerNodeId: 'handler',
    metadata: {},
    detectionSource: 'rule:express',
    confidence: 'high',
    detectionEvidence: {
      matchedRuleId: 'test',
      matchedNodeIds: ['handler'],
      matchedEdgeIds: [],
    },
    ...partial,
  }
}

// 기본 prefix 적용 대상 — REST 어댑터들 (nestjs, express)이 supportsGlobalPrefix=true
const DEFAULT_PREFIX_FRAMEWORKS = new Set(['nestjs', 'express'])

describe('composeEntryPoints', () => {
  it('merges rule/source/llm entries and applies a single API base path', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('handler', 'function'), node('llm', 'function')],
      stackInfo: stackInfo({ apiBasePaths: ['/api'] }),
      ruleEntries: [entry({ handlerNodeId: 'handler', fullPath: '/orders' })],
      sourceFallbackEntries: [],
      llmEntries: [entry({ handlerNodeId: 'llm', fullPath: '/webhooks', detectionSource: 'llm:fallback' })],
      globalPrefixFrameworks: DEFAULT_PREFIX_FRAMEWORKS,
    })

    expect(result.entryPoints.map((item) => item.fullPath)).toEqual(['/api/orders', '/api/webhooks'])
    expect(result.diagnostics).toMatchObject({
      ruleEntries: 1,
      sourceFallbackEntries: 0,
      llmEntries: 1,
      finalEntries: 2,
      semanticEntries: 0,
    })
  })

  it('prefers function handlers over file fallback entries for the same route', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('file', 'file'), node('handler', 'function')],
      stackInfo: stackInfo(),
      ruleEntries: [entry({ handlerNodeId: 'file', detectionSource: 'rule:nextjs' })],
      sourceFallbackEntries: [
        entry({
          handlerNodeId: 'handler',
          detectionSource: 'source:nextjs',
          metadata: { sourceFallback: 'next_app_route_named_export' },
        }),
      ],
      llmEntries: [],
    })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0].handlerNodeId).toBe('handler')
  })

  it('lets source GoRouter entries replace rule GoRouter entries', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('rule', 'file'), node('source', 'file')],
      stackInfo: stackInfo({ framework: 'flutter' as never }),
      ruleEntries: [
        entry({
          framework: 'flutter_gorouter',
          kind: 'page',
          httpMethod: undefined,
          fullPath: '/old',
          handlerNodeId: 'rule',
        }),
      ],
      sourceFallbackEntries: [
        entry({
          framework: 'flutter_gorouter',
          kind: 'page',
          httpMethod: undefined,
          fullPath: '/new',
          handlerNodeId: 'source',
          detectionSource: 'source:flutter_gorouter',
          metadata: { mergePolicy: 'supersede_framework' },
        }),
      ],
      llmEntries: [],
    })

    expect(result.entryPoints.map((item) => item.fullPath)).toEqual(['/new'])
  })

  it('keeps only exact Express rule matches when variable mount source fallback owns a handler', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('router-file', 'file')],
      stackInfo: stackInfo(),
      ruleEntries: [
        entry({ handlerNodeId: 'router-file', fullPath: '/local' }),
        entry({ handlerNodeId: 'other', fullPath: '/other' }),
      ],
      sourceFallbackEntries: [
        entry({
          handlerNodeId: 'router-file',
          fullPath: '/api/local',
          metadata: { sourceFallback: 'express_variable_mount', mergePolicy: 'supersede_handler' },
          detectionSource: 'source:express',
        }),
      ],
      llmEntries: [],
    })

    expect(result.entryPoints.map((item) => item.fullPath)).toEqual(['/other', '/api/local'])
  })

  it('R2: 어떤 framework든 같은 framework+kind=job+handler인 source/rule 중복은 dedup (source 우선)', () => {
    // 시나리오: 가상의 'koa' framework에서 schedule job — rule이 raw decorator로 emit,
    // source가 alias-resolved version으로 emit. 같은 handler에서 source가 우선되어야 함.
    // (NestJS 하드코딩 제거 검증 — koa는 코어에 등록되어 있지 않음)
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('h1', 'method')],
      stackInfo: stackInfo(),
      ruleEntries: [
        entry({
          framework: 'koa' as never,
          kind: 'job',
          httpMethod: undefined,
          handlerNodeId: 'h1',
          path: '/raw',
          fullPath: '/raw',
          detectionSource: 'rule:koa',
        }),
      ],
      sourceFallbackEntries: [
        entry({
          framework: 'koa' as never,
          kind: 'job',
          httpMethod: undefined,
          handlerNodeId: 'h1',
          path: '/resolved',
          fullPath: '/resolved',
          detectionSource: 'source:koa_schedule',
        }),
      ],
      llmEntries: [],
    })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0].path).toBe('/resolved')
    expect(result.entryPoints[0].detectionSource).toBe('source:koa_schedule')
  })

  it('R1: source entry with mergePolicy=supersede_framework removes rule entries of same framework', () => {
    // 시나리오: 임의의 framework 'foobar'에 대해 source adapter가 mergePolicy: 'supersede_framework' 선언 →
    // rule엔진의 foobar entry는 모두 제거되고 source entry만 남음.
    // (기존 하드코딩된 'source:flutter_gorouter' 분기를 어댑터 메타로 추상화)
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('rule-h', 'function'), node('source-h', 'function')],
      stackInfo: stackInfo({ framework: 'foobar' as never }),
      ruleEntries: [
        entry({ framework: 'foobar' as never, fullPath: '/rule-path', handlerNodeId: 'rule-h' }),
      ],
      sourceFallbackEntries: [
        entry({
          framework: 'foobar' as never,
          fullPath: '/source-path',
          handlerNodeId: 'source-h',
          detectionSource: 'source:foobar',
          metadata: { mergePolicy: 'supersede_framework' },
        }),
      ],
      llmEntries: [],
    })

    const paths = result.entryPoints.map((e) => e.fullPath).sort()
    expect(paths).toEqual(['/source-path'])
  })

  it('R1: source entry with mergePolicy=supersede_handler removes rule entries with same handler+key', () => {
    // 시나리오: variable_mount 류 패턴 — source가 더 정확한 path를 알 때 rule의 부정확한 entry를 제거.
    // 어댑터 메타 'supersede_handler'로 일반화.
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('h1', 'function')],
      stackInfo: stackInfo(),
      ruleEntries: [
        entry({ framework: 'foobar' as never, fullPath: '/rule-path', handlerNodeId: 'h1' }),
      ],
      sourceFallbackEntries: [
        entry({
          framework: 'foobar' as never,
          fullPath: '/source-path',
          handlerNodeId: 'h1',
          detectionSource: 'source:foobar',
          metadata: { mergePolicy: 'supersede_handler' },
        }),
      ],
      llmEntries: [],
    })

    const paths = result.entryPoints.map((e) => e.fullPath).sort()
    expect(paths).toEqual(['/source-path'])
  })

  it('R1: source entry with mergePolicy=additive (default) keeps rule entries intact', () => {
    // 시나리오: 대부분의 source adapter는 additive — rule 결과를 보강만 함.
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('rule-h', 'function'), node('source-h', 'function')],
      stackInfo: stackInfo(),
      ruleEntries: [
        entry({ framework: 'foobar' as never, fullPath: '/rule-path', handlerNodeId: 'rule-h' }),
      ],
      sourceFallbackEntries: [
        entry({
          framework: 'foobar' as never,
          fullPath: '/source-path',
          handlerNodeId: 'source-h',
          detectionSource: 'source:foobar',
          metadata: { mergePolicy: 'additive' },
        }),
      ],
      llmEntries: [],
    })

    const paths = result.entryPoints.map((e) => e.fullPath).sort()
    expect(paths).toEqual(['/rule-path', '/source-path'])
  })

  it('R3: applyApiBasePaths uses adapter.supportsGlobalPrefix instead of framework whitelist', () => {
    // 시나리오: fastify는 화이트리스트(nestjs, express)에 없지만 adapter가
    // supportsGlobalPrefix=true 선언했으므로 prefix 적용되어야 함
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('h1', 'function')],
      stackInfo: stackInfo({ apiBasePaths: ['/api'] }),
      ruleEntries: [
        entry({ framework: 'fastify' as never, handlerNodeId: 'h1', fullPath: '/orders' }),
      ],
      sourceFallbackEntries: [],
      llmEntries: [],
      globalPrefixFrameworks: new Set(['fastify']),
    })

    expect(result.entryPoints[0].fullPath).toBe('/api/orders')
  })

  it('R3: framework가 globalPrefixFrameworks에 없으면 prefix 적용 안 함', () => {
    // koa: 어댑터에 supportsGlobalPrefix 선언 없음 → globalPrefixFrameworks에 미포함
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('h1', 'function')],
      stackInfo: stackInfo({ apiBasePaths: ['/api'] }),
      ruleEntries: [
        entry({ framework: 'koa' as never, handlerNodeId: 'h1', fullPath: '/orders' }),
      ],
      sourceFallbackEntries: [],
      llmEntries: [],
      globalPrefixFrameworks: new Set(['nestjs', 'express']),
    })

    expect(result.entryPoints[0].fullPath).toBe('/orders')  // prefix 미적용
  })

  it('B2: apiBasePaths length > 1 records ambiguous diagnostic and leaves entries unchanged', () => {
    // 시나리오: 모노레포/URI versioning 등에서 apiBasePaths가 2개 이상이면 silent skip되던 동작
    // → diagnostics에 api_base_paths_ambiguous=1 기록 (behavior는 그대로, visibility만 추가)
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('h1', 'function')],
      stackInfo: stackInfo({ apiBasePaths: ['/api', '/api/v2'] }),
      ruleEntries: [entry({ handlerNodeId: 'h1', fullPath: '/orders' })],
      sourceFallbackEntries: [],
      llmEntries: [],
    })

    // entry fullPath는 변경 없음
    expect(result.entryPoints[0].fullPath).toBe('/orders')
    // 경고 카운터 기록됨
    expect(result.diagnostics.api_base_paths_ambiguous).toBe(1)
  })

  it('B2: apiBasePaths length === 1 does not record ambiguous diagnostic', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('h1', 'function')],
      stackInfo: stackInfo({ apiBasePaths: ['/api'] }),
      ruleEntries: [entry({ handlerNodeId: 'h1', fullPath: '/orders' })],
      sourceFallbackEntries: [],
      llmEntries: [],
      globalPrefixFrameworks: DEFAULT_PREFIX_FRAMEWORKS,
    })

    expect(result.entryPoints[0].fullPath).toBe('/api/orders')
    expect(result.diagnostics.api_base_paths_ambiguous).toBeUndefined()
  })

  it('B4: entryKey uses path fallback when fullPath is undefined (no silent collision)', () => {
    // 시나리오: fullPath가 undefined인 entry들의 key가 path로 fallback되어
    // 서로 다른 path가 동일 key로 collapse되는 silent collision을 방지.
    //
    // - source: handler='h1', path='/orders' (fullPath 미설정, supersede_handler)
    // - rule A: handler='h1', path='/orders' (source와 일치 → 유지)
    // - rule B: handler='h1', path='/users' (다른 path → 필터 out)
    //
    // B4 fix 전: 둘 다 'express:api:GET:undefined' key → rule B도 유지(BUG)
    // B4 fix 후: rule A='express:api:GET:/orders', rule B='express:api:GET:/users' → rule B 필터 out
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('h1', 'function')],
      stackInfo: stackInfo(),
      ruleEntries: [
        entry({ handlerNodeId: 'h1', path: '/orders', fullPath: undefined }),
        entry({ handlerNodeId: 'h1', path: '/users', fullPath: undefined }),
      ],
      sourceFallbackEntries: [
        entry({
          handlerNodeId: 'h1',
          path: '/orders',
          fullPath: undefined,
          metadata: { sourceFallback: 'express_variable_mount', mergePolicy: 'supersede_handler' },
          detectionSource: 'source:express',
        }),
      ],
      llmEntries: [],
    })

    // rule B (/users)는 필터 out, rule A (/orders)와 source (/orders) 둘 중 dedup으로 1개만 유지
    const paths = result.entryPoints.map((e) => e.path).sort()
    expect(paths).not.toContain('/users')
    expect(paths).toContain('/orders')
  })

  it('keeps non-Express rules when Express variable mount filtering is active', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('router-file', 'file'), node('page-file', 'file')],
      stackInfo: stackInfo(),
      ruleEntries: [
        entry({ framework: 'react_router_v6', kind: 'page', httpMethod: undefined, handlerNodeId: 'page-file', fullPath: '/page' }),
        entry({ framework: 'express', handlerNodeId: 'router-file', fullPath: '/local' }),
      ],
      sourceFallbackEntries: [
        entry({
          handlerNodeId: 'router-file',
          fullPath: '/api/local',
          metadata: { sourceFallback: 'express_variable_mount', mergePolicy: 'supersede_handler' },
          detectionSource: 'source:express',
        }),
      ],
      llmEntries: [],
    })

    expect(result.entryPoints.map((item) => item.fullPath)).toEqual(['/page', '/api/local'])
  })

  it('merges metadata evidence when multiple adapters find the same route identity', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('handler', 'function')],
      stackInfo: stackInfo({ framework: 'nestjs' as never }),
      ruleEntries: [],
      sourceFallbackEntries: [
        entry({
          framework: 'nestjs',
          fullPath: '/orders',
          handlerNodeId: 'handler',
          detectionSource: 'source:nestjs_controller',
          metadata: { evidence: [{ adapterId: 'nestjs_controller' }], fileFallbackPathOverlap: true },
        }),
        entry({
          framework: 'nestjs',
          fullPath: '/orders',
          handlerNodeId: 'handler',
          detectionSource: 'source:nestjs_nestia',
          metadata: { evidence: [{ adapterId: 'nestjs_nestia' }], fileFallbackPathOverlap: true },
        }),
      ],
      llmEntries: [],
    })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0].metadata.evidence).toEqual([
      { adapterId: 'nestjs_controller' },
      { adapterId: 'nestjs_nestia' },
    ])
  })

  it('dedupes repeated metadata evidence while merging duplicate entries', () => {
    const evidence = { adapterId: 'nestjs_controller' }
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('handler', 'function')],
      stackInfo: stackInfo({ framework: 'nestjs' as never }),
      ruleEntries: [],
      sourceFallbackEntries: [
        entry({ framework: 'nestjs', handlerNodeId: 'handler', detectionSource: 'source:nestjs_controller', metadata: { evidence: [evidence] } }),
        entry({ framework: 'nestjs', handlerNodeId: 'handler', detectionSource: 'source:nestjs_nestia', metadata: { evidence: [evidence] } }),
      ],
      llmEntries: [],
    })

    expect(result.entryPoints[0].metadata.evidence).toEqual([evidence])
  })

  it('keeps external routes and internal semantic entries distinct and does not apply apiBasePath to internal entries', () => {
    const external = entry({
      framework: 'express',
      kind: 'api',
      httpMethod: 'GET',
      fullPath: '/home/feed',
      handlerNodeId: 'apiHandler',
    })
    const internal = entry({
      framework: 'react',
      kind: 'page',
      httpMethod: undefined,
      fullPath: 'internal://home/feed',
      handlerNodeId: 'FeedPage',
      metadata: { externalRoute: false, semanticEntry: true, parentPage: 'HomePage', label: 'Feed', index: 0 },
    })

    const result = composeEntryPoints({
      repoId: REPO,
      ruleEntries: [external],
      sourceFallbackEntries: [internal],
      llmEntries: [],
      graphNodes: [node('apiHandler', 'function'), node('FeedPage', 'function')],
      stackInfo: stackInfo({ apiBasePaths: ['/api'] }),
      globalPrefixFrameworks: DEFAULT_PREFIX_FRAMEWORKS,
    })

    expect(result.entryPoints.map((ep) => ep.fullPath)).toEqual(['/api/home/feed', 'internal://home/feed'])
    expect(result.diagnostics).toMatchObject({
      semanticEntries: 1,
      semanticSuspected: 0,
      internalEntriesDeduped: 0,
    })
  })

  it('does not apply apiBasePath when base is absent, root-only, multiple, already applied, or utility path', () => {
    const cases = [
      { bases: undefined, path: '/orders', expected: '/orders' },
      { bases: ['/'], path: '/orders', expected: '/orders' },
      { bases: ['/api', '/v1'], path: '/orders', expected: '/orders' },
      { bases: ['/api'], path: '/api/orders', expected: '/api/orders' },
      { bases: ['/api'], path: '/', expected: '/' },
      { bases: ['/api'], path: '/health/live', expected: '/health/live' },
    ]

    for (const [index, testCase] of cases.entries()) {
      const result = composeEntryPoints({
        repoId: REPO,
        graphNodes: [node(`handler-${index}`, 'function')],
        stackInfo: stackInfo({ apiBasePaths: testCase.bases }),
        ruleEntries: [entry({ handlerNodeId: `handler-${index}`, fullPath: testCase.path, path: testCase.path })],
        sourceFallbackEntries: [],
        llmEntries: [],
      })

      expect(result.entryPoints[0].fullPath).toBe(testCase.expected)
    }
  })

  it('does not apply apiBasePath to non-api or unsupported frameworks and keeps missing fullPath', () => {
    const page = entry({
      framework: 'react_router_v6',
      kind: 'page',
      httpMethod: undefined,
      fullPath: '/dashboard',
      handlerNodeId: 'page',
    })
    const job = entry({
      framework: 'nestjs',
      kind: 'job',
      httpMethod: undefined,
      path: undefined,
      fullPath: undefined,
      handlerNodeId: 'job',
    })

    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('page', 'function'), node('job', 'function')],
      stackInfo: stackInfo({ apiBasePaths: ['/api'] }),
      ruleEntries: [page, job],
      sourceFallbackEntries: [],
      llmEntries: [],
    })

    expect(result.entryPoints.map((item) => item.fullPath)).toEqual(['/dashboard', undefined])
  })

  it('keeps Express API entry without local path when apiBasePath is configured', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('handler', 'function')],
      stackInfo: stackInfo({ apiBasePaths: ['/api'] }),
      ruleEntries: [entry({ path: undefined, fullPath: undefined })],
      sourceFallbackEntries: [],
      llmEntries: [],
    })

    expect(result.entryPoints[0].fullPath).toBeUndefined()
  })

  it('dedupes semantic entries by parent label/index and prefers component handlers over file handlers', () => {
    const fileBacked = entry({
      framework: 'flutter',
      kind: 'page',
      httpMethod: undefined,
      fullPath: 'internal://home/feed',
      handlerNodeId: 'homeFile',
      metadata: { externalRoute: false, semanticEntry: true, parentPage: 'HomePage', label: 'Feed', index: 0 },
    })
    const componentBacked = entry({
      framework: 'flutter',
      kind: 'page',
      httpMethod: undefined,
      fullPath: 'internal://home/feed-copy',
      handlerNodeId: 'FeedPage',
      metadata: { externalRoute: false, semanticEntry: true, parentPage: 'HomePage', label: 'Feed', index: 0 },
    })

    const result = composeEntryPoints({
      repoId: REPO,
      ruleEntries: [],
      sourceFallbackEntries: [fileBacked],
      llmEntries: [componentBacked],
      graphNodes: [node('homeFile', 'file'), node('FeedPage', 'class')],
      stackInfo: stackInfo({ framework: 'flutter' as never }),
    })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0].handlerNodeId).toBe('FeedPage')
    expect(result.entryPoints[0].fullPath).toBe('internal://home/feed-copy')
    expect(result.diagnostics.internalEntriesDeduped).toBe(1)
  })

  it('dedupes semantic entries by internal path when parent metadata is absent', () => {
    const first = entry({
      framework: 'react',
      kind: 'page',
      httpMethod: undefined,
      fullPath: 'internal://settings/profile',
      handlerNodeId: 'settingsFile',
      metadata: { semanticEntry: true },
    })
    const second = entry({
      framework: 'react',
      kind: 'page',
      httpMethod: undefined,
      fullPath: 'internal://settings/profile',
      handlerNodeId: 'SettingsProfile',
      metadata: { semanticEntry: true },
    })

    const result = composeEntryPoints({
      repoId: REPO,
      ruleEntries: [],
      sourceFallbackEntries: [first, second],
      llmEntries: [],
      graphNodes: [node('settingsFile', 'file'), node('SettingsProfile', 'function')],
      stackInfo: stackInfo({ framework: 'react' as never }),
    })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0].handlerNodeId).toBe('SettingsProfile')
    expect(result.diagnostics.internalEntriesDeduped).toBe(1)
  })

  it('dedupes semantic entries using path when fullPath is absent', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      ruleEntries: [],
      sourceFallbackEntries: [
        entry({ framework: 'react', kind: 'page', httpMethod: undefined, path: 'internal://profile', fullPath: undefined, handlerNodeId: 'profileFile', metadata: {} }),
        entry({ framework: 'react', kind: 'page', httpMethod: undefined, path: 'internal://profile', fullPath: undefined, handlerNodeId: 'ProfilePage', metadata: {} }),
      ],
      llmEntries: [],
      graphNodes: [node('profileFile', 'file'), node('ProfilePage', 'function')],
      stackInfo: stackInfo({ framework: 'react' as never }),
    })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0].handlerNodeId).toBe('ProfilePage')
  })

  it('file fallback duplicate prefers route with concrete httpMethod over file route without method', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      ruleEntries: [
        entry({ handlerNodeId: 'file', httpMethod: undefined, detectionSource: 'rule:nextjs' }),
      ],
      sourceFallbackEntries: [
        entry({ handlerNodeId: 'sourceFile', httpMethod: 'GET', detectionSource: 'source:nextjs' }),
      ],
      llmEntries: [],
      graphNodes: [node('file', 'file'), node('sourceFile', 'file')],
      stackInfo: stackInfo(),
    })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0].handlerNodeId).toBe('sourceFile')
  })

  it('dedupes file fallback when either side has nullish httpMethod', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      ruleEntries: [
        entry({ handlerNodeId: 'fileA', httpMethod: null, detectionSource: 'rule:nextjs' }),
      ],
      sourceFallbackEntries: [
        entry({ handlerNodeId: 'fileB', httpMethod: 'GET', detectionSource: 'source:nextjs' }),
      ],
      llmEntries: [],
      graphNodes: [node('fileA', 'file'), node('fileB', 'file')],
      stackInfo: stackInfo(),
    })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0].handlerNodeId).toBe('fileB')
  })

  it('keeps same path entries separate when interaction kind differs or both handlers are concrete', () => {
    const concreteA = entry({ handlerNodeId: 'a', metadata: { interactionKind: 'loader' } })
    const concreteB = entry({ handlerNodeId: 'b', metadata: { interactionKind: 'action' } })
    const sameInteractionA = entry({ handlerNodeId: 'c', metadata: { interactionKind: 'loader' } })
    const sameInteractionB = entry({ handlerNodeId: 'd', metadata: { interactionKind: 'loader' } })

    const result = composeEntryPoints({
      repoId: REPO,
      ruleEntries: [concreteA, concreteB, sameInteractionA, sameInteractionB],
      sourceFallbackEntries: [],
      llmEntries: [],
      graphNodes: [node('a', 'function'), node('b', 'function'), node('c', 'function'), node('d', 'function')],
      stackInfo: stackInfo(),
    })

    expect(result.entryPoints.map((item) => item.handlerNodeId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps page route, loader entry, and action entry separate for the same route', () => {
    const page = entry({
      framework: 'react_router_v6',
      kind: 'page',
      httpMethod: undefined,
      fullPath: '/posts',
      handlerNodeId: 'PostsPage',
    })
    const loader = entry({
      framework: 'react_router_v6',
      kind: 'api',
      httpMethod: 'GET',
      fullPath: '/posts#loader',
      handlerNodeId: 'loader',
      metadata: { interactionKind: 'react_router_loader' },
    })
    const action = entry({
      framework: 'react_router_v6',
      kind: 'api',
      httpMethod: 'POST',
      fullPath: '/posts#action',
      handlerNodeId: 'action',
      metadata: { interactionKind: 'react_router_action' },
    })

    const result = composeEntryPoints({
      repoId: REPO,
      ruleEntries: [page],
      sourceFallbackEntries: [loader, action],
      llmEntries: [],
      graphNodes: [node('PostsPage', 'function'), node('loader', 'function'), node('action', 'function')],
      stackInfo: stackInfo({ framework: 'react_router_v6' as never }),
    })

    expect(result.entryPoints.map((ep) => ep.fullPath)).toEqual(['/posts', '/posts#loader', '/posts#action'])
  })

  it('dedupes NestJS schedule jobs by handler and keeps source schedule metadata', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('TasksService.handleCron', 'method')],
      stackInfo: stackInfo({ framework: 'nestjs' as never }),
      ruleEntries: [
        entry({
          framework: 'nestjs',
          kind: 'job',
          httpMethod: null,
          path: null,
          fullPath: null,
          handlerNodeId: 'TasksService.handleCron',
          detectionSource: 'rule:nestjs',
        }),
      ],
      sourceFallbackEntries: [
        entry({
          framework: 'nestjs',
          kind: 'job',
          httpMethod: 'SCHEDULE',
          path: 'schedule:Cron:TasksService.handleCron',
          fullPath: 'schedule:Cron:TasksService.handleCron',
          handlerNodeId: 'TasksService.handleCron',
          detectionSource: 'source:nestjs_schedule',
        }),
      ],
      llmEntries: [],
    })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0]).toMatchObject({
      detectionSource: 'source:nestjs_schedule',
      fullPath: 'schedule:Cron:TasksService.handleCron',
      httpMethod: 'SCHEDULE',
    })
  })

  it('dedupes overlapping NestJS source API paths and prefers the longer specific path', () => {
    const controllerFile = { ...node('controllerFile', 'file'), filePath: 'src/orders.controller.ts' }
    const controllerMethod = { ...node('controllerMethod', 'method'), filePath: 'src/orders.controller.ts' }
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [controllerFile, controllerMethod],
      stackInfo: stackInfo({ framework: 'nestjs' as never }),
      ruleEntries: [],
      sourceFallbackEntries: [
        entry({
          framework: 'nestjs',
          fullPath: '/',
          handlerNodeId: 'controllerFile',
          detectionSource: 'source:nestjs_controller',
          metadata: { fileFallbackPathOverlap: true },
        }),
        entry({
          framework: 'nestjs',
          fullPath: '/orders',
          handlerNodeId: 'controllerMethod',
          detectionSource: 'source:nestjs_nestia',
          metadata: { fileFallbackPathOverlap: true },
        }),
      ],
      llmEntries: [],
    })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0].fullPath).toBe('/orders')
  })

  it('dedupes NestJS source API when same handler has identical path', () => {
    const result = composeEntryPoints({
      repoId: REPO,
      graphNodes: [node('handler', 'method')],
      stackInfo: stackInfo({ framework: 'nestjs' as never }),
      ruleEntries: [],
      sourceFallbackEntries: [
        entry({ framework: 'nestjs', fullPath: '/orders', handlerNodeId: 'handler', detectionSource: 'source:nestjs_controller', metadata: { fileFallbackPathOverlap: true } }),
        entry({ framework: 'nestjs', fullPath: '/orders', handlerNodeId: 'handler', detectionSource: 'source:nestjs_nestia', metadata: { fileFallbackPathOverlap: true } }),
      ],
      llmEntries: [],
    })

    expect(result.entryPoints).toHaveLength(1)
  })
})
