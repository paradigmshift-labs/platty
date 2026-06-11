---
name: platty-docs-generation
description: Use when generating Platty technical documents with the Platty CLI, handling build_docs worker packets, submitting draft JSON, or recovering docs generation tasks.
---

# Platty Docs Generation

Use this skill for Platty technical document generation when Codex is acting as the document author through the CLI worker flow.

This is different from `platty-retrieval`: retrieval answers questions from existing docs, while this skill creates or repairs source-backed draft documents for `build_docs` tasks.

## Required Inputs

Resolve these before generating content:

- Project selector: `--project <project-id-or-name>`, unless a run id is already supplied.
- Existing run id, if continuing a generation run.
- Target scope, if the user wants only specific APIs, screens, events, or schedules.

If the project is unknown, run:

```bash
platty project list --json
```

Inside this repo, use the local CLI after it is built:

```bash
node packages/cli/dist/main.js <command> --json
```

Use `platty <command> --json` when the installed binary is available.

## Worker Flow

Prefer this skill-plus-CLI flow unless the user explicitly asks for fully automatic `docs run`.

1. Inspect available targets before starting work:

```bash
platty docs targets list --project <project> --json
```

Use filters such as `--kind api`, `--kind screen`, `--search <term>`, or route and method filters when the user gives a narrow request.

2. Start or resume a docs generation run:

```bash
platty docs start --project <project> --json
```

If the user gives a run id, continue that run instead of starting another one.

3. Preview the planned tasks:

```bash
platty docs preview --run-id <run-id> --json
```

4. Approve the run before leasing worker tasks:

```bash
platty docs approve --run-id <run-id> --max-concurrent-tasks 1 --json
```

Use low concurrency for interactive Codex work so each task can be inspected and repaired deliberately.

5. Lease the next task packet:

```bash
platty docs worker next --run-id <run-id> --out packet.json --json
```

Handle worker states directly:

- `not_approved`: approve the run, then request the next task again.
- `no_task_available`: run status and report completion or the blocking state.
- Task packet returned: read `packet.json` and generate the draft result.

6. Create `result.json` from the packet.

Use only `packet.agentInput.context` as document evidence. Match `packet.agentInput.outputSchema`. Respect every entry in `packet.agentInput.forbiddenFields`.

Do not inspect local source files, databases, or generated docs to fill the draft body. The packet context is the source contract for the authoring task.

7. Submit the result:

```bash
platty docs tasks submit --task-id <task-id> --lease-token <lease-token> --input result.json --json
```

Prefer `packet.submit.command` when present, because it carries the exact task id and lease token.

8. React to the submit outcome:

- `saved`: continue with `platty docs worker next` or inspect status.
- `repair_requested`: use the validation errors plus the same `agentInput.context` to rewrite `result.json`, then resubmit while the lease is valid.
- `failed`: stop, report the error, and do not invent a successful document.

9. Check final run status:

```bash
platty docs status --run-id <run-id> --json
```

Report completed, pending, repair, and failed counts from the JSON output.

## Draft Safety Rules

Always produce source-backed content.

- Use only facts present in `agentInput.context`.
- Do not include fields listed in `forbiddenFields`.
- Do not submit system-owned metadata such as `id`, `type`, `identity`, `relations`, `relation_facts`, `contracts`, `source_links`, `evidence_refs`, or `source_context`.
- Do not manufacture evidence ids, target ids, source paths, route names, payload fields, or business rules.
- Prefer empty arrays or concise uncertainty notes over unsupported claims.
- Keep output JSON valid and schema-shaped. No markdown fences in `result.json`.

## Draft Shapes

Use the exact schema in the packet when it differs from this summary.

For `api_spec`, draft only author-owned content:

```json
{
  "title": "",
  "summary": "",
  "access": {},
  "flow": [],
  "rules": [],
  "source_link_selection": []
}
```

For `screen_spec`:

```json
{
  "title": "",
  "summary": "",
  "ascii_ui": "",
  "layout": [],
  "state": [],
  "flow": [],
  "rules": []
}
```

For `event_spec`:

```json
{
  "title": "",
  "summary": "",
  "payload": [],
  "consumers": []
}
```

For `schedule_spec`:

```json
{
  "title": "",
  "summary": "",
  "trigger": "",
  "input": [],
  "flow": [],
  "rules": []
}
```

## Red Flags

STOP if you catch yourself thinking any of these:

| Excuse | Reality |
| --- | --- |
| "The context is missing these fields — the source file is right there, reading it takes 30 seconds" | `agentInput.context` is the ONLY evidence contract for the draft. Reading local sources, databases, or generated docs to fill the body is a violation even when the result would be accurate. Use empty arrays or concise uncertainty notes instead. |
| "A merged full document (or the system fields from context) looks more complete" | Submit only the author-owned draft fields. System-owned fields (`id`, `relations`, `evidence_refs`, ...) corrupt the merge — see Draft Safety Rules. |
| "`repair_requested` means the task failed — report failure" | `repair_requested` is the normal validation loop. Fix `result.json` against the same `agentInput.context` and resubmit while the lease is valid. |
| "The wave finished, so the run is done — report success" | Report only what `platty docs status` shows. Check completed/pending/repair/failed counts before claiming anything. |
| "The user gave a run id, but a fresh run is cleaner" | Continue the supplied run. A new run duplicates tasks and orphans the old one. |
| "`docs run` is faster than authoring through the worker flow" | `docs run` is the fully automatic queue — use it only when the user explicitly asks for it. |

## Stop Conditions

- Submit returns `failed`: stop, report the error from the response — never invent a successful document or restart the run to hide the failure.
- The same task returns `repair_requested` twice with the same validation errors: stop and report the errors verbatim instead of resubmitting another variation.
- `worker next` returns `no_task_available` while `docs status` still reports pending or repair counts above zero: report the blocking state to the user — do not poll `worker next` in a loop.
- Submit fails with `LEASE_EXPIRED` or `INVALID_LEASE_TOKEN`: lease again via `worker next` once; if the fresh token also fails, stop and report.
