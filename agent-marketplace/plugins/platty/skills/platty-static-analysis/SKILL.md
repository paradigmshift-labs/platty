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

## Stall Recovery

- If the same `nextAction` repeats across several `run --step-only` calls without `completedRepositoryIds` advancing, the loop is stalled — stop looping and debug with `runs list` / `runs show`.
- Known multi-repo stall: for the second and later repositories, `run --step-only` can return ok without doing work while `status` keeps reporting `run_static_analysis` instead of `confirm_required`. Recover with `platty confirm --project <project> --json` (it finds gated repos that status missed), then run the full `platty run --project <project> --json` to completion.
- If `docs start` fails with `BUILD_DOCS_PRECONDITION_FAILED` for a project-level stage (e.g. `project:build_service_map`) even though status reported `build_docs`, run the full `platty run --project <project> --json` once — `--step-only` does not execute project-level stages.
