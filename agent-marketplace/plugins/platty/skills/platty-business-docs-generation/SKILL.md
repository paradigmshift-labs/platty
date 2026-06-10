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

Each parallel worker owns one leased task end-to-end:

1. Read every context page for the task (`context get`, then `context page` for `target`, `schema`, `source_document_cards`, `source_graph_projection`, and any `relation_evidence` / `model_evidence`). The `schema` page's `expectedJson.expectedItemContent` defines the exact `items[].content` fields for the documentType. The `source_document_cards` page lists `sourceRef` labels (e.g. `source_document_1`).
2. Build one `business-doc.v1` JSON object preserving `documentType`, `scope`, `scopeId`. Set document `evidenceIds` and every `items[].evidenceIds` to `[]`. Link sources only through `source_mapping` `sourceRef` labels. Write Korean prose (outputLanguage `ko`).
3. **Populate `items[]` fully** — every item needs a non-empty `itemType`, `stableKey`, and `content` object matching the schema page. Never emit empty item objects (`{}`); empty items are the most common validation failure. Mirror the same concrete entries in both the canonical `content` arrays and `items[]`.
4. Submit (write JSON to a temp file to avoid shell escaping):
   `platty business-docs tasks submit --project <p> --task <taskId> --lease-token <token> --attempt <n> --document-json "$(cat <file>)" --json`
5. On `repair_requested`, read the validation errors and re-submit ONCE using `--attempt <nextRepairAttemptNo>` from the response, fixing every error. `maxRepairAttempts` defaults to 1, so a second failure becomes `failed`. Do this inside the same lease before it expires (15-minute TTL).

Worker model: prefer a capable model (Sonnet) for generation. Haiku is cheap but frequently fails the v3 quality gate on `data_dictionary` and `use_case_list_refine`, which require model/entity-shaped items and carried-over upstream use cases. Reserve Haiku for the lease/status coordinator agent.

Effective concurrency is `min(workflow concurrency 16, approvedActiveLeases 20)`; lease in waves of <= 6 to stay well inside the active-lease limit.

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

If submit returns `repair_requested`, retry the task, then lease again to get a fresh lease token/context/attempt:

```bash
platty business-docs tasks retry --project <project> --task <task-id> --json
platty business-docs tasks lease --project <project> --run <run-id> --worker <worker-id> --json
```

Do not invent a repair subcommand or reuse an old lease token unless the CLI response explicitly says it is still valid.

## Sync Flow

```bash
platty business-docs sync preview --project <project> --json
platty business-docs sync start --project <project> --json
```
