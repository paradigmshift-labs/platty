import type { RelationCandidate, SemanticIndex, SourceFallback, ExtractedRelation } from '../types.js'

export function resolveEventCandidate(
  candidate: RelationCandidate,
  _index: SemanticIndex,
  _sourceFallback: SourceFallback,
): ExtractedRelation | null {
  const broker = candidate.payload.broker as string | undefined
  if (!broker) return null

  const target = resolveTarget(candidate, broker)
  if (!target || !isStaticEventTarget(target, broker)) return null

  const direction = candidate.payload.direction === 'listen' ? 'listen' : 'publish'
  const kind = direction === 'listen' ? 'event_listen' : 'event_publish'

  return {
    sourceNodeId: candidate.sourceNodeId,
    kind,
    target,
    operation: direction === 'listen' ? listenOperation(broker) : publishOperation(broker),
    canonicalTarget: `${broker}:${target}`,
    payload: { ...candidate.payload, broker },
    evidenceNodeIds: candidate.evidenceNodeIds,
    confidence: 'high',
  }
}

function resolveTarget(candidate: RelationCandidate, broker: string): string | null {
  const raw = candidate.firstArg
  if (!raw) return null

  if (broker === 'bull') {
    const queue = candidate.payload.queue as string | undefined
    return queue ? `${queue}/${raw}` : raw
  }

  return raw
}

function isStaticEventTarget(target: string, broker: string): boolean {
  if (broker === 'bull') return target.includes('/')
  if (broker === 'websocket') return /^[\w./:-]+(?:#[\w./:-]+)?$/.test(target)
  if (broker === 'supabase_realtime') return /^[A-Za-z_][\w]*\.[A-Za-z_][\w]*#(?:[A-Z_]+|\*)$/.test(target)
  if (broker === 'firebase_firestore') return /^[A-Za-z_][\w-]*(?:\/[A-Za-z_][\w-]*)*$/.test(target)
  if (broker === 'ably') return /^[A-Za-z0-9_.:-]+\/[A-Za-z0-9_.:-]+$/.test(target)
  if (broker === 'pusher') return /^[A-Za-z0-9_.:-]+\/[A-Za-z0-9_.:-]+$/.test(target)
  if (broker === 'nestjs_cqrs') return /^[A-Za-z_$][\w$]*(?:Command|Query|Event)?$/.test(target)
  if (['websocket', 'nest_rpc', 'rabbitmq', 'sqs', 'sns'].includes(broker)) return /^[\w./:-]+$/.test(target)
  if (/^[A-Z][A-Z0-9_]*$/.test(target)) return true
  if (/^[\w.-]+\/[\w./-]+$/.test(target)) return true
  if (/^[\w.-]+\.[\w.-]+$/.test(target)) return true
  return false
}

function publishOperation(broker: string): string {
  if (broker === 'sqs') return 'send'
  return 'publish'
}

function listenOperation(broker: string): string {
  if (broker === 'bull') return 'process'
  if (broker === 'graphql_pubsub') return 'subscribe'
  if (broker === 'supabase_realtime') return 'subscribe'
  if (broker === 'firebase_firestore') return 'subscribe'
  if (broker === 'ably') return 'subscribe'
  if (broker === 'pusher') return 'subscribe'
  return 'listen'
}
