# heroines_sync_test build_docs Sync Report

Date: 2026-06-10
Project: `heroines_sync_test`
Project ID: `J34rorHP3W866sIvJ-Nvs`

## Result

Status: blocked by static-analysis sync

`build_docs` was not started as latest-main sync verification because static analysis did not refresh from the selected `main` branch.

## Commands

```bash
PLATTY_HOME=/Users/pshift/Development/platty/.platty/home node packages/cli/dist/main.js docs targets list --project J34rorHP3W866sIvJ-Nvs --json
PLATTY_HOME=/Users/pshift/Development/platty/.platty/home node packages/cli/dist/main.js docs start --project J34rorHP3W866sIvJ-Nvs --sync-plan __missing__ --json
```

## Evidence

- Existing document targets are readable: total 193 targets.
- Target breakdown: 7 API targets, 186 screen targets.
- Internal Flutter route-like targets are present, for example `internal://home/verification` and `internal://shopping-diary-post/...`.
- `docs start --sync-plan __missing__` fails with `DOC_SYNC_PLAN_NOT_FOUND`, which confirms incremental `build_docs` requires a valid doc sync plan.
- A valid doc sync plan requires a refreshed static snapshot; that prerequisite is blocked by the static-analysis sync issue.

## Quality Gate

Failed for latest-main sync verification.

The existing `build_docs` data can be inspected, but it is not valid evidence for latest `main` because the static-analysis stage remained pinned to older `lastSyncedCommit` values.

## Issues

1. The CLI does not provide an explicit command to create or inspect the static-map sync snapshot needed before incremental `build_docs`.
2. `docs preview` requires `--run-id`; there is no project-level docs sync preview command that can summarize “what will change from latest static snapshot” before starting a run.
3. `docs start --sync-plan` has no discoverable CLI path to obtain the required `doc_sync_plan_id` when static sync is CLI-inaccessible.

## Stop Condition

Do not run `build_docs` for latest-main validation until static-analysis sync is refreshed and a valid doc sync plan is available.
