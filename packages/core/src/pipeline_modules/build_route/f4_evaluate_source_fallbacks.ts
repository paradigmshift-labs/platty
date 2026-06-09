import { codeEdges, codeNodes } from '@/db/schema/code_graph.js'
import { createSourceRouteContext, runSourceRouteAdapters } from './f4/source_route_adapters.js'
import { SOURCE_FALLBACK_ADAPTERS } from './f4/source_fallback_adapter_registry.js'
import { createGraphIndex } from './graph_index.js'
import type {
  EntryPointDraft,
  FrameworkDetectionResult,
  StackInfoForBuildRoute,
} from './types.js'

export interface EvaluateSourceFallbacksInput {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
  graphEdges?: Array<typeof codeEdges.$inferSelect>
}

export interface EvaluateSourceFallbacksResult {
  entryPoints: EntryPointDraft[]
}

export function evaluateSourceFallbacks(input: EvaluateSourceFallbacksInput): EvaluateSourceFallbacksResult {
  return { entryPoints: buildSourceFallbackEntries(input) }
}

export function buildSourceFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
  graphEdges?: Array<typeof codeEdges.$inferSelect>
}): EntryPointDraft[] {
  const graphEdges = input.graphEdges ?? []
  const ctx = createSourceRouteContext({
    ...input,
    graphEdges,
    graph: createGraphIndex({ nodes: input.graphNodes, edges: graphEdges }),
  })
  return runSourceRouteAdapters(ctx, SOURCE_FALLBACK_ADAPTERS).entryPoints
}
