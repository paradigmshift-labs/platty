import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { isTrpcClientPackage } from './packages.js'

const TRPC_METHODS: Record<string, string> = {
  query: 'TRPC_QUERY',
  useQuery: 'TRPC_QUERY',
  mutate: 'TRPC_MUTATION',
  mutation: 'TRPC_MUTATION',
  useMutation: 'TRPC_MUTATION',
}

export const trpcClientApiAdapter: RelationCandidateAdapter = {
  name: 'trpc_client',
  relationKind: 'api_call',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    const chainPath = edge.chainPath ?? ''
    if (!method || !chainPath) return null
    const operation = TRPC_METHODS[method]
    if (!operation) return null

    const anchor = findTrpcAnchor(sourceNodeId, context.index)
    if (!anchor) return null

    const procedurePath = extractProcedurePath(chainPath)
    if (!procedurePath) return null

    const rawTarget = `trpc:${procedurePath}`
    return {
      kind: 'api_call',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`],
      chainPath,
      firstArg: edge.firstArg,
      rawTarget,
      payload: {
        method: operation,
        protocol: 'trpc',
        anchor,
        adapter: 'trpc_client',
        procedurePath,
      },
    }
  },
}

function extractProcedurePath(chainPath: string): string | null {
  const parts = chainPath.replace(/^this\./, '').split('.').filter(Boolean)
  if (parts.length < 2) return null
  const receiver = parts[0]
  if (!/^(trpc|api|client)$/.test(receiver)) return null
  const procedureParts = parts.slice(1)
  return procedureParts.length > 0 ? procedureParts.join('.') : null
}

function findTrpcAnchor(nodeId: string, index: SemanticIndex): string | null {
  for (const id of nodeAndFileNodeIds(nodeId, index)) {
    for (const imp of index.importsBySource.get(id) ?? []) {
      if (isTrpcClientPackage(imp.targetSpecifier)) return imp.targetSpecifier
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
