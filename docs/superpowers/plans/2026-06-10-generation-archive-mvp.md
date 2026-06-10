# Generation Archive MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add low-risk append-only archive storage for generated technical docs, sync-applied docs, business docs, and epics without changing existing latest-table behavior.

**Architecture:** Keep current operational tables as the only source used by generation, search, graph materialization, and CLI reads. Add separate archive tables for document and epic snapshots plus source links, and call best-effort archive writers after successful latest writes. Existing `document_versions` stays untouched because it already stores shallow business-doc content history.

**Tech Stack:** TypeScript, Drizzle ORM, better-sqlite3, SQLite migrations, Vitest, existing Platty core pipeline modules.

---

## File Map

- Create: `packages/core/src/db/migrations/0037_generation_archive_mvp.sql`
- Modify: `packages/core/src/db/schema/build_docs.ts`
  - Add `documentArchiveVersions` and `documentArchiveSources`.
- Modify: `packages/core/src/db/schema/build_epics.ts`
  - Add `epicArchiveVersions` and `epicArchiveSources`.
- Create: `packages/core/src/pipeline_modules/shared/generation_archive.ts`
  - Own all archive append and best-effort helpers.
- Modify: `packages/core/src/pipeline_modules/build_docs/runtime/runtime.ts`
  - Archive generated technical docs after latest document/dependency/relation writes succeed.
- Modify: `packages/core/src/pipeline_modules/sync/doc_sync.ts`
  - Archive sync-applied document changes, refreshed rows, and orphan tombstones.
- Modify: `packages/core/src/pipeline_modules/build_business_docs_cli/submit.ts`
  - Archive canonical business docs after existing latest writes and existing `appendVersion`.
- Modify: `packages/core/src/pipeline_modules/build_epics/core/f10_persist_confirmed_epics.ts`
  - Archive confirmed and soft-deleted epics after latest epic/link/dependency writes succeed.
- Add tests:
  - `packages/core/tests/pipeline_modules/shared/generation_archive.test.ts`
  - `packages/core/tests/pipeline_modules/build_docs/runtime/archive.test.ts`
  - `packages/core/tests/pipeline_modules/sync/doc_sync_archive.test.ts`
  - `packages/core/tests/pipeline_modules/build_business_docs_cli/archive.test.ts`
  - `packages/core/tests/pipeline_modules/build_epics/archive.test.ts`

## Design Rules

- Do not change existing `document_versions` behavior.
- Do not make existing query, generation, graph, or materializer code read archive tables.
- Do not copy all `code_nodes`, service-map rows, FTS rows, or item graph rows.
- Archive source links should store nullable foreign references and evidence JSON so archive writes do not fail when source version resolution is incomplete.
- Archive writes are best-effort: any archive exception is caught and logged; latest writes remain successful.
- Archive writes happen after the latest transaction has committed whenever the current function allows it.
- If a function already performs all latest writes inside a transaction, do not put best-effort archive inserts inside that transaction unless the archive helper catches all exceptions internally.

## Task 1: Schema And Migration

**Files:**
- Modify: `packages/core/src/db/schema/build_docs.ts`
- Modify: `packages/core/src/db/schema/build_epics.ts`
- Create: `packages/core/src/db/migrations/0037_generation_archive_mvp.sql`
- Test: `packages/core/tests/pipeline_modules/shared/generation_archive.test.ts`

- [ ] **Step 1: Write the failing migration/schema test**

Create `packages/core/tests/pipeline_modules/shared/generation_archive.test.ts` with this test skeleton:

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../server/helpers.js'
import {
  documentArchiveSources,
  documentArchiveVersions,
  documents,
} from '../../../src/db/schema/build_docs.js'
import {
  epicArchiveSources,
  epicArchiveVersions,
} from '../../../src/db/schema/build_epics.js'
import { epics, projects } from '../../../src/db/schema/core.js'

