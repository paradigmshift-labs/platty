import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { getReceiverRoot, traceReceiverIdentity } from '../../graph_trace/receiver_identity.js'
import { isKnexPackage } from './packages.js'

const KNEX_METHODS: Record<string, string> = {
  select: 'select',
  first: 'select',
  insert: 'insert',
  update: 'update',
  delete: 'delete',
  del: 'delete',
}

const DYNAMIC_CHAIN_RE = /\[/
const TX_ALIAS_RE = /^(tx|trx|t|transaction)$/

export const knexDbAdapter: RelationCandidateAdapter = {
  name: 'knex',
  relationKind: 'db_access',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    const chainPath = edge.chainPath ?? ''
    if (!method || !chainPath) return null
    const operation = KNEX_METHODS[method]
    if (!operation) return null
    if (DYNAMIC_CHAIN_RE.test(chainPath)) return null

    const identity = traceReceiverIdentity({
      nodeId: sourceNodeId,
      chainPath,
      index: context.index,
      maxHops: context.maxTraceHops,
    })
    if (identity && (identity.kind !== 'db_client' || identity.orm !== 'knex')) return null
    if (!identity && !hasKnexEvidence(sourceNodeId, context.index)) return null

    const root = getReceiverRoot(chainPath)
    if (root && TX_ALIAS_RE.test(root) && !hasTransactionCallEvidence(sourceNodeId, context.index)) return null

    const tableName = extractTableName(chainPath, edge.firstArg)
    if (!tableName) return null

    return {
      kind: 'db_access',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`, ...(identity?.evidence.map(formatEvidence) ?? [])],
      receiver: chainPath,
      targetSymbol: method,
      chainPath,
      firstArg: edge.firstArg,
      payload: {
        orm: 'knex',
        method: operation,
        adapter: 'knex',
        modelName: tableName,
        traceHops: identity?.hops ?? 0,
        receiverRoot: root,
      },
    }
  },
}

function extractTableName(chainPath: string, firstArg: string | null | undefined): string | null {
  const tableCall = chainPath.match(/\btable\(([^)]+)\)/)?.[1]
  if (tableCall) return cleanTableName(tableCall)
  const callable = chainPath.match(/^[A-Za-z_$][\w$]*\(([^)]+)\)/)?.[1]
  if (callable) return cleanTableName(callable)
  return cleanTableName(firstArg)
}

function cleanTableName(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^(table|tableName|model|entity|target)$/i.test(trimmed)) return null
  const identifier = trimmed.match(/^([A-Za-z_][\w]*)$/)?.[1]
  if (identifier) return identifier
  const quoted = trimmed.match(/^['"`]([A-Za-z_][\w]*)['"`]$/)?.[1]
  return quoted ?? null
}

function hasKnexEvidence(nodeId: string, index: SemanticIndex): boolean {
  for (const id of nodeAndParentIds(nodeId, index)) {
    if ((index.importsBySource.get(id) ?? []).some((edge) => isKnexPackage(edge.targetSpecifier))) return true
    if ((index.typeRefsBySource.get(id) ?? []).some((edge) =>
      isKnexPackage(edge.targetSpecifier) || /Knex/.test(edge.targetSymbol ?? '')
    )) return true
  }

  const node = index.nodesById.get(nodeId)
  if (!node) return false
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if ((index.importsBySource.get(fileNode.id) ?? []).some((edge) => isKnexPackage(edge.targetSpecifier))) return true
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
