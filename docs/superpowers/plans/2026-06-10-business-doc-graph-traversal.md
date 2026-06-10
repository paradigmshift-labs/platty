# Business Document Graph Traversal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build deterministic business document graph traversal so CLI users can move from epics/documents/items to related business docs, technical specs, and DD model/table evidence.

**Architecture:** Reuse existing document and item link tables for document graph traversal, add one focused DD item to model link table, and keep graph materialization idempotent and owner-scoped. Cross-document graph links are rebuilt after business docs are generated or through an explicit backfill CLI.

**Tech Stack:** TypeScript, Drizzle ORM, better-sqlite3, Node test runner, existing Platty core and CLI workspaces.

---

## File Map

- `packages/core/src/db/schema/build_docs.ts`: add `documentItemModelLinks`.
- `packages/core/src/db/migrations/0036_document_item_model_links.sql`: add model link table.
- `packages/core/src/pipeline_modules/build_business_docs_cli/sot/persist_graph.ts`: scope deletes to owned link types.
- `packages/core/src/pipeline_modules/build_business_docs_cli/sot/materialize_business_graph.ts`: new idempotent graph materializer.
- `packages/core/src/pipeline_modules/build_business_docs_cli/submit.ts`: submit-time DD model link materialization hook.
- `packages/core/src/pipeline_modules/build_business_docs_cli/review.ts`: include related links/model links in document detail output.
- `packages/core/src/pipeline_modules/build_business_docs/sync/graph_reconcile.ts`: cleanup inbound links and model links; add invariants.
- `packages/cli/src/commands/docs.ts`: add `docs show` and `docs related`.
- `packages/cli/src/commands/business-docs.ts`: add `business-docs graph rebuild`.
- Core tests under `packages/core/tests/pipeline_modules/build_business_docs_cli` and `packages/core/tests/pipeline_modules/build_business_docs/sync`.
- CLI tests under `packages/cli/tests`.

## Task 1: Persist Graph Delete Scoping

**Files:**

- Modify: `packages/core/tests/pipeline_modules/build_business_docs_cli/persist_graph.test.ts`
- Modify: `packages/core/src/pipeline_modules/build_business_docs_cli/sot/persist_graph.ts`

- [ ] **Step 1: Write failing test**

Add a test that inserts an existing `document_links` row with `linkType='lists_use_case'` and `createdBy='business_graph_materializer_v1'`, calls `replaceDocumentLinks`, and asserts the materializer link still exists while `derives_from` links are replaced.

Add a second test that inserts an existing item `document_item_document_links` row with a materializer-owned link type, calls `replaceDocumentItemSatellites`, and asserts the materializer link survives.

- [ ] **Step 2: Run red test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_business_docs_cli/persist_graph.test.ts
```

Expected: both new tests fail because current code deletes all outgoing links.

- [ ] **Step 3: Implement delete scoping**

Change `replaceDocumentLinks` so it deletes only `documentLinks.linkType = 'derives_from'` for the document.

Change `replaceDocumentItemSatellites` so it deletes only the link types it owns, initially `derives_from`, and leaves materializer-owned item links intact.

- [ ] **Step 4: Run green test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_business_docs_cli/persist_graph.test.ts
```

Expected: pass.

## Task 2: Schema And Migration For DD Model Links

**Files:**

- Modify: `packages/core/src/db/schema/build_docs.ts`
- Create: `packages/core/src/db/migrations/0036_document_item_model_links.sql`
- Modify: migration journal metadata if required
- Add/modify: `packages/core/tests/db` or existing migration test location

- [ ] **Step 1: Write failing schema/migration test**

Add a migration/schema test that migrates an in-memory database and verifies `document_item_model_links` exists with expected indexes and cascade FKs.

- [ ] **Step 2: Run red test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/db
```

Expected: fail because the table does not exist.

- [ ] **Step 3: Add schema and migration**

Add `documentItemModelLinks` with:

- `projectId`
- `itemId`
- `modelId`
- `fieldName`
- `linkType`
- `role`
- `evidenceJson`
- `createdBy`
- `createdAt`

Use unique `(item_id, model_id, field_name, link_type)` and indexes on `project_id` and `model_id`.

- [ ] **Step 4: Run green test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/db
```

Expected: pass.

## Task 3: DD Model Link Materializer

**Files:**

- Create: `packages/core/src/pipeline_modules/build_business_docs_cli/sot/materialize_business_graph.ts`
- Modify: `packages/core/src/pipeline_modules/build_business_docs_cli/submit.ts`
- Add: `packages/core/tests/pipeline_modules/build_business_docs_cli/materialize_business_graph.test.ts`

- [ ] **Step 1: Write failing unit test**

Create a test with one DD document item, one `models` row, and DD content/source refs that identify the model and a field. Assert materialization writes `document_item_model_links` with `describes_field`.

- [ ] **Step 2: Run red test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_business_docs_cli/materialize_business_graph.test.ts
```

Expected: fail because the module/function does not exist.

- [ ] **Step 3: Implement minimal DD model linking**

Implement an exported helper such as `materializeDocumentItemModelLinks(db, input)` that:

- deletes only existing `document_item_model_links` for the input item/document scope owned by `business_graph_materializer_v1`;
- matches `model:<modelName>` or table/model names from DD content/source refs to `models.name` or `models.tableName`;
- optionally matches field names against `models.fields`;
- inserts deterministic links.

- [ ] **Step 4: Hook DD submit**

Call the helper after DD document items are persisted in `submit.ts`.

- [ ] **Step 5: Run green test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_business_docs_cli/materialize_business_graph.test.ts
```

