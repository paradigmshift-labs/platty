/**
 * build_relations API call 시나리오 테스트
 * SOT: specs/build_relations/architecture.md §5.2
 * 시나리오: REL-S02, REL-S03, REL-S09, REL-S15, REL-S16
 *           REL-N02, REL-N04, REL-N17
 */

import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, SourceFallback } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { normalizeRelations } from '@/pipeline_modules/build_relations/normalize_relations.js'
import type { CodeNodeLike, CodeEdgeLike, ModelLookup } from '@/pipeline_modules/build_relations/types.js'

// ── helpers ──────────────────────────────────────────────

const REPO_ID = 'repo_api'

function makeInputs(partial: {
  nodes: CodeNodeLike[]
  edges: CodeEdgeLike[]
  models?: ModelLookup[]
}): BuildRelationsInputs {
  return {
    repoId: REPO_ID,
    repoPath: null,
    includeTestSources: false,
    nodes: partial.nodes,
    edges: partial.edges,
    models: partial.models ?? [],
  }
}

let edgeId = 1000
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

function runPipeline(inputs: BuildRelationsInputs, sourceFallback?: Partial<SourceFallback>) {
  const index = buildSemanticIndex(inputs)
  const candidates = extractCandidates(inputs, index)
  const extracted = resolveCandidates(
    candidates,
    index,
    { resolveConstant: () => null, ...sourceFallback },
  )
  return normalizeRelations(extracted)
}

// ── REL-S02: axios.post static path ──────────────────────

describe('REL-S02: axios.post static REST path', () => {
  it('axios import + axios.post("/api/orders") → api_call POST /api/orders high', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders.ts:createOrder`, { filePath: 'src/orders.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'axios', targetSymbol: 'axios', targetId: null,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'axios',
        firstArg: '/api/orders',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('api_call')
    expect(result[0].target).toBe('/api/orders')
    expect(result[0].operation).toBe('POST')
    expect(result[0].canonicalTarget).toBe('POST /api/orders')
    expect(result[0].confidence).toBe('high')
    expect(result[0].payload).toMatchObject({ protocol: 'rest', adapter: 'http_client' })
  })

  it('local HTTP wrapper import + http.post("/api/orders") → api_call without package-specific hardcoding', () => {
    const httpNode = makeNode(`${REPO_ID}:src/shared/http.ts:http`, { filePath: 'src/shared/http.ts' })
    const handlerNode = makeNode(`${REPO_ID}:src/orders.ts:createOrder`, { filePath: 'src/orders.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@/shared/http',
        targetSymbol: 'http',
        targetId: httpNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'http',
        firstArg: '/api/orders',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [httpNode, handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/orders',
      operation: 'POST',
      canonicalTarget: 'POST /api/orders',
      payload: { adapter: 'http_client', anchor: 'local_http_wrapper' },
    })
  })

  it('call edge internal targetSpecifier + apiInstance.get("v2/orders") → local wrapper api_call', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders.ts:listOrders`, { filePath: 'src/orders.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'apiInstance',
        targetSpecifier: '@/shared/api/http',
        firstArg: 'v2/orders',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/v2/orders',
      operation: 'GET',
      canonicalTarget: 'GET /v2/orders',
      payload: { adapter: 'http_client', anchor: 'local_http_wrapper' },
    })
  })

  it('local wrapper with arbitrary receiver name is accepted when imported target uses axios internally', () => {
    const wrapperNode = makeNode(`${REPO_ID}:src/shared/http.ts:makeRequest`, { filePath: 'src/shared/http.ts', name: 'makeRequest' })
    const handlerNode = makeNode(`${REPO_ID}:src/orders.ts:listOrders`, { filePath: 'src/orders.ts' })

    const edges = [
      makeEdge(wrapperNode.id, 'imports', {
        targetSpecifier: 'axios',
        targetSymbol: 'axios',
      }),
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@/shared/http',
        targetSymbol: 'banana',
        targetId: wrapperNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'banana',
        firstArg: '/api/orders',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [wrapperNode, handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/orders',
      operation: 'POST',
      payload: { adapter: 'http_client', anchor: 'local_http_wrapper' },
    })
  })

  it('bare local wrapper function with HTTP evidence resolves path constants and config method', () => {
    const wrapperNode = makeNode(`${REPO_ID}:src/generated/client.ts:request`, {
      filePath: 'src/generated/client.ts',
      name: 'request',
    })
    const operationNode = makeNode(`${REPO_ID}:src/generated/client.ts:getCurrentAccount`, {
      filePath: 'src/generated/client.ts',
      name: 'getCurrentAccount',
    })

    const edges = [
      makeEdge(wrapperNode.id, 'calls', {
        targetSymbol: 'fetch',
        firstArg: 'path',
      }),
      makeEdge(operationNode.id, 'calls', {
        targetSymbol: 'request',
        targetId: wrapperNode.id,
        firstArg: 'ACCOUNT_CURRENT_PATH',
        argExpressions: [
          { index: 0, kind: 'identifier', raw: 'ACCOUNT_CURRENT_PATH', name: 'ACCOUNT_CURRENT_PATH' },
          {
            index: 1,
            kind: 'object',
            raw: "{ method: 'GET' }",
            properties: {
              method: { index: 0, kind: 'string', raw: "'GET'", value: 'GET' },
            },
          },
        ],
      }),
    ]

    const result = runPipeline(
      makeInputs({ nodes: [wrapperNode, operationNode], edges }),
      { resolveConstant: ({ identifier }) => identifier === 'ACCOUNT_CURRENT_PATH' ? '/api/account/current' : null },
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/account/current',
      operation: 'GET',
      canonicalTarget: 'GET /api/account/current',
      payload: { adapter: 'local_http_wrapper', anchor: 'local_http_wrapper' },
    })
  })

  it('does not emit bare path-shaped helper calls without HTTP evidence', () => {
    const helperNode = makeNode(`${REPO_ID}:src/util/routes.ts:formatPath`, {
      filePath: 'src/util/routes.ts',
      name: 'formatPath',
    })
    const callerNode = makeNode(`${REPO_ID}:src/util/routes.ts:buildMenu`, {
      filePath: 'src/util/routes.ts',
      name: 'buildMenu',
    })

    const edges = [
      makeEdge(callerNode.id, 'calls', {
        targetSymbol: 'formatPath',
        targetId: helperNode.id,
        firstArg: '/api/account/current',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [helperNode, callerNode], edges }))
    expect(result).toHaveLength(0)
  })

  it('resolved repository method call preserves api_call relation through caller flow', () => {
    const hookNode = makeNode(`${REPO_ID}:src/useMyProfile.ts:useMyProfile`, {
      type: 'function',
      name: 'useMyProfile',
      filePath: 'src/useMyProfile.ts',
    })
    const repoMethodNode = makeNode(`${REPO_ID}:src/AuthRepository.ts:AuthRepository.getMyProfile`, {
      type: 'method',
      name: 'AuthRepository.getMyProfile',
      filePath: 'src/AuthRepository.ts',
    })

    const edges = [
      makeEdge(hookNode.id, 'calls', {
        targetSymbol: 'getMyProfile',
        chainPath: 'auth',
        targetId: repoMethodNode.id,
        resolveStatus: 'resolved',
      }),
      makeEdge(repoMethodNode.id, 'imports', {
        targetSpecifier: 'axios',
        targetSymbol: 'http',
      }),
      makeEdge(repoMethodNode.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'http',
        firstArg: '/api/v2/me',
        resolveStatus: 'external',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [hookNode, repoMethodNode], edges }))
    const apiCalls = result.filter((candidate) => candidate.kind === 'api_call')

    expect(apiCalls).toHaveLength(1)
    expect(apiCalls[0]).toMatchObject({
      kind: 'api_call',
      sourceNodeId: repoMethodNode.id,
      target: '/api/v2/me',
      operation: 'GET',
      canonicalTarget: 'GET /api/v2/me',
    })
    expect(apiCalls).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceNodeId: hookNode.id }),
      ]),
    )
  })
})

