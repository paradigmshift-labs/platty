# Platty

**English** · [한국어](README.ko.md)

Platty is a codebase reverse-engineering engine: it reads your repository,
extracts a source-of-truth (SOT) of what the code actually does — routes, data
models, database access, API calls, events, jobs, external services — and turns
it into technical and business documentation you can search and trust.

**Proprietary (not open source) · local-first · this repo is the public Platty agent-plugin distribution surface.**

## Start here

- New to Platty? **[GETTING_STARTED.md](GETTING_STARTED.md)** — CLI install, agent-plugin install, and your first project.
- Full usage manual: **[guide/en/usage-guide.md](guide/en/usage-guide.md)** · 한국어 **[guide/ko/usage-guide.md](guide/ko/usage-guide.md)**

## What Platty does

- **Analyzes your code locally** — static analysis on your own machine; it never uploads or executes your source.
- **Extracts a source-of-truth** — a searchable map of routes, models, data access, integrations, and events, grounded in real code.
- **Generates and keeps docs fresh** — technical and business documentation, with every claim traceable back to source.

See **[guide/en/how-platty-works.md](guide/en/how-platty-works.md)** for the concepts and the local-first trust model.

## Quick install

Install the CLI (Node.js 20–24; Node 25 is not supported yet):

```bash
npm install -g @paradigmshift/platty
platty version
```

Install the agent plugin for your runtime:

```bash
# Codex
codex plugin marketplace add paradigmshift-labs/platty
codex plugin add platty@platty
```

```text
# Claude Code
/plugin marketplace add paradigmshift-labs/platty
/plugin install platty@platty
```

After installing or updating the plugin, start a new agent session so the latest
skills load. Then, from the repository you want to analyze, run:

```bash
platty setup
```

`platty setup` helps you choose or create a project, register repositories, and
shows the next action at each step. The full command reference and the agent /
CLI walkthroughs are in the [usage guide](guide/en/usage-guide.md).

## Documentation

Full product documentation lives in the [`guide/`](guide/) folder, in English
and Korean:

| Topic | English | 한국어 |
| --- | --- | --- |
| How Platty works (concepts, local-first, why you can trust it) | [EN](guide/en/how-platty-works.md) | [KO](guide/ko/how-platty-works.md) |
| Usage guide (install, AI provider, agent or CLI usage, commands) | [EN](guide/en/usage-guide.md) | [KO](guide/ko/usage-guide.md) |
| Support matrix (languages, frameworks, ORMs, vendors) | [EN](guide/en/support-matrix.md) | [KO](guide/ko/support-matrix.md) |

## This repository

This repository is the **public distribution surface for the Platty agent
plugin** — the skills that teach Codex and Claude Code how to drive the Platty
CLI.

**Contains:** Codex and Claude Code plugin manifests, the Platty skills under
`plugins/platty/skills/`, Claude Code session-start hooks, and marketplace
metadata.

**Does not contain:** the Platty engine, CLI implementation, backend, SaaS
service, or private planning docs — those are proprietary to Paradigm Shift Labs.

Included skills: `platty:using-platty`, `platty:platty-cli-router`,
`platty:platty-setup`, `platty:platty-static-analysis`,
`platty:platty-docs-target-curation`, `platty:platty-generated-docs`,
`platty:platty-sync`, `platty:platty-retrieval`, `platty:platty-sdd-spec`,
`platty:platty-sdd-design`, `platty:platty-memory`. Start with
`platty:using-platty` when you are not sure which workflow applies.

```text
.agents/plugins/marketplace.json
.claude-plugin/marketplace.json
plugins/platty/
  .codex-plugin/plugin.json
  .claude-plugin/plugin.json
  README.md
  hooks/
  skills/
guide/
```

## Requirements

- Node.js 20–24 (Node 25 is not supported yet).
- npm.
- macOS or Linux. Windows: official support is planned — it may work today but you can hit issues.
- The `platty` CLI on your `PATH`, plus Codex or Claude Code for the plugin.
- Your own AI provider credentials for the documentation step. No login, account, or sign-up is required to run Platty.

## License and support

Platty is proprietary software (not open source); installation and use are
governed by [LICENSE.md](LICENSE.md). Unless expressly permitted there, you may
not redistribute, sublicense, sell, host, or provide it to third parties, or use
it to provide a competing product or service.

For licensing, billing, or feature questions, use the official Platty support
channel. For plugin installation issues, include your agent runtime and version,
your operating system, the output of `platty version`, the exact command that
failed, and the full error output.
