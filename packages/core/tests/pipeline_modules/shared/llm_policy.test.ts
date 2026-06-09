import { describe, expect, it, vi } from 'vitest'

import {
  BudgetLimiter,
  LlmRateLimiter,
  LlmConcurrencyLimiter,
  isLlmBudgetExceededError,
  isTransientLlmError,
  resolveProfileStageLlmPolicy,
  resolveLlmTarget,
  resolveStageLlmPolicy,
  stageTierForAttempt,
  withTransportRetry,
  type LlmAttemptRecord,
} from '../../../src/pipeline_infra/index.js'

describe('llm policy resolver', () => {
  it('resolves stage env overrides and escalation tier independently from transport retries', () => {
    const env = {
      BUILD_DOCS_LLM_TIER: 'medium',
      BUILD_DOCS_ESCALATION_TIER: 'large',
      BUILD_DOCS_ESCALATE_ON_RETRY: '3',
      BUILD_DOCS_JUDGE_TIER: 'medium',
      BUILD_DOCS_JUDGE_RETRY: '4',
      BUILD_DOCS_SCHEMA_RETRY: '2',
      BUILD_DOCS_PASS_SCORE: '0.92',
      BUILD_DOCS_CONCURRENCY: '5',
      BUILD_DOCS_FAIL_FAST: '0',
    }

    const policy = resolveStageLlmPolicy('build_docs', env)

    expect(policy).toMatchObject({
      stage: 'build_docs',
      generationTier: 'medium',
      escalationTier: 'large',
      escalateOnRetry: 3,
      judgeTier: 'medium',
      judgeRetry: 4,
      schemaRetry: 2,
      passScore: 0.92,
      concurrency: 5,
      failFast: false,
    })
    expect(stageTierForAttempt(policy, 1)).toBe('medium')
    expect(stageTierForAttempt(policy, 2)).toBe('medium')
    expect(stageTierForAttempt(policy, 3)).toBe('large')
  })

  it('resolves critical pass tier overrides for business docs and epic passes', () => {
    const businessPolicy = resolveStageLlmPolicy('build_business_docs', {
      BUILD_BUSINESS_DOCS_LLM_TIER: 'medium',
      BUILD_BUSINESS_DOCS_DESIGN_TIER: 'large',
      BUILD_BUSINESS_DOCS_UCL_TIER: 'large',
      BUILD_PROJECT_GLOSSARY_TIER: 'large',
    })
    const epicPolicy = resolveStageLlmPolicy('build_epics', {
      BUILD_EPICS_LLM_TIER: 'medium',
      BUILD_EPICS_FINAL_TIER: 'large',
      BUILD_EPICS_SUMMARY_CHUNK_TIER: 'small',
      BUILD_EPICS_SCREEN_CHUNK_TIER: 'medium',
      BUILD_EPICS_MERGE_TIER: 'large',
    })

    expect(stageTierForAttempt(businessPolicy, 1, 'design')).toBe('large')
    expect(stageTierForAttempt(businessPolicy, 1, 'ucl')).toBe('large')
    expect(stageTierForAttempt(businessPolicy, 1, 'project_glossary')).toBe('large')
    expect(stageTierForAttempt(businessPolicy, 1, 'br')).toBe('medium')
    expect(stageTierForAttempt(epicPolicy, 1, 'final_boundary')).toBe('large')
    expect(stageTierForAttempt(epicPolicy, 1, 'summary_chunk_api')).toBe('small')
    expect(stageTierForAttempt(epicPolicy, 1, 'summary_chunk_screen')).toBe('medium')
    expect(stageTierForAttempt(epicPolicy, 1, 'summary_merge')).toBe('large')
  })

  it('uses documented stage env names for tier, retry, pass score, and concurrency', () => {
    const policy = resolveStageLlmPolicy('build_docs', {
      BUILD_DOCS_TIER: 'large',
      BUILD_DOCS_ESCALATION_TIER: 'medium',
      BUILD_DOCS_JUDGE_RETRY: '2',
      BUILD_DOCS_SCHEMA_RETRY: '1',
      BUILD_DOCS_JUDGE_PASS_SCORE: '0.87',
      BUILD_DOCS_CONCURRENCY: '4',
    })

    expect(policy).toMatchObject({
      generationTier: 'large',
      escalationTier: 'medium',
      judgeRetry: 2,
      schemaRetry: 1,
      passScore: 0.87,
      concurrency: 4,
    })
  })

  it('uses documented pipeline-wide fallback env when stage overrides are absent', () => {
    const policy = resolveStageLlmPolicy('build_docs', {
      PIPELINE_LLM_TIER: 'small',
      PIPELINE_LLM_ESCALATION_TIER: 'large',
      PIPELINE_LLM_ESCALATE_ON_RETRY: '4',
      PIPELINE_LLM_JUDGE_TIER: 'large',
      PIPELINE_LLM_JUDGE_PASS_SCORE: '0.88',
      PIPELINE_LLM_SCHEMA_RETRY: '5',
    })

    expect(policy.generationTier).toBe('small')
    expect(policy.escalationTier).toBe('large')
    expect(policy.escalateOnRetry).toBe(4)
    expect(policy.judgeTier).toBe('large')
    expect(policy.passScore).toBe(0.88)
    expect(policy.schemaRetry).toBe(5)
  })

  it('defaults build_docs to small tier and build_epics to medium tier', () => {
    expect(resolveStageLlmPolicy('build_docs', {}).generationTier).toBe('small')
    expect(resolveStageLlmPolicy('build_epics', {}).generationTier).toBe('medium')
  })

  it('resolves business docs UCS concurrency separately from stage concurrency', () => {
    const policy = resolveStageLlmPolicy('build_business_docs', {
      BUILD_BUSINESS_DOCS_CONCURRENCY: '3',
      BUILD_BUSINESS_DOCS_EPIC_CONCURRENCY: '5',
      BUILD_BUSINESS_DOCS_UCS_CONCURRENCY: '7',
    })

    expect(policy.concurrency).toBe(5)
    expect(policy.ucsConcurrency).toBe(7)
  })

  it('caps stage and nested concurrency by the global LLM max concurrency', () => {
    const policy = resolveStageLlmPolicy('build_business_docs', {
      PIPELINE_LLM_MAX_CONCURRENCY: '4',
      BUILD_BUSINESS_DOCS_CONCURRENCY: '10',
      BUILD_BUSINESS_DOCS_UCS_CONCURRENCY: '8',
    })

    expect(policy.concurrency).toBe(4)
    expect(policy.ucsConcurrency).toBe(4)
  })

  it('uses pipeline LLM concurrency as stage fallback before applying the global cap', () => {
    const policy = resolveStageLlmPolicy('build_docs', {
      PIPELINE_LLM_CONCURRENCY: '6',
      PIPELINE_LLM_MAX_CONCURRENCY: '4',
    })

    expect(policy.concurrency).toBe(4)
  })

  it('overlays deterministic profile retry gates on a resolved stage policy', () => {
    const policy = resolveProfileStageLlmPolicy('build_docs', 'deterministic', {
      BUILD_DOCS_JUDGE_RETRY: '3',
      BUILD_DOCS_SCHEMA_RETRY: '2',
      BUILD_DOCS_CONCURRENCY: '4',
    })

    expect(policy).toMatchObject({
      stage: 'build_docs',
      judgeRetry: 0,
      schemaRetry: 0,
      failFast: true,
      budgetGuard: false,
      concurrency: 4,
    })
  })

  it('resolves provider-specific concurrency env and caps it by the global limit', () => {
    const policy = resolveStageLlmPolicy('build_docs', {
      PIPELINE_LLM_MAX_CONCURRENCY: '5',
      PIPELINE_LLM_PROVIDER_CONCURRENCY_CLAUDE_CODE: '2',
      PIPELINE_LLM_PROVIDER_CONCURRENCY_OPENAI_API: '9',
    })

    expect(policy.providerConcurrency).toEqual({
      claude_code: 2,
      openai_api: 5,
    })
  })

  it('resolves transport retry and backoff env', () => {
    const policy = resolveStageLlmPolicy('build_docs', {
      PIPELINE_LLM_TRANSPORT_RETRY: '2',
      PIPELINE_LLM_TRANSPORT_BACKOFF_BASE_MS: '25',
      PIPELINE_LLM_TRANSPORT_BACKOFF_JITTER: '0',
    })

    expect(policy.transportRetry).toBe(2)
    expect(policy.transportBackoffBaseMs).toBe(25)
    expect(policy.transportBackoffJitter).toBe(false)
  })

  it('resolves global budget guard limits from env', () => {
    const policy = resolveStageLlmPolicy('build_docs', {
      PIPELINE_LLM_MAX_CALLS: '10',
      PIPELINE_LLM_MAX_LARGE_TIER_CALLS: '2',
      PIPELINE_LLM_MAX_ESTIMATED_USD: '1.25',
      PIPELINE_LLM_RPM: '60',
      PIPELINE_LLM_TPM: '200000',
    })

    expect(policy.maxCalls).toBe(10)
    expect(policy.maxLargeTierCalls).toBe(2)
    expect(policy.maxEstimatedSpendUsd).toBe(1.25)
    expect(policy.rpm).toBe(60)
    expect(policy.tpm).toBe(200000)
  })

  it('maps tiers to default provider/model and supports env model overrides', () => {
    expect(resolveLlmTarget('small', { stage: 'build_docs' })).toMatchObject({
      provider: 'claude_code',
      model: 'claude-haiku-4-5',
      source: 'default',
    })

    expect(
      resolveLlmTarget(
        'large',
        { stage: 'build_business_docs', pass: 'design' },
        {
          LLM_TIER_LARGE_PROVIDER: 'openai_api',
          LLM_TIER_LARGE_MODEL: 'gpt-5.5',
        },
      ),
    ).toMatchObject({
      provider: 'openai_api',
      model: 'gpt-5.5',
      source: 'env',
    })
  })
})

