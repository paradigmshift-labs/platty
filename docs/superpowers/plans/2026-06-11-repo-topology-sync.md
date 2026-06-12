# Repo Topology Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repository additions sync only newly added and service-map-impacted documents, then run EPIC sync with an always-on split/merge audit that produces reviewable restructure drafts instead of silently absorbing new backend APIs into overly broad frontend-derived EPICs.

**Architecture:** Treat repository inventory changes as project topology changes, not as blanket document invalidations. Static Merkle document hashes will include only service-map edges relevant to each document target, so build_docs sync can identify newly linked frontend/backend documents precisely. build_epics sync will keep its existing assignment and cross-link phases, then add a deterministic restructure audit phase that creates a task only when explicit split/merge thresholds are met.

**Tech Stack:** TypeScript, Drizzle ORM, SQLite/better-sqlite3, Vitest, local Platty CLI via `node packages/cli/dist/main.js <command> --json`.

---

## Purpose

Platty currently handles `repo add` conservatively by marking every fresh project document stale. That avoids missing new frontend-backend service-map links, but it makes beta sync expensive and can cause large downstream EPIC/business-doc churn. The desired beta behavior is narrower: adding a backend repo to a frontend-only project should create new API docs, refresh only existing docs whose service-map relationships changed, and then let EPIC sync decide whether those APIs belong in existing EPICs, new EPICs, or a split/merge restructure draft.

## File Structure

- Modify `packages/core/src/repository_service.ts`: stop blanket document stale updates on repository inventory changes; preserve phase invalidation metadata.
- Modify `packages/core/src/pipeline_modules/sync/static_map.ts`: include relevant service-map edge hashes in per-document technical source hashes.
- Modify `packages/core/src/pipeline_modules/build_epics/sync/runtime.ts`: insert restructure audit phase after assignment and before cross-link completion.
- Create `packages/core/src/pipeline_modules/build_epics/sync/restructure_audit.ts`: deterministic split/merge trigger analysis and task target generation.
- Create `packages/core/src/pipeline_modules/build_epics/sync/restructure_patch.ts`: apply reviewable split/merge/move proposals to the draft plan.
- Modify `packages/core/src/pipeline_modules/build_epics/sync/worker_runner.ts`: add `epic_sync_restructure` prompt/schema/work-packet support.
- Modify `packages/core/src/pipeline_modules/build_epics/sync/index.ts`: export new audit/patch utilities.
- Test `packages/core/tests/repository_service.test.ts`: repo add no longer marks every document stale.
- Test `packages/core/tests/pipeline_modules/sync/static_map.test.ts`: relevant service-map edges affect only matching document hashes.
- Test `packages/core/tests/pipeline_modules/sync/doc_sync.test.ts`: backend repo addition yields new API and impacted screen candidates without unrelated screen candidates.
- Test `packages/core/tests/pipeline_modules/build_epics/sync/restructure_audit.test.ts`: split/merge thresholds produce no-change or restructure tasks.
- Test `packages/core/tests/pipeline_modules/build_epics/sync/restructure_patch.test.ts`: restructure patch moves documents and preserves reviewability without auto-confirm.
- Test `packages/core/tests/pipeline_modules/build_epics/sync/runtime.test.ts`: assignment completion inserts restructure task only when thresholds are met.
- Test `packages/core/tests/pipeline_modules/build_epics/sync/worker_runner.test.ts`: work packet/schema supports restructure tasks.
- Add E2E fixture under `packages/cli/tests/fixtures/repo-topology-sync/`: frontend repo, backend repo, and expected JSON assertions.
- Add CLI E2E test `packages/cli/tests/repo-topology-sync-e2e.test.ts`: run local built CLI against the fixture.

## Task 1: Repository Inventory Changes Stop Blanket Staling

