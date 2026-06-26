---
name: platty-sync
description: Use when refreshing existing Platty generated outputs after source, repository, branch, source-root, static-analysis, or static-map changes.
---

# Platty Sync

Use this skill when source or repository state changed after generated outputs
already exist: new Git commits, newly registered repositories, analysis branch
changes, source-root changes, or static-analysis refreshes. Sync refreshes
existing generated technical and business outputs against the latest analyzed
static-map state.

Sync is not the final step of the first-time happy path. First-time generation
is:

```text
setup -> analyze -> targets -> generate-docs
```

Use sync for incremental refresh after source/repository changes and fresh
static analysis.

## Required Inputs

Resolve these before syncing:

- project selector from `platty project list/create/use --json`;
- current project state from `platty status --project <project> --json`;
- fresh static analysis after the source/repository change;
- no active failed generated-output recovery that must preserve an existing run.

Business-doc sync includes glossary outputs. Treat `glossary`,
`epic_glossary`, and `project_glossary` as part of the business-doc refresh
surface.

Static-analysis freshness is a hard preflight. `sync static-map`,
`sync create-doc-plan`, `sync plan`, and `sync run` must compare the registered
source repository HEAD with the analyzed commit and require fresh passed static
pipeline stages before continuing. If the CLI returns
`STATIC_ANALYSIS_REQUIRED_BEFORE_SYNC`, run the returned
`nextAction.command` (`platty analyze --project <project> --json`) before
retrying sync. Do not reuse an existing `--plan-id` after source commits changed
until analysis is fresh again.

## Public Workflow

After source or repository changes, refresh the analyzed static-map snapshot
before creating a document sync plan:

```bash
platty sync static-map --project <project> --json
```

Then create and inspect a sync plan:

```bash
platty sync plan --project <project> --json
```

Follow the returned `nextAction.command`, usually:

```bash
platty sync run --project <project> --plan-id <plan-id> --json
```

If `sync run` returns `epics_sync_confirmation_required`, run the returned
`sync confirm` command automatically:

```bash
platty sync confirm --project <project> --plan-id <plan-id> --epics-run-id <run-id> --json
```

Pause only when the user explicitly asked to review EPIC sync changes before
confirmation, or when the CLI response lacks `--plan-id`, `--epics-run-id`, or a
concrete returned command.

Use `sync run --project <project> --json` without `--plan-id` only when the user
does not need to inspect a plan first; that path runs static-map refresh and
creates a plan internally before continuing.

## Stop Conditions

- `platty status` says static analysis is stale or incomplete: route to
  `platty-static-analysis` before sync.
- `sync plan`, `sync run`, `sync create-doc-plan`, or `sync static-map` returns
  `STATIC_ANALYSIS_REQUIRED_BEFORE_SYNC`: run the returned static-analysis
  command first, then recreate or rerun the sync plan.
- Generated docs are missing: route to `platty-generated-docs`; sync refreshes
  existing outputs.
- Failed `build_docs` recovery is pending: route to `platty-generated-docs` and
  preserve the existing run.
- EPIC sync confirmation is required but the CLI returned no `sync confirm`
  command, no plan id, or no EPIC run id: stop and report the missing field.
- The user explicitly requested manual EPIC sync review before confirmation:
  stop and ask whether to proceed.
- Business-doc sync fails or leaves pending candidates: follow the returned
  recovery command; do not apply the plan manually.
