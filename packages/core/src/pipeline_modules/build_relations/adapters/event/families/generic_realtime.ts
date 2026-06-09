import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../../types.js'
import { resolveFirstArgFromGraphArgExpressions } from '../../../source_call_args.js'
import { realtimeEventCandidate } from './realtime.js'
import type { EventBrokerExtractionContext } from './types.js'
import { eventCallCandidate } from './utils.js'

export function extractGenericRealtimeCandidates(context: EventBrokerExtractionContext): RelationCandidate[] {
  const { node, broker, calls, index, rabbit } = context
  const candidates: RelationCandidate[] = []

  for (const call of calls) {
    if (call.targetSymbol === 'publish' && ['graphql_pubsub', 'sns', 'nats'].includes(broker)) {
      candidates.push(eventCallCandidate(node.id, call, broker))
    }

    if (call.targetSymbol === 'asyncIterator' && broker === 'graphql_pubsub') {
      candidates.push(eventCallCandidate(node.id, call, broker, 'listen'))
    }

    if (call.targetSymbol === 'WebSocket' && broker === 'websocket') {
      const target = resolveWebSocketConstructorTarget(call)
      if (target) {
        candidates.push({
          kind: 'event',
          sourceNodeId: node.id,
          evidenceNodeIds: [`edge:${call.id}`],
          targetSymbol: call.targetSymbol,
          chainPath: call.chainPath,
          firstArg: target,
          payload: {
            broker,
            direction: 'listen',
            adapter: 'browser_websocket',
            url: target,
          },
        })
      }
    }

    const realtimeCandidate = realtimeEventCandidate(node.id, call, broker, index)
    if (realtimeCandidate) {
      candidates.push(realtimeCandidate)
      continue
    }

    if (call.targetSymbol === 'emit' && ['kafka', 'rabbitmq', 'node_event', 'websocket'].includes(broker)) {
      candidates.push(eventCallCandidate(node.id, call, rabbit ? 'rabbitmq' : broker))
    }
  }

  return candidates
}

export function detectBrowserWebSocketBroker(nodeId: string, index: SemanticIndex): string | null {
  return (index.callsBySource.get(nodeId) ?? []).some((call) =>
    call.targetSymbol === 'WebSocket' &&
    resolveWebSocketConstructorTarget(call) != null,
  )
    ? 'websocket'
    : null
}

function resolveWebSocketConstructorTarget(call: CodeEdgeLike): string | null {
  const target = call.firstArg ?? resolveFirstArgFromGraphArgExpressions(call)
  if (!target) return null
  if (!/^wss?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*)?$/.test(target)) return null
  return target
}
