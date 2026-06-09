import { asc, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DB } from '../db/client.js'
import type { EventKind, Lifecycle, RunKind, TriggeredBy } from '../db/schema/enums.js'
import {
  pipelineEvents,
  pipelineRuns,
  type NewPipelineEvent,
  type NewPipelineRun,
  type PipelineEvent,
  type PipelineRun,
} from '../db/schema/pipeline_runs.js'

export interface PipelineRuntimeOptions {
  readonly db: DB
  readonly idFactory?: () => string
}

export interface StartPipelineRunInput {
  readonly projectId: string
  readonly repoId?: string | null
  readonly kind: RunKind
  readonly triggeredBy?: TriggeredBy
  readonly totalSteps?: number
  readonly meta?: Record<string, unknown>
}

export interface RecordPipelineEventInput {
  readonly runId: string
  readonly stepId?: number | null
  readonly kind?: EventKind
  readonly visibility?: 'user' | 'admin'
  readonly message: string
  readonly messageKey?: string | null
  readonly messageParams?: Record<string, string | number | boolean | null>
  readonly data?: Record<string, unknown>
}

export interface FinishPipelineRunInput {
  readonly runId: string
  readonly status: Extract<Lifecycle, 'done' | 'failed' | 'cancelled' | 'waiting_for_user'>
  readonly errorMessage?: string | null
}

export class PipelineRuntime {
  private readonly db: DB
  private readonly idFactory: () => string

  constructor(options: PipelineRuntimeOptions) {
    this.db = options.db
    this.idFactory = options.idFactory ?? nanoid
  }

  startRun(input: StartPipelineRunInput): PipelineRun {
    const row: NewPipelineRun = {
      id: this.idFactory(),
      projectId: input.projectId,
      repoId: input.repoId ?? null,
      kind: input.kind,
      status: 'running',
      triggeredBy: input.triggeredBy,
      totalSteps: input.totalSteps,
      meta: input.meta,
    }
    this.db.insert(pipelineRuns).values(row).run()
    return this.getRun(row.id)
  }

  recordEvent(input: RecordPipelineEventInput): PipelineEvent {
    const row: NewPipelineEvent = {
      runId: input.runId,
      stepId: input.stepId ?? null,
      kind: input.kind ?? 'progress',
      visibility: input.visibility ?? 'user',
      message: input.message,
      messageKey: input.messageKey ?? null,
      messageParams: input.messageParams,
      data: input.data,
    }
    const inserted = this.db.insert(pipelineEvents).values(row).returning().get()
    if (!inserted) throw new Error('PIPELINE_EVENT_INSERT_FAILED')
    return inserted
  }

  finishRun(input: FinishPipelineRunInput): PipelineRun {
    this.db
      .update(pipelineRuns)
      .set({
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        finishedAt: sql`datetime('now')`,
      })
      .where(eq(pipelineRuns.id, input.runId))
      .run()
    return this.getRun(input.runId)
  }

  getRun(runId: string): PipelineRun {
    const run = this.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
    if (!run) throw new Error(`PIPELINE_RUN_NOT_FOUND: ${runId}`)
    return run
  }

  listEvents(runId: string): PipelineEvent[] {
    return this.db
      .select()
      .from(pipelineEvents)
      .where(eq(pipelineEvents.runId, runId))
      .orderBy(asc(pipelineEvents.id))
      .all()
  }
}

export function createPipelineRuntime(options: PipelineRuntimeOptions): PipelineRuntime {
  return new PipelineRuntime(options)
}
