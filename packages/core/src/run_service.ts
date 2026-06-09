import { desc, eq } from 'drizzle-orm'
import type { DB } from './db/client.js'
import { pipelineRuns } from './db/schema/pipeline_runs.js'

export interface ListRunsInput {
  projectId?: string
}

export interface CancelRunInput {
  runId: string
  reason?: string
}

export type CancelRunResult =
  | { kind: 'cancelled'; run: typeof pipelineRuns.$inferSelect }
  | { kind: 'missing' }
  | { kind: 'not_cancellable'; run: typeof pipelineRuns.$inferSelect }

export function listRuns(db: DB, input: ListRunsInput = {}) {
  if (input.projectId) {
    return db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.projectId, input.projectId))
      .orderBy(desc(pipelineRuns.startedAt))
      .all()
  }

  return db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)).all()
}

export function getRun(db: DB, runId: string) {
  return db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get() ?? null
}

export function cancelRun(db: DB, input: CancelRunInput): CancelRunResult {
  const run = getRun(db, input.runId)
  if (!run) return { kind: 'missing' }
  if (!['queued', 'running', 'waiting_for_user'].includes(run.status)) {
    return { kind: 'not_cancellable', run }
  }

  const finishedAt = new Date().toISOString()
  db.update(pipelineRuns)
    .set({
      status: 'cancelled',
      errorMessage: input.reason ?? 'Cancelled by user',
      finishedAt,
    })
    .where(eq(pipelineRuns.id, run.id))
    .run()

  const cancelled = getRun(db, run.id)
  if (!cancelled) return { kind: 'missing' }
  return { kind: 'cancelled', run: cancelled }
}
