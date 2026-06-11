---
name: platty-worker
description: Drive Claude Code as a provider-free worker for Platty's build_docs / build_epics / build_business_docs generation queues via the CLI (lease → generate → submit). Use when codex_cli is unavailable or to parallelize generation across subagents.
---

# Platty Worker (agent-as-worker)

Platty's generation runs expose a **provider-free worker queue** over the CLI. Instead of an external
LLM provider (codex_cli), Claude Code leases tasks, generates the required structured JSON, and submits.
This bypasses codex quota entirely and parallelizes across subagents.

## Stages and commands
Each stage has the same worker verbs (replace `<stage>` with `docs`, `epics`, or `business-docs`;
add the `sync` infix for incremental, e.g. `epics sync worker next`):

- `<stage> start --project <id> [--sync-plan <id>] --json` → create run, returns `run_id`.
- `<stage> worker next --run-id <id> --json` → lease 1 ready task + return a **work packet**.
- `<stage> tasks submit --task-id <id> --lease-token <tok> --input <result.json> --json` → submit output.
- `<stage> draft show --run-id <id> --json` → review draft (epics/business).
- `<stage> draft confirm --run-id <id> --json` → commit (epics/business).
- `<stage> approve --run-id <id> --json` then docs use `tasks`/`worker` similarly.

Always set `PLATTY_HOME` and run from the platty repo root, e.g.:
`PLATTY_HOME=<home> node packages/cli/dist/main.js epics worker next --run-id <RID> --json`

## The work packet
`worker next` returns `data.task` (`taskId`, `leaseToken`) and `data.work` with everything needed:
- `taskType` — e.g. `taxonomy_candidate | taxonomy_consolidation | document_assignment | cross_domain_link` (epics);
  `api_spec | event_spec | schedule_spec | screen_spec` (docs); business doc types for business-docs.
- `prompt` — the generation instructions (same text the codex worker receives).
- `outputSchema` — the **exact JSON schema** your submission must satisfy.
- `context` — the evidence/inputs (prior-stage results, code facts, documents).
- `rules`, `forbiddenFields` — constraints to obey.

## Worker loop (one worker)
Repeat until the run is done:
1. `worker next --run-id <RID> --json`.
2. If `data.type === 'no_task_available'`:
   - If `data.runStatus` shows the run finished / draft building/ready → **stop**.
   - Else (tasks pending but blocked by DAG deps) → wait ~5s, retry (bounded, e.g. 20x).
3. Else generate a JSON object that **strictly** satisfies `data.work.outputSchema`, honoring `prompt`,
   `rules`, and `forbiddenFields`, grounded only in `data.work.context`. Write it to a temp file.
4. `tasks submit --task-id <taskId> --lease-token <leaseToken> --input <file> --json`.
   - If the response has `status: 'repair_requested'` or validation errors, read them, fix the JSON,
     and resubmit (up to ~3 tries) using the **same** lease token.
5. Loop.

## DAG ordering (epics)
`taxonomy_candidate*` → `taxonomy_consolidation` → `document_assignment*` → `cross_domain_link*`.
`worker next` only hands out tasks whose dependencies are satisfied, so a **pool of N identical workers**
draining the queue automatically respects stage order. Parallelism lives *within* a stage (candidate /
assignment chunks); cross-stage is serialized by the DAG.

## Parallelizing with a workflow
Spawn N drainer subagents in `parallel(...)`, each running the worker loop above for the same `run-id`.
Keep N modest for tiny runs (1 task/stage → 1–2 workers); scale N up for large repos where candidate /
assignment chunk into many tasks. The queue is `workerId`-based and lease transactions hand different
tasks to different workers, so concurrent drainers are safe (brief SQLite lock retries possible).

## After generation
- epics/business: `draft show` → review → `draft confirm`.
- docs: submissions persist directly; verify via `<stage> list` / DB `documents`.