describe('generation archive schema', () => {
  it('persists document and epic archive snapshots with source links', () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'project:archive', name: 'Archive' }).run()
    db.insert(documents).values({
      id: 'doc:api:orders',
      projectId: 'project:archive',
      type: 'api_spec',
      track: 'technical',
      scope: 'route',
      scopeId: 'route:orders',
      status: 'passed',
      validity: 'fresh',
      summary: 'Orders API',
      content: { id: 'doc:api:orders' },
      rawLlmOutput: '{}',
      contentHash: 'hash:doc',
      documentSourceHash: 'hash:source',
      staticSnapshotId: 'snapshot:1',
      sourceRunId: 'run:docs',
      sourceCommit: 'commit:1',
      updatedBy: 'llm',
      updatedAt: '2026-06-10T00:00:00.000Z',
    }).run()
    db.insert(epics).values({
      id: 'epic:orders',
      projectId: 'project:archive',
      domainId: null,
      name: 'Orders',
      abbr: 'ORD',
      description: 'Orders flow',
      stableKey: 'orders',
      summary: 'Orders flow',
      status: 'confirmed',
      source: 'build_epics',
      confidence: 'high',
      confirmedAt: '2026-06-10T00:00:00.000Z',
      deletedAt: null,
      createdAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:00:00.000Z',
    }).run()

    db.insert(documentArchiveVersions).values({
      id: 'dav:1',
      documentId: 'doc:api:orders',
      versionNo: 1,
      projectId: 'project:archive',
      type: 'api_spec',
      track: 'technical',
      scope: 'route',
      scopeId: 'route:orders',
      status: 'passed',
      validity: 'fresh',
      summary: 'Orders API',
      content: { id: 'doc:api:orders' },
      rawLlmOutput: '{}',
      contentHash: 'hash:doc',
      documentSourceHash: 'hash:source',
      staticSnapshotId: 'snapshot:1',
      sourceRunId: 'run:docs',
      sourceCommit: 'commit:1',
      generatedStage: 'build_docs',
      changeKind: 'created',
      outputLanguage: 'en',
      generatedAt: '2026-06-10T00:00:00.000Z',
      createdAt: '2026-06-10T00:00:00.000Z',
      createdBy: 'llm',
    }).run()
    db.insert(documentArchiveSources).values({
      id: 'das:1',
      targetVersionId: 'dav:1',
      sourceType: 'code',
      sourceDocumentId: null,
      sourceDocumentVersionId: null,
      sourceRef: 'route:orders',
      linkType: 'code_evidence',
      sourceCommit: 'commit:1',
      sourceContentHash: 'hash:route',
      evidenceJson: { path: 'src/orders.ts' },
      createdAt: '2026-06-10T00:00:00.000Z',
    }).run()
    db.insert(epicArchiveVersions).values({
      id: 'eav:1',
      epicId: 'epic:orders',
      versionNo: 1,
      projectId: 'project:archive',
      domainId: null,
      name: 'Orders',
      abbr: 'ORD',
      summary: 'Orders flow',
      description: 'Orders flow',
      status: 'confirmed',
      confidence: 'high',
      stableKey: 'orders',
      deletedAt: null,
      contentJson: { name: 'Orders' },
      sourceRunId: 'run:epics',
      sourceCommit: 'commit:1',
      outputLanguage: 'en',
      generatedAt: '2026-06-10T00:00:00.000Z',
      createdAt: '2026-06-10T00:00:00.000Z',
      createdBy: 'llm',
    }).run()
    db.insert(epicArchiveSources).values({
      id: 'eas:1',
      epicVersionId: 'eav:1',
      sourceDocumentId: 'doc:api:orders',
      sourceDocumentVersionId: 'dav:1',
      documentType: 'api_spec',
      role: 'primary',
      reason: 'Owns order flow',
      confidence: 'high',
      sourceCommit: 'commit:1',
      sourceContentHash: 'hash:doc',
      evidenceJson: { reason: 'Owns order flow' },
      createdAt: '2026-06-10T00:00:00.000Z',
    }).run()

    expect(db.select().from(documentArchiveVersions).where(eq(documentArchiveVersions.id, 'dav:1')).get()?.versionNo).toBe(1)
    expect(db.select().from(documentArchiveSources).where(eq(documentArchiveSources.id, 'das:1')).get()?.linkType).toBe('code_evidence')
    expect(db.select().from(epicArchiveVersions).where(eq(epicArchiveVersions.id, 'eav:1')).get()?.name).toBe('Orders')
    expect(db.select().from(epicArchiveSources).where(eq(epicArchiveSources.id, 'eas:1')).get()?.role).toBe('primary')
  })
})
```

- [ ] **Step 2: Run the red test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/shared/generation_archive.test.ts
```

Expected: FAIL because `documentArchiveVersions`, `documentArchiveSources`, `epicArchiveVersions`, and `epicArchiveSources` do not exist.

- [ ] **Step 3: Add Drizzle schema**

In `packages/core/src/db/schema/build_docs.ts`, add:

```ts
export const documentArchiveVersions = sqliteTable(
  'document_archive_versions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    track: text('track').notNull(),
    scope: text('scope').notNull(),
    scopeId: text('scope_id'),
    status: text('status').notNull(),
    validity: text('validity').notNull(),
    summary: text('summary'),
    content: text('content', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    rawLlmOutput: text('raw_llm_output').notNull().default(''),
    contentHash: text('content_hash'),
    documentSourceHash: text('document_source_hash'),
    staticSnapshotId: text('static_snapshot_id'),
    sourceRunId: text('source_run_id'),
    sourceCommit: text('source_commit'),
    generatedStage: text('generated_stage').notNull().$type<'build_docs' | 'sync' | 'build_business_docs'>(),
    changeKind: text('change_kind').notNull().$type<'created' | 'updated' | 'refreshed' | 'orphaned' | 'deleted'>(),
    outputLanguage: text('output_language').$type<'ko' | 'en'>(),
    generatedAt: text('generated_at').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    createdBy: text('created_by').notNull().$type<'system' | 'llm' | 'user'>(),
  },
  (t) => [
    uniqueIndex('idx_document_archive_versions_doc_version').on(t.documentId, t.versionNo),
    index('idx_document_archive_versions_document_time').on(t.documentId, t.generatedAt),
    index('idx_document_archive_versions_project_time').on(t.projectId, t.generatedAt),
    index('idx_document_archive_versions_run').on(t.sourceRunId),
    index('idx_document_archive_versions_stage').on(t.projectId, t.generatedStage),
  ],
)

export const documentArchiveSources = sqliteTable(
  'document_archive_sources',
  {
    id: text('id').primaryKey(),
    targetVersionId: text('target_version_id')
      .notNull()
      .references(() => documentArchiveVersions.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull().$type<'document' | 'code' | 'model' | 'relation' | 'epic'>(),
    sourceDocumentId: text('source_document_id').references(() => documents.id, { onDelete: 'set null' }),
    sourceDocumentVersionId: text('source_document_version_id').references(() => documentArchiveVersions.id, { onDelete: 'set null' }),
    sourceRef: text('source_ref'),
    linkType: text('link_type').notNull(),
    sourceCommit: text('source_commit'),
    sourceContentHash: text('source_content_hash'),
    evidenceJson: text('evidence_json', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_document_archive_sources_target').on(t.targetVersionId),
    index('idx_document_archive_sources_source_doc').on(t.sourceDocumentId),
    index('idx_document_archive_sources_source_version').on(t.sourceDocumentVersionId),
  ],
)

export type DocumentArchiveVersion = typeof documentArchiveVersions.$inferSelect
export type NewDocumentArchiveVersion = typeof documentArchiveVersions.$inferInsert
export type DocumentArchiveSource = typeof documentArchiveSources.$inferSelect
export type NewDocumentArchiveSource = typeof documentArchiveSources.$inferInsert
```

