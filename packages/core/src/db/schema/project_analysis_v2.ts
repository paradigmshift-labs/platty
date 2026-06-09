import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { entryPoints } from './build_route.js'
import { pipelineRuns } from './pipeline_runs.js'
import { projects, repositories } from './core.js'

export type AnalysisReviewTargetType = 'route' | 'screen' | 'job' | 'event'
export type AnalysisReviewTargetSource = 'entry_point'
export type AnalysisReviewDecision = 'include' | 'deprecated'
export type AnalysisReviewReason = 'user_manual' | 'unused_screen_candidate' | 'sync_preserved' | 'restored'

export const analysisReviewDecisions = sqliteTable(
  'analysis_review_decisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repoId: text('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull().$type<AnalysisReviewTargetType>(),
    targetId: text('target_id')
      .notNull()
      .references(() => entryPoints.id, { onDelete: 'cascade' }),
    targetSource: text('target_source').notNull().default('entry_point').$type<AnalysisReviewTargetSource>(),
    decision: text('decision').notNull().$type<AnalysisReviewDecision>(),
    reason: text('reason').notNull().$type<AnalysisReviewReason>(),
    note: text('note'),
    decidedBy: text('decided_by'),
    decidedAt: text('decided_at').notNull().default(sql`(datetime('now'))`),
    sourceRunId: text('source_run_id'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_analysis_review_decisions_target').on(t.projectId, t.repoId, t.targetType, t.targetId),
    index('idx_analysis_review_decisions_project_repo').on(t.projectId, t.repoId),
    index('idx_analysis_review_decisions_project_decision').on(t.projectId, t.decision),
  ],
)

export type AnalysisReviewDecisionRow = typeof analysisReviewDecisions.$inferSelect
export type NewAnalysisReviewDecisionRow = typeof analysisReviewDecisions.$inferInsert

export type PipelineRunLinkRelation = 'orchestrates' | 'retries' | 'resumes' | 'refreshes' | 'supersedes'

export const pipelineRunLinks = sqliteTable(
  'pipeline_run_links',
  {
    id: text('id').primaryKey(),
    parentRunId: text('parent_run_id')
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
    childRunId: text('child_run_id')
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
    relation: text('relation').notNull().$type<PipelineRunLinkRelation>(),
    phase: text('phase'),
    repoId: text('repo_id').references(() => repositories.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_pipeline_run_links_unique').on(t.parentRunId, t.childRunId, t.relation),
    index('idx_pipeline_run_links_parent').on(t.parentRunId),
    index('idx_pipeline_run_links_child').on(t.childRunId),
    index('idx_pipeline_run_links_repo').on(t.repoId),
  ],
)

export type PipelineRunLink = typeof pipelineRunLinks.$inferSelect
export type NewPipelineRunLink = typeof pipelineRunLinks.$inferInsert
