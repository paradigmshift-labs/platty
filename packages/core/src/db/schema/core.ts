import { integer, sqliteTable, text, uniqueIndex, primaryKey, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { repoTypeEnum, repoLanguageEnum, frameworkEnum, validityEnum, runKindEnum } from './enums.js'
import type { SchemaSource } from './json_types/schema_source.js'
import type { Warning } from './json_types/warning.js'
import type { CustomDecoratorMapping } from './json_types/custom_decorator.js'

export type EpicStatus = 'confirmed' | 'rejected'
export type EpicSource = 'build_epics'
export type PersistedConfidence = 'high' | 'medium' | 'low'
export type EpicDomainStatus = 'confirmed' | 'rejected'
export type EpicDomainSource = 'build_epics'

/**
 * Core 식별 단위.
 *
 * 네이밍 (V2 재정렬):
 *   project    = 비즈니스 분석 단위 (서비스/앱). 1개 project가 여러 repo를 묶을 수 있음.
 *   repository = git repo 1개.
 *   epic       = project 내 비즈니스 분류 단위.
 *
 * 모두 사람 자산 — `deleted_at` soft delete 적용 (CLAUDE.md §5.4).
 * project 삭제 시 자식도 cascade soft delete (M1-9 결정).
 */

// ────────────────────────────────────────
// projects
// ────────────────────────────────────────
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),                                    // nanoid()
  name: text('name').notNull(),                                   // 'heroines', '주문 시스템' 등
  description: text('description'),                               // 사용자 메모
  deletedAt: text('deleted_at'),                                  // soft delete
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert

// ────────────────────────────────────────
// repositories
// 산출물 메타(analyzed_at 등)는 repository_phase_status 별 테이블로 분리.
// last_synced_commit만 유지 (sync는 phase 단위가 아닌 repo 전체).
// ────────────────────────────────────────
export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),                                    // nanoid()
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),                                   // 보통 repo 폴더명
  repoPath: text('repo_path').notNull(),                          // 사용자 선택 원본 repo 경로
  sourceRoot: text('source_root'),                                // monorepo 내부 분석 루트 (repoPath 기준 상대경로)
  analysisBranch: text('analysis_branch'),                        // 분석 대상 branch (예: main)
  analysisWorktreePath: text('analysis_worktree_path'),           // app-managed worktree cache 경로

  // ── 분류 (M2 F2a) ────────────────────
  type: text('type', { enum: repoTypeEnum }),                     // backend/frontend/fullstack/mobile
  language: text('language', { enum: repoLanguageEnum }),         // typescript/javascript/dart/other
  languageRaw: text('language_raw'),                              // 'other'일 때 LLM 원본 ('go','rust',...)
  framework: text('framework', { enum: frameworkEnum }),
  frameworkRaw: text('framework_raw'),                            // 'other'일 때 LLM 원본 ('rails','spring',...)
  orm: text('orm'),                                                // ★ v2 — prisma/typeorm/drizzle/...

  // ── 스택 메타 (M2 F2b) ──────────────────
  schemaSources: text('schema_sources', { mode: 'json' }).$type<SchemaSource[]>(),
  apiBasePaths: text('api_base_paths', { mode: 'json' }).$type<string[]>(),
  routingFiles: text('routing_files', { mode: 'json' }).$type<string[]>(),
  routingLibs: text('routing_libs', { mode: 'json' }).$type<string[]>(),                  // ★ v2 신규 (build_route v2 BLOCKER)
  entrypointFiles: text('entrypoint_files', { mode: 'json' }).$type<string[]>(),
  pathAliases: text('path_aliases', { mode: 'json' }).$type<Record<string, string>>(),
  baseUrl: text('base_url'),                                      // tsconfig baseUrl 등
  customDecorators: text('custom_decorators', { mode: 'json' })                          // ★ v2 신규 (wrapper alias)
    .$type<Record<string, CustomDecoratorMapping>>(),

  // ── 검증 (M2 F3) ────────────────────
  validationWarnings: text('validation_warnings', { mode: 'json' }).$type<Warning[]>(),

  // ── sync 기준점 ──
  lastSyncedCommit: text('last_synced_commit'),

  // ── soft delete + timestamps ──
  deletedAt: text('deleted_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export type Repository = typeof repositories.$inferSelect
export type NewRepository = typeof repositories.$inferInsert

export type PhaseRunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled' | 'waiting_for_user'
export type UpstreamVersions = Record<string, Record<string, { runId: string | null; commit: string | null }>>

// ────────────────────────────────────────
// repository_phase_status — phase별 산출물 메타 (M2)
// PRIMARY KEY (repository_id, phase) — phase 추가 시 row만 늘어남, schema 변경 0
// ────────────────────────────────────────
export const repositoryPhaseStatus = sqliteTable(
  'repository_phase_status',
  {
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    phase: text('phase', { enum: runKindEnum }).notNull(),
    builtAt: text('built_at'),                                    // phase 실행 완료 시각
    builtFromCommit: text('built_from_commit'),                   // 분석 시점 commit (sync stale 추적)
    validity: text('validity', { enum: validityEnum }).notNull().default('fresh'),
    confirmedAt: text('confirmed_at'),                            // 사용자 confirm (analyze_repo / build_design 등)
    status: text('status').notNull().default('passed').$type<PhaseRunStatus>(),
    sourceRunId: text('source_run_id'),
    sourceCommit: text('source_commit'),
    upstreamVersions: text('upstream_versions', { mode: 'json' }).$type<UpstreamVersions>(),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.phase] })],
)

