---
name: platty-epics-generation
description: Use when generating, validating, editing, confirming, or syncing Platty epics from analyzed project data.
---

# Platty Epics Generation

Use this after static analysis when the user wants product or business epics.

## Main Flow

```bash
platty epics preview --project <project> --json
platty epics start --project <project> --json
platty epics worker next --run-id <run-id> --out packet.json --json
platty epics tasks submit --task-id <task-id> --lease-token <lease-token> --input result.json --json
platty epics draft show --run-id <run-id> --json
platty epics validate --run-id <run-id> --json
platty epics draft confirm --run-id <run-id> --json
```

Use `platty epics run --project <project> --provider codex_cli --json` only when the user wants the automatic worker queue.

## Handoff

At completion, pause, or any stop condition, use the `Platty handoff` card.
Include `runId`, draft validation status, confirmed epic count when
available, and any failing task id. Recommended `Next` values:

- draft not ready: `platty epics worker next --run-id <run-id> --out packet.json --json`
- draft confirmed: route to `platty-business-docs-generation` or `platty-retrieval`
- sync run complete: inspect synced epics or continue business docs

## Sync Flow

```bash
platty epics sync preview --project <project> --doc-sync-plan-id <id> --json
platty epics sync start --project <project> --doc-sync-plan-id <id> --json
platty epics sync worker next --run-id <run-id> --out packet.json --json
platty epics sync tasks submit --task-id <task-id> --lease-token <lease-token> --input result.json --json
platty epics sync draft confirm --run-id <run-id> --json
```

## Stop Conditions

- `epics start` fails with `BUILD_EPICS_REPOSITORY_REQUIRED`: static analysis is incomplete — switch to `platty-static-analysis`; do not retry `epics start` in a loop.
- `draft confirm` fails with `BUILD_EPICS_DRAFT_NOT_READY`, or `validate` reports errors: do not force-confirm — finish remaining worker tasks first. If `worker next` returns `no_task_available` and the draft is still not ready, stop and report the run state.
- `draft confirm` fails with `BUILD_EPICS_DRAFT_ALREADY_CONFIRMED`: the draft is final — stop; do not confirm again or regenerate unless the user asks.
- A submit returns `failed` for a task: stop, report the error — do not invent epic content to force the run forward.