describe('Dart/Flutter HTTP client graph trace', () => {
  it('Dio import + arbitrary receiver.get("v2/users") → api_call without receiver-name hardcoding', () => {
    const repositoryNode = makeNode(`${REPO_ID}:lib/repository/user_repository.dart:UserRepository.findUsers`, {
      filePath: 'lib/repository/user_repository.dart',
    })

    const edges = [
      makeEdge(repositoryNode.id, 'imports', {
        targetSpecifier: 'package:dio/dio.dart',
        targetSymbol: 'Dio',
      }),
      makeEdge(repositoryNode.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'banana',
        firstArg: 'v2/users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [repositoryNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/v2/users',
      operation: 'GET',
      canonicalTarget: 'GET /v2/users',
      payload: { adapter: 'http_client', anchor: 'package:dio/dio.dart' },
    })
  })

  it('Dio request(path, method: "GET") resolves named method metadata from Dart literal args', () => {
    const repositoryNode = makeNode(`${REPO_ID}:lib/generated/account_api.dart:GeneratedAccountApi.getCurrentAccount`, {
      filePath: 'lib/generated/account_api.dart',
    })

    const edges = [
      makeEdge(repositoryNode.id, 'imports', {
        targetSpecifier: 'package:dio/dio.dart',
        targetSymbol: 'Dio',
      }),
      makeEdge(repositoryNode.id, 'calls', {
        targetSymbol: 'request',
        chainPath: 'client',
        firstArg: 'GeneratedAccountApi.currentPath',
        literalArgs: '[null,{"method":"GET"}]',
      }),
    ]

    const result = runPipeline(
      makeInputs({ nodes: [repositoryNode], edges }),
      { resolveConstant: ({ identifier }) => identifier === 'GeneratedAccountApi.currentPath' ? '/api/mobile/generated-account' : null },
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/mobile/generated-account',
      operation: 'GET',
      canonicalTarget: 'GET /api/mobile/generated-account',
      payload: { adapter: 'http_client', anchor: 'package:dio/dio.dart' },
    })
  })

  it('package:http import + client.post(Uri.parse("v1/auth")) → api_call', () => {
    const repositoryNode = makeNode(`${REPO_ID}:lib/repository/auth_repository.dart:AuthRepository.login`, {
      filePath: 'lib/repository/auth_repository.dart',
    })

    const edges = [
      makeEdge(repositoryNode.id, 'imports', {
        targetSpecifier: 'package:http/http.dart',
        targetSymbol: 'http',
      }),
      makeEdge(repositoryNode.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'client',
        firstArg: 'v1/auth',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [repositoryNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/v1/auth',
      operation: 'POST',
      canonicalTarget: 'POST /v1/auth',
      payload: { adapter: 'http_client', anchor: 'package:http/http.dart' },
    })
  })

  it('does not emit method/path-shaped calls without HTTP package or wrapper evidence', () => {
    const repositoryNode = makeNode(`${REPO_ID}:lib/repository/user_repository.dart:UserRepository.fake`, {
      filePath: 'lib/repository/user_repository.dart',
    })

    const edges = [
      makeEdge(repositoryNode.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'banana',
        firstArg: 'v2/users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [repositoryNode], edges }))

    expect(result).toHaveLength(0)
  })
})

describe('Axios instance adapter graph trace', () => {
  it('axios.create({ baseURL }) + api.get("/users") resolves combined target', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:listUsers`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'axios',
        targetSymbol: 'axios',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'axios',
        literalArgs: '[{"baseURL":"/api"}]',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'api',
        firstArg: '/users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/users',
      operation: 'GET',
      payload: { adapter: 'axios_instance', anchor: 'axios' },
    })
  })

  it('api.request({ url, method }) infers method and target from config object', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:createUser`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'axios',
        targetSymbol: 'axios',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'axios',
        literalArgs: '[{"baseURL":"/api"}]',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'request',
        chainPath: 'api',
        literalArgs: '[{"url":"/users","method":"post"}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/users',
      operation: 'POST',
      payload: { adapter: 'axios_instance', configMethod: true },
    })
  })

  it('imported axios.create instance resolves member endpoint constants through source fallback and baseURL', () => {
    const apiNode = makeNode(`${REPO_ID}:src/lib/api.ts:apiClient`, { filePath: 'src/lib/api.ts' })
    const handlerNode = makeNode(`${REPO_ID}:src/orders.ts:createOrder`, { filePath: 'src/orders.ts' })
    const edges = [
      makeEdge(apiNode.id, 'imports', {
        targetSpecifier: 'axios',
        targetSymbol: 'axios',
      }),
      makeEdge(apiNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'axios',
        literalArgs: '[{"baseURL":"/api"}]',
      }),
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: './lib/api',
        targetSymbol: 'apiClient',
        targetId: apiNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'apiClient',
        argExpressions: [
          { index: 0, kind: 'member', raw: 'API_ROUTES.orders', resolution: 'dynamic' },
        ],
      }),
    ]

    const result = runPipeline(
      makeInputs({ nodes: [apiNode, handlerNode], edges }),
      { resolveConstant: ({ identifier }) => identifier === 'API_ROUTES.orders' ? '/orders' : null },
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/orders',
      operation: 'POST',
      canonicalTarget: 'POST /api/orders',
      payload: { adapter: 'axios_instance', baseURL: '/api' },
    })
  })

  it('imported axios.create instance accepts API-ish slashless relative paths with env baseURL', () => {
    const apiNode = makeNode(`${REPO_ID}:src/lib/api.ts:apiInstance`, { filePath: 'src/lib/api.ts' })
    const handlerNode = makeNode(`${REPO_ID}:src/store.ts:listStores`, { filePath: 'src/store.ts' })
    const edges = [
      makeEdge(apiNode.id, 'imports', {
        targetSpecifier: 'axios',
        targetSymbol: 'axios',
      }),
      makeEdge(apiNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'axios',
        literalArgs: '[{"baseURL":null}]',
      }),
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: './lib/api',
        targetSymbol: 'apiInstance',
        targetId: apiNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'apiInstance',
        firstArg: 'v2/store/list',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [apiNode, handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/v2/store/list',
      operation: 'GET',
      canonicalTarget: 'GET /v2/store/list',
      payload: { adapter: 'axios_instance', baseURL: 'unknown' },
    })
  })

  it('imported axios.create instance accepts dotted version slashless relative paths', () => {
    const apiNode = makeNode(`${REPO_ID}:src/lib/api.ts:apiEventInstance`, { filePath: 'src/lib/api.ts' })
    const handlerNode = makeNode(`${REPO_ID}:src/event.ts:trackView`, { filePath: 'src/event.ts' })
    const edges = [
      makeEdge(apiNode.id, 'imports', {
        targetSpecifier: 'axios',
        targetSymbol: 'axios',
      }),
      makeEdge(apiNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'axios',
        literalArgs: '[{"baseURL":null}]',
      }),
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: './lib/api',
        targetSymbol: 'apiEventInstance',
        targetId: apiNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'apiEventInstance',
        firstArg: 'v1.1/event/view',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [apiNode, handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/v1.1/event/view',
      operation: 'POST',
      canonicalTarget: 'POST /v1.1/event/view',
    })
  })

  it('does not emit arbitrary slashless axios instance strings', () => {
    const apiNode = makeNode(`${REPO_ID}:src/lib/api.ts:apiClient`, { filePath: 'src/lib/api.ts' })
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:listUsers`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(apiNode.id, 'imports', {
        targetSpecifier: 'axios',
        targetSymbol: 'axios',
      }),
      makeEdge(apiNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'axios',
        literalArgs: '[{"baseURL":null}]',
      }),
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: './lib/api',
        targetSymbol: 'apiClient',
        targetId: apiNode.id,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'apiClient',
        firstArg: 'users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [apiNode, handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })

  it('does not treat unrelated http.get as API client just because the file imports react-query', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/storybook/preview.tsx:preview`, {
      filePath: 'src/storybook/preview.tsx',
    })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@tanstack/react-query',
        targetSymbol: 'QueryClient',
      }),
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'msw',
        targetSymbol: 'http',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'http',
        firstArg: '/v2/store/seller/company',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })

  it('does not emit axios instance calls with dynamic config URLs', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:dynamicUser`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'axios',
        targetSymbol: 'axios',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'axios',
        literalArgs: '[{"baseURL":"/api"}]',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'request',
        chainPath: 'api',
        literalArgs: '[{"url":null,"method":"post"}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })
})

describe('Ky/Got/Superagent adapter graph trace', () => {
  it('ky("/api/users") callable client resolves UNKNOWN method internal path', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:listUsers`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'ky',
        targetSymbol: 'ky',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'ky',
        chainPath: null,
        firstArg: '/api/users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/users',
      operation: 'UNKNOWN',
      payload: { adapter: 'http_library', anchor: 'ky' },
    })
  })

  it('got("/api/users") callable client resolves UNKNOWN method internal path', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:listUsers`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'got',
        targetSymbol: 'got',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'got',
        chainPath: null,
        firstArg: '/api/users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/users',
      operation: 'UNKNOWN',
      payload: { adapter: 'http_library', anchor: 'got' },
    })
  })

  it('superagent.post("/api/users") resolves method call with adapter metadata', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:createUser`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'superagent',
        targetSymbol: 'superagent',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'superagent',
        firstArg: '/api/users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/users',
      operation: 'POST',
      payload: { adapter: 'http_library', anchor: 'superagent' },
    })
  })
})

