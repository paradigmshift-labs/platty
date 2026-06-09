import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { isAxiosApiClientPackage } from './packages.js'

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request'])
const INTERNAL_PATH_RE = /^\/[^/]/
const API_RELATIVE_PATH_RE = /^(?:v\d+(?:\.\d+)?|api|graphql|rest)(?:\/|$)/
const EXTERNAL_URL_RE = /^https?:\/\//

export const axiosInstanceApiAdapter: RelationCandidateAdapter = {
  name: 'axios_instance',
  relationKind: 'api_call',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    const chainPath = edge.chainPath ?? ''
    if (!method || !chainPath) return null
    if (!HTTP_METHODS.has(method.toLowerCase())) return null

    const baseURL = findAxiosBaseUrl(sourceNodeId, chainPath, context.index)
    if (!baseURL) return null

    const config = method === 'request' ? parseRequestConfig(edge.literalArgs) : null
    const rawPath = config?.url ?? edge.firstArg
    if (!rawPath || EXTERNAL_URL_RE.test(rawPath)) return null
    if (!INTERNAL_PATH_RE.test(rawPath) && !API_RELATIVE_PATH_RE.test(rawPath) && !isStaticIdentifier(rawPath)) return null

    const effectiveMethod = (config?.method ?? method).toUpperCase()
    const rawTarget = INTERNAL_PATH_RE.test(rawPath)
      ? joinPaths(baseURL, rawPath)
      : API_RELATIVE_PATH_RE.test(rawPath)
        ? `/${rawPath.replace(/^\/+/, '')}`
        : rawPath

    return {
      kind: 'api_call',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`],
      chainPath,
      firstArg: rawPath,
      rawTarget,
      payload: {
        method: effectiveMethod,
        protocol: 'rest',
        anchor: 'axios',
        adapter: 'axios_instance',
        baseURL,
        ...(method === 'request' && { configMethod: true }),
      },
    }
  },
}

function findAxiosBaseUrl(nodeId: string, chainPath: string, index: SemanticIndex): string | null {
  for (const id of nodeAndFileNodeIds(nodeId, index)) {
    if (!hasAxiosImport(id, index)) continue
    for (const call of index.callsBySource.get(id) ?? []) {
      if (call.targetSymbol !== 'create') continue
      if ((call.chainPath ?? '') !== 'axios') continue
      const baseURL = parseCreateBaseUrl(call.literalArgs)
      if (baseURL) return baseURL
    }
  }

  const importedReceiverNodeId = findImportedReceiverNodeId(nodeId, chainPath, index)
  if (!importedReceiverNodeId) return null
  for (const id of nodeAndFileNodeIds(importedReceiverNodeId, index)) {
    if (!hasAxiosImport(id, index)) continue
    for (const call of index.callsBySource.get(id) ?? []) {
      if (call.targetSymbol !== 'create') continue
      if ((call.chainPath ?? '') !== 'axios') continue
      const baseURL = parseCreateBaseUrl(call.literalArgs)
      if (baseURL) return baseURL
    }
  }

  return null
}

function findImportedReceiverNodeId(nodeId: string, chainPath: string, index: SemanticIndex): string | null {
  const receiver = chainPath.replace(/^this\./, '').split('.')[0]
  if (!receiver) return null

  for (const id of nodeAndFileNodeIds(nodeId, index)) {
    for (const imp of index.importsBySource.get(id) ?? []) {
      if (imp.targetSymbol === receiver && imp.targetId) return imp.targetId
    }
  }
  return null
}

function hasAxiosImport(nodeId: string, index: SemanticIndex): boolean {
  for (const id of nodeAndFileNodeIds(nodeId, index)) {
    if ((index.importsBySource.get(id) ?? []).some((edge) => isAxiosApiClientPackage(edge.targetSpecifier))) return true
  }
  return false
}

function parseCreateBaseUrl(literalArgs: string | null | undefined): string | null {
  const first = parseFirstObject(literalArgs)
  const baseURL = first?.baseURL
  if (typeof baseURL === 'string' && INTERNAL_PATH_RE.test(baseURL)) return baseURL
  return first && Object.hasOwn(first, 'baseURL') ? 'unknown' : null
}

function parseRequestConfig(literalArgs: string | null | undefined): { url?: string; method?: string } | null {
  const first = parseFirstObject(literalArgs)
  if (!first) return null
  const url = typeof first.url === 'string' ? first.url : undefined
  const method = typeof first.method === 'string' ? first.method : undefined
  return { url, method }
}

function parseFirstObject(literalArgs: string | null | undefined): Record<string, unknown> | null {
  if (!literalArgs) return null
  try {
    const args = JSON.parse(literalArgs) as unknown
    if (!Array.isArray(args)) return null
    const first = args[0]
    if (!first || typeof first !== 'object' || Array.isArray(first)) return null
    return first as Record<string, unknown>
  } catch {
    return null
  }
}

function joinPaths(baseURL: string, path: string): string {
  if (!INTERNAL_PATH_RE.test(baseURL)) return path
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function isStaticIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(value)
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
