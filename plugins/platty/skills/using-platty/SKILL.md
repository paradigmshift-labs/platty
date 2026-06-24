---
name: using-platty
description: Use when any request is about Platty, the Platty CLI, Platty agent skills, project or repository setup, repo/project analysis, static analysis, generated docs, retrieval/search over Platty outputs, epics, business docs, memory, sync, or choosing the right Platty workflow across Codex and Claude Code.
---

# Using Platty Skills

Use this skill as the entry point for Platty CLI and documentation workflows.

## Tool Mapping

Platty skills are runtime-neutral. Codex and Claude Code are equal, first-class execution runtimes — use whichever runtime the user is already working in, and do not switch runtimes to follow a skill.

Skill bodies use runtime-neutral actions such as "read a file", "search files", "run Platty CLI", "track multi-step work", and "dispatch a worker". Runtime-neutral actions keep the shared catalog usable across Codex and Claude Code.

When a runtime-specific tool name appears, translate it through the mapping for the runtime you are working in:

- Codex: `references/codex-tools.md`
- Claude Code: `references/claude-code-tools.md`

Both mappings cover the same set of Platty actions. The runtimes differ only in tool surface, not in the Platty CLI command order, JSON inspection rules, approval gates, or document-generation safety rules — keep those identical across runtimes.

## Skill Router

Use `platty-cli-router` when deciding which Platty root command or skill applies.

Common routes:

- Human setup workflow and project management dashboard state: `platty-setup`
- Static analysis progress: `platty-static-analysis`
- Technical docs target review: `platty-docs-target-curation`
- Generated technical/product/business outputs: `platty-generated-docs`
- Generated output synchronization: `platty-sync`
- Existing docs search or answers: `platty-retrieval`
- SDD product spec and user stories from an idea: `platty-sdd-spec`
- SDD technical design and tasks from approved spec/stories: `platty-sdd-design`
- Recording or maintaining human knowledge (why, corrections, constraints) on epics or documents: `platty-memory`
- Fixture corpus quality work: `platty-corpus-quality`

## Core Rules

- Prefer `--json` for CLI commands so results can be inspected precisely.
- Start with bare `platty setup` for human-guided project management. Use
  `Manage current project` to inspect repository, analysis, docs, EPIC,
  business-doc, sync, and active-job state before choosing a workflow action.
  For agents, inspect with `platty setup --json` or
  `platty status --project <project> --json`, then explain the next action in
  plain language. Do not ask users to run `--json` unless debugging
  machine-readable output.
- Treat public README workflow text as orientation, not as a static command
  checklist. The CLI owns current state and next-action hints; routed Platty
  skills own exact command selection, approval gates, stop conditions, and
  recovery rules.
- Platty CLI state lives in the user-global Platty home by default (`~/.platty`
  on macOS/Linux, `%APPDATA%\Platty` on Windows). `PLATTY_HOME` overrides that
  location. The CLI config field `projectRoot` refers to this state root, not to
  an analyzed repository.
- Use the installed global `platty` binary for Platty workflows. If the binary is missing or appears stale (`UNKNOWN_COMMAND` or `UNEXPECTED_ERROR` for a command that should exist), stop and report that the global @pshift/platty package needs to be reinstalled or updated. Keep the workflow on the global CLI.
  Inside the private source checkout, maintainer verification uses the local
  build, not the global binary:

  ```bash
  node packages/cli/dist/main.js <command> --json
  ```

  Public/plugin workflow examples still use the installed global `platty`
  binary.
- If the shell reports `command not found: platty`, check command resolution once with `command -v platty`. If it returns a path, treat it as a transient shell/PATH issue and retry the original Platty command once. If it returns nothing, stop and report the missing global CLI.
- Resolve the project before running project-scoped commands.
- Use `platty status --json` when the next action is unclear.
- Follow `nextCommand` or `nextAction.command` from JSON output unless a gate
  says to pause. Check the top level, `data.nextCommand`, and `data.nextAction`.
  Gate precedence overrides blindly following commands for EPIC approval,
  incomplete target review, failed `build_docs` recovery, active
  generated-output work before sync, or recovery that must preserve an existing
  run. Preserve returned command arguments verbatim when possible. When
  reconstructing a command, carry forward `--project`, `--stage`, `--run-id`,
  existing `--provider`, and `--json` if the suggested command omits them.
- Do not use generation skills for retrieval-only questions.

## Main-Aligned Public Workflow

For humans, describe the workflow as these stages and start with bare
`platty setup` as the project-management entry point:

```text
setup -> analyze -> targets -> generate-docs -> sync
```

`generate-docs` includes technical document generation, EPIC draft generation,
the explicit EPIC approval pause, and business-doc generation after approval.
`sync` remains a separate public workflow after generated outputs are complete.

Do not present that stage list as a required shell script. `platty setup` and
`platty status` surface the next state-derived action.

For agents, inspect state with JSON output and explain the next action in plain
language:

1. `platty setup --json` to inspect setup and current project dashboard state.
2. `platty analyze --project <project> --json` to converge static analysis.
3. `platty targets list --project <project> --json` to inspect documentation targets.
4. `platty targets deprecate --project <project> --ids <target-id> --json` to exclude unwanted targets.
5. `platty generate-docs run --project <project> --json` to run docs and EPIC generation.
6. Stop for explicit user approval when an EPIC draft is ready.
7. After approval only, run `platty generate-docs confirm-epics --project <project> --run-id <run-id> --json`.
8. `platty sync static-map --project <project> --json` to sync generated outputs after generated work is complete.

Internal compatibility commands:

