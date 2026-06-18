# Platty CLI Skill

Run Platty repository analysis, target review, generated documentation/business-output, sync, retrieval, and memory workflows from the terminal.

This plugin is the public agent guidance surface for the Platty CLI. It works in Codex and Claude Code; Claude Code also ships session-start hooks, while Codex uses native skill loading without plugin hooks.

## Prerequisite Check

Before using Platty, check Node.js and the global Platty CLI:

```bash
node --version
npm --version
command -v platty
platty version
platty --help
```

Platty requires Node.js 20 or newer.

## Global Install

Install the public npm package:

```bash
npm install -g @pshift/platty
```

Then verify the global binary:

```bash
command -v platty
platty version
platty --help
```

## Output And Usage Contract

People should start with the guided setup flow:

```bash
platty setup
```

`platty setup` is the human entry point for project selection, repository
registration, progress inspection, and next-action guidance.

Agents and automation may inspect setup state with `platty setup --json`, then
explain the next action plainly before continuing. The CLI owns current state
and next-action hints; the Platty skills own command routing, approval gates,
stop conditions, and recovery rules.

Do not copy internal worker commands into user-facing setup instructions. Keep
this README as a short orientation page and use the routed skills for exact
workflow commands.

## Included Skills

User-scoped plugin installs expose these skills:

```text
platty:using-platty
platty:platty-cli-router
platty:platty-setup
platty:platty-static-analysis
platty:platty-docs-target-curation
platty:platty-generated-docs
platty:platty-sync
platty:platty-retrieval
platty:platty-memory
platty:platty-corpus-quality
```

Start with `platty:using-platty`, then route through `platty:platty-cli-router` when deciding which workflow applies.

## Setup Model

Platty stores CLI state under the user-global Platty home by default:

- macOS/Linux: `~/.platty`
- Windows: `%APPDATA%\Platty`
- override: `PLATTY_HOME=/custom/platty-home`

`projectRoot` in CLI config is this Platty home/workspace root. It is not the analyzed repository root; repositories are registered separately during setup.

Use `platty:platty-setup` to create or select a project and register repositories. A filesystem repository path is never a project selector.

## Public Workflow

The public workflow stages are:

```text
setup -> analyze -> targets -> generate-docs -> sync
```

`generate-docs` includes technical docs, EPIC draft generation, the explicit
EPIC approval pause, and business-doc generation after approval. `sync` remains
a separate public workflow after generated outputs are complete.

For humans, describe this as a state-aware flow surfaced through `platty setup`.
For agents, inspect JSON and follow `nextAction.command` unless a skill-specific
gate says to pause.

Use the skills for stage-specific behavior:

- `platty:platty-setup` for global state, projects, and repositories.
- `platty:platty-static-analysis` for analysis progress and run inspection.
- `platty:platty-docs-target-curation` before generation when target scope needs review.
- `platty:platty-generated-docs` for public technical docs, EPIC draft, EPIC approval, and business-doc generation.
- `platty:platty-sync` for generated-output synchronization after generated work is complete.
- `platty:platty-retrieval` for retrieval-only questions from existing docs.
- `platty:platty-memory` for recording or maintaining human knowledge.
- `platty:platty-corpus-quality` for fixture inspection, dry runs, reports, and self-improvement candidate selection.

## References

Open only what you need:

- Entry point: `skills/using-platty/SKILL.md`
- Router: `skills/platty-cli-router/SKILL.md`
- Setup: `skills/platty-setup/SKILL.md`
- Static analysis: `skills/platty-static-analysis/SKILL.md`
- Docs target curation: `skills/platty-docs-target-curation/SKILL.md`
- Generated docs: `skills/platty-generated-docs/SKILL.md`
- Sync: `skills/platty-sync/SKILL.md`
- Retrieval: `skills/platty-retrieval/SKILL.md`
- Memory: `skills/platty-memory/SKILL.md`
- Corpus quality: `skills/platty-corpus-quality/SKILL.md`

## Guardrails

- Use the global `platty` binary by default.
- Follow the Platty skills for exact command selection and stop conditions.
- Explain internal state in user-facing language.
- Stop on ambiguous project selection and ask for the exact project.
- Do not claim generated docs, EPIC approval, business documents, or sync are complete until the relevant Platty workflow says so.
