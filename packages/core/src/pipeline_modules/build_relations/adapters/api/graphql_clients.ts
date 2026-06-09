import type { CallArgExpression, CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { isGraphQLClientPackage } from './packages.js'

export const graphQLClientApiAdapter: RelationCandidateAdapter = {
  name: 'graphql_client',
  relationKind: 'api_call',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    if (!method) return null

    const anchor = findGraphQLAnchor(sourceNodeId, context.index)
    if (!anchor) return null

    if (anchor === 'graphql-request' && method === 'request') {
      const operation = extractOperationFromDocument(extractGraphQLRequestDocument(edge))
      if (!operation) return null
      return makeCandidate(edge, sourceNodeId, anchor, operation.kind, `graphql:${operation.name}`, operation.name)
    }

    if (anchor === 'graphql_flutter' || anchor === 'package:graphql_flutter/graphql_flutter.dart') {
      if (method === 'query' || method === 'Query') {
        const operationTarget = extractGraphQLFlutterOperationTarget(edge, 'query')
        if (!operationTarget) return null
        return makeCandidate(edge, sourceNodeId, anchor, 'query', operationTarget.rawTarget, operationTarget.operationName)
      }

      if (method === 'mutate' || method === 'Mutation') {
        const operationTarget = extractGraphQLFlutterOperationTarget(edge, 'mutation')
        if (!operationTarget) return null
        return makeCandidate(edge, sourceNodeId, anchor, 'mutation', operationTarget.rawTarget, operationTarget.operationName)
      }

      if (method === 'subscribe' || method === 'Subscription') {
        const operationTarget = extractGraphQLFlutterOperationTarget(edge, 'subscription')
        if (!operationTarget) return null
        return makeCandidate(edge, sourceNodeId, anchor, 'subscription', operationTarget.rawTarget, operationTarget.operationName)
      }
    }

    if (anchor === '@apollo/client' || anchor === 'urql') {
      if (method === 'query' || method === 'mutate') {
        const operationKind = method === 'mutate' ? 'mutation' : 'query'
        const operationName = extractOperationFromObject(asCallArgExpressions(edge.argExpressions), operationKind)
        if (!operationName) return null
        return makeCandidate(edge, sourceNodeId, anchor, operationKind, `graphql:${operationName}`, operationName)
      }

      if (method === 'useQuery' || method === 'useLazyQuery' || method === 'useSuspenseQuery') {
        const operationTarget = extractOperationTargetFromArg(edge, 'query')
        if (!operationTarget) return null
        return makeCandidate(edge, sourceNodeId, anchor, 'query', operationTarget.rawTarget, operationTarget.operationName)
      }

      if (method === 'useMutation') {
        const operationTarget = extractOperationTargetFromArg(edge, 'mutation')
        if (!operationTarget) return null
        return makeCandidate(edge, sourceNodeId, anchor, 'mutation', operationTarget.rawTarget, operationTarget.operationName)
      }

      if (method === 'useSubscription') {
        const operationTarget = extractOperationTargetFromArg(edge, 'subscription')
        if (!operationTarget) return null
        return makeCandidate(edge, sourceNodeId, anchor, 'subscription', operationTarget.rawTarget, operationTarget.operationName)
      }

      if (method === 'subscribeToMore') {
        const operationTarget = extractOperationTargetFromArg(edge, 'subscription')
        if (!operationTarget) return null
        return makeCandidate(edge, sourceNodeId, anchor, 'subscription', operationTarget.rawTarget, operationTarget.operationName)
      }
    }

    return null
  },
}

function makeCandidate(
  edge: CodeEdgeLike,
  sourceNodeId: string,
  anchor: string,
  operationKind: GraphQLOperationKind,
  rawTarget: string,
  operationName?: string | null,
): RelationCandidate {
  const operation = graphQLOperationMethod(operationKind)
  return {
    kind: 'api_call',
    sourceNodeId,
    evidenceNodeIds: [`edge:${edge.id}`],
    chainPath: edge.chainPath,
    firstArg: edge.firstArg,
    rawTarget,
    payload: {
      method: operation,
      protocol: 'graphql',
      anchor,
      adapter: 'graphql_client',
      ...(operationName ? { operationName } : {}),
    },
  }
}

type GraphQLOperationKind = 'query' | 'mutation' | 'subscription'

function extractOperationFromDocument(document: string | null | undefined): { kind: GraphQLOperationKind; name: string } | null {
  if (!document) return null
  const match = document.match(/\b(query|mutation|subscription)\s+([A-Za-z_][\w]*)/)
  if (!match) return null
  return { kind: match[1] as GraphQLOperationKind, name: match[2] }
}

function extractGraphQLRequestDocument(edge: CodeEdgeLike): string | null {
  if (edge.firstArg && /\b(query|mutation|subscription)\s+/.test(edge.firstArg)) return edge.firstArg
  const args = asCallArgExpressions(edge.argExpressions)
  const documentArg = args?.find((arg) => arg.index === 1)
  return extractStaticGraphQLDocument(documentArg)
}

