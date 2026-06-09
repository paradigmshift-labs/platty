import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { projects, repositories } from './core.js'
import { lifecycleEnum, runKindEnum, llmProviderEnum, eventKindEnum, triggeredByEnum } from './enums.js'
import type { PipelineRunMeta } from '@/pipeline_modules/shared/pipeline_run_meta.js'

/**
 * Pipeline run / step / event — 실행 lifecycle + 진행 상황 SSE.
 *
 * 두 목적 (specs/refactor/v2_migration_plan.md §10):
 *   A. 디버깅 — phase/step별 토큰/비용/error stack/raw 로그 파일 경로
 *   B. 유저 진행 체크 — SSE로 실시간 progress 전달 + DB replay
 *
 * 보관 정책:
 *   - pipeline_events: run done 후 7일 자동 삭제 (별 cron, M1 비범위)
 *   - pipeline_runs / pipeline_steps: 무기한 누적 (디버깅 가치)
 */

// ────────────────────────────────────────
// pipeline_runs
// ────────────────────────────────────────
export const pipelineRuns = sqliteTable(
  'pipeline_runs',
  {
    id: text('id').primaryKey(),                                  // nanoid()
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repoId: text('repo_id').references(() => repositories.id, { onDelete: 'cascade' }), // NULL=project-level run

    kind: text('kind', { enum: runKindEnum }).notNull(),
    status: text('status', { enum: lifecycleEnum }).notNull().default('queued'),

    triggeredBy: text('triggered_by', { enum: triggeredByEnum }),

    totalSteps: integer('total_steps'),
    completedSteps: integer('completed_steps').notNull().default(0),

    errorMessage: text('error_message'),
    meta: text('meta', { mode: 'json' }).$type<PipelineRunMeta>(),

    startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
    finishedAt: text('finished_at'),
  },
  (t) => [
    index('idx_pipeline_runs_project').on(t.projectId, t.startedAt),
    index('idx_pipeline_runs_repo').on(t.repoId, t.startedAt),
    index('idx_pipeline_runs_status').on(t.status),
  ],
)

export type PipelineRun = typeof pipelineRuns.$inferSelect
export type NewPipelineRun = typeof pipelineRuns.$inferInsert

// ────────────────────────────────────────
// pipeline_steps
// ────────────────────────────────────────
export const pipelineSteps = sqliteTable(
  'pipeline_steps',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id')
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: 'cascade' }),

    phase: text('phase').notNull(),                               // 'build_docs' 등 모듈 ID
    step: text('step').notNull(),                                 // 'F2:extract' 등 step ID
    label: text('label'),                                         // 사람 가독 — UI용

    status: text('status', { enum: lifecycleEnum }).notNull().default('queued'),
    durationMs: integer('duration_ms'),

    // LLM 메타 (P12) — 한 step 여러 호출 시 누적
    llmProvider: text('llm_provider', { enum: llmProviderEnum }), // 마지막 호출의 provider
    model: text('model'),                                         // 마지막 호출의 모델
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheCreationTokens: integer('cache_creation_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    costUsd: real('cost_usd'),

    errorMessage: text('error_message'),
    errorStack: text('error_stack'),

    logFile: text('log_file'),                                    // 'logs/runs/<runId>/<stepId>.json'
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),

    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (t) => [index('idx_pipeline_steps_run').on(t.runId, t.id)],
)

export type PipelineStep = typeof pipelineSteps.$inferSelect
export type NewPipelineStep = typeof pipelineSteps.$inferInsert

// ────────────────────────────────────────
// pipeline_events
// ────────────────────────────────────────
export const pipelineEvents = sqliteTable(
  'pipeline_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id')
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
    stepId: integer('step_id').references(() => pipelineSteps.id, { onDelete: 'cascade' }), // NULL=run-level

    kind: text('kind', { enum: eventKindEnum }).notNull(),
    visibility: text('visibility', { enum: ['user', 'admin'] }).notNull().default('user'),
    messageKey: text('message_key'),
    messageParams: text('message_params', { mode: 'json' }).$type<Record<string, string | number | boolean | null>>(),
    message: text('message').notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),

    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_pipeline_events_run').on(t.runId, t.id),
    index('idx_pipeline_events_run_visibility').on(t.runId, t.visibility, t.id),
  ],
)

export type PipelineEvent = typeof pipelineEvents.$inferSelect
export type NewPipelineEvent = typeof pipelineEvents.$inferInsert