describe('React Query / SWR adapter graph trace', () => {
  it('useQuery(["/api/users"]) resolves query-key path as GET api_call', () => {
    const componentNode = makeNode(`${REPO_ID}:src/users.tsx:Users`, { filePath: 'src/users.tsx' })
    const edges = [
      makeEdge(componentNode.id, 'imports', {
        targetSpecifier: '@tanstack/react-query',
        targetSymbol: 'useQuery',
      }),
      makeEdge(componentNode.id, 'calls', {
        targetSymbol: 'useQuery',
        literalArgs: '[["/api/users"]]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [componentNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/users',
      operation: 'GET',
      payload: { adapter: 'react_query', anchor: '@tanstack/react-query' },
    })
  })

  it('useQuery({ queryKey: ["/api/users"] }) resolves object syntax query key', () => {
    const componentNode = makeNode(`${REPO_ID}:src/users.tsx:Users`, { filePath: 'src/users.tsx' })
    const edges = [
      makeEdge(componentNode.id, 'imports', {
        targetSpecifier: 'react-query',
        targetSymbol: 'useQuery',
      }),
      makeEdge(componentNode.id, 'calls', {
        targetSymbol: 'useQuery',
        literalArgs: '[{"queryKey":["/api/users"],"queryFn":null}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [componentNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/users',
      operation: 'GET',
      payload: { adapter: 'react_query', anchor: 'react-query', queryFn: true },
    })
  })

  it('useSWR("/api/users", fetcher) resolves SWR key path', () => {
    const componentNode = makeNode(`${REPO_ID}:src/users.tsx:Users`, { filePath: 'src/users.tsx' })
    const edges = [
      makeEdge(componentNode.id, 'imports', {
        targetSpecifier: 'swr',
        targetSymbol: 'useSWR',
      }),
      makeEdge(componentNode.id, 'calls', {
        targetSymbol: 'useSWR',
        firstArg: '/api/users',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [componentNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/users',
      operation: 'GET',
      payload: { adapter: 'swr', anchor: 'swr' },
    })
  })

  it('does not emit domain-only query keys without a static API path', () => {
    const componentNode = makeNode(`${REPO_ID}:src/users.tsx:Users`, { filePath: 'src/users.tsx' })
    const edges = [
      makeEdge(componentNode.id, 'imports', {
        targetSpecifier: '@tanstack/react-query',
        targetSymbol: 'useQuery',
      }),
      makeEdge(componentNode.id, 'calls', {
        targetSymbol: 'useQuery',
        literalArgs: '[["users",null]]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [componentNode], edges }))
    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })
})

describe('GraphQL client adapter graph trace', () => {
  it('Apollo client.query({ query: GET_USERS }) resolves operation name from identifier', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:getUsers`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@apollo/client',
        targetSymbol: 'ApolloClient',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'query',
        chainPath: 'client',
        literalArgs: '[{"query":null}]',
        argExpressions: [{ index: 0, kind: 'object', raw: '{ query: GET_USERS }' }],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: 'graphql:GET_USERS',
      operation: 'GRAPHQL_QUERY',
      payload: { adapter: 'graphql_client', anchor: '@apollo/client' },
    })
  })

  it('graphql-request request(query) resolves operation name from document literal', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:getUsers`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'graphql-request',
        targetSymbol: 'request',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'request',
        chainPath: null,
        firstArg: 'query GetUsers { users { id } }',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: 'graphql:GetUsers',
      operation: 'GRAPHQL_QUERY',
      payload: { adapter: 'graphql_client', anchor: 'graphql-request' },
    })
  })

  it('graphql-request request(endpoint, query) resolves operation name from second argument', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:getUsers`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'graphql-request',
        targetSymbol: 'request',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'request',
        chainPath: null,
        firstArg: '/graphql',
        argExpressions: [
          { index: 0, kind: 'string', raw: "'/graphql'", value: '/graphql', resolution: 'static' },
          {
            index: 1,
            kind: 'identifier',
            raw: 'GET_USERS',
            resolution: 'static',
            resolved: {
              index: 1,
              kind: 'template',
              raw: '`query GetUsers { users { id } }`',
              staticPattern: 'query GetUsers { users { id } }',
              identifiers: [],
              resolution: 'static',
            },
          },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: 'graphql:GetUsers',
      operation: 'GRAPHQL_QUERY',
      payload: { adapter: 'graphql_client', anchor: 'graphql-request' },
    })
  })

  it('Apollo client.mutate({ mutation: UPDATE_USER }) maps mutation operation', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:updateUser`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@apollo/client',
        targetSymbol: 'ApolloClient',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'mutate',
        chainPath: 'client',
        literalArgs: '[{"mutation":null}]',
        argExpressions: [{ index: 0, kind: 'object', raw: '{ mutation: UPDATE_USER }' }],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: 'graphql:UPDATE_USER',
      operation: 'GRAPHQL_MUTATION',
      payload: { adapter: 'graphql_client', anchor: '@apollo/client' },
    })
  })

  it('Apollo useQuery(IMPORTED_QUERY) resolves GraphQL document through source fallback', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders/OrdersPage.tsx:OrdersPage`, { filePath: 'src/orders/OrdersPage.tsx' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@apollo/client',
        targetSymbol: 'useQuery',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'useQuery',
        chainPath: null,
        argExpressions: [
          { index: 0, kind: 'identifier', raw: 'ORDERS_QUERY', resolution: 'dynamic' },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }), {
      resolveConstant: ({ identifier }) => identifier === 'ORDERS_QUERY'
        ? 'query GetUsers { users { id } }'
        : null,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: 'graphql:GetUsers',
      operation: 'GRAPHQL_QUERY',
      payload: { adapter: 'graphql_client', anchor: '@apollo/client' },
    })
  })

  it('urql useQuery({ query }) resolves GraphQL document through source fallback', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders/OrdersPage.tsx:OrdersPage`, { filePath: 'src/orders/OrdersPage.tsx' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'urql',
        targetSymbol: 'useQuery',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'useQuery',
        chainPath: null,
        argExpressions: [
          {
            index: 0,
            kind: 'object',
            raw: '{ query: ORDERS_QUERY }',
            resolution: 'partial',
            properties: {
              query: { index: 0, kind: 'identifier', raw: 'ORDERS_QUERY', resolution: 'dynamic' },
            },
          },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }), {
      resolveConstant: ({ identifier }) => identifier === 'ORDERS_QUERY'
        ? 'query Orders { orders { id } }'
        : null,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: 'graphql:Orders',
      operation: 'GRAPHQL_QUERY',
      payload: { adapter: 'graphql_client', anchor: 'urql' },
    })
  })

  it('graphql_flutter client.query(QueryOptions(document: gql(ORDERS_QUERY))) resolves through source fallback', () => {
    const handlerNode = makeNode(`${REPO_ID}:lib/services/orders_repository.dart:OrdersRepository.loadOrders`, {
      filePath: 'lib/services/orders_repository.dart',
    })
    const fileNode = makeNode(`${REPO_ID}:lib/services/orders_repository.dart`, {
      type: 'file',
      filePath: 'lib/services/orders_repository.dart',
    })
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: 'package:graphql_flutter/graphql_flutter.dart',
        targetSymbol: 'GraphQLClient',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'query',
        chainPath: 'client',
        argExpressions: [
          { index: 0, kind: 'call', raw: 'QueryOptions(document: gql(ORDERS_QUERY))', resolution: 'dynamic' },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [fileNode, handlerNode], edges }), {
      resolveConstant: ({ identifier }) => identifier === 'ORDERS_QUERY'
        ? 'query orders { orders }'
        : null,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: 'graphql:orders',
      operation: 'GRAPHQL_QUERY',
      payload: { adapter: 'graphql_client', anchor: 'package:graphql_flutter/graphql_flutter.dart' },
    })
  })

  it('graphql_flutter client.mutate(MutationOptions(document: gql(...))) resolves inline mutation document', () => {
    const handlerNode = makeNode(`${REPO_ID}:lib/services/orders_repository.dart:OrdersRepository.createOrder`, {
      filePath: 'lib/services/orders_repository.dart',
    })
    const fileNode = makeNode(`${REPO_ID}:lib/services/orders_repository.dart`, {
      type: 'file',
      filePath: 'lib/services/orders_repository.dart',
    })
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: 'package:graphql_flutter/graphql_flutter.dart',
        targetSymbol: 'MutationOptions',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'mutate',
        chainPath: 'client',
        argExpressions: [
          {
            index: 0,
            kind: 'call',
            raw: "MutationOptions(document: gql('mutation createOrder { createOrder(sku: \"A\") }'))",
            resolution: 'dynamic',
          },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [fileNode, handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: 'graphql:createOrder',
      operation: 'GRAPHQL_MUTATION',
      payload: { adapter: 'graphql_client', anchor: 'package:graphql_flutter/graphql_flutter.dart' },
    })
  })

  it('does not emit anonymous GraphQL documents', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:getUsers`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'graphql-request',
        targetSymbol: 'request',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'request',
        chainPath: null,
        firstArg: 'query { users { id } }',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })
})

describe('HTTP client object argExpressions', () => {
  it('axios.request({ url, method }) resolves REST target from graph object properties without source fallback', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:loadUsers`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'axios',
        targetSymbol: 'axios',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'request',
        chainPath: 'axios',
        argExpressions: [{
          index: 0,
          kind: 'object',
          raw: "{ url: '/api/users', method: 'post' }",
          resolution: 'static',
          properties: {
            url: { index: 0, kind: 'string', raw: "'/api/users'", value: '/api/users', resolution: 'static' },
            method: { index: 1, kind: 'string', raw: "'post'", value: 'post', resolution: 'static' },
          },
        }],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/users',
      operation: 'POST',
      payload: { adapter: 'http_client', anchor: 'axios' },
    })
  })

  it('axios.request(config) resolves REST target from graph resolved object without source fallback', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:loadUsers`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'axios',
        targetSymbol: 'axios',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'request',
        chainPath: 'axios',
        argExpressions: [{
          index: 0,
          kind: 'identifier',
          raw: 'config',
          resolution: 'static',
          resolved: {
            index: 0,
            kind: 'object',
            raw: "{ url: '/api/users', method: 'post' }",
            resolution: 'static',
            properties: {
              url: { index: 0, kind: 'string', raw: "'/api/users'", value: '/api/users', resolution: 'static' },
              method: { index: 1, kind: 'string', raw: "'post'", value: 'post', resolution: 'static' },
            },
          },
        }],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/users',
      operation: 'POST',
    })
  })

  it('axios.request(config) with partial resolved object uses static url and falls back to REQUEST method', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:loadUsers`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'axios',
        targetSymbol: 'axios',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'request',
        chainPath: 'axios',
        argExpressions: [{
          index: 0,
          kind: 'identifier',
          raw: 'config',
          resolution: 'partial',
          resolved: {
            index: 0,
            kind: 'object',
            raw: "{ url: '/api/users', method }",
            resolution: 'partial',
            properties: {
              url: { index: 0, kind: 'string', raw: "'/api/users'", value: '/api/users', resolution: 'static' },
              method: { index: 1, kind: 'identifier', raw: 'method', resolution: 'dynamic' },
            },
          },
        }],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/users',
      operation: 'REQUEST',
    })
  })
})

