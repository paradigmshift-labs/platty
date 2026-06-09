import type { LlmProvider, LlmUsage } from './types.js'

export interface LlmModelPricing {
  inputPer1M: number
  outputPer1M: number
  cacheCreationPer1M?: number
  cacheReadPer1M?: number
}

export interface LlmCostEstimateInput {
  provider: LlmProvider
  model: string
  usage: LlmUsage
  catalog?: LlmPricingCatalog
}

export interface LlmCostEstimate {
  costUsd: number | undefined
  estimated: boolean
}

export type LlmPricingCatalog = Partial<Record<LlmProvider, Record<string, LlmModelPricing>>>

export const DEFAULT_LLM_PRICING_CATALOG: LlmPricingCatalog = {
  openai_api: {
    'gpt-4.1-mini': { inputPer1M: 0.40, outputPer1M: 1.60 },
    'gpt-4.1': { inputPer1M: 2.00, outputPer1M: 8.00 },
    'o4-mini': { inputPer1M: 1.10, outputPer1M: 4.40 },
  },
  claude_api: {
    'claude-haiku-4-5': {
      inputPer1M: 1,
      outputPer1M: 5,
      cacheCreationPer1M: 1.25,
      cacheReadPer1M: 0.20,
    },
    'claude-sonnet-4-5': {
      inputPer1M: 3,
      outputPer1M: 15,
      cacheCreationPer1M: 3.75,
      cacheReadPer1M: 0.30,
    },
    'claude-opus-4-1-20250805': {
      inputPer1M: 15,
      outputPer1M: 75,
      cacheCreationPer1M: 18.75,
      cacheReadPer1M: 1.50,
    },
  },
  claude_code: {
    'claude-haiku-4-5': {
      inputPer1M: 1,
      outputPer1M: 5,
      cacheCreationPer1M: 1.25,
      cacheReadPer1M: 0.20,
    },
    'claude-sonnet-4-6': {
      inputPer1M: 3,
      outputPer1M: 15,
      cacheCreationPer1M: 3.75,
      cacheReadPer1M: 0.30,
    },
    'claude-opus-4-7': {
      inputPer1M: 15,
      outputPer1M: 75,
      cacheCreationPer1M: 18.75,
      cacheReadPer1M: 1.50,
    },
  },
  gemini_api: {
    'gemini-3.5-flash': { inputPer1M: 1.50, outputPer1M: 9.00 },
    'gemini-2.0-flash': { inputPer1M: 0.10, outputPer1M: 0.40 },
  },
}

export function getLlmModelPricing(
  provider: LlmProvider,
  model: string,
  catalog: LlmPricingCatalog = DEFAULT_LLM_PRICING_CATALOG,
): LlmModelPricing | undefined {
  return catalog[provider]?.[model]
}

export function estimateLlmCostUsd(input: LlmCostEstimateInput): LlmCostEstimate {
  const pricing = getLlmModelPricing(input.provider, input.model, input.catalog)
  if (!pricing) return { costUsd: undefined, estimated: false }

  const usage = input.usage
  const costUsd = (
    usage.inputTokens * pricing.inputPer1M
    + usage.outputTokens * pricing.outputPer1M
    + (usage.cacheCreationTokens ?? 0) * (pricing.cacheCreationPer1M ?? pricing.inputPer1M)
    + (usage.cacheReadTokens ?? 0) * (pricing.cacheReadPer1M ?? pricing.inputPer1M)
  ) / 1_000_000

  return { costUsd, estimated: true }
}
