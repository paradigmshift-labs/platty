import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { orpcClientAnchorForPackageSymbol } from './packages.js'

const ORPC_CLIENT_RECEIVERS = new Set(['client', 'api', 'rpc', 'orpc', 'w'])

export const orpcClientApiAdapter: RelationCandidateAdapter = {
  name: 'orpc_client',
  relationKind: 'api_call',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const chainPath = edge.chainPath ?? ''
    if (!edge.targetSymbol || !chainPath) return null

    const anchor = findOrpcAnchor(sourceNodeId, context.index)
    if (!anchor) return null

    const procedurePath = extractProcedurePath(chainPath, edge.targetSymbol)
    if (!procedurePath) return null

    const rawTarget = `orpc:${procedurePath}`
    return {
      kind: 'api_call',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`],
      chainPath,
      firstArg: edge.firstArg,
      rawTarget,
      payload: {
        method: 'ORPC_CALL',
        protocol: 'orpc',
        anchor,
        adapter: 'orpc_client',
        procedurePath,
      },
    }
  },
}

function extractProcedurePath(chainPath: string, targetSymbol: string): string | null {
  const effectiveChainPath = chainPath.endsWith(`.${targetSymbol}`) ? chainPath : `${chainPath}.${targetSymbol}`
  const parts = effectiveChainPath.replace(/^this\./, '').split('.').filter(Boolean)
  if (parts.length < 2) return null
  const receiver = parts[0]
  if (!receiver || !ORPC_CLIENT_RECEIVERS.has(receiver)) return null
  const procedureParts = parts.slice(1)
  return procedureParts.length >= 2 ? procedureParts.join('.') : null
}

function findOrpcAnchor(nodeId: string, index: SemanticIndex): string | null {
  for (const id of nodeAndFileNodeIds(nodeId, index)) {
    for (const imp of index.importsBySource.get(id) ?? []) {
      const anchor = orpcClientAnchorForPackageSymbol(imp.targetSpecifier, imp.targetSymbol)
      if (anchor) return anchor
    }
    for (const typeRef of index.typeRefsBySource.get(id) ?? []) {
      const anchor = orpcClientAnchorForPackageSymbol(typeRef.targetSpecifier, typeRef.targetSymbol)
      if (anchor) return anchor
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
