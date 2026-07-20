---
name: platty-setup
description: Use when initializing Platty, creating/selecting/switching projects, adding/listing/managing registered repositories, inspecting setup state, or using the Platty setup workflow hub.
---

# Platty Setup

Use this for Platty setup and setup-state decisions. Platty stores CLI state in
the user-global Platty home by default (`~/.platty` on macOS/Linux,
`%APPDATA%\Platty` on Windows). `PLATTY_HOME` overrides that location. The CLI
config field named `projectRoot` refers to this Platty home/workspace root, not
to a repository being analyzed.

If setup returns `PLATTY_DB_MIGRATION_NEWER_THAN_CLI`, stop normal setup. Never
delete or repair the existing database or default Platty home. Only for a
user-authorized disposable validation run, use a fresh isolated `PLATTY_HOME`,
label it as separate test state, and preserve that same `PLATTY_HOME` for every
command and resume. Record the absolute `PLATTY_HOME` path in a durable
workflow-state or resume-note artifact outside the analyzed repository, and
repeat that `PLATTY_HOME` in every pause and handoff. Without that artifact,
report the exact path and do not promise automatic fresh-context resume.

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
technical docs -> EPIC auto-confirm -> business documents
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
continuation should run the returned `confirm-epics` command automatically
unless the user explicitly requested manual EPIC review, and business documents
that are still running must not be synced yet.

## Setup Guidance Style

For agent automation, inspect setup state with JSON output, but explain the
result as a user-friendly setup status. Setup is often the user's first Platty
experience, so do not lead with raw JSON, raw CLI output, or a list of commands.

Use these fields to populate the shared Operator UX cards from `using-platty`;
they are not a replacement card format. Setup progress and handoff messages
should still use the shared Start Notice, Progress Checkpoint, and Handoff Card
labels when those cards apply.

Setup-specific fields to include inside those cards or prose:

```text
Checked: <what setup/status state was inspected>
State: <plain-language state with concrete fields>
Next: <one decision or action>
Evidence: <only the command/id/error code needed for handoff or debugging>
```

Natural language must still be precise. Include selected project, repository
count, notable repository paths, analysis status, target-review status, run ids,
or blocker codes when those fields explain the next step.

### Setup State Patterns

No project exists:

- Say Platty needs a project workspace first.
- Ask for the project name and description needed to create one.
- Do not treat a repository path as a project selector.

Projects exist but no project is selected:

- Say a project must be selected before repositories can be registered.
- Ask which existing project to use.
- Do not treat a repository path as a project selector.

Multiple projects or ambiguous project:

- Say more than one project matches.
- Ask which project to use.
- Include `PROJECT_AMBIGUOUS` only as blocker evidence, not as the whole message.

Project selected but no repositories:

- Name the selected project when known.
- State that repository count is zero.
- Recommend registering the repository to analyze.

Repository already registered or duplicate-looking registrations:

- Summarize the registered entries.
- Ask whether to use the existing registration, update it, or add another
  repository.

Registered repository path is missing or invalid:

- Explain that the project exists but the stored repository path cannot be used.
- Recommend updating/removing the registration or selecting a valid local Git
  repository.
- Include `NOT_A_GIT_REPO`, `NOT_A_DIRECTORY`, or the exact path as evidence.

Repositories ready but analysis incomplete:

- Say project and repositories are ready.
- Explain that static analysis must run before target review and generated docs.

Analysis complete but target review pending:

- Say analysis is complete and documentation target candidates are ready.
- Explain that target review decides which screens, APIs, events, schedules, and
  data models should be documented.

EPIC confirmation pending:

- Say EPIC draft generation is complete.
- State that the returned `confirm-epics` command continues into business docs.
- Include the run id when available.
- Run the returned confirmation command unless the user explicitly requested
  manual EPIC review.

Business documents running or incomplete:

- Say generated work is still active or incomplete.
- Do not recommend sync yet.
- Recommend checking the run status or waiting for completion.

CLI failure:

- Translate the failure into plain language.
- Include the exact error code in parentheses.
- Do not paste the whole JSON response unless debugging was requested.

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
platty repo add <path> --project <project> --branch <branch> --json
platty repo list --project <project> --json
```

Use `--source-root` when only a subdirectory should be analyzed. Use `--branch`
when analysis should track a specific branch; without it, `repo add` tracks
whatever branch the repository currently has checked out.

Before choosing registrations, inspect the Git root, root manifest, workspace
declaration or metadata, and nested app or package manifests. When one Git root
has no usable root manifest or workspace declaration but contains multiple
independently analyzable nested app manifests, register the same absolute Git
repository path once per app with a distinct `--source-root` and unique display
names. Do not register application subdirectories as the repository path. Pass
an explicit `--branch` on each registration and run `repo list` before each
addition.

Branch rule:

- If the user says analysis should use `main`, the default branch, or any named
  branch, include `--branch <branch>` in `repo add`; do not assume `analyze`
  will move the source checkout.
- If the user does not name a branch, inspect the repository's current checkout
  and default-branch candidate before registering it. Prefer `origin/HEAD`,
  then `main`, then `master` as the default-branch candidate.
- If the default-branch candidate differs from the current checkout, ask the
  user which branch Platty should analyze: the default branch, usually `main`,
  or the current branch. Do not register the repository until the branch choice
  is explicit.
- After the user chooses, pass the chosen branch explicitly with
  `--branch <branch>`.
- If a repository is already registered on the wrong branch, fix the
  registration before analysis:

```bash
platty repo update <repo-id-or-name> --branch <branch> --project <project> --json
```

- `analyze` creates or refreshes the app-managed analysis worktree from the
  stored repository branch. It does not infer a new branch from the current
  shell checkout.

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
| EPICs | In `Manage current project`, choose `Generate EPICs` or `Confirm EPICs`. Auto-run returned confirmation commands unless the user requested manual review. | Run the returned `platty generate-docs confirm-epics --project <project> --run-id <run-id> --json` command |
| Business docs | In `Manage current project`, choose `Generate business docs`. Inspect run state and ask before start. | When a run id exists, `platty generate-docs status --project <project> --stage build_business_docs --run-id <run-id> --json` |
| Sync | In `Manage current project`, choose sync only after source/repository changes and fresh static analysis. | `platty sync static-map --project <project> --json`, then `sync plan` and returned `sync run` / `sync confirm` commands |

## Handoff

End setup with the `Platty handoff` card. The `State` line must include the
selected project and registered repository count from JSON. The `Recommended
next` line should normally be:

```text
Recommended next: <state-derived command or bare platty setup for a human>
```
