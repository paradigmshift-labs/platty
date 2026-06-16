---
name: platty-business-docs-generation
description: Use when generating, syncing, validating, reviewing, resuming, cancelling, or repairing Platty business documents.
---

# Platty Business Docs Generation

Use this for business document generation and lifecycle operations.

When running as part of the end-to-end document workflow, prefer `platty generate-docs ...` agent commands over lower-level stage commands. Use lower-level `business-docs` commands only for debugging, manual review/validation, sync operations, or recovery.

## Generation Flow

Business docs are reached through `platty generate-docs confirm-epics` after the
EPIC draft is approved. Use `platty business-docs ...` only for recovery,
inspection, repair, or worker-level operations.

```bash
platty generate-docs confirm-epics --project <project> --run-id <run-id> --json
platty sync static-map --project <project> --json
```

Use the `using-platty` Operator UX at workflow start and handoff. Business-docs
runs are long and task-heavy, so every handoff must include run id, run status,
task counts, active lease count, and the next command or stop reason.

When writing to the user, translate internal queue terms:

- "leased task" -> "assigned task"
- "lease token" -> "task token"
- "lease expired" -> "task assignment expired"
- `BUSINESS_DOCS_LEASE_CONFLICT` -> "this task is no longer assigned to this worker; get it again for a fresh token"

To run an advanced recovery worker queue, pick the path for the runtime you are working in. Both produce the same documents through the same CLI contract — the only difference is who drives the worker loop.

## Choose The Worker Queue For Your Runtime

- **Working in Codex** → use the built-in advanced worker-level headless queue:
  advanced worker-level recovery command: `platty business-docs run --project <project> --provider codex_cli --json`
  This spawns `codex exec` per task and runs lease -> generate -> submit automatically.
- **Working in Claude Code** → use the dynamic workflow below.
  `--provider claude_code` for `run` is intentionally rejected (`CLAUDE_CODE_HEADLESS_UNSUPPORTED`): Platty has no headless Claude invoker, so Claude Code drives the same loop natively with parallel worker subagents instead.

Do not switch runtimes to use the other path — drive the queue with whatever runtime the user is already in.

## Claude Code Worker Queue (Dynamic Workflow)

Under Claude Code, reproduce the worker queue with a dynamic workflow that fans out parallel worker subagents. The saved `/business-docs-workflow` implements this end-to-end — run it with the project (and optionally an existing run id):

```text
/business-docs-workflow   with args { "project": "<project>", "run": "<run-id?>", "workerModel": "sonnet" }
```

It starts/resumes the run, loops in rounds (lease -> parallel generate -> submit), repairs once per task, stops on terminal failure, and returns the final task counts. The CLI owns task state, the DAG, lease concurrency, idempotency, and the v3 quality gate, so the workflow only coordinates lease -> generate -> submit. The loop it runs is:

Start the advanced recovery run, then loop in rounds until the run is no longer leaseable:

```text
1. advanced recovery start (once):  platty business-docs start --project <p> --json   -> runId
2. each round:
   a. status --json. If run.status is "failed" OR counts.failed > 0 and activeLeases == 0: STOP (Codex parity).
   b. advanced worker-level recovery lease (limit <= 6):  platty business-docs tasks lease --project <p> --run <runId> --worker <id> --limit 6 --json
      The CLI only returns tasks whose dependencies are satisfied (DAG gate), so never order tasks yourself.
   c. if 0 leased and activeLeases == 0: STOP. Otherwise fan out one worker per leased task.
   d. after the wave, re-run status (new use_case_spec tasks unlock after use_case_list_refine saves).
```

Each parallel worker owns one leased task end-to-end. Hand each worker the per-task prompt stored next to this skill at `./business-docs-worker-prompt.md` (read that file and pass its content to the worker) — it covers context-page reading, the `business-doc.v1` document shape, `items[]` population rules, output language, submit, and the repair loop.

Worker model: prefer a capable model (Sonnet) for generation. Haiku is cheap but frequently fails the v3 quality gate on `data_dictionary` and `use_case_list_refine`, which require model/entity-shaped items and carried-over upstream use cases. Reserve Haiku for the lease/status coordinator agent.

