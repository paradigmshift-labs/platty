import type { BuildRelationsInputs, SemanticIndex, RelationCandidate } from '../types.js'
import { nestScheduleAdapter } from '../adapters/schedule/nest_schedule.js'

export function extractScheduleTriggerCandidates(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  return nestScheduleAdapter.extractCandidates(inputs, index)
}
