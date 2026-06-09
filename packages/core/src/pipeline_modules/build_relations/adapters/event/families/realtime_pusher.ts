import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../../types.js'
import { isPusherRealtimePackage } from './realtime_packages.js'
import type { RealtimeBroker, RealtimeEventFamily } from './realtime_types.js'
import { isStaticRealtimeName, readStringArg, sourceIdsForNode } from './realtime_utils.js'

export const pusherRealtimeFamily: RealtimeEventFamily = {
  broker: 'pusher',
  detectBroker: detectPusherRealtimeBroker,
  extractCandidate: pusherRealtimeCandidate,
}

function detectPusherRealtimeBroker(nodeId: string, index: SemanticIndex): RealtimeBroker | null {
  if (!hasPusherEvidence(nodeId, index)) return null
  const calls = index.callsBySource.get(nodeId) ?? []
  const hasChannelSubscribe = calls.some((call) =>
    call.targetSymbol === 'subscribe' &&
    readStringArg(call, 0) != null,
  )
  const hasBind = calls.some((call) => call.targetSymbol === 'bind' && readStringArg(call, 0) != null)
  return hasChannelSubscribe && hasBind ? 'pusher' : null
}

function pusherRealtimeCandidate(
  sourceNodeId: string,
  call: CodeEdgeLike,
  index: SemanticIndex,
): RelationCandidate | null {
  if (call.targetSymbol !== 'bind') return null
  const target = extractPusherBindTarget(sourceNodeId, call, index)
  if (!target) return null
  return {
    kind: 'event',
    sourceNodeId,
    evidenceNodeIds: [`edge:${call.id}`, `edge:${target.channelCallId}`],
    targetSymbol: call.targetSymbol,
    chainPath: call.chainPath,
    firstArg: target.target,
    payload: {
      broker: 'pusher',
      direction: 'listen',
      adapter: 'pusher_realtime',
      channel: target.channel,
      event: target.event,
    },
  }
}

function extractPusherBindTarget(
  nodeId: string,
  call: CodeEdgeLike,
  index: SemanticIndex,
): { target: string; channel: string; event: string; channelCallId: number } | null {
  const event = readStringArg(call, 0)
  if (!event || !isStaticRealtimeName(event)) return null

  const channels = (index.callsBySource.get(nodeId) ?? [])
    .filter((candidate) => candidate.targetSymbol === 'subscribe')
    .map((candidate) => ({ call: candidate, channel: readStringArg(candidate, 0) }))
    .filter((item): item is { call: CodeEdgeLike; channel: string } =>
      item.channel != null && isStaticRealtimeName(item.channel),
    )

  const unique = [...new Map(channels.map((item) => [item.channel, item])).values()]
  if (unique.length !== 1) return null

  const [channel] = unique
  return {
    target: `${channel.channel}/${event}`,
    channel: channel.channel,
    event,
    channelCallId: channel.call.id,
  }
}

function hasPusherEvidence(nodeId: string, index: SemanticIndex): boolean {
  return sourceIdsForNode(nodeId, index).some((sourceId) =>
    [
      ...(index.importsBySource.get(sourceId) ?? []),
      ...(index.typeRefsBySource.get(sourceId) ?? []),
    ].some((edge) => isPusherRealtimePackage(edge.targetSpecifier)),
  )
}
