import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { TechnicalDocumentType } from './build_docs.js'
import { entryPoints } from './build_route.js'
import { codeNodes } from './code_graph.js'
import { projects, repositories } from './core.js'

export type SharedCodeSummaryStatus = 'deterministic' | 'llm_verified' | 'failed'
export type SharedCodeValidity = 'fresh' | 'stale'

export const sharedCodeSegments = sqliteTable(
  'shared_code_segments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    repoId: text('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
    rootNodeId: text('root_node_id').notNull().references(() => codeNodes.id, { onDelete: 'cascade' }),
    rootSymbol: text('root_symbol').notNull(),
    rootFilePath: text('root_file_path').notNull(),
    detectorVersion: text('detector_version').notNull(),
    summarySchemaVersion: text('summary_schema_version').notNull(),
    segmentHash: text('segment_hash').notNull(),
    sourceHash: text('source_hash').notNull(),
    usedByEntryPointCount: integer('used_by_entrypoint_count').notNull(),
    coveredNodeIdsJson: text('covered_node_ids_json', { mode: 'json' }).notNull().$type<string[]>(),
    deterministicSummaryJson: text('deterministic_summary_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    llmSummaryJson: text('llm_summary_json', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    summaryStatus: text('summary_status').notNull().$type<SharedCodeSummaryStatus>(),
    validity: text('validity').notNull().default('fresh').$type<SharedCodeValidity>(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_shared_code_segments_root_version').on(t.projectId, t.repoId, t.rootNodeId, t.detectorVersion),
    index('idx_shared_code_segments_project_repo').on(t.projectId, t.repoId),
    index('idx_shared_code_segments_validity').on(t.projectId, t.validity),
    index('idx_shared_code_segments_source_hash').on(t.projectId, t.repoId, t.sourceHash),
  ],
)

export const sharedCodeSegmentEntryPoints = sqliteTable(
  'shared_code_segment_entrypoints',
  {
    segmentId: text('segment_id').notNull().references(() => sharedCodeSegments.id, { onDelete: 'cascade' }),
    entryPointId: text('entry_point_id').notNull().references(() => entryPoints.id, { onDelete: 'cascade' }),
    targetKey: text('target_key').notNull(),
    documentType: text('document_type').notNull().$type<TechnicalDocumentType>(),
    rootDepth: integer('root_depth').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.segmentId, t.entryPointId] }),
    index('idx_shared_code_segment_entrypoints_entry').on(t.entryPointId),
  ],
)

export const sharedCodeSegmentNodes = sqliteTable(
  'shared_code_segment_nodes',
  {
    segmentId: text('segment_id').notNull().references(() => sharedCodeSegments.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull().references(() => codeNodes.id, { onDelete: 'cascade' }),
    role: text('role').notNull().$type<'root' | 'covered'>(),
    depthFromRoot: integer('depth_from_root').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.segmentId, t.nodeId] }),
    index('idx_shared_code_segment_nodes_node').on(t.nodeId),
  ],
)
