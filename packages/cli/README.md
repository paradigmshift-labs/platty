# Platty CLI

Platty CLI provides the global `platty` command for repository analysis, technical documentation, epic, and business-document workflows.

## Requirements

- Node.js 20 or newer
- npm

Check your runtime:

```bash
node --version
npm --version
```

## Install

Install the published package when available:

```bash
npm install -g @pshift/platty
```

From a Platty checkout, build and install the release package globally:

```bash
npm run build:release --workspace @pshift/platty
npm install -g ./packages/cli
```

Verify the installed binary:

```bash
command -v platty
platty version --json
platty --help
```

## Quick Start

Platty stores CLI state in the user-global Platty home by default:

- macOS/Linux: `~/.platty`
- Windows: `%APPDATA%\Platty`
- override: `PLATTY_HOME=/custom/platty-home`

`projectRoot` in CLI config refers to this Platty home/workspace root, not to a repository being analyzed. Repositories are registered separately with `platty repo add`.

```bash
platty init --json
platty project create "My Project" --description "Repository analysis workspace" --json
platty project use <project-id-or-name> --json
platty repo add /path/to/repo --project <project> --json
platty status --project <project> --json
```

Follow `nextAction.command` from JSON responses when present. Re-add `--project <project>` and `--json` if a suggested command omits them.

## Common Commands

```bash
platty run --project <project> --json
platty confirm --project <project> --json
platty runs list --project <project> --json
platty docs targets list --project <project> --json
platty docs run --project <project> --provider codex_cli --json
platty epics run --project <project> --provider codex_cli --json
platty business-docs run --project <project> --provider codex_cli --json
platty corpus batch-report --framework <framework> --stage <stage> --json
```

## Workflow Rule

Use `platty status --project <project> --json` whenever the next step is unclear. The normal order is:

```text
init -> project -> repo -> status -> run -> confirm -> status -> docs or epics or business-docs
```
