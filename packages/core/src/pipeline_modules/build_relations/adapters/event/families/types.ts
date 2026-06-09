import type { CodeEdgeLike, CodeNodeLike, RelationCandidate, SemanticIndex } from '../../../types.js'
import type { RelationCandidateExtractorAdapter } from '../../types.js'

export type BuildRelationsInputs = Parameters<RelationCandidateExtractorAdapter['extractCandidates']>[0]
export type EventDecorator = { id: number; targetSymbol: string | null; firstArg: string | null; literalArgs?: string | null }

export type EventBrokerExtractionContext = {
  inputs: BuildRelationsInputs
  index: SemanticIndex
  node: CodeNodeLike
  broker: string
  calls: CodeEdgeLike[]
  decorators: EventDecorator[]
  processor: EventDecorator | undefined
  rabbit: EventDecorator | undefined
  packageImports: ReadonlySet<string>
}

export type EventBrokerExtractionFamily = {
  name: string
  extract(context: EventBrokerExtractionContext): RelationCandidate[]
}
