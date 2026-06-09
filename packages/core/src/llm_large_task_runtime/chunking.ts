import { LlmLargeTaskError } from './errors.js'
import { estimateTokens } from './token_estimator.js'
import type { TokenChunk, TokenEstimator } from './types.js'

export interface PlanTokenChunksInput<T> {
  items: T[]
  fixedPromptTokens: number
  targetInputTokens: number
  itemToText: (item: T) => string
  estimator: TokenEstimator
  overestimateRatio: number
  splitItem?: (item: T) => T[]
  maxItemsPerChunk?: number
}

export function planTokenChunks<T>(input: PlanTokenChunksInput<T>): Array<TokenChunk<T>> {
  const itemBudget = input.targetInputTokens - input.fixedPromptTokens
  if (itemBudget <= 0) {
    throw new LlmLargeTaskError('FIXED_PROMPT_OVERHEAD_EXCEEDS_TOKEN_BUDGET', 'Fixed prompt overhead exceeds token budget. recommended action: project_fixed_context', {
      fixedPromptTokens: input.fixedPromptTokens,
      targetInputTokens: input.targetInputTokens,
      recommendedAction: 'project_fixed_context',
    })
  }

  const expanded = expandOversizedItems(input.items, input, itemBudget)
  const chunks: Array<TokenChunk<T>> = []
  let current: T[] = []
  let currentTokens = 0
  for (const item of expanded) {
    const tokens = estimateTokens(input.itemToText(item), input.estimator, input.overestimateRatio)
    const itemCapReached = input.maxItemsPerChunk && current.length >= input.maxItemsPerChunk
    if (current.length > 0 && (currentTokens + tokens > itemBudget || itemCapReached)) {
      chunks.push(makeChunk(chunks.length, current, currentTokens + input.fixedPromptTokens))
      current = []
      currentTokens = 0
    }
    current.push(item)
    currentTokens += tokens
  }
  if (current.length > 0) chunks.push(makeChunk(chunks.length, current, currentTokens + input.fixedPromptTokens))
  return chunks
}

export function planReduceGroups<T>(input: PlanTokenChunksInput<T>): Array<TokenChunk<T>> {
  return planTokenChunks(input)
}

function expandOversizedItems<T>(items: T[], input: PlanTokenChunksInput<T>, itemBudget: number): T[] {
  const result: T[] = []
  for (const item of items) {
    const tokens = estimateTokens(input.itemToText(item), input.estimator, input.overestimateRatio)
    if (tokens <= itemBudget) {
      result.push(item)
      continue
    }
    if (!input.splitItem) {
      throw new LlmLargeTaskError('CHUNK_SPLIT_NO_PROGRESS', 'CHUNK_SPLIT_NO_PROGRESS: oversized item requires an item splitter.', {
        itemTokens: tokens,
        itemBudget,
      })
    }
    const split = input.splitItem(item)
    if (split.length === 0 || split.length === 1 && split[0] === item) {
      throw new LlmLargeTaskError('CHUNK_SPLIT_NO_PROGRESS', 'CHUNK_SPLIT_NO_PROGRESS: item splitter made no progress.', {
        itemTokens: tokens,
        itemBudget,
      })
    }
    for (const part of split) {
      const partTokens = estimateTokens(input.itemToText(part), input.estimator, input.overestimateRatio)
      if (partTokens > itemBudget) {
        throw new LlmLargeTaskError('CHUNK_SPLIT_NO_PROGRESS', 'CHUNK_SPLIT_NO_PROGRESS: split item still exceeds token budget.', {
          itemTokens: tokens,
          partTokens,
          itemBudget,
        })
      }
      result.push(part)
    }
  }
  return result
}

function makeChunk<T>(index: number, items: T[], estimatedTokens: number): TokenChunk<T> {
  return {
    id: `chunk-${String(index + 1).padStart(3, '0')}`,
    items,
    estimatedTokens,
  }
}
