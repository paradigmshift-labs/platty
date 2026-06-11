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

## Rule

If the CLI output includes `nextAction.command`, prefer that command as the next step.