describe('tRPC client adapter graph trace', () => {
  it('trpc.user.list.query() resolves procedure path', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:listUsers`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@trpc/client',
        targetSymbol: 'createTRPCProxyClient',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'query',
        chainPath: 'trpc.user.list',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: 'trpc:user.list',
      operation: 'TRPC_QUERY',
      payload: { adapter: 'trpc_client', anchor: '@trpc/client' },
    })
  })

  it('api.post.create.mutate() resolves mutation procedure path', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/posts.ts:createPost`, { filePath: 'src/posts.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@trpc/react-query',
        targetSymbol: 'createTRPCReact',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'mutate',
        chainPath: 'api.post.create',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: 'trpc:post.create',
      operation: 'TRPC_MUTATION',
      payload: { adapter: 'trpc_client', anchor: '@trpc/react-query' },
    })
  })

  it('does not emit tRPC calls without a procedure segment', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/users.ts:badCall`, { filePath: 'src/users.ts' })
    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: '@trpc/client',
        targetSymbol: 'createTRPCProxyClient',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'query',
        chainPath: 'trpc',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })
})

describe('oRPC client adapter graph trace', () => {
  it('client.markdown.render() resolves a typed oRPC procedure path', () => {
    const fileNode = makeNode(`${REPO_ID}:src/lib/markdown/browser.ts`, {
      type: 'file',
      name: 'browser.ts',
      filePath: 'src/lib/markdown/browser.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/lib/markdown/browser.ts:renderMarkdown`, {
      filePath: 'src/lib/markdown/browser.ts',
    })
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: '@orpc/client',
        targetSymbol: 'createORPCClient',
      }),
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: '@orpc/server',
        targetSymbol: 'RouterClient',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'render',
        chainPath: 'client.markdown',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [fileNode, handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: 'orpc:markdown.render',
      operation: 'ORPC_CALL',
      payload: { adapter: 'orpc_client', anchor: '@orpc/client', procedurePath: 'markdown.render' },
    })
  })

  it('does not treat @orpc/server os.route() as a client API call', () => {
    const fileNode = makeNode(`${REPO_ID}:src/lib/markdown/render.ts`, {
      type: 'file',
      name: 'render.ts',
      filePath: 'src/lib/markdown/render.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/lib/markdown/render.ts:handler`, {
      filePath: 'src/lib/markdown/render.ts',
    })
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: '@orpc/server',
        targetSymbol: 'os',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'route',
        chainPath: 'os',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [fileNode, handlerNode], edges }))

    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })

  it('does not promote arbitrary member calls in files that import @orpc/server', () => {
    const fileNode = makeNode(`${REPO_ID}:src/lib/markdown/render.ts`, {
      type: 'file',
      name: 'render.ts',
      filePath: 'src/lib/markdown/render.ts',
    })
    const handlerNode = makeNode(`${REPO_ID}:src/lib/markdown/render.ts:renderMarkdown`, {
      filePath: 'src/lib/markdown/render.ts',
    })
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetSpecifier: '@orpc/server',
        targetSymbol: 'os',
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'prisma.renderJob',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [fileNode, handlerNode], edges }))

    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })
})

