import { LlmLargeTaskError, errorCode } from './errors.js'
import { LlmGatewayError } from './gateway_types.js'
import type { LlmWorkerQueueCall, LlmWorkerQueueOptions } from './types.js'

const RETRYABLE_CODES = new Set(['LLM_PROVIDER_RATE_LIMITED', 'LLM_PROVIDER_TIMEOUT', 'LLM_PROVIDER_UNAVAILABLE'])

export interface LlmWorkerQueue {
  runAll<T>(calls: Array<LlmWorkerQueueCall<T>>): Promise<T[]>
}

export async function mapWithWorkerQueue<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const concurrency = Math.max(1, Math.floor(limit))
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      throwIfStopped(signal)
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index]!, index)
    }
  })

  await Promise.all(workers)
  return results
}

export function throwIfStopped(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw new LlmGatewayError('TASK_STOPPED', 'LLM gateway task was stopped.', {
    details: { reason: String(signal.reason ?? 'aborted') },
  })
}

export function createLlmWorkerQueue(options: Partial<LlmWorkerQueueOptions> = {}): LlmWorkerQueue {
  const config: LlmWorkerQueueOptions = {
    concurrency: Math.max(1, Math.floor(options.concurrency ?? Number(process.env.LLM_WORKER_QUEUE_CONCURRENCY ?? 10))),
    tenantConcurrency: options.tenantConcurrency,
    providerConcurrency: options.providerConcurrency,
    modelConcurrency: options.modelConcurrency,
    queueDepthLimit: options.queueDepthLimit,
    retry: options.retry ?? { maxAttempts: 1, backoffMs: () => 0 },
    onEvent: options.onEvent,
  }
  return {
    async runAll<T>(calls: Array<LlmWorkerQueueCall<T>>): Promise<T[]> {
      if (config.queueDepthLimit !== undefined && calls.length > config.queueDepthLimit) {
        throw new LlmLargeTaskError('QUEUE_DEPTH_EXCEEDED', 'Queue depth limit exceeded.', {
          queueDepthLimit: config.queueDepthLimit,
          callCount: calls.length,
        })
      }
      const results: T[] = new Array(calls.length)
      let cursor = 0
      let active = 0

      return await new Promise<T[]>((resolve, reject) => {
        let settled = false
        const pump = (): void => {
          if (settled) return
          while (active < limitForNextCall(calls[cursor], config) && cursor < calls.length) {
            const index = cursor
            const call = calls[index]!
            cursor += 1
            active += 1
            config.onEvent?.({ type: 'queued', id: call.id, queueDepth: calls.length - cursor })
            void runWithRetry(call, config, () => active)
              .then((value) => {
                results[index] = value
              })
              .catch((error: unknown) => {
                settled = true
                reject(error)
              })
              .finally(() => {
                active -= 1
                if (settled) return
                if (cursor >= calls.length && active === 0) {
                  settled = true
                  resolve(results)
                  return
                }
                pump()
              })
          }
        }
        pump()
      })
    },
  }
}

async function runWithRetry<T>(call: LlmWorkerQueueCall<T>, config: LlmWorkerQueueOptions, active: () => number): Promise<T> {
  const retry = config.retry ?? { maxAttempts: 1, backoffMs: () => 0 }
  const maxAttempts = Math.max(1, retry.maxAttempts)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    config.onEvent?.({ type: 'started', id: call.id, active: active(), attempt })
    try {
      const result = await call.execute(attempt)
      config.onEvent?.({ type: 'finished', id: call.id, active: active(), attempt })
      return result
    } catch (error) {
      const code = errorCode(error)
      config.onEvent?.({ type: 'failed', id: call.id, active: active(), attempt, code })
      const retryable = retry.isRetryable?.(error) ?? RETRYABLE_CODES.has(code)
      if (!retryable || attempt >= maxAttempts) throw error
      const waitMs = retry.backoffMs(attempt, error)
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
  throw new Error('unreachable retry state')
}

function limitForNextCall(call: LlmWorkerQueueCall<unknown> | undefined, config: LlmWorkerQueueOptions): number {
  if (!call) return config.concurrency
  const limits = [config.concurrency]
  if (call.tenantId && config.tenantConcurrency?.[call.tenantId]) limits.push(config.tenantConcurrency[call.tenantId]!)
  if (config.providerConcurrency?.[call.provider]) limits.push(config.providerConcurrency[call.provider]!)
  const modelKey = `${call.provider}/${call.model}`
  if (config.modelConcurrency?.[modelKey]) limits.push(config.modelConcurrency[modelKey]!)
  return Math.max(1, Math.min(...limits))
}
