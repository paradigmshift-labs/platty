import { LlmLargeTaskError } from './errors.js'
import { resolveModelProfile } from './model_profiles.js'
import { resolveTokenBudget } from './token_budget.js'
import { approximateCharsTokenEstimator, estimateTokens } from './token_estimator.js'
import { planReduceGroups, planTokenChunks } from './chunking.js'
import type {
  LlmLargeTaskPlan,
  LlmLargeTaskRequest,
  LlmLargeTaskSelectedMode,
  PlannedLlmCall,
  TokenEstimator,
  TokenChunk,
} from './types.js'

export function planLlmLargeTask<TItem, TOutput, TJudge>(
  request: LlmLargeTaskRequest<TItem, TOutput, TJudge>,
): LlmLargeTaskPlan<TItem> {
  const profile = resolveModelProfile({ provider: request.provider, model: request.model, override: request.profileOverride })
  const budget = resolveTokenBudget(profile, request.budgetRequest)
  const estimator = request.estimator ?? approximateCharsTokenEstimator
  const overestimateRatio = request.estimatorOverestimateRatio ?? profile.estimatorOverestimateRatio
  const fixedPromptTokens = estimateTokens(request.fixedPrompt, estimator, overestimateRatio)
  if (fixedPromptTokens >= budget.targetInputTokens && request.mode !== 'single') {
    throw new LlmLargeTaskError('FIXED_PROMPT_OVERHEAD_EXCEEDS_TOKEN_BUDGET', 'Fixed prompt overhead exceeds token budget. recommended action: project_fixed_context', {
      fixedPromptTokens,
      targetInputTokens: budget.targetInputTokens,
      recommendedAction: 'project_fixed_context',
    })
  }

  const selectedMode = selectMode(request, budget.targetInputTokens, estimator, overestimateRatio)
  const chunks = selectedMode === 'single'
    ? []
    : planTokenChunks({
      items: request.items,
      fixedPromptTokens,
      targetInputTokens: budget.targetInputTokens,
      itemToText: request.itemToText ?? defaultItemText,
      splitItem: request.splitItem,
      estimator,
      overestimateRatio,
      maxItemsPerChunk: request.maxItemsPerChunk,
    })

  const calls: PlannedLlmCall[] = []
  if (selectedMode === 'single') {
    const prompt = request.renderSinglePrompt?.(request.items) ?? JSON.stringify(request.items)
    calls.push(makeCall('single:1', 'single', estimateTokens(prompt, estimator, overestimateRatio), budget.maxOutputTokens))
  } else {
    for (const chunk of chunks) {
      const prompt = request.renderMapPrompt?.(chunk) ?? JSON.stringify(chunk.items)
      calls.push(makeCall(`map:${chunk.id}`, 'map', estimateTokens(prompt, estimator, overestimateRatio), budget.maxOutputTokens))
    }
  }

  let reduceGroups: Array<TokenChunk<unknown>> = []
  if (selectedMode === 'semantic_map_reduce') {
    reduceGroups = planReduceGroups({
      items: chunks.map((chunk) => ({ chunkId: chunk.id, estimatedTokens: chunk.estimatedTokens })),
      fixedPromptTokens: 0,
      targetInputTokens: budget.targetInputTokens,
      itemToText: (item) => (item as { chunkId?: string }).chunkId ?? JSON.stringify(item),
      estimator,
      overestimateRatio,
      maxItemsPerChunk: request.maxItemsPerReduceGroup,
    })
    for (const group of reduceGroups) {
      const prompt = request.renderReducePrompt?.(group.items) ?? JSON.stringify(group.items)
      calls.push(makeCall(`reduce:${group.id}`, 'reduce', estimateTokens(prompt, estimator, overestimateRatio), budget.maxOutputTokens))
    }
  }

  if (request.judge?.enabled) {
    calls.push(makeCall('judge:1', 'judge', fixedPromptTokens + 512, Math.min(2_000, budget.maxOutputTokens)))
  }

  const plannedConcurrency = Math.max(1, request.queue?.concurrency ?? Number(process.env.LLM_WORKER_QUEUE_CONCURRENCY ?? 10))
  const estimate = {
    expectedInputTokens: calls.reduce((sum, call) => sum + call.estimatedInputTokens, 0),
    expectedOutputTokens: calls.reduce((sum, call) => sum + call.estimatedOutputTokens, 0),
    plannedLlmCalls: calls.length,
    worstCaseProviderCalls: calls.length * Math.max(1, request.queue?.retry?.maxAttempts ?? 1),
    plannedConcurrency,
    expectedCostUsd: estimateCost(profile.inputCostPerMillionTokensUsd, profile.outputCostPerMillionTokensUsd, calls),
  }
  if (request.limits?.maxLlmCalls !== undefined && estimate.worstCaseProviderCalls > request.limits.maxLlmCalls) {
    throw new LlmLargeTaskError('PLAN_LLM_CALL_COUNT_EXCEEDS_LIMIT', 'Plan exceeds maxLlmCalls.', {
      worstCaseProviderCalls: estimate.worstCaseProviderCalls,
      maxLlmCalls: request.limits.maxLlmCalls,
    })
  }
  if (request.limits?.maxEstimatedCostUsd !== undefined && estimate.expectedCostUsd && estimate.expectedCostUsd.max > request.limits.maxEstimatedCostUsd) {
    throw new LlmLargeTaskError('PLAN_ESTIMATED_COST_EXCEEDS_LIMIT', 'Plan exceeds maxEstimatedCostUsd.', {
      estimatedCostUsd: estimate.expectedCostUsd.max,
      maxEstimatedCostUsd: request.limits.maxEstimatedCostUsd,
    })
  }

  return {
    name: request.name,
    selectedMode,
    profile,
    budget,
    chunks,
    reduceGroups,
    calls,
    estimate,
  }
}

