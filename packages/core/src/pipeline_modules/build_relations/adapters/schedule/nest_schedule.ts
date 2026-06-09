import type { RelationCandidateExtractorAdapter } from '../types.js'
import { extractScheduleFamilyCandidates } from './families/extraction.js'

export const nestScheduleAdapter: RelationCandidateExtractorAdapter = {
  name: 'nest_schedule',
  relationKinds: ['schedule_trigger'],
  extractCandidates(inputs, index) {
    return inputs.nodes.flatMap((node) => extractScheduleFamilyCandidates({ index, node }))
  }
}
