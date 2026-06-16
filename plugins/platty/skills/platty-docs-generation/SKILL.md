---
name: platty-docs-generation
description: Use when generating Platty technical documents with the Platty CLI, handling build_docs worker packets, submitting draft JSON, or recovering docs generation tasks.
---

# Platty Docs Generation

Use this skill for Platty technical document generation when Codex is choosing
or operating a document worker flow.

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

Use the installed global CLI by default:

```bash
platty <command> --json
```

If the installed global CLI appears stale, follow `using-platty`: stop and
report that the global CLI needs reinstall/rebuild before continuing.

## Target Review

Do this before starting or approving document generation.

1. Inspect available targets before starting work:

```bash
platty targets list --project <project> --json
```

Use filters such as `--kind api`, `--kind screen`, `--search <term>`, or route and method filters when the user gives a narrow request.

There is no separate `build_route confirm` command in the current CLI. Route
targets are reviewed here with `targets list`, `targets include`, and
`targets deprecate`; the public generation batch starts with
`platty generate-docs run --project <project> --json`.

## Execution Mode Decision

Before approving a run or assigning worker tasks, show the user a clear choice
when the request has not already selected a mode:

```text
Platty: 문서 생성 방식 선택
- 프로젝트: <project>
- 실행 ID: <run-id or "새로 시작">
- 대상 검토: <done / needs target review>
- 대기 작업: <pending count if known>
- 추천: 1. 하위 Codex CLI worker queue (20개 병렬)

1. 하위 Codex CLI 호출로 자동 생성
   - 대량 생성 기본값입니다.
   - Platty가 `codex exec` worker를 최대 20개까지 병렬로 돌리고, 작업 배정/제출/1회 repair를 자동 처리합니다.
   - 명령:
     platty generate-docs run --project <project> --json
   - GPT-5.3-Codex-Spark를 우선 쓰고 실패 시 mini로 돌릴 때:
     platty generate-docs run --project <project> --model gpt-5.3-codex-spark --fallback-model gpt-5.4-mini --workers 1 --max-concurrent-tasks 1 --json

2. 내부 서브에이전트로 생성
   - advanced internal recovery mode: 현재 Codex/Claude 세션의 서브에이전트가 작업을 하나씩 맡아 작성합니다.
   - 작업 내용을 사람이 확인하거나, 모델/프롬프트를 세밀하게 조정할 때 사용합니다.
   - 먼저 승인:
     platty docs approve --run-id <run-id> --max-concurrent-tasks <n> --json

3. 현재 세션에서 1개만 확인
   - 디버깅/품질 확인용입니다.
   - 승인 후 작업 1개만 받아서 작성합니다.
```

If the user says "run it", "auto", "bulk", or asks for the 20-way path, use
mode 1. Use `platty generate-docs run --project <project> --json` as the public
handoff in both Codex and Claude Code. Runtime-specific worker loops are
recovery or worker-level operations only. If the user asks to inspect output,
use subagents, or keep generation inside the current agent runtime, use mode 2.
Use mode 3 only for debugging or when the user explicitly wants one task.

## Codex CLI Worker Queue

Use this for mode 1. It is the normal public bulk path.

If no run exists:

```bash
platty generate-docs run --project <project> --json
```

To prefer GPT-5.3-Codex-Spark and fall back to GPT-5.4-mini when the preferred
Codex model is unavailable, pass both models explicitly. Start with low
concurrency because Spark has separate research-preview limits:

```bash
platty generate-docs run --project <project> --model gpt-5.3-codex-spark --fallback-model gpt-5.4-mini --workers 1 --max-concurrent-tasks 1 --json
```

If continuing an existing run:

```bash
platty generate-docs run --project <project> --run-id <run-id> --json
```

The CLI owns start/resume, approval, task assignment, `codex exec` worker
launches, submit, one repair loop, and final status. Do not replace this path
with manual `worker next` calls when the user chose bulk Codex CLI execution.

If the provider is not `codex_cli` and the CLI returns
`CLAUDE_CODE_HEADLESS_UNSUPPORTED`, stop and tell the user this installed CLI
only supports headless bulk generation through Codex CLI. Offer mode 2 for
internal subagent orchestration.

## Manual/Subagent Worker Flow

Use this advanced internal worker-level recovery flow for mode 2 or mode 3.

Advanced internal worker-level recovery rule: Claude Code must not call `platty docs run --provider claude_code`. Use `platty generate-docs prepare`, then dispatch worker subagents that call `platty generate-docs agent-next` and `platty generate-docs agent-submit` until `platty generate-docs status` reports no pending tasks.