function selectMode<TItem, TOutput, TJudge>(
  request: LlmLargeTaskRequest<TItem, TOutput, TJudge>,
  targetInputTokens: number,
  estimator: TokenEstimator,
  overestimateRatio: number,
): LlmLargeTaskSelectedMode {
  if (request.mode !== 'adaptive') return request.mode
  const prompt = request.renderSinglePrompt?.(request.items) ?? JSON.stringify(request.items)
  const singleTokens = estimateTokens(prompt, estimator, overestimateRatio)
  if (singleTokens <= targetInputTokens) return 'single'
  if (!request.adaptive?.fallbackMode) {
    throw new LlmLargeTaskError('ADAPTIVE_FALLBACK_REQUIRED', 'Adaptive task exceeded single-shot budget and has no fallback mode.', {
      singleTokens,
      targetInputTokens,
    })
  }
  return request.adaptive.fallbackMode
}

function makeCall(id: string, stage: PlannedLlmCall['stage'], estimatedInputTokens: number, estimatedOutputTokens: number): PlannedLlmCall {
  return { id, stage, estimatedInputTokens, estimatedOutputTokens }
}

function defaultItemText(item: unknown): string {
  return typeof item === 'string' ? item : JSON.stringify(item)
}

function estimateCost(
  inputCostPerMillionTokensUsd: number | undefined,
  outputCostPerMillionTokensUsd: number | undefined,
  calls: PlannedLlmCall[],
): { min: number; max: number } | undefined {
  if (inputCostPerMillionTokensUsd === undefined || outputCostPerMillionTokensUsd === undefined) return undefined
  const inputTokens = calls.reduce((sum, call) => sum + call.estimatedInputTokens, 0)
  const outputTokens = calls.reduce((sum, call) => sum + call.estimatedOutputTokens, 0)
  const max = inputTokens / 1_000_000 * inputCostPerMillionTokensUsd + outputTokens / 1_000_000 * outputCostPerMillionTokensUsd
  return { min: max * 0.5, max }
}
