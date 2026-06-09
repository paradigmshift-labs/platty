import type { LlmProvider } from '../../llm/types.js'
import type { LlmCallTelemetry } from '../../llm/telemetry.js'
import type { ModelUsageBucket, ModelUsageSummary } from './pipeline_run_meta.js'

export type LlmTier = 'small' | 'medium' | 'large'
export type LlmStage = 'build_docs' | 'build_epics' | 'build_business_docs'
export type LlmRetryKind = 'initial' | 'schema' | 'judge' | 'transport'

export interface LlmGenerateOptions {
  tier?: LlmTier
  provider?: LlmProvider
  model?: string
  stage?: LlmStage
  pass?: string
  attempt?: number
  correlationId?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ResolvedLlmTarget {
  tier: LlmTier
  provider: LlmProvider
  model: string
  credentialRef?: string
  source: 'env' | 'project' | 'workspace' | 'user' | 'default'
}

export interface LlmExecutionPolicy {
  judgeRetry: number
  schemaRetry: number
  failFast: boolean
  requireAllDocsForEpics: boolean
  requireAllEpicsForBusinessDocs: boolean
  budgetGuard: boolean
  qualityGate?: boolean
}

export interface ResolvedStageLlmPolicy extends LlmExecutionPolicy {
  stage: LlmStage
  generationTier: LlmTier
  escalationTier: LlmTier
  escalateOnRetry: number
  judgeTier: LlmTier
  passScore: number
  concurrency: number
  ucsConcurrency?: number
  providerConcurrency?: Partial<Record<LlmProvider, number>>
  transportRetry: number
  transportBackoffBaseMs: number
  transportBackoffJitter: boolean
  maxCalls?: number
  maxLargeTierCalls?: number
  maxEstimatedSpendUsd?: number
  rpm?: number
  tpm?: number
  passTierOverrides?: Record<string, LlmTier>
}

export interface LlmAttemptRecord {
  attempt: number
  stage: LlmStage
  unitId: string
  tier: LlmTier
  provider: LlmProvider
  model: string
  escalated: boolean
  retryKind: LlmRetryKind
  promptRef?: string
  rawOutputRef?: string
  judgeScore?: number
  judgePassed?: boolean
  requiredFixes?: string[]
  unsupportedClaims?: string[]
  missingEvidence?: string[]
  startedAt: string
  finishedAt: string
  durationMs: number
  generateDurationMs?: number
  judgeDurationMs?: number
  tokenEstimate?: { input: number; output: number }
  costEstimateUsd?: number
}

export interface StageFailureReport {
  stage: LlmStage
  unitId: string
  documentId?: string
  primaryEntryPointId?: string
  repoId?: string
  failureKind: 'canonical_missing' | 'schema' | 'judge' | 'transport' | 'budget' | 'internal'
  message: string
  judgeAttemptCount: number
  attempts: LlmAttemptRecord[]
}

interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
}

interface BudgetLimiterOptions {
  maxCalls?: number
  maxLargeTierCalls?: number
  maxEstimatedSpendUsd?: number
  pricing?: Record<string, ModelPricing>
  estimateTokens?: { input: number; output: number }
}

type Env = Record<string, string | undefined>

const defaultTargets: Record<LlmTier, Pick<ResolvedLlmTarget, 'provider' | 'model'>> = {
  small: { provider: 'claude_code', model: 'claude-haiku-4-5' },
  medium: { provider: 'claude_code', model: 'claude-sonnet-4-6' },
  large: { provider: 'claude_code', model: 'claude-opus-4-7' },
}

const baselinePricing: Record<string, ModelPricing> = {
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-opus-4-7': { inputPer1M: 15, outputPer1M: 75 },
}

const stageEnvPrefix: Record<LlmStage, string> = {
  build_docs: 'BUILD_DOCS',
  build_epics: 'BUILD_EPICS',
  build_business_docs: 'BUILD_BUSINESS_DOCS',
}

