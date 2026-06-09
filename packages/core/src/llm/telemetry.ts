import { estimateLlmCostUsd } from './pricing.js'
import type { LlmAdapter, LlmCallMetadata, LlmRequest, LlmResponse, LlmUsage } from './types.js'

export type LlmCallStatus = 'success' | 'error'

export interface LlmCallTelemetry extends LlmCallMetadata {
  provider: LlmAdapter['provider']
  requestedModel: string
  model: string
  status: LlmCallStatus
  startedAt: string
  finishedAt: string
  durationMs: number
  usage: LlmUsage
  costUsd?: number
  costEstimated: boolean
  errorName?: string
  errorMessage?: string
}

export interface LlmTelemetrySink {
  record(event: LlmCallTelemetry): void | Promise<void>
}

export interface InstrumentLlmAdapterOptions {
  now?: () => number
}

const ZERO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 }

export function instrumentLlmAdapter(
  adapter: LlmAdapter,
  sink?: LlmTelemetrySink,
  options: InstrumentLlmAdapterOptions = {},
): LlmAdapter {
  return {
    provider: adapter.provider,
    model: adapter.model,
    async call(req: LlmRequest): Promise<LlmResponse> {
      const now = options.now ?? Date.now
      const startedAtMs = now()
      try {
        const cost = normalizeResponseCost(adapter, await adapter.call(req))
        const response = cost.response
        const durationMs = elapsedMs(now, startedAtMs, response.durationMs)
        await safeRecord(sink, {
          ...metadata(req.telemetry),
          provider: adapter.provider,
          requestedModel: adapter.model,
          model: response.model,
          status: 'success',
          startedAt: new Date(startedAtMs).toISOString(),
          finishedAt: new Date(startedAtMs + durationMs).toISOString(),
          durationMs,
          usage: response.usage,
          costUsd: response.costUsd,
          costEstimated: cost.estimated,
        })
        return response
      } catch (error) {
        const durationMs = Math.max(0, now() - startedAtMs)
        await safeRecord(sink, {
          ...metadata(req.telemetry),
          provider: adapter.provider,
          requestedModel: adapter.model,
          model: adapter.model,
          status: 'error',
          startedAt: new Date(startedAtMs).toISOString(),
          finishedAt: new Date(startedAtMs + durationMs).toISOString(),
          durationMs,
          usage: ZERO_USAGE,
          costEstimated: false,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    },
  }
}

export function normalizeResponseCost(
  adapter: LlmAdapter,
  response: LlmResponse,
): { response: LlmResponse; estimated: boolean } {
  if (Number.isFinite(response.costUsd) && response.costUsd > 0) return { response, estimated: false }
  const estimate = estimateLlmCostUsd({
    provider: adapter.provider,
    model: response.model,
    usage: response.usage,
  })
  if (estimate.costUsd === undefined) return { response, estimated: false }
  return { response: { ...response, costUsd: estimate.costUsd }, estimated: true }
}

async function safeRecord(sink: LlmTelemetrySink | undefined, event: LlmCallTelemetry): Promise<void> {
  try {
    await sink?.record(event)
  } catch {
    // Telemetry must never change LLM call semantics.
  }
}

function elapsedMs(now: () => number, startedAtMs: number, responseDurationMs: number): number {
  const measured = Math.max(0, now() - startedAtMs)
  return measured > 0 ? measured : Math.max(0, responseDurationMs)
}

function metadata(value: LlmCallMetadata | undefined): LlmCallMetadata {
  return value ?? {}
}
