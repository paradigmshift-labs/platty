---
name: platty-static-analysis
description: Use when running, resuming, inspecting, or troubleshooting Platty static analysis, project analysis, repository analysis, repo analysis, pipeline stages, analysis runs, run status, cancellation, or next analysis actions.
---

# Platty Static Analysis

Use this after a project has at least one registered repository.

## Flow

1. Run or resume static analysis:

```bash
platty analyze --project <project> --json
platty analyze --project <project> --from build_route --json
```

2. Inspect next action if the next step is unclear:

```bash
platty status --project <project> --json
```

3. Inspect run history when debugging:

```bash
platty runs list --project <project> --json
platty runs show --run-id <run-id> --project <project> --json
platty runs cancel --run-id <run-id> --project <project> --reason "<reason>" --json
```

## Rule

Keep calling `platty status --project <project> --json` between phases. When status reports `build_docs`, switch to `platty-docs-target-curation` for target curation, then to `platty-generated-docs` after target scope is accepted.

## Public Gate Rule

Static analysis no longer has a public confirmation command. Compatibility
recovery note: if an installed global CLI asks for `platty confirm`, treat that
CLI as stale and tell the user to rebuild or reinstall it before continuing.

## Handoff

At every pause or completion, use the `Platty handoff` card. Include the
latest `status --json` nextAction and any run ids inspected. Recommended `Next`
values:

- `run_static_analysis`: `platty analyze --project <project> --json`
- `build_docs`: route to `platty-docs-target-curation` for target curation, then to `platty-generated-docs` after target scope is accepted

## Stop Conditions

- The same `nextAction` (`type`, `repoId`, `stage`) repeats across 2+ `analyze` calls without `completedRepositoryIds` advancing: the loop is stalled — stop looping and debug with `runs list` / `runs show`.
- `runs show` reports the run `status` as `failed`, or `analyze` returns `PIPELINE_CANCELLED` or `ANALYSIS_FAILED`: stop, report the error payload to the user — do not restart the pipeline without being asked.