export function resolveLlmTarget(
  tier: LlmTier,
  _context: { stage: LlmStage; pass?: string; projectId?: string; workspaceId?: string; userId?: string },
  env: Env = process.env,
): ResolvedLlmTarget {
  const provider = parseProvider(env[`LLM_TIER_${tier.toUpperCase()}_PROVIDER`]) ?? parseProvider(env[`LLM_${tier.toUpperCase()}_PROVIDER`])
  const model = nonEmpty(env[`LLM_TIER_${tier.toUpperCase()}_MODEL`]) ?? nonEmpty(env[`LLM_${tier.toUpperCase()}_MODEL`])

  return {
    tier,
    provider: provider ?? defaultTargets[tier].provider,
    model: model ?? defaultTargets[tier].model,
    source: provider || model ? 'env' : 'default',
  }
}

export function resolveStageLlmPolicy(stage: LlmStage, env: Env = process.env): ResolvedStageLlmPolicy {
  const prefix = stageEnvPrefix[stage]
  const judgeRetry = parseNonNegativeInt(env[`${prefix}_JUDGE_RETRY`]) ?? parseNonNegativeInt(env.LLM_JUDGE_RETRY) ?? 3
  const schemaRetry = parseNonNegativeInt(env[`${prefix}_SCHEMA_RETRY`])
    ?? parseNonNegativeInt(env.PIPELINE_LLM_SCHEMA_RETRY)
    ?? parseNonNegativeInt(env.LLM_SCHEMA_RETRY)
    ?? 2
  const generationTier = parseTier(env[`${prefix}_TIER`])
    ?? parseTier(env[`${prefix}_LLM_TIER`])
    ?? parseTier(env.PIPELINE_LLM_TIER)
    ?? defaultGenerationTier(stage)
  const globalMaxConcurrency = parsePositiveInt(env.PIPELINE_LLM_MAX_CONCURRENCY)
  const rawStageConcurrency = stage === 'build_business_docs'
    ? parsePositiveInt(env.BUILD_BUSINESS_DOCS_EPIC_CONCURRENCY)
      ?? parsePositiveInt(env[`${prefix}_CONCURRENCY`])
      ?? parsePositiveInt(env.PIPELINE_LLM_CONCURRENCY)
      ?? 1
    : parsePositiveInt(env[`${prefix}_CONCURRENCY`]) ?? parsePositiveInt(env.PIPELINE_LLM_CONCURRENCY) ?? defaultStageConcurrency(stage)
  const stageConcurrency = capConcurrency(rawStageConcurrency, globalMaxConcurrency)
  const ucsConcurrency = stage === 'build_business_docs'
    ? capConcurrency(parsePositiveInt(env.BUILD_BUSINESS_DOCS_UCS_CONCURRENCY) ?? stageConcurrency, globalMaxConcurrency)
    : undefined
  const providerConcurrency = resolveProviderConcurrency(env, globalMaxConcurrency)

  return {
    stage,
    generationTier,
    escalationTier: parseTier(env[`${prefix}_ESCALATION_TIER`]) ?? parseTier(env.PIPELINE_LLM_ESCALATION_TIER) ?? 'large',
    escalateOnRetry: parsePositiveInt(env[`${prefix}_ESCALATE_ON_RETRY`]) ?? parsePositiveInt(env.PIPELINE_LLM_ESCALATE_ON_RETRY) ?? 3,
    judgeTier: parseTier(env[`${prefix}_JUDGE_TIER`]) ?? parseTier(env.PIPELINE_LLM_JUDGE_TIER) ?? 'medium',
    passTierOverrides: resolvePassTierOverrides(stage, env),
    judgeRetry,
    schemaRetry,
    passScore: parseScore(env[`${prefix}_JUDGE_PASS_SCORE`])
      ?? parseScore(env[`${prefix}_PASS_SCORE`])
      ?? parseScore(env.PIPELINE_LLM_JUDGE_PASS_SCORE)
      ?? 0.9,
    concurrency: stageConcurrency,
    ucsConcurrency,
    providerConcurrency,
    transportRetry: parseNonNegativeInt(env.PIPELINE_LLM_TRANSPORT_RETRY) ?? 5,
    transportBackoffBaseMs: parsePositiveInt(env.PIPELINE_LLM_TRANSPORT_BACKOFF_BASE_MS) ?? 1_000,
    transportBackoffJitter: parseBoolean(env.PIPELINE_LLM_TRANSPORT_BACKOFF_JITTER) ?? true,
    maxCalls: parsePositiveInt(env.PIPELINE_LLM_MAX_CALLS),
    maxLargeTierCalls: parsePositiveInt(env.PIPELINE_LLM_MAX_LARGE_TIER_CALLS),
    maxEstimatedSpendUsd: parsePositiveNumber(env.PIPELINE_LLM_MAX_ESTIMATED_USD),
    rpm: parsePositiveInt(env.PIPELINE_LLM_RPM),
    tpm: parsePositiveInt(env.PIPELINE_LLM_TPM),
    failFast: parseBoolean(env[`${prefix}_FAIL_FAST`]) ?? true,
    requireAllDocsForEpics: parseBoolean(env.REQUIRE_ALL_DOCS_FOR_EPICS) ?? true,
    requireAllEpicsForBusinessDocs: parseBoolean(env.REQUIRE_ALL_EPICS_FOR_BUSINESS_DOCS) ?? true,
    budgetGuard: parseBoolean(env.LLM_BUDGET_GUARD) ?? true,
    qualityGate: parseBoolean(env[`${prefix}_QUALITY_GATE`]) ?? parseBoolean(env.PIPELINE_LLM_QUALITY_GATE) ?? false,
  }
}

