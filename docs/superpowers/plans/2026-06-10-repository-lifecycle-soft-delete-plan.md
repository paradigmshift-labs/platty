# Repository Lifecycle Soft Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement precise repository add/delete propagation across static analysis, technical build_docs, EPIC assignment, and business docs sync.

**Architecture:** `repository_service` remains the single boundary for repository inventory mutations. Repo add only invalidates static/project aggregate readiness; business docs are not stale until build_epics assigns new/changed technical docs to EPICs. Repo delete immediately soft-deletes technical documents owned by the deleted repo and marks only connected business documents stale so the user is told to run sync/regeneration.

**Tech Stack:** TypeScript, Drizzle ORM, SQLite, Vitest, existing Platty core/CLI services.

---

## Current Behavior To Correct

- Current branch is `main`; do not revert or delete existing code unless explicitly approved.
- Current patched `repository_service` marks all project documents `validity = 'stale'` on repo add/delete.
- Current patched `repository_service` does not immediately set deleted repo technical documents to `status = 'deleted'`.
- Existing business doc source hash includes lower technical document `status`, `contentHash`, `documentSourceHash`, and `staticSnapshotId`, but not lower document `validity`.
- Therefore `validity = 'stale'` alone may not change business doc source hashes; `status = 'deleted'` removes a technical source document from business hash inputs.

## Target Policy

| Event | Technical build_docs | Business docs |
|---|---|---|
| repo add | Do not stale existing docs immediately. New repo becomes static/docs candidate after analysis. | Do not stale immediately. Wait until build_epics assigns new docs to existing/new EPICs. |
| repo delete | Technical docs owned by deleted repo become `status = 'deleted'`, `validity = 'orphaned'`. | Only business docs connected to those technical docs become `validity = 'stale'`; status remains active. |
| repo re-add | Existing repo row is reactivated. Static/docs are recalculated from current snapshot. | No direct business stale until build_epics assignment/sync proves impact. |

## Ownership And Link Rules

Technical docs affected by repo delete are documents where:

```ts
documents.track === 'technical'
documents.type in ['api_spec', 'screen_spec', 'event_spec', 'schedule_spec']
documents.scope/scopeId maps to deleted repo generation targets
```

Preferred ownership lookup:

1. Use `generation_tasks.savedDocumentId` or `generation_tasks.repositoryId` if a saved task exists.
2. Use `docRelationLinks.repoId` for relation-backed technical docs.
3. Use `documentLinkEvidence.repoId` where present.
4. Avoid deleting project-wide/system docs without a repo ownership signal.

Business docs connected to deleted technical docs are any active business documents reachable through:

```text
epic_document_links -> affected technical document -> same epic -> business docs with scope='epic' and scopeId=epic.id
document_item_document_links.to_document_id = affected technical document id
document_links to/from affected technical document id
document_link_evidence from/to affected technical document id
```

The implementation can start with EPIC-scope links and direct document item links, then add tests for other link tables before expanding.

## Task 1: Freeze Current State

**Files:**
- No source changes.

- [ ] **Step 1: Confirm branch and dirty state**

Run:

```bash
git branch --show-current
git status --short
```

Expected: branch is visible. If branch is `main`, ask before further production code edits.

- [ ] **Step 2: Confirm no implementation happens before RED tests**

Run:

```bash
git diff -- packages/core/src/repository_service.ts packages/core/tests/repository_service.test.ts
```

Expected: current lifecycle changes are visible; do not edit production code until the tests below are added and observed failing.

## Task 2: TDD Repo Add Does Not Stale Business Docs

**Files:**
- Test: `packages/core/tests/repository_service.test.ts`
- Modify later: `packages/core/src/repository_service.ts`

- [ ] **Step 1: Write failing test**

Add a test named:

```ts
it('does not stale business docs when a repository is added before epic assignment', () => {
  const client = createTestPlattyDb()
  const project = createProject(client.db, { name: 'My App' })
  const repoPath = gitRepo()
  addRepository(client.db, { projectId: project.id, path: repoPath, name: 'api', cwd: repoPath })

  client.db.insert(documents).values({
    id: 'doc:business',
    projectId: project.id,
    type: 'ucl',
    track: 'business',
    scope: 'epic',
    scopeId: 'epic:orders',
    status: 'active',
    validity: 'fresh',
    content: { summary: 'Order business use cases' },
    rawLlmOutput: '',
  }).run()

  const webPath = gitRepo()
  addRepository(client.db, { projectId: project.id, path: webPath, name: 'web', cwd: webPath })

  const businessDoc = client.db.select().from(documents).where(eq(documents.id, 'doc:business')).get()
  expect(businessDoc?.status).toBe('active')
  expect(businessDoc?.validity).toBe('fresh')
  client.close()
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cd packages/core
npx vitest run tests/repository_service.test.ts -t "does not stale business docs when a repository is added before epic assignment"
```

Expected now: FAIL because current `repository_service` stales all documents on repo add.

- [ ] **Step 3: Implement minimal GREEN**

