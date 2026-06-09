import { EventEmitter } from 'node:events'

export type ProgressEventKind = 'progress' | 'log' | 'warning' | 'milestone' | 'requires_user_action' | 'resumed'

export interface ProgressEvent {
  kind: ProgressEventKind
  message: string
  data?: Record<string, unknown>
  /** ISO 8601. publish 시 자동 부여 */
  timestamp?: string
}

const bus = new EventEmitter()
// 큰 run에서 listener 많아질 수 있어 상한 완화
bus.setMaxListeners(0)

export const progressBus = {
  publish(runId: string, event: ProgressEvent): void {
    const enriched: ProgressEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    }
    bus.emit(`run:${runId}`, enriched)
  },
  subscribe(runId: string, handler: (e: ProgressEvent) => void): () => void {
    const channel = `run:${runId}`
    bus.on(channel, handler)
    return () => bus.off(channel, handler)
  },
}