function capConcurrency(value: number, max: number | undefined): number {
  return max === undefined ? value : Math.min(value, max)
}

export function stageTierForAttempt(
  policy: Pick<ResolvedStageLlmPolicy, 'generationTier' | 'escalationTier' | 'escalateOnRetry' | 'passTierOverrides'>,
  attempt: number,
  pass?: string,
): LlmTier {
  const passTier = pass ? policy.passTierOverrides?.[pass] : undefined
  if (passTier) return passTier
  return attempt >= policy.escalateOnRetry ? policy.escalationTier : policy.generationTier
}

export function policyFor(profile: 'deterministic' | 'real-e2e' | 'real-llm-batch'): LlmExecutionPolicy {
  if (profile === 'deterministic') {
    return {
      judgeRetry: 0,
      schemaRetry: 0,
      failFast: true,
      requireAllDocsForEpics: true,
      requireAllEpicsForBusinessDocs: true,
      budgetGuard: false,
      qualityGate: false,
    }
  }

  return {
    judgeRetry: 3,
    schemaRetry: 2,
    failFast: profile !== 'real-llm-batch',
    requireAllDocsForEpics: true,
    requireAllEpicsForBusinessDocs: true,
    budgetGuard: true,
    qualityGate: profile !== 'real-e2e',
  }
}

export function resolveProfileStageLlmPolicy(
  stage: LlmStage,
  profile: 'deterministic' | 'real-e2e' | 'real-llm-batch',
  env: Env = process.env,
): ResolvedStageLlmPolicy {
  return {
    ...resolveStageLlmPolicy(stage, env),
    ...policyFor(profile),
  }
}

