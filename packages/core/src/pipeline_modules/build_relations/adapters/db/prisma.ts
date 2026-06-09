import type { CodeEdgeLike, RelationCandidate } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { getReceiverRoot, traceReceiverIdentity } from '../../graph_trace/receiver_identity.js'
import { detectStaticMemberDbClientOrm } from '../../db_client_evidence.js'

// Exported so the G2 built-in DATA rule (builtin_db_rules.ts) is provably DERIVED from this imperative
// source — the dual-run measurement compares the data-path output to this adapter's, so they must share
// the method surface. Removing/adding a prisma method here flows into the data rule.
export const PRISMA_METHODS = new Set([
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'upsertMany',
  'delete',
  'deleteMany',
  '$queryRaw',
  '$executeRaw',
  'queryRaw',
  'transaction',
])

const DYNAMIC_CHAIN_RE = /\[/

export const prismaDbAdapter: RelationCandidateAdapter = {
  name: 'prisma',
  relationKind: 'db_access',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    const chainPath = edge.chainPath ?? ''
    if (!method || !chainPath) return null
    if (!PRISMA_METHODS.has(method)) return null
    if (DYNAMIC_CHAIN_RE.test(chainPath)) return null

    const staticMemberOrm = detectStaticMemberDbClientOrm(chainPath, context.index)
    const identity = traceReceiverIdentity({
      nodeId: sourceNodeId,
      chainPath,
      index: context.index,
      maxHops: context.maxTraceHops,
    })
    if (identity && (identity.kind !== 'db_client' || identity.orm !== 'prisma')) return null
    if (!identity && staticMemberOrm !== 'prisma') return null

    return {
      kind: 'db_access',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`, ...(identity?.evidence.map(formatEvidence) ?? [])],
      receiver: chainPath,
      targetSymbol: method,
      chainPath,
      firstArg: edge.firstArg,
      payload: {
        orm: 'prisma',
        method,
        adapter: 'prisma',
        traceHops: identity?.hops ?? 0,
        receiverRoot: getReceiverRoot(chainPath),
      },
    }
  },
}

function formatEvidence(evidence: { nodeId?: string; edgeId?: number; reason: string }): string {
  if (evidence.edgeId != null) return `edge:${evidence.edgeId}:${evidence.reason}`
  if (evidence.nodeId) return `node:${evidence.nodeId}:${evidence.reason}`
  return evidence.reason
}
