# Platty Agent Plugin

This repository contains the public Platty agent plugin and skills for Codex and Claude Code.

Platty helps agents operate the Platty CLI for repository analysis, technical documentation, epic generation, business-document generation, retrieval, and human-recorded memory workflows.

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

Use of this plugin requires a Platty account. Some workflows may require an active paid plan, enabled workspace access, or a current Platty CLI installation.

The plugin teaches agents how to use Platty. It does not grant access to the Platty SaaS service, private projects, paid features, or any repository data by itself.

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
npm install -g @pshift/platty
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
- `platty:platty-docs-generation`
- `platty:platty-retrieval`
- `platty:platty-memory`
- `platty:platty-epics-generation`
- `platty:platty-business-docs-generation`
- `platty:platty-corpus-quality`

Start with `platty:using-platty` when you are not sure which workflow applies.

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
setup -> analyze -> targets -> generate-docs -> EPIC approval -> business documents -> sync
```

The CLI shows the next action based on project state. The agent plugin skills
explain when to continue, pause for approval, or recover from a failed run.

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

For account access, billing, SaaS feature availability, or plan limits, use the official Platty support channel.

For plugin installation issues, include:

- your agent runtime and version,
- your operating system,
- the output of `platty version`,
- the exact command that failed,
- the full error output when available.