function resolvePassTierOverrides(stage: LlmStage, env: Env): Record<string, LlmTier> | undefined {
  const overrides: Record<string, LlmTier> = {}
  if (stage === 'build_epics') {
    assignTierOverride(overrides, 'final_boundary', env.BUILD_EPICS_FINAL_TIER)
    assignTierOverride(overrides, 'summary_chunk_api', env.BUILD_EPICS_SUMMARY_CHUNK_TIER)
    assignTierOverride(overrides, 'summary_chunk_screen', env.BUILD_EPICS_SCREEN_CHUNK_TIER ?? env.BUILD_EPICS_SUMMARY_CHUNK_TIER)
    assignTierOverride(overrides, 'summary_merge', env.BUILD_EPICS_MERGE_TIER ?? env.BUILD_EPICS_FINAL_TIER)
  }
  if (stage === 'build_business_docs') {
    assignTierOverride(overrides, 'design', env.BUILD_BUSINESS_DOCS_DESIGN_TIER)
    assignTierOverride(overrides, 'ucl', env.BUILD_BUSINESS_DOCS_UCL_TIER)
    assignTierOverride(overrides, 'project_glossary', env.BUILD_PROJECT_GLOSSARY_TIER)
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined
}

function assignTierOverride(overrides: Record<string, LlmTier>, pass: string, raw: string | undefined): void {
  const tier = parseTier(raw)
  if (tier) overrides[pass] = tier
}

export type BudgetAcquireResult =
  | { ok: true; estimatedUsd: number }
  | { ok: false; code: 'max_calls_exceeded' | 'max_large_tier_calls_exceeded' | 'pricing_unknown' | 'estimated_spend_exceeded'; message: string }

export class BudgetLimiter {
  private calls = 0
  private largeTierCalls = 0
  private estimatedSpendUsd = 0

  constructor(private readonly opts: BudgetLimiterOptions = {}) {
    assertPositiveLimit('maxCalls', opts.maxCalls)
    assertPositiveLimit('maxLargeTierCalls', opts.maxLargeTierCalls)
    assertPositiveLimit('maxEstimatedSpendUsd', opts.maxEstimatedSpendUsd)
  }

  acquire(target: ResolvedLlmTarget): BudgetAcquireResult {
    if (this.opts.maxCalls !== undefined && this.calls >= this.opts.maxCalls) {
      return { ok: false, code: 'max_calls_exceeded', message: 'LLM max call budget exceeded' }
    }
    if (target.tier === 'large' && this.opts.maxLargeTierCalls !== undefined && this.largeTierCalls >= this.opts.maxLargeTierCalls) {
      return { ok: false, code: 'max_large_tier_calls_exceeded', message: 'LLM large-tier call budget exceeded' }
    }

    const cost = this.estimateCost(target.model)
    if (cost === undefined) {
      return { ok: false, code: 'pricing_unknown', message: `No LLM pricing configured for ${target.model}` }
    }
    if (this.opts.maxEstimatedSpendUsd !== undefined && this.estimatedSpendUsd + cost > this.opts.maxEstimatedSpendUsd) {
      return { ok: false, code: 'estimated_spend_exceeded', message: 'LLM estimated spend budget exceeded' }
    }

    this.calls += 1
    if (target.tier === 'large') this.largeTierCalls += 1
    this.estimatedSpendUsd += cost
    return { ok: true, estimatedUsd: cost }
  }

  settle(_observedUsd?: number): void {
    return
  }

  snapshot(): { calls: number; largeTierCalls: number; estimatedSpendUsd: number } {
    return {
      calls: this.calls,
      largeTierCalls: this.largeTierCalls,
      estimatedSpendUsd: this.estimatedSpendUsd,
    }
  }

  private estimateCost(model: string): number | undefined {
    if (this.opts.maxEstimatedSpendUsd === undefined) return 0
    const pricing = (this.opts.pricing ?? baselinePricing)[model]
    if (!pricing) return undefined
    const estimate = this.opts.estimateTokens ?? { input: 1_000, output: 1_000 }
    return (estimate.input / 1_000_000) * pricing.inputPer1M + (estimate.output / 1_000_000) * pricing.outputPer1M
  }
}

export class LlmBudgetExceededError extends Error {
  readonly code = 'LLM_BUDGET_EXCEEDED'

  constructor(readonly result: Extract<BudgetAcquireResult, { ok: false }>) {
    super(result.message)
    this.name = 'LlmBudgetExceededError'
  }
}

export function isLlmBudgetExceededError(error: unknown): error is LlmBudgetExceededError {
  if (error instanceof LlmBudgetExceededError) return true
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /"api_error_status"\s*:\s*429/.test(message) && /out of extra usage|usage/i.test(message)
}

export class LlmConcurrencyLimiter {
  private readonly globalSemaphore: Semaphore | undefined
  private readonly providerSemaphores = new Map<LlmProvider, Semaphore>()

  constructor(opts: {
    globalMaxConcurrency?: number
    providerMaxConcurrency?: Partial<Record<LlmProvider, number>>
  } = {}) {
    assertPositiveLimit('globalMaxConcurrency', opts.globalMaxConcurrency)
    if (opts.globalMaxConcurrency !== undefined) {
      this.globalSemaphore = new Semaphore(opts.globalMaxConcurrency)
    }
    for (const [provider, limit] of Object.entries(opts.providerMaxConcurrency ?? {}) as Array<[LlmProvider, number | undefined]>) {
      assertPositiveLimit(`providerMaxConcurrency.${provider}`, limit)
      if (limit !== undefined) this.providerSemaphores.set(provider, new Semaphore(limit))
    }
  }

  async run<T>(target: Pick<ResolvedLlmTarget, 'provider'>, fn: () => Promise<T>): Promise<T> {
    const releaseGlobal = await this.globalSemaphore?.acquire()
    const releaseProvider = await this.providerSemaphores.get(target.provider)?.acquire()
    try {
      return await fn()
    } finally {
      releaseProvider?.()
      releaseGlobal?.()
    }
  }
}

export class LlmRateLimiter {
  private readonly events: Array<{ at: number; tokens: number }> = []
  private readonly windowMs: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly opts: {
    rpm?: number
    tpm?: number
    windowMs?: number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  } = {}) {
    assertPositiveLimit('rpm', opts.rpm)
    assertPositiveLimit('tpm', opts.tpm)
    this.windowMs = opts.windowMs ?? 60_000
    this.now = opts.now ?? (() => Date.now())
    this.sleep = opts.sleep ?? delay
  }

  async acquire(prompt: string): Promise<void> {
    const tokens = estimatePromptTokens(prompt)
    while (true) {
      const now = this.now()
      this.dropExpired(now)
      const callLimited = this.opts.rpm !== undefined && this.events.length >= this.opts.rpm
      const tokenLimited = this.opts.tpm !== undefined && this.usedTokens() + tokens > this.opts.tpm
      if (!callLimited && !tokenLimited) {
        this.events.push({ at: now, tokens })
        return
      }
      await this.sleep(Math.max(1, this.events[0]!.at + this.windowMs - now))
    }
  }

  private dropExpired(now: number): void {
    while (this.events.length > 0 && now - this.events[0]!.at >= this.windowMs) {
      this.events.shift()
    }
  }

  private usedTokens(): number {
    return this.events.reduce((sum, event) => sum + event.tokens, 0)
  }
}

