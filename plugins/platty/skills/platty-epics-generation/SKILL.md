---
name: platty-epics-generation
description: Use when generating, validating, editing, confirming, or syncing Platty epics from analyzed project data.
---

# Platty Epics Generation

Use this after static analysis when the user wants product or business epics.

When running as part of the end-to-end document workflow, prefer `platty generate-docs ...` agent commands over lower-level stage commands. Use lower-level `epics` commands only for debugging, manual draft inspection, sync operations, or recovery.

## Main Flow

```bash
platty generate-docs run --project <project> --json
platty generate-docs confirm-epics --project <project> --run-id <run-id> --json
```

Use `platty generate-docs confirm-epics --project <project> --run-id <run-id> --json`
after the user approves the EPIC draft. Advanced internal EPIC worker commands
remain available only for recovery, inspection, repair, or worker-level
operations.

## Handoff

At completion, pause, or any stop condition, use the `Platty handoff` card.
Include `runId`, draft validation status, confirmed epic count when
available, and any failing task id. Recommended `Next` values:

- draft not ready: use the advanced internal worker-level EPIC recovery flow
- draft confirmed: route to `platty-business-docs-generation` or `platty-retrieval`
- sync run complete: inspect synced epics or continue business docs

Translate task-token errors for the user. If a submit/context command returns
`INVALID_LEASE_TOKEN` or `LEASE_EXPIRED`, say "this task is no longer assigned
to this worker" or "the task assignment expired"; include the exact code in
parentheses for debugging.

## Sync Flow

```bash
# Advanced internal worker-level recovery
platty epics sync preview --project <project> --doc-sync-plan-id <id> --json
platty epics sync start --project <project> --doc-sync-plan-id <id> --json
platty epics sync worker next --run-id <run-id> --out packet.json --json
platty epics sync tasks submit --task-id <task-id> --lease-token <lease-token> --input result.json --json
platty epics sync draft confirm --run-id <run-id> --json
```

## Stop Conditions

Advanced internal recovery stop conditions:

- `epics start` fails with `BUILD_EPICS_REPOSITORY_REQUIRED`: static analysis is incomplete — switch to `platty-static-analysis`; do not retry `epics start` in a loop.
- `draft confirm` fails with `BUILD_EPICS_DRAFT_NOT_READY`, or `validate` reports errors: do not force-confirm — finish remaining worker tasks first. If `worker next` returns `no_task_available` and the draft is still not ready, stop and report the run state.
- `draft confirm` fails with `BUILD_EPICS_DRAFT_ALREADY_CONFIRMED`: the draft is final — stop; do not confirm again or regenerate unless the user asks.
- A submit returns `failed` for a task: stop, report the error — do not invent epic content to force the run forward.
