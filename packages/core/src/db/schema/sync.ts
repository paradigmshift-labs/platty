import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { projects, repositories } from './core.js'
import type { CodeRelationConfidence, CodeRelationKind } from './build_relations.js'
import { codeRelations } from './build_relations.js'

export const syncPlans = sqliteTable(
  'sync_plans',
  {
    id: text('id').primaryKey(),
    repoId: text('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromCommit: text('from_commit'),
    toCommit: text('to_commit'),
    status: text('status').notNull().default('running').$type<'running' | 'ready' | 'needs_confirmation' | 'applied' | 'failed' | 'cancelled'>(),
    mode: text('mode').notNull().default('with_project_cascade').$type<'repo_only' | 'with_project_cascade'>(),
    planJson: text('plan_json', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    summaryJson: text('summary_json', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_sync_plans_repo').on(t.repoId),
    index('idx_sync_plans_project').on(t.projectId),
    index('idx_sync_plans_status').on(t.status),
  ],
)

export type SyncPlan = typeof syncPlans.$inferSelect
export type NewSyncPlan = typeof syncPlans.$inferInsert

export const syncPlanItems = sqliteTable(
  'sync_plan_items',
  {
    id: text('id').primaryKey(),
    syncPlanId: text('sync_plan_id')
      .notNull()
      .references(() => syncPlans.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    targetId: text('target_id'),
    targetKey: text('target_key'),
    status: text('status').notNull().default('pending').$type<'pending' | 'running' | 'ready' | 'applied' | 'failed' | 'skipped'>(),
    attemptCount: integer('attempt_count').notNull().default(0),
    payloadJson: text('payload_json', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_sync_plan_items_plan').on(t.syncPlanId),
    index('idx_sync_plan_items_status').on(t.syncPlanId, t.status),
    index('idx_sync_plan_items_target').on(t.syncPlanId, t.kind, t.targetId),
    uniqueIndex('idx_sync_plan_items_plan_kind_target').on(t.syncPlanId, t.kind, t.targetId, t.targetKey),
  ],
)

export type SyncPlanItem = typeof syncPlanItems.$inferSelect
export type NewSyncPlanItem = typeof syncPlanItems.$inferInsert

export const syncStaticSnapshots = sqliteTable(
  'sync_static_snapshots',
  {
    id: text('id').primaryKey(),
    syncPlanId: text('sync_plan_id')
      .notNull()
      .references(() => syncPlans.id, { onDelete: 'cascade' }),
    repoId: text('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    source: text('source').notNull().$type<'current_snapshot' | 'staged_snapshot'>(),
    snapshotJson: text('snapshot_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_sync_static_snapshots_plan').on(t.syncPlanId),
    index('idx_sync_static_snapshots_repo').on(t.repoId),
    index('idx_sync_static_snapshots_project').on(t.projectId),
  ],
)

export type SyncStaticSnapshot = typeof syncStaticSnapshots.$inferSelect
export type NewSyncStaticSnapshot = typeof syncStaticSnapshots.$inferInsert

export type StaticMapRunStatus = 'pending' | 'running' | 'validating' | 'applying' | 'failed' | 'applied'
export type StaticMerkleSnapshotKind = 'project'
export type DocSyncPlanStatus = 'technical_pending' | 'business_pending' | 'ready_to_apply' | 'applied' | 'failed'
export type DocSyncCandidatePhase = 'technical' | 'business'
export type DocSyncCandidateKind = 'new_document' | 'stale' | 'stale_candidate' | 'orphan_document'
export type DocSyncCandidateStatus = 'pending' | 'resolved' | 'staged' | 'skipped'
export type DocSyncCandidateDecision = 'fresh' | 'orphan' | 'skip'

export const syncStaticMapRuns = sqliteTable(
  'static_map_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending').$type<StaticMapRunStatus>(),
    currentStep: text('current_step'),
    stagingDbPath: text('staging_db_path'),
    repoPinsJson: text('repo_pins_json', { mode: 'json' }).$type<Array<Record<string, unknown>> | null>(),
    snapshotId: text('snapshot_id'),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_static_map_runs_project').on(t.projectId),
    index('idx_static_map_runs_project_status').on(t.projectId, t.status),
    index('idx_static_map_runs_snapshot').on(t.snapshotId),
  ],
)

export type SyncStaticMapRun = typeof syncStaticMapRuns.$inferSelect
export type NewSyncStaticMapRun = typeof syncStaticMapRuns.$inferInsert

export const staticMerkleSnapshots = sqliteTable(
  'static_merkle_snapshots',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    snapshotKind: text('snapshot_kind').notNull().default('project').$type<StaticMerkleSnapshotKind>(),
    analysisBranch: text('analysis_branch'),
    sourceCommit: text('source_commit'),
    repoCommitPinsJson: text('repo_commit_pins_json', { mode: 'json' }).notNull().$type<Array<Record<string, unknown>>>(),
    rootHash: text('root_hash').notNull(),
    hashSetJson: text('hash_set_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    reasonInputsJson: text('reason_inputs_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    createdByRunId: text('created_by_run_id'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_static_merkle_snapshots_project').on(t.projectId),
    index('idx_static_merkle_snapshots_project_created').on(t.projectId, t.createdAt),
    index('idx_static_merkle_snapshots_run').on(t.createdByRunId),
  ],
)

export type StaticMerkleSnapshot = typeof staticMerkleSnapshots.$inferSelect
export type NewStaticMerkleSnapshot = typeof staticMerkleSnapshots.$inferInsert

export const docSyncPlans = sqliteTable(
  'doc_sync_plans',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromSnapshotId: text('from_snapshot_id'),
    toSnapshotId: text('to_snapshot_id').notNull(),
    status: text('status').notNull().default('technical_pending').$type<DocSyncPlanStatus>(),
    countsJson: text('counts_json', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_doc_sync_plans_project').on(t.projectId),
    index('idx_doc_sync_plans_status').on(t.projectId, t.status),
    index('idx_doc_sync_plans_to_snapshot').on(t.toSnapshotId),
  ],
)

export type DocSyncPlan = typeof docSyncPlans.$inferSelect
export type NewDocSyncPlan = typeof docSyncPlans.$inferInsert

export const docSyncCandidates = sqliteTable(
  'doc_sync_candidates',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => docSyncPlans.id, { onDelete: 'cascade' }),
    phase: text('phase').notNull().$type<DocSyncCandidatePhase>(),
    kind: text('kind').notNull().$type<DocSyncCandidateKind>(),
    status: text('status').notNull().default('pending').$type<DocSyncCandidateStatus>(),
    targetJson: text('target_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    oldHash: text('old_hash'),
    newHash: text('new_hash'),
    reasonInputsJson: text('reason_inputs_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    decision: text('decision').$type<DocSyncCandidateDecision>(),
    rationale: text('rationale'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_doc_sync_candidates_plan').on(t.planId),
    index('idx_doc_sync_candidates_plan_phase').on(t.planId, t.phase),
    index('idx_doc_sync_candidates_status').on(t.planId, t.status),
    uniqueIndex('idx_doc_sync_candidates_plan_target').on(t.planId, t.phase, t.targetJson),
  ],
)

export type DocSyncCandidate = typeof docSyncCandidates.$inferSelect
export type NewDocSyncCandidate = typeof docSyncCandidates.$inferInsert

export const docSyncOutputs = sqliteTable(
  'doc_sync_outputs',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => docSyncPlans.id, { onDelete: 'cascade' }),
    candidateId: text('candidate_id')
      .notNull()
      .references(() => docSyncCandidates.id, { onDelete: 'cascade' }),
    documentJson: text('document_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    evidenceJson: text('evidence_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    contentHash: text('content_hash').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_doc_sync_outputs_candidate').on(t.candidateId),
    index('idx_doc_sync_outputs_plan').on(t.planId),
  ],
)

export type DocSyncOutput = typeof docSyncOutputs.$inferSelect
export type NewDocSyncOutput = typeof docSyncOutputs.$inferInsert

export const syncDocumentOutputs = sqliteTable(
  'sync_document_outputs',
  {
    id: text('id').primaryKey(),
    syncPlanId: text('sync_plan_id')
      .notNull()
      .references(() => syncPlans.id, { onDelete: 'cascade' }),
    documentId: text('document_id'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    track: text('track').notNull().$type<'technical' | 'business'>(),
    scope: text('scope').notNull(),
    scopeId: text('scope_id'),
    status: text('status').notNull(),
    validity: text('validity').notNull().default('fresh').$type<'fresh'>(),
    summary: text('summary'),
    content: text('content', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    rawLlmOutput: text('raw_llm_output').notNull().default(''),
    updatedBy: text('updated_by').notNull().default('llm').$type<'system' | 'llm' | 'user'>(),
    sourceRunId: text('source_run_id'),
    sourceCommit: text('source_commit'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_sync_document_outputs_plan_canonical').on(t.syncPlanId, t.projectId, t.type, t.scope, t.scopeId),
    index('idx_sync_document_outputs_plan').on(t.syncPlanId),
    index('idx_sync_document_outputs_project').on(t.projectId),
    index('idx_sync_document_outputs_document').on(t.documentId),
  ],
)

export type SyncDocumentOutput = typeof syncDocumentOutputs.$inferSelect
export type NewSyncDocumentOutput = typeof syncDocumentOutputs.$inferInsert

export const syncDocumentOutputDeps = sqliteTable(
  'sync_document_output_deps',
  {
    outputId: text('output_id')
      .notNull()
      .references(() => syncDocumentOutputs.id, { onDelete: 'cascade' }),
    codeNodeId: text('code_node_id').notNull(),
    depType: text('dep_type').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.outputId, t.codeNodeId, t.depType] }),
    index('idx_sync_document_output_deps_node').on(t.codeNodeId),
  ],
)

export type SyncDocumentOutputDep = typeof syncDocumentOutputDeps.$inferSelect
export type NewSyncDocumentOutputDep = typeof syncDocumentOutputDeps.$inferInsert

export const syncDocumentOutputRelationLinks = sqliteTable(
  'sync_document_output_relation_links',
  {
    outputId: text('output_id')
      .notNull()
      .references(() => syncDocumentOutputs.id, { onDelete: 'cascade' }),
    relationId: text('relation_id').references(() => codeRelations.id, { onDelete: 'set null' }),
    repoId: text('repo_id').notNull(),
    sourceNodeId: text('source_node_id').notNull(),
    kind: text('kind').notNull().$type<CodeRelationKind>(),
    target: text('target'),
    operation: text('operation'),
    canonicalTarget: text('canonical_target'),
    payloadJson: text('payload_json', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    evidenceNodeIdsJson: text('evidence_node_ids_json', { mode: 'json' }).notNull().$type<string[]>(),
    confidence: text('confidence').notNull().$type<CodeRelationConfidence>(),
    unresolvedReason: text('unresolved_reason'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_sync_document_output_relation_links_output').on(t.outputId),
    index('idx_sync_document_output_relation_links_relation').on(t.relationId),
    index('idx_sync_document_output_relation_links_canonical_target').on(t.repoId, t.kind, t.canonicalTarget),
  ],
)

export type SyncDocumentOutputRelationLink = typeof syncDocumentOutputRelationLinks.$inferSelect
export type NewSyncDocumentOutputRelationLink = typeof syncDocumentOutputRelationLinks.$inferInsert
