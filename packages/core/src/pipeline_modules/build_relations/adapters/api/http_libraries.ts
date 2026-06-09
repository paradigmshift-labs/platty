import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { isFunctionStyleHttpClientPackage } from './packages.js'

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
const INTERNAL_PATH_RE = /^\/[^/]/
const EXTERNAL_URL_RE = /^https?:\/\//

export const httpLibraryApiAdapter: RelationCandidateAdapter = {
  name: 'http_library',
  relationKind: 'api_call',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    if (!method) return null

    const callableLibrary = edge.chainPath ? null : detectImportedLibrary(sourceNodeId, method, context.index)
    if (callableLibrary) {
      return makeCandidate(edge, sourceNodeId, callableLibrary, 'UNKNOWN')
    }

    if (!HTTP_METHODS.has(method.toLowerCase())) return null
    const chainPath = edge.chainPath ?? ''
    const receiver = chainPath.replace(/^this\./, '').split('.')[0]
    const anchoredLibrary = detectImportedLibrary(sourceNodeId, receiver, context.index)
    if (!anchoredLibrary) return null
    return makeCandidate(edge, sourceNodeId, anchoredLibrary, method.toUpperCase())
  },
}

function makeCandidate(
  edge: CodeEdgeLike,
  sourceNodeId: string,
  anchor: string,
  method: string,
): RelationCandidate | null {
  const rawTarget = edge.firstArg
  if (!rawTarget || EXTERNAL_URL_RE.test(rawTarget) || !INTERNAL_PATH_RE.test(rawTarget)) return null
  return {
    kind: 'api_call',
    sourceNodeId,
    evidenceNodeIds: [`edge:${edge.id}`],
    chainPath: edge.chainPath,
    firstArg: rawTarget,
    rawTarget,
    payload: { method, protocol: 'rest', anchor, adapter: 'http_library' },
  }
}

function detectImportedLibrary(nodeId: string, symbol: string | null | undefined, index: SemanticIndex): string | null {
  if (!isFunctionStyleHttpClientPackage(symbol)) return null
  for (const id of nodeAndFileNodeIds(nodeId, index)) {
    for (const imp of index.importsBySource.get(id) ?? []) {
      if (imp.targetSpecifier === symbol) return symbol
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
