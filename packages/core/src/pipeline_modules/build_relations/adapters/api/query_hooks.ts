import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { isReactQueryClientPackage } from './packages.js'

const INTERNAL_PATH_RE = /^\/[^/]/

export const queryHookApiAdapter: RelationCandidateAdapter = {
  name: 'query_hooks',
  relationKind: 'api_call',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    if (!method) return null

    if (method === 'useSWR') {
      if (!hasPackageImport(sourceNodeId, 'swr', context.index)) return null
      const rawTarget = extractSWRTarget(edge)
      if (!rawTarget) return null
      return makeCandidate(edge, sourceNodeId, rawTarget, 'swr', 'swr')
    }

    if (method === 'useQuery' || method === 'useInfiniteQuery') {
      const anchor = findReactQueryAnchor(sourceNodeId, context.index)
      if (!anchor) return null
      const parsed = extractReactQueryTarget(edge)
      if (!parsed?.target) return null
      return makeCandidate(edge, sourceNodeId, parsed.target, anchor, 'react_query', parsed.hasQueryFn)
    }

    return null
  },
}

function makeCandidate(
  edge: CodeEdgeLike,
  sourceNodeId: string,
  rawTarget: string,
  anchor: string,
  adapter: 'react_query' | 'swr',
  hasQueryFn = false,
): RelationCandidate {
  return {
    kind: 'api_call',
    sourceNodeId,
    evidenceNodeIds: [`edge:${edge.id}`],
    chainPath: edge.chainPath,
    firstArg: rawTarget,
    rawTarget,
    payload: {
      method: 'GET',
      protocol: 'rest',
      anchor,
      adapter,
      ...(hasQueryFn && { queryFn: true }),
    },
  }
}

function extractSWRTarget(edge: CodeEdgeLike): string | null {
  if (edge.firstArg && INTERNAL_PATH_RE.test(edge.firstArg)) return edge.firstArg
  const args = parseLiteralArgs(edge.literalArgs)
  return extractPathFromValue(args?.[0])
}

function extractReactQueryTarget(edge: CodeEdgeLike): { target: string; hasQueryFn: boolean } | null {
  const args = parseLiteralArgs(edge.literalArgs)
  if (!args) return edge.firstArg && INTERNAL_PATH_RE.test(edge.firstArg)
    ? { target: edge.firstArg, hasQueryFn: false }
    : null

  const first = args[0]
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const obj = first as Record<string, unknown>
    const target = extractPathFromValue(obj.queryKey)
    return target ? { target, hasQueryFn: Object.prototype.hasOwnProperty.call(obj, 'queryFn') } : null
  }

  const target = extractPathFromValue(first)
  return target ? { target, hasQueryFn: args.length > 1 } : null
}

function extractPathFromValue(value: unknown): string | null {
  if (typeof value === 'string' && INTERNAL_PATH_RE.test(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const path = extractPathFromValue(item)
      if (path) return path
    }
  }
  return null
}

function parseLiteralArgs(literalArgs: string | null | undefined): unknown[] | null {
  if (!literalArgs) return null
  try {
    const parsed = JSON.parse(literalArgs) as unknown
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function findReactQueryAnchor(nodeId: string, index: SemanticIndex): string | null {
  for (const id of nodeAndFileNodeIds(nodeId, index)) {
    for (const imp of index.importsBySource.get(id) ?? []) {
      if (isReactQueryClientPackage(imp.targetSpecifier)) return imp.targetSpecifier
    }
  }
  return null
}

function hasPackageImport(nodeId: string, packageName: string, index: SemanticIndex): boolean {
  return nodeAndFileNodeIds(nodeId, index).some((id) =>
    (index.importsBySource.get(id) ?? []).some((imp) => imp.targetSpecifier === packageName),
  )
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