// ── REL-S09: global fetch medium confidence ───────────────

describe('REL-S09: global fetch + internal path → medium confidence', () => {
  it('fetch("/api/orders") no import anchor → api_call GET medium', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders.ts:fetchOrders`, { filePath: 'src/orders.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'fetch',
        chainPath: null,
        firstArg: '/api/orders',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('api_call')
    expect(result[0].target).toBe('/api/orders')
    expect(result[0].operation).toBe('GET')
    expect(result[0].canonicalTarget).toBe('GET /api/orders')
    expect(result[0].confidence).toBe('medium')
    expect(result[0].payload).toMatchObject({ adapter: 'fetch' })
  })

  it('new EventSource("/api/notifications/stream") resolves as a GET SSE api_call', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/notifications.ts:openStream`, { filePath: 'src/notifications.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'EventSource',
        chainPath: null,
        firstArg: '/api/notifications/stream',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/notifications/stream',
      operation: 'GET',
      canonicalTarget: 'GET /api/notifications/stream',
      confidence: 'high',
      payload: { adapter: 'eventsource', protocol: 'sse', anchor: 'browser_eventsource' },
    })
  })

  it('new Pusher channelAuthorization.endpoint resolves as a POST auth api_call', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/pusherClient.ts:pusher`, {
      type: 'variable',
      name: 'pusher',
      filePath: 'src/pusherClient.ts',
    })

    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSpecifier: 'pusher-js',
        targetSymbol: 'Pusher',
        chainPath: null,
        literalArgs: JSON.stringify([
          null,
          { cluster: 'ap2', channelAuthorization: { endpoint: '/api/pusher/auth', transport: 'ajax' } },
        ]),
        argExpressions: [
          { index: 0, kind: 'member', raw: 'import.meta.env.VITE_PUSHER_KEY', resolution: 'dynamic' },
          {
            index: 1,
            kind: 'object',
            raw: "{ cluster: 'ap2', channelAuthorization: { endpoint: '/api/pusher/auth', transport: 'ajax' } }",
            resolution: 'partial',
            properties: {
              cluster: { index: 0, kind: 'string', raw: "'ap2'", value: 'ap2', resolution: 'static' },
              channelAuthorization: {
                index: 1,
                kind: 'object',
                raw: "{ endpoint: '/api/pusher/auth', transport: 'ajax' }",
                resolution: 'partial',
                properties: {
                  endpoint: { index: 0, kind: 'string', raw: "'/api/pusher/auth'", value: '/api/pusher/auth', resolution: 'static' },
                  transport: { index: 1, kind: 'string', raw: "'ajax'", value: 'ajax', resolution: 'static' },
                },
              },
            },
          },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/pusher/auth',
      operation: 'POST',
      canonicalTarget: 'POST /api/pusher/auth',
      confidence: 'high',
      payload: { adapter: 'pusher_auth', anchor: 'pusher_channel_authorization' },
    })
  })

  it('new Ably.Realtime authUrl resolves as an auth api_call with configured method', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/ablyClient.ts:ably`, {
      type: 'variable',
      name: 'ably',
      filePath: 'src/ablyClient.ts',
    })

    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSpecifier: 'ably',
        targetSymbol: 'Realtime',
        chainPath: 'Ably',
        literalArgs: JSON.stringify([
          { authUrl: '/api/ably/token', authMethod: 'POST' },
        ]),
        argExpressions: [
          {
            index: 0,
            kind: 'object',
            raw: "{ authUrl: '/api/ably/token', authMethod: 'POST' }",
            resolution: 'partial',
            properties: {
              authUrl: { index: 0, kind: 'string', raw: "'/api/ably/token'", value: '/api/ably/token', resolution: 'static' },
              authMethod: { index: 1, kind: 'string', raw: "'POST'", value: 'POST', resolution: 'static' },
            },
          },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/ably/token',
      operation: 'POST',
      canonicalTarget: 'POST /api/ably/token',
      confidence: 'high',
      payload: { adapter: 'ably_auth', anchor: 'ably_auth_url' },
    })
  })

  it('new Ably.Realtime.Promise authUrl resolves as a GET auth api_call by default', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/ablyClient.ts:ably`, {
      type: 'variable',
      name: 'ably',
      filePath: 'src/ablyClient.ts',
    })

    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSpecifier: 'ably/promises',
        targetSymbol: 'Promise',
        chainPath: 'Ably.Realtime',
        literalArgs: JSON.stringify([
          { authUrl: '/api/ably/token' },
        ]),
        argExpressions: [
          {
            index: 0,
            kind: 'object',
            raw: "{ authUrl: '/api/ably/token' }",
            resolution: 'partial',
            properties: {
              authUrl: { index: 0, kind: 'string', raw: "'/api/ably/token'", value: '/api/ably/token', resolution: 'static' },
            },
          },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/ably/token',
      operation: 'GET',
      canonicalTarget: 'GET /api/ably/token',
      confidence: 'high',
      payload: { adapter: 'ably_auth', anchor: 'ably_auth_url' },
    })
  })

  it('fetch("/api/orders", { method: "POST" }) reads the request method from the options object', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders.ts:createOrder`, { filePath: 'src/orders.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'fetch',
        chainPath: null,
        firstArg: '/api/orders',
        targetId: null,
        argExpressions: [
          { index: 0, kind: 'string', value: '/api/orders', raw: "'/api/orders'" },
          {
            index: 1,
            kind: 'object',
            raw: "{ method: 'POST' }",
            properties: {
              method: { index: 0, kind: 'string', value: 'POST', raw: "'POST'" },
            },
          },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/orders',
      operation: 'POST',
      canonicalTarget: 'POST /api/orders',
      confidence: 'medium',
      payload: { adapter: 'fetch' },
    })
  })
})

