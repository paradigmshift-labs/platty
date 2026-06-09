import type { RelationCandidate } from '../../types.js'

export type ServiceResolver = {
  targetFor?: (candidate: RelationCandidate, service: string) => string | null
  payloadFor?: (candidate: RelationCandidate, service: string) => Record<string, unknown>
  resourceFor(candidate: RelationCandidate): string | null
  operationFor(candidate: RelationCandidate): string | null
}
