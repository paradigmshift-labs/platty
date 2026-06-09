import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  API_CLIENT_PACKAGE_SET,
  AXIOS_API_CLIENT_PACKAGE_SET,
  DART_API_CLIENT_PACKAGE_SET,
  FUNCTION_STYLE_HTTP_CLIENT_PACKAGE_SET,
  GRAPHQL_CLIENT_PACKAGE_SET,
  JS_API_CLIENT_PACKAGE_SET,
  ORPC_CLIENT_PACKAGE_SET,
  ORPC_ROUTER_CLIENT_TYPE_PACKAGE_SET,
  REACT_QUERY_CLIENT_PACKAGE_SET,
  TRPC_CLIENT_PACKAGE_SET,
  isApiClientPackage,
  isAxiosApiClientPackage,
  isDartApiClientPackage,
  isFunctionStyleHttpClientPackage,
  isGraphQLClientPackage,
  isOrpcClientPackage,
  isReactQueryClientPackage,
  isTrpcClientPackage,
  isJsApiClientPackage,
  orpcClientAnchorForPackageSymbol,
} from '@/pipeline_modules/build_relations/adapters/api/packages.js'

const HTTP_CLIENT_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/api/http_clients.ts',
)
const HTTP_LIBRARY_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/api/http_libraries.ts',
)
const QUERY_HOOK_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/api/query_hooks.ts',
)
const TRPC_CLIENT_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/api/trpc_clients.ts',
)
const ORPC_CLIENT_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/api/orpc_clients.ts',
)
const AXIOS_INSTANCE_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/api/axios_instances.ts',
)
const GRAPHQL_CLIENT_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/api/graphql_clients.ts',
)
const SEMANTIC_INDEX_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/semantic_index.ts',
)

