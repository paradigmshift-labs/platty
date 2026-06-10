# heroines_sync_test Static Analysis Sync Report

Date: 2026-06-10
Project: `heroines_sync_test`
Project ID: `J34rorHP3W866sIvJ-Nvs`
Scope: `heroines`, `heroines_web`

## Result

Status: blocked

The CLI did not re-run static analysis after both repositories were moved from the historical analysis branch to `main`.

## Commands

```bash
PLATTY_HOME=/Users/pshift/Development/platty/.platty/home node packages/cli/dist/main.js project use J34rorHP3W866sIvJ-Nvs --json
PLATTY_HOME=/Users/pshift/Development/platty/.platty/home node packages/cli/dist/main.js repo update swBy98plSAY3P4PUihhlv --branch main --json
PLATTY_HOME=/Users/pshift/Development/platty/.platty/home node packages/cli/dist/main.js repo update cGdyE7RP6FUJMTdCCSRPd --branch main --json
PLATTY_HOME=/Users/pshift/Development/platty/.platty/home node packages/cli/dist/main.js status --json
PLATTY_HOME=/Users/pshift/Development/platty/.platty/home node packages/cli/dist/main.js run --step-only --project J34rorHP3W866sIvJ-Nvs --json
```

## Evidence

- `repo update` changed both repositories to `analysisBranch: "main"`.
- `status` still returned `nextAction.type: "build_docs"`.
- `run --step-only` returned `completedRepositoryIds: []` and `nextAction.type: "build_docs"`.
- `heroines` stored `lastSyncedCommit` is `877e44e458ab4bfbab47d16df0989923484f3c89`.
- `heroines` current `origin/main` is `957b2b1903fc32462e59d5c88dbfb9d5f1f49fb7`, 47 commits ahead of the stored commit.
- `heroines_web` stored `lastSyncedCommit` is `a12eff162abb282c20044aada21a6e63726f42fa`.
- `heroines_web` current `origin/main` is `5b5afe74d282878824c0def812c9e9dec4ecbb44`, 25 commits ahead of the stored commit.

## Quality Gate

Failed. Static analysis output is not proven to represent latest `main`.

## Issues

1. `repo update --branch main` does not invalidate or recompute stale static-analysis state.
2. `status` checks freshness against `repository.lastSyncedCommit`, not the current selected branch HEAD.
3. The CLI does not expose `analysis run-next`, `repo status`, `repo reset`, `project reset`, or `syncStaticMap`; the documented/expected recovery path is not available in the current CLI surface.

## Stop Condition

Do not treat downstream `build_docs`, `build_epics`, or `build_business_docs` results as latest-main sync verification until the static-analysis refresh path is available or a non-CLI fallback is explicitly accepted.
