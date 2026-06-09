import type { EventKind, RunKind, TriggeredBy } from '@/db/schema/enums.js'
import type { UpstreamVersions as DbUpstreamVersions } from '@/db/schema/core.js'
import type { StepCtx } from '@/observability/logger.js'

export type ArtifactRef = {
  kind: 'table_row' | 'file' | 'artifact'
  id: string
  version?: string
}

export type UpstreamVersions = DbUpstreamVersions

export type StageSkippedReason = 'upstream_failed' | 'upstream_stale' | 'not_applicable' | 'policy_disabled' | 'idempotency_reused'

export type UserActionRequest = {
  kind: string
  title: string
  decisionRef: ArtifactRef
  requiredBy?: string
}

export type PipelineFailureKind =
  | 'input_invalid'
  | 'repo_unavailable'
  | 'static_analysis_failed'
  | 'llm_transport'
  | 'llm_schema'
  | 'llm_quality'
  | 'budget_exceeded'
  | 'cancelled'
  | 'internal'

export interface PipelineFailure {
  kind: PipelineFailureKind
  code: string
  message: string
  userMessage?: { key: string; params?: Record<string, string | number> }
  retryable: boolean
  details?: Record<string, unknown>
  causeName?: string
}

export type StageOutcome =
  | {
      status: 'passed'
      sourceCommit?: string | null
      outputRefs?: Record<string, ArtifactRef>
      phaseMeta?: Record<string, unknown>
      summary?: Record<string, unknown>
      upstreamVersions?: UpstreamVersions | null
    }
  | {
      status: 'failed'
      failure: PipelineFailure
      retryable: boolean
      partialOutputRefs?: Record<string, ArtifactRef>
      phaseMeta?: Record<string, unknown>
      summary?: Record<string, unknown>
      upstreamVersions?: UpstreamVersions | null
    }
  | {
      status: 'cancelled'
      failure: PipelineFailure & { kind: 'cancelled' }
      partialOutputRefs?: Record<string, ArtifactRef>
      phaseMeta?: Record<string, unknown>
      summary?: Record<string, unknown>
      upstreamVersions?: UpstreamVersions | null
    }
  | {
      status: 'waiting_for_user'
      action: UserActionRequest
      resumeToken: string
      partialOutputRefs?: Record<string, ArtifactRef>
      phaseMeta?: Record<string, unknown>
      summary?: Record<string, unknown>
      upstreamVersions?: UpstreamVersions | null
    }
  | {
      status: 'skipped'
      reason: StageSkippedReason
      upstreamPhase?: RunKind
      upstreamRunId?: string
      upstreamSourceCommit?: string | null
      phaseMeta?: Record<string, unknown>
      summary?: Record<string, unknown>
      upstreamVersions?: UpstreamVersions | null
    }

export type PipelineStageResult<T> =
  | { ok: true; runId: string; outcome: StageOutcome; value: T; reused?: boolean }
  | { ok: false; runId: string; outcome: StageOutcome; failure: PipelineFailure; reused?: boolean }

export interface PipelineStageStart<T> {
  runId: string
  completion: Promise<PipelineStageResult<T>>
  reused?: boolean
}

export interface RunStageInput {
  kind: RunKind
  projectId: string
  repoId?: string | null
  phase?: RunKind | null
  triggeredBy?: TriggeredBy
  sourceCommit?: string | null
  totalSteps?: number
  parentRunId?: string | null
  idempotencyKey?: string
  force?: boolean
  signal?: AbortSignal
  meta?: Record<string, unknown>
}

export interface ResumeStageInput extends RunStageInput {
  previousRunId: string
  resumeToken: string
}

export interface StepInput {
  step: string
  label?: string
}

export type PipelineStepContext = Pick<StepCtx, 'stepId' | 'llm' | 'emit' | 'emitAdmin'>

export type MarkPassedInput = Omit<Extract<StageOutcome, { status: 'passed' }>, 'status'>
export type MarkFailedInput = Omit<Extract<StageOutcome, { status: 'failed' }>, 'status'>
export type MarkSkippedInput = Omit<Extract<StageOutcome, { status: 'skipped' }>, 'status'>
export type MarkCancelledInput = Omit<Extract<StageOutcome, { status: 'cancelled' }>, 'status'>
export type MarkWaitingForUserInput = Omit<Extract<StageOutcome, { status: 'waiting_for_user' }>, 'status'>

export interface RunChildInput extends Omit<RunStageInput, 'parentRunId'> {
  failurePolicy?: 'fail_fast' | 'collect'
}