Change repo add invalidation so it does not update `documents` directly. It may still mark project static aggregate phases pending:

```ts
invalidateProjectRepositoryInventoryDependents(db, {
  projectId: input.projectId,
  repositoryId: id,
  reason: 'repository_added',
  invalidatedAt: now,
  staleDocuments: false,
})
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cd packages/core
npx vitest run tests/repository_service.test.ts -t "does not stale business docs when a repository is added before epic assignment"
```

Expected: PASS.

## Task 3: TDD Repo Delete Soft-Deletes Deleted Repo Technical Docs

**Files:**
- Test: `packages/core/tests/repository_service.test.ts`
- Modify later: `packages/core/src/repository_service.ts`

- [ ] **Step 1: Write failing test**

Add a test named:

```ts
it('soft-deletes technical documents owned by a removed repository', () => {
  const client = createTestPlattyDb()
  const project = createProject(client.db, { name: 'My App' })
  const repoPath = gitRepo()
  const repo = addRepository(client.db, { projectId: project.id, path: repoPath, name: 'api', cwd: repoPath })

  client.db.insert(documents).values({
    id: 'doc:api',
    projectId: project.id,
    type: 'api_spec',
    track: 'technical',
    scope: 'route',
    scopeId: 'GET /orders',
    status: 'passed',
    validity: 'fresh',
    content: { summary: 'Order API' },
    rawLlmOutput: '',
  }).run()
  client.db.insert(generationTasks).values({
    id: 'task:api',
    runId: 'run:docs',
    projectId: project.id,
    repositoryId: repo.id,
    documentType: 'api_spec',
    targetDocumentId: 'GET /orders',
    targetKey: 'api:GET /orders',
    targetJson: {},
    status: 'completed',
    savedDocumentId: 'doc:api',
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
  }).run()

  const removed = removeRepository(client.db, project.id, repo.id, repoPath)
  expect(removed.kind).toBe('found')

  const technicalDoc = client.db.select().from(documents).where(eq(documents.id, 'doc:api')).get()
  expect(technicalDoc?.status).toBe('deleted')
  expect(technicalDoc?.validity).toBe('orphaned')
  client.close()
})
```

If `generationTasks` requires an existing `generationRuns` row in tests, insert a minimal run before inserting the task:

```ts
client.db.insert(generationRuns).values({
  id: 'run:docs',
  projectId: project.id,
  stage: 'build_docs',
  status: 'completed',
  outputLanguage: 'ko',
  requestedBy: 'test',
  sourceCommit: 'commit:test',
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
}).run()
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cd packages/core
npx vitest run tests/repository_service.test.ts -t "soft-deletes technical documents owned by a removed repository"
```

Expected now: FAIL because current repo delete only stales documents.

- [ ] **Step 3: Implement minimal GREEN**

Add a helper in `repository_service.ts`:

```ts
function softDeleteTechnicalDocumentsForRepository(db: DB, input: {
  projectId: string
  repositoryId: string
  deletedAt: string
}): string[] {
  const rows = db.select({ documentId: generationTasks.savedDocumentId })
    .from(generationTasks)
    .where(and(
      eq(generationTasks.projectId, input.projectId),
      eq(generationTasks.repositoryId, input.repositoryId),
      isNotNull(generationTasks.savedDocumentId),
    ))
    .all()
  const documentIds = [...new Set(rows.map((row) => row.documentId).filter((id): id is string => typeof id === 'string'))]
  if (documentIds.length === 0) return []
  db.update(documents)
    .set({
      status: 'deleted',
      validity: 'orphaned',
      updatedBy: 'system',
      updatedAt: input.deletedAt,
    })
    .where(and(
      eq(documents.projectId, input.projectId),
      eq(documents.track, 'technical'),
      inArray(documents.id, documentIds),
    ))
    .run()
  return documentIds
}
```

