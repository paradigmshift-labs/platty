import type { BuildRelationsInputs, CodeEdgeLike, CodeNodeLike, RelationCandidate, SemanticIndex } from '../types.js'

export interface RelationAdapterContext {
  inputs?: BuildRelationsInputs
  index: SemanticIndex
  maxTraceHops: number
  sourceNode?: CodeNodeLike
}

export interface RelationCandidateAdapter {
  name: string
  relationKind: RelationCandidate['kind']
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null
}

export interface RelationCandidateExtractorAdapter {
  name: string
  relationKinds: RelationCandidate['kind'][]
  extractCandidates(inputs: BuildRelationsInputs, index: SemanticIndex): RelationCandidate[]
}