function extractStaticGraphQLDocument(arg: CallArgExpression | null | undefined): string | null {
  if (!arg) return null
  if (typeof arg.value === 'string') return arg.value
  if (typeof arg.staticPattern === 'string') return arg.staticPattern
  return extractStaticGraphQLDocument(arg.resolved)
}

function extractOperationTargetFromArg(
  edge: CodeEdgeLike,
  operationKind: GraphQLOperationKind,
): { rawTarget: string; operationName?: string | null } | null {
  const documentArg = asCallArgExpressions(edge.argExpressions)?.find((arg) => arg.index === 0)
  const operation = extractOperationFromDocument(extractStaticGraphQLDocument(documentArg) ?? extractGraphQLDocumentFromHookObject(documentArg))
  if (operation && operation.kind === operationKind) {
    return { rawTarget: `graphql:${operation.name}`, operationName: operation.name }
  }
  const identifierArg = documentArg?.kind === 'object'
    ? documentArg.properties?.['query'] ?? documentArg.properties?.['document']
    : documentArg
  if (identifierArg?.kind === 'identifier' || identifierArg?.kind === 'member') {
    return { rawTarget: identifierArg.raw }
  }
  return null
}

function graphQLOperationMethod(operationKind: GraphQLOperationKind): string {
  if (operationKind === 'mutation') return 'GRAPHQL_MUTATION'
  if (operationKind === 'subscription') return 'GRAPHQL_SUBSCRIPTION'
  return 'GRAPHQL_QUERY'
}

function extractGraphQLDocumentFromHookObject(arg: CallArgExpression | null | undefined): string | null {
  if (arg?.kind !== 'object') return null
  return extractStaticGraphQLDocument(arg.properties?.['query'])
    ?? extractStaticGraphQLDocument(arg.properties?.['document'])
}

function extractGraphQLFlutterOperationTarget(
  edge: CodeEdgeLike,
  operationKind: GraphQLOperationKind,
): { rawTarget: string; operationName?: string | null } | null {
  const args = asCallArgExpressions(edge.argExpressions) ?? []
  const rawParts = [
    ...args.map((arg) => arg.raw),
    edge.firstArg,
  ].filter((part): part is string => typeof part === 'string' && part.length > 0)

  for (const raw of rawParts) {
    const documentOrIdentifier = extractGraphQLFlutterDocumentOrIdentifier(raw)
    if (!documentOrIdentifier) continue
    const operation = extractOperationFromDocument(documentOrIdentifier)
    if (operation) {
      if (operation.kind !== operationKind) return null
      return { rawTarget: `graphql:${operation.name}`, operationName: operation.name }
    }
    return { rawTarget: documentOrIdentifier }
  }

  return null
}

function extractGraphQLFlutterDocumentOrIdentifier(raw: string): string | null {
  const fromGql = raw.match(/\bgql\s*\(\s*(r?'''[\s\S]*?'''|r?"""[\s\S]*?"""|r?'(?:\\.|[^'])*'|r?"(?:\\.|[^"])*"|[A-Za-z_$][\w$]*)/s)?.[1]
  const source = fromGql ?? raw
  const document = cleanGraphQLFlutterStringLiteral(source)
  if (document) return document
  return source.match(/^([A-Za-z_$][\w$]*)$/)?.[1] ?? null
}

function cleanGraphQLFlutterStringLiteral(raw: string): string | null {
  const trimmed = raw.trim().replace(/,+$/, '').trim()
  const triple = trimmed.match(/^r?(['"]{3})([\s\S]*)\1$/)
  if (triple?.[2]) return triple[2]
  const quoted = trimmed.match(/^r?(['"])([\s\S]*)\1$/)
  return quoted?.[2] ?? null
}

function extractOperationFromObject(
  argExpressions: CallArgExpression[] | null | undefined,
  property: 'query' | 'mutation',
): string | null {
  const objectArg = argExpressions?.find((arg) => arg.index === 0 && arg.kind === 'object')
  const propertyArg = objectArg?.properties?.[property]
  if (propertyArg?.kind === 'identifier') return propertyArg.raw
  if (propertyArg?.kind === 'member') return propertyArg.raw.split('.').at(-1) ?? propertyArg.raw

  const raw = objectArg?.raw
  if (!raw) return null
  const match = raw.match(new RegExp(`\\b${property}\\s*:\\s*([A-Za-z_][\\w]*)`))
  return match?.[1] ?? null
}

function asCallArgExpressions(value: unknown): CallArgExpression[] | null {
  return Array.isArray(value) ? value as CallArgExpression[] : null
}

function findGraphQLAnchor(nodeId: string, index: SemanticIndex): string | null {
  for (const id of nodeAndFileNodeIds(nodeId, index)) {
    for (const imp of index.importsBySource.get(id) ?? []) {
      if (isGraphQLClientPackage(imp.targetSpecifier)) return imp.targetSpecifier
    }
  }
  return null
}

function nodeAndFileNodeIds(nodeId: string, index: SemanticIndex): string[] {
  const ids = [nodeId]
  const node = index.nodesById.get(nodeId)
  if (!node) return ids
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if (fileNode.id !== nodeId) ids.push(fileNode.id)
  }
  return ids
}
