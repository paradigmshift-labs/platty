---
name: platty-setup
description: Use when initializing Platty, creating or selecting a project, adding or managing repositories, inspecting setup state, or guiding a human through the Platty setup workflow hub.
---

# Platty Setup

Use this for Platty setup and setup-state decisions. Platty stores CLI state in
the user-global Platty home by default (`~/.platty` on macOS/Linux,
`%APPDATA%\Platty` on Windows). `PLATTY_HOME` overrides that location. The CLI
config field named `projectRoot` refers to this Platty home/workspace root, not
to a repository being analyzed.

## Human Surface

`platty setup` is the preferred human onboarding and workflow-hub command. It
shows the current project, registered repositories, a local path example, and
the next recommended workflow action.

For humans, prefer:

```bash
platty setup
```

Do not ask a normal user to run `--json` unless they are debugging
machine-readable output or copying exact state for an agent.

The setup hub should be described as covering:

```text
project selection -> repository registration -> analysis -> target review ->
technical docs -> EPIC approval -> business documents -> sync handoff
```

## Project Dashboard Surface

For humans, `platty setup` opens a project dashboard before workflow work.

Describe the dashboard as showing:

- The selected project.
- Registered repositories and their paths.
- Static-analysis next action.
- Documentation target review state before technical docs work.
- Technical docs state.
- EPIC state and a pending confirmation run id when available.
- Business-docs state and run id when available.
- Active generation jobs from DB run state.
- Recent completed or failed generation runs.

Do not tell users to use tmux for normal setup progress. Prefer the dashboard
and persisted Platty run status. Use direct recovery commands only when the
dashboard points to a specific run that needs inspection:

```bash
platty generate-docs status --project <project> --stage build_docs --run-id <id> --json
platty generate-docs status --project <project> --stage build_business_docs --run-id <id> --json
```

## Agent Surface

For agent automation, use JSON output to inspect state and choices. Do not
expect prompts in JSON mode.

```bash
platty setup --json
platty status --project <project> --json
```

After inspecting JSON, explain the state in user-friendly language and recommend
one next action. If a response includes `nextAction.command`, treat that command
as the next step unless a Stop Condition or workflow gate below applies. EPIC
continuation still requires explicit user approval before `confirm-epics`, and
business documents that are still running must not be synced yet.

### Explicit JSON Setup Sequence

When setup reports that lower-level setup is still needed, preserve this
sequence so agents can inspect project ids, repository ids, and next actions
without relying on interactive prompts:

```bash
platty init --json
platty project list --json
platty project create "<name>" --description "<description>" --json
platty project use <project-id-or-name> --json
platty repo list --project <project> --json
platty repo add <path> --project <project> --json
platty repo list --project <project> --json
```

Use this decision order:

- If `project list` returns zero projects, ask for a project name or create the
  requested project.
- If exactly one project is clearly the intended target, run `project use`.
- If multiple projects exist or a selector is ambiguous, ask the user which
  project to use.
- After `project use`, run `repo list` before any `repo add`.
- A repository path is never a project selector.

## Invariants

```text
1. A repository path is NEVER a project selector. Resolve <project> only from
   the JSON output of project list / project create / project use.
2. On an existing project, run repo list BEFORE repo add. repo add does not
   warn about duplicate names or dead repoPath entries — you must check.
3. Do not infer state location from cwd or the repository path. Run `platty init`
   once to create the global Platty home, then register repositories explicitly.
```

## Project Scoping

- Inspect JSON output from `project list`, `project create`, or `project use` to determine the resolved project selector.
- For existing-project setup, select the existing project before `repo add`.
- Use the resolved project id/name consistently as `<project>` for `repo add`, `repo list`, and `status`.

Add repositories inside the selected project:

```bash
platty repo list --project <project> --json
platty repo add <path> --project <project> --json
platty repo list --project <project> --json
```

Use `--source-root` when only a subdirectory should be analyzed. Use `--branch` when analysis should track a specific branch — without it, `repo add` tracks whatever branch the repository currently has checked out.

For an existing project, run `repo list` BEFORE `repo add` and inspect the registered entries:

- Remove or fix registrations whose `repoPath` does not exist on disk (seeded or moved repos) — analysis pointed at them fails.
- Watch for an existing entry with the same name as the repo you are adding; `repo add` does not warn on duplicate names.

```bash
platty repo update <repo-id-or-name> --path <new-path> --project <project> --json
platty repo remove <repo-id-or-name> --project <project> --json
```

## Stop Conditions

- `project use` or any `--project` command fails with `PROJECT_AMBIGUOUS`: stop and ask the user which project to use — never pick one of the matches yourself.
- `repo add` fails with `NOT_A_GIT_REPO`, `NOT_A_DIRECTORY`, or a nonexistent path: stop and report the path — do not retry with guessed path variants.
- `repo update` / `repo remove` fails with `REPO_AMBIGUOUS` or `REPO_NOT_FOUND` after you already re-checked `repo list`: stop and ask the user which registration to change.

## Workflow Hub Next Steps

When setup is complete enough to continue, choose the next step from verified
state:

| State | Human guidance | Agent check |
| --- | --- | --- |
| Select or create project | In `platty setup`, choose `Create or switch project`. | `platty setup --json` |
| Inspect current project state | In `platty setup`, choose `Manage current project`. | `platty setup --json` |
| Static analysis | In `Manage current project`, choose `Run static analysis`. | `platty status --project <project> --json` |
| Target review | In `Manage current project`, review documentation targets before generating technical docs. | `platty targets list --project <project> --json` |
| Technical docs | In `Manage current project`, choose `Generate technical docs`. | When a run id exists, `platty generate-docs status --project <project> --stage build_docs --run-id <run-id> --json` |
| EPICs | In `Manage current project`, choose `Generate EPICs` or `Confirm EPICs`. Ask before confirmation. | Stop and ask for explicit approval before `platty generate-docs confirm-epics --project <project> --run-id <run-id> --json` |
| Business docs | In `Manage current project`, choose `Generate business docs`. Inspect run state and ask before start. | When a run id exists, `platty generate-docs status --project <project> --stage build_business_docs --run-id <run-id> --json` |
| Sync | In `Manage current project`, choose `Sync generated outputs`. | `platty sync static-map --project <project> --json` |

## Worker Metrics Note

For `generate-docs agent-submit`, prefer `--usage-source provider_usage`,
`estimated`, or `unknown` over legacy `--token-source`.

If provider usage is available, also pass:

- `--provider`
- `--model`
- `--cache-creation-tokens`
- `--cache-read-tokens`
- `--cost-usd`
- `--cost-source`

Do not require a DB migration for metrics. Platty reads both v1
`metricsJson.tokens` and v2 `generation-task-metrics.v2`.

## Handoff

End setup with the `Platty handoff` card. The `State` line must include the
selected project and registered repository count from JSON. The `Recommended
next` line should normally be:

```text
Recommended next: <state-derived command or bare platty setup for a human>
```
