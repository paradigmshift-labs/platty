# Business Document Graph Traversal Design

## Goal

Make generated technical and business documents navigable as a deterministic graph for CLI-based retrieval. A user or agent should be able to pick an epic, document, or item candidate and then traverse directly to related documents, items, source technical specs, and model/table evidence without repeatedly scanning global lists.

This design incorporates the Claude Fable headless review captured in `.omx/artifacts/ask-claude-business-doc-graph-review-20260610-114248.md`.

## Current State

The current schema already has the right base graph primitives:

- `documents`
- `document_links`: document to document links
- `document_items`
- `document_item_document_links`: item to document links
- `document_item_item_links`: item to item links
- `document_item_relation_links`: item to code relation links
- `epic_document_links`: epic to technical document links
- `models`: model/table/field metadata

Generated business documents currently persist many business-to-technical source links, but business-to-business links are effectively absent. DD/data_dictionary documents receive model evidence in context, but DD items do not persist direct links to `models`, tables, or fields.

## Decisions

### Reuse Existing Link Tables

Do not add broad new document graph tables. Use:

- `document_links` for document to document traversal.
- `document_item_document_links` for item to document traversal.
- `document_item_item_links` for item to item traversal.

This keeps the graph compatible with existing cleanup, review, and CLI patterns.

### Add One Model Link Table

Add one focused table for DD item to model/table/field traversal:

`document_item_model_links`

Columns:

- `project_id`
- `item_id`
- `model_id`
- `field_name` nullable
- `link_type`: `describes_model`, `describes_field`, `uses_model`
- `role`: `primary`, `supporting`
- `evidence_json` nullable
- `created_by`
- `created_at`

Indexes and constraints:

- FK `item_id -> document_items.id` cascade.
- FK `model_id -> models.id` cascade.
- unique `(item_id, model_id, field_name, link_type)`.
- index on `project_id`.
- index on `model_id`.

`document_item_relation_links` is not a clean substitute because it points at `code_relations`, not `models`, and cannot represent field-level links with a model FK.

### Link Ownership

Each writer must delete only the links it owns.

Existing `replaceDocumentLinks` and `replaceDocumentItemSatellites` delete too broadly. That must be fixed before adding materialized business graph links.

Rules:

- `persist_graph` may replace `derives_from` links it owns.
- submit-time source linking may replace `source_document` links it owns.
- the business graph materializer may replace links created by `business_graph_materializer_v1`.
- no writer may delete all outgoing links for a document or item without filtering by owned type or owner.

### Link Direction

Use two explicit direction rules:

1. Evidence/dependency links:

   `from = the derived/using/dependent entity`

   `to = the source/definition/governing entity`

2. Navigation expansion links:

   `from = the list/candidate item`

   `to = the detail document`

This second rule is intentional for retrieval. A UCL item should point directly to the UCS document so an agent can continue reading without re-listing or searching.

Examples:

- UCL item -> UCS document with `expands_use_case`.
- UCS item -> BR document/item with `governed_by_rule`.
- BR item -> DD document/item with `uses_data_entity`.
- design item/document -> UCS/BR/DD with `designed_by`.
- business document/item -> technical document with existing `derives_from` or `source_document`.
- DD item -> model/field with `describes_model` or `describes_field`.

Avoid redundant graph edges:

- Do not create `contains`; `document_items.documentId` already represents containment.
- Do not create `implemented_by` or `references_source`; reuse `derives_from` and `source_document`.
- Do not create `defines_terms_for` initially; glossary can be reached by scope/type and by reverse traversal if a later explicit edge proves necessary.

### Materialization Boundary

Use two materialization paths:

1. Submit-time DD model links:
   - DD item to model/field links can be materialized while a DD document is submitted because model evidence is already available in the task context.

2. Run-complete or explicit rebuild business graph:
   - Cross-document links such as UCL item -> UCS document require all related business documents to exist.
   - Add an idempotent graph rebuild entry point that can be called after a business docs run completes and by a CLI backfill command.

The graph materializer belongs under `build_business_docs_cli/sot`, but not inside `source_graph.ts`. `source_graph.ts` remains read-only context projection.

