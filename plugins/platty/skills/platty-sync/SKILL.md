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

The normal automatic journey is:

```text
setup -> analyze -> sync run
```

Use sync for incremental refresh after source/repository changes and fresh
static analysis.

## Required Inputs

Resolve these before syncing:

- project selector from `platty project list/create/use --json`;
- current project state from `platty status --project <project> --json`;
- fresh static analysis after the source/repository change, except a project
  made solely of managed Gitless directory sources (the CLI refreshes and
  analyzes those before sync);
- no active failed generated-output recovery that must preserve an existing run.

Business-doc sync includes glossary outputs. Treat `glossary`,
`epic_glossary`, and `project_glossary` as part of the business-doc refresh
surface.

Static-analysis freshness is a hard preflight. `sync static-map`,
`sync create-doc-plan`, `sync plan`, and `sync run` must compare the registered
source repository HEAD with the analyzed commit and require fresh passed static
pipeline stages before continuing. For a project made solely of managed Gitless
directory sources, a no-`--plan-id` sync refreshes the customer directory and
reruns only the stale static pipeline work before continuing. Run
`platty sync run --project <project> --json` directly for that case; do not
pre-run `analyze`. Existing Git repositories keep the current behavior. If the CLI returns
`STATIC_ANALYSIS_REQUIRED_BEFORE_SYNC`, run the returned
`nextAction.command` (`platty analyze --project <project> --json`) before
retrying sync. Do not reuse an existing `--plan-id` after source commits changed
until analysis is fresh again.

An explicit `--plan-id` is an immutable resume: it must not refresh a directory
source or trigger analysis. Create a new no-`--plan-id` sync after a source
change instead.

## Public Workflow

Run one command after source or repository changes. It refreshes the static-map
snapshot, prepares the document plan, builds technical docs, synchronizes and
applies EPICs, then builds and applies business docs. No human target or EPIC
review step is part of this path:

```bash
platty sync run --project <project> --json
```

`sync prepare` and `sync plan` remain optional inspection tools. Use them only
when an operator explicitly asks to inspect the proposed changes before running
the normal automatic command:

```bash
platty sync prepare --project <project> --json
```

An inspected plan can still be run explicitly for compatibility:

```bash
platty sync run --project <project> --plan-id <plan-id> --json
```

The normal command is the no-`--plan-id` form. It makes a fresh plan itself and
does not pause for confirmation.

## Stop Conditions

- `platty status` says static analysis is stale or incomplete: route to
  `platty-static-analysis` before sync.
- `sync plan`, `sync run`, `sync create-doc-plan`, or `sync static-map` returns
  `STATIC_ANALYSIS_REQUIRED_BEFORE_SYNC`: run the returned static-analysis
  command first, then rerun `sync run --project <project> --json`.
- Failed `build_docs` recovery is pending: route to `platty-generated-docs` and
  preserve the existing run.
- Business-doc sync fails or leaves pending candidates: follow the returned
  recovery command; do not apply the plan manually.
