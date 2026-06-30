# Platty Agent Plugin

This repository contains the public Platty agent plugin and skills for Codex and Claude Code.

Platty helps agents operate the Platty CLI for repository analysis, target review, generated documentation/business-output workflows, synchronization, retrieval, and human-recorded memory workflows.

## What This Repository Contains

- A Codex-compatible plugin manifest.
- A Claude Code-compatible plugin manifest.
- Platty agent skills under `plugins/platty/skills/`.
- Claude Code session-start hooks that load the Platty entry skill. Codex uses native skill loading without plugin hooks.
- Marketplace metadata for installing the plugin from this repository.

## What This Repository Does Not Contain

This repository does not include the Platty engine, CLI implementation, backend, SaaS service, release build pipeline, internal test suite, or private product planning documents.

Those components are proprietary to Paradigm Shift Labs. This repository is the public distribution surface for the agent plugin only.

## Access

Platty runs as a local CLI with **no login, account, or sign-up required** — install it and run. The plugin simply teaches your agent how to drive that CLI; you also need the `platty` CLI installed and your own AI provider credentials for the documentation step.

Platty is proprietary software (not open source); installation and use are governed by `LICENSE.md`. The plugin does not by itself grant access to private projects or any repository data.

## Requirements

- Node.js 20 or newer.
- npm.
- The `platty` CLI installed and available on `PATH`.
- Codex or Claude Code with plugin support.

Check your local environment:

```bash
node --version
npm --version
platty version
```

To confirm the global binary is on `PATH`, use the command for your shell:

```bash
# macOS, Linux, or Git Bash
command -v platty
```

```powershell
# PowerShell
Get-Command platty
```

```cmd
:: Command Prompt
where platty
```

New to Platty? Start with [GETTING_STARTED.md](GETTING_STARTED.md). It walks
through CLI installation, agent plugin installation, and your first Platty
project.

## Install The Platty CLI

When the public npm package is available:

```bash
npm install -g @paradigmshift/platty
```

Verify the global binary:

```bash
# macOS, Linux, or Git Bash
command -v platty
```

```powershell
# PowerShell
Get-Command platty
```

```cmd
:: Command Prompt
where platty
```

Then run:

```bash
platty version
platty --help
```

## Install The Agent Plugin

For Codex:

```bash
codex plugin marketplace add paradigmshift-labs/platty
codex plugin add platty@platty
```

For Claude Code:

```text
/plugin marketplace add paradigmshift-labs/platty
/plugin install platty@platty
```

After installing or updating the plugin, start a new agent session so the latest skills are loaded. Claude Code also loads the latest hook.

## Included Skills

The plugin includes these Platty skills:

- `platty:using-platty`
- `platty:platty-cli-router`
- `platty:platty-setup`
- `platty:platty-static-analysis`
- `platty:platty-docs-target-curation`
- `platty:platty-generated-docs`
- `platty:platty-sync`
- `platty:platty-retrieval`
- `platty:platty-sdd-spec`
- `platty:platty-sdd-design`
- `platty:platty-memory`

Start with `platty:using-platty` when you are not sure which workflow applies.

## Documentation

Full product documentation lives in the [`guide/`](guide/) folder, in English
and Korean:

| Topic | English | 한국어 |
| --- | --- | --- |
| How Platty works (concepts, local-first, why you can trust it) | [EN](guide/en/how-platty-works.md) | [KO](guide/ko/how-platty-works.md) |
| Usage guide (install, agent or CLI usage, commands) | [EN](guide/en/usage-guide.md) | [KO](guide/ko/usage-guide.md) |
| Support matrix (languages, frameworks, ORMs, vendors) | [EN](guide/en/support-matrix.md) | [KO](guide/ko/support-matrix.md) |

## Recommended First Run

From the repository you want Platty to analyze, run:

```bash
platty setup
```

`platty setup` helps you choose or create a Platty project, register
repositories, inspect current progress, and see the next action.

Use plain `platty setup` for human-guided setup.

Use JSON output when an agent, script, or automation needs to inspect CLI state exactly,
for example `platty setup --json`.

## Workflow

Most users should start with `platty setup`.

The full Platty workflow is:

```text
setup -> analyze -> targets -> generate-docs
```

The CLI shows the next action based on project state. The agent plugin skills
explain when to continue, auto-confirm EPICs through returned CLI commands,
refresh existing generated outputs after source changes, or recover from a
failed run.

## Generated Docs Providers

Generated docs use Codex CLI by default:

```bash
platty generate-docs run --project PROJECT --json
```

You can choose another provider when starting generation:

```bash
platty generate-docs run --project PROJECT --provider claude_api --json
```

If generation reaches EPIC confirmation, preserve the same provider when running
the returned confirmation command:

```bash
platty generate-docs confirm-epics --project PROJECT --run-id RUN --provider claude_api --json
```

Supported providers are `codex_cli`, `claude_code`, and `claude_api`.
`claude_api` requires `ANTHROPIC_API_KEY` in your shell environment or
`~/.platty/.env`.

For advanced recovery, if `build_docs` failed, repair the same run with
`platty generate-docs retry-failed --project PROJECT --stage build_docs --run-id RUN`,
then follow the returned `nextCommand` or `nextAction.command`.
Commands such as `generate-docs agent-next` and `generate-docs agent-submit`
are for manual worker recovery flows, not the normal first-run path.

## Choose A Platty Project

A Platty project is a workspace for related repositories and generated
knowledge.

Create a new project for a new product, app, customer workspace, or system area.
Reuse an existing project when the repository already belongs to registered
work. Add multiple repositories to the same project when they are part of one
architecture.

## Manual Setup

If you prefer explicit commands, initialize Platty, create or select a project,
register repositories, and ask Platty what comes next:

```bash
platty init
platty project list
platty project create "My Project" --description "Repository analysis workspace"
platty project use PROJECT
platty repo add REPOSITORY_PATH --project PROJECT
platty status --project PROJECT
```

Follow the `Next:` line returned by `platty status` or by the previous command response.

## Repository Layout

```text
.agents/plugins/marketplace.json
.claude-plugin/marketplace.json
plugins/platty/
  .codex-plugin/plugin.json
  .claude-plugin/plugin.json
  README.md
  hooks/
  skills/
```

The `plugins/platty/README.md` file contains the detailed CLI workflow guide used by the plugin.

## License And Use

This repository is source-available for installation and review. It is not an open-source license grant.

Use of the Platty agent plugin is governed by `LICENSE.md` and the Platty Terms of Service. Unless expressly permitted there, you may not redistribute, sublicense, sell, host, or provide this plugin to third parties, or use it to provide a competing product or service.

Suggested package metadata:

```json
{
  "license": "SEE LICENSE IN LICENSE.md"
}
```

## Support

For licensing, billing, or feature questions, use the official Platty support channel.

For plugin installation issues, include:

- your agent runtime and version,
- your operating system,
- the output of `platty version`,
- the exact command that failed,
- the full error output when available.
