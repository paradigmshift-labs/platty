---
name: using-platty
description: Use when starting Platty repository work, choosing Platty CLI skills, or operating Platty agent skills across Codex and Claude Code.
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

- New workspace/project/repo setup: `platty-project-setup`
- Static analysis progress: `platty-static-analysis`
- Technical docs target review: `platty-docs-target-curation`
- Technical docs worker authoring: `platty-docs-generation`
- Existing docs search or answers: `platty-retrieval`
- Epic generation: `platty-epics-generation`
- Business docs generation or sync: `platty-business-docs-generation`
- Fixture corpus quality work: `platty-corpus-quality`

## Core Rules

- Prefer `--json` for CLI commands so results can be inspected precisely.
- Platty CLI state lives in the user-global Platty home by default (`~/.platty`
  on macOS/Linux, `%APPDATA%\Platty` on Windows). `PLATTY_HOME` overrides that
  location. The CLI config field `projectRoot` refers to this state root, not to
  an analyzed repository.
- Use the installed global `platty` binary for Platty workflows. If the binary is missing or appears stale (`UNKNOWN_COMMAND` or `UNEXPECTED_ERROR` for a command that should exist), stop and report that the global CLI needs reinstall/rebuild. Keep the workflow on the global CLI.
- Resolve the project before running project-scoped commands.
- Use `platty status --json` when the next action is unclear.
- Follow `nextAction.command` from JSON output unless there is a specific reason not to. Check both the top level and `data.nextAction` — responses place it in either spot. Re-add `--project <project>` and `--json` if the suggested command omits them.
- Do not use generation skills for retrieval-only questions.

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
   `platty repo add <path> --project <project> --json`.

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

### Start Notice

Before running commands, announce the work with this card:

```text
Platty: starting <workflow>
- Goal: <plain-language task>
- Project: <project selector or "not selected yet">
- State root: <~/.platty or PLATTY_HOME>
- First check: <exact platty command>
```

### Progress Checkpoint

For long workflows, report only useful deltas after state-changing commands or
natural checkpoints:

```text
Platty: progress
- Done: <completed action>
- State: <status/run/task counts from JSON>
- Next: <exact next command or skill>
```

### Handoff Card

At pause, stop condition, completion, or context handoff, end with this card:

```text
Platty handoff
- Workflow: <task/workflow name>
- State: <latest verified JSON state, not a guess>
- Evidence: <commands, run ids, task ids, or document ids inspected>
- Recommended next: <one command or skill>
- Blocker: <none or exact blocker/error code>
```

Do not bury the next action in prose. If a CLI response includes `nextAction`,
the `Recommended next` line should use that command unless a Stop Condition says
not to continue.

## Stop Conditions

- A command fails with `UNKNOWN_COMMAND` or `UNEXPECTED_ERROR` on the global `platty` binary: stop and report that the installed global CLI may be stale or the command may not exist. Do not invent an alternative command or execution path.
- A command fails with `PROJECT_AMBIGUOUS`: stop and ask the user which project to use. Never pick one of the matches yourself.
- You routed to a skill, followed it, and ended up at the same routing decision with no CLI state change in between: stop re-routing and ask the user, citing the last `status --json` output.
