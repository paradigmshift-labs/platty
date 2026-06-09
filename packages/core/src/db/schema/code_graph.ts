import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { repositories } from './core.js'
import {
  codeNodeTypeEnum,
  edgeRelationEnum,
  resolveStatusEnum,
  parseStatusEnum,
  edgeConfidenceEnum,
  edgeSourceEnum,
  typeRefSubtypeEnum,
} from './enums.js'

/**
 * M3 build_graph 산출물.
 *
 * FK 정책 (Q4 결정):
 *   - 부모(repositories) → 자식: CASCADE
 *   - code_edges → code_nodes (source/target): **FK 미선언** (V1 패턴)
 *     ※ F6은 PRAGMA foreign_keys=OFF로 트랜잭션 우회.
 *        외부 산출물(doc_deps 등)의 dangling 정리는
 *        각 마일스톤이 자기 책임. M10 sync에서 cascade_stale로 통합.
 *
 * ID 전략:
 *   - code_nodes.id: deterministic = '{repoId}:{filePath}' (file 노드)
 *                                   또는 '{repoId}:{filePath}:{symbolName}'
 *   - code_edges.id: autoIncrement INT
 *   - sync 시 같은 코드 = 같은 id 재생성 → 외부 FK 일부 자연 보존.
 */

// ────────────────────────────────────────
// code_nodes — 코드 심볼 단위
// ────────────────────────────────────────
export const codeNodes = sqliteTable(
  'code_nodes',
  {
    id: text('id').primaryKey(),
    repoId: text('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    type: text('type', { enum: codeNodeTypeEnum }).notNull(),
    filePath: text('file_path').notNull(),
    name: text('name').notNull(),
    lineStart: integer('line_start'),                                 // file 노드는 NULL
    lineEnd: integer('line_end'),
    normalizedCodeHash: text('normalized_code_hash'),
    parentNodeId: text('parent_node_id'),
    originKind: text('origin_kind'),
    role: text('role'),
    signature: text('signature'),
    exported: integer('exported', { mode: 'boolean' }).notNull().default(false),
    isDefaultExport: integer('is_default_export', { mode: 'boolean' }).notNull().default(false),
    isAsync: integer('is_async', { mode: 'boolean' }).notNull().default(false),
    isTest: integer('is_test', { mode: 'boolean' }).notNull().default(false),
    testType: text('test_type'),                                      // 'unit'|'integration'|'e2e' (free text)
    docComment: text('doc_comment'),                                  // JSDoc/DartDoc 원문
    parseStatus: text('parse_status', { enum: parseStatusEnum }).notNull().default('ok'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_code_nodes_repo').on(t.repoId),
    index('idx_code_nodes_repo_file').on(t.repoId, t.filePath),
    index('idx_code_nodes_repo_type').on(t.repoId, t.type),
    index('idx_code_nodes_parent').on(t.parentNodeId),
    index('idx_code_nodes_origin').on(t.repoId, t.originKind),
    index('idx_code_nodes_role').on(t.repoId, t.role),
  ],
)

export type CodeNode = typeof codeNodes.$inferSelect
export type NewCodeNode = typeof codeNodes.$inferInsert

// ────────────────────────────────────────
// code_edges — 노드 간 관계
// ────────────────────────────────────────
export const codeEdges = sqliteTable(
  'code_edges',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    repoId: text('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),                            // FK 미선언 (V1 패턴)
    targetId: text('target_id'),                                      // FK 미선언, NULL=외부/실패
    relation: text('relation', { enum: edgeRelationEnum }).notNull(),
    targetSpecifier: text('target_specifier'),
    targetSymbol: text('target_symbol'),
    typeRefSubtype: text('type_ref_subtype', { enum: typeRefSubtypeEnum }),  // uses_type 세부 분류 (M7 deterministic 분류용)
    chainPath: text('chain_path'),                                    // E6 — calls/renders chain root (예: 'prisma.order', 'this.svc')
    firstArg: text('first_arg'),
    literalArgs: text('literal_args'),
    argExpressions: text('arg_expressions', { mode: 'json' }),           // E4+ call argument 증거 (CallArgExpression[], additive)
    resolveStatus: text('resolve_status', { enum: resolveStatusEnum }).notNull().default('pending'),
    confidence: text('confidence', { enum: edgeConfidenceEnum }),     // type_resolved 전용
    source: text('source', { enum: edgeSourceEnum }).notNull().default('static'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_code_edges_uniq').on(
      t.sourceId,
      t.targetId,
      t.relation,
      t.targetSpecifier,
      t.targetSymbol,
      t.firstArg,
      t.literalArgs,
    ),
    index('idx_code_edges_repo').on(t.repoId),
    index('idx_code_edges_source').on(t.sourceId),
    index('idx_code_edges_target').on(t.targetId),
  ],
)

export type CodeEdge = typeof codeEdges.$inferSelect
export type NewCodeEdge = typeof codeEdges.$inferInsert

// ────────────────────────────────────────
// file_cache — SHA-256 해시 캐시
// build_graph DELETE→INSERT와 무관하게 보존 (sync에서 변경 파일 식별용).
// M3에서 INSERT/UPDATE만, 활용은 M10 sync.
// ────────────────────────────────────────
export const fileCache = sqliteTable(
  'file_cache',
  {
    repoId: text('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    fileHash: text('file_hash').notNull(),                            // SHA-256
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.filePath] })],
)

export type FileCache = typeof fileCache.$inferSelect
export type NewFileCache = typeof fileCache.$inferInsert
