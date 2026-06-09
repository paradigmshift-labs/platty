import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { getReceiverRoot, traceReceiverIdentity } from '../../graph_trace/receiver_identity.js'
import { detectStaticMemberDbClientOrm } from '../../db_client_evidence.js'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { isKyselyPackage } from './packages.js'

const KYSELY_METHODS: Record<string, string> = {
  selectFrom: 'select',
  insertInto: 'insert',
  updateTable: 'update',
  deleteFrom: 'delete',
}

const DYNAMIC_CHAIN_RE = /\[/
const TX_ALIAS_RE = /^(tx|trx|t|transaction)$/

export const kyselyDbAdapter: RelationCandidateAdapter = {
  name: 'kysely',
  relationKind: 'db_access',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    const chainPath = edge.chainPath ?? ''
    if (!method || !chainPath) return null
    const operation = KYSELY_METHODS[method]
    if (!operation) return null
    if (DYNAMIC_CHAIN_RE.test(chainPath)) return null

    const root = getReceiverRoot(chainPath)
    const staticMemberOrm = detectStaticMemberDbClientOrm(chainPath, context.index)
    const isStaticKysely = staticMemberOrm === 'kysely'
    const isTransactionAlias = !!root && TX_ALIAS_RE.test(root)
    const hasKyselyAnchor = hasKyselyEvidence(sourceNodeId, context.index, context.inputs?.repoPath ?? undefined)
    const hasTransactionAnchor = hasTransactionCallEvidence(sourceNodeId, context.index) || hasKyselyAnchor
    const identity = traceReceiverIdentity({
      nodeId: sourceNodeId,
      chainPath,
      index: context.index,
      maxHops: context.maxTraceHops,
    })
    if (identity && (identity.kind !== 'db_client' || identity.orm !== 'kysely')) return null
    if (!identity && !isStaticKysely && !(isTransactionAlias && hasTransactionAnchor) && !hasKyselyAnchor) return null

    if (isTransactionAlias && !hasTransactionAnchor) return null

    const tableName = cleanTableName(edge.firstArg)
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
        orm: 'kysely',
        method: operation,
        adapter: 'kysely',
        modelName: tableName,
        traceHops: identity?.hops ?? 0,
        receiverRoot: root,
      },
    }
  },
}

function cleanTableName(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().replace(/^['"`]|['"`]$/g, '')
  if (/^(table|tableName|model|entity|target)$/i.test(trimmed)) return null
  const withoutAlias = trimmed.split(/\s+as\s+/i)[0]?.trim() ?? trimmed
  if (!withoutAlias) return null
  const identifier = trimmed.match(/^([A-Za-z_][\w.]*)$/)?.[1]
  if (identifier) return identifier.split('.')[0] ?? identifier
  const aliasedIdentifier = withoutAlias.match(/^([A-Za-z_][\w.]*)$/)?.[1]
  if (aliasedIdentifier) return aliasedIdentifier.split('.')[0] ?? aliasedIdentifier
  return null
}

function hasKyselyEvidence(nodeId: string, index: SemanticIndex, repoPath?: string): boolean {
  for (const id of nodeAndParentIds(nodeId, index)) {
    if ((index.importsBySource.get(id) ?? []).some((edge) => isKyselyPackage(edge.targetSpecifier))) return true
    if ((index.typeRefsBySource.get(id) ?? []).some((edge) =>
      isKyselyPackage(edge.targetSpecifier) || /Kysely/.test(edge.targetSymbol ?? '')
    )) return true
  }

  const node = index.nodesById.get(nodeId)
  if (!node) return false
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if ((index.importsBySource.get(fileNode.id) ?? []).some((edge) => isKyselyPackage(edge.targetSpecifier))) return true
  }
  if (repoPath && sourceImportsKysely(repoPath, node.filePath)) return true
  return false
}

function sourceImportsKysely(repoPath: string, filePath: string): boolean {
  const root = resolve(repoPath)
  const fullPath = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath)
  const rel = relative(root, fullPath)
  if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(fullPath)) return false

  try {
    return /\bimport\s+[^'"]*\b(?:Kysely|Transaction|sql)\b[^'"]*\s+from\s+['"]kysely['"]/.test(readFileSync(fullPath, 'utf8'))
  } catch {
    return false
  }
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
