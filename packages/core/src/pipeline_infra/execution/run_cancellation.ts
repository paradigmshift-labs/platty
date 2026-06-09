import { and, eq, inArray } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { pipelineRunLinks } from '@/db/schema/project_analysis_v2.js'
import { pipelineEvents, pipelineRuns, pipelineSteps, type PipelineRun } from '@/db/schema/pipeline_runs.js'

export const CANCELLABLE_RUN_STATUSES = ['queued', 'running', 'waiting_for_user'] as const

export interface PipelineCancellationEvent {
  runId: string
  message: string
  createdAt: string
}

export interface CancelPipelineRunResult {
  run: PipelineRun | undefined
  cancelledRunIds: string[]
  events: PipelineCancellationEvent[]
}

export function isCancellableRunStatus(status: string): boolean {
  return CANCELLABLE_RUN_STATUSES.includes(status as (typeof CANCELLABLE_RUN_STATUSES)[number])
}

export function cancelPipelineRunRecord(db: DB, runId: string, message: string, now = new Date().toISOString()): CancelPipelineRunResult {
  const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
  const invalidatedMeta = invalidateWaitingResumeMeta(run?.meta, now, message)

  db.update(pipelineRuns)
    .set({
      status: 'cancelled',
      errorMessage: message,
      finishedAt: now,
      ...(invalidatedMeta ? { meta: invalidatedMeta } : {}),
    })
    .where(eq(pipelineRuns.id, runId))
    .run()

  db.update(pipelineSteps)
    .set({
      status: 'cancelled',
      errorMessage: message,
      finishedAt: now,
    })
    .where(and(
      eq(pipelineSteps.runId, runId),
      inArray(pipelineSteps.status, [...CANCELLABLE_RUN_STATUSES]),
    ))
    .run()

  db.insert(pipelineEvents).values({
    runId,
    kind: 'warning',
    message,
    createdAt: now,
  }).run()

  return {
    run: db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get(),
    cancelledRunIds: [runId],
    events: [{ runId, message, createdAt: now }],
  }
}

export function cancelPipelineRunWithProjectChildren(
  db: DB,
  run: PipelineRun,
  parentMessage: string,
  childMessage: string,
): CancelPipelineRunResult {
  const parentResult = cancelPipelineRunRecord(db, run.id, parentMessage)
  const cancelledRunIds = [...parentResult.cancelledRunIds]
  const events = [...parentResult.events]

  const links = db
    .select()
    .from(pipelineRunLinks)
    .where(eq(pipelineRunLinks.parentRunId, run.id))
    .all()

  for (const link of links) {
    const child = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, link.childRunId)).get()
    if (!child || child.projectId !== run.projectId || !isCancellableRunStatus(child.status)) continue

    const childResult = cancelPipelineRunRecord(db, child.id, childMessage)
    cancelledRunIds.push(...childResult.cancelledRunIds)
    events.push(...childResult.events)
  }

  return {
    run: parentResult.run,
    cancelledRunIds,
    events,
  }
}

function invalidateWaitingResumeMeta(meta: unknown, cancelledAt: string, reason: string): Record<string, unknown> | null {
  if (typeof meta !== 'object' || meta === null) return null
  const record = meta as Record<string, unknown>
  const waiting = record.waitingForUser
  if (typeof waiting !== 'object' || waiting === null) return null
  return {
    ...record,
    waitingForUser: {
      ...(waiting as Record<string, unknown>),
      resumeToken: null,
      cancelledAt,
      cancelledReason: reason,
    },
  }
}
