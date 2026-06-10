# Business Document UCS Link Repair Design

## Goal

Fix the generated business document graph so retrieval can traverse from an EPIC to its UCS documents and from each UCL item to the matching UCS detail document.

This is a focused follow-up to `docs/superpowers/specs/2026-06-10-business-doc-graph-traversal-design.md`. The broader graph primitives already exist. The current issue is that real generated data contains UCS documents, but the retrieval graph does not expose them from the EPIC or UCL paths.

## Observed Failure

Real project used for validation:

- Project: `heroines_back_dd_smoke`
- Project id: `4ke9ejpeK1FximMuiiFLB`
- EPIC: `Campaign Exclusion Management`
- EPIC id: `1bp3xui3ji7-BWv1cEcFh`

Observed CLI behavior:

- `epics show --include-docs` returns `documents.ucs: []`.
- `docs related <UCL document>` returns UCL item links to API specs, not to UCS documents.
- `docs list --type ucs --track business` shows that UCS documents do exist for the EPIC.

Example generated UCS scope id:

```text
epic:1bp3xui3ji7-BWv1cEcFh:use_case:ucl:cluster:store-campaign-authoring
```

Example matching UCL item:

```text
stableKey: ucl:cluster:store-campaign-authoring
title: Create a campaign exclusion group
```

The matching data is present. The graph materialization is incomplete or not rerun after UCS documents are saved.

## Desired Traversal

The retrieval graph must support:

```text
EPIC -> UCL
EPIC -> UCS
UCL item -> UCS
UCS -> source technical docs
source technical docs -> code node
DD -> model/table/field evidence
```

For the tested EPIC, the expected result is:

```text
Campaign Exclusion Management
-> UCL: Campaign Exclusion Management use cases
-> UCS:
   - Create a campaign exclusion group
   - List and inspect campaign exclusion groups
   - Update an existing campaign exclusion group
   - Search, add, and remove campaigns in an exclusion group
```

## Design Decisions

### No New Schema

Do not add tables for this fix.

Use existing graph tables:

- `epic_document_links` for `EPIC -> UCS`.
- `document_item_document_links` for `UCL item -> UCS`.

### Materializer Owns The Derived Links

The business graph materializer owns these links:

- `document_item_document_links.linkType = 'expands_use_case'`
- `epic_document_links.documentType = 'ucs'` when `createdBy` or equivalent metadata identifies the materializer, if available in schema

The materializer must delete and recreate only the links it owns. It must not delete source links to API specs or LLM-authored links from other stages.

### UCS Matching Rules

Matching should be deterministic and conservative.

For each active/fresh UCL item:

1. Extract candidate use-case keys:
   - `document_items.stableKey`
   - `content.use_case_id`
   - `content.useCaseId`
   - `content.title`
   - `title`

2. Extract candidate UCS keys:
   - `documents.scopeId`
   - suffix after `:use_case:` in `documents.scopeId`
   - `content.use_case_id`
   - `content.useCaseId`
   - `content.title`
   - document title

3. Match in priority order:
   - exact normalized key match
   - exact match against parsed `scopeId` use-case suffix
   - exact normalized title match
   - one-way containment only when the contained key is a stable key, not a free-form title

Do not fuzzy-match arbitrary prose summaries. That would create incorrect links.

### EPIC To UCS Links

For each active/fresh UCS document:

1. Parse EPIC id from `documents.scopeId` when it starts with:

```text
epic:<epic-id>:use_case:<use-case-key>
```

2. Create or preserve an `epic_document_links` row:

```text
epicId: parsed epic id
documentId: UCS document id
documentType: ucs
role: supporting
reason: UCS belongs to EPIC use-case scope
confidence: high
```

3. If parsing fails, do not infer from title. Leave the document unlinked and report it in rebuild output as `unmatchedUcsDocuments`.

### When To Run

Run the materializer in two places:

1. After a UCS document is saved successfully.
2. At the end of a successful business docs run for the project or EPIC.

Also expose or reuse the existing rebuild path so old projects can backfill links without regenerating all documents.

## CLI Behavior

After the fix:

```bash
node packages/cli/dist/main.js epics show \
  --project 4ke9ejpeK1FximMuiiFLB \
  --epic 1bp3xui3ji7-BWv1cEcFh \
  --include-docs \
  --json
```

Must include UCS documents under:

```text
data.documents.ucs
```

And:

```bash
node packages/cli/dist/main.js docs related \
  --project 4ke9ejpeK1FximMuiiFLB \
  --document <ucl-document-id> \
  --json
```

Must include item links:

```text
itemDocumentLinks[].linkType = expands_use_case
itemDocumentLinks[].target.type = ucs
```

## Tests

Add or update core tests:

- `materializeBusinessDocumentGraph` creates `UCL item -> UCS` links when the UCL item stable key matches the UCS scope suffix.
- `materializeBusinessDocumentGraph` creates `EPIC -> UCS` links from UCS scope ids.
- The materializer is idempotent.
- The materializer preserves existing UCL item links to API specs.
- Unparseable UCS scope ids are reported and not guessed.

Add or update CLI tests:

- `epics show --include-docs` includes UCS documents linked by `epic_document_links`.
- `docs related <UCL>` includes `expands_use_case` item links to UCS documents.
- Stale/orphaned UCS documents are excluded by default.

## Validation

After implementation, validate with the real project:

```bash
node packages/cli/dist/main.js epics show \
  --project 4ke9ejpeK1FximMuiiFLB \
  --epic 1bp3xui3ji7-BWv1cEcFh \
  --include-docs \
  --json
```

Expected:

- `documents.ucs.length >= 4`
- all returned UCS documents have `freshness.isStale === false`

Then validate UCL traversal:

```bash
node packages/cli/dist/main.js docs related \
  --project 4ke9ejpeK1FximMuiiFLB \
  --document doc:yT1gSCz0WYyivBwLd7EuW \
  --json
```

Expected:

- at least four `itemDocumentLinks` with `linkType = expands_use_case`
- each target has `type = ucs`

## Non-Goals

- Do not build semantic search.
- Do not change the glossary, BR, DD, or design document schemas.
- Do not regenerate business documents just to repair links.
- Do not infer EPIC ownership from document titles when `scopeId` is missing or malformed.
