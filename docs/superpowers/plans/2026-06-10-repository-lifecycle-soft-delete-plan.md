# Repository Lifecycle Soft Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project repository add, remove, and re-add semantics correct across static analysis, technical docs, epics, business docs, and merkle/doc-sync flows.

**Architecture:** `repository_service` is the single lifecycle boundary for repo inventory changes. Static/project generation modules must consume only active repositories (`repositories.deleted_at IS NULL`) and document invalidation must use the existing document lifecycle fields: `validity = 'stale'` for regeneration required, `status = 'deleted'` plus `validity = 'orphaned'` for targets removed from the latest merkle snapshot.

**Tech Stack:** TypeScript, Drizzle ORM, SQLite, Vitest, existing Platty core/CLI service modules.

---

## Current State To Preserve

- The workspace is currently on `main`; do not delete or revert existing changes without explicit user approval.
- `documents` has no `deleted_at` column. Document soft delete is represented as `status = 'deleted'` and `validity = 'orphaned'`.
- `validity = 'stale'` means an existing document is still present but must be regenerated or reviewed.
- Merkle/doc-sync already marks removed technical targets as orphaned during incremental planning/application, but only after a new static merkle snapshot and doc sync plan exist.
- Repository delete should be immediate soft delete on `repositories.deleted_at`; hard delete is out of scope.

## Lifecycle Matrix

| Scenario | Required behavior |
|---|---|
| Project created, no repos | No static/docs/business outputs exist; repo list empty. |
| Add first repo before static analysis | Active repo appears in list and static pipeline can analyze it. No stale docs required if no docs exist. |
| Delete repo before static analysis | Repo is soft-deleted and excluded from list/static pipeline. No docs exist. |
| Re-add same repo after delete | Existing repo row is reactivated; no duplicate row for same project/path. |
| Add repo after static analysis | Project static aggregate phases become pending/stale; docs/business docs become stale. |
| Delete repo after static analysis but before docs | Repo excluded from future static/doc planning; project aggregate phases become pending. |
| Delete repo after technical docs | Existing technical docs become stale immediately; next merkle/doc-sync can classify removed targets as orphaned/deleted. |
| Delete repo after business docs | Existing business docs become stale immediately; business sync can later decide orphaned business targets from source impact. |
| Delete repo during active generation run | Policy decision needed: cancel active tasks vs let current run finish but block next planning. |

## Task 1: Freeze And Branch Safely

**Files:**
- No source changes.

- [ ] **Step 1: Capture current branch and diff**

Run:

```bash
git branch --show-current
git status --short
git diff -- packages/core/src/repository_service.ts packages/core/tests/repository_service.test.ts
```

Expected: branch is identified before further changes; unrelated dirty files are visible and not touched.

- [ ] **Step 2: Ask whether to create a branch**

Ask:

```text
현재 main에 변경이 있습니다. 이 상태에서 새 branch를 만들어 이어갈까요, 아니면 main에서 계획/검증만 계속할까요?
```

Expected: no branch operation until user answers.

## Task 2: Pin Repository Service Lifecycle Tests

**Files:**
- Test: `packages/core/tests/repository_service.test.ts`
- Modify: `packages/core/src/repository_service.ts`

- [ ] **Step 1: Write failing tests for inventory changes**

Add/keep tests asserting that `addRepository` and `removeRepository`:

```ts
expect(phasesAfterAdd.map((phase) => `${phase.phase}:${phase.status}`).sort()).toEqual([
  'build_business_docs:pending',
  'build_docs:pending',
  'build_epics:pending',
  'build_service_map:pending',
])
expect(docsAfterAdd.map((doc) => `${doc.id}:${doc.validity}`).sort()).toEqual([
  'doc:api:stale',
  'doc:business:stale',
])
```

- [ ] **Step 2: Run red/green check**

Run:

```bash
cd packages/core
npx vitest run tests/repository_service.test.ts
```

Expected after implementation: all repository service tests pass.

- [ ] **Step 3: Ensure implementation remains centralized**

`packages/core/src/repository_service.ts` should contain the only repo inventory invalidation helper. It must:

```ts
db.update(projectPhaseStatus).set({ status: 'pending', ... })
db.update(documents).set({ validity: 'stale', ... })
```

Expected: no CLI-specific stale logic.

## Task 3: Pin Active Repository Filtering

