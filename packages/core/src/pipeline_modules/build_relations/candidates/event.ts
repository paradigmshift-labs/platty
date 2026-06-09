import { eventBrokerAdapter } from '../adapters/event/brokers.js'
import type { BuildRelationsInputs, RelationCandidate, SemanticIndex } from '../types.js'

export function extractEventCandidates(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  return eventBrokerAdapter.extractCandidates(inputs, index)
}
