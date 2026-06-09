import { codeNodes } from '@/db/schema/code_graph.js'
import type {
  EntryPointDraft,
  FrameworkDetectionResult,
  StackInfoForBuildRoute,
} from '../types.js'

export type LegacyFallbackInput = {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}

export type NestExtractor = (
  source: string,
  filePath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
) => EntryPointDraft[]
