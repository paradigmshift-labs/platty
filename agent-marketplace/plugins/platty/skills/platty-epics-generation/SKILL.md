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

## Sync Flow

```bash
platty epics sync preview --project <project> --doc-sync-plan-id <id> --json
platty epics sync start --project <project> --doc-sync-plan-id <id> --json
platty epics sync worker next --run-id <run-id> --out packet.json --json
platty epics sync tasks submit --task-id <task-id> --lease-token <lease-token> --input result.json --json
platty epics sync draft confirm --run-id <run-id> --json
```
