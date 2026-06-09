import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import type { CodeRelationConfidence, CodeRelationKind } from './build_relations.js'
import { codeRelations } from './build_relations.js'
import { projects, repositories } from './core.js'

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    track: text('track').notNull(),
    scope: text('scope').notNull(),
    scopeId: text('scope_id'),
    status: text('status').notNull(),
    validity: text('validity').notNull().default('fresh'),
    summary: text('summary'),
    content: text('content', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    rawLlmOutput: text('raw_llm_output').notNull().default(''),
    contentHash: text('content_hash'),
    staticSnapshotId: text('static_snapshot_id'),
    documentSourceHash: text('document_source_hash'),
    sourceRunId: text('source_run_id'),
    sourceCommit: text('source_commit'),
    updatedBy: text('updated_by').notNull().default('system').$type<'system' | 'llm' | 'user'>(),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_documents_canonical_unique').on(t.projectId, t.type, t.scope, t.scopeId),
    index('idx_documents_project').on(t.projectId),
    index('idx_documents_project_type').on(t.projectId, t.type),
    index('idx_documents_scope').on(t.projectId, t.scope, t.scopeId),
    index('idx_documents_static_snapshot').on(t.staticSnapshotId),
    index('idx_documents_document_source_hash').on(t.projectId, t.documentSourceHash),
  ],
)

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert

export const docDeps = sqliteTable(
  'doc_deps',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    codeNodeId: text('code_node_id').notNull(),
    depType: text('dep_type').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.codeNodeId, t.depType] }),
    index('idx_doc_deps_code_node').on(t.codeNodeId),
  ],
)

export type DocDep = typeof docDeps.$inferSelect
export type NewDocDep = typeof docDeps.$inferInsert