Effective concurrency is `min(workflow concurrency 16, approvedActiveLeases 20)`; lease in waves of <= 6 to stay well inside the active-lease limit.

## Red Flags

STOP if you catch yourself thinking any of these:

| Excuse | Reality |
| --- | --- |
| "I still hold the task token from before the repair — reuse it to re-read context" | A submit that returns `repair_requested` releases the task assignment. The old token no longer authorizes context reads (`BUSINESS_DOCS_LEASE_CONFLICT`). Get the task again: the same task returns with a fresh token plus a `validation_errors` page. |
| "There must be a `repair` subcommand for this" | There is none. Repair is lease -> read `validation_errors` -> fix -> submit with `--attempt <nextRepairAttemptNo>` from the repair response. |
| "Business rules need precision — keep the `/api/...` path in the rule text" | Technical identifiers in business prose fail validation with `BUSINESS_LANGUAGE_CONTAMINATION (TECH_API_PATH)`. Keep business language clean; sources link via `source_mapping` `sourceRef` labels. |
| "I'll write the prose in the language the user spoke to me" | Write in the language the `target` page declares in `outputLanguage`. Do not assume a fixed language. |

## Lifecycle Recovery

```bash
# Advanced recovery
platty business-docs resume --project <project> --run <run-id> --json
platty business-docs cancel --project <project> --run <run-id> --json
platty business-docs cleanup --project <project> --run <run-id> --json
```

## Manual Task Operations

```bash
# Advanced worker-level recovery
platty business-docs tasks lease --project <project> --run <run-id> --worker <worker-id> --json
platty business-docs tasks heartbeat --project <project> --task <task-id> --lease-token <token> --json
platty business-docs tasks retry --project <project> --task <task-id> --json
platty business-docs context get --context <context-handle> --lease-token <token> --json
platty business-docs context page --context <context-handle> --page <page-token> --lease-token <token> --json
platty business-docs tasks submit --project <project> --task <task-id> --lease-token <token> --attempt <n> --document-json '<json>' --json
```

If submit returns `repair_requested`, get the task again — the repair submit released the old task assignment, and the fresh assignment returns the same task with a new task token plus a `validation_errors` context page:

```bash
# Advanced worker-level recovery
platty business-docs tasks lease --project <project> --run <run-id> --worker <worker-id> --json
platty business-docs context page --context <context-handle> --page validation_errors --lease-token <new-token> --json
```

If the task has already become `failed` (repair attempts exhausted), retry it first, then lease again:

```bash
# Advanced worker-level recovery
platty business-docs tasks retry --project <project> --task <task-id> --json
platty business-docs tasks lease --project <project> --run <run-id> --worker <worker-id> --json
```

Do not invent a repair subcommand, and never reuse an old task token — after any submit the prior token stops authorizing context reads (`BUSINESS_DOCS_LEASE_CONFLICT`).

## Stop Conditions

- `status --json` shows the run `status` as `failed`, or `counts.failed > 0` with `activeLeases == 0`: STOP the worker loop (Codex parity) and report the final task counts.
- `tasks lease` returns 0 tasks with `activeLeases == 0`, or fails with `BUSINESS_DOCS_RUN_NOT_LEASEABLE`: no task is currently ready to assign, or the run is finished/blocked — stop requesting work and report `status` output.
- A task fails validation twice (`repair_requested`, then `failed` — `maxRepairAttempts` defaults to 1): stop authoring that task. Use `tasks retry` only when the user wants another attempt; `BUSINESS_DOCS_TASK_NOT_RETRYABLE` means stop for good.
- A context read fails with `BUSINESS_DOCS_LEASE_CONFLICT`: this task is no longer assigned to this worker — get the task again for a fresh token; never retry the old token.

## Handoff

Use this `Next` selection:

- leaseable run with pending tasks: advanced worker-level recovery command `platty business-docs tasks lease --project <project> --run <run-id> --worker <worker-id> --json`
- validation ready: advanced recovery command `platty business-docs validate --project <project> --run <run-id> --json`
- review ready: advanced recovery command `platty business-docs review --project <project> --run <run-id> --json`
- terminal failure: stop and report the failing code plus task counts

## Sync Flow

Advanced recovery commands:

```bash
platty business-docs sync preview --project <project> --json
platty business-docs sync start --project <project> --json
```
