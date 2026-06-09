import type { BuildRelationsInputs, CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../../types.js'

export type ExternalServiceExtractionContext = {
  inputs: BuildRelationsInputs
  index: SemanticIndex
  sourceNodeId: string
  call: CodeEdgeLike
  callsInNode: CodeEdgeLike[]
  resolveStaticArg(value: string): string | null
  sourceNodeIdForOffset(fileNodeId: string, filePath: string, offset: number, source: string): string
  detectImportedReceiverServicesByRoot(root: string | null): string[]
}

export type ExternalServiceExtractionFamily = {
  services?: readonly string[]
  extractCandidates?(inputs: BuildRelationsInputs, index: SemanticIndex, helpers: {
    sourceNodeIdForOffset(fileNodeId: string, filePath: string, offset: number, source: string): string
  }): RelationCandidate[]
  targetArgs?(service: string, context: ExternalServiceExtractionContext): Array<string | null> | null
  detectServicesForCall?(context: ExternalServiceExtractionContext): string[]
}
