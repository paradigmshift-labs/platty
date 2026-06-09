import type { ChunkPlanner, TokenBudget } from './gateway_types.js'

export interface TokenAwareChunkPlannerOptions<TProjection, TItem, TChunk> {
  getItems(projection: TProjection): TItem[]
  getItemId(item: TItem): string
  getChunkItems(chunk: TChunk): TItem[]
  buildChunk(input: { id: string; items: TItem[] }): TChunk
  getChunkPrompt(chunk: TChunk): string
  maxItemsPerChunk?: number
  chunkIdPrefix?: string
}

export function createTokenAwareChunkPlanner<TProjection, TItem, TChunk>(
  options: TokenAwareChunkPlannerOptions<TProjection, TItem, TChunk>,
): ChunkPlanner<TProjection, TChunk> {
  const maxItemsPerChunk = positiveInt(options.maxItemsPerChunk) ?? Number.POSITIVE_INFINITY
  const prefix = options.chunkIdPrefix ?? 'chunk'

  return {
    plan({ projection, tokenBudget, estimateTokens }) {
      const items = options.getItems(projection)
      return packItemsIntoTokenAwareChunks({
        items,
        tokenBudget,
        estimateTokens,
        maxItemsPerChunk,
        buildChunk: (chunkItems, index) => options.buildChunk({ id: `${prefix}:${index + 1}`, items: chunkItems }),
        getChunkPrompt: options.getChunkPrompt,
      })
    },
    splitOversizedChunk({ chunk }) {
      const items = options.getChunkItems(chunk)
      if (items.length <= 1) return [chunk]
      const midpoint = Math.ceil(items.length / 2)
      return [
        options.buildChunk({ id: `${getChunkIdLike(prefix, chunk)}a`, items: items.slice(0, midpoint) }),
        options.buildChunk({ id: `${getChunkIdLike(prefix, chunk)}b`, items: items.slice(midpoint) }),
      ]
    },
  }
}

export interface PlanTokenAwareReduceGroupsOptions<TItem> {
  tokenBudget: TokenBudget
  estimateTokens(prompt: string): number
  buildPrompt(items: TItem[]): string
}

export function planTokenAwareReduceGroups<TItem>(
  items: TItem[],
  options: PlanTokenAwareReduceGroupsOptions<TItem>,
): TItem[][] {
  const maxReduceGroupSize = positiveInt(options.tokenBudget.maxReduceGroupSize) ?? Number.POSITIVE_INFINITY
  return packItemsIntoTokenGroups({
    items,
    targetTokens: options.tokenBudget.reduceTargetInputTokens ?? options.tokenBudget.targetInputTokens,
    maxTokens: options.tokenBudget.maxInputTokens,
    maxItemsPerGroup: maxReduceGroupSize,
    estimateTokens: options.estimateTokens,
    buildPrompt: options.buildPrompt,
    minItemsPerGroupWhenPossible: 2,
  })
}

function packItemsIntoTokenAwareChunks<TItem, TChunk>(input: {
  items: TItem[]
  tokenBudget: TokenBudget
  estimateTokens(prompt: string): number
  maxItemsPerChunk: number
  buildChunk(items: TItem[], index: number): TChunk
  getChunkPrompt(chunk: TChunk): string
}): TChunk[] {
  const groups = packItemsIntoTokenGroups({
    items: input.items,
    targetTokens: input.tokenBudget.targetInputTokens,
    maxItemsPerGroup: input.maxItemsPerChunk,
    estimateTokens: input.estimateTokens,
    buildPrompt: (items) => input.getChunkPrompt(input.buildChunk(items, 0)),
  })
  return groups.map((items, index) => input.buildChunk(items, index))
}

function packItemsIntoTokenGroups<TItem>(input: {
  items: TItem[]
  targetTokens: number
  maxTokens?: number
  maxItemsPerGroup: number
  estimateTokens(prompt: string): number
  buildPrompt(items: TItem[]): string
  minItemsPerGroupWhenPossible?: number
}): TItem[][] {
  const targetTokens = Math.max(1, Math.floor(input.targetTokens))
  const maxTokens = Math.max(targetTokens, Math.floor(input.maxTokens ?? targetTokens))
  const maxItemsPerGroup = positiveInt(input.maxItemsPerGroup) ?? Number.POSITIVE_INFINITY
  const minItemsPerGroupWhenPossible = positiveInt(input.minItemsPerGroupWhenPossible) ?? 1
  const groups: TItem[][] = []
  let current: TItem[] = []

  for (const item of input.items) {
    const next = [...current, item]
    const exceedsItemGuard = next.length > maxItemsPerGroup
    const nextTokens = input.estimateTokens(input.buildPrompt(next))
    const exceedsTokenTarget = current.length > 0
      && nextTokens > targetTokens
      && (current.length >= minItemsPerGroupWhenPossible || nextTokens > maxTokens)

    if (exceedsItemGuard || exceedsTokenTarget) {
      groups.push(current)
      current = [item]
      continue
    }

    current = next
  }

  if (current.length > 0) groups.push(current)
  return groups
}

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const next = Math.floor(value)
  return next > 0 ? next : undefined
}

function getChunkIdLike(prefix: string, chunk: unknown): string {
  if (chunk && typeof chunk === 'object' && 'id' in chunk && typeof chunk.id === 'string') return chunk.id
  return `${prefix}:split`
}
