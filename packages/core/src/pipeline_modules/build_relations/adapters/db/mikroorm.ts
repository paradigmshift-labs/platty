import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { getReceiverRoot, traceReceiverIdentity } from '../../graph_trace/receiver_identity.js'
import { isMikroOrmPackage } from './packages.js'

const MIKRO_METHODS: Record<string, string> = {
  find: 'find',
  findOne: 'findOne',
  findAll: 'findAll',
  count: 'count',
  persist: 'persist',
  persistAndFlush: 'persistAndFlush',
  insert: 'insert',
  nativeInsert: 'nativeInsert',
  update: 'update',
  nativeUpdate: 'nativeUpdate',
  upsert: 'upsert',
  remove: 'remove',
  removeAndFlush: 'removeAndFlush',
  nativeDelete: 'nativeDelete',
}

const DYNAMIC_CHAIN_RE = /\[/

export const mikroOrmDbAdapter: RelationCandidateAdapter = {
  name: 'mikroorm',
  relationKind: 'db_access',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    const chainPath = edge.chainPath ?? ''
    if (!method || !chainPath) return null
    const effectiveMethod = MIKRO_METHODS[method]
    if (!effectiveMethod) return null
    if (DYNAMIC_CHAIN_RE.test(chainPath)) return null
    if (isDynamicRepositoryFactory(chainPath)) return null

    const identity = traceReceiverIdentity({
      nodeId: sourceNodeId,
      chainPath,
      index: context.index,
      maxHops: context.maxTraceHops,
    })
    if (identity && (identity.kind !== 'db_client' || identity.orm !== 'mikroorm')) return null
    if (!identity && !hasMikroOrmEvidence(sourceNodeId, context.index)) return null

    const modelName = inferModelName(edge, sourceNodeId, context.index)
    if (!modelName) return null

    return {
      kind: 'db_access',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`, ...(identity?.evidence.map(formatEvidence) ?? [])],
      receiver: chainPath,
      targetSymbol: method,
      chainPath,
      firstArg: edge.firstArg ?? modelName,
      payload: {
        orm: 'mikroorm',
        method: effectiveMethod,
        adapter: 'mikroorm',
        modelName,
        traceHops: identity?.hops ?? 0,
        receiverRoot: getReceiverRoot(chainPath),
      },
    }
  },
}

function inferModelName(edge: CodeEdgeLike, nodeId: string, index: SemanticIndex): string | null {
  const chainPath = edge.chainPath ?? ''
  const factoryModel = extractFactoryModel(chainPath)
  if (factoryModel) return factoryModel

  const generic = findGenericModel(nodeId, index)
  if (generic) return generic

  const fromArg = cleanModelName(edge.firstArg)
  if (fromArg) return fromArg

  const root = getReceiverRoot(chainPath)
  const repositoryStem = root?.match(/^([A-Za-z_$][\w$]*?)(?:Repository|Repo)$/)?.[1]
  if (repositoryStem) return repositoryStem.charAt(0).toUpperCase() + repositoryStem.slice(1)
  return null
}

function extractFactoryModel(chainPath: string): string | null {
  const match = chainPath.match(/\bgetRepository\(([^)]+)\)/)
  return cleanModelName(match?.[1])
}

function findGenericModel(nodeId: string, index: SemanticIndex): string | null {
  for (const id of nodeAndParentIds(nodeId, index)) {
    for (const ref of index.typeRefsBySource.get(id) ?? []) {
      const match = ref.targetSymbol?.match(/\bEntityRepository<\s*([A-Za-z_$][\w$]*)\s*>/)
      const modelName = cleanModelName(match?.[1])
      if (modelName) return modelName
    }
  }
  return null
}

function cleanModelName(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const newExpression = trimmed.match(/^new\s+([A-Z][A-Za-z0-9_$]*)\s*\(/)?.[1]
  if (newExpression) return newExpression
  const propertyName = trimmed.match(/^([A-Za-z_$][\w$]*)\.name$/)?.[1]
  if (propertyName) return propertyName
  const identifier = trimmed.match(/^([A-Z][A-Za-z0-9_$]*)$/)?.[1]
  return identifier ?? null
}

function isDynamicRepositoryFactory(chainPath: string): boolean {
  const match = chainPath.match(/\bgetRepository\(([^)]+)\)/)
  if (!match) return false
  return cleanModelName(match[1]) == null
}

function hasMikroOrmEvidence(nodeId: string, index: SemanticIndex): boolean {
  for (const id of nodeAndParentIds(nodeId, index)) {
    if ((index.importsBySource.get(id) ?? []).some((edge) => isMikroOrmPackage(edge.targetSpecifier))) return true
    if ((index.typeRefsBySource.get(id) ?? []).some((edge) =>
      isMikroOrmPackage(edge.targetSpecifier) || /EntityManager|EntityRepository</.test(edge.targetSymbol ?? '')
    )) return true
  }

  const node = index.nodesById.get(nodeId)
  if (!node) return false
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if ((index.importsBySource.get(fileNode.id) ?? []).some((edge) => isMikroOrmPackage(edge.targetSpecifier))) return true
  }
  return false
}

function nodeAndParentIds(nodeId: string, index: SemanticIndex): string[] {
  const ids = [nodeId]
  const parentId = index.containsParentByChild.get(nodeId)
  if (parentId) ids.push(parentId)
  return ids
}

function formatEvidence(evidence: { nodeId?: string; edgeId?: number; reason: string }): string {
  if (evidence.edgeId != null) return `edge:${evidence.edgeId}:${evidence.reason}`
  if (evidence.nodeId) return `node:${evidence.nodeId}:${evidence.reason}`
  return evidence.reason
}
