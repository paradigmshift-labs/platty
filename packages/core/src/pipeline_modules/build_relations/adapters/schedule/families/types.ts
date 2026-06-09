import type { CodeEdgeLike, CodeNodeLike, RelationCandidate, SemanticIndex } from '../../../types.js'

export type ScheduleExtractionContext = {
  index: SemanticIndex
  node: CodeNodeLike
  calls: CodeEdgeLike[]
  decorators: CodeEdgeLike[]
  packageImports: string[]
}

export type ScheduleExtractionFamily = {
  name: string
  extract(context: ScheduleExtractionContext): RelationCandidate[]
}