Expected: pass.

## Task 4: Cross-Document Business Graph Rebuild

**Files:**

- Modify: `packages/core/src/pipeline_modules/build_business_docs_cli/sot/materialize_business_graph.ts`
- Add tests: `packages/core/tests/pipeline_modules/build_business_docs_cli/materialize_business_graph.test.ts`

- [ ] **Step 1: Write failing idempotency test**

Create a fixture with one epic-scope UCL document, one UCL item, and one matching UCS document. Run rebuild twice and assert one deterministic `document_item_document_links` edge exists.

- [ ] **Step 2: Run red test**

Run the materializer test file. Expected: fail because cross-doc rebuild is not implemented.

- [ ] **Step 3: Implement conservative cross-doc links**

Implement `materializeBusinessDocumentGraph(db, { projectId, epicId? })`:

- gathers active business documents;
- links UCL items to UCS documents using stable keys and normalized titles;
- links UCS/BR/DD/design conservatively by same epic scope and shared source technical document IDs;
- writes only `createdBy='business_graph_materializer_v1'`;
- deletes only materializer-owned links before rebuilding.

- [ ] **Step 4: Run green test**

Run materializer tests. Expected: pass and idempotent.

## Task 5: Reconcile And Invariants

**Files:**

- Modify: `packages/core/src/pipeline_modules/build_business_docs/sync/graph_reconcile.ts`
- Modify: `packages/core/tests/pipeline_modules/build_business_docs/sync/graph_reconcile.test.ts`

- [ ] **Step 1: Write failing cleanup tests**

Add tests proving:

- inbound `document_links` to orphaned business docs are deleted;
- inbound `document_item_document_links` to orphaned business docs are deleted;
- `document_item_model_links` for stale/orphaned items are deleted;
- dangling DD model field links are reported by invariant check.

- [ ] **Step 2: Run red test**

Run:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_business_docs/sync/graph_reconcile.test.ts
```

Expected: fail on the new assertions.

- [ ] **Step 3: Implement reconcile changes**

Extend cleanup and invariant checks for inbound links, model links, orphaned targets, and dangling fields.

- [ ] **Step 4: Run green test**

Run the same test. Expected: pass.

## Task 6: CLI Rebuild Command

**Files:**

- Modify: `packages/cli/src/commands/business-docs.ts`
- Add/modify: `packages/cli/tests/business-docs-command.test.ts`

- [ ] **Step 1: Write failing CLI test**

Add test for:

```bash
platty business-docs graph rebuild --project <id> --json
```

Expected JSON includes `createdLinks`, `deletedLinks`, and optional `epicId`.

- [ ] **Step 2: Run red test**

Run:

```bash
npm test --workspace packages/cli -- packages/cli/tests/business-docs-command.test.ts
```

Expected: fail because command is unknown.

- [ ] **Step 3: Implement command**

Route `business-docs graph rebuild` to the core materializer. Keep output JSON-only when `--json` is set.

- [ ] **Step 4: Run green test**

Run the CLI test. Expected: pass.

## Task 7: Docs Show And Related Commands

**Files:**

- Modify: `packages/cli/src/commands/docs.ts`
- Add/modify: `packages/cli/tests/docs/search-retrieval.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Add tests for:

```bash
platty docs show --project <id> --document <docId> --json
platty docs related --project <id> --document <docId> --json
```

Assert:

- freshness is included;
- stale items are excluded by default;
- orphaned/deleted target documents are excluded by default;
- related document/item/model links are grouped by direction and link type.

- [ ] **Step 2: Run red test**

Run:

```bash
npm test --workspace packages/cli -- packages/cli/tests/docs/search-retrieval.test.ts
```

Expected: fail because commands are missing.

- [ ] **Step 3: Implement commands**

Add read-only query helpers in `docs.ts`. Reuse existing freshness output shapes from `docs list` and `docs search`.

- [ ] **Step 4: Run green test**

Run the CLI test. Expected: pass.

## Task 8: Full Verification

- [ ] Run core targeted tests:

```bash
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_business_docs_cli/persist_graph.test.ts
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_business_docs_cli/materialize_business_graph.test.ts
npm test --workspace packages/core -- packages/core/tests/pipeline_modules/build_business_docs/sync/graph_reconcile.test.ts
```

- [ ] Run CLI targeted tests:

```bash
npm test --workspace packages/cli -- packages/cli/tests/business-docs-command.test.ts
npm test --workspace packages/cli -- packages/cli/tests/docs/search-retrieval.test.ts
```

- [ ] Run workspace verification:

```bash
npm test
npm run typecheck
npm run build
```

- [ ] Validate on `heroines_web`:

```bash
platty business-docs graph rebuild --project OG7F7wq3zW8YB6mnT5m5l --json
platty docs related --project OG7F7wq3zW8YB6mnT5m5l --document <ucl-doc-id> --json
platty docs show --project OG7F7wq3zW8YB6mnT5m5l --document <ucs-or-dd-doc-id> --json
```

Expected: UCL items connect to UCS docs, business docs connect to source technical docs, DD items expose model/table/field links when model evidence exists, and stale/orphaned entries are either filtered or clearly marked.