describe('BudgetLimiter', () => {
  it('atomically rejects calls beyond call and large-tier limits', () => {
    const limiter = new BudgetLimiter({ maxCalls: 2, maxLargeTierCalls: 1 })

    expect(limiter.acquire({ tier: 'large', provider: 'claude_code', model: 'claude-opus-4-7', source: 'default' })).toMatchObject({
      ok: true,
    })
    expect(limiter.acquire({ tier: 'medium', provider: 'claude_code', model: 'claude-sonnet-4-6', source: 'default' })).toMatchObject({
      ok: true,
    })
    expect(limiter.acquire({ tier: 'medium', provider: 'claude_code', model: 'claude-sonnet-4-6', source: 'default' })).toMatchObject({
      ok: false,
      code: 'max_calls_exceeded',
    })
    expect(() => new BudgetLimiter({ maxLargeTierCalls: 0 })).toThrow(/maxLargeTierCalls/)
  })

  it('fails before starting bounded spend calls when pricing is unknown', () => {
    const limiter = new BudgetLimiter({
      maxEstimatedSpendUsd: 1,
      estimateTokens: { input: 1_000, output: 1_000 },
      pricing: {},
    })

    expect(limiter.acquire({ tier: 'medium', provider: 'claude_code', model: 'unknown-model', source: 'default' })).toMatchObject({
      ok: false,
      code: 'pricing_unknown',
    })
  })

  it('uses baseline pricing for default tier models when spend guard is bounded', () => {
    const limiter = new BudgetLimiter({
      maxEstimatedSpendUsd: 1,
      estimateTokens: { input: 1_000, output: 1_000 },
    })

    expect(limiter.acquire({ tier: 'medium', provider: 'claude_code', model: 'claude-sonnet-4-6', source: 'default' })).toMatchObject({
      ok: true,
    })
    expect(limiter.snapshot().estimatedSpendUsd).toBeGreaterThan(0)
  })
})

