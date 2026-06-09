import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { documents } from './build_docs.js'
import { epics, projects } from './core.js'
import type {
  BusinessDocsContextManifest,
  BusinessDocsContextPageKind,
  BusinessDocsGenerationRunStatus,
  BusinessDocsGenerationTaskStatus,
  BusinessDocsPreview,
  BusinessDocsRuntimePolicy,
  BusinessDocsStoredDocumentType,
  BusinessDocsTaskType,
} from '@/pipeline_modules/build_business_docs_cli/types.js'

export const businessDocGenerationRuns = sqliteTable(
  'business_doc_generation_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').notNull().$type<BusinessDocsGenerationRunStatus>(),
    policyJson: text('policy_json', { mode: 'json' }).notNull().$type<BusinessDocsRuntimePolicy>(),
    previewSnapshotJson: text('preview_snapshot_json', { mode: 'json' }).notNull().$type<BusinessDocsPreview>(),
    selectedEpicIdsJson: text('selected_epic_ids_json', { mode: 'json' }).notNull().$type<string[]>(),
    sourceCommit: text('source_commit').notNull().default('unknown'),
    forceRegenerate: integer('force_regenerate').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
    finishedAt: text('finished_at'),
  },
  (t) => [
    index('idx_business_doc_generation_runs_project_status_created').on(t.projectId, t.status, t.createdAt),
    index('idx_business_doc_generation_runs_project_created').on(t.projectId, t.createdAt),
  ],
)

export type BusinessDocGenerationRun = typeof businessDocGenerationRuns.$inferSelect
export type NewBusinessDocGenerationRun = typeof businessDocGenerationRuns.$inferInsert

export const businessDocGenerationTasks = sqliteTable(
  'business_doc_generation_tasks',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => businessDocGenerationRuns.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    epicId: text('epic_id').references(() => epics.id, { onDelete: 'cascade' }),
    taskType: text('task_type').notNull().$type<BusinessDocsTaskType>(),
    documentType: text('document_type').notNull().$type<BusinessDocsStoredDocumentType>(),
    scope: text('scope').notNull().$type<'epic' | 'project' | 'use_case'>(),
    scopeId: text('scope_id').notNull(),
    targetKey: text('target_key').notNull(),
    status: text('status').notNull().default('pending').$type<BusinessDocsGenerationTaskStatus>(),
    dependsOnTaskIdsJson: text('depends_on_task_ids_json', { mode: 'json' }).notNull().$type<string[]>(),
    attemptNo: integer('attempt_no').notNull().default(0),
    maxRepairAttempts: integer('max_repair_attempts').notNull().default(1),
    workerId: text('worker_id'),
    leaseToken: text('lease_token'),
    leaseExpiresAt: text('lease_expires_at'),
    contextHandle: text('context_handle'),
    submittedJson: text('submitted_json', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    validationErrors: text('validation_errors', { mode: 'json' }).$type<Array<Record<string, unknown>> | null>(),
    savedDocumentId: text('saved_document_id').references(() => documents.id, { onDelete: 'set null' }),
    lastErrorJson: text('last_error_json', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_business_doc_generation_tasks_run_target').on(t.runId, t.targetKey),
    index('idx_business_doc_generation_tasks_run_status').on(t.runId, t.status),
    index('idx_business_doc_generation_tasks_run_type_status').on(t.runId, t.taskType, t.status),
    index('idx_business_doc_generation_tasks_project_scope').on(t.projectId, t.scope, t.scopeId),
  ],
)

export type BusinessDocGenerationTask = typeof businessDocGenerationTasks.$inferSelect
export type NewBusinessDocGenerationTask = typeof businessDocGenerationTasks.$inferInsert

export const businessDocContextBundles = sqliteTable(
  'business_doc_context_bundles',
  {
    contextHandle: text('context_handle').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => businessDocGenerationRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => businessDocGenerationTasks.id, { onDelete: 'cascade' }),
    schemaVersion: text('schema_version').notNull(),
    sourceCommit: text('source_commit').notNull(),
    manifestJson: text('manifest_json', { mode: 'json' }).notNull().$type<BusinessDocsContextManifest>(),
    contentHash: text('content_hash').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_business_doc_context_bundles_task').on(t.taskId),
    index('idx_business_doc_context_bundles_run').on(t.runId),
  ],
)

export type BusinessDocContextBundle = typeof businessDocContextBundles.$inferSelect
export type NewBusinessDocContextBundle = typeof businessDocContextBundles.$inferInsert

export const businessDocContextPages = sqliteTable(
  'business_doc_context_pages',
  {
    contextHandle: text('context_handle')
      .notNull()
      .references(() => businessDocContextBundles.contextHandle, { onDelete: 'cascade' }),
    pageToken: text('page_token').notNull(),
    pageKind: text('page_kind').notNull().$type<BusinessDocsContextPageKind>(),
    pageOrder: integer('page_order').notNull(),
    summary: text('summary').notNull(),
    evidenceIdsJson: text('evidence_ids_json', { mode: 'json' }).notNull().$type<string[]>(),
    contentJson: text('content_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    contentHash: text('content_hash').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    primaryKey({ columns: [t.contextHandle, t.pageToken] }),
    index('idx_business_doc_context_pages_handle_order').on(t.contextHandle, t.pageOrder),
  ],
)

export type BusinessDocContextPage = typeof businessDocContextPages.$inferSelect
export type NewBusinessDocContextPage = typeof businessDocContextPages.$inferInsert
