<div align="right">

🇬🇧 English · [🇰🇷 한국어](../ko/usage-guide.md)

</div>

# Platty Usage Guide

> New to Platty? Read [How Platty Works](how-platty-works.md) first for the
> concepts. This guide is the hands-on, step-by-step manual.

---

## Table of contents

- [Requirements](#requirements)
- [No login required](#no-login-required)
- [Install the CLI](#install-the-cli)
- [Set up your AI provider](#set-up-your-ai-provider)
- [Two ways to use Platty](#two-ways-to-use-platty)
- [Output modes](#output-modes-human-vs-agent)
- [Where Platty stores data](#where-platty-stores-data)
- [Keeping docs fresh](#keeping-docs-fresh)
- [Command reference](#command-reference)
- [Troubleshooting](#troubleshooting)
- [Support](#support)
- [License](#license)

---

## Requirements

| Requirement | Supported |
| --- | --- |
| **Node.js** | **20.x – 24.x** (LTS recommended). **Node 25 is _not_ supported.** |
| **npm** | Bundled with Node. |
| **OS** | macOS, Linux. **Windows: official support is planned** — it may work today but you can hit issues. |
| **Git** | Required — Platty registers and analyzes local Git repositories. |
| **AI provider** | Required for documentation generation — see [below](#set-up-your-ai-provider). |

> ⚠️ **Node version policy:** Platty targets Node **20 through 24**. Node 25 is
> not supported yet — use an active LTS line (20 or 22). If you manage multiple
> Node versions, `nvm install 22 && nvm use 22` is a safe choice.

```bash
node --version   # must be >=20 and <25
npm --version
```

---

## No login required

Platty runs entirely as a local CLI — there is **no login, no account, and no
sign-up**. Install it and run; your code is analyzed on your own machine (see
[How Platty Works](how-platty-works.md)).

The only external dependency is your own **AI provider** for the documentation
step — you bring your own credentials. Platty is proprietary software (not open
source), licensed under the
[PolyForm Internal Use License](../../LICENSE.md) for your internal use.

---

## Install the CLI

Install the published CLI globally:

```bash
npm install -g @paradigmshift/platty
```

Verify the binary:

```bash
# macOS / Linux / Git Bash
command -v platty
platty version
platty --help
```

```powershell
# Windows PowerShell
Get-Command platty
platty version
platty --help
```

---

## Set up your AI provider

Static analysis (`platty analyze`) is fully local and needs no AI provider.

The **documentation step** (`platty generate-docs`) uses an AI model to write the
docs, so you choose a provider when you run it:

| Provider (`--provider`) | What it uses |
| --- | --- |
| `claude_api` | Your own Anthropic API key. |
| `claude_code` | A local Claude Code installation. |
| `codex_cli` | A local Codex CLI installation. |
| `openai_api` | Your own OpenAI API key. |

> 🚧 **The provider list is expanding.** More AI providers will be added over
> time — the four above are what's available today.

```bash
# Generated docs default to codex_cli; pass --provider to choose another
platty generate-docs run --provider openai_api --model <model>
```

`generate-docs` defaults to `codex_cli`. API providers are explicit opt-in:
having a key does not override that default. `claude_api` reads
`ANTHROPIC_API_KEY`, while `openai_api` reads `OPENAI_API_KEY`, from the shell
environment or `~/.platty/.env`. If generation pauses for EPIC confirmation,
**keep the same `--provider` and any explicit `--model`** on the follow-up
`generate-docs confirm-epics` command.

> 💡 **About cost:** the documentation phase sends your extracted map to an AI
> model, so it consumes provider tokens and may incur cost on your AI provider
> account. The static-analysis phase does not — start on a small repository to
> gauge usage before running large projects.

### Generating documentation for large projects

Projects with a large codebase or many documentation targets may take a long
time to generate technical documents, EPICs, and business documents, and may
reach the AI provider's usage limit. Subscription-based providers such as
Claude Code may temporarily stop generation when the plan's usage limit is
reached.

You do not need to restart from the beginning. Platty saves completed work and
progress, so you can run the workflow again after provider capacity becomes
available. Completed work is preserved and generation resumes from the
remaining work. If any tasks failed, follow the recovery command provided by
Platty before continuing.

### Recovery

If a stage reports failed tasks, repair the same run with
`platty generate-docs retry-failed --stage <stage> --run-id <id>`, then re-run
`platty generate-docs run` (it resumes and re-extracts only the incomplete
work). The `generate-docs agent-next` / `agent-submit` commands are for manual
worker recovery, not the normal first run.

---

## Two ways to use Platty

There are two ways to drive Platty, and they share the same CLI and AI provider
you set up above. Pick whichever fits how you work — everything runs on your
machine either way.

- **Option A — Drive Platty with an AI agent** (easiest): install the Platty
  plugin in Codex or Claude Code, then ask in plain language.
- **Option B — Run the CLI yourself**: type the commands directly.

### Option A — Drive Platty with an AI agent

Platty ships an agent plugin for **Codex** and **Claude Code**. Once installed,
the bundled skills teach the agent the entire Platty workflow — so you describe
what you want in plain language and the agent runs the right commands, in the
right order, pausing when a human decision is needed.

**1. Install the plugin.**

```bash
platty install
```

Codex manual fallback:

```bash
codex plugin marketplace add paradigmshift-labs/platty
codex plugin add platty@platty
```

Claude Code manual fallback:

```bash
claude plugin marketplace add paradigmshift-labs/platty --scope user
claude plugin install platty@platty --scope user
```

The command installs only the ordinary `platty` plugin. Install the separate
`platty-mcp` plugin explicitly when you need MCP-only workflows.

**2. Start a new agent session** so updated skills are discovered. Codex and
Claude Code both load Platty skills natively on demand.

**3. Just ask.** For example:

> "Analyze the repository at `~/code/myapp` and generate its documentation."

The agent resolves the project, runs analysis, reviews the documentation
targets, and generates the docs — confirming with you at the steps that need a
human decision. You never have to memorize commands; the skills own the order,
the stop conditions, and recovery.

> The agent still needs the `platty` CLI installed (see
> [Install the CLI](#install-the-cli)) and an
> [AI provider](#set-up-your-ai-provider). The plugin teaches the agent *how* to
> use Platty — it doesn't replace the CLI.

### Option B — Run the CLI yourself (a worked scenario)

Prefer to drive it directly? Here is a full run. Say you have a repository at
`~/code/myapp` and you want documentation for it.

```bash
# One-time: initialize Platty's local workspace state
platty init

# Create a project — a workspace that can hold one or more repos
platty project create "My App" --description "Repository analysis workspace"
platty project use "My App"

# Register the repository you want to understand
platty repo add ~/code/myapp

# 1) Static analysis — fully local; reads the code and builds the map
platty analyze

# 2) Review what Platty found: the APIs, screens, jobs, and events it will document
platty targets list --status active

# 3) Generate the documentation (uses your AI provider)
platty generate-docs run --provider claude_api --model <model>

# Not sure what to do next? Ask Platty at any point
platty status
```

**What you get:** a searchable source-of-truth plus technical and business docs,
with every claim traceable to real code. From here you keep them fresh with
`platty sync` and query them with `platty code search` and `platty sot export`
(see below).

> Prefer a guided, interactive flow instead of typing each command? Run
> `platty setup` — it walks you through creating a project and registering a
> repository, and shows the next action each step of the way.

> A repository path is **never** a project selector. Always resolve a project
> first with `project create` / `project use` (or pass `--project <selector>`).

> 💡 **What's a Platty project?** A project is a workspace for related
> repositories and the knowledge generated from them. Create a new project for a
> new product, app, or system area; reuse an existing one when the repository
> already belongs to registered work; add several repositories to one project
> when they form a single architecture.

---

## Output modes (human vs. agent)

Platty has two output modes:

- **Human mode (default)** — concise summaries with a `Next:` hint when a
  follow-up command is known.
- **Agent / JSON mode (`--json`)** — machine-readable output. Automation,
  scripts, and AI agents should pass `--json` and read `data`, `nextAction`,
  `warnings`, `errors`, and `evidenceRefs`.

The CLI owns the current state and the next action: most commands return a
`Next:` hint (or `nextCommand` / `nextAction.command` in JSON). Following those
returned commands is the intended way to drive Platty — the agent skills simply
automate it.

```bash
platty status
platty status --json
```

> Don't parse the default human output in automation — its wording can change
> between releases. **The JSON shape is the stable contract.**

---

## Where Platty stores data

Platty keeps its state in a user-global Platty home, **not** inside the analyzed
repository.

| What | Default location | Override |
| --- | --- | --- |
| Platty home | `~/.platty` (macOS/Linux) · `%APPDATA%\Platty` (Windows) | `PLATTY_HOME` |
| Database (SQLite) | `~/.platty/platty.db` | `PLATTY_DB_PATH` |
| Analysis worktrees | `~/.platty/worktrees/` | `PLATTY_WORKTREE_ROOT` |
| SOT export | `~/.platty/sot/<projectId>/` | `--out <path>` |

The CLI config field `projectRoot` refers to this state root, not to a repo being
analyzed. Repositories are registered separately with `platty repo add`.

---

## Keeping docs fresh

After your code changes, refresh the docs incrementally instead of regenerating
everything:

```bash
platty sync static-map               # refresh the static snapshot
platty sync plan                     # plan an incremental doc update
platty sync run --plan-id <plan-id>  # apply the doc sync
```

### Searching the result

```bash
platty code search --symbol "createCheckoutSession"
platty sot export                    # project the SOT to a Markdown tree for grep/read
```

---

## Command reference

Every command accepts `--json` (machine output) and `--project <selector>`
(project id, name, slug, or `current`).

### Project & repository

| Command | Purpose |
| --- | --- |
| `platty project create <name> [--description <text>]` | Create a project. |
| `platty project list` | List projects and show the current one. |
| `platty project use <selector>` | Set the current project. |
| `platty project remove <selector> --confirm <name>` | Remove a project. |
| `platty repo add <path> [--name <n>] [--branch <b>] [--source-root <p>]` | Register a local Git repo. |
| `platty repo list` | List repos in the current project. |
| `platty repo update <selector> [...]` | Update repo settings. |
| `platty repo remove <selector>` | Remove a repo. |

### Setup & analysis

| Command | Purpose |
| --- | --- |
| `platty setup` | Guided interactive setup (human-friendly). |
| `platty init [--root <path>]` | Initialize Platty workspace state. |
| `platty analyze [--from <stage>] [--step-only]` | Run the static-analysis pipeline (local). |
| `platty status` | Inspect analysis status and the recommended next action. |

`analyze --from <stage>` resumes from: `analyze_repo`, `build_graph`,
`build_pattern_profile`, `build_models`, `build_route`, `build_relations`,
`build_service_map`.

### Documentation

| Command | Purpose |
| --- | --- |
| `platty targets list [--kind api\|screen\|job\|event\|all] [--status active\|deprecated\|all]` | List documentation targets. |
| `platty targets deprecate --ids <id,id>` | Deprecate targets and rebuild the service map. |
| `platty targets include --ids <id,id>` | Restore deprecated targets. |
| `platty generate-docs run [--from <stage>] [--provider <p>] [--model <m>]` | Run the doc pipeline (technical docs → EPICs → business docs). |
| `platty generate-docs confirm-epics --run-id <id>` | Confirm the EPIC draft and run business docs. |
| `platty generate-docs status --run-id <id>` | Inspect a doc run/stage. |
| `platty generate-docs retry-failed --run-id <id>` | Reset failed tasks for recovery. |
| `platty generate-docs report --run-id <id>` | Report elapsed time, tokens, and failures. |

### Sync

| Command | Purpose |
| --- | --- |
| `platty sync static-map` | Refresh the canonical static-map snapshot. |
| `platty sync plan` | Create a document sync plan from snapshots. |
| `platty sync run [--plan-id <id>]` | Run an incremental docs sync. |
| `platty sync confirm --plan-id <id> --epics-run-id <id>` | Confirm and apply the sync. |

### Retrieval, graph & SOT

| Command | Purpose |
| --- | --- |
| `platty code search --symbol <query> [--repo <id>] [--limit <n>]` | Search code nodes by name/path/signature. |
| `platty code snippet --repo <id> --file <path> --lines <start>-<end>` | Read a bounded source slice. |
| `platty graph view [--out <path>]` | Build a standalone project-graph HTML view. |
| `platty graph trace --from <node-id> [--direction downstream\|upstream] [--depth <n>]` | Trace service-map edges from a node. |
| `platty sot export [--out <path>]` | Project the SOT into a Markdown folder tree. |

### Knowledge / memory

| Command | Purpose |
| --- | --- |
| `platty memory add --content <text> --kind <why\|correction\|constraint\|context>` | Record human knowledge anchored to a doc/EPIC. |
| `platty memory list` / `show --memory <id>` / `update --memory <id> --reason <text>` / `delete --memory <id> --reason <text>` | Manage memories. |
| `platty memory questions list` / `answer --id <id> --content <text>` / `dismiss --id <id> --reason <text>` | Resolve knowledge gaps. |

### Runs & utility

| Command | Purpose |
| --- | --- |
| `platty runs list` / `show` / `status` / `cancel` / `release` | Inspect and manage pipeline runs and locks. |
| `platty version` | Show CLI version. |
| `platty uninstall` | Show uninstall steps and optionally remove state. |

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `command not found: platty` | Confirm the global install (`command -v platty`). Reinstall with `npm install -g @paradigmshift/platty`. |
| `UNKNOWN_COMMAND` for a command that should exist | The installed CLI is stale — update `@paradigmshift/platty`. |
| Errors / crashes on Node 25 | Node 25 is unsupported. Switch to Node 20–24 (`nvm use 22`). |
| "A repository path is not a project selector" | Resolve a project first (`platty project use <name>`), or pass `--project <selector>`. |
| Unclear what to do next | Run `platty status --json` — it reports the recommended next action. |

Exit codes: `0` success · `1` recoverable failure (retryable) · `2`
validation/user error.

---

## Support

For licensing, billing, or feature questions, use the official Platty support
channel. [Report an issue or request support](https://github.com/paradigmshift-labs/platty/issues/new?template=platty-feedback.yml)
with:

- your runtime (and the agent runtime/version, if using one),
- your operating system,
- the output of `platty version`,
- the exact command that failed,
- the full error output.

---

## License

Platty is **proprietary** software (not open source), licensed under the
[PolyForm Internal Use License](../../LICENSE.md) for your own internal use.
Unless expressly permitted there, you may not redistribute, sublicense, sell,
host, or provide it to third parties, or use it to provide a competing product
or service.

---

## See also

- **[How Platty Works](how-platty-works.md)** — concepts, two-phase model, and
  the local-first trust model.
- **[Support Matrix](support-matrix.md)** — supported languages, frameworks,
  ORMs, HTTP clients, and SaaS vendors.
