import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { documents, generationRuns } from './build_docs.js'
import { epics, projects, type PersistedConfidence } from './core.js'

export type EpicDocumentType = 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
export type EpicDocumentRole = 'owner' | 'primary' | 'supporting' | 'cross_epic' | 'shell' | 'unknown' | 'event_owner' | 'job_owner'
export type EpicDependencyKind = 'cross_screen' | 'event_flow' | 'table_shared' | 'external_call' | 'cross_domain_state_change'

export const epicDocumentLinks = sqliteTable(
  'epic_document_links',
  {
    epicId: text('epic_id')
      .notNull()
      .references(() => epics.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    documentType: text('document_type').notNull().$type<EpicDocumentType>(),
    role: text('role').notNull().$type<EpicDocumentRole>(),
    reason: text('reason').notNull(),
    confidence: text('confidence').notNull().$type<PersistedConfidence>(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_epic_document_links_unique').on(t.epicId, t.documentId, t.role),
    index('idx_epic_document_links_epic').on(t.epicId),
    index('idx_epic_document_links_document').on(t.documentId),
  ],
)

export const epicDependencies = sqliteTable(
  'epic_dependencies',
  {
    sourceEpicId: text('source_epic_id')
      .notNull()
      .references(() => epics.id, { onDelete: 'cascade' }),
    targetEpicId: text('target_epic_id')
      .notNull()
      .references(() => epics.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<EpicDependencyKind>(),
    reason: text('reason').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_epic_dependencies_unique').on(t.sourceEpicId, t.targetEpicId, t.kind),
    index('idx_epic_dependencies_source').on(t.sourceEpicId),
    index('idx_epic_dependencies_target').on(t.targetEpicId),
  ],
)

export const epicConfirmLogs = sqliteTable(
  'epic_confirm_logs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    payloadJson: text('payload_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index('idx_epic_confirm_logs_project').on(t.projectId)],
)

export const buildEpicsDrafts = sqliteTable(
  'build_epics_drafts',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').notNull().$type<'building' | 'ready' | 'invalid'>(),
    draftJson: text('draft_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    validationJson: text('validation_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_build_epics_drafts_run').on(t.runId),
    index('idx_build_epics_drafts_project').on(t.projectId),
  ],
)

export type EpicDocumentLink = typeof epicDocumentLinks.$inferSelect
export type NewEpicDocumentLink = typeof epicDocumentLinks.$inferInsert
export type EpicDependency = typeof epicDependencies.$inferSelect
export type NewEpicDependency = typeof epicDependencies.$inferInsert
export type EpicConfirmLog = typeof epicConfirmLogs.$inferSelect
export type NewEpicConfirmLog = typeof epicConfirmLogs.$inferInsert
export type BuildEpicsDraft = typeof buildEpicsDrafts.$inferSelect
export type NewBuildEpicsDraft = typeof buildEpicsDrafts.$inferInsert
