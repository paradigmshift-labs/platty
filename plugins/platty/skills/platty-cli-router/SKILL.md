---
name: platty-cli-router
description: Use when deciding which Platty CLI root command, project workflow, repository workflow, analysis workflow, document workflow, search/retrieval workflow, or Platty skill should handle a request.
---

# Platty CLI Router

Use this before choosing a Platty command when the user asks what to run next or asks broadly about Platty CLI workflows.

## Default Order

```text
setup -> analyze -> targets -> generate-docs -> sync
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
| EPIC approval and business-doc continuation | `platty generate-docs confirm-epics --project <project> --run-id <run-id> --json` via `platty-generated-docs` |
| Sync generated outputs | `platty sync static-map --project <project> --json` via `platty-sync` |
| Search existing docs | `platty-retrieval` |
| Record/update/remove human knowledge on epics or docs | `platty memory ... --json` via `platty-memory` |
| Check fixture corpus | `platty-corpus-quality` |
| Uninstall or reset local Platty state | `platty uninstall --json`; use `--yes` only with explicit confirmation |

## Invariants

```text
1. If the CLI output includes `nextAction.command` (top level or
   `data.nextAction`), that command is the next step unless a gate says to
   pause. Gate precedence overrides `nextAction.command` for EPIC approval,
   incomplete target review, active generated-output work before sync, or
   recovery that must preserve an existing run.
2. Re-attach `--project <project>` and `--json` when `nextAction.command`
   omits them.
3. Static analysis no longer has a public `confirm` step. Compatibility note:
   if a global CLI asks for compatibility recovery command `platty confirm`, treat it as stale and ask for CLI
   rebuild/reinstall.
4. The filesystem state root is the global Platty home, not cwd and not the
   repository path. The CLI config field `projectRoot` names that state root.
5. `project use` selects the current Platty project context. It is not a
   separate workflow skill; route it through `platty-setup`.
6. Do not invent confirmation gates. Target review is handled by
   `platty targets ... --project <project> --json`; generated outputs start
   with `platty generate-docs run --project <project> --json`; EPIC approval is
   the explicit gate before
   `platty generate-docs confirm-epics --project <project> --run-id <run-id> --json`.
```

## Routing UX

When choosing a route, produce a one-screen answer:

```text
Platty: routing
- Goal: <what the user is trying to do>
- Route: <skill name>
- First check: <exact platty command>
- Recommended next: <skill or nextAction.command>
```

If routing stops, include a `Platty handoff` card from `using-platty` with the
exact error code or repeated `nextAction` that caused the stop.

## Stop Conditions

- Following `nextAction.command` twice in a row returns the same `nextAction` (`type`, `repoId`, `stage`) with no other state change: stop routing — this is a stalled loop; switch to `platty-static-analysis` Stop Conditions instead of re-running the command a third time.
- A command from the table fails with `UNKNOWN_COMMAND` or `UNEXPECTED_ERROR`: stop and report that the installed global CLI may be stale or the command may not exist. Rebuild/reinstall the global CLI before continuing; do not substitute a guessed command or execution path.
- If the shell reports `command not found: platty`, run `command -v platty` once. Retry the original command once only if a binary path is returned; otherwise stop and report that the global CLI is missing from PATH.
- A command fails with `PROJECT_AMBIGUOUS` or `PROJECT_NOT_FOUND` and no `nextAction` resolves it: stop and ask the user for the project instead of guessing a selector.