In `packages/core/src/db/schema/build_epics.ts`, add:

```ts
// Add `integer` to the existing sqlite-core import in this file.
export const epicArchiveVersions = sqliteTable(
  'epic_archive_versions',
  {
    id: text('id').primaryKey(),
    epicId: text('epic_id')
      .notNull()
      .references(() => epics.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    domainId: text('domain_id'),
    name: text('name').notNull(),
    abbr: text('abbr'),
    summary: text('summary'),
    description: text('description'),
    status: text('status').notNull(),
    confidence: text('confidence'),
    stableKey: text('stable_key'),
    deletedAt: text('deleted_at'),
    contentJson: text('content_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    sourceRunId: text('source_run_id'),
    sourceCommit: text('source_commit'),
    outputLanguage: text('output_language').$type<'ko' | 'en'>(),
    generatedAt: text('generated_at').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    createdBy: text('created_by').notNull().$type<'system' | 'llm' | 'user'>(),
  },
  (t) => [
    uniqueIndex('idx_epic_archive_versions_epic_version').on(t.epicId, t.versionNo),
    index('idx_epic_archive_versions_epic_time').on(t.epicId, t.generatedAt),
    index('idx_epic_archive_versions_project_time').on(t.projectId, t.generatedAt),
    index('idx_epic_archive_versions_run').on(t.sourceRunId),
  ],
)

export const epicArchiveSources = sqliteTable(
  'epic_archive_sources',
  {
    id: text('id').primaryKey(),
    epicVersionId: text('epic_version_id')
      .notNull()
      .references(() => epicArchiveVersions.id, { onDelete: 'cascade' }),
    sourceDocumentId: text('source_document_id').references(() => documents.id, { onDelete: 'set null' }),
    sourceDocumentVersionId: text('source_document_version_id').references(() => documentArchiveVersions.id, { onDelete: 'set null' }),
    documentType: text('document_type').notNull().$type<EpicDocumentType>(),
    role: text('role').notNull().$type<EpicDocumentRole>(),
    reason: text('reason').notNull(),
    confidence: text('confidence').notNull().$type<PersistedConfidence>(),
    sourceCommit: text('source_commit'),
    sourceContentHash: text('source_content_hash'),
    evidenceJson: text('evidence_json', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_epic_archive_sources_epic_version').on(t.epicVersionId),
    index('idx_epic_archive_sources_source_doc').on(t.sourceDocumentId),
    index('idx_epic_archive_sources_source_version').on(t.sourceDocumentVersionId),
  ],
)

export type EpicArchiveVersion = typeof epicArchiveVersions.$inferSelect
export type NewEpicArchiveVersion = typeof epicArchiveVersions.$inferInsert
export type EpicArchiveSource = typeof epicArchiveSources.$inferSelect
export type NewEpicArchiveSource = typeof epicArchiveSources.$inferInsert
```

- [ ] **Step 4: Add SQL migration**

Create `packages/core/src/db/migrations/0037_generation_archive_mvp.sql` with matching SQL:

