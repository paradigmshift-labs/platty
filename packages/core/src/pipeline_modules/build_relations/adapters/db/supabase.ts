import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { getReceiverRoot, traceReceiverIdentity } from '../../graph_trace/receiver_identity.js'
import { isSupabaseDbPackage } from './packages.js'

const SUPABASE_DB_METHODS: Record<string, string> = {
  select: 'select',
  insert: 'insert',
  update: 'update',
  upsert: 'upsert',
  delete: 'delete',
}

const DYNAMIC_CHAIN_RE = /\[/

export const supabaseDbAdapter: RelationCandidateAdapter = {
  name: 'supabase',
  relationKind: 'db_access',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    const chainPath = edge.chainPath ?? ''
    if (!method || !chainPath) return null
    const effectiveMethod = SUPABASE_DB_METHODS[method]
    if (!effectiveMethod) return null
    if (!/\bfrom\(/.test(chainPath)) return null
    if (DYNAMIC_CHAIN_RE.test(chainPath)) return null

    const identity = traceReceiverIdentity({
      nodeId: sourceNodeId,
      chainPath,
      index: context.index,
      maxHops: context.maxTraceHops,
    })
    if (identity && (identity.kind !== 'db_client' || identity.orm !== 'supabase')) return null
    if (!identity && !hasSupabaseEvidence(sourceNodeId, context.index)) return null

    const builderCall = findSupabaseFromBuilderCall(edge, sourceNodeId, context.index)
    const tableName = extractTableName(chainPath) ?? cleanTableName(builderCall?.firstArg)
    if (!tableName) return null

    return {
      kind: 'db_access',
      sourceNodeId,
      evidenceNodeIds: [
        `edge:${edge.id}`,
        ...(builderCall ? [`edge:${builderCall.id}`] : []),
        ...(identity?.evidence.map(formatEvidence) ?? []),
      ],
      receiver: chainPath,
      targetSymbol: method,
      chainPath,
      firstArg: edge.firstArg,
      payload: {
        orm: 'supabase',
        method: effectiveMethod,
        adapter: 'supabase',
        modelName: tableName,
        traceHops: identity?.hops ?? 0,
        receiverRoot: getReceiverRoot(chainPath),
      },
    }
  },
}

function findSupabaseFromBuilderCall(
  edge: CodeEdgeLike,
  sourceNodeId: string,
  index: SemanticIndex,
): CodeEdgeLike | null {
  if (!edge.chainPath || !/\bfrom\(\)/.test(edge.chainPath)) return null
  const receiverPrefix = edge.chainPath.replace(/\.from\(\).*$/, '')
  return (index.callsBySource.get(sourceNodeId) ?? [])
    .find((call) =>
      call.targetSymbol === 'from' &&
      call.firstArg != null &&
      (call.chainPath ?? '') === receiverPrefix,
    ) ?? null
}

function extractTableName(chainPath: string): string | null {
  const arg = chainPath.match(/\bfrom\(([^)]+)\)/)?.[1]
  return cleanTableName(arg)
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

function hasSupabaseEvidence(nodeId: string, index: SemanticIndex): boolean {
  for (const id of nodeAndParentIds(nodeId, index)) {
    if ((index.importsBySource.get(id) ?? []).some((edge) => isSupabaseDbPackage(edge.targetSpecifier))) return true
    if ((index.typeRefsBySource.get(id) ?? []).some((edge) => isSupabaseDbPackage(edge.targetSpecifier))) return true
  }

  const node = index.nodesById.get(nodeId)
  if (!node) return false
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if ((index.importsBySource.get(fileNode.id) ?? []).some((edge) => isSupabaseDbPackage(edge.targetSpecifier))) return true
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
