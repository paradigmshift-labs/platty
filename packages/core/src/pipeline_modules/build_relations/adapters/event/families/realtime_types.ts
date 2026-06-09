import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../../types.js'

export type RealtimeBroker = 'supabase_realtime' | 'firebase_firestore' | 'ably' | 'pusher'

export type RealtimeEventFamily = {
  broker: RealtimeBroker
  detectBroker(nodeId: string, index: SemanticIndex): RealtimeBroker | null
  extractCandidate(sourceNodeId: string, call: CodeEdgeLike, index: SemanticIndex): RelationCandidate | null
}