describe('LlmConcurrencyLimiter', () => {
  it('enforces provider-specific concurrency below the global limit', async () => {
    const limiter = new LlmConcurrencyLimiter({
      globalMaxConcurrency: 5,
      providerMaxConcurrency: { claude_code: 2 },
    })
    let active = 0
    let maxActive = 0
    const calls = Array.from({ length: 4 }, () => limiter.run(
      { tier: 'medium', provider: 'claude_code', model: 'claude-sonnet-4-6', source: 'default' },
      async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active -= 1
      },
    ))

    await Promise.all(calls)

    expect(maxActive).toBe(2)
  })
})

describe('LlmRateLimiter', () => {
  it('delays calls beyond the configured RPM window', async () => {
    let now = 0
    const sleeps: number[] = []
    const limiter = new LlmRateLimiter({
      rpm: 2,
      windowMs: 1_000,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms)
        now += ms
      },
    })

    await limiter.acquire('first')
    await limiter.acquire('second')
    await limiter.acquire('third')

    expect(sleeps).toEqual([1_000])
  })
})

describe('transport retry', () => {
  it('retries transient transport failures without changing the parent judge attempt', async () => {
    vi.useFakeTimers()
    const attempts: LlmAttemptRecord[] = []
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockResolvedValueOnce('ok')

    const promise = withTransportRetry(operation, {
      stage: 'build_docs',
      unitId: 'doc-1',
      attempt: 2,
      target: { tier: 'medium', provider: 'claude_code', model: 'claude-sonnet-4-6', source: 'default' },
      maxRetries: 2,
      baseDelayMs: 100,
      jitterRatio: 0,
      onRetry: (record) => attempts.push(record),
    })

    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).resolves.toBe('ok')
    vi.useRealTimers()

    expect(operation).toHaveBeenCalledTimes(2)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({
      attempt: 2,
      retryKind: 'transport',
      tier: 'medium',
      provider: 'claude_code',
      model: 'claude-sonnet-4-6',
      escalated: false,
    })
  })

  it('classifies 429 and 5xx as transient transport errors only', () => {
    expect(isTransientLlmError({ status: 429 })).toBe(true)
    expect(isTransientLlmError({ statusCode: 503 })).toBe(true)
    expect(isTransientLlmError({ status: 400 })).toBe(false)
  })

  it('classifies Claude CLI extra-usage exhaustion as budget exceeded', () => {
    const error = new Error(`claude CLI exited with code 1
stdout: {"api_error_status":429,"result":"You're out of extra usage"}`)

    expect(isLlmBudgetExceededError(error)).toBe(true)
  })
})
