import type { CallArgExpression } from '@/pipeline_modules/build_graph/types.js'
import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'

const DRIFT_BUILDER_METHODS = new Set(['select', 'into', 'update', 'delete'])
const DRIFT_TERMINAL_METHODS = new Set([
  'get',
  'watch',
  'getSingle',
  'getSingleOrNull',
  'insert',
  'insertOnConflictUpdate',
  'insertReturning',
  'insertReturningOrNull',
  'replace',
  'write',
  'delete',
])

export const driftDbAdapter: RelationCandidateAdapter = {
  name: 'drift',
  relationKind: 'db_access',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    if (!method) return null
    if (!DRIFT_BUILDER_METHODS.has(method) && !DRIFT_TERMINAL_METHODS.has(method)) return null
    if (!hasDriftEvidence(sourceNodeId, context.index)) return null

    const modelName = inferDriftTableModel(edge)
    if (!modelName) return null

    return {
      kind: 'db_access',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`],
      receiver: edge.chainPath,
      targetSymbol: method,
      chainPath: edge.chainPath,
      firstArg: edge.firstArg,
      argExpressions: readArgExpressions(edge.argExpressions),
      payload: {
        orm: 'drift',
        method: effectiveMethod(method),
        adapter: 'drift',
        modelName,
        receiverRoot: receiverRoot(edge.chainPath),
      },
    }
  },
}

function effectiveMethod(method: string): string {
  if (method === 'select' || method === 'get' || method === 'watch' || method.startsWith('getSingle')) return 'select'
  if (method === 'into' || method.startsWith('insert')) return 'insert'
  if (method === 'replace' || method === 'write') return 'update'
  return method
}

function inferDriftTableModel(edge: CodeEdgeLike): string | null {
  const method = edge.targetSymbol ?? ''

  if (DRIFT_BUILDER_METHODS.has(method)) {
    return toPascalCaseIdentifier(cleanIdentifier(edge.firstArg) ?? firstArgIdentifier(readArgExpressions(edge.argExpressions)))
  }

  const fromChain = tableIdentifierFromChain(edge.chainPath)
  return toPascalCaseIdentifier(fromChain ?? cleanIdentifier(edge.firstArg) ?? firstArgIdentifier(readArgExpressions(edge.argExpressions)))
}

function readArgExpressions(value: unknown): CallArgExpression[] | null {
  return Array.isArray(value) ? value as CallArgExpression[] : null
}

function tableIdentifierFromChain(chainPath: string | null | undefined): string | null {
  if (!chainPath) return null
  const match = chainPath.match(/\b(?:select|into|update|delete)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/)
  return match?.[1] ?? null
}

function firstArgIdentifier(argExpressions: CallArgExpression[] | null | undefined): string | null {
  const first = argExpressions?.find((arg) => arg.index === 0) ?? argExpressions?.[0]
  if (!first) return null
  return cleanIdentifier(first.raw)
}

function cleanIdentifier(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const identifier = trimmed.match(/^([A-Za-z_$][\w$]*)$/)?.[1]
  return identifier ?? null
}

function toPascalCaseIdentifier(value: string | null): string | null {
  if (!value) return null
  const cleaned = value.replace(/^[^A-Za-z_]+|[^A-Za-z0-9_$]+$/g, '')
  if (!cleaned) return null
  return cleaned[0]!.toUpperCase() + cleaned.slice(1)
}

function receiverRoot(chainPath: string | null | undefined): string | null {
  if (!chainPath) return null
  return chainPath.split(/[.(]/)[0] || null
}

function hasDriftEvidence(nodeId: string, index: SemanticIndex): boolean {
  for (const id of nodeAndParentIds(nodeId, index)) {
    if ((index.importsBySource.get(id) ?? []).some((edge) => edge.targetSpecifier?.includes('drift'))) return true
    if ((index.typeRefsBySource.get(id) ?? []).some((edge) =>
      edge.targetSpecifier?.includes('drift') || /(?:Table|Column|GeneratedColumn|DriftDatabase)/.test(edge.targetSymbol ?? '')
    )) return true
  }

  const node = index.nodesById.get(nodeId)
  if (!node) return false
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if ((index.importsBySource.get(fileNode.id) ?? []).some((edge) => edge.targetSpecifier?.includes('drift'))) return true
    if ((index.extendsBySource.get(fileNode.id) ?? []).some((edge) => edge.targetSymbol === 'Table')) return true
  }
  return false
}

function nodeAndParentIds(nodeId: string, index: SemanticIndex): string[] {
  const ids = [nodeId]
  const parentId = index.containsParentByChild.get(nodeId)
  if (parentId) ids.push(parentId)
  return ids
}
