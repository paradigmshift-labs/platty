import { externalServiceAdapter } from '../adapters/external/services.js'
import type { BuildRelationsInputs, SemanticIndex, RelationCandidate } from '../types.js'

export function extractExternalServiceCandidates(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  return externalServiceAdapter.extractCandidates(inputs, index)
}