```sql
CREATE TABLE `document_archive_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `version_no` integer NOT NULL,
  `project_id` text NOT NULL,
  `type` text NOT NULL,
  `track` text NOT NULL,
  `scope` text NOT NULL,
  `scope_id` text,
  `status` text NOT NULL,
  `validity` text NOT NULL,
  `summary` text,
  `content` text,
  `raw_llm_output` text DEFAULT '' NOT NULL,
  `content_hash` text,
  `document_source_hash` text,
  `static_snapshot_id` text,
  `source_run_id` text,
  `source_commit` text,
  `generated_stage` text NOT NULL,
  `change_kind` text NOT NULL,
  `output_language` text,
  `generated_at` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `created_by` text NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_document_archive_versions_doc_version` ON `document_archive_versions` (`document_id`,`version_no`);
--> statement-breakpoint
CREATE INDEX `idx_document_archive_versions_document_time` ON `document_archive_versions` (`document_id`,`generated_at`);
--> statement-breakpoint
CREATE INDEX `idx_document_archive_versions_project_time` ON `document_archive_versions` (`project_id`,`generated_at`);
--> statement-breakpoint
CREATE INDEX `idx_document_archive_versions_run` ON `document_archive_versions` (`source_run_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_archive_versions_stage` ON `document_archive_versions` (`project_id`,`generated_stage`);
--> statement-breakpoint
CREATE TABLE `document_archive_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `target_version_id` text NOT NULL,
  `source_type` text NOT NULL,
  `source_document_id` text,
  `source_document_version_id` text,
  `source_ref` text,
  `link_type` text NOT NULL,
  `source_commit` text,
  `source_content_hash` text,
  `evidence_json` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`target_version_id`) REFERENCES `document_archive_versions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`source_document_version_id`) REFERENCES `document_archive_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_document_archive_sources_target` ON `document_archive_sources` (`target_version_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_archive_sources_source_doc` ON `document_archive_sources` (`source_document_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_archive_sources_source_version` ON `document_archive_sources` (`source_document_version_id`);
--> statement-breakpoint
CREATE TABLE `epic_archive_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `epic_id` text NOT NULL,
  `version_no` integer NOT NULL,
  `project_id` text NOT NULL,
  `domain_id` text,
  `name` text NOT NULL,
  `abbr` text,
  `summary` text,
  `description` text,
  `status` text NOT NULL,
  `confidence` text,
  `stable_key` text,
  `deleted_at` text,
  `content_json` text NOT NULL,
  `source_run_id` text,
  `source_commit` text,
  `output_language` text,
  `generated_at` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `created_by` text NOT NULL,
  FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_epic_archive_versions_epic_version` ON `epic_archive_versions` (`epic_id`,`version_no`);
--> statement-breakpoint
CREATE INDEX `idx_epic_archive_versions_epic_time` ON `epic_archive_versions` (`epic_id`,`generated_at`);
--> statement-breakpoint
CREATE INDEX `idx_epic_archive_versions_project_time` ON `epic_archive_versions` (`project_id`,`generated_at`);
--> statement-breakpoint
CREATE INDEX `idx_epic_archive_versions_run` ON `epic_archive_versions` (`source_run_id`);
--> statement-breakpoint
CREATE TABLE `epic_archive_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `epic_version_id` text NOT NULL,
  `source_document_id` text,
  `source_document_version_id` text,
  `document_type` text NOT NULL,
  `role` text NOT NULL,
  `reason` text NOT NULL,
  `confidence` text NOT NULL,
  `source_commit` text,
  `source_content_hash` text,
  `evidence_json` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`epic_version_id`) REFERENCES `epic_archive_versions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`source_document_version_id`) REFERENCES `document_archive_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_epic_archive_sources_epic_version` ON `epic_archive_sources` (`epic_version_id`);
--> statement-breakpoint
CREATE INDEX `idx_epic_archive_sources_source_doc` ON `epic_archive_sources` (`source_document_id`);
--> statement-breakpoint
CREATE INDEX `idx_epic_archive_sources_source_version` ON `epic_archive_sources` (`source_document_version_id`);
```

- [ ] **Step 5: Run the green schema test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/shared/generation_archive.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit schema**

Run:

```bash
git add packages/core/src/db/schema/build_docs.ts packages/core/src/db/schema/build_epics.ts packages/core/src/db/migrations/0037_generation_archive_mvp.sql packages/core/tests/pipeline_modules/shared/generation_archive.test.ts
git commit -m "feat(core): add generation archive schema"
```

## Task 2: Shared Best-Effort Archive Helper

**Files:**
- Create: `packages/core/src/pipeline_modules/shared/generation_archive.ts`
- Modify: `packages/core/tests/pipeline_modules/shared/generation_archive.test.ts`

- [ ] **Step 1: Add failing helper tests**

Append tests that call `appendDocumentArchiveVersionBestEffort` twice with the same fingerprint and assert one row, then call it with changed content hash and assert version 2.

Use this input shape:

```ts
const baseDocumentSnapshot = {
  documentId: 'doc:api:orders',
  projectId: 'project:archive',
  type: 'api_spec',
  track: 'technical',
  scope: 'route',
  scopeId: 'route:orders',
  status: 'passed',
  validity: 'fresh',
  summary: 'Orders API',
  content: { id: 'doc:api:orders' },
  rawLlmOutput: '{}',
  contentHash: 'hash:doc',
  documentSourceHash: 'hash:source',
  staticSnapshotId: 'snapshot:1',
  sourceRunId: 'run:docs',
  sourceCommit: 'commit:1',
  generatedStage: 'build_docs' as const,
  changeKind: 'created' as const,
  outputLanguage: 'en' as const,
  generatedAt: '2026-06-10T00:00:00.000Z',
  createdBy: 'llm' as const,
}
```

Assert:

```ts
const first = appendDocumentArchiveVersionBestEffort(db, { snapshot: baseDocumentSnapshot, sources: [] })
const duplicate = appendDocumentArchiveVersionBestEffort(db, { snapshot: baseDocumentSnapshot, sources: [] })
const changed = appendDocumentArchiveVersionBestEffort(db, {
  snapshot: { ...baseDocumentSnapshot, contentHash: 'hash:doc:2', changeKind: 'updated' },
  sources: [],
})

expect(first.status).toBe('inserted')
expect(duplicate.status).toBe('skipped')
expect(changed.status).toBe('inserted')
expect(changed.versionNo).toBe(2)
```

