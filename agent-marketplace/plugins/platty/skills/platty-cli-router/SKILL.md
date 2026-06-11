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

## Root Commands

| Need | Command or skill |
| --- | --- |
| Initialize `.platty` config | `platty init` via `platty-project-setup` |
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

## Invariants

```text
1. If the CLI output includes nextAction.command (top level or data.nextAction),
   that command IS the next step. Do not substitute a command you prefer.
2. Re-attach --project <project> and --json when nextAction.command omits them
   (e.g. confirm_required suggests bare "platty confirm").
   [F5 workaround — remove when nextAction emits both flags itself]
```

## Stop Conditions

- Following `nextAction.command` twice in a row returns the same `nextAction` (`type`, `repoId`, `stage`) with no other state change: stop routing — this is a stalled loop; switch to `platty-static-analysis` Stop Conditions instead of re-running the command a third time.
- A command from the table fails with `UNKNOWN_COMMAND`: retry once through the local build (`node packages/cli/dist/main.js ...`); if that also fails, stop and report — do not substitute a guessed command.
- A command fails with `PROJECT_AMBIGUOUS` or `PROJECT_NOT_FOUND` and no `nextAction` resolves it: stop and ask the user for the project instead of guessing a selector.