**Files:**
- Modify/test relevant consumers:
  - `packages/core/src/pipeline_modules/build_docs/runtime/runtime.ts`
  - `packages/core/src/pipeline_modules/sync/static_map.ts`
  - `packages/core/src/pipeline_modules/build_business_docs_cli/start.ts`
  - `packages/core/src/pipeline_modules/build_business_docs_cli/sot/materialize_business_graph.ts`
  - `packages/core/src/pipeline_modules/build_business_docs/sync/source_hashes.ts`
  - `packages/core/src/pipeline_modules/build_epics/runtime/runtime.ts`
  - `packages/core/src/pipeline_modules/build_epics/sync/runtime.ts`
  - direct static stage entrypoints

- [ ] **Step 1: Search for project repo queries**

Run:

```bash
rg -n "repositories\\.projectId|from\\(repositories\\)" packages/core/src packages/cli/src -S
```

Expected: every project-level repo inventory query either uses `listRepositories` or filters `isNull(repositories.deletedAt)`.

- [ ] **Step 2: Run focused tests**

Run:

```bash
cd packages/core
npx vitest run tests/static_pipeline.test.ts tests/pipeline_modules/build_docs/runtime/runtime.test.ts tests/pipeline_modules/build_route/review_decisions.test.ts
```

Expected: all tests pass.

## Task 4: Decide Technical Document Delete Semantics

**Files:**
- Test: `packages/core/tests/pipeline_modules/sync/doc_sync.test.ts` or nearest existing doc sync test file
- Potentially modify: `packages/core/src/pipeline_modules/sync/doc_sync.ts`
- Potentially modify: `packages/core/src/pipeline_modules/build_docs/runtime/runtime.ts`

- [ ] **Step 1: Write test for repo deletion after docs and new merkle snapshot**

Test setup:

```ts
// Old snapshot includes a technical target for repo:api.
// New snapshot excludes repo:api because it is soft-deleted.
// Existing document has documentSourceHash equal to the old target hash.
```

Expected:

```ts
expect(candidate.kind).toBe('orphan_document')
expect(document.status).toBe('deleted')
expect(document.validity).toBe('orphaned')
```

- [ ] **Step 2: Clarify immediate vs doc-sync delete**

Decision:

```text
Immediate repo delete marks all documents stale.
Doc-sync after new merkle snapshot marks removed technical targets deleted/orphaned.
```

Expected: no immediate `status = 'deleted'` unless the target is proven absent from the new snapshot.

## Task 5: Decide Business Document Delete Semantics

**Files:**
- Test: `packages/core/tests/pipeline_modules/build_business_docs/sync/impact.test.ts` or nearest existing business sync test file
- Potentially modify:
  - `packages/core/src/pipeline_modules/build_business_docs/sync/impact.ts`
  - `packages/core/src/pipeline_modules/build_business_docs/sync/start.ts`

- [ ] **Step 1: Write test for business doc stale on repo inventory change**

Expected:

```ts
expect(businessDoc.validity).toBe('stale')
expect(businessDoc.status).toBe('active')
```

- [ ] **Step 2: Write test for business doc orphaning only after business sync impact**

Expected:

```ts
expect(preview.orphanedTargets).toContainEqual(expect.objectContaining({
  documentId: 'doc:business',
  state: 'orphaned',
}))
```

Expected policy: business docs are not immediately deleted on repo delete; they become stale first because EPIC/source ownership may need review.

## Task 6: Active Run Policy

**Files:**
- Test: generation run lifecycle tests
- Potentially modify shared generation run adapter

- [ ] **Step 1: Choose policy**

Options:

```text
Option A: On repo delete, cancel active generation tasks for that repo and mark run failed/cancelled.
Option B: Leave active run untouched, but next planning excludes deleted repo and stale marks force regeneration.
```

Recommended: Option B for minimal blast radius unless UI requires immediate cancellation.

- [ ] **Step 2: Add policy test after decision**

Expected: chosen behavior is explicit and covered.

## Task 7: Final Verification

**Files:**
- No source changes.

- [ ] **Step 1: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit code 0.

- [ ] **Step 2: Focused core tests**

Run:

```bash
cd packages/core
npx vitest run tests/repository_service.test.ts tests/static_pipeline.test.ts tests/pipeline_modules/build_docs/runtime/runtime.test.ts tests/pipeline_modules/build_route/review_decisions.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Focused CLI tests**

Run:

```bash
cd packages/cli
npx vitest run tests/repo-commands.test.ts
```

Expected: all tests pass.

## Self-Review

- Spec coverage: repo add/delete/re-add, no-doc/docs-exist, pre/post-static, technical/business docs, merkle/doc-sync, active run policy are represented.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: uses existing `documents.status`, `documents.validity`, `repositories.deletedAt`, and `projectPhaseStatus.status` fields.

