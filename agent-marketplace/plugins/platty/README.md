# Platty CLI Skill

Run Platty repository analysis, documentation, epic, and business-document workflows from the terminal.
Treat this plugin as CLI-first automation. Prefer JSON output so agents can inspect `nextAction`, run state, task leases, and validation results precisely.

## Prerequisite Check

Before proposing commands, check Node.js and the global Platty CLI:

```bash
node --version
npm --version
command -v platty
platty version --json
platty --help
```

Platty requires Node.js 20 or newer.

## Global Install

Install the published package when it is available:

```bash
npm install -g @pshift/platty
```

If you are working from this checkout before the package is published to the npm registry, build the release artifact and install the CLI globally from the workspace package:

```bash
npm run build:release --workspace @pshift/platty
npm install -g ./packages/cli
```

Verify that the global binary is the one you will use:

```bash
command -v platty
platty version --json
platty --help
```

All examples below assume the global `platty` binary. If the global binary is
missing or stale, rebuild and reinstall the package globally before continuing:

```bash
npm run build:release --workspace @pshift/platty
npm install -g ./packages/cli
```

## Skill Path

User-scoped plugin installs expose these skills:

```text
platty:using-platty
platty:platty-cli-router
platty:platty-project-setup
platty:platty-static-analysis
platty:platty-docs-target-curation
platty:platty-docs-generation
platty:platty-retrieval
platty:platty-epics-generation
platty:platty-business-docs-generation
platty:platty-corpus-quality
```

Start with `platty:using-platty`, then route through `platty:platty-cli-router` when deciding which command or workflow applies.

## Quick Start

Initialize the user-global Platty home, create/select a project, add a repository, and ask Platty what to do next.

Platty stores CLI state under the user-global Platty home by default:

- macOS/Linux: `~/.platty`
- Windows: `%APPDATA%\Platty`
- override: `PLATTY_HOME=/custom/platty-home`

`projectRoot` in CLI config is this Platty home/workspace root. It is not the analyzed repository root; repositories are registered separately with `platty repo add`.

```bash
platty init --json
platty project create "My Project" --description "Repository analysis workspace" --json
platty project use <project-id-or-name> --json
platty repo add /path/to/repo --project <project> --json
platty status --project <project> --json
```

Then follow the `nextAction.command` returned by `status` or by the last command response.

Typical first analysis loop:

```bash
platty run --project <project> --json
platty status --project <project> --json
platty confirm --project <project> --json
platty run --project <project> --step-only --json
platty status --project <project> --json
```

## Core Workflow

1. Resolve the project.
2. Run `platty status --project <project> --json`.
3. Execute `nextAction.command` exactly when present.
4. Re-add `--project <project>` and `--json` when the suggested command omits them.
5. Re-run status after any command that changes state.
6. Route to docs, epics, business docs, or corpus skills when the status output indicates that workflow.

Minimal loop:

```bash
platty status --project <project> --json
# run result.nextAction.command or result.data.nextAction.command
platty status --project <project> --json
```

Default command order:

```text
init -> project -> repo -> status -> run -> confirm -> status -> docs or epics or business-docs
```

## When to Check Status Again

Run `platty status --project <project> --json` after:

- adding, updating, or removing repositories
- running static analysis
- confirming an analysis gate
- cancelling or resuming runs
- finishing docs, epics, or business-docs generation
- any command that returns a `nextAction`

If the same `nextAction` appears twice in a row with no state change, stop the loop and inspect the latest JSON instead of running it a third time.

## Recommended Patterns

### Project and Repository Setup

```bash
platty init --json
platty project list --json
platty project create "<name>" --description "<description>" --json
platty project use <project-id-or-name> --json
platty repo add <path> --project <project> --json
platty repo list --project <project> --json
platty status --project <project> --json
```

Use `platty:platty-project-setup` for this workflow.

### Static Analysis

```bash
platty status --project <project> --json
platty run --project <project> --json
platty confirm --project <project> --json
platty run --project <project> --step-only --json
platty runs list --project <project> --json
platty runs show --project <project> --run-id <run-id> --json
```

Use `platty:platty-static-analysis` for status, run, confirm, and run inspection.

### Technical Documentation

```bash
platty docs targets list --project <project> --json
platty docs targets list --project <project> --kind api --search "<term>" --json
platty docs targets deprecate --project <project> --ids <id,id> --note "<reason>" --json
platty docs targets include --project <project> --ids <id,id> --json
platty docs start --project <project> --json
platty docs run --project <project> --provider codex_cli --json
platty docs status --run-id <run-id> --json
```

Use `platty:platty-docs-target-curation` before generation when target scope needs review.
Use `platty:platty-docs-generation` for start, approve, worker, submit, repair, and status loops.