describe('API package registry', () => {
  it('owns JavaScript and Dart HTTP client package detection from one registry', () => {
    expect(isJsApiClientPackage('axios')).toBe(true)
    expect(isJsApiClientPackage('@nestjs/axios')).toBe(true)
    expect(isJsApiClientPackage('wretch')).toBe(true)
    expect(isDartApiClientPackage('package:dio/dio.dart')).toBe(true)
    expect(isDartApiClientPackage('package:http/http.dart')).toBe(true)
    expect(isApiClientPackage('@tanstack/react-query')).toBe(true)
    expect(isApiClientPackage('not-a-client')).toBe(false)
    expect(JS_API_CLIENT_PACKAGE_SET.has('axios')).toBe(true)
    expect(DART_API_CLIENT_PACKAGE_SET.has('dio')).toBe(true)
    expect(API_CLIENT_PACKAGE_SET.has('package:http/http.dart')).toBe(true)
  })

  it('owns function-style HTTP client package detection from the API registry', () => {
    expect(isFunctionStyleHttpClientPackage('ky')).toBe(true)
    expect(isFunctionStyleHttpClientPackage('got')).toBe(true)
    expect(isFunctionStyleHttpClientPackage('superagent')).toBe(true)
    expect(isFunctionStyleHttpClientPackage('axios')).toBe(false)
    expect(FUNCTION_STYLE_HTTP_CLIENT_PACKAGE_SET.has('ky')).toBe(true)
  })

  it('owns single-library and typed-client anchors through API registry helpers', () => {
    expect(isAxiosApiClientPackage('axios')).toBe(true)
    expect(isAxiosApiClientPackage('@nestjs/axios')).toBe(false)
    expect(AXIOS_API_CLIENT_PACKAGE_SET.has('axios')).toBe(true)
    expect(orpcClientAnchorForPackageSymbol('@orpc/client', 'createORPCClient')).toBe('@orpc/client')
    expect(orpcClientAnchorForPackageSymbol('@orpc/server', 'RouterClient')).toBe('@orpc/server:RouterClient')
    expect(orpcClientAnchorForPackageSymbol(null, 'RouterClient')).toBe('@orpc/server:RouterClient')
    expect(orpcClientAnchorForPackageSymbol('@orpc/server', 'os')).toBeNull()
    expect(ORPC_ROUTER_CLIENT_TYPE_PACKAGE_SET.has('@orpc/server')).toBe(true)
  })

  it('owns framework-specific API client package families from the API registry', () => {
    expect(isReactQueryClientPackage('@tanstack/react-query')).toBe(true)
    expect(isReactQueryClientPackage('react-query')).toBe(true)
    expect(isTrpcClientPackage('@trpc/react-query')).toBe(true)
    expect(isOrpcClientPackage('@orpc/client')).toBe(true)
    expect(isGraphQLClientPackage('@apollo/client')).toBe(true)
    expect(isGraphQLClientPackage('package:graphql_flutter/graphql_flutter.dart')).toBe(true)
    expect(REACT_QUERY_CLIENT_PACKAGE_SET.has('@tanstack/query-core')).toBe(true)
    expect(TRPC_CLIENT_PACKAGE_SET.has('@trpc/server')).toBe(true)
    expect(ORPC_CLIENT_PACKAGE_SET.has('@orpc/client')).toBe(true)
    expect(GRAPHQL_CLIENT_PACKAGE_SET.has('urql')).toBe(true)
  })

  it('keeps HTTP client adapter and semantic index delegated to the shared package registry', () => {
    const httpClientSource = readFileSync(HTTP_CLIENT_SOURCE_PATH, 'utf8')
    const httpLibrarySource = readFileSync(HTTP_LIBRARY_SOURCE_PATH, 'utf8')
    const queryHookSource = readFileSync(QUERY_HOOK_SOURCE_PATH, 'utf8')
    const trpcClientSource = readFileSync(TRPC_CLIENT_SOURCE_PATH, 'utf8')
    const orpcClientSource = readFileSync(ORPC_CLIENT_SOURCE_PATH, 'utf8')
    const axiosInstanceSource = readFileSync(AXIOS_INSTANCE_SOURCE_PATH, 'utf8')
    const graphQLClientSource = readFileSync(GRAPHQL_CLIENT_SOURCE_PATH, 'utf8')
    const semanticIndexSource = readFileSync(SEMANTIC_INDEX_SOURCE_PATH, 'utf8')

    expect(httpClientSource).toContain('isJsApiClientPackage')
    expect(httpClientSource).toContain('isDartApiClientPackage')
    expect(httpClientSource).toContain('JS_API_CLIENT_PACKAGES')
    expect(httpLibrarySource).toContain('isFunctionStyleHttpClientPackage')
    expect(queryHookSource).toContain('isReactQueryClientPackage')
    expect(trpcClientSource).toContain('isTrpcClientPackage')
    expect(orpcClientSource).toContain('orpcClientAnchorForPackageSymbol')
    expect(axiosInstanceSource).toContain('isAxiosApiClientPackage')
    expect(graphQLClientSource).toContain('isGraphQLClientPackage')
    expect(semanticIndexSource).toContain('isApiClientPackage')
    expect(httpClientSource).not.toContain('API_CLIENT_PKGS')
    expect(httpClientSource).not.toContain('DART_HTTP_CLIENT_PKGS')
    expect(httpLibrarySource).not.toContain('const LIBRARIES')
    expect(queryHookSource).not.toContain('REACT_QUERY_PACKAGES')
    expect(trpcClientSource).not.toContain('TRPC_PACKAGES')
    expect(orpcClientSource).not.toContain('ORPC_CLIENT_PACKAGES')
    expect(orpcClientSource).not.toContain("targetSpecifier === '@orpc/server'")
    expect(orpcClientSource).not.toContain("targetSpecifier === '@orpc/client'")
    expect(axiosInstanceSource).not.toContain("targetSpecifier === 'axios'")
    expect(graphQLClientSource).not.toContain('GRAPHQL_PACKAGES')
    expect(semanticIndexSource).not.toContain('API_CLIENT_PACKAGES')
  })
})