**Files:**
- Modify: `packages/core/src/repository_service.ts`
- Test: `packages/core/tests/repository_service.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test showing `addRepository()` invalidates project phases but does not mark unrelated fresh documents stale.

```ts
it('does not mark every document stale when adding a repository', () => {
  const db = createTestDb()
  seedProject(db, 'project:topology')
  seedRepository(db, { id: 'repo:front', projectId: 'project:topology', repoPath: frontendRepoPath })
  db.insert(documents).values({
    id: 'doc:screen-orders',
    projectId: 'project:topology',
    type: 'screen_spec',
    track: 'technical',
    scope: 'route',
    scopeId: 'screen:orders',
    status: 'passed',
    validity: 'fresh',
    summary: 'Orders screen',
    content: { title: 'Orders' },
    rawLlmOutput: '{}',
    documentSourceHash: 'hash:screen:orders:v1',
  }).run()

  addRepository(db, { projectId: 'project:topology', path: backendRepoPath })

  expect(db.select().from(documents).where(eq(documents.id, 'doc:screen-orders')).get()).toMatchObject({
    validity: 'fresh',
  })
  expect(projectPhase(db, 'project:topology', 'build_docs')).toMatchObject({
    status: 'pending',
    meta: expect.objectContaining({ invalidatedBy: 'repository_added' }),
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm --workspace packages/core test -- tests/repository_service.test.ts
```

Expected: FAIL because `invalidateProjectRepositoryInventoryDependents()` marks the seeded document stale.

- [ ] **Step 3: Implement the minimal change**

Remove the `db.update(documents)` block from `invalidateProjectRepositoryInventoryDependents()`. Keep phase invalidation and metadata unchanged.

- [ ] **Step 4: Verify the test passes**

Run:

```bash
npm --workspace packages/core test -- tests/repository_service.test.ts
```

Expected: PASS.

## Task 2: Include Relevant Service-Map Edges in Technical Document Hashes

**Files:**
- Modify: `packages/core/src/pipeline_modules/sync/static_map.ts`
- Test: `packages/core/tests/pipeline_modules/sync/static_map.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests with two screens and one API. A `calls_api` service-map edge from screen A to the API must change screen A and API hashes, but not screen B.

```ts
it('includes only relevant service-map edges in route document hashes', async () => {
  const db = createTestDb()
  const { projectId, frontendRepoId, backendRepoId } = seedStaticMapProject(db)
  seedEntryPoint(db, { id: 'screen:orders', repoId: frontendRepoId, kind: 'screen', path: '/orders' })
  seedEntryPoint(db, { id: 'screen:profile', repoId: frontendRepoId, kind: 'screen', path: '/profile' })
  seedEntryPoint(db, { id: 'api:orders', repoId: backendRepoId, kind: 'api', path: 'POST /api/orders' })
  const before = ensureCanonicalStaticSnapshot(db, projectId)

  seedServiceMapEdge(db, {
    id: 'service_edge:orders_screen_calls_orders_api',
    projectId,
    repoId: frontendRepoId,
    sourceRepoId: frontendRepoId,
    targetRepoId: backendRepoId,
    sourceType: 'screen',
    sourceId: 'screen:orders',
    targetType: 'api',
    targetId: 'api:orders',
    kind: 'calls_api',
    canonicalTarget: 'POST /api/orders',
    confidence: 'high',
    source: 'deterministic',
  })
  const after = ensureFreshStaticSnapshotForTest(db, projectId)

  expect(hashForTarget(db, before.snapshotId, { type: 'screen_spec', scopeId: 'screen:orders', repoId: frontendRepoId }))
    .not.toEqual(hashForTarget(db, after.snapshotId, { type: 'screen_spec', scopeId: 'screen:orders', repoId: frontendRepoId }))
  expect(hashForTarget(db, before.snapshotId, { type: 'api_spec', scopeId: 'api:orders', repoId: backendRepoId }))
    .not.toEqual(hashForTarget(db, after.snapshotId, { type: 'api_spec', scopeId: 'api:orders', repoId: backendRepoId }))
  expect(hashForTarget(db, before.snapshotId, { type: 'screen_spec', scopeId: 'screen:profile', repoId: frontendRepoId }))
    .toEqual(hashForTarget(db, after.snapshotId, { type: 'screen_spec', scopeId: 'screen:profile', repoId: frontendRepoId }))
})
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm --workspace packages/core test -- tests/pipeline_modules/sync/static_map.test.ts
```

Expected: FAIL because `routeDocumentHashEntry()` does not include service-map edge hashes.

- [ ] **Step 3: Implement relevant edge hashing**

In `buildDefaultMerkleSnapshot()`, pass `serviceEdgeRows` and `serviceEdgeHashes` to `routeDocumentHashEntry()`. Add a helper:

```ts
function serviceMapEdgesForDocument(input: {
  entryPoint: typeof entryPoints.$inferSelect
  serviceEdgeRows: Array<typeof serviceMapEdges.$inferSelect>
  serviceEdgeHashByKey: Map<string, string>
}): Array<{ key: string; hash: string }> {
  const sourceType = entryPointSourceType(input.entryPoint)
  return input.serviceEdgeRows
    .filter((edge) =>
      (edge.sourceType === sourceType && edge.sourceId === input.entryPoint.id) ||
      (edge.targetType === sourceType && edge.targetId === input.entryPoint.id))
    .map((edge) => ({
      key: serviceMapEdgeStableKey(edge),
      hash: input.serviceEdgeHashByKey.get(serviceMapEdgeStableKey(edge)) ?? hashValue(stableServiceMapEdge(edge)),
    }))
    .sort(byKey)
}
```

Include the returned `relatedServiceMapEdgeHashes` in the route document hash object.

- [ ] **Step 4: Verify targeted tests pass**

Run:

```bash
npm --workspace packages/core test -- tests/pipeline_modules/sync/static_map.test.ts
```

Expected: PASS.

## Task 3: Doc Sync Classifies Backend Additions Precisely

**Files:**
- Modify: `packages/core/src/pipeline_modules/sync/doc_sync.ts` only if target scope matching needs adjustment.
- Test: `packages/core/tests/pipeline_modules/sync/doc_sync.test.ts`

- [ ] **Step 1: Write the failing test**

Create an old snapshot with two frontend screens and a new snapshot with a backend API plus a service-map edge from one screen to that API. Assert candidates are one `new_document` for the API and one `stale` for the linked screen, with no candidate for the unrelated screen.

```ts
it('classifies backend repo addition as new API plus service-map-impacted screen only', () => {
  const db = createTestDb()
  seedProject(db, 'project:topology')
  seedStaticMerkleSnapshot(db, {
    id: 'snapshot:frontend',
    projectId: 'project:topology',
    technicalDocumentSourceHashes: [
      hashEntry('screen:orders', 'hash:screen:orders:v1', screenTarget('repo:front', 'screen:orders')),
      hashEntry('screen:profile', 'hash:screen:profile:v1', screenTarget('repo:front', 'screen:profile')),
    ],
  })
  seedStaticMerkleSnapshot(db, {
    id: 'snapshot:frontend-backend',
    projectId: 'project:topology',
    technicalDocumentSourceHashes: [
      hashEntry('screen:orders', 'hash:screen:orders:v2-service-map', screenTarget('repo:front', 'screen:orders')),
      hashEntry('screen:profile', 'hash:screen:profile:v1', screenTarget('repo:front', 'screen:profile')),
      hashEntry('api:orders', 'hash:api:orders:v1', apiTarget('repo:back', 'api:orders')),
    ],
  })
  seedDocument(db, { projectId: 'project:topology', id: 'doc:orders-screen', target: screenTarget('repo:front', 'screen:orders'), documentSourceHash: 'hash:screen:orders:v1' })
  seedDocument(db, { projectId: 'project:topology', id: 'doc:profile-screen', target: screenTarget('repo:front', 'screen:profile'), documentSourceHash: 'hash:screen:profile:v1' })

  const plan = createDocSyncPlan({
    db,
    projectId: 'project:topology',
    fromSnapshotId: 'snapshot:frontend',
    toSnapshotId: 'snapshot:frontend-backend',
  })
  const candidates = listDocSyncCandidates({ db, planId: plan.planId }).candidates

  expect(candidates).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'stale', target: expect.objectContaining({ type: 'screen_spec', scopeId: 'screen:orders' }) }),
    expect.objectContaining({ kind: 'new_document', target: expect.objectContaining({ type: 'api_spec', scopeId: 'api:orders' }) }),
  ]))
  expect(candidates).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ target: expect.objectContaining({ scopeId: 'screen:profile' }) }),
  ]))
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm --workspace packages/core test -- tests/pipeline_modules/sync/doc_sync.test.ts
```

Expected before Task 2 implementation: FAIL because screen hash does not change. Expected after Task 2: PASS unless target scope matching needs repair.

- [ ] **Step 3: Implement only if needed**

If target matching fails, update `targetInScope()` or target serialization helpers to preserve `repoId`, `scope`, and `scopeId` consistently. Do not add broad invalidation.

- [ ] **Step 4: Verify**

Run:

```bash
npm --workspace packages/core test -- tests/pipeline_modules/sync/doc_sync.test.ts tests/pipeline_modules/sync/static_map.test.ts
```

Expected: PASS.

## Task 4: EPIC Restructure Audit

**Files:**
- Create: `packages/core/src/pipeline_modules/build_epics/sync/restructure_audit.ts`
- Modify: `packages/core/src/pipeline_modules/build_epics/sync/index.ts`
- Test: `packages/core/tests/pipeline_modules/build_epics/sync/restructure_audit.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for no-change and split-needed results.

```ts
it('returns no_change when new APIs do not exceed split thresholds', () => {
  const result = deriveEpicRestructureAudit({
    plan: planWithEpic({ stableKey: 'orders', apiDocIds: ['doc:orders:create'], screenDocIds: ['doc:orders-screen'] }),
    impacts: [{ documentId: 'doc:orders:create', documentType: 'api_spec', kind: 'new', oldHash: null, newHash: 'h1' }],
    thresholds: defaultEpicRestructureThresholds(),
  })

  expect(result).toMatchObject({ action: 'no_change', taskRequired: false })
})

it('requires restructure when one existing EPIC receives too many independent new owner APIs', () => {
  const result = deriveEpicRestructureAudit({
    plan: planWithEpic({
      stableKey: 'user_management',
      apiDocIds: ['doc:users', 'doc:roles', 'doc:permissions', 'doc:invitations'],
      screenDocIds: ['doc:user-admin-screen'],
    }),
    impacts: [
      newApiImpact('doc:users'),
      newApiImpact('doc:roles'),
      newApiImpact('doc:permissions'),
      newApiImpact('doc:invitations'),
    ],
    thresholds: { maxNewOwnerApisPerEpic: 4, maxOwnerApisPerEpic: 8, minIndependentClusters: 2 },
  })

  expect(result).toMatchObject({
    action: 'restructure_required',
    taskRequired: true,
    reasons: expect.arrayContaining([expect.objectContaining({ code: 'TOO_MANY_NEW_OWNER_APIS' })]),
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm --workspace packages/core test -- tests/pipeline_modules/build_epics/sync/restructure_audit.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement audit**

Create `deriveEpicRestructureAudit()` with conservative thresholds:

```ts
export interface EpicRestructureThresholds {
  maxNewOwnerApisPerEpic: number
  maxOwnerApisPerEpic: number
  minIndependentClusters: number
}

export function defaultEpicRestructureThresholds(): EpicRestructureThresholds {
  return { maxNewOwnerApisPerEpic: 4, maxOwnerApisPerEpic: 8, minIndependentClusters: 2 }
}
```

Return `no_change` unless at least one explicit threshold is met. For MVP, cluster count can be computed from distinct domain hints or relation target groups present on impacted cards when available; if no cluster evidence exists, do not require restructure based on API count alone unless `maxNewOwnerApisPerEpic` is met.

- [ ] **Step 4: Verify**

Run:

```bash
npm --workspace packages/core test -- tests/pipeline_modules/build_epics/sync/restructure_audit.test.ts
```

Expected: PASS.

## Task 5: EPIC Restructure Patch

**Files:**
- Create: `packages/core/src/pipeline_modules/build_epics/sync/restructure_patch.ts`
- Test: `packages/core/tests/pipeline_modules/build_epics/sync/restructure_patch.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that split one EPIC into two reviewable EPICs and move selected documents without confirming persistence.

```ts
it('applies a split proposal to the reviewable draft only', () => {
  const plan = planWithEpic({
    stableKey: 'user_management',
    apiDocIds: ['doc:users', 'doc:roles'],
    screenDocIds: ['doc:user-admin-screen'],
  })

  const result = applyEpicSyncRestructurePatch({
    plan,
    submission: {
      actions: [
        {
          type: 'split_epic',
          sourceEpicStableKey: 'user_management',
          newEpics: [
            { stableKey: 'user_profile_management', name: 'User Profile Management', abbr: 'UPM', summary: 'Manage user profile records.' },
            { stableKey: 'role_permission_management', name: 'Role Permission Management', abbr: 'RPM', summary: 'Manage roles and permissions.' },
          ],
          moves: [
            { documentId: 'doc:users', documentType: 'api_spec', toEpicStableKey: 'user_profile_management', role: 'owner', reason: 'User API owns profile management.' },
            { documentId: 'doc:roles', documentType: 'api_spec', toEpicStableKey: 'role_permission_management', role: 'owner', reason: 'Role API owns permissions management.' },
          ],
          reason: 'Backend APIs reveal two independent capabilities.',
        },
      ],
    },
  })

  expect(result.validationIssues).toEqual([])
  expect(result.plan.epics.map((epic) => epic.stableKey)).toEqual(expect.arrayContaining([
    'user_profile_management',
    'role_permission_management',
  ]))
  expect(result.plan.epics.find((epic) => epic.stableKey === 'user_profile_management')?.apiLinks)
    .toEqual(expect.arrayContaining([expect.objectContaining({ apiDocId: 'doc:users' })]))
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm --workspace packages/core test -- tests/pipeline_modules/build_epics/sync/restructure_patch.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement patch**

Support actions:

```ts
type EpicSyncRestructureAction =
  | { type: 'no_change'; reason: string }
  | { type: 'split_epic'; sourceEpicStableKey: string; newEpics: NewEpic[]; moves: MoveDocument[]; reason: string }
  | { type: 'merge_epics'; sourceEpicStableKeys: string[]; targetEpic: NewEpic; moves: MoveDocument[]; reason: string }
  | { type: 'move_document'; documentId: string; documentType: BuildEpicsDocumentType; fromEpicStableKey?: string; toEpicStableKey: string; role: string; reason: string }
```

Validate no duplicate stable keys, no missing target EPIC keys, no moves to empty EPIC shells, and no unknown document type roles. Return validation issues instead of throwing for worker-repairable mistakes.

- [ ] **Step 4: Verify**

Run:

```bash
npm --workspace packages/core test -- tests/pipeline_modules/build_epics/sync/restructure_patch.test.ts
```

Expected: PASS.

## Task 6: Runtime Inserts Restructure Task Between Assignment and Cross Links

**Files:**
- Modify: `packages/core/src/pipeline_modules/build_epics/sync/runtime.ts`
- Test: `packages/core/tests/pipeline_modules/build_epics/sync/runtime.test.ts`

- [ ] **Step 1: Write failing tests**

Add a test where assignment completion creates `epic_sync_restructure` before `epic_sync_cross_links`.

```ts
it('runs restructure audit after assignment and before cross links', async () => {
  const db = createTestDb()
  seedProject(db)
  seedExistingUserManagementEpic(db)
  seedManyNewUserApiDocumentsSync(db)
  const runtime = new BuildEpicsSyncRuntime({ db })

  const started = await runtime.start({ projectId: 'p1', docSyncPlanId: 'plan:sync', requestedBy: 'user:test' })
  const assignmentLease = await runtime.leaseTasks({ runId: started.runId, limit: 1, workerId: 'worker:sync' })

  await runtime.submitTask({
    taskId: assignmentLease.leasedTasks[0].taskId,
    leaseToken: assignmentLease.leasedTasks[0].leaseToken,
    result: { assignments: manyAssignmentsToExistingEpic('user_management') },
  })

  expect(db.select().from(generationTasks).where(eq(generationTasks.runId, started.runId)).all()).toEqual(expect.arrayContaining([
    expect.objectContaining({
      targetKey: 'sync:restructure:1',
      targetJson: expect.objectContaining({ task_type: 'epic_sync_restructure' }),
      status: 'pending',
    }),
  ]))
  expect(db.select().from(generationTasks).where(eq(generationTasks.runId, started.runId)).all())
    .not.toEqual(expect.arrayContaining([expect.objectContaining({ targetKey: 'sync:cross_links:1' })]))
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm --workspace packages/core test -- tests/pipeline_modules/build_epics/sync/runtime.test.ts
```

Expected: FAIL because runtime inserts cross-link task immediately after assignments.

- [ ] **Step 3: Implement runtime phase**

Add `epic_sync_restructure` to `SYNC_TASK_TYPES`. Replace `isAssignmentPhaseComplete()` cross-link insertion with:

1. If assignment phase complete and no restructure/cross task exists, run audit.
2. If audit requires restructure, insert `sync:restructure:1`.
3. If audit returns no_change, insert `sync:cross_links:1`.
4. After restructure task completes, insert `sync:cross_links:1`.

- [ ] **Step 4: Verify**

Run:

```bash
npm --workspace packages/core test -- tests/pipeline_modules/build_epics/sync/runtime.test.ts tests/pipeline_modules/build_epics/sync/restructure_audit.test.ts
```

Expected: PASS.

## Task 7: Worker Packet Support for Restructure

**Files:**
- Modify: `packages/core/src/pipeline_modules/build_epics/sync/worker_runner.ts`
- Test: `packages/core/tests/pipeline_modules/build_epics/sync/worker_runner.test.ts`

- [ ] **Step 1: Write failing tests**

Add test asserting a restructure packet includes impacted EPICs, candidate actions, and schema enum for split/merge/move/no_change.

```ts
it('builds a restructure work packet with split merge move schema', () => {
  const packet = buildBuildEpicsSyncAgentWorkPacket({
    task: { taskId: 'task:restructure', leaseToken: 'lease:restructure', taskType: 'epic_sync_restructure', targetKey: 'sync:restructure:1' },
    context: {
      taskType: 'epic_sync_restructure',
      restructureReasons: [{ code: 'TOO_MANY_NEW_OWNER_APIS', epicStableKey: 'user_management' }],
      existingEpics: [{ stableKey: 'user_management', name: 'User Management', apiDocIds: ['doc:users', 'doc:roles'] }],
      impactedCards: [{ documentId: 'doc:roles', type: 'api_spec', title: 'POST /roles', summary: 'Manage roles.' }],
    },
  })

  expect(packet.task.taskType).toBe('epic_sync_restructure')
  expect(JSON.stringify(packet.agentInput.outputSchema)).toContain('split_epic')
  expect(JSON.stringify(packet.agentInput.outputSchema)).toContain('merge_epics')
  expect(packet.agentInput.rules).toEqual(expect.arrayContaining([
    expect.stringContaining('Do not auto-confirm'),
  ]))
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm --workspace packages/core test -- tests/pipeline_modules/build_epics/sync/worker_runner.test.ts
```

Expected: FAIL because restructure task type is normalized to assignment.

- [ ] **Step 3: Implement worker support**

Add `epic_sync_restructure` to task type unions, schema selection, prompts, rules, forbidden fields, and compact context.

- [ ] **Step 4: Verify**

Run:

```bash
npm --workspace packages/core test -- tests/pipeline_modules/build_epics/sync/worker_runner.test.ts
```

Expected: PASS.

## Task 8: CLI E2E Fixture

**Files:**
- Create: `packages/cli/tests/fixtures/repo-topology-sync/frontend/package.json`
- Create: `packages/cli/tests/fixtures/repo-topology-sync/frontend/src/App.tsx`
- Create: `packages/cli/tests/fixtures/repo-topology-sync/backend/package.json`
- Create: `packages/cli/tests/fixtures/repo-topology-sync/backend/src/server.ts`
- Create: `packages/cli/tests/repo-topology-sync-e2e.test.ts`

- [ ] **Step 1: Write failing E2E test**

The test must create a temp project, copy fixture repos, initialize git in each fixture repo, run the local built CLI, and assert JSON outputs.

```ts
it('syncs backend repo additions through docs, epics audit, and business docs scope', async () => {
  const fixture = await createRepoTopologyFixture()
  const cli = resolve(repoRoot, 'packages/cli/dist/main.js')

  await runJson(cli, ['init'], { cwd: fixture.workspace })
  const project = await runJson(cli, ['project', 'create', 'topology-beta', '--json'], { cwd: fixture.workspace })
  await runJson(cli, ['repo', 'add', fixture.frontendRepo, '--json'], { cwd: fixture.workspace })
  await runJson(cli, ['run', '--project', project.result.data.id, '--json'], { cwd: fixture.workspace })
  await runJson(cli, ['docs', 'start', '--project', project.result.data.id, '--json'], { cwd: fixture.workspace })

  await runJson(cli, ['repo', 'add', fixture.backendRepo, '--json'], { cwd: fixture.workspace })
  const sync = await runJson(cli, ['docs', 'start', '--project', project.result.data.id, '--json'], { cwd: fixture.workspace })

  expect(sync.result.data.incremental).toMatchObject({
    mode: expect.stringMatching(/sync/),
  })
  expect(sync.result.data.incremental.task_planned).toBeGreaterThan(0)

  const epicsPreview = await runJson(cli, ['epics', 'sync', 'preview', '--doc-sync-plan-id', sync.result.data.incremental.plan_id, '--json'], { cwd: fixture.workspace })
  expect(epicsPreview.result.data).toHaveProperty('counts')
})
```

- [ ] **Step 2: Run failing E2E test**

Build CLI first, then run the new test.

```bash
cd packages/cli && npm run build
npm --workspace packages/cli test -- tests/repo-topology-sync-e2e.test.ts
```

Expected: FAIL until implementation and fixture helpers are complete.

- [ ] **Step 3: Implement fixture helpers**

Add helper functions in the test file:

- `copyFixtureRepo(name)`
- `initGitRepo(path)`
- `runJson(cli, args, opts)`
- JSON assertion helpers for document counts and EPIC audit state.

Use local CLI only:

```bash
node packages/cli/dist/main.js <command> --json
```

- [ ] **Step 4: Verify E2E**

Run:

```bash
cd packages/cli && npm run build
npm --workspace packages/cli test -- tests/repo-topology-sync-e2e.test.ts
```

Expected: PASS.

## Task 9: Final Verification

**Files:**
- No new files unless fixing test-only fixture issues.

- [ ] **Step 1: Run targeted core tests**

Run:

```bash
npm --workspace packages/core test -- \
  tests/repository_service.test.ts \
  tests/pipeline_modules/sync/static_map.test.ts \
  tests/pipeline_modules/sync/doc_sync.test.ts \
  tests/pipeline_modules/build_epics/sync/restructure_audit.test.ts \
  tests/pipeline_modules/build_epics/sync/restructure_patch.test.ts \
  tests/pipeline_modules/build_epics/sync/runtime.test.ts \
  tests/pipeline_modules/build_epics/sync/worker_runner.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full core tests**

Run:

```bash
npm --workspace packages/core test
```

Expected: PASS.

- [ ] **Step 3: Build CLI workspace**

Run:

```bash
cd packages/cli && npm run build
```

Expected: PASS.

- [ ] **Step 4: Run CLI E2E**

Run:

```bash
npm --workspace packages/cli test -- tests/repo-topology-sync-e2e.test.ts
```

Expected: PASS.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intentional source, test, fixture, and plan files are changed.

## Self-Review

- Spec coverage: repo inventory behavior is covered by Task 1; service-map hashes by Task 2; doc sync precision by Task 3; EPIC split/merge audit and patch by Tasks 4-7; E2E fixture by Task 8; final verification by Task 9.
- Placeholder scan: no `TBD`, `TODO`, or unspecified "add tests" steps remain. Each task has explicit target files, commands, and expected outcomes.
- Type consistency: new terms are consistently named `epic_sync_restructure`, `deriveEpicRestructureAudit`, and `applyEpicSyncRestructurePatch`.
- Scope check: automatic persistence of split/merge is intentionally out of scope. Restructure produces a reviewable draft/task and requires existing confirm flow.

## Goal Prompt

Use this prompt as the active implementation goal:

```text
Implement the Repo Topology Sync plan in docs/superpowers/plans/2026-06-11-repo-topology-sync.md using strict TDD. Work in the isolated worktree /home/azureuser/platty/.worktrees/repo-topology-sync on branch feat/repo-topology-sync. First write failing tests for each behavior, verify they fail for the expected reason, then implement minimal code and verify green. Finish only after targeted tests, full core tests, CLI workspace build, and the new CLI E2E fixture pass. The desired product behavior is: repo add does not blanket-stale existing docs; service-map-relevant technical document hashes cause only newly linked frontend/backend docs to sync; EPIC sync always audits split/merge/restructure and creates reviewable restructure tasks only when explicit thresholds are met; business docs sync remains scoped to affected EPICs.
```