export type RepositoryPhaseStatus = typeof repositoryPhaseStatus.$inferSelect
export type NewRepositoryPhaseStatus = typeof repositoryPhaseStatus.$inferInsert

export const projectPhaseStatus = sqliteTable(
  'project_phase_status',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    phase: text('phase', { enum: runKindEnum }).notNull(),
    status: text('status').notNull().$type<PhaseRunStatus>(),
    sourceRunId: text('source_run_id'),
    sourceCommit: text('source_commit'),
    upstreamVersions: text('upstream_versions', { mode: 'json' }).$type<UpstreamVersions>(),
    updatedAt: integer('updated_at').notNull(),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.phase] })],
)

export type ProjectPhaseStatus = typeof projectPhaseStatus.$inferSelect
export type NewProjectPhaseStatus = typeof projectPhaseStatus.$inferInsert

// ────────────────────────────────────────
// epic_domains
// ────────────────────────────────────────
export const epicDomains = sqliteTable(
  'epic_domains',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    stableKey: text('stable_key'),
    summary: text('summary'),
    status: text('status').$type<EpicDomainStatus>(),
    source: text('source').$type<EpicDomainSource>(),
    confidence: text('confidence').$type<PersistedConfidence>(),
    sortOrder: integer('sort_order').notNull().default(0),
    confirmedAt: text('confirmed_at'),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_epic_domains_project_name_alive')
      .on(t.projectId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('idx_epic_domains_project_stable_key')
      .on(t.projectId, t.stableKey)
      .where(sql`${t.stableKey} IS NOT NULL`),
  ],
)

export type EpicDomain = typeof epicDomains.$inferSelect
export type NewEpicDomain = typeof epicDomains.$inferInsert

// ────────────────────────────────────────
// epics
// ────────────────────────────────────────
export const epics = sqliteTable(
  'epics',
  {
    id: text('id').primaryKey(),                                  // nanoid()
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    domainId: text('domain_id').references(() => epicDomains.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    abbr: text('abbr'),                                           // 'AD', 'ORDER' 등 약어
    description: text('description'),
    stableKey: text('stable_key'),
    summary: text('summary'),
    status: text('status').$type<EpicStatus>(),
    source: text('source').$type<EpicSource>(),
    confidence: text('confidence').$type<PersistedConfidence>(),

    // Approval (M1-3)
    confirmedAt: text('confirmed_at'),                            // NULL=proposed, 채워짐=confirmed

    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    // 살아있는 row 기준 project 내 이름 중복 방지 (M1-8)
    uniqueIndex('idx_epics_project_name_alive')
      .on(t.projectId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('idx_epics_project_stable_key')
      .on(t.projectId, t.stableKey)
      .where(sql`${t.stableKey} IS NOT NULL`),
    index('idx_epics_domain').on(t.domainId),
  ],
)

export type Epic = typeof epics.$inferSelect
export type NewEpic = typeof epics.$inferInsert
