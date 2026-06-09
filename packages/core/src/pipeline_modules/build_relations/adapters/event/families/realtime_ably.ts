import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../../types.js'
import { isAblyRealtimePackage } from './realtime_packages.js'
import type { RealtimeBroker, RealtimeEventFamily } from './realtime_types.js'
import {
  isStaticRealtimeName,
  normalizeMemberChainPath,
  readStringArg,
  sourceIdsForNode,
} from './realtime_utils.js'

export const ablyRealtimeFamily: RealtimeEventFamily = {
  broker: 'ably',
  detectBroker: detectAblyRealtimeBroker,
  extractCandidate: ablyRealtimeCandidate,
}

function detectAblyRealtimeBroker(nodeId: string, index: SemanticIndex): RealtimeBroker | null {
  if (!hasAblyEvidence(nodeId, index)) return null
  const calls = index.callsBySource.get(nodeId) ?? []
  const hasChannelGet = calls.some((call) =>
    call.targetSymbol === 'get' &&
    chainLooksLikeAblyChannels(call.chainPath) &&
    readStringArg(call, 0) != null,
  )
  const hasSubscribe = calls.some((call) => call.targetSymbol === 'subscribe' && readStringArg(call, 0) != null)
  return hasChannelGet && hasSubscribe ? 'ably' : null
}

function ablyRealtimeCandidate(
  sourceNodeId: string,
  call: CodeEdgeLike,
  index: SemanticIndex,
): RelationCandidate | null {
  if (call.targetSymbol !== 'subscribe') return null
  const target = extractAblySubscribeTarget(sourceNodeId, call, index)
  if (!target) return null
  return {
    kind: 'event',
    sourceNodeId,
    evidenceNodeIds: [`edge:${call.id}`, `edge:${target.channelCallId}`],
    targetSymbol: call.targetSymbol,
    chainPath: call.chainPath,
    firstArg: target.target,
    payload: {
      broker: 'ably',
      direction: 'listen',
      adapter: 'ably_realtime',
      channel: target.channel,
      event: target.event,
    },
  }
}

function extractAblySubscribeTarget(
  nodeId: string,
  call: CodeEdgeLike,
  index: SemanticIndex,
): { target: string; channel: string; event: string; channelCallId: number } | null {
  const event = readStringArg(call, 0)
  if (!event || !isStaticRealtimeName(event)) return null

  const channels = (index.callsBySource.get(nodeId) ?? [])
    .filter((candidate) => candidate.targetSymbol === 'get' && chainLooksLikeAblyChannels(candidate.chainPath))
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

function chainLooksLikeAblyChannels(chainPath: string | null): boolean {
  return normalizeMemberChainPath(chainPath ?? '').endsWith('.channels') ||
    normalizeMemberChainPath(chainPath ?? '').includes('.channels.')
}

function hasAblyEvidence(nodeId: string, index: SemanticIndex): boolean {
  return sourceIdsForNode(nodeId, index).some((sourceId) =>
    [
      ...(index.importsBySource.get(sourceId) ?? []),
      ...(index.typeRefsBySource.get(sourceId) ?? []),
    ].some((edge) => isAblyRealtimePackage(edge.targetSpecifier)),
  )
}