Call it inside `removeRepository` after setting `repositories.deletedAt`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cd packages/core
npx vitest run tests/repository_service.test.ts -t "soft-deletes technical documents owned by a removed repository"
```

Expected: PASS.

## Task 4: TDD Repo Delete Stales Connected Business Docs

**Files:**
- Test: `packages/core/tests/repository_service.test.ts`
- Modify later: `packages/core/src/repository_service.ts`

- [ ] **Step 1: Write failing EPIC-link test**

Add a test named:

```ts
it('marks business documents stale when their linked technical documents are deleted by repository removal', () => {
  const client = createTestPlattyDb()
  const project = createProject(client.db, { name: 'My App' })
  const repoPath = gitRepo()
  const repo = addRepository(client.db, { projectId: project.id, path: repoPath, name: 'api', cwd: repoPath })

  client.db.insert(epics).values({
    id: 'epic:orders',
    projectId: project.id,
    name: 'Orders',
    confirmedAt: '2026-06-10T00:00:00.000Z',
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
  }).run()
  client.db.insert(documents).values([
    {
      id: 'doc:api',
      projectId: project.id,
      type: 'api_spec',
      track: 'technical',
      scope: 'route',
      scopeId: 'GET /orders',
      status: 'passed',
      validity: 'fresh',
      content: { summary: 'Order API' },
      rawLlmOutput: '',
    },
    {
      id: 'doc:business',
      projectId: project.id,
      type: 'ucl',
      track: 'business',
      scope: 'epic',
      scopeId: 'epic:orders',
      status: 'active',
      validity: 'fresh',
      content: { summary: 'Order use cases' },
      rawLlmOutput: '',
    },
  ]).run()
  client.db.insert(epicDocumentLinks).values({
    epicId: 'epic:orders',
    documentId: 'doc:api',
    documentType: 'api_spec',
    role: 'owner',
    reason: 'test',
    confidence: 'high',
    createdAt: '2026-06-10T00:00:00.000Z',
  }).run()
  seedGenerationTaskForDocument(client.db, {
    projectId: project.id,
    repositoryId: repo.id,
    documentId: 'doc:api',
  })

  removeRepository(client.db, project.id, repo.id, repoPath)

  const businessDoc = client.db.select().from(documents).where(eq(documents.id, 'doc:business')).get()
  expect(businessDoc?.status).toBe('active')
  expect(businessDoc?.validity).toBe('stale')
  client.close()
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cd packages/core
npx vitest run tests/repository_service.test.ts -t "marks business documents stale when their linked technical documents are deleted by repository removal"
```

Expected now: FAIL until connected-business stale propagation is implemented.

- [ ] **Step 3: Implement minimal GREEN**

Add helper:

```ts
function staleBusinessDocumentsLinkedToTechnicalDocuments(db: DB, input: {
  projectId: string
  technicalDocumentIds: string[]
  updatedAt: string
}): string[] {
  if (input.technicalDocumentIds.length === 0) return []
  const epicIds = db.select({ epicId: epicDocumentLinks.epicId })
    .from(epicDocumentLinks)
    .where(inArray(epicDocumentLinks.documentId, input.technicalDocumentIds))
    .all()
    .map((row) => row.epicId)
  const uniqueEpicIds = [...new Set(epicIds)]
  if (uniqueEpicIds.length === 0) return []
  const businessDocs = db.select({ id: documents.id })
    .from(documents)
    .where(and(
      eq(documents.projectId, input.projectId),
      eq(documents.track, 'business'),
      eq(documents.status, 'active'),
      inArray(documents.scopeId, uniqueEpicIds),
    ))
    .all()
  const businessDocumentIds = businessDocs.map((row) => row.id)
  if (businessDocumentIds.length === 0) return []
  db.update(documents)
    .set({ validity: 'stale', updatedBy: 'system', updatedAt: input.updatedAt })
    .where(inArray(documents.id, businessDocumentIds))
    .run()
  return businessDocumentIds
}
```

Call it after `softDeleteTechnicalDocumentsForRepository`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cd packages/core
npx vitest run tests/repository_service.test.ts -t "marks business documents stale when their linked technical documents are deleted by repository removal"
```

Expected: PASS.

## Task 5: TDD Business Hash Reflects Deleted Technical Status

**Files:**
- Test: existing or new `packages/core/tests/pipeline_modules/build_business_docs/sync/source_hashes.test.ts`
- Source likely unchanged: `packages/core/src/pipeline_modules/build_business_docs/sync/source_hashes.ts`

- [ ] **Step 1: Write proof test**

Create a test where:

```ts
const before = computeBusinessDocSourceHashes(db, { projectId }).targets.find((target) => target.documentType === 'ucl')
db.update(documents).set({ status: 'deleted', validity: 'orphaned' }).where(eq(documents.id, 'doc:api')).run()
const after = computeBusinessDocSourceHashes(db, { projectId }).targets.find((target) => target.documentType === 'ucl')
expect(after?.sourceHash).not.toBe(before?.sourceHash)
```

- [ ] **Step 2: Run test**

Run:

```bash
cd packages/core
npx vitest run tests/pipeline_modules/build_business_docs/sync/source_hashes.test.ts
```

Expected: PASS if current hash behavior is already sufficient.

## Task 6: Final Verification

**Files:**
- No source changes.

- [ ] **Step 1: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit code 0.

- [ ] **Step 2: Focused tests**

Run:

```bash
cd packages/core
npx vitest run tests/repository_service.test.ts tests/pipeline_modules/build_business_docs/sync/source_hashes.test.ts tests/pipeline_modules/build_docs/runtime/runtime.test.ts tests/static_pipeline.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: CLI repo flow**

Run:

```bash
cd packages/cli
npx vitest run tests/repo-commands.test.ts
```

Expected: all tests pass.

## Self-Review

- Spec coverage: repo add no business stale, repo delete technical orphan, connected business stale, hash proof, verification.
- Placeholder scan: no TODO/TBD placeholders.
- Type consistency: uses existing `documents.status`, `documents.validity`, `repositories.deletedAt`, `generationTasks.savedDocumentId`, `epicDocumentLinks`, and `projectPhaseStatus`.

