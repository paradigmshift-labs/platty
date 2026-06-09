import type { SemanticIndex } from '../types.js'

export type TraceIdentityKind = 'db_client' | 'api_client' | 'event_bus' | 'external_service' | 'unknown'

export type TraceConfidence = 'high' | 'medium' | 'low'

export interface TraceEvidence {
  nodeId?: string
  edgeId?: number
  reason: string
}

export interface ReceiverIdentity {
  kind: TraceIdentityKind
  packageName: string | null
  typeName: string | null
  orm: string | null
  confidence: TraceConfidence
  hops: number
  evidence: TraceEvidence[]
}

export interface ReceiverTraceInput {
  nodeId: string
  chainPath: string
  index: SemanticIndex
  maxHops?: number
}

export interface ReceiverTraceContext {
  index: SemanticIndex
  maxHops: number
  visited: Set<string>
}