- [ ] **Step 2: Run the red helper test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/shared/generation_archive.test.ts
```

Expected: FAIL because `generation_archive.ts` does not exist.

- [ ] **Step 3: Implement the helper module**

Create `packages/core/src/pipeline_modules/shared/generation_archive.ts` with exported types and functions:

```ts
import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DB } from '@/db/client.js'
import {
  documentArchiveSources,
  documentArchiveVersions,
  type NewDocumentArchiveSource,
  type NewDocumentArchiveVersion,
} from '@/db/schema/build_docs.js'
import {
  epicArchiveSources,
  epicArchiveVersions,
  type NewEpicArchiveSource,
  type NewEpicArchiveVersion,
} from '@/db/schema/build_epics.js'

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]
type WriteDb = DB | Tx

export type ArchiveWriteResult =
  | { status: 'inserted'; versionId: string; versionNo: number }
  | { status: 'skipped'; versionId: string | null; versionNo: number | null }
  | { status: 'failed'; versionId: null; versionNo: null; error: unknown }

export type DocumentArchiveSnapshot = Omit<NewDocumentArchiveVersion, 'id' | 'versionNo' | 'createdAt'>
export type DocumentArchiveSourceInput = Omit<NewDocumentArchiveSource, 'id' | 'targetVersionId' | 'createdAt'>
export type EpicArchiveSnapshot = Omit<NewEpicArchiveVersion, 'id' | 'versionNo' | 'createdAt'>
export type EpicArchiveSourceInput = Omit<NewEpicArchiveSource, 'id' | 'epicVersionId' | 'createdAt'>

export function appendDocumentArchiveVersionBestEffort(
  db: WriteDb,
  input: { snapshot: DocumentArchiveSnapshot; sources: DocumentArchiveSourceInput[] },
): ArchiveWriteResult {
  try {
    const latest = db.select()
      .from(documentArchiveVersions)
      .where(eq(documentArchiveVersions.documentId, input.snapshot.documentId))
      .orderBy(desc(documentArchiveVersions.versionNo))
      .get()
    if (latest && documentFingerprint(latest) === documentFingerprint(input.snapshot)) {
      return { status: 'skipped', versionId: latest.id, versionNo: latest.versionNo }
    }
    const versionId = nanoid()
    const versionNo = (latest?.versionNo ?? 0) + 1
    db.insert(documentArchiveVersions).values({ id: versionId, versionNo, ...input.snapshot }).run()
    for (const source of input.sources) {
      db.insert(documentArchiveSources).values({ id: nanoid(), targetVersionId: versionId, ...source }).run()
    }
    return { status: 'inserted', versionId, versionNo }
  } catch (error) {
    console.warn('[generation_archive] document archive write failed', error)
    return { status: 'failed', versionId: null, versionNo: null, error }
  }
}

export function appendEpicArchiveVersionBestEffort(
  db: WriteDb,
  input: { snapshot: EpicArchiveSnapshot; sources: EpicArchiveSourceInput[] },
): ArchiveWriteResult {
  try {
    const latest = db.select()
      .from(epicArchiveVersions)
      .where(eq(epicArchiveVersions.epicId, input.snapshot.epicId))
      .orderBy(desc(epicArchiveVersions.versionNo))
      .get()
    if (latest && epicFingerprint(latest) === epicFingerprint(input.snapshot)) {
      return { status: 'skipped', versionId: latest.id, versionNo: latest.versionNo }
    }
    const versionId = nanoid()
    const versionNo = (latest?.versionNo ?? 0) + 1
    db.insert(epicArchiveVersions).values({ id: versionId, versionNo, ...input.snapshot }).run()
    for (const source of input.sources) {
      db.insert(epicArchiveSources).values({ id: nanoid(), epicVersionId: versionId, ...source }).run()
    }
    return { status: 'inserted', versionId, versionNo }
  } catch (error) {
    console.warn('[generation_archive] epic archive write failed', error)
    return { status: 'failed', versionId: null, versionNo: null, error }
  }
}

function documentFingerprint(input: {
  contentHash: string | null
  documentSourceHash: string | null
  status: string
  validity: string
  generatedStage: string
}): string {
  return JSON.stringify({
    contentHash: input.contentHash,
    documentSourceHash: input.documentSourceHash,
    status: input.status,
    validity: input.validity,
    generatedStage: input.generatedStage,
  })
}