export class ModelUsageTracker {
  private readonly summary: ModelUsageSummary = {
    byTier: {},
    byProvider: {},
    byModel: {},
    totals: { calls: 0, transportRetries: 0, escalations: 0, estimatedUsd: 0 },
  }

  record(options: LlmGenerateOptions, response: unknown): void {
    const result = typeof response === 'object' && response !== null
      ? (response as { result?: Record<string, unknown> }).result
      : undefined
    const usage = typeof result?.usage === 'object' && result.usage !== null
      ? result.usage as Record<string, unknown>
      : undefined
    const inputTokens = numberValue(usage?.inputTokens) ?? numberValue(usage?.input_tokens) ?? 0
    const outputTokens = numberValue(usage?.outputTokens) ?? numberValue(usage?.output_tokens) ?? 0
    const observedUsd = numberValue(result?.costUsd) ?? numberValue(result?.cost_usd)
    const estimatedUsd = observedUsd ?? 0
    const model = stringValue(result?.model) ?? options.model

    this.summary.totals.calls += 1
    this.summary.totals.estimatedUsd += estimatedUsd
    if (observedUsd !== undefined) this.summary.totals.observedUsd = (this.summary.totals.observedUsd ?? 0) + observedUsd
    if (options.tier === 'large') this.summary.totals.escalations += 1

    if (options.tier) addUsage(this.summary.byTier!, options.tier, inputTokens, outputTokens, estimatedUsd, observedUsd)
    if (options.provider) addUsage(this.summary.byProvider!, options.provider, inputTokens, outputTokens, estimatedUsd, observedUsd)
    if (model) addUsage(this.summary.byModel!, model, inputTokens, outputTokens, estimatedUsd, observedUsd)
  }

