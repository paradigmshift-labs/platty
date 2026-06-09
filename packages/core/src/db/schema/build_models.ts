import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { repositories } from './core.js'
import { validityEnum } from './enums.js'
import type { ModelField, ModelRelation } from '../../pipeline_modules/build_models/types.js'

export const models = sqliteTable(
  'models',
  {
    id: text('id').primaryKey(),
    // deterministic: '{repoId}:{modelName}'

    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    tableName: text('table_name').notNull(),
    comment: text('comment'),
    description: text('description'),
    // AI 생성 설명 — upsert 시 기존 값 보존

    fields: text('fields', { mode: 'json' }).notNull().$type<ModelField[]>(),
    relations: text('relations', { mode: 'json' }).notNull().$type<ModelRelation[]>(),

    isDeprecated: integer('is_deprecated', { mode: 'boolean' }).notNull().default(false),

    // DSL 전략(Prisma)만 채워짐. Graph 전략은 null
    sourceFile: text('source_file'),
    lineStart: integer('line_start'),
    lineEnd: integer('line_end'),

    orm: text('orm').notNull(),
    // 'prisma' | 'typeorm' | 'mikroorm' | 'drizzle' | 'sequelize'

    builtFromCommit: text('built_from_commit'),
    validity: text('validity', { enum: validityEnum }).notNull().default('fresh'),

    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex('idx_models_repo_name').on(t.repositoryId, t.name)],
)

export type Model = typeof models.$inferSelect
export type NewModel = typeof models.$inferInsert
