export const JS_API_CLIENT_PACKAGES = [
  'axios',
  '@nestjs/axios',
  'got',
  'superagent',
  'node-fetch',
  'cross-fetch',
  'isomorphic-fetch',
  'ky',
  'wretch',
  '@tanstack/react-query',
  'react-query',
  'swr',
  '@tanstack/query-core',
  '@trpc/client',
  '@apollo/client',
  'graphql-request',
  '@orpc/client',
  '@orpc/server',
] as const

export const DART_API_CLIENT_PACKAGES = [
  'package:dio/dio.dart',
  'dio',
  'package:http/http.dart',
  'http',
] as const

// JVM HTTP client TYPE names (matched against a DI'd field's resolved typeName, not an import symbol).
// Scoped to the RestTemplate family for this increment — its verbs (getForObject/postForEntity/…) all take
// the URL as the first argument. Fluent clients (WebClient/RestClient .get().uri()) and builder clients
// (OkHttp/Retrofit) have different call shapes and are a follow-on (spec §10c).
export const JVM_API_CLIENT_TYPES = [
  'RestTemplate',
  'TestRestTemplate',
] as const

export const JVM_API_CLIENT_TYPE_SET = new Set<string>(JVM_API_CLIENT_TYPES)

export function isJvmApiClientType(typeName: string | null | undefined): boolean {
  return Boolean(typeName && JVM_API_CLIENT_TYPE_SET.has(typeName))
}

// JS/TS named HTTP-client TYPES injected as DI fields — the receiver is `this.<field>` typed as one of these,
// not a direct import. E.g. NestJS `@nestjs/axios` HttpService. A bounded data list (the JVM_API_CLIENT_TYPES
// analog) a new client type extends — NOT repo-specific. Used to resolve a DI-field receiver against its
// declared type when the import package was (or was not) captured by build_graph.
export const JS_API_CLIENT_TYPES = [
  'HttpService',
] as const

export const JS_API_CLIENT_TYPE_SET = new Set<string>(JS_API_CLIENT_TYPES)

/** A named HTTP-client type (JS HttpService / JVM RestTemplate family) — for DI-field receiver resolution. */
export function isApiClientType(typeName: string | null | undefined): boolean {
  return Boolean(typeName && (JS_API_CLIENT_TYPE_SET.has(typeName) || JVM_API_CLIENT_TYPE_SET.has(typeName)))
}

export const FUNCTION_STYLE_HTTP_CLIENT_PACKAGES = [
  'ky',
  'got',
  'superagent',
] as const

export const AXIOS_API_CLIENT_PACKAGES = [
  'axios',
] as const

export const REACT_QUERY_CLIENT_PACKAGES = [
  '@tanstack/react-query',
  'react-query',
  '@tanstack/query-core',
] as const

export const TRPC_CLIENT_PACKAGES = [
  '@trpc/client',
  '@trpc/react-query',
  '@trpc/server',
] as const

export const ORPC_CLIENT_PACKAGES = [
  '@orpc/client',
] as const

export const ORPC_ROUTER_CLIENT_TYPE_PACKAGES = [
  '@orpc/server',
] as const

export const GRAPHQL_CLIENT_PACKAGES = [
  '@apollo/client',
  'graphql-request',
  'urql',
  'graphql_flutter',
  'package:graphql_flutter/graphql_flutter.dart',
] as const

export const JS_API_CLIENT_PACKAGE_SET = new Set<string>(JS_API_CLIENT_PACKAGES)
export const DART_API_CLIENT_PACKAGE_SET = new Set<string>(DART_API_CLIENT_PACKAGES)
export const FUNCTION_STYLE_HTTP_CLIENT_PACKAGE_SET = new Set<string>(FUNCTION_STYLE_HTTP_CLIENT_PACKAGES)
export const AXIOS_API_CLIENT_PACKAGE_SET = new Set<string>(AXIOS_API_CLIENT_PACKAGES)
export const REACT_QUERY_CLIENT_PACKAGE_SET = new Set<string>(REACT_QUERY_CLIENT_PACKAGES)
export const TRPC_CLIENT_PACKAGE_SET = new Set<string>(TRPC_CLIENT_PACKAGES)
export const ORPC_CLIENT_PACKAGE_SET = new Set<string>(ORPC_CLIENT_PACKAGES)
export const ORPC_ROUTER_CLIENT_TYPE_PACKAGE_SET = new Set<string>(ORPC_ROUTER_CLIENT_TYPE_PACKAGES)
export const GRAPHQL_CLIENT_PACKAGE_SET = new Set<string>(GRAPHQL_CLIENT_PACKAGES)
export const API_CLIENT_PACKAGE_SET = new Set<string>([
  ...JS_API_CLIENT_PACKAGES,
  ...DART_API_CLIENT_PACKAGES,
])

export function isJsApiClientPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && JS_API_CLIENT_PACKAGE_SET.has(pkg))
}

export function isDartApiClientPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && DART_API_CLIENT_PACKAGE_SET.has(pkg))
}

export function isApiClientPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && API_CLIENT_PACKAGE_SET.has(pkg))
}

export function isFunctionStyleHttpClientPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && FUNCTION_STYLE_HTTP_CLIENT_PACKAGE_SET.has(pkg))
}

export function isAxiosApiClientPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && AXIOS_API_CLIENT_PACKAGE_SET.has(pkg))
}

export function isReactQueryClientPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && REACT_QUERY_CLIENT_PACKAGE_SET.has(pkg))
}

export function isTrpcClientPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && TRPC_CLIENT_PACKAGE_SET.has(pkg))
}

export function isOrpcClientPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && ORPC_CLIENT_PACKAGE_SET.has(pkg))
}

export function orpcClientAnchorForPackageSymbol(
  pkg: string | null | undefined,
  symbol: string | null | undefined,
): string | null {
  if (isOrpcClientPackage(pkg)) return pkg ?? null
  if (pkg && ORPC_ROUTER_CLIENT_TYPE_PACKAGE_SET.has(pkg) && symbol === 'RouterClient') {
    return `${pkg}:RouterClient`
  }
  if (!pkg && symbol === 'RouterClient') return '@orpc/server:RouterClient'
  return null
}

export function isGraphQLClientPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && GRAPHQL_CLIENT_PACKAGE_SET.has(pkg))
}
