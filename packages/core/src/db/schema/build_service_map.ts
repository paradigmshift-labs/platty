import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { projects, repositories } from './core.js'

export type ServiceMapNodeType =
  | 'screen'
  | 'api'
  | 'event'
  | 'job'
  | 'db'
  | 'external_service'
  | 'external_link'

export type ServiceMapEdgeKind =
  | 'navigates'
  | 'calls_api'
  | 'accesses_db'
  | 'publishes_event'
  | 'triggers'
  | 'uses_external_service'
  | 'opens_external_link'

export type ServiceMapEdgeSource =
  | 'deterministic'
  | 'suffix_match'
  | 'doc_llm'
  | 'merged'

export type ServiceMapNodeSourceKind = 'entry_point' | 'synthetic'

export interface EdgeEvidence {
  relation_ids?: string[]
  document_ids?: string[]
  conflict?: {
    deterministic_target: string
    doc_llm_target: string
  }
  suffix_match?: {
    raw_suffix: string
    base_url_env?: string
  }
  proximity_score?: number
  warnings?: string[]
}

export const serviceMapNodes = sqliteTable(
  'service_map_nodes',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repoId: text('repo_id').references(() => repositories.id, { onDelete: 'cascade' }),
    type: text('type').notNull().$type<ServiceMapNodeType>(),
    nodeId: text('node_id').notNull(),
    sourceKind: text('source_kind').notNull().$type<ServiceMapNodeSourceKind>(),
    sourceId: text('source_id').notNull(),
    canonicalKey: text('canonical_key').notNull(),
    label: text('label'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_service_map_nodes_project').on(t.projectId),
    index('idx_service_map_nodes_repo').on(t.repoId),
    uniqueIndex('idx_service_map_nodes_project_node').on(t.projectId, t.type, t.nodeId),
    uniqueIndex('idx_service_map_nodes_project_source').on(t.projectId, t.type, t.sourceKind, t.sourceId),
    uniqueIndex('idx_service_map_nodes_project_canonical').on(t.projectId, t.canonicalKey),
  ],
)

export const serviceMapEdges = sqliteTable(
  'service_map_edges',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    repoId: text('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    sourceRepoId: text('source_repo_id').references(() => repositories.id, { onDelete: 'cascade' }),
    targetRepoId: text('target_repo_id').references(() => repositories.id, { onDelete: 'set null' }),
    runId: text('run_id').notNull(),
    sourceNodeId: text('source_node_id').references(() => serviceMapNodes.id, { onDelete: 'set null' }),
    sourceType: text('source_type').notNull().$type<ServiceMapNodeType>(),
    sourceId: text('source_id').notNull(),
    sourceLabel: text('source_label'),
    targetNodeId: text('target_node_id').references(() => serviceMapNodes.id, { onDelete: 'set null' }),
    targetType: text('target_type').notNull().$type<ServiceMapNodeType>(),
    targetId: text('target_id').notNull(),
    targetLabel: text('target_label'),
    kind: text('kind').notNull().$type<ServiceMapEdgeKind>(),
    canonicalTarget: text('canonical_target').notNull(),
    confidence: text('confidence').notNull().$type<'high' | 'medium' | 'low'>(),
    source: text('source').notNull().$type<ServiceMapEdgeSource>(),
    evidence: text('evidence', { mode: 'json' }).notNull().$type<EdgeEvidence>(),
    unresolvedReason: text('unresolved_reason'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_service_map_edges_project').on(t.projectId),
    index('idx_service_map_edges_repo').on(t.repoId),
    index('idx_service_map_edges_source_repo').on(t.sourceRepoId),
    index('idx_service_map_edges_target_repo').on(t.targetRepoId),
    index('idx_service_map_edges_source_service_node').on(t.sourceNodeId),
    index('idx_service_map_edges_target_service_node').on(t.targetNodeId),
    index('idx_service_map_edges_repo_kind').on(t.repoId, t.kind),
    index('idx_service_map_edges_source_node').on(t.sourceType, t.sourceId),
    index('idx_service_map_edges_target_node').on(t.targetType, t.targetId),
    index('idx_service_map_edges_canonical').on(t.repoId, t.canonicalTarget),
    uniqueIndex('idx_service_map_edges_logical_uniq').on(
      t.repoId,
      t.sourceType,
      t.sourceId,
      t.targetType,
      t.targetId,
      t.kind,
      t.canonicalTarget,
    ),
  ],
)

export type ServiceMapNode = typeof serviceMapNodes.$inferSelect
export type NewServiceMapNode = typeof serviceMapNodes.$inferInsert
export type ServiceMapEdge = typeof serviceMapEdges.$inferSelect
export type NewServiceMapEdge = typeof serviceMapEdges.$inferInsert
