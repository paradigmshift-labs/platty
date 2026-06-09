import type { BuildEpicsRuntimePolicyInput, ResolvedBuildEpicsRuntimePolicy } from './types.js'

export interface BuildEpicsPolicyResolutionInput {
  totalAssignableDocs: number
  totalDocumentCards: number
}

const defaults: Required<BuildEpicsRuntimePolicyInput> = {
  maxWorkerCount: 4,
  taskMultiplier: 2,
  taxonomyChunkSize: 60,
  assignmentChunkMinSize: 20,
  assignmentChunkMaxSize: 80,
  crossDomainChunkSize: 120,
  maxCrossLinksPerDocument: 8,
  maxRepairPasses: 1,
  maxReviewRatioWarning: 0.2,
  maxReviewRatioFatal: 0.35,
  targetDomainMin: 1,
  targetDomainMax: 12,
  targetEpicMin: 1,
  targetEpicMax: 60,
  outputLanguage: 'ko',
  allowPartialBuildDocs: false,
}

export function resolveBuildEpicsRuntimePolicy(
  input: BuildEpicsRuntimePolicyInput = {},
  facts: BuildEpicsPolicyResolutionInput,
): ResolvedBuildEpicsRuntimePolicy {
  const requested = { ...defaults, ...input }
  const maxWorkerCount = Math.max(1, Math.floor(requested.maxWorkerCount))
  const taskMultiplier = Math.max(1, Math.floor(requested.taskMultiplier))
  const taxonomyChunkSize = Math.max(1, Math.floor(requested.taxonomyChunkSize))
  const assignmentChunkMinSize = Math.max(1, Math.floor(requested.assignmentChunkMinSize))
  const assignmentChunkMaxSize = Math.max(assignmentChunkMinSize, Math.floor(requested.assignmentChunkMaxSize))
  const crossDomainChunkSize = Math.max(1, Math.floor(requested.crossDomainChunkSize))
  const maxCrossLinksPerDocument = Math.max(1, Math.floor(requested.maxCrossLinksPerDocument))
  const targetAssignmentTaskCount = maxWorkerCount * taskMultiplier
  const rawAssignmentChunkSize = Math.ceil(Math.max(1, facts.totalAssignableDocs) / targetAssignmentTaskCount)
  const resolvedAssignmentChunkSize = clamp(rawAssignmentChunkSize, assignmentChunkMinSize, assignmentChunkMaxSize)

  return {
    ...requested,
    maxWorkerCount,
    taskMultiplier,
    taxonomyChunkSize,
    assignmentChunkMinSize,
    assignmentChunkMaxSize,
    crossDomainChunkSize,
    maxCrossLinksPerDocument,
    maxRepairPasses: Math.max(0, Math.floor(requested.maxRepairPasses)),
    resolvedAssignmentChunkSize,
    resolvedAssignmentTaskCount: Math.ceil(Math.max(0, facts.totalAssignableDocs) / resolvedAssignmentChunkSize),
    resolvedTaxonomyTaskCount: Math.ceil(Math.max(0, facts.totalDocumentCards) / taxonomyChunkSize),
    resolvedTaxonomyConsolidationTaskCount: facts.totalDocumentCards > 0 ? 1 : 0,
    resolvedCrossDomainTaskCount: Math.ceil(Math.max(0, facts.totalDocumentCards) / crossDomainChunkSize),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
