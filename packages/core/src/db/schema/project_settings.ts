import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { llmProviderEnum } from './enums.js'
import { projects } from './core.js'

export const configurableLlmStageEnum = ['build_docs', 'build_epics', 'build_business_docs'] as const
export type ConfigurableLlmStage = (typeof configurableLlmStageEnum)[number]

export const projectLlmSettings = sqliteTable(
  'project_llm_settings',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stage: text('stage', { enum: configurableLlmStageEnum }).notNull(),
    provider: text('provider', { enum: llmProviderEnum }).notNull(),
    model: text('model').notNull(),
    apiVersion: text('api_version'),
    credentialEnvName: text('credential_env_name'),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.stage] })],
)

export type ProjectLlmSetting = typeof projectLlmSettings.$inferSelect
export type NewProjectLlmSetting = typeof projectLlmSettings.$inferInsert
