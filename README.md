# Platty Agent Plugin

This repository contains the public Platty agent plugin and skills for Codex and Claude Code.

Platty helps agents operate the Platty CLI for repository analysis, technical documentation, epic generation, business-document generation, retrieval, and human-recorded memory workflows.

## What This Repository Contains

- A Codex-compatible plugin manifest.
- A Claude Code-compatible plugin manifest.
- Platty agent skills under `plugins/platty/skills/`.
- Session-start hooks that load the Platty entry skill.
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
command -v platty
platty version
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
command -v platty
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

After installing or updating the plugin, start a new agent session so the latest skills and hooks are loaded.

## Included Skills

The plugin includes these Platty skills:

- `platty:using-platty`
- `platty:platty-cli-router`
- `platty:platty-project-setup`
- `platty:platty-static-analysis`
- `platty:platty-docs-target-curation`
- `platty:platty-docs-generation`
- `platty:platty-retrieval`
- `platty:platty-memory`
- `platty:platty-epics-generation`
- `platty:platty-business-docs-generation`
- `platty:platty-corpus-quality`

Start with `platty:using-platty` when you are not sure which workflow applies.

## Typical Workflow

Initialize Platty, create or select a project, register repositories, and ask Platty what comes next:

```bash
platty init
platty project list
platty project create "My Project" --description "Repository analysis workspace"
platty project use <project-id-or-name>
platty repo add <repository-path> --project <project>
platty status --project <project>
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