1. Prepare or resume the stage:

```bash
platty generate-docs prepare --project <project> --stage build_docs --json
```

If the user gives a run id, continue that run instead of starting another one.

2. Assign the next task packet:

Advanced internal worker-level recovery command:

```bash
platty generate-docs agent-next --project <project> --run-id <run-id> --stage build_docs --json
```

Handle worker states directly:

- `not_approved`: report that the run needs approval or use the lower-level docs command for manual approval.
- `no_task_available`: run status and report completion or the blocking state.
- Task packet returned: generate the draft result from the packet.

3. Create draft JSON from the packet.

Use only `task.agentInput.context` as document evidence. Match `task.agentInput.outputSchema`. Respect every entry in `task.agentInput.forbiddenFields`.

Do not inspect local source files, databases, or generated docs to fill the draft body. The packet context is the source contract for the authoring task.

4. Submit the result:

Advanced internal worker-level recovery command:

```bash
platty generate-docs agent-submit --project <project> --stage build_docs --run-id <run-id> --task-id <task-id> --lease-token <lease-token> --document-json '<json>' --elapsed-ms <ms> --input-tokens <n> --output-tokens <n> --token-source provider_usage --json
```

Prefer `task.submit.command` when present, because it carries the exact task
id and task token. The CLI option is named `--lease-token`; call it a task token
when explaining it to users.

5. React to the submit outcome:

- `saved`: continue with `generate-docs agent-next` or inspect status.
- `repair_requested`: get the task again for a fresh task token, then use the validation errors plus the same agent context to rewrite the JSON.
- `failed`: stop, report the error, and do not invent a successful document.

6. Check final run status:

Advanced internal worker-level recovery command:

```bash
platty generate-docs status --project <project> --stage build_docs --run-id <run-id> --json
```

Report completed, pending, repair, and failed counts from the JSON output.

7. Report generation metrics:

```bash
platty generate-docs report --project <project> --json
```

Report `overall.elapsedMs`, `overall.totalTokens`, each stage `averageMsPerCompletedTask`, stage token totals, and failed/repair counts.

Use lower-level `platty docs start/approve/worker next/tasks submit/status` only for debugging, manual approval, or recovery.

## Handoff

At completion, pause, or any stop condition, use the `Platty handoff` card.
Include `runId`, completed/pending/repair/failed counts, and the last
task id when applicable. Recommended `Next` values:

- pending or repair tasks remain and no execution mode is selected: show the
  `Platty: 문서 생성 방식 선택` card
- user selected Codex CLI bulk mode: `platty generate-docs run --project <project> --run-id <run-id> --json`
- user selected internal subagents: approve the run with the selected
  concurrency, then dispatch one worker per assigned task
- user selected one-task debug mode: `platty generate-docs agent-next --project <project> --stage build_docs --run-id <run-id> --json`
- all docs complete: route to `platty-retrieval`, `platty-epics-generation`, or `platty-business-docs-generation` depending on the user's goal
- failed task/run: stop and list the failing code/message from JSON

Phrase task-token problems for users. Do not say "not leased", "lease하지 않음",
or "lease하지 않았기 때문".
Say "this task is no longer assigned to this worker; get the task again for a
fresh token" and include the exact code in parentheses.

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
| "`repair_requested` means the task failed — report failure" | `repair_requested` is the normal validation loop. Fix `result.json` against the same `agentInput.context` and resubmit while the task token is valid. |
| "The wave finished, so the run is done — report success" | Report only what the run status shows. Check completed/pending/repair/failed counts before claiming anything. |
| "The user gave a run id, but a fresh run is cleaner" | Continue the supplied run. A new run duplicates tasks and orphans the old one. |
| "The lower-level docs queue bypasses review, so avoid it" | Public bulk generation uses `platty generate-docs run --project <project> --json` after target review. |

## Stop Conditions

- Submit returns `failed`: stop, report the error from the response — never invent a successful document or restart the run to hide the failure.
- The same task returns `repair_requested` twice with the same validation errors: stop and report the errors verbatim instead of resubmitting another variation.
- advanced internal worker-level recovery: `worker next` returns `no_task_available` while `docs status` still reports pending or repair counts above zero: report "no task is currently ready to assign" to the user — do not poll `worker next` in a loop.
- Submit fails with `LEASE_EXPIRED` or `INVALID_LEASE_TOKEN`: get the task again via `worker next` once for a fresh task token; if the fresh token also fails, stop and report the plain-language blocker plus the exact error code.
