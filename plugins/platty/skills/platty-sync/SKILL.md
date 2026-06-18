---
name: platty-sync
description: Use when syncing Platty generated outputs into canonical static-map state or checking whether generated outputs are ready to sync.
---

# Platty Sync

Use this skill for the public sync workflow after generated docs, EPICs, and
business docs are complete.

Sync is separate from generation:

```text
generate-docs = create or update generated outputs
sync static-map = reconcile generated outputs into canonical state
```

Do not use sync to start technical docs, EPIC generation, or business-doc
generation.

## Required Inputs

Resolve these before syncing:

- project selector from `platty project list/create/use --json`;
- generated-docs status showing no active generated-output work;
- latest business-doc run state when business docs are part of the project
  workflow.

## Readiness Check

Before running sync, inspect generated-output state:

```bash
platty generate-docs status --project <project> --json
```

Run sync only when generated-output work is complete and inactive:

```bash
platty sync static-map --project <project> --json
```

If generated-output work is active, incomplete, failed, or awaiting EPIC
approval, stop and route back to `platty-generated-docs`.

## Stop Conditions

- Generated docs are missing: route to `platty-generated-docs`.
- EPIC draft is waiting for approval: stop for explicit approval through
  `platty-generated-docs`.
- Business-doc generation is running or has active leases: stop and report the
  run id, counts, and active lease count.
- Business-doc generation failed: route to generated-docs advanced recovery; do
  not run sync to clean it up.
