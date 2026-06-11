---
name: platty-cli-router
description: Use when deciding which Platty CLI root command, project workflow, analysis workflow, document workflow, or Platty skill should handle a user request.
---

# Platty CLI Router

Use this before choosing a Platty command when the user asks what to run next or asks broadly about Platty CLI workflows.

## Default Order

```text
init -> project -> repo -> status -> run -> confirm -> status -> docs or epics or business-docs
```

When project context is missing, route to `platty-project-setup` first. The user
must create or select a project before registering repositories, and repositories
must be registered inside that selected project.

## Root Commands

| Need | Command or skill |
| --- | --- |
| Initialize global Platty home (`~/.platty` or `PLATTY_HOME`) | `platty init` via `platty-project-setup` |
| Create/select a project | `platty project ...` via `platty-project-setup` |
| Register repositories | `platty repo ...` via `platty-project-setup` |
| Ask "what next?" | `platty status --json` via `platty-static-analysis` |
| Run static analysis | `platty run --json` via `platty-static-analysis` |
| Approve static gate | `platty confirm --json` via `platty-static-analysis` |
| Inspect/cancel pipeline runs | `platty runs ... --json` via `platty-static-analysis` |
| Curate technical targets | `platty docs targets ... --json` via `platty-docs-target-curation` |
| Generate technical docs | `platty-docs-generation` |
| Search existing docs | `platty-retrieval` |
| Generate epics | `platty-epics-generation` |
| Generate business docs | `platty-business-docs-generation` |
| Check fixture corpus | `platty-corpus-quality` |
| Uninstall or reset local Platty state | `platty uninstall --json`; use `--yes` only with explicit confirmation |

## Invariants

```text
1. If the CLI output includes nextAction.command (top level or data.nextAction),
   that command IS the next step. Do not substitute a command you prefer.
2. Re-attach --project <project> and --json when nextAction.command omits them
   (e.g. confirm_required suggests bare "platty confirm").
   [F5 workaround — remove when nextAction emits both flags itself]
3. The filesystem state root is the global Platty home, not cwd and not the
   repository path. The CLI config field `projectRoot` names that state root.
4. `project use` selects the current Platty project context. It is not a
   separate workflow skill; route it through `platty-project-setup`.
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
- A command fails with `PROJECT_AMBIGUOUS` or `PROJECT_NOT_FOUND` and no `nextAction` resolves it: stop and ask the user for the project instead of guessing a selector.
