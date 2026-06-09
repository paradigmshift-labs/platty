import { LlmLargeTaskError } from './errors.js'
import type { LlmModelContextProfile, ResolvedTokenBudget, TokenBudgetRequest } from './types.js'

const MAX_TARGET_RATIO = 0.95

export function resolveTokenBudget(profile: LlmModelContextProfile, request: TokenBudgetRequest = {}): ResolvedTokenBudget {
  const maxOutputTokens = Math.min(request.maxOutputTokens ?? profile.defaultOutputReserveTokens, profile.maxOutputTokens)
  const reasoningReserveTokens = request.reasoningReserveTokens ?? profile.reasoningReserveTokens
  const safetyMarginTokens = request.safetyMarginTokens ?? profile.safetyMarginTokens
  const maxSafeInputTokens = profile.contextWindowTokens - maxOutputTokens - reasoningReserveTokens - safetyMarginTokens
  if (maxSafeInputTokens <= 0) {
    throw new LlmLargeTaskError('TOKEN_BUDGET_INVALID', 'Output, reasoning, and safety reserves exceed model context window.', {
      contextWindowTokens: profile.contextWindowTokens,
      maxOutputTokens,
      reasoningReserveTokens,
      safetyMarginTokens,
    })
  }

  const ratio = request.targetInputRatio ?? 0.9
  if (ratio <= 0 || ratio > MAX_TARGET_RATIO) {
    throw new LlmLargeTaskError('TOKEN_BUDGET_INVALID', `targetInputRatio must be > 0 and <= ${MAX_TARGET_RATIO}.`, { targetInputRatio: ratio })
  }

  const targetInputTokens = request.targetInputTokens
    ? Math.min(request.targetInputTokens, maxSafeInputTokens)
    : Math.floor(maxSafeInputTokens * ratio)
  if (targetInputTokens <= 0) {
    throw new LlmLargeTaskError('TOKEN_BUDGET_INVALID', 'targetInputTokens must be positive.', { targetInputTokens })
  }

  return {
    source: 'model_profile',
    maxSafeInputTokens,
    targetInputTokens,
    maxOutputTokens,
    reasoningReserveTokens,
    safetyMarginTokens,
  }
}
