# Platty — Agent Working Guidelines

## If You Are an AI Agent

Read this before running Platty commands or building the CLI in this repo.

Platty is a private (`UNLICENSED`) npm-workspaces monorepo: an analysis engine (`packages/core`), a TypeScript API client (`packages/sdk`), and the publishable `platty` CLI (`packages/cli`). The agent-facing surface is a set of skills under `agent-marketplace/plugins/platty/skills/`.

## Iron Rules

```text
1. INSIDE THIS REPO, run the CLI through the local build, never the global binary:
     node packages/cli/dist/main.js <command> --json
   The global `platty` (@pshift/platty) is a published bundle and goes stale the
   moment you edit source. It will NOT reflect your changes. The local build does.

2. Prefer --json on every CLI command so output can be inspected precisely.

3. Resolve the project before project-scoped commands. A repository path is
   NEVER a project selector — resolve <project> from `project list/create/use`
   JSON output.
```

## Map of the Repo

| Path | What it is |
| --- | --- |
| `packages/core` | Private analysis engine. Must not import cli/sdk/backend/web code. Owns the DB, pipeline, tree-sitter grammars (wasm). |
| `packages/cli` | The `platty` command. Imports `@platty/core`. Build output in `dist/`; publishable bundle in `release/`. |
| `packages/sdk` | TypeScript HTTP API client (private). |
| `apps/backend` | NestJS API server (independent of CLI publishing; its build can fail on stale Prisma client without affecting the CLI). |
| `agent-marketplace/plugins/platty/skills/` | The 10 Platty agent skills (using-platty, cli-router, project-setup, static-analysis, docs-target-curation, docs-generation, retrieval, epics-generation, business-docs-generation, corpus-quality). |
| `docs/` | Architecture, plans, specs, skill-eval reports. |

## Building & Running the CLI

```bash
# Build the CLI workspace (tsc -b for core+sdk+cli, then wasm copy):
cd packages/cli && npm run build

# Build the publishable, obfuscated, single-file bundle (release/main.js):
cd packages/cli && npm run build:release

# Package a shareable tarball (no npm publish needed — hand the .tgz to a user):
cd packages/cli && npm pack        # -> pshift-platty-0.1.0.tgz

# Install that tarball globally on another machine (Node >= 20):
npm install -g ./pshift-platty-0.1.0.tgz
```

The release bundle inlines `@platty/core` and is identifier-mangled + string-encoded (esbuild + javascript-obfuscator). Third-party packages (better-sqlite3, tree-sitter*, zod, …) stay external and install from the registry. tree-sitter grammar `.wasm` files ship in `release/wasm/` beside the bundle. Do not commit `*.tgz`.

> Root `npm run build` also builds `apps/backend`, which can fail on a stale Prisma client (`prisma generate` needed). That failure is unrelated to the CLI — build the CLI workspace directly when you only need `platty`.

## Working on Skills

The skills are behavior-shaping documents, not prose. They use the Superpowers writing-skills discipline:

- Edit a skill only with a failing test (baseline pressure scenario) first — see `superpowers:writing-skills`.
- Do not weaken Stop Conditions, Red Flags tables, or Invariants without baseline evidence that the change is an improvement.
- CLI-bug workarounds in skills carry a `[Fx workaround — remove when …]` tag. When the underlying CLI bug (see `docs/`/memory backlog) is fixed in code, reclaim the tagged rule.
- `agent-marketplace/` is generated/checked by `scripts/package-agent-marketplace.mjs` and `scripts/sync-agent-skills.mjs`. Run `npm run check:agent-skills` / `npm run check:agent-marketplace` after skill edits.

## Plugin Installation (Claude Code & Codex)

This repo ships the skills as a local plugin for both runtimes:

- Claude Code: marketplace `agent-marketplace/.claude-plugin/marketplace.json`, plugin `.../plugins/platty/.claude-plugin/plugin.json`. Install with `/plugin marketplace add <abs path to agent-marketplace>` then `/plugin install platty@platty`.
- Codex: marketplace `agent-marketplace/.agents/plugins/marketplace.json`, plugin `.../.codex-plugin/plugin.json`.

Both inject the `using-platty` skill at session start via the hooks in `plugins/platty/hooks/`. The plugin teaches agents HOW to drive the CLI — it still needs the `platty` CLI itself installed (or the local build) to actually run anything.

## Runtime Neutrality

Platty skills are runtime-neutral: Codex and Claude Code are equal, first-class runtimes. Use whichever runtime the user is already in; do not switch runtimes to follow a skill. Runtime-specific tool names map through `skills/using-platty/references/{claude-code,codex}-tools.md`.
