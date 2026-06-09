import { describe, expect, it } from 'vitest'
import { ModelUsageTracker } from '@/pipeline_infra/index.js'
import type { LlmCallTelemetry } from '@/llm/telemetry.js'

describe('ModelUsageTracker telemetry integration', () => {
  it('aggregates calls, tokens, observed cost, estimated cost, duration, failures, and pass buckets', () => {
    const tracker = new ModelUsageTracker()

    const success: LlmCallTelemetry = {
      provider: 'openai_api',
      requestedModel: 'gpt-4.1-mini',
      model: 'gpt-4.1-mini',
      status: 'success',
      stage: 'build_docs',
      pass: 'synthesis',
      attempt: 1,
      tier: 'small',
      correlationId: 'doc-1',
      startedAt: '2026-05-19T00:00:00.000Z',
      finishedAt: '2026-05-19T00:00:00.050Z',
      durationMs: 50,
      usage: { inputTokens: 100, outputTokens: 50 },
      costUsd: 0.00012,
      costEstimated: true,
    }
    const failure: LlmCallTelemetry = {
      provider: 'claude_api',
      requestedModel: 'claude-sonnet-4-5',
      model: 'claude-sonnet-4-5',
      status: 'error',
      stage: 'build_docs',
      pass: 'judge',
      attempt: 1,
      tier: 'large',
      correlationId: 'doc-1',
      startedAt: '2026-05-19T00:00:01.000Z',
      finishedAt: '2026-05-19T00:00:01.025Z',
      durationMs: 25,
      usage: { inputTokens: 0, outputTokens: 0 },
      costEstimated: false,
      errorName: 'Error',
      errorMessage: 'timeout',
    }

    tracker.recordTelemetry(success)
    tracker.recordTelemetry(failure)

    expect(tracker.snapshot()).toMatchObject({
      byTier: {
        small: { calls: 1, inputTokens: 100, outputTokens: 50, estimatedUsd: 0.00012, durationMs: 50, failures: 0 },
        large: { calls: 1, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, durationMs: 25, failures: 1 },
      },
      byProvider: {
        openai_api: { calls: 1, inputTokens: 100, outputTokens: 50, estimatedUsd: 0.00012, durationMs: 50, failures: 0 },
        claude_api: { calls: 1, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, durationMs: 25, failures: 1 },
      },
      byModel: {
        'gpt-4.1-mini': { calls: 1, inputTokens: 100, outputTokens: 50, estimatedUsd: 0.00012, durationMs: 50, failures: 0 },
        'claude-sonnet-4-5': { calls: 1, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, durationMs: 25, failures: 1 },
      },
      byPass: {
        synthesis: { calls: 1, inputTokens: 100, outputTokens: 50, estimatedUsd: 0.00012, durationMs: 50, failures: 0 },
        judge: { calls: 1, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, durationMs: 25, failures: 1 },
      },
      totals: {
        calls: 2,
        failures: 1,
        escalations: 1,
        estimatedUsd: 0.00012,
        durationMs: 75,
      },
    })
  })
})
