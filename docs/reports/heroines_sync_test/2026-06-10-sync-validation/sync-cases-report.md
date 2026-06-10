# heroines_sync_test Sync Cases Report

Date: 2026-06-10
Project: `heroines_sync_test`
Project ID: `J34rorHP3W866sIvJ-Nvs`

## Result

Status: partially verified

Algorithm-level sync tests pass, but `heroines_sync_test` CLI E2E sync is blocked because latest-main static analysis cannot be triggered through the current CLI surface.

## Test Command

```bash
npm --workspace @platty/core test -- tests/pipeline_modules/sync tests/pipeline_modules/build_epics/sync tests/pipeline_modules/build_business_docs/sync
```

Result: 15 test files passed, 85 tests passed.

## Case Matrix

| Case | Unit/integration coverage | CLI E2E on heroines_sync_test |
| --- | --- | --- |
| Route added | Covered by doc sync `new_document` candidates and build_epics assignment tasks for new documents. | Blocked |
| Route changed | Covered by doc sync `stale` candidates, static-map-to-doc-sync integration, and build_epics assignment tasks for changed documents. | Blocked |
| Route deleted | Covered by doc sync orphan handling and deleted route document state. | Blocked |
| Epic added | Covered by build_epics sync draft/task flow and mixed sync confirm path that creates a new EPIC. | Blocked |
| Epic deleted | Covered by deletion-only draft, mixed deletion/create flow, and business-doc orphan preview for confirmed deleted EPICs. | Blocked |

## Evidence

- `sync/doc_sync.test.ts` covers deterministic `new_document`, `stale`, `stale_candidate`, and `orphan_document` candidates.
- `sync/integration.test.ts` covers applying a generated document against the static-map snapshot that created the plan.
- `sync/static_map.test.ts` covers repo pinning, static stage execution order, Merkle snapshot creation, and staged graph/model/route/relation hashing.
- `build_epics/sync/runtime.test.ts` covers deletion-only drafts, assignment tasks for new and changed documents, and a mixed flow that deletes an empty EPIC and creates a new EPIC.
- `build_business_docs/sync/preview.test.ts` covers stale/orphaned business-doc targets, confirmed deleted EPICs, scoped EPIC movement, and project glossary planning.

## Open Issues

1. CLI latest-main static sync is not runnable end-to-end.
   - `repo update --branch main` changes metadata but does not invalidate stale phase state.
   - `platty run --step-only` still returns `build_docs` and completes zero repositories.

2. CLI recovery commands documented or expected by workflow are missing.
   - Missing: `analysis run-next`.
   - Missing: `repo status`.
   - Missing: `repo reset`.
   - Missing: `project reset`.
   - Missing: a CLI command for `syncStaticMap`.

3. Downstream sync commands require `doc_sync_plan_id`, but the CLI does not expose a complete route to create that ID from latest static-map sync.
   - `docs start --sync-plan <id>` requires an existing plan.
   - `epics sync *` requires `--doc-sync-plan-id`.
   - `business-docs sync *` requires `--doc-sync-plan-id`.

4. Existing `heroines_sync_test` data is internally queryable but cannot be considered latest-main evidence.
   - Stored active repo commits are `877e44e...` for `heroines` and `a12eff1...` for `heroines_web`.
   - Current `origin/main` heads are `957b2b1...` and `5b5afe7...`.

## Recommendation

Implement or expose a CLI-level sync entrypoint before attempting repo-mutation E2E tests:

1. Refresh selected analysis branch to latest remote/head.
2. Re-run static map in a staging snapshot.
3. Create a doc sync plan from previous snapshot to latest snapshot.
4. Continue `docs sync -> epics sync -> business-docs sync` using that plan.

After that, rerun the requested route/epic add/delete/change tests against a disposable branch or fixture repo through the CLI.
