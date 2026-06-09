import { asc, eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { pipelineEvents } from '@/db/schema/pipeline_runs.js'
import type { EventKind } from '@/db/schema/enums.js'

export interface ReplayedPipelineProgressEvent {
  id: number
  runId: string
  stepId: number | null
  kind: EventKind
  message: string
  data?: Record<string, unknown> | null
  createdAt: string
}

export function replayPipelineProgressEvents(db: DB, runId: string): ReplayedPipelineProgressEvent[] {
  return db
    .select({
      id: pipelineEvents.id,
      runId: pipelineEvents.runId,
      stepId: pipelineEvents.stepId,
      kind: pipelineEvents.kind,
      visibility: pipelineEvents.visibility,
      message: pipelineEvents.message,
      data: pipelineEvents.data,
      createdAt: pipelineEvents.createdAt,
    })
    .from(pipelineEvents)
    .where(eq(pipelineEvents.runId, runId))
    .orderBy(asc(pipelineEvents.id))
    .all()
    .filter((event) => event.visibility === 'user')
    .map(({ visibility: _visibility, ...event }) => event)
}