### Technical Document Retrieval

```bash
platty docs list --project <project> --compact --json
platty docs search "<query>" --project <project> --json
platty docs show --project <project> --document <document-id> --json
platty docs related --project <project> --document <document-id> --json
platty docs export --project <project> --out output/platty-docs.md --format markdown --json
```

Use `platty:platty-retrieval` for retrieval-only questions. Do not use generation skills when the task is only to answer from existing docs.

### Epic Generation and Retrieval

```bash
platty epics preview --project <project> --json
platty epics run --project <project> --provider codex_cli --json
platty epics status --run-id <run-id> --json
platty epics validate --run-id <run-id> --json
platty epics draft show --run-id <run-id> --json
platty epics draft confirm --run-id <run-id> --json
platty epics list --project <project> --json
platty epics search --project <project> --terms "<term>,<term>" --json
platty epics show --project <project> --epic <epic-id> --json
```

Use `platty:platty-epics-generation` for generation, draft validation, confirmation, and epic retrieval.

### Business Documents

```bash
platty business-docs preview --project <project> --json
platty business-docs run --project <project> --provider codex_cli --json
platty business-docs status --project <project> --run <run-id> --json
platty business-docs validate --project <project> --run <run-id> --json
platty business-docs review --project <project> --run <run-id> --json
platty business-docs document show --project <project> --document <document-id> --json
```

Use `platty:platty-business-docs-generation` for generation, sync, worker lease, validation, review, resume, cancel, and cleanup.

### Fixture Corpus Quality

```bash
platty corpus run-fixture --id <fixture-id> --stage <stage> --json
platty corpus batch-report --framework <framework> --stage <stage> --json
platty corpus compare --id <fixture-id> --stage <stage> --json
platty corpus gate-check --id <fixture-id> --stage <stage> --json
platty corpus next-candidate --json
platty corpus audit-queue --json
platty corpus self-improve-once --id <fixture-id> --stage <stage> --dry-run --json
```

Use `platty:platty-corpus-quality` for fixture inspection, dry runs, reports, and self-improvement candidate selection.

## Command Router

| Need | Command or skill |
| --- | --- |
| Initialize global Platty home (`~/.platty` or `PLATTY_HOME`) | `platty init --json` via `platty-project-setup` |
| Create/select a project | `platty project ... --json` via `platty-project-setup` |
| Register repositories | `platty repo ... --json` via `platty-project-setup` |
| Ask what comes next | `platty status --json` via `platty-static-analysis` |
| Run static analysis | `platty run --json` via `platty-static-analysis` |
| Approve static gate | `platty confirm --json` via `platty-static-analysis` |
| Inspect/cancel pipeline runs | `platty runs ... --json` via `platty-static-analysis` |
| Curate technical targets | `platty docs targets ... --json` via `platty-docs-target-curation` |
| Generate technical docs | `platty-docs-generation` |
| Search existing docs | `platty-retrieval` |
| Generate epics | `platty-epics-generation` |
| Generate business docs | `platty-business-docs-generation` |
| Check fixture corpus | `platty-corpus-quality` |

## References

Open only what you need:

- Entry point: `skills/using-platty/SKILL.md`
- Router: `skills/platty-cli-router/SKILL.md`
- Project setup: `skills/platty-project-setup/SKILL.md`
- Static analysis: `skills/platty-static-analysis/SKILL.md`
- Docs target curation: `skills/platty-docs-target-curation/SKILL.md`
- Docs generation: `skills/platty-docs-generation/SKILL.md`
- Retrieval: `skills/platty-retrieval/SKILL.md`
- Epics: `skills/platty-epics-generation/SKILL.md`
- Business docs: `skills/platty-business-docs-generation/SKILL.md`
- Corpus quality: `skills/platty-corpus-quality/SKILL.md`

## Guardrails

- Use the global `platty` binary by default.
- Prefer `--json` for every command an agent will inspect.
- Follow `nextAction.command` from JSON output unless there is a concrete reason not to.
- Check both top-level `nextAction` and `data.nextAction`.
- Re-add `--project <project>` and `--json` when a suggested command omits them.
- Stop on `PROJECT_AMBIGUOUS` and ask for the exact project. Do not choose from matches yourself.
- Stop when the same next action repeats with no state change.
- If the global `platty` binary appears missing or stale, stop and reinstall/rebuild the global CLI. Keep the workflow on the global CLI, and do not guess alternate commands.
- Keep worker queue state in Platty. Agents coordinate lease, context, generation, submit, repair, and status checks.
- Do not claim a docs, epics, or business-docs run is complete until the relevant status or validation command says so.
