import { LlmLargeTaskError } from './errors.js'
import type { LlmModelContextProfile, ResolveModelProfileInput } from './types.js'

const BUILT_IN_PROFILES: LlmModelContextProfile[] = [
  {
    provider: 'openai',
    model: 'gpt-5.5',
    source: 'built_in',
    contextWindowTokens: 400_000,
    maxOutputTokens: 128_000,
    defaultOutputReserveTokens: 32_000,
    reasoningReserveTokens: 16_000,
    safetyMarginTokens: 8_000,
    estimatorId: 'approx_chars',
    estimatorOverestimateRatio: 1.15,
    inputCostPerMillionTokensUsd: 2,
    outputCostPerMillionTokensUsd: 10,
  },
  {
    provider: 'openai',
    model: 'gpt-5.4',
    source: 'built_in',
    contextWindowTokens: 400_000,
    maxOutputTokens: 128_000,
    defaultOutputReserveTokens: 32_000,
    reasoningReserveTokens: 16_000,
    safetyMarginTokens: 8_000,
    estimatorId: 'approx_chars',
    estimatorOverestimateRatio: 1.15,
  },
  {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    source: 'built_in',
    contextWindowTokens: 200_000,
    maxOutputTokens: 64_000,
    defaultOutputReserveTokens: 16_000,
    reasoningReserveTokens: 8_000,
    safetyMarginTokens: 4_000,
    estimatorId: 'approx_chars',
    estimatorOverestimateRatio: 1.15,
  },
]

export function resolveModelProfile(input: ResolveModelProfileInput): LlmModelContextProfile {
  if (input.override) return assertCompleteProfile({ ...input.override, source: 'run_override' })
  const profile = BUILT_IN_PROFILES.find((candidate) =>
    candidate.provider === input.provider && candidate.model === input.model)
  if (!profile) {
    throw new LlmLargeTaskError('MODEL_PROFILE_NOT_FOUND', `Model profile not found for ${input.provider}/${input.model}.`, {
      provider: input.provider,
      model: input.model,
    })
  }
  return profile
}

function assertCompleteProfile(profile: LlmModelContextProfile): LlmModelContextProfile {
  const numericFields: Array<keyof Pick<LlmModelContextProfile,
    'contextWindowTokens' | 'maxOutputTokens' | 'defaultOutputReserveTokens' | 'reasoningReserveTokens' | 'safetyMarginTokens' | 'estimatorOverestimateRatio'>> = [
    'contextWindowTokens',
    'maxOutputTokens',
    'defaultOutputReserveTokens',
    'reasoningReserveTokens',
    'safetyMarginTokens',
    'estimatorOverestimateRatio',
  ]
  for (const field of numericFields) {
    if (typeof profile[field] !== 'number' || Number.isNaN(profile[field])) {
      throw new LlmLargeTaskError('MODEL_PROFILE_NOT_FOUND', `Run override model profile is missing ${field}.`, { field })
    }
  }
  if (!profile.provider || !profile.model || !profile.estimatorId) {
    throw new LlmLargeTaskError('MODEL_PROFILE_NOT_FOUND', 'Run override model profile is incomplete.')
  }
  return profile
}
