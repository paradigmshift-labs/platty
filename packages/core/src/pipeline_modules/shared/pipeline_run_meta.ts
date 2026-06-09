import type { LlmProvider } from '@/llm/types.js'
import type { LlmTier, LlmAttemptRecord } from './llm_policy.js'

export type PipelineStageStatus = 'passed' | 'failed' | 'skipped'

export interface PipelineStageStatusSummary {
  status: PipelineStageStatus
  failureCount: number
  skippedReason?: string
}

export interface ModelUsageBucket {
  calls: number
  inputTokens: number
  outputTokens: number
  estimatedUsd: number
  observedUsd?: number
  durationMs?: number
  failures?: number
}

export interface ModelUsageSummary {
  byTier?: Partial<Record<LlmTier, ModelUsageBucket>>
  byProvider?: Partial<Record<LlmProvider, ModelUsageBucket>>
  byModel?: Record<string, ModelUsageBucket>
  byPass?: Record<string, ModelUsageBucket>
  totals: {
    calls: number
    inputTokens?: number
    outputTokens?: number
    transportRetries: number
    escalations: number
    estimatedUsd: number
    observedUsd?: number
    durationMs?: number
    failures?: number
  }
}

export interface ResolvedRunConfig {
  tier?: LlmTier
  escalationTier?: LlmTier
  escalateOnRetry?: number
  judgeRetry?: number
  judgeTier?: LlmTier
  judgePassScore?: number
  failFast?: boolean
  budgetGuard?: boolean
  concurrency?: number
  passOverrides?: Record<string, { tier?: LlmTier; model?: string }>
}

export interface PipelineRunMeta {
  stageStatus?: Partial<Record<'build_docs' | 'build_epics' | 'build_business_docs', PipelineStageStatusSummary>>
  modelUsage?: ModelUsageSummary
  resolvedConfig?: Partial<Record<'build_docs' | 'build_epics' | 'build_business_docs', ResolvedRunConfig>>
  partialSuccess?: boolean
  documentGraph?: unknown
  attempts?: LlmAttemptRecord[]
}