  recordTelemetry(event: LlmCallTelemetry): void {
    const inputTokens = event.usage.inputTokens
    const outputTokens = event.usage.outputTokens
    const estimatedUsd = event.costUsd ?? 0
    const observedUsd = event.costEstimated ? undefined : event.costUsd
    const failed = event.status === 'error'

    this.summary.totals.calls += 1
    this.summary.totals.estimatedUsd += estimatedUsd
    this.summary.totals.durationMs = (this.summary.totals.durationMs ?? 0) + event.durationMs
    this.summary.totals.failures = (this.summary.totals.failures ?? 0) + (failed ? 1 : 0)
    if (observedUsd !== undefined) this.summary.totals.observedUsd = (this.summary.totals.observedUsd ?? 0) + observedUsd
    if (event.tier === 'large') this.summary.totals.escalations += 1

    if (event.tier) addTelemetryUsage(this.summary.byTier!, event.tier, inputTokens, outputTokens, estimatedUsd, observedUsd, event.durationMs, failed)
    addTelemetryUsage(this.summary.byProvider!, event.provider, inputTokens, outputTokens, estimatedUsd, observedUsd, event.durationMs, failed)
    addTelemetryUsage(this.summary.byModel!, event.model, inputTokens, outputTokens, estimatedUsd, observedUsd, event.durationMs, failed)
    if (event.pass) {
      this.summary.byPass ??= {}
      addTelemetryUsage(this.summary.byPass, event.pass, inputTokens, outputTokens, estimatedUsd, observedUsd, event.durationMs, failed)
    }
  }

  recordTransportRetry(): void {
    this.summary.totals.transportRetries += 1
  }

  snapshot(): ModelUsageSummary {
    return structuredClone(this.summary)
  }
}

export function createLlmConcurrencyLimiter(policy: Pick<ResolvedStageLlmPolicy, 'concurrency' | 'providerConcurrency'>): LlmConcurrencyLimiter {
  return new LlmConcurrencyLimiter({
    globalMaxConcurrency: policy.concurrency,
    providerMaxConcurrency: policy.providerConcurrency,
  })
}

export function createBudgetLimiter(
  policy: Pick<ResolvedStageLlmPolicy, 'budgetGuard' | 'maxCalls' | 'maxLargeTierCalls' | 'maxEstimatedSpendUsd'>,
): BudgetLimiter | undefined {
  if (!policy.budgetGuard) return undefined
  if (
    policy.maxCalls === undefined
    && policy.maxLargeTierCalls === undefined
    && policy.maxEstimatedSpendUsd === undefined
  ) return undefined

  return new BudgetLimiter({
    maxCalls: policy.maxCalls,
    maxLargeTierCalls: policy.maxLargeTierCalls,
    maxEstimatedSpendUsd: policy.maxEstimatedSpendUsd,
  })
}

export function createRateLimiter(policy: Pick<ResolvedStageLlmPolicy, 'rpm' | 'tpm'>): LlmRateLimiter | undefined {
  if (policy.rpm === undefined && policy.tpm === undefined) return undefined
  return new LlmRateLimiter({ rpm: policy.rpm, tpm: policy.tpm })
}

export function limitLlmGenerateAdapter<T extends { generate(prompt: string, options?: LlmGenerateOptions): Promise<unknown> }>(
  adapter: T,
  limiter: LlmConcurrencyLimiter,
  policy?: Pick<ResolvedStageLlmPolicy, 'transportRetry' | 'transportBackoffBaseMs' | 'transportBackoffJitter'>,
  budgetLimiter?: BudgetLimiter,
  usageTracker?: ModelUsageTracker,
  rateLimiter?: LlmRateLimiter,
): T {
  return {
    ...adapter,
    generate(prompt: string, options?: LlmGenerateOptions) {
      if (!options?.provider) return adapter.generate(prompt, options)
      const call = async () => {
        const startedAtMs = Date.now()
        try {
          const response = await adapter.generate(prompt, options)
          usageTracker?.recordTelemetry(generateTelemetry(options, response, startedAtMs, 'success'))
          return response
        } catch (error) {
          usageTracker?.recordTelemetry(generateTelemetry(options, undefined, startedAtMs, 'error', error))
          throw error
        }
      }
      return limiter.run({ provider: options.provider }, () => {
        if (budgetLimiter && options.tier && options.model) {
          const acquired = budgetLimiter.acquire({
            tier: options.tier,
            provider: options.provider!,
            model: options.model,
            source: 'env',
          })
          if (!acquired.ok) throw new LlmBudgetExceededError(acquired)
        }
        const runCall = async () => {
          await rateLimiter?.acquire(prompt)
          return call()
        }
        if (!policy || !options.stage || !options.tier || !options.model || !options.attempt) return runCall()
        return withTransportRetry(runCall, {
          stage: options.stage,
          unitId: options.correlationId ?? 'unknown',
          attempt: options.attempt,
          target: {
            tier: options.tier,
            provider: options.provider!,
            model: options.model!,
            source: 'env',
          },
          maxRetries: policy.transportRetry,
          baseDelayMs: policy.transportBackoffBaseMs,
          jitterRatio: policy.transportBackoffJitter ? 0.2 : 0,
          signal: options.signal,
          onRetry: () => usageTracker?.recordTransportRetry(),
        })
      })
    },
  } as T
}

