import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../../types.js'
import { ablyRealtimeFamily } from './realtime_ably.js'
import { firebaseFirestoreRealtimeFamily } from './realtime_firebase.js'
import { pusherRealtimeFamily } from './realtime_pusher.js'
import { supabaseRealtimeFamily } from './realtime_supabase.js'
import type { RealtimeBroker, RealtimeEventFamily } from './realtime_types.js'

export type { RealtimeBroker } from './realtime_types.js'

export const REALTIME_EVENT_FAMILIES: readonly RealtimeEventFamily[] = [
  supabaseRealtimeFamily,
  firebaseFirestoreRealtimeFamily,
  ablyRealtimeFamily,
  pusherRealtimeFamily,
]

export function detectRealtimeBroker(nodeId: string, index: SemanticIndex): RealtimeBroker | null {
  for (const family of REALTIME_EVENT_FAMILIES) {
    const broker = family.detectBroker(nodeId, index)
    if (broker) return broker
  }

  return null
}

export function realtimeEventCandidate(
  sourceNodeId: string,
  call: CodeEdgeLike,
  broker: string,
  index: SemanticIndex,
): RelationCandidate | null {
  const family = REALTIME_EVENT_FAMILIES.find((candidate) => candidate.broker === broker)
  return family?.extractCandidate(sourceNodeId, call, index) ?? null
}