export const documentLinks = sqliteTable(
  'document_links',
  {
    fromDocumentId: text('from_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    toDocumentId: text('to_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    linkType: text('link_type').notNull(),
    createdBy: text('created_by').notNull().default('system'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    primaryKey({ columns: [t.fromDocumentId, t.toDocumentId, t.linkType] }),
    index('idx_document_links_from').on(t.fromDocumentId),
    index('idx_document_links_to').on(t.toDocumentId),
  ],
)

export type DocumentLink = typeof documentLinks.$inferSelect
export type NewDocumentLink = typeof documentLinks.$inferInsert

export const documentLinkEvidence = sqliteTable(
  'document_link_evidence',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromDocumentId: text('from_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    toDocumentId: text('to_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    linkType: text('link_type').notNull(),
    sourceEdgeId: text('source_edge_id').notNull(),
    repoId: text('repo_id').notNull(),
    confidence: text('confidence').notNull().$type<'high' | 'medium' | 'low'>(),
    source: text('source').notNull(),
    reason: text('reason').notNull(),
    runId: text('run_id'),
    createdBy: text('created_by').notNull().default('build_docs_materializer_v1'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    primaryKey({ columns: [t.fromDocumentId, t.toDocumentId, t.linkType, t.sourceEdgeId] }),
    index('idx_document_link_evidence_project_type').on(t.projectId, t.linkType),
    index('idx_document_link_evidence_source_edge').on(t.sourceEdgeId),
    index('idx_document_link_evidence_to_doc_type').on(t.toDocumentId, t.linkType),
    index('idx_document_link_evidence_repo').on(t.projectId, t.repoId),
  ],
)

export type DocumentLinkEvidence = typeof documentLinkEvidence.$inferSelect
export type NewDocumentLinkEvidence = typeof documentLinkEvidence.$inferInsert

export const documentItems = sqliteTable(
  'document_items',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    itemType: text('item_type').notNull(),
    stableKey: text('stable_key').notNull(),
    ordinal: integer('ordinal').notNull(),
    title: text('title'),
    summary: text('summary'),
    content: text('content', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    contentHash: text('content_hash').notNull(),
    status: text('status').notNull().default('active').$type<'active' | 'stale'>(),
    createdBy: text('created_by').notNull().default('system'),
    updatedBy: text('updated_by').notNull().default('system'),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_document_items_doc_type_stable').on(t.documentId, t.itemType, t.stableKey),
    index('idx_document_items_document').on(t.documentId),
    index('idx_document_items_project_type').on(t.projectId, t.itemType),
    index('idx_document_items_stable_key').on(t.projectId, t.itemType, t.stableKey),
  ],
)

export type DocumentItem = typeof documentItems.$inferSelect
export type NewDocumentItem = typeof documentItems.$inferInsert

export const documentItemDocumentLinks = sqliteTable(
  'document_item_document_links',
  {
    fromItemId: text('from_item_id')
      .notNull()
      .references(() => documentItems.id, { onDelete: 'cascade' }),
    toDocumentId: text('to_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    linkType: text('link_type').notNull(),
    role: text('role').$type<'primary' | 'supporting' | 'exception' | 'background'>(),
    createdBy: text('created_by').notNull().default('system'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    primaryKey({ columns: [t.fromItemId, t.toDocumentId, t.linkType] }),
    index('idx_document_item_document_links_from').on(t.fromItemId),
    index('idx_document_item_document_links_to_doc').on(t.toDocumentId),
  ],
)

export type DocumentItemDocumentLink = typeof documentItemDocumentLinks.$inferSelect
export type NewDocumentItemDocumentLink = typeof documentItemDocumentLinks.$inferInsert

export const documentItemItemLinks = sqliteTable(
  'document_item_item_links',
  {
    fromItemId: text('from_item_id')
      .notNull()
      .references(() => documentItems.id, { onDelete: 'cascade' }),
    toItemId: text('to_item_id')
      .notNull()
      .references(() => documentItems.id, { onDelete: 'cascade' }),
    linkType: text('link_type').notNull(),
    role: text('role').$type<'primary' | 'supporting' | 'exception' | 'background'>(),
    createdBy: text('created_by').notNull().default('system'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    primaryKey({ columns: [t.fromItemId, t.toItemId, t.linkType] }),
    index('idx_document_item_item_links_from').on(t.fromItemId),
    index('idx_document_item_item_links_to_item').on(t.toItemId),
  ],
)

export type DocumentItemItemLink = typeof documentItemItemLinks.$inferSelect
export type NewDocumentItemItemLink = typeof documentItemItemLinks.$inferInsert

export const documentItemRelationLinks = sqliteTable(
  'document_item_relation_links',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => documentItems.id, { onDelete: 'cascade' }),
    relationId: text('relation_id').references(() => codeRelations.id, { onDelete: 'cascade' }),
    relationKey: text('relation_key').notNull(),
    repoId: text('repo_id').notNull(),
    sourceNodeId: text('source_node_id').notNull(),
    kind: text('kind').notNull().$type<CodeRelationKind>(),
    target: text('target'),
    operation: text('operation'),
    canonicalTarget: text('canonical_target'),
    payloadJson: text('payload_json', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    evidenceNodeIdsJson: text('evidence_node_ids_json', { mode: 'json' }).notNull().$type<string[]>(),
    confidence: text('confidence').notNull().$type<CodeRelationConfidence>(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_document_item_relation_links_item_key').on(t.itemId, t.relationKey),
    index('idx_document_item_relation_links_item').on(t.itemId),
    index('idx_document_item_relation_links_relation').on(t.relationId),
    index('idx_document_item_relation_links_canonical_target').on(t.repoId, t.kind, t.canonicalTarget),
  ],
)

export type DocumentItemRelationLink = typeof documentItemRelationLinks.$inferSelect
export type NewDocumentItemRelationLink = typeof documentItemRelationLinks.$inferInsert

export const documentMemories = sqliteTable(
  'document_memories',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    memoryKey: text('memory_key').notNull(),
    scope: text('scope').notNull(),
    content: text('content').notNull(),
    source: text('source').notNull().default('user'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.memoryKey] }),
    index('idx_document_memories_scope').on(t.scope),
  ],
)

export type DocumentMemory = typeof documentMemories.$inferSelect
export type NewDocumentMemory = typeof documentMemories.$inferInsert

export const documentVersions = sqliteTable(
  'document_versions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    content: text('content', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    summary: text('summary'),
    createdBy: text('created_by').notNull().$type<'system' | 'llm' | 'user'>(),
    sourceRunId: text('source_run_id'),
    sourceCommit: text('source_commit'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_document_versions_doc_version').on(t.documentId, t.versionNo),
    index('idx_document_versions_document').on(t.documentId),
  ],
)

export type DocumentVersion = typeof documentVersions.$inferSelect
export type NewDocumentVersion = typeof documentVersions.$inferInsert

export type GenerationStage = 'build_docs' | 'build_epics'
export type GenerationRunStatus = 'planning' | 'awaiting_approval' | 'running' | 'completed' | 'failed' | 'cancelled'
export type GenerationEventType =
  | 'run_started'
  | 'run_awaiting_approval'
  | 'batch_approved'
  | 'task_leased'
  | 'task_submitted'
  | 'task_repair_requested'
  | 'task_validated'
  | 'task_saved'
  | 'task_completed'
  | 'task_failed'
  | 'task_expired'
  | 'leases_released'
  | 'draft_updated'
  | 'run_confirmed'
  | 'run_completed'
  | 'run_failed'
  | 'run_cancelled'
export type GenerationTaskStatus =
  | 'pending'
  | 'leased'
  | 'expired'
  | 'submitted'
  | 'repair_requested'
  | 'validated'
  | 'saved'
  | 'completed'
  | 'failed'
export type TechnicalDocumentType = 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
export type BuildEpicsGenerationTaskType = 'taxonomy_candidate' | 'taxonomy_consolidation' | 'document_assignment' | 'cross_domain_link'
export type GenerationTaskKind = TechnicalDocumentType | BuildEpicsGenerationTaskType

export const generationRuns = sqliteTable(
  'generation_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull().$type<GenerationStage>(),
    status: text('status').notNull().$type<GenerationRunStatus>(),
    outputLanguage: text('output_language').notNull().$type<'ko' | 'en'>(),
    requestedBy: text('requested_by').notNull(),
    sourceCommit: text('source_commit').notNull().default('unknown'),
    maxConcurrentTasks: integer('max_concurrent_tasks').notNull().default(0),
    approvedBy: text('approved_by'),
    approvedAt: text('approved_at'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
    finishedAt: text('finished_at'),
  },
  (t) => [
    index('idx_generation_runs_project_stage_status').on(t.projectId, t.stage, t.status),
    index('idx_generation_runs_project_created').on(t.projectId, t.createdAt),
  ],
)

export type GenerationRun = typeof generationRuns.$inferSelect
export type NewGenerationRun = typeof generationRuns.$inferInsert

export const generationTasks = sqliteTable(
  'generation_tasks',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    documentType: text('document_type').notNull().$type<GenerationTaskKind>(),
    targetKey: text('target_key').notNull(),
    targetDocumentId: text('target_document_id').notNull(),
    primaryEntryPointId: text('primary_entry_point_id').notNull(),
    targetJson: text('target_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    status: text('status').notNull().$type<GenerationTaskStatus>().default('pending'),
    leaseToken: text('lease_token'),
    leasedBy: text('leased_by'),
    leaseExpiresAt: text('lease_expires_at'),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(2),
    lastValidationErrors: text('last_validation_errors', { mode: 'json' }).$type<Array<Record<string, unknown>> | null>(),
    submittedDocument: text('submitted_document', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    savedDocumentId: text('saved_document_id').references(() => documents.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_generation_tasks_run_repo_target').on(t.runId, t.repositoryId, t.targetKey),
    index('idx_generation_tasks_run_status').on(t.runId, t.status),
    index('idx_generation_tasks_run_type_status').on(t.runId, t.documentType, t.status),
    index('idx_generation_tasks_repository').on(t.repositoryId),
  ],
)

export type GenerationTask = typeof generationTasks.$inferSelect
export type NewGenerationTask = typeof generationTasks.$inferInsert

export const generationEvents = sqliteTable(
  'generation_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => generationTasks.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull().$type<GenerationEventType>(),
    payloadJson: text('payload_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_generation_events_run_created').on(t.runId, t.createdAt),
    index('idx_generation_events_task_created').on(t.taskId, t.createdAt),
  ],
)

export type GenerationEvent = typeof generationEvents.$inferSelect
export type NewGenerationEvent = typeof generationEvents.$inferInsert

export const generationContextBundles = sqliteTable(
  'generation_context_bundles',
  {
    contextHandle: text('context_handle').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => generationTasks.id, { onDelete: 'cascade' }),
    sourceCommit: text('source_commit').notNull(),
    schemaVersion: text('schema_version').notNull(),
    manifestJson: text('manifest_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    contentHash: text('content_hash').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('idx_generation_context_bundles_task').on(t.taskId),
    index('idx_generation_context_bundles_run').on(t.runId),
  ],
)

export type GenerationContextBundle = typeof generationContextBundles.$inferSelect
export type NewGenerationContextBundle = typeof generationContextBundles.$inferInsert

export const generationContextPages = sqliteTable(
  'generation_context_pages',
  {
    contextHandle: text('context_handle')
      .notNull()
      .references(() => generationContextBundles.contextHandle, { onDelete: 'cascade' }),
    pageId: text('page_id').notNull(),
    pageKind: text('page_kind').notNull(),
    pageOrder: integer('page_order').notNull(),
    summary: text('summary').notNull(),
    evidenceIdsJson: text('evidence_ids_json', { mode: 'json' }).notNull().$type<string[]>(),
    contentJson: text('content_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    contentHash: text('content_hash').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    primaryKey({ columns: [t.contextHandle, t.pageId] }),
    index('idx_generation_context_pages_handle_order').on(t.contextHandle, t.pageOrder),
  ],
)

export type GenerationContextPage = typeof generationContextPages.$inferSelect
export type NewGenerationContextPage = typeof generationContextPages.$inferInsert

export const documentProposals = sqliteTable(
  'document_proposals',
  {
    id: text('id').primaryKey(),
    baseDocumentId: text('base_document_id').references(() => documents.id, { onDelete: 'set null' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    scope: text('scope').notNull(),
    scopeId: text('scope_id').notNull(),
    operation: text('operation').notNull().$type<'create' | 'update'>(),
    proposedContent: text('proposed_content', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    baseContentHash: text('base_content_hash'),
    summary: text('summary'),
    reason: text('reason'),
    sourceRunId: text('source_run_id'),
    sourceCommit: text('source_commit'),
    status: text('status').notNull().default('pending').$type<'pending' | 'accepted' | 'rejected'>(),
    validity: text('validity').notNull().default('fresh').$type<'fresh' | 'stale' | 'orphaned'>(),
    createdBy: text('created_by').notNull().default('llm').$type<'system' | 'llm' | 'user'>(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    resolvedBy: text('resolved_by'),
    resolvedAt: text('resolved_at'),
  },
  (t) => [
    index('idx_document_proposals_project').on(t.projectId),
    index('idx_document_proposals_base_document').on(t.baseDocumentId),
    index('idx_document_proposals_target').on(t.projectId, t.type, t.scope, t.scopeId),
    index('idx_document_proposals_status').on(t.status),
  ],
)

export type DocumentProposal = typeof documentProposals.$inferSelect
export type NewDocumentProposal = typeof documentProposals.$inferInsert

export const docRelationLinks = sqliteTable(
  'doc_relation_links',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
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
    index('idx_doc_relation_links_document').on(t.documentId),
    index('idx_doc_relation_links_relation').on(t.relationId),
    index('idx_doc_relation_links_repo').on(t.repoId),
    index('idx_doc_relation_links_canonical_target').on(t.repoId, t.kind, t.canonicalTarget),
  ],
)

export type DocRelationLink = typeof docRelationLinks.$inferSelect
export type NewDocRelationLink = typeof docRelationLinks.$inferInsert
