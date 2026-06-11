---
name: platty-static-analysis
description: Use when running Platty static analysis, inspecting pipeline state, approving analysis gates, or managing analysis runs.
---

# Platty Static Analysis

Use this after a project has at least one registered repository.

## Flow

1. Inspect next action:

```bash
platty status --project <project> --json
```

2. Advance analysis one safe step:

```bash
platty run --step-only --project <project> --json
```

3. If an analysis gate is waiting for confirmation:

```bash
platty confirm --project <project> --json
platty run --step-only --project <project> --json
```

4. Inspect run history when debugging:

```bash
platty runs list --project <project> --json
platty runs show --run-id <run-id> --project <project> --json
platty runs cancel --run-id <run-id> --project <project> --reason "<reason>" --json
```

## Rule

Keep calling `platty status --project <project> --json` between phases. When status reports `build_docs`, switch to `platty-docs-target-curation` or `platty-docs-generation`.

## Stop Conditions

- The same `nextAction` (`type`, `repoId`, `stage`) repeats across 2+ `run --step-only` calls without `completedRepositoryIds` advancing: the loop is stalled — stop looping and debug with `runs list` / `runs show`.
  - Known multi-repo stall: for the second and later repositories, `run --step-only` can return ok without doing work while `status` keeps reporting `run_static_analysis` instead of `confirm_required`. Recover with `platty confirm --project <project> --json` (it finds gated repos that status missed), then run the full `platty run --project <project> --json` to completion. [F8 workaround — remove when step-only reports confirm_required for later repos]
- `docs start` fails with `BUILD_DOCS_PRECONDITION_FAILED` for a project-level stage (e.g. `project:build_service_map`) even though status reported `build_docs`: run the full `platty run --project <project> --json` once — `--step-only` does not execute project-level stages. If the same error repeats after the full run, stop and report it. [F16 workaround — remove when step-only runs project-level stages]
- `runs show` reports the run `status` as `failed`, or `run`/`confirm` returns `PIPELINE_CANCELLED` or `ANALYSIS_FAILED`: stop, report the error payload to the user — do not restart the pipeline without being asked.
