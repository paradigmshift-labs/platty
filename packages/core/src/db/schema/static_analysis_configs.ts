import { sql } from 'drizzle-orm'
import { index, sqliteTable, text, uniqueIndex, integer } from 'drizzle-orm/sqlite-core'
import { repositories } from './core.js'
import type { StaticAnalysisPatternProfileInput } from '@/pipeline_modules/shared/static_config/types.js'

export type RepositoryStaticAnalysisConfigStatus = 'active' | 'inactive' | 'archived'

export const repositoryStaticAnalysisConfigs = sqliteTable(
  'repository_static_analysis_configs',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    schemaVersion: integer('schema_version').notNull(),
    configJson: text('config_json', { mode: 'json' }).notNull().$type<StaticAnalysisPatternProfileInput>(),
    version: integer('version').notNull(),
    status: text('status').notNull().$type<RepositoryStaticAnalysisConfigStatus>(),
    createdBy: text('created_by'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_repository_static_analysis_configs_active')
      .on(t.repositoryId)
      .where(sql`${t.status} = 'active'`),
    uniqueIndex('idx_repository_static_analysis_configs_version')
      .on(t.repositoryId, t.version),
    index('idx_repository_static_analysis_configs_repo_status')
      .on(t.repositoryId, t.status),
  ],
)

export type RepositoryStaticAnalysisConfig = typeof repositoryStaticAnalysisConfigs.$inferSelect
export type NewRepositoryStaticAnalysisConfig = typeof repositoryStaticAnalysisConfigs.$inferInsert