function generateTelemetry(
  options: LlmGenerateOptions,
  response: unknown,
  startedAtMs: number,
  status: 'success' | 'error',
  error?: unknown,
): LlmCallTelemetry {
  const finishedAtMs = Date.now()
  const result = typeof response === 'object' && response !== null
    ? (response as { result?: Record<string, unknown> }).result
    : undefined
  const usage = typeof result?.usage === 'object' && result.usage !== null
    ? result.usage as Record<string, unknown>
    : undefined
  const inputTokens = numberValue(usage?.inputTokens) ?? numberValue(usage?.input_tokens) ?? 0
  const outputTokens = numberValue(usage?.outputTokens) ?? numberValue(usage?.output_tokens) ?? 0
  const costUsd = numberValue(result?.costUsd) ?? numberValue(result?.cost_usd)

  return {
    provider: options.provider!,
    requestedModel: options.model ?? stringValue(result?.model) ?? 'unknown',
    model: stringValue(result?.model) ?? options.model ?? 'unknown',
    status,
    stage: options.stage,
    pass: options.pass,
    attempt: options.attempt,
    tier: options.tier,
    correlationId: options.correlationId,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    usage: {
      inputTokens,
      outputTokens,
      cacheCreationTokens: numberValue(usage?.cacheCreationTokens) ?? numberValue(usage?.cache_creation_tokens),
      cacheReadTokens: numberValue(usage?.cacheReadTokens) ?? numberValue(usage?.cache_read_tokens),
    },
    costUsd,
    costEstimated: false,
    errorName: error instanceof Error ? error.name : error === undefined ? undefined : typeof error,
    errorMessage: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
  }
}

function addUsage(
  buckets: Record<string, ModelUsageBucket>,
  key: string,
  inputTokens: number,
  outputTokens: number,
  estimatedUsd: number,
  observedUsd: number | undefined,
): void {
  const bucket = buckets[key] ?? { calls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 }
  bucket.calls += 1
  bucket.inputTokens += inputTokens
  bucket.outputTokens += outputTokens
  bucket.estimatedUsd += estimatedUsd
  if (observedUsd !== undefined) bucket.observedUsd = (bucket.observedUsd ?? 0) + observedUsd
  buckets[key] = bucket
}

function addTelemetryUsage(
  buckets: Record<string, ModelUsageBucket>,
  key: string,
  inputTokens: number,
  outputTokens: number,
  estimatedUsd: number,
  observedUsd: number | undefined,
  durationMs: number,
  failed: boolean,
): void {
  const bucket = buckets[key] ?? { calls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 }
  bucket.calls += 1
  bucket.inputTokens += inputTokens
  bucket.outputTokens += outputTokens
  bucket.estimatedUsd += estimatedUsd
  bucket.durationMs = (bucket.durationMs ?? 0) + durationMs
  bucket.failures = (bucket.failures ?? 0) + (failed ? 1 : 0)
  if (observedUsd !== undefined) bucket.observedUsd = (bucket.observedUsd ?? 0) + observedUsd
  buckets[key] = bucket
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function estimatePromptTokens(prompt: string): number {
  return Math.max(1, Math.ceil(prompt.length / 4))
}

class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    this.active += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      this.waiters.shift()?.()
    }
  }
}

