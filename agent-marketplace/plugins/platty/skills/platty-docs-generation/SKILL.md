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

## Common Mistakes

- Running `platty docs run` when the user asked for Codex-authored skill work.
- Starting a new run when the user supplied an existing run id.
- Submitting a merged full document instead of the author-owned draft fields.
- Copying system-owned fields from context into `result.json`.
- Reading local files to add details missing from `agentInput.context`.
- Treating `repair_requested` as failure instead of a normal validation loop.
- Reporting success before checking `platty docs status`.
