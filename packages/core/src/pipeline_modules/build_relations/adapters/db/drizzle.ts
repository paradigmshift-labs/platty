import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { getReceiverRoot, traceReceiverIdentity } from '../../graph_trace/receiver_identity.js'

const DRIZZLE_METHODS = new Set([
  'from',
  'insert',
  'update',
  'delete',
  'execute',
  'findMany',
  'findFirst',
])

const DYNAMIC_CHAIN_RE = /\[/
const TX_ALIAS_RE = /^(tx|trx|t|transaction)$/

export const drizzleDbAdapter: RelationCandidateAdapter = {
  name: 'drizzle',
  relationKind: 'db_access',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    const chainPath = edge.chainPath ?? ''
    if (!method || !chainPath) return null
    if (!DRIZZLE_METHODS.has(method)) return null
    if (DYNAMIC_CHAIN_RE.test(chainPath)) return null

    const identity = traceReceiverIdentity({
      nodeId: sourceNodeId,
      chainPath,
      index: context.index,
      maxHops: context.maxTraceHops,
    })
    if (identity && (identity.kind !== 'db_client' || identity.orm !== 'drizzle')) return null
    if (!identity && !hasDrizzleEvidence(sourceNodeId, context.index)) return null

    const root = getReceiverRoot(chainPath)
    if (root && TX_ALIAS_RE.test(root) && !hasTransactionCallEvidence(sourceNodeId, context.index)) return null

    const modelName = inferTableName(edge, sourceNodeId, context.index)
    if (!modelName) return null

    return {
      kind: 'db_access',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`, ...(identity?.evidence.map(formatEvidence) ?? [])],
      receiver: chainPath,
      targetSymbol: method,
      chainPath,
      firstArg: edge.firstArg,
      payload: {
        orm: 'drizzle',
        method: effectiveMethod(method),
        adapter: 'drizzle',
        modelName,
        traceHops: identity?.hops ?? 0,
        receiverRoot: root,
      },
    }
  },
}

function effectiveMethod(method: string): string {
  if (method === 'from' || method === 'findMany' || method === 'findFirst') return 'select'
  return method
}

function inferTableName(edge: CodeEdgeLike, sourceNodeId: string, index: SemanticIndex): string | null {
  const chainPath = edge.chainPath ?? ''
  const relationalTable = chainPath.match(/\bquery\.([A-Za-z_$][\w$]*)$/)?.[1]
  if (relationalTable) return relationalTable
  const firstArgTable = cleanTableName(edge.firstArg)
  if (firstArgTable) return firstArgTable
  return inferOnlyTableDependency(sourceNodeId, index)
}

function cleanTableName(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^(table|model|entity|schema|target)$/i.test(trimmed)) return null
  const identifier = trimmed.match(/^([A-Za-z_$][\w$]*)$/)?.[1]
  if (identifier) return identifier
  const propertyName = trimmed.match(/^schema\.([A-Za-z_$][\w$]*)$/)?.[1]
  if (propertyName) return propertyName
  const quoted = trimmed.match(/^['"`]([A-Za-z_][\w]*)['"`]$/)?.[1]
  return quoted ?? null
}

function inferOnlyTableDependency(sourceNodeId: string, index: SemanticIndex): string | null {
  const names = new Set<string>()
  for (const edge of index.edgesBySource.get(sourceNodeId) ?? []) {
    if (edge.relation !== 'depends_on' || !edge.targetId) continue
    const target = index.nodesById.get(edge.targetId)
    if (!target || target.type !== 'variable') continue
    const modelTable = index.modelTablesByModelLower.get(target.name.toLowerCase())
    if (modelTable) names.add(modelTable)
    else names.add(target.name)
  }
  return names.size === 1 ? [...names][0] : null
}

function hasDrizzleEvidence(nodeId: string, index: SemanticIndex): boolean {
  for (const id of nodeAndParentIds(nodeId, index)) {
    if ((index.importsBySource.get(id) ?? []).some((edge) => edge.targetSpecifier?.includes('drizzle'))) return true
    if ((index.typeRefsBySource.get(id) ?? []).some((edge) =>
      edge.targetSpecifier?.includes('drizzle') || /Drizzle|NodePgDatabase/.test(edge.targetSymbol ?? '')
    )) return true
  }

  const node = index.nodesById.get(nodeId)
  if (!node) return false
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if ((index.importsBySource.get(fileNode.id) ?? []).some((edge) => edge.targetSpecifier?.includes('drizzle'))) return true
  }
  return false
}

function hasTransactionCallEvidence(nodeId: string, index: SemanticIndex): boolean {
  return (index.callsBySource.get(nodeId) ?? []).some((call) => call.targetSymbol === 'transaction')
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
