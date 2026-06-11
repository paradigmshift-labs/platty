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
- Inside the Platty repo, prefer the local built CLI (`node packages/cli/dist/main.js <command> --json`). If the installed global `platty` returns `UNKNOWN_COMMAND` or `UNEXPECTED_ERROR` that the local build does not, the global package is stale — switch to the local build.
- Resolve the project before running project-scoped commands.
- Use `platty status --json` when the next action is unclear.
- Follow `nextAction.command` from JSON output unless there is a specific reason not to. Check both the top level and `data.nextAction` — responses place it in either spot. Re-add `--project <project>` and `--json` if the suggested command omits them.
- Do not use generation skills for retrieval-only questions.

## Stop Conditions

- The same command fails with `UNKNOWN_COMMAND` or `UNEXPECTED_ERROR` on BOTH the global `platty` binary and the local build (`node packages/cli/dist/main.js`): the command does not exist in this checkout. Stop and report it — do not invent an alternative command or flags.
- A command fails with `PROJECT_AMBIGUOUS`: stop and ask the user which project to use. Never pick one of the matches yourself.
- You routed to a skill, followed it, and ended up at the same routing decision with no CLI state change in between: stop re-routing and ask the user, citing the last `status --json` output.