// ── REL-N02: dynamic API target no-emit ──────────────────

describe('REL-N02: dynamic API target — no-emit', () => {
  it('fetch(url) unresolvable identifier → no api_call', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders.ts:doFetch`, { filePath: 'src/orders.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'fetch',
        chainPath: null,
        firstArg: 'url',  // identifier, no constant fallback
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })

  it('fetch(`${BASE_URL}/api/orders`) template literal → no api_call', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders.ts:doFetch2`, { filePath: 'src/orders.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'fetch',
        chainPath: null,
        firstArg: '${BASE_URL}/api/orders',  // template literal raw, not starting with /
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })

  it('fetch(`/api/${resource}`) dynamic resource segment → no api_call', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/reports.ts:loadDynamicReport`, { filePath: 'src/reports.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'fetch',
        chainPath: null,
        firstArg: '/api/${resource}',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })
})

// ── REL-N04: CommonJS require no import edge in MVP ──────

describe('REL-N04: CommonJS require without import edge — no-emit', () => {
  it('axios.post call with no imports edge stores no api_call', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/commonjs.ts:postOrder`, { filePath: 'src/commonjs.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'axios',
        firstArg: '/api/orders',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })
})

// ── REL-N17: external URL no api_call ────────────────────

describe('REL-N17: external full URL → no api_call', () => {
  it('fetch("https://api.stripe.com/v1/charges") → no api_call row', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/payment.ts:charge`, { filePath: 'src/payment.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'fetch',
        chainPath: null,
        firstArg: 'https://api.stripe.com/v1/charges',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))
    expect(result.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })
})

// ── REL-S03: constant fallback → medium ──────────────────

describe('REL-S03: graph-backed constant fallback', () => {
  it('axios.post(API_ROUTES.orders) + sourceFallback resolves → api_call medium', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/orders.ts:createOrder2`, { filePath: 'src/orders.ts' })

    const edges = [
      makeEdge(handlerNode.id, 'imports', {
        targetSpecifier: 'axios', targetSymbol: 'axios', targetId: null,
      }),
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'axios',
        firstArg: 'API_ROUTES.orders',  // identifier resolved by sourceFallback
        targetId: null,
      }),
    ]

    const result = runPipeline(
      makeInputs({ nodes: [handlerNode], edges }),
      { resolveConstant: ({ identifier }) => identifier === 'API_ROUTES.orders' ? '/api/orders' : null },
    )

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('api_call')
    expect(result[0].target).toBe('/api/orders')
    expect(result[0].operation).toBe('POST')
    expect(result[0].canonicalTarget).toBe('POST /api/orders')
    expect(result[0].confidence).toBe('medium')
  })
})

