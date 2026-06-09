import type { TokenEstimator } from './types.js'

export const approximateCharsTokenEstimator: TokenEstimator = {
  id: 'approx_chars',
  estimate(text: string): number {
    return Math.ceil(text.length / 4)
  },
}

export function estimateTokens(text: string, estimator: TokenEstimator = approximateCharsTokenEstimator, overestimateRatio = 1): number {
  return Math.ceil(estimator.estimate(text) * overestimateRatio)
}

export function createTokenEstimator(options: { charsPerToken?: number; safetyMargin?: number } = {}): (prompt: string) => number {
  const charsPerToken = positiveNumber(options.charsPerToken) ?? 4
  const safetyMargin = positiveNumber(options.safetyMargin) ?? 1.15

  return (prompt: string): number => {
    const trimmed = prompt.trim()
    if (!trimmed) return 0
    const whitespaceTokens = trimmed.split(/\s+/).length
    const charTokens = Math.ceil(trimmed.length / charsPerToken)
    return Math.ceil(Math.max(whitespaceTokens, charTokens) * safetyMargin)
  }
}

function positiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value
}
