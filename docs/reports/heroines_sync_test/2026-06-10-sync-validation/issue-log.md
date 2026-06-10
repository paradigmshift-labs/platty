# heroines_sync_test Issue Log

Date: 2026-06-10

## Critical

1. Latest-main sync cannot be validated through CLI.
   - Evidence: after both repos were updated to `analysisBranch: "main"`, `status` still returned `nextAction.type: "build_docs"`.
   - Evidence: `run --step-only` returned `completedRepositoryIds: []`.
   - Impact: downstream `build_docs`, `build_epics`, and `build_business_docs` sync validation cannot prove latest `main`.

2. Static-analysis freshness is anchored to stored `lastSyncedCommit`, not selected branch HEAD.
   - Evidence: `heroines` is 47 commits behind `origin/main`.
   - Evidence: `heroines_web` is 25 commits behind `origin/main`.
   - Impact: branch metadata can say `main` while analysis outputs still reflect older commits.

## High

3. CLI does not expose required sync/recovery commands.
   - Missing commands observed: `analysis`, `repo status`, `repo reset`, `project reset`, static-map sync.
   - Impact: agent and user workflows cannot recover stale sync state without DB/core-level fallback.

4. Incremental document sync lacks a discoverable CLI entrypoint for creating `doc_sync_plan_id`.
   - Evidence: `docs start --sync-plan __missing__` fails with `DOC_SYNC_PLAN_NOT_FOUND`.
   - Impact: `docs`, `epics sync`, and `business-docs sync` cannot be chained from CLI alone.

## Medium

5. `docs preview` is run-id scoped only.
   - Evidence: `docs preview --project ...` fails with `--run-id is required`.
   - Impact: there is no simple project-level preview of pending document sync impact.

6. Existing project contains historical run records for deleted/previous repo IDs.
   - Evidence: `runs list` includes old repo ids outside current `repo list`.
   - Impact: status views can be confusing unless reports distinguish active repo list from historical run log.

7. Business-doc preview still warns that model evidence is not integrated.
   - Evidence: `Model evidence is not integrated into preview yet for 26 runnable EPICs.`
   - Impact: preview completeness is lower than expected for data/model-heavy business docs.