## Required Changes

### Core Schema

Modify `packages/core/src/db/schema/build_docs.ts`:

- Add `documentItemModelLinks`.
- Export `DocumentItemModelLink` and `NewDocumentItemModelLink`.

Add migration:

- `packages/core/src/db/migrations/0036_document_item_model_links.sql`

Update migration metadata if required by the local migration setup.

### Core Business Docs

Modify `packages/core/src/pipeline_modules/build_business_docs_cli/sot/persist_graph.ts`:

- Narrow document link deletion to `linkType = 'derives_from'`.
- Narrow item document link deletion to the link types owned by this function.
- Preserve externally materialized links across resubmit.

Add:

- `packages/core/src/pipeline_modules/build_business_docs_cli/sot/materialize_business_graph.ts`

Responsibilities:

- Build deterministic business-to-business document/item links within a project or epic scope.
- Rebuild only links owned by `business_graph_materializer_v1`.
- Be idempotent.
- Populate UCL item -> UCS document links where stable keys/titles match.
- Populate UCS/BR/DD/design relationships conservatively using scope and shared source document overlap.
- Populate DD item -> model/field links for backfill.

Modify `packages/core/src/pipeline_modules/build_business_docs_cli/submit.ts`:

- Materialize DD item -> model links when DD documents are submitted, or call a helper that can be reused by the rebuild command.

Modify `packages/core/src/pipeline_modules/build_business_docs_cli/review.ts`:

- Include related document links, item target document links, related items, and model links in document show/review output.

### Sync And Reconcile

Modify `packages/core/src/pipeline_modules/build_business_docs/sync/graph_reconcile.ts`:

- Clean outbound and inbound links for orphaned business documents.
- Clean new model links for stale/orphaned items.
- Add invariants for active links to orphaned business docs.
- Add invariant for DD model field links whose field no longer exists in `models.fields`.

No required change to:

- `packages/core/src/pipeline_modules/sync/doc_sync.ts`
- `packages/core/src/pipeline_modules/build_business_docs/sync/source_hashes.ts`

`source_hashes.ts` already includes model evidence inputs. Materialized graph rows are derived output and should not become hash inputs.

### CLI

Modify `packages/cli/src/commands/docs.ts`:

- Add `docs show --project <id> --document <docId> --json`.
- Add `docs related --project <id> --document <docId> --json`.
- Both commands must filter out stale items and orphaned/deleted documents by default.
- Both commands must include freshness metadata.

Modify `packages/cli/src/commands/business-docs.ts`:

- Add or expose `business-docs graph rebuild --project <id> [--epic <id>] --json`.
- Extend document show output if the command surface owns business document detail output.

## Retrieval Flow

Business question:

1. Read project glossary summary/detail for term alignment.
2. List candidate BR/UCL docs by compact metadata.
3. Open the most relevant UCL/BR doc.
4. Traverse from UCL item to UCS, then to BR/DD/design/source docs through graph links.
5. Warn if any returned node is stale or orphaned.

Development question:

1. Use technical targets list/search.
2. Open API/screen spec.
3. Traverse to business docs through incoming `derives_from` or item `source_document` links.
4. Traverse DD items to model/table/field links when data behavior is relevant.

Design question:

1. Align terms with glossary.
2. Open design docs.
3. Traverse to related UCS/BR/DD and source API/screen specs.

## Testing Requirements

Minimum tests before implementation is considered safe:

- `persist_graph` preserves materializer-owned links across resubmit while still replacing owned `derives_from` links.
- Business graph materializer is idempotent.
- DD submit or rebuild creates `document_item_model_links`.
- Reconcile removes inbound and outbound links to orphaned business docs.
- Reconcile detects dangling field links when `field_name` is no longer present in `models.fields`.
- CLI `docs related` excludes stale/orphaned targets by default.
- CLI `docs show` returns freshness and related links.
- Existing core, CLI, architecture, typecheck, and build commands pass.

## Rollout

Implement in four phases:

1. Link deletion safety and schema.
2. DD item model links.
3. Cross-document business graph materializer and rebuild CLI.
4. Traversal CLI output and real project validation with `heroines_web`.
