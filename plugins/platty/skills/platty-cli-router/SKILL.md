---
name: platty-cli-router
description: Use when deciding which Platty CLI root command, project workflow, repository workflow, analysis workflow, document workflow, or Platty skill should handle a request.
---

# Platty CLI Router

Use this before choosing a Platty command when the user asks what to run next or asks broadly about Platty CLI workflows.

## Default Order

```text
setup -> analyze -> sync run
```

When project context is missing, route to `platty-setup` first. The user must
create or select a project before registering repositories, and repositories
must be registered inside that selected project.

## Root Commands

Local, MCP-free retrieval and search over the exported SOT projection belongs to
`platty-retrieval`: reading `~/.platty/sot/<projectId>/`, `platty sot
resolve/glossary search`, `platty graph trace`, and `platty code search/snippet`.
Route "find/what/where/how does it work/search the codebase" questions there.

Remote read-only MCP retrieval is different: it belongs to the separate
`platty-mcp` plugin. Do not route MCP workflows through this operator router.
Context-backend server setup, host/port exposure, and `/api/mcp` validation stay
in `platty-mcp-server-setup`.

| Need | Command or skill |
| --- | --- |
| Answer a question about the analyzed codebase locally (domain terms, epics, docs, specs, code locations, source confirmation) | `platty-retrieval` (read SOT projection + `platty sot resolve/glossary search`, `graph trace`, `code search/snippet`) |
| Install or refresh ordinary Platty agent skills (non-MCP agent plugin) | `platty install --json`; restart the agent session after success; MCP installation stays separate |
| Installed first end-to-end project journey through repositories, analysis, LLM approval, and SOT output | `platty-onboarding` |
| Initialize global Platty home (`~/.platty` or `PLATTY_HOME`) | `platty init` via `platty-setup` |
| Create/select a project | `platty project ...` via `platty-setup` |
| Register repositories | `platty repo ...` via `platty-setup` |
| Define or import reviewed Git/Gitless customer ZIP or monorepo source boundaries | `platty-repository-scope` |
| Manage environment-variable URLs and connection bindings (create, get, list, update, delete, import, export) | `platty-connection-bindings` |
| Register or check an approved remote database source | `platty-database-source-check` |
| Ask "what next?" | Human: `platty setup`; agent: `platty setup --json` or `platty status --json` via `platty-setup` |
| Run static analysis | `platty analyze --project <project> --json` via `platty-static-analysis` |
| Compare expected routes/relations against static-analysis evidence | `platty-evidence-audit` |
| Capture a static-analysis failure for diagnosis without changing code | `platty-analysis-triage` |
| Add, replace, suppress, retire, or restore a Service Map edge between existing nodes | `platty graph edge add\|replace\|suppress\|update\|retire\|restore --project <project> --json` via `platty-analysis-corrections` |
| Add evidence the analyzer missed (entry_add, relation_add, edge_add, node_add) | `platty graph supplement import\|confirm\|retire\|status --project <project> --json` via `platty-analysis-corrections` |
| Inspect/cancel pipeline runs | `platty runs ... --json` via `platty-static-analysis` |
| Automatically generate or refresh technical, EPIC, and business outputs | `platty sync run --project <project> --json` via `platty-sync` |
| Check active generated-docs stage status | `platty generate-docs status --project <project> --stage <stage> --run-id <run-id> --json` via `platty-generated-docs` |
| Recover failed generated docs | Inspect/recover through `platty-generated-docs`; use `retry-failed` for the failed `build_docs`, `build_epics`, or `build_business_docs` stage |
| Correct a generated Claim or summary of a technical doc | `platty claims read\|edit\|delete\|add\|summary\|confirm\|retire --project <project> --json` via `platty-generated-docs` |
| Rename, re-summarize, move, split, merge, or delete published EPICs and domains (advanced) | `platty epics head` then `platty epics revise --project <project> --base <publicationRevision> --input <file> --reason <why> --json` via `platty-generated-docs` |
| Regenerate business docs of selected EPICs after corrections | `platty generate-docs run --project <project> --business-docs-only --epic <epic-id> --json` via `platty-generated-docs` |
| Retry only Business Docs units that ended without a current document | `platty generate-docs run --project <project> --business-docs-only --retry-issues [--dry-run] [--precheck] --json` via `platty-generated-docs` |
| Retry failed generated-docs tasks | `platty generate-docs retry-failed --project <project> --stage <stage> --run-id <run-id> --json` via `platty-generated-docs` |
| Configure or troubleshoot context-backend MCP server | `platty-mcp-server-setup` via `using-platty` |
| Continue despite failed docs | Explain repair-first policy via `platty-generated-docs`; do not invent `--force` |
| Inspect an automatic-sync plan before execution | `platty sync prepare --project <project> --json` via `platty-sync` |
| Turn a rough idea into prd.md and user_stories.md | `platty-sdd-spec` |
| Create system_design.md and tasks.md from approved SDD docs | `platty-sdd-design` |
| Record/update/remove human knowledge on epics or docs | `platty memory ... --json` via `platty-memory` |
| Uninstall or reset local Platty state | `platty uninstall --json`; use `--yes` only with explicit confirmation |

## Invariants

```text
1. If CLI output includes `nextCommand` or `nextAction.command` at the top
   level or under `data`, that command is the next step unless a gate says to
   pause. Gate precedence overrides returned commands for malformed or missing
   failed generated-docs
   recovery, active generated-output work before sync, or recovery that must
   preserve an existing run.
2. Preserve returned command arguments verbatim. Never reconstruct a public
   `generate-docs run` command by carrying forward stage, run-id, provider,
   model, worker, or other execution flags; its runtime policy owns those
   values. Use an exact returned recovery command, or stop and report a
   missing command instead of guessing.
3. Static analysis no longer has a public `confirm` step. Compatibility note:
   if a global CLI asks for compatibility recovery command `platty confirm`, treat it as stale and ask for CLI
   reinstall or update of the global @paradigmshift/platty package.
4. The filesystem state root is the global Platty home, not cwd and not the
   repository path. The CLI config field `projectRoot` names that state root.
5. `project use` selects the current Platty project context. It is not a
   separate workflow skill; route it through `platty-setup`.
6. Do not invent confirmation gates. The normal generated-output path is
   `platty sync run --project <project> --json`, which creates a fresh plan and
   completes technical, EPIC, and business stages automatically. `sync prepare`
   is only an optional inspection command.
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
