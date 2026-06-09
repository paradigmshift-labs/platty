import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { repositories } from './core.js'
import { codeNodes } from './code_graph.js'
import {
  entryPointKindEnum,
  confidenceEnum,
  truncatedByEnum,
  detectedViaEnum,
} from './enums.js'

/**
 * M6 build_route 산출물 (architecture.md §3).
 *
 * SOT 3개:
 *   - entry_points        : L2 framework adapter 식별 진입점
 *   - code_bundles        : L3 BFS reachable 노드 (entry_point → node 다대다)
 *   - framework_detections: 어댑터 활성화 이력 (디버깅)
 *
 * routes/route_entries 동기화는 별도 step(migration.md §2). 이 schema에는 없음.
 */

// ────────────────────────────────────────
// entry_points — L2 framework discovery
//
// id 형식: '{repoId}:{framework}:{kind}:{httpMethod ?? ""}:{fullPath}:{handlerNodeId}'
//   handler_node_id 까지 포함 — 같은 path가 다른 핸들러로 등록되는 경우 분리.
// ────────────────────────────────────────
export const entryPoints = sqliteTable(
  'entry_points',
  {
    id: text('id').primaryKey(),
    repoId: text('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    framework: text('framework').notNull(),
    kind: text('kind', { enum: entryPointKindEnum }).notNull(),
    httpMethod: text('http_method'),                                    // page는 NULL
    path: text('path'),                                                 // 정규화된 path
    parentPath: text('parent_path'),                                    // nested 라우트의 부모
    fullPath: text('full_path'),                                        // parent + path 합성
    handlerNodeId: text('handler_node_id')
      .notNull()
      .references(() => codeNodes.id, { onDelete: 'cascade' }),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    detectionSource: text('detection_source').notNull(),                // 'rule:nestjs' | 'llm:haiku' 등
    confidence: text('confidence', { enum: confidenceEnum }).notNull(),
    detectionEvidence: text('detection_evidence', { mode: 'json' }).$type<Record<string, unknown>>(),
    truncatedBy: text('truncated_by', { enum: truncatedByEnum }),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_entry_points_uniq').on(
      t.repoId,
      t.framework,
      t.kind,
      t.httpMethod,
      t.fullPath,
      t.handlerNodeId,
    ),
    index('idx_entry_points_repo').on(t.repoId),
    index('idx_entry_points_handler').on(t.handlerNodeId),
  ],
)

export type EntryPoint = typeof entryPoints.$inferSelect
export type NewEntryPoint = typeof entryPoints.$inferInsert

// ────────────────────────────────────────
// code_bundles — L3 BFS reachable nodes
// PK: (entry_point_id, node_id)
// ────────────────────────────────────────
export const codeBundles = sqliteTable(
  'code_bundles',
  {
    entryPointId: text('entry_point_id')
      .notNull()
      .references(() => entryPoints.id, { onDelete: 'cascade' }),
    nodeId: text('node_id')
      .notNull()
      .references(() => codeNodes.id, { onDelete: 'cascade' }),
    depth: integer('depth').notNull(),                                  // 0 = handler 자체
    edgePath: text('edge_path', { mode: 'json' }).$type<string[]>(),    // 도달 경로 (디버깅)
  },
  (t) => [
    primaryKey({ columns: [t.entryPointId, t.nodeId] }),
    index('idx_bundles_node').on(t.nodeId),
  ],
)

export type CodeBundle = typeof codeBundles.$inferSelect
export type NewCodeBundle = typeof codeBundles.$inferInsert

// ────────────────────────────────────────
// framework_detections — 어댑터 활성화 이력
// PK: (repo_id, framework)
// ────────────────────────────────────────
export const frameworkDetections = sqliteTable(
  'framework_detections',
  {
    repoId: text('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    framework: text('framework').notNull(),
    detectedVia: text('detected_via', { enum: detectedViaEnum }).notNull(),
    evidence: text('evidence', { mode: 'json' }).$type<Record<string, unknown>>(),
    active: integer('active', { mode: 'boolean' }).notNull(),           // 1: 룰 적용 / 0: 후보
    detectedAt: text('detected_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.framework] })],
)

export type FrameworkDetection = typeof frameworkDetections.$inferSelect
export type NewFrameworkDetection = typeof frameworkDetections.$inferInsert
