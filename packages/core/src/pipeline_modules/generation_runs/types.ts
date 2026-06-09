import type { GenerationRunStatus, GenerationTaskKind, GenerationTaskStatus } from '@/db/schema/build_docs.js'
import type {
  BusinessDocsGenerationRunStatus,
  BusinessDocsGenerationTaskStatus,
  BusinessDocsTaskType,
} from '@/pipeline_modules/build_business_docs_cli/types.js'

export type UnifiedGenerationRunKind = 'build_docs' | 'build_epics' | 'build_business_docs'
export type UnifiedGenerationRunStatus = GenerationRunStatus | BusinessDocsGenerationRunStatus
export type UnifiedGenerationTaskType = GenerationTaskKind | BusinessDocsTaskType
export type UnifiedGenerationTaskStatus = GenerationTaskStatus | BusinessDocsGenerationTaskStatus
export type UnifiedTaskCountKey = UnifiedGenerationTaskStatus | 'total'

export type UnifiedRunNextAction =
  | { type: 'done' }
  | { type: 'lease_tasks' }
  | { type: 'retry_failed_tasks' }
  | { type: 'repair_task' }
  | { type: 'cancelled' }

export interface UnifiedRunStatusResult {
  runId: string
  kind: UnifiedGenerationRunKind
  projectId: string
  status: UnifiedGenerationRunStatus
  taskCountsByStatus: Partial<Record<UnifiedTaskCountKey, number>>
  nextAction: UnifiedRunNextAction
  stage?: unknown
  recovered?: {
    staleLeases?: number
  }
}

export interface UnifiedRunResumeResult extends UnifiedRunStatusResult {
  recovered?: {
    staleLeases?: number
    expiredLeases?: number
    repairTasksReady?: number
    failedTasksReady?: number
  }
}

export interface UnifiedRunRetryInput {
  projectId: string
  runId: string
  failed?: boolean
  repairRequested?: boolean
  taskId?: string
  taskType?: UnifiedGenerationTaskType
  dryRun?: boolean
}

export interface UnifiedRetriedTask {
  taskId: string
  taskType: UnifiedGenerationTaskType
  previousStatus: UnifiedGenerationTaskStatus
  nextStatus: UnifiedGenerationTaskStatus
}

export interface UnifiedSkippedTask {
  taskId: string
  taskType: UnifiedGenerationTaskType
  status: UnifiedGenerationTaskStatus
  reason: string
}

export interface UnifiedRunRetryResult {
  runId: string
  kind: UnifiedGenerationRunKind
  projectId: string
  matchedTaskCount: number
  resetTaskCount: number
  skippedTaskCount: number
  dryRun: boolean
  tasks: UnifiedRetriedTask[]
  skippedTasks: UnifiedSkippedTask[]
  nextAction: UnifiedRunNextAction
}

export interface UnifiedRunReleaseLeasesResult {
  runId: string
  kind: UnifiedGenerationRunKind
  projectId: string
  status: UnifiedGenerationRunStatus
  releasedLeaseCount: number
  nextAction: UnifiedRunNextAction
}

export interface UnifiedRunAdapter {
  kind: UnifiedGenerationRunKind
  status(input: { projectId: string; runId: string }): Promise<UnifiedRunStatusResult>
  resume(input: { projectId: string; runId: string }): Promise<UnifiedRunResumeResult>
  retry(input: UnifiedRunRetryInput): Promise<UnifiedRunRetryResult>
  releaseLeases(input: { projectId: string; runId: string; reason?: string }): Promise<UnifiedRunReleaseLeasesResult>
}
