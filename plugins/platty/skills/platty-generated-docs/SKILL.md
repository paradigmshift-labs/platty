---
name: platty-generated-docs
description: Use when generating, validating, reviewing, resuming, or repairing Platty generated outputs through the public generate-docs workflow.
---

# Platty Generated Docs

Use this skill for the public generated-output workflow:

```text
targets -> generate-docs run -> EPIC approval -> generate-docs confirm-epics
```

This skill owns technical document generation, EPIC draft generation, the EPIC
approval pause, business-doc generation after approval, generated-docs status,
and advanced recovery for the three worker stages.

Do not route public work directly through lower-level `docs`, `epics`, or
`business-docs` commands. Those commands are internal compatibility surfaces for
Platty maintainers and repo-local debugging; keep public agent workflows on the
`generate-docs` facade.

## Required Inputs

Resolve these before running project-scoped commands:

- project selector from `platty project list/create/use --json`;
- target review state from `platty targets list --project <project> --json`;
- generated-docs status or run id, if resuming;
- EPIC run id, draft id, and explicit approval state when continuing past the
  EPIC gate.
- agent provider choice when a command will run generated-output workers, unless
  the user already specified one.

Inside the Platty monorepo, run the local build form:

```bash
node packages/cli/dist/main.js <command> --json
```

Outside this repo, use the installed global CLI:

```bash
platty <command> --json
```

## Agent Provider Gate

Before starting worker-backed generated-output work, ask which provider to use
unless the user already chose one in the current conversation or the verified
`nextCommand` already includes `--provider`.

Ask in the user's language. For Korean users, ask:

```text
어떤 실행 방식으로 생성할까요?

1. Codex CLI - 기본값, `codex exec` headless 실행
2. Claude Code CLI - Claude Code headless 실행
3. Claude API - Anthropic API 키 필요
```

Map the answer to command flags:

| Choice | Flags |
| --- | --- |
| Codex CLI | omit `--provider` or use `--provider codex_cli` |
| Claude Code CLI | `--provider claude_code` |
| Claude API | `--provider claude_api` |

If the user chooses Claude API, make sure they know where to add the key before
running the command:

```bash
open ~/.platty/.env
```

The file must contain an uncommented line:

```env
ANTHROPIC_API_KEY=<anthropic-api-key>
```

If the CLI returns `ANTHROPIC_API_KEY_REQUIRED`, follow the response's
`nextAction.command`, let the user add the key, then retry the same command.

Keep the selected provider for the whole generated-docs workflow. If
`generate-docs run` pauses for EPIC approval, include the same provider flags on
`generate-docs confirm-epics` unless the response's `nextCommand` already
preserves them.

## Public Workflow

Inspect targets before generation:

```bash
platty targets list --project <project> --json
```

Start or resume public generated-output work:

```bash
platty generate-docs run --project <project> --json
```

With an explicit provider choice:

```bash
platty generate-docs run --project <project> --provider claude_api --json
```

If the response reports `epics_confirmation_required`, stop. Validation is not
approval. Summarize the EPIC draft state and ask the user whether to approve it.

After explicit user approval only:

```bash
platty generate-docs confirm-epics --project <project> --run-id <run-id> --json
```

If a provider was selected earlier, preserve it:

```bash
platty generate-docs confirm-epics --project <project> --run-id <run-id> --provider claude_api --json
```

Check workflow state:

```bash
platty generate-docs status --project <project> --json
```

## Gate Precedence

Do not blindly follow `nextAction.command` across these gates:

- target review is missing or incomplete;
- EPIC draft needs explicit user approval;
- generated-output work is active and the user asks for sync;
- recovery must preserve an existing run and avoid regeneration.

If a gate blocks progress, stop and use a `Platty handoff` card with the latest
verified JSON state.

## Recovery

Use the generated-docs facade first for recovery, inspection, debugging, and
worker-level contexts.

Known generated-output recovery should preserve the existing run and avoid
regenerating completed work. Inspect or resume through the facade:

```bash
platty generate-docs status --project <project> --stage <stage> --run-id <run-id> --json
platty generate-docs prepare --project <project> --stage <stage> --run-id <run-id> --json
platty generate-docs approve-stage --project <project> --stage build_docs --run-id <run-id> --json
```

Do not use `--new-run` or `--force-regenerate` unless the user explicitly asks
to discard or regenerate existing work.

Worker-stage recovery uses the generated-docs facade:

```bash
platty generate-docs prepare --project <project> --stage build_docs --json
platty generate-docs prepare --project <project> --stage build_epics --json
platty generate-docs prepare --project <project> --stage build_business_docs --json
platty generate-docs agent-next --project <project> --stage <stage> --run-id <run-id> --json
platty generate-docs agent-submit --project <project> --stage <stage> --run-id <run-id> --task-id <task-id> --lease-token <token> --document-json <json> --json
```

Use direct `docs`, `epics`, or `business-docs` roots only when a Platty
maintainer explicitly asks for an internal command or repo-local debugging
requires it. Do not present those roots as public workflows.

## Stop Conditions

- EPIC draft is valid but not explicitly approved: stop and ask for approval.
- `targets list` shows target review is incomplete: stop and route target work
  through `platty targets ...`.
- User asks for sync while generated work is active, failed, or incomplete:
  route to `platty-sync` and stop before syncing.
- Known business-doc run has saved/completed tasks: preserve the run id and do
  not regenerate saved work.
- A lower-level command appears in a public happy-path suggestion: stop and
  reroute through this skill.
