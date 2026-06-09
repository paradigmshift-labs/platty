import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { isSqflitePackage } from './packages.js'

const SQFLITE_METHODS: Record<string, string> = {
  query: 'select',
  rawQuery: 'select',
  insert: 'insert',
  rawInsert: 'insert',
  update: 'update',
  rawUpdate: 'update',
  delete: 'delete',
  rawDelete: 'delete',
  execute: 'execute',
}

export const sqfliteDbAdapter: RelationCandidateAdapter = {
  name: 'sqflite',
  relationKind: 'db_access',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    if (!method) return null
    const effectiveMethod = SQFLITE_METHODS[method]
    if (!effectiveMethod) return null
    if (!hasSqfliteEvidence(sourceNodeId, context.index)) return null

    const tableName = method.startsWith('raw')
      ? tableNameFromSql(edge.firstArg)
      : cleanTableName(edge.firstArg)
    if (!tableName) return null

    return {
      kind: 'db_access',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`],
      receiver: edge.chainPath,
      targetSymbol: method,
      chainPath: edge.chainPath,
      firstArg: edge.firstArg,
      payload: {
        orm: 'sqflite',
        method: effectiveMethod,
        adapter: 'sqflite',
        modelName: tableName,
        receiverRoot: receiverRoot(edge.chainPath),
      },
    }
  },
}

function tableNameFromSql(value: string | null | undefined): string | null {
  if (!value) return null
  const sql = value.trim().replace(/^['"`]|['"`]$/g, '')
  const match = sql.match(/\b(?:from|into|update|delete\s+from)\s+([A-Za-z_][\w]*)\b/i)
  return cleanTableName(match?.[1])
}

function cleanTableName(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().replace(/^['"`]|['"`]$/g, '')
  if (/^(table|tableName|model|entity|target)$/i.test(trimmed)) return null
  return trimmed.match(/^([A-Za-z_][\w]*)$/)?.[1] ?? null
}

function receiverRoot(chainPath: string | null | undefined): string | null {
  if (!chainPath) return null
  return chainPath.split(/[.(]/)[0] || null
}

function hasSqfliteEvidence(nodeId: string, index: SemanticIndex): boolean {
  for (const id of nodeAndParentIds(nodeId, index)) {
    if ((index.importsBySource.get(id) ?? []).some((edge) => isSqflitePackage(edge.targetSpecifier))) return true
    if ((index.typeRefsBySource.get(id) ?? []).some((edge) => isSqflitePackage(edge.targetSpecifier))) return true
  }

  const node = index.nodesById.get(nodeId)
  if (!node) return false
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if ((index.importsBySource.get(fileNode.id) ?? []).some((edge) => isSqflitePackage(edge.targetSpecifier))) return true
  }
  return false
}

function nodeAndParentIds(nodeId: string, index: SemanticIndex): string[] {
  const ids = [nodeId]
  const parentId = index.containsParentByChild.get(nodeId)
  if (parentId) ids.push(parentId)
  return ids
}
