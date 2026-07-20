# Getting Started with Platty

This guide takes you from a fresh machine to a Platty-ready agent session.

Platty has two parts:

1. **Platty CLI** — the `platty` terminal command.
2. **Platty Agent Plugin** — skills for Codex, plus Claude Code hooks that teach agents how to use the CLI.

Install both parts before asking an agent to run Platty workflows.

## 1. Install The CLI

Install the public npm package:

```bash
npm install -g @paradigmshift/platty
```

Platty requires Node.js 20 or newer.

## 2. Verify The CLI

Confirm that your shell can find and run `platty`:

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

If your shell cannot find `platty`, the CLI is not on your `PATH`.

## 3. Install The Agent Plugin

The plugin gives your agent Platty-specific skills. It does not replace the CLI;
the global `platty` command must still be installed.

Install it into every detected Codex or Claude Code runtime:

```bash
platty install
```

Use `platty install --runtime codex` or `platty install --runtime claude` when
you want to target one runtime explicitly.

Rerun `platty install` whenever you want to update an existing Platty plugin to
the latest published skills. After installation or refresh, start a new Codex
or Claude Code session.

### Codex manual fallback

```bash
codex plugin marketplace add paradigmshift-labs/platty
codex plugin add platty@platty
```

### Claude Code manual fallback

```bash
claude plugin marketplace add paradigmshift-labs/platty --scope user
claude plugin install platty@platty --scope user
```

`platty install` installs only the ordinary `platty` plugin. The separate
`platty-mcp` plugin remains an explicit, independent installation.

## 4. Restart Your Agent Session

Open a new Codex or Claude Code session after installing or updating the plugin.
This lets updated Platty skills be discovered cleanly. Skills load on demand
when you invoke them or make a matching Platty request.

## 5. Recommended First Run

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
register a repository, and ask Platty what to do next:

```bash
platty init
platty project list
platty project create "My Project" --description "Repository analysis workspace"
platty project use PROJECT
platty repo add REPOSITORY_PATH --project PROJECT --branch main
platty status --project PROJECT
```

Use `master` instead of `main` when `master` is the repository's default branch.

Follow the `Next:` line printed by `platty status` or by the previous command.

## 6. Ask Your Agent

Once the CLI and plugin are installed, try:

```text
Use Platty to analyze this repository. Start with platty:using-platty.
```

The agent should use the Platty skills to choose the next workflow and explain
what it is doing.

## Choose The Onboarding Language

Onboarding uses your current conversation language. To choose a language
explicitly, append the instruction to the invocation. If the conversation
language is unclear, onboarding defaults to Korean.

```text
$platty:platty-onboarding . 한국어로 진행해줘
$platty:platty-onboarding . Continue in English.
```

## Troubleshooting

### `platty` is not found

Run:

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

Then reinstall if needed:

```bash
npm install -g @paradigmshift/platty
```

Then open a new terminal and try `platty version` again.

### Codex needs an update for plugin installation

If `platty install` reports `AGENT_RUNTIME_UPDATE_REQUIRED` or Codex rejects
`--json`, update Codex using its supported installation method, then retry:

```bash
codex update
platty install --runtime codex --json
```

If updating is not currently possible, use the manual fallback:

```bash
codex plugin marketplace add paradigmshift-labs/platty
codex plugin add platty@platty
```

### The agent does not mention Platty skills

Restart the agent session after installing the plugin. If it still does not load,
check the plugin installation:

```bash
codex plugin marketplace list
codex plugin list
```

### You are not sure what to run next

Run:

```bash
platty setup
```

If setup is already complete, run `platty status --project PROJECT` and follow
the printed `Next:` line.
