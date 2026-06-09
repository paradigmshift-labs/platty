import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { getReceiverRoot, traceReceiverIdentity } from '../../graph_trace/receiver_identity.js'
import { createSourceFallback } from '../../source_fallback.js'
import { resolveFirstArgFromGraphArgExpressions, resolveFirstArgsFromSource } from '../../source_call_args.js'
import { isRedisPackage } from './packages.js'

const REDIS_METHODS: Record<string, string> = {
  get: 'get',
  mget: 'mget',
  exists: 'exists',
  ttl: 'ttl',
  set: 'set',
  setex: 'setex',
  hset: 'hset',
  zadd: 'zadd',
  rpush: 'rpush',
  lpush: 'lpush',
  incr: 'incr',
  decr: 'decr',
  expire: 'expire',
  del: 'del',
  hdel: 'hdel',
  zrem: 'zrem',
}

const DYNAMIC_CHAIN_RE = /\[/

export const redisDbAdapter: RelationCandidateAdapter = {
  name: 'redis',
  relationKind: 'db_access',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    const chainPath = edge.chainPath ?? ''
    if (!method || !chainPath) return null
    const effectiveMethod = REDIS_METHODS[method]
    if (!effectiveMethod) return null
    if (DYNAMIC_CHAIN_RE.test(chainPath)) return null

    const key = resolveRedisKey(edge, sourceNodeId, context)
    if (key.hadArg && !key.value) return null

    const identity = traceReceiverIdentity({
      nodeId: sourceNodeId,
      chainPath,
      index: context.index,
      maxHops: context.maxTraceHops,
    })
    if (identity && (identity.kind !== 'db_client' || identity.orm !== 'redis')) return null
    if (!identity && !hasRedisEvidence(sourceNodeId, context.index)) return null

    return {
      kind: 'db_access',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`, ...key.evidenceNodeIds, ...(identity?.evidence.map(formatEvidence) ?? [])],
      receiver: chainPath,
      targetSymbol: method,
      chainPath,
      firstArg: key.value ?? edge.firstArg,
      payload: {
        orm: 'redis',
        method: effectiveMethod,
        adapter: 'redis',
        traceHops: identity?.hops ?? 0,
        receiverRoot: getReceiverRoot(chainPath),
      },
    }
  },
}

export function isOpaqueRedisKey(value: string | null | undefined): boolean {
  return value != null && normalizeRedisKey(value) == null
}

function normalizeRedisKey(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const unquoted = trimmed.match(/^['"`](.*)['"`]$/)?.[1] ?? trimmed
  const templatePrefix = unquoted.match(/^([A-Za-z_][\w-]*):\$\{[^}]+\}/)?.[1]
  if (templatePrefix) return `${templatePrefix}:*`
  if (/^[A-Za-z_][\w-]*:[^:]+/.test(unquoted)) return unquoted
  if (/^(session|cache|user|users|profile|leaderboard|token|auth|rate_limit)$/.test(unquoted)) return unquoted
  return null
}

function resolveRedisKey(
  edge: CodeEdgeLike,
  sourceNodeId: string,
  context: RelationAdapterContext,
): { value: string | null; hadArg: boolean; evidenceNodeIds: string[] } {
  const rawArgs = new Set<string>()
  if (edge.firstArg) rawArgs.add(edge.firstArg)

  const inputs = context.inputs
  const sourceNode = context.index.nodesById.get(sourceNodeId)
  if (inputs && sourceNode) {
    const graphArg = resolveFirstArgFromGraphArgExpressions(edge, inputs, sourceNode)
    if (graphArg) rawArgs.add(graphArg)
    for (const sourceArg of resolveFirstArgsFromSource(inputs, sourceNode, edge)) {
      rawArgs.add(sourceArg)
    }
  }

  for (const rawArg of rawArgs) {
    const normalized = normalizeRedisKey(rawArg)
    if (normalized) return { value: normalized, hadArg: true, evidenceNodeIds: [] }

    const constant = resolveRedisKeyConstant(rawArg, sourceNodeId, context)
    const normalizedConstant = normalizeRedisKey(constant)
    if (normalizedConstant) {
      return {
        value: normalizedConstant,
        hadArg: true,
        evidenceNodeIds: [`node:${sourceNodeId}:redis_key_constant`],
      }
    }
  }

  return { value: null, hadArg: rawArgs.size > 0, evidenceNodeIds: [] }
}

function resolveRedisKeyConstant(
  rawArg: string,
  sourceNodeId: string,
  context: RelationAdapterContext,
): string | null {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(rawArg)) return null
  const inputs = context.inputs
  const sourceNode = context.index.nodesById.get(sourceNodeId)
  if (!inputs?.repoPath || !sourceNode?.filePath) return null

  const fallback = createSourceFallback(inputs.repoPath)
  return fallback.resolveConstant({
    identifier: rawArg,
    nodeId: sourceNodeId,
    filePath: sourceNode.filePath,
    allowedScopes: ['event'],
  })
}

function hasRedisEvidence(nodeId: string, index: SemanticIndex): boolean {
  for (const id of nodeAndParentIds(nodeId, index)) {
    if ((index.importsBySource.get(id) ?? []).some((edge) => isRedisPackage(edge.targetSpecifier))) return true
    if ((index.typeRefsBySource.get(id) ?? []).some((edge) =>
      isRedisPackage(edge.targetSpecifier) || /Redis|IORedis/.test(edge.targetSymbol ?? '')
    )) return true
  }

  const node = index.nodesById.get(nodeId)
  if (!node) return false
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if ((index.importsBySource.get(fileNode.id) ?? []).some((edge) => isRedisPackage(edge.targetSpecifier))) return true
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
