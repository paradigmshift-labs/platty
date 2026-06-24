---
name: platty-cli-router
description: Use when deciding which Platty CLI root command, project workflow, repository workflow, analysis workflow, document workflow, search/retrieval workflow, or Platty skill should handle a request.
---

# Platty CLI Router

Use this before choosing a Platty command when the user asks what to run next or asks broadly about Platty CLI workflows.

## Default Order

```text
setup -> analyze -> targets -> generate-docs
```

When project context is missing, route to `platty-setup` first. The user must
create or select a project before registering repositories, and repositories
must be registered inside that selected project.

## Root Commands

| Need | Command or skill |
| --- | --- |
| Initialize global Platty home (`~/.platty` or `PLATTY_HOME`) | `platty init` via `platty-setup` |
| Create/select a project | `platty project ...` via `platty-setup` |
| Register repositories | `platty repo ...` via `platty-setup` |
| Ask "what next?" | Human: `platty setup`; agent: `platty setup --json` or `platty status --json` via `platty-setup` |
| Run static analysis | `platty analyze --project <project> --json` via `platty-static-analysis` |
| Inspect/cancel pipeline runs | `platty runs ... --json` via `platty-static-analysis` |
| Curate technical targets | `platty targets ... --project <project> --json` via `platty-docs-target-curation` |
| Generated technical/product/business outputs | `platty generate-docs run --project <project> --json` via `platty-generated-docs` |
| EPIC confirmation and business-doc continuation | returned `platty generate-docs confirm-epics --project <project> --run-id <run-id> --json` via `platty-generated-docs` |
| Recover failed generated docs | Inspect/recover through `platty-generated-docs`; use `retry-failed` only for failed `build_docs` tasks |
| Retry failed build_docs tasks | `platty generate-docs retry-failed --project <project> --stage build_docs --run-id <run-id> --json` via `platty-generated-docs` |
| Continue despite failed docs | Explain repair-first policy via `platty-generated-docs`; do not invent `--force` |
| Incrementally refresh existing generated outputs after source/repository changes | `platty sync plan/run/confirm --project <project> --json` via `platty-sync` |
| Search existing docs | `platty-retrieval` |
| Turn a rough idea into request.md and stories.md | `platty-sdd-spec` |
| Create design.md and tasks.md from approved SDD docs | `platty-sdd-design` |
| Record/update/remove human knowledge on epics or docs | `platty memory ... --json` via `platty-memory` |
| Uninstall or reset local Platty state | `platty uninstall --json`; use `--yes` only with explicit confirmation |

## Invariants

```text
1. If CLI output includes `nextCommand` or `nextAction.command` at the top
   level or under `data`, that command is the next step unless a gate says to
   pause. Gate precedence overrides returned commands for malformed or missing
   EPIC confirmation commands, incomplete target review, failed `build_docs`
   recovery, active generated-output work before sync, or recovery that must
   preserve an existing run.
2. Preserve returned command arguments verbatim when possible. When
   reconstructing, carry forward `--project`, `--stage`, `--run-id`, existing
   `--provider`, and `--json` if the returned command omits them.
3. Static analysis no longer has a public `confirm` step. Compatibility note:
   if a global CLI asks for compatibility recovery command `platty confirm`, treat it as stale and ask for CLI
   reinstall or update of the global @paradigmshift/platty package.
4. The filesystem state root is the global Platty home, not cwd and not the
   repository path. The CLI config field `projectRoot` names that state root.
5. `project use` selects the current Platty project context. It is not a
   separate workflow skill; route it through `platty-setup`.
6. Do not invent confirmation gates. Target review is handled by
   `platty targets ... --project <project> --json`; generated outputs start
   with `platty generate-docs run --project <project> --json`; when the CLI
   returns a concrete `generate-docs confirm-epics` or `sync confirm` command,
   run that returned command automatically unless the user explicitly requested
   manual review.
```

## Routing UX

When choosing a route, produce a one-screen answer:

```text
Platty: routing
- Goal: <what the user is trying to do>
- Route: <skill name>
- First check: <exact platty command>
- Recommended next: <skill, nextCommand, or nextAction.command>
```

If routing stops, include a `Platty handoff` card from `using-platty` with the
exact error code or repeated `nextAction` that caused the stop.

## Stop Conditions

- Following the same `nextCommand` or `nextAction.command` twice in a row with
  no other state change: stop routing — this is a stalled loop; switch to the
  routed skill's Stop Conditions instead of re-running the command a third time.
- A command from the table fails with `UNKNOWN_COMMAND` or `UNEXPECTED_ERROR`: stop and report that the installed global CLI may be stale or the command may not exist. Reinstall or update the global @paradigmshift/platty package before continuing; do not substitute a guessed command or execution path.
- If the shell reports `command not found: platty`, run `command -v platty` once. Retry the original command once only if a binary path is returned; otherwise stop and report that the global CLI is missing from PATH.
- A command fails with `PROJECT_AMBIGUOUS` or `PROJECT_NOT_FOUND` and no `nextAction` resolves it: stop and ask the user for the project instead of guessing a selector.
