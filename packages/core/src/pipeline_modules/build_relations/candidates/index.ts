// F3: extractCandidates — anchor-based candidate discovery (스텁)
// resolver별 구현은 candidates/db_access.ts 등에서 채워짐

import type { BuildRelationsInputs, SemanticIndex, RelationCandidate } from '../types.js'
import { relationCandidateExtractorAdapters } from '../adapters/candidate_extractors.js'

export function extractCandidates(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  return relationCandidateExtractorAdapters.flatMap((adapter) => adapter.extractCandidates(inputs, index))
}