// ── REL-S15: form action ──────────────────────────────────

describe('REL-S15: form action', () => {
  it('<form action="/api/submit" method="POST"> renders edge → api_call POST form_action', () => {
    const componentNode = makeNode(`${REPO_ID}:src/form.tsx:SubmitForm`, { filePath: 'src/form.tsx' })

    const edges = [
      makeEdge(componentNode.id, 'renders', {
        targetSymbol: 'form',
        firstArg: '/api/submit',
        literalArgs: '["POST"]',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [componentNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('api_call')
    expect(result[0].target).toBe('/api/submit')
    expect(result[0].operation).toBe('POST')
    expect(result[0].canonicalTarget).toBe('POST /api/submit')
    expect(result[0].payload).toMatchObject({ protocol: 'form_action' })
  })
})

// ── REL-S16: React Query useMutation wrapper ──────────────

describe('REL-S16: React Query useMutation wrapping axios.post', () => {
  it('useMutation({ mutationFn: () => axios.post("/api/orders") }) → api_call POST high', () => {
    const componentNode = makeNode(`${REPO_ID}:src/orders.tsx:useCreateOrder`, { filePath: 'src/orders.tsx' })

    const edges = [
      makeEdge(componentNode.id, 'imports', {
        targetSpecifier: '@tanstack/react-query', targetSymbol: 'useMutation', targetId: null,
      }),
      makeEdge(componentNode.id, 'imports', {
        targetSpecifier: 'axios', targetSymbol: 'axios', targetId: null,
      }),
      // useMutation wrapper call (opaque wrapper, no URL)
      makeEdge(componentNode.id, 'calls', {
        targetSymbol: 'useMutation',
        chainPath: null,
        firstArg: null,
        targetId: null,
      }),
      // axios.post inside mutationFn callback — build_graph emits this as a separate calls edge
      makeEdge(componentNode.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'axios',
        firstArg: '/api/orders',
        targetId: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [componentNode], edges }))

    const rel = result.find((r) => r.kind === 'api_call' && r.target === '/api/orders')
    expect(rel).toBeDefined()
    expect(rel?.operation).toBe('POST')
    expect(rel?.confidence).toBe('high')
  })
})

describe('real project regressions: static prefix from template fetch', () => {
  it('fetch(`/api/athena/reports?${searchParams}`) emits GET /api/athena/reports medium', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/services/athenaService.ts:getReports`, {
      filePath: 'src/services/athenaService.ts',
    })
    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'fetch',
        firstArg: '/api/athena/reports?${searchParams}',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/athena/reports',
      operation: 'GET',
      canonicalTarget: 'GET /api/athena/reports',
      confidence: 'medium',
      payload: { anchor: 'global_fetch' },
    })
  })

  it('fetch(`/api/accounts/${accountId}`) preserves path parameter placeholders for backend route matching', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/accounts.ts:loadAccount`, {
      filePath: 'src/accounts.ts',
    })
    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'fetch',
        firstArg: '/api/accounts/${accountId}',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/accounts/:accountId',
      operation: 'GET',
      canonicalTarget: 'GET /api/accounts/:accountId',
      confidence: 'medium',
      payload: { anchor: 'global_fetch' },
    })
  })

  it('fetch("/api/channel-talk/member-hash") emits global fetch api_call', () => {
    const handlerNode = makeNode(`${REPO_ID}:src/context/ChannelTalkProvider.tsx:loadMemberHash`, {
      filePath: 'src/context/ChannelTalkProvider.tsx',
    })
    const edges = [
      makeEdge(handlerNode.id, 'calls', {
        targetSymbol: 'fetch',
        firstArg: '/api/channel-talk/member-hash',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/channel-talk/member-hash',
      operation: 'GET',
      confidence: 'medium',
      payload: { anchor: 'global_fetch' },
    })
  })
})
