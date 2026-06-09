import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../../types.js'
import { traceReceiverIdentity } from '../../../graph_trace/receiver_identity.js'
import { isSupabaseRealtimePackage } from './realtime_packages.js'
import type { RealtimeBroker, RealtimeEventFamily } from './realtime_types.js'
import {
  isRecord,
  normalizeMemberChainPath,
  parseLiteralArgs,
  sourceIdsForNode,
} from './realtime_utils.js'

export const supabaseRealtimeFamily: RealtimeEventFamily = {
  broker: 'supabase_realtime',
  detectBroker: detectSupabaseRealtimeBroker,
  extractCandidate: supabaseRealtimeCandidate,
}

function detectSupabaseRealtimeBroker(nodeId: string, index: SemanticIndex): RealtimeBroker | null {
  return (index.callsBySource.get(nodeId) ?? []).some((call) =>
    call.targetSymbol === 'on' &&
    call.firstArg === 'postgres_changes' &&
    extractSupabaseRealtimeTarget(call) != null,
  )
    ? 'supabase_realtime'
    : null
}

function supabaseRealtimeCandidate(
  sourceNodeId: string,
  call: CodeEdgeLike,
  index: SemanticIndex,
): RelationCandidate | null {
  if (call.targetSymbol !== 'on' || call.firstArg !== 'postgres_changes') return null
  const target = extractSupabaseRealtimeTarget(call)
  if (!target || !isSupabaseRealtimeReceiver(sourceNodeId, call, index)) return null
  return {
    kind: 'event',
    sourceNodeId,
    evidenceNodeIds: [`edge:${call.id}`],
    targetSymbol: call.targetSymbol,
    chainPath: call.chainPath,
    firstArg: target.target,
    payload: {
      broker: 'supabase_realtime',
      direction: 'listen',
      adapter: 'supabase_realtime',
      channel: extractSupabaseChannelName(call.chainPath),
      schema: target.schema,
      table: target.table,
      event: target.event,
    },
  }
}

function isSupabaseRealtimeReceiver(nodeId: string, call: CodeEdgeLike, index: SemanticIndex): boolean {
  const chainPath = call.chainPath ?? ''
  if (!chainPath) return false
  const normalizedChainPath = normalizeMemberChainPath(chainPath)

  const identity = traceReceiverIdentity({
    nodeId,
    chainPath: normalizedChainPath,
    index,
  })
  if (identity) return identity.orm === 'supabase'

  return hasSupabaseEvidence(nodeId, index)
}

function hasSupabaseEvidence(nodeId: string, index: SemanticIndex): boolean {
  return sourceIdsForNode(nodeId, index).some((sourceId) =>
    (index.importsBySource.get(sourceId) ?? []).some((edge) => isSupabaseRealtimePackage(edge.targetSpecifier)),
  )
}

function extractSupabaseRealtimeTarget(call: CodeEdgeLike): {
  target: string
  schema: string
  table: string
  event: string
} | null {
  const [, filter] = parseLiteralArgs(call.literalArgs)
  if (!isRecord(filter)) return null

  const schema = typeof filter.schema === 'string' ? filter.schema : 'public'
  const table = typeof filter.table === 'string' ? filter.table : null
  const event = typeof filter.event === 'string' ? filter.event : '*'
  if (!table) return null
  if (!/^[A-Za-z_][\w]*$/.test(schema)) return null
  if (!/^[A-Za-z_][\w]*$/.test(table)) return null
  if (!(event === '*' || /^[A-Z_]+$/.test(event))) return null

  return {
    target: `${schema}.${table}#${event}`,
    schema,
    table,
    event,
  }
}

function extractSupabaseChannelName(chainPath: string | null): string | null {
  if (!chainPath) return null
  return chainPath.match(/\bchannel\(\s*['"`]([^'"`]+)['"`]\s*\)/)?.[1] ?? null
}
