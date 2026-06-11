---
name: platty-business-docs-generation
description: Use when generating, syncing, validating, reviewing, resuming, cancelling, or repairing Platty business documents.
---

# Platty Business Docs Generation

Use this for business document generation and lifecycle operations.

## Generation Flow

```bash
platty business-docs preview --project <project> --json
platty business-docs start --project <project> --json
platty business-docs status --project <project> --run <run-id> --json
platty business-docs validate --project <project> --run <run-id> --json
platty business-docs review --project <project> --run <run-id> --json
```

To run the automatic worker queue, pick the path for the runtime you are working in. Both produce the same documents through the same CLI contract — the only difference is who drives the worker loop.

## Choose The Worker Queue For Your Runtime

- **Working in Codex** → use the built-in headless queue:
  `platty business-docs run --project <project> --provider codex_cli --json`
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

Start the run, then loop in rounds until the run is no longer leaseable:

```text
1. start (once):  platty business-docs start --project <p> --json   -> runId
2. each round:
   a. status --json. If run.status is "failed" OR counts.failed > 0 and activeLeases == 0: STOP (Codex parity).
   b. lease (limit <= 6):  platty business-docs tasks lease --project <p> --run <runId> --worker <id> --limit 6 --json
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
| "I still hold the lease token from before the repair — reuse it to re-read context" | A submit that returns `repair_requested` RELEASES the lease. The old token no longer authorizes context reads (`BUSINESS_DOCS_LEASE_CONFLICT`). Lease again: the same task returns with a fresh token plus a `validation_errors` page. |
| "There must be a `repair` subcommand for this" | There is none. Repair is lease -> read `validation_errors` -> fix -> submit with `--attempt <nextRepairAttemptNo>` from the repair response. |
| "Business rules need precision — keep the `/api/...` path in the rule text" | Technical identifiers in business prose fail validation with `BUSINESS_LANGUAGE_CONTAMINATION (TECH_API_PATH)`. Keep business language clean; sources link via `source_mapping` `sourceRef` labels. |
| "I'll write the prose in the language the user spoke to me" | Write in the language the `target` page declares in `outputLanguage`. Do not assume a fixed language. |

## Lifecycle Recovery

```bash
platty business-docs resume --project <project> --run <run-id> --json
platty business-docs cancel --project <project> --run <run-id> --json
platty business-docs cleanup --project <project> --run <run-id> --json
```

## Manual Task Operations

```bash
platty business-docs tasks lease --project <project> --run <run-id> --worker <worker-id> --json
platty business-docs tasks heartbeat --project <project> --task <task-id> --lease-token <token> --json
platty business-docs tasks retry --project <project> --task <task-id> --json
platty business-docs context get --context <context-handle> --lease-token <token> --json
platty business-docs context page --context <context-handle> --page <page-token> --lease-token <token> --json
platty business-docs tasks submit --project <project> --task <task-id> --lease-token <token> --attempt <n> --document-json '<json>' --json
```

If submit returns `repair_requested`, lease again — the repair submit released the old lease, and the fresh lease returns the same task with a new lease token plus a `validation_errors` context page:

```bash
platty business-docs tasks lease --project <project> --run <run-id> --worker <worker-id> --json
platty business-docs context page --context <context-handle> --page validation_errors --lease-token <new-token> --json
```

If the task has already become `failed` (repair attempts exhausted), retry it first, then lease again:

```bash
platty business-docs tasks retry --project <project> --task <task-id> --json
platty business-docs tasks lease --project <project> --run <run-id> --worker <worker-id> --json
```

Do not invent a repair subcommand, and never reuse an old lease token — after any submit the prior token stops authorizing context reads (`BUSINESS_DOCS_LEASE_CONFLICT`).

## Stop Conditions

- `status --json` shows the run `status` as `failed`, or `counts.failed > 0` with `activeLeases == 0`: STOP the worker loop (Codex parity) and report the final task counts.
- `tasks lease` returns 0 tasks with `activeLeases == 0`, or fails with `BUSINESS_DOCS_RUN_NOT_LEASEABLE`: the run is finished or blocked — stop leasing and report `status` output.
- A task fails validation twice (`repair_requested`, then `failed` — `maxRepairAttempts` defaults to 1): stop authoring that task. Use `tasks retry` only when the user wants another attempt; `BUSINESS_DOCS_TASK_NOT_RETRYABLE` means stop for good.
- A context read fails with `BUSINESS_DOCS_LEASE_CONFLICT`: the old lease token is dead — lease again for a fresh token; never retry the old token.

## Sync Flow

```bash
platty business-docs sync preview --project <project> --json
platty business-docs sync start --project <project> --json
```