export async function withTransportRetry<T>(
  fn: () => Promise<T>,
  opts: {
    stage: LlmStage
    unitId: string
    attempt: number
    target: ResolvedLlmTarget
    maxRetries?: number
    baseDelayMs?: number
    jitterRatio?: number
    signal?: AbortSignal
    onRetry?: (record: LlmAttemptRecord) => void
  },
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 5
  const baseDelayMs = opts.baseDelayMs ?? 500
  let transportAttempt = 0

  while (true) {
    throwIfAborted(opts.signal)
    try {
      return await fn()
    } catch (error) {
      transportAttempt += 1
      if (!isTransientLlmError(error) || transportAttempt > maxRetries) throw error

      const startedAt = new Date().toISOString()
      opts.onRetry?.({
        attempt: opts.attempt,
        stage: opts.stage,
        unitId: opts.unitId,
        tier: opts.target.tier,
        provider: opts.target.provider,
        model: opts.target.model,
        escalated: opts.target.tier === 'large',
        retryKind: 'transport',
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
      })
      await delay(backoffDelay(baseDelayMs, transportAttempt, opts.jitterRatio ?? 0.2), opts.signal)
    }
  }
}

export function isTransientLlmError(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null ? Number((error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode) : Number.NaN
  return status === 429 || (status >= 500 && status <= 599)
}

function defaultGenerationTier(stage: LlmStage): LlmTier {
  return stage === 'build_docs' ? 'small' : 'medium'
}

function defaultStageConcurrency(stage: LlmStage): number {
  return stage === 'build_epics' ? 5 : 1
}

function parseTier(value: string | undefined): LlmTier | undefined {
  return value === 'small' || value === 'medium' || value === 'large' ? value : undefined
}

function parseProvider(value: string | undefined): LlmProvider | undefined {
  return value === 'claude_code' || value === 'codex_sdk' || value === 'codex_cli' || value === 'claude_api' || value === 'openai_api' || value === 'gemini_api' || value === 'gemini_cli' ? value : undefined
}

function resolveProviderConcurrency(env: Env, globalMaxConcurrency: number | undefined): Partial<Record<LlmProvider, number>> | undefined {
  const values: Partial<Record<LlmProvider, number>> = {}
  assignProviderConcurrency(values, 'claude_code', env.PIPELINE_LLM_PROVIDER_CONCURRENCY_CLAUDE_CODE, globalMaxConcurrency)
  assignProviderConcurrency(values, 'codex_sdk', env.PIPELINE_LLM_PROVIDER_CONCURRENCY_CODEX_SDK, globalMaxConcurrency)
  assignProviderConcurrency(values, 'codex_cli', env.PIPELINE_LLM_PROVIDER_CONCURRENCY_CODEX_CLI, globalMaxConcurrency)
  assignProviderConcurrency(values, 'openai_api', env.PIPELINE_LLM_PROVIDER_CONCURRENCY_OPENAI_API, globalMaxConcurrency)
  assignProviderConcurrency(values, 'claude_api', env.PIPELINE_LLM_PROVIDER_CONCURRENCY_CLAUDE_API, globalMaxConcurrency)
  assignProviderConcurrency(values, 'gemini_api', env.PIPELINE_LLM_PROVIDER_CONCURRENCY_GEMINI_API, globalMaxConcurrency)
  assignProviderConcurrency(values, 'gemini_cli', env.PIPELINE_LLM_PROVIDER_CONCURRENCY_GEMINI_CLI, globalMaxConcurrency)
  return Object.keys(values).length > 0 ? values : undefined
}

function assignProviderConcurrency(
  values: Partial<Record<LlmProvider, number>>,
  provider: LlmProvider,
  raw: string | undefined,
  globalMaxConcurrency: number | undefined,
): void {
  const parsed = parsePositiveInt(raw)
  if (parsed !== undefined) values[provider] = capConcurrency(parsed, globalMaxConcurrency)
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parseNonNegativeInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function parseScore(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : undefined
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return undefined
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined
}

function assertPositiveLimit(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`${name} must be greater than 0`)
  }
}

function backoffDelay(baseDelayMs: number, attempt: number, jitterRatio: number): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1)
  return exponential + exponential * jitterRatio * Math.random()
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      { once: true },
    )
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('aborted')
}
