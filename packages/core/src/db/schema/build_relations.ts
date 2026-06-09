import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { repositories } from './core.js'

export type CodeRelationKind =
  | 'db_access'
  | 'navigation'
  | 'external_link'
  | 'external_service'
  | 'api_call'
  | 'event_publish'
  | 'event_listen'
  | 'schedule_trigger'
export type CodeRelationConfidence = 'high' | 'medium' | 'low'

export const codeRelations = sqliteTable(
  'code_relations',
  {
    id: text('id').primaryKey(),
    repoId: text('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    sourceNodeId: text('source_node_id').notNull(),
    kind: text('kind').notNull().$type<CodeRelationKind>(),
    target: text('target'),
    operation: text('operation'),
    canonicalTarget: text('canonical_target'),
    payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    evidenceNodeIds: text('evidence_node_ids', { mode: 'json' }).notNull().$type<string[]>(),
    confidence: text('confidence').notNull().$type<CodeRelationConfidence>(),
    unresolvedReason: text('unresolved_reason'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_code_relations_repo').on(t.repoId),
    index('idx_code_relations_repo_kind').on(t.repoId, t.kind),
    index('idx_code_relations_source').on(t.sourceNodeId),
    index('idx_code_relations_canonical_target').on(t.repoId, t.kind, t.canonicalTarget),
  ],
)

export type CodeRelation = typeof codeRelations.$inferSelect
export type NewCodeRelation = typeof codeRelations.$inferInsert