Lower-level `platty run`, `platty docs`, `platty epics`, and
`platty business-docs` commands exist only for internal compatibility,
inspection, and recovery. Do not expose them as public workflows or route
normal users to them. Use them only when `platty-generated-docs` explicitly
requires a recovery action, a Platty maintainer asks for one, or repo-local
debugging requires it.

Compatibility recovery note:

Do not route workflows through the legacy static-analysis confirm root.
Compatibility recovery: if a stale global CLI asks for that legacy confirm
command, stop and tell the user to reinstall or update the global @pshift/platty package.

## Project Context Gate

Before any project-scoped command, make the project/repository sequence explicit:

1. If Platty is not initialized, run `platty init --json`.
2. If no selected project is known, run `platty project list --json`.
3. If no project exists, guide the user to create one:
   `platty project create "<name>" --description "<description>" --json`.
4. If exactly one existing project is the intended target, run
   `platty project use <project-id-or-name> --json`.
5. If multiple projects could match, ask the user which project to use. Do not
   choose one yourself.
6. After selecting a project, inspect repositories with
   `platty repo list --project <project> --json`.
7. Only then add repositories with
   `platty repo add <path> --project <project> --branch <branch> --json` when
   the intended analysis branch is known.

Branch rule:

- If the user names an analysis branch, including `main`, `master`, `develop`,
  or a feature branch, pass it through `--branch`. Do not rely on the source
  checkout being on that branch.
- If the user does not name a branch, inspect the repository's current checkout
  and default-branch candidate before `repo add`. Prefer `origin/HEAD`, then
  `main`, then `master` as the default-branch candidate.
- If the default-branch candidate differs from the current checkout, ask the
  user which branch Platty should analyze: the default branch, usually
  `main`, or the current branch. Do not register the repository until the
  branch choice is explicit.
- After the user chooses, include the chosen branch in `repo add` or
  `repo update` with `--branch <branch>`.
- `platty analyze` uses the repository registration's stored analysis branch
  and prepares an app-managed worktree from that branch. It does not repair an
  omitted branch from `repo add`.
- For an existing registration on the wrong branch, run
  `platty repo update <repo-id-or-name> --branch <branch> --project <project> --json`
  before running analysis again.

Phrase setup guidance as "create or select a project, then register repositories
inside that project." A filesystem repository path is never a project selector.
Use `platty project use` for selecting the current project context; do not create
a separate "use project" workflow unless the user is explicitly comparing or
switching between multiple projects.

## Uninstall / Reset

Use `platty uninstall --json` to inspect what would be removed and get the npm
package removal command. The command is a dry run by default. Use
`platty uninstall --yes --json` only when the user explicitly wants to remove the
Platty state root (`~/.platty` or `PLATTY_HOME`). The global npm package still
needs to be removed outside Platty with:

```bash
npm uninstall -g @pshift/platty
```

## Operator UX

Follow this communication shape for every Platty workflow. Keep it short,
consistent, and easy to scan. The user should always know what work started,
what changed, and what to do next.

CLI output is evidence, not the user experience. Do not paste raw Platty JSON or
full CLI output by default. Summarize verified CLI state in natural language:
what was checked, what that state means, and what the next user decision or
agent action is. Preserve exact project selectors, run ids, task ids, document
ids, commands, and error codes when they matter for debugging, gates, or
handoff.

Use user-facing words in progress and blocker messages. Internal queue terms may
appear in commands or JSON, but explain them in plain language:

| Internal term | User-facing phrase |
| --- | --- |
| lease / leased task | assigned task / task assignment |
| lease token | task token |
| lease expired | task assignment expired |
| lease conflict / invalid lease token | this task is no longer assigned to this worker |
| no leaseable tasks | no task is currently ready to assign |

### Start Notice

Before running commands, announce the work with this card:

```text
Platty: starting <workflow>
- Goal: <plain-language task>
- Project: <project selector or "not selected yet">
- Checking: <state to inspect first, or exact command when useful for handoff>
- Next: <one user decision or agent action expected after inspection>
```

### Progress Checkpoint

For long workflows, report only useful deltas after state-changing commands or
natural checkpoints:

```text
Platty: progress
- Done: <completed action>
- State: <plain-language summary of verified JSON fields>
- Evidence: <ids, counts, commands, or error codes inspected when useful>
- Next: <one user decision, agent action, or routed skill>
```

### Handoff Card

At pause, stop condition, completion, or context handoff, end with this card:

```text
Platty handoff
- Workflow: <task/workflow name>
- State: <plain-language summary of verified JSON fields, not a guess>
- Evidence: <commands, ids, counts, or error codes inspected; no raw JSON unless debugging>
- Recommended next: <one user decision, command, or skill>
- Blocker: <none, or plain-language blocker with exact error code in parentheses>
```

Do not bury the next action in prose. If a CLI response includes `nextAction`,
the `Recommended next` line should use that command or explain the user decision
that blocks it. Do not paste raw JSON unless the user is debugging or asks for
machine-readable evidence.

## Stop Conditions

- A command fails with `UNKNOWN_COMMAND` or `UNEXPECTED_ERROR` on the global `platty` binary: stop and tell the user to reinstall or update the global `@pshift/platty` package before continuing. Do not invent an alternative command or execution path.
- The shell reports `command not found: platty` and `command -v platty` returns no path: stop and report that the global CLI is not available in PATH.
- The shell reports `command not found: platty` but `command -v platty` returns a path: retry the same Platty command once. If the retry fails the same way, stop with the exact PATH and resolved binary path as evidence.
- A command fails with `PROJECT_AMBIGUOUS`: stop and ask the user which project to use. Never pick one of the matches yourself.
- You routed to a skill, followed it, and ended up at the same routing decision with no CLI state change in between: stop re-routing and ask the user, citing the last `status --json` output.
