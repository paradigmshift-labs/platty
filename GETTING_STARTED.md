# Getting Started with Platty

This guide takes you from a fresh machine to a Platty-ready agent session.

Platty has two parts:

1. **Platty CLI** — the `platty` terminal command.
2. **Platty Agent Plugin** — skills and hooks that teach Codex or Claude Code how to use the CLI.

Install both parts before asking an agent to run Platty workflows.

## 1. Install The CLI

Install the public npm package:

```bash
npm install -g @pshift/platty
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

### Codex

```bash
codex plugin marketplace add paradigmshift-labs/platty
codex plugin add platty@platty
```

### Claude Code

```text
/plugin marketplace add paradigmshift-labs/platty
/plugin install platty@platty
```

## 4. Restart Your Agent Session

Open a new Codex or Claude Code session after installing or updating the plugin.
This lets the Platty skills and session-start hook load cleanly.

## 5. Create Your First Platty Project

Initialize Platty, create or select a project, register a repository, and ask
Platty what to do next:

```bash
platty init
platty project list
platty project create "My Project" --description "Repository analysis workspace"
platty project use <project>
platty repo add <repository-path> --project <project>
platty status --project <project>
```

Follow the `Next:` line printed by `platty status` or by the previous command.

## Important: Project vs Repository

A repository path is not a Platty project.

Create or select a Platty project first, then add repositories inside that
project with `platty repo add`.

## 6. Ask Your Agent

Once the CLI and plugin are installed, try:

```text
Use Platty to analyze this repository. Start with platty:using-platty.
```

The agent should use the Platty skills to choose the next workflow and explain
what it is doing.

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
npm install -g @pshift/platty
```

Then open a new terminal and try `platty version` again.

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
platty status --project <project>
```

Then follow the printed `Next:` line.