function epicFingerprint(input: {
  contentJson: Record<string, unknown>
  status: string
  deletedAt: string | null
  sourceCommit: string | null
}): string {
  return JSON.stringify({
    contentJson: input.contentJson,
    status: input.status,
    deletedAt: input.deletedAt,
    sourceCommit: input.sourceCommit,
  })
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/shared/generation_archive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper**

Run:

```bash
git add packages/core/src/pipeline_modules/shared/generation_archive.ts packages/core/tests/pipeline_modules/shared/generation_archive.test.ts
git commit -m "feat(core): add best-effort generation archive writer"
```

## Task 3: Archive build_docs Technical Documents

**Files:**
- Modify: `packages/core/src/pipeline_modules/build_docs/runtime/runtime.ts`
- Add: `packages/core/tests/pipeline_modules/build_docs/runtime/archive.test.ts`

- [ ] **Step 1: Write failing runtime archive test**

Create a focused test that runs the existing build_docs runtime save path or calls the smallest public submit/save method available in `runtime.test.ts` fixtures. Assert that after a technical document is saved, one `document_archive_versions` row exists with:

```ts
expect(row).toMatchObject({
  documentId: savedDocumentId,
  projectId,
  type: 'api_spec',
  track: 'technical',
  status: 'passed',
  validity: 'fresh',
  generatedStage: 'build_docs',
  changeKind: 'created',
  sourceRunId: runId,
  outputLanguage: 'en',
})
```

Also assert at least one source row with `sourceType='code'` when the test context includes `source_context`.

- [ ] **Step 2: Run the red test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_docs/runtime/archive.test.ts
```

Expected: FAIL because build_docs does not write archive rows.

- [ ] **Step 3: Hook archive write after latest transaction**

In `packages/core/src/pipeline_modules/build_docs/runtime/runtime.ts`, after the transaction in `persistDocument()` completes, call:

```ts
appendDocumentArchiveVersionBestEffort(this.input.db, {
  snapshot: {
    documentId,
    projectId: input.task.projectId,
    type: input.task.documentType,
    track: 'technical',
    scope,
    scopeId: input.task.primaryEntryPointId,
    status: 'passed',
    validity: 'fresh',
    summary: stringOrNull(input.document.summary),
    content: input.document,
    rawLlmOutput: JSON.stringify(input.rawDraft),
    contentHash,
    documentSourceHash: sourceStamp.documentSourceHash,
    staticSnapshotId: sourceStamp.staticSnapshotId,
    sourceRunId: input.run.id,
    sourceCommit: input.run.sourceCommit,
    generatedStage: 'build_docs',
    changeKind: 'updated',
    outputLanguage: input.run.outputLanguage,
    generatedAt: savedAt,
    createdBy: 'llm',
  },
  sources: buildDocumentArchiveSourcesFromBuildDocsContext(input.context, input.run.sourceCommit),
})
```

Add a local helper in the same file or a small exported helper in `generation_archive.ts`:

```ts
function buildDocumentArchiveSourcesFromBuildDocsContext(
  context: BuildDocsGenerationContextResponse,
  sourceCommit: string | null,
): DocumentArchiveSourceInput[] {
  const rows: DocumentArchiveSourceInput[] = []
  for (const excerpt of context.content.source_context ?? []) {
    rows.push({
      sourceType: 'code',
      sourceDocumentId: null,
      sourceDocumentVersionId: null,
      sourceRef: String((excerpt as Record<string, unknown>).id ?? (excerpt as Record<string, unknown>).node_id ?? ''),
      linkType: 'code_evidence',
      sourceCommit,
      sourceContentHash: String((excerpt as Record<string, unknown>).content_hash ?? ''),
      evidenceJson: excerpt as Record<string, unknown>,
    })
  }
  return rows
}
```

Keep source field reads defensive because context shapes can vary.

- [ ] **Step 4: Run runtime archive test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_docs/runtime/archive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run existing build_docs runtime tests**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_docs/runtime/runtime.test.ts
```

Expected: PASS. Existing latest behavior remains unchanged.

- [ ] **Step 6: Commit build_docs archive hook**

Run:

```bash
git add packages/core/src/pipeline_modules/build_docs/runtime/runtime.ts packages/core/tests/pipeline_modules/build_docs/runtime/archive.test.ts
git commit -m "feat(core): archive generated technical documents"
```

## Task 4: Archive sync Document Changes

**Files:**
- Modify: `packages/core/src/pipeline_modules/sync/doc_sync.ts`
- Add: `packages/core/tests/pipeline_modules/sync/doc_sync_archive.test.ts`

- [ ] **Step 1: Write failing sync archive tests**

Create tests covering:

```ts
it('archives staged sync output as a document archive version', () => {})
it('archives fresh stale_candidate refresh without duplicating content', () => {})
it('archives orphan decisions as tombstone versions', () => {})
```

Assertions:

```ts
expect(version.generatedStage).toBe('sync')
expect(version.changeKind).toBe('created') // new output
expect(version.changeKind).toBe('refreshed') // stale_candidate fresh
expect(version.changeKind).toBe('orphaned') // orphan decision
expect(version.generatedAt).toMatch(/^20/)
```

- [ ] **Step 2: Run the red tests**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/sync/doc_sync_archive.test.ts
```

Expected: FAIL because sync does not archive.

- [ ] **Step 3: Collect archive inputs inside applyDocSyncPlan**

In `applyDocSyncPlan`, build an array while the latest transaction runs:

```ts
const archiveWrites: Array<{ snapshot: DocumentArchiveSnapshot; sources: DocumentArchiveSourceInput[] }> = []
```

For output documents, push a snapshot after latest upsert values are known:

```ts
archiveWrites.push({
  snapshot: {
    documentId,
    projectId: plan.projectId,
    type: target.type,
    track: target.track,
    scope: target.scope,
    scopeId: target.scopeId,
    status: 'passed',
    validity: 'fresh',
    summary: document.summary,
    content: document.content,
    rawLlmOutput: document.rawOutput ?? '',
    contentHash: output.contentHash,
    documentSourceHash: candidate.newHash,
    staticSnapshotId: plan.toSnapshotId,
    sourceRunId: plan.id,
    sourceCommit: null,
    generatedStage: 'sync',
    changeKind: existing ? 'updated' : 'created',
    outputLanguage: null,
    generatedAt: now(),
    createdBy: 'llm',
  },
  sources: [],
})
```

For fresh stale candidates, push `changeKind: 'refreshed'` with existing content/summary and new source hash.

For orphan decisions, push `changeKind: 'orphaned'`, `status: 'deleted'`, `validity: 'orphaned'`, and the existing content/summary.

- [ ] **Step 4: Append archive rows after transaction**

After the transaction completes:

```ts
for (const archiveWrite of archiveWrites) {
  appendDocumentArchiveVersionBestEffort(input.db, archiveWrite)
}
```

Do not use archive write results to change `appliedDocuments`.

- [ ] **Step 5: Run sync archive tests**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/sync/doc_sync_archive.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run existing sync tests**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/sync
```

Expected: PASS.

- [ ] **Step 7: Commit sync archive hook**

Run:

```bash
git add packages/core/src/pipeline_modules/sync/doc_sync.ts packages/core/tests/pipeline_modules/sync/doc_sync_archive.test.ts
git commit -m "feat(core): archive sync document changes"
```

## Task 5: Archive build_business_docs Canonical Saves

**Files:**
- Modify: `packages/core/src/pipeline_modules/build_business_docs_cli/submit.ts`
- Add: `packages/core/tests/pipeline_modules/build_business_docs_cli/archive.test.ts`

- [ ] **Step 1: Write failing business archive test**

Create a test that submits a canonical business document using existing submit fixtures. Assert:

```ts
expect(version).toMatchObject({
  documentId: savedDocumentId,
  projectId,
  track: 'business',
  generatedStage: 'build_business_docs',
  changeKind: 'created',
  sourceRunId: runId,
  sourceCommit,
  outputLanguage: 'en',
})
expect(sourceLinks.some((row) => row.linkType === 'source_document')).toBe(true)
```

Also assert existing `documentVersions` still gets its row:

```ts
expect(db.select().from(documentVersions).where(eq(documentVersions.documentId, savedDocumentId)).all()).toHaveLength(1)
```

- [ ] **Step 2: Run the red test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_business_docs_cli/archive.test.ts
```

Expected: FAIL because business docs only write existing `document_versions`, not archive tables.

- [ ] **Step 3: Hook archive after existing appendVersion and latest graph writes**

In `submit.ts`, after `appendVersion`, `replaceDocumentLinks`, `replaceDocumentItemSatellites`, and item source materialization calls, call:

```ts
appendDocumentArchiveVersionBestEffort(db, {
  snapshot: {
    documentId: savedDocumentId,
    projectId: input.context.task.projectId,
    type: input.document.documentType,
    track: 'business',
    scope: input.document.scope,
    scopeId: input.document.scopeId,
    status: 'active',
    validity: 'fresh',
    summary: input.document.summary,
    content: asJsonRecord(input.document),
    rawLlmOutput: JSON.stringify(input.document),
    contentHash: input.contentHash,
    documentSourceHash: syncMetadata?.sourceHash ?? null,
    staticSnapshotId: syncMetadata?.staticSnapshotId ?? null,
    sourceRunId: input.context.run.id,
    sourceCommit: input.context.run.sourceCommit,
    generatedStage: 'build_business_docs',
    changeKind: existing ? 'updated' : 'created',
    outputLanguage: input.context.run.policyJson.outputLanguage,
    generatedAt: input.now,
    createdBy: 'llm',
  },
  sources: buildBusinessDocumentArchiveSources(db, {
    sourceDocumentIds: systemSourceDocIds,
    sourceCommit: input.context.run.sourceCommit,
    pages: input.context.pages,
  }),
})
```

Implement `buildBusinessDocumentArchiveSources` in `generation_archive.ts` or locally in `submit.ts`. It should:

```ts
for each systemSourceDocId:
  find latest documentArchiveVersions row for that documentId
  insert a source row with sourceType='document', linkType='source_document'
  include sourceDocumentVersionId when found
  include sourceContentHash when found
```

If no archive version is found, still insert a source row with `sourceDocumentId`, `sourceDocumentVersionId: null`, and evidence from context pages.

- [ ] **Step 4: Run business archive tests**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_business_docs_cli/archive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run existing business submit tests**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_business_docs_cli/submit.test.ts packages/core/tests/pipeline_modules/build_business_docs_cli/persist_graph.test.ts
```

Expected: PASS. Existing `document_versions` behavior remains unchanged.

- [ ] **Step 6: Commit business archive hook**

Run:

```bash
git add packages/core/src/pipeline_modules/build_business_docs_cli/submit.ts packages/core/tests/pipeline_modules/build_business_docs_cli/archive.test.ts
git commit -m "feat(core): archive generated business documents"
```

## Task 6: Archive build_epics Confirmed Plans

**Files:**
- Modify: `packages/core/src/pipeline_modules/build_epics/core/f10_persist_confirmed_epics.ts`
- Add: `packages/core/tests/pipeline_modules/build_epics/archive.test.ts`

- [ ] **Step 1: Write failing epic archive test**

Create a test that persists a confirmed epic plan with one source document link and one stale epic. Assert:

```ts
expect(activeVersion).toMatchObject({
  epicId: activeEpicId,
  projectId,
  name: 'Orders',
  status: 'confirmed',
  sourceRunId: runId,
  sourceCommit,
  outputLanguage: 'en',
})
expect(activeSources[0]).toMatchObject({
  sourceDocumentId: sourceDocId,
  documentType: 'api_spec',
  role: 'primary',
})
expect(deletedVersion.deletedAt).toBe(now)
```

- [ ] **Step 2: Run the red test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_epics/archive.test.ts
```

Expected: FAIL because build_epics does not write epic archive rows.

- [ ] **Step 3: Append epic archives after latest transaction**

In `f10_persist_confirmed_epics.ts`, collect archive writes while persisting:

```ts
const epicArchiveWrites: Array<{ snapshot: EpicArchiveSnapshot; sources: EpicArchiveSourceInput[] }> = []
```

For each confirmed epic, push:

```ts
epicArchiveWrites.push({
  snapshot: {
    epicId,
    projectId: input.projectId,
    domainId,
    name: epic.name,
    abbr: epic.abbr,
    summary: epic.summary,
    description: epic.summary,
    status: epic.status,
    confidence: epic.confidence,
    stableKey: epic.validatedStableKey,
    deletedAt: null,
    contentJson: epic as unknown as Record<string, unknown>,
    sourceRunId: input.sourceRunId,
    sourceCommit: input.sourceCommit,
    outputLanguage: input.outputLanguage ?? 'en',
    generatedAt: now,
    createdBy: 'llm',
  },
  sources: linksForThisEpic.map((link) => ({
    sourceDocumentId: link.documentId,
    sourceDocumentVersionId: latestDocumentArchiveVersionIdOrNull(tx, link.documentId),
    documentType: link.documentType,
    role: link.role,
    reason: link.reason,
    confidence: link.confidence,
    sourceCommit: input.sourceCommit,
    sourceContentHash: null,
    evidenceJson: link,
  })),
})
```

For stale soft-deleted epics, push a tombstone snapshot with existing row values and `deletedAt: now`.

If `input.outputLanguage` does not exist on the function input type, add it as optional and pass `run.outputLanguage` from the caller in `build_epics/runtime/runtime.ts`.

- [ ] **Step 4: Run epic archive tests**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_epics/archive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run existing build_epics tests**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_epics
```

Expected: PASS.

- [ ] **Step 6: Commit epic archive hook**

Run:

```bash
git add packages/core/src/pipeline_modules/build_epics/core/f10_persist_confirmed_epics.ts packages/core/src/pipeline_modules/build_epics/runtime/runtime.ts packages/core/tests/pipeline_modules/build_epics/archive.test.ts
git commit -m "feat(core): archive generated epics"
```

## Task 7: Final Verification

**Files:**
- Verify all modified files from Tasks 1-6.

- [ ] **Step 1: Run core typecheck**

Run:

```bash
npm run typecheck --workspace packages/core
```

Expected: PASS.

- [ ] **Step 2: Run targeted archive-related tests**

Run:

```bash
npm test --workspace packages/core -- \
  packages/core/tests/pipeline_modules/shared/generation_archive.test.ts \
  packages/core/tests/pipeline_modules/build_docs/runtime/archive.test.ts \
  packages/core/tests/pipeline_modules/sync/doc_sync_archive.test.ts \
  packages/core/tests/pipeline_modules/build_business_docs_cli/archive.test.ts \
  packages/core/tests/pipeline_modules/build_epics/archive.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run affected existing suites**

Run:

```bash
npm test --workspace packages/core -- \
  packages/core/tests/pipeline_modules/build_docs/runtime/runtime.test.ts \
  packages/core/tests/pipeline_modules/sync \
  packages/core/tests/pipeline_modules/build_business_docs_cli/submit.test.ts \
  packages/core/tests/pipeline_modules/build_business_docs_cli/persist_graph.test.ts \
  packages/core/tests/pipeline_modules/build_epics
```

Expected: PASS.

- [ ] **Step 4: Run repository checks**

Run:

```bash
npm run typecheck
npm test
git diff --check
```

Expected: PASS for all commands.

- [ ] **Step 5: Inspect side effects**

Run:

```bash
rg -n "documentArchiveVersions|documentArchiveSources|epicArchiveVersions|epicArchiveSources" packages/core/src packages/cli/src
```

Expected: matches only schema, archive helper, archive write hooks, and tests. No CLI read path, search path, graph materializer, or prompt generation path should read archive tables.

- [ ] **Step 6: Final commit**

If prior tasks were not committed individually, commit all archive implementation changes:

```bash
git add packages/core/src packages/core/tests packages/core/src/db/migrations/0037_generation_archive_mvp.sql
git commit -m "feat(core): archive generated docs and epics"
```

## Self-Review

- Spec coverage: The plan covers build_docs, sync, build_business_docs, and build_epics. It preserves time fields through `generatedAt` and `createdAt`, source linkage through archive source tables, and side-effect safety through best-effort writes.
- Existing behavior isolation: The plan keeps `document_versions` unchanged and requires a final grep proving archive tables are not read by existing CLI/search/generation/materializer paths.
- Placeholder scan: The plan contains no open implementation placeholders. Schema snippets use numeric `versionNo` consistently for document and epic archive versions.
- Type consistency: Document archive stages are `build_docs | sync | build_business_docs`; epic archive uses a separate helper and does not overload document stages.
- Risk: The largest risk is source evidence shape drift. The plan keeps evidence extraction defensive and nullable so archive source writes do not block latest saves.
