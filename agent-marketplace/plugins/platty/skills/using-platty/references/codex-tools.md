# Codex Tool Mapping For Platty Skills

Codex is one of two equal Platty runtimes. Skill bodies prefer runtime-neutral actions; use this file when working in Codex and a skill needs a concrete Codex tool translation. The Claude Code equivalent lives in `claude-code-tools.md`.

| Platty skill action | Codex equivalent |
| --- | --- |
| Read a file | Use a shell command such as `sed`, `cat`, or `rg`; use native file-reading tools when available. |
| Search file contents | Use `rg` through shell. |
| Search file names | Use `rg --files` through shell. |
| Create or edit files | Use `apply_patch` for manual edits. |
| Run a shell command | Use the native Codex shell command tool from the repo root unless a narrower working directory is required. |
| Run Platty CLI | Use a shell command from the repo root and prefer `--json`. |
| Track multi-step work | Use `update_plan`. |
| Ask a concise blocking question | Send a normal assistant message. |
| Invoke a skill | Use Codex native skill loading and follow the loaded skill body. |
| Dispatch an independent worker or subagent | Use `spawn_agent` when multi-agent support is available. |
| Dispatch multiple independent workers | Use multiple `spawn_agent` calls when multi-agent support is available. |
| Wait for a worker result | Use `wait_agent`. |
| Close a completed worker | Use `close_agent` to free the worker slot. |
| Run independent local tool calls in parallel | Use `multi_tool_use.parallel` for independent developer-tool calls. |
| Inspect or test a local browser UI | Use the Browser plugin or the Playwright skill when the task calls for browser automation. |
| Fetch current or external information | Use web tools when the user asks for current information, external pages, or source-backed lookup. |
| Detect git worktree state | Use `git rev-parse --git-dir`, `git rev-parse --git-common-dir`, and `git branch --show-current`. |
| Stage, commit, branch, push, or create PRs | Use git commands when appropriate, then emit Codex app git directives only after successful actions. |

Use the installed global CLI by default:

```bash
platty <command> --json
```

If global `platty` appears stale, report that it needs reinstall/rebuild before
continuing. Keep the workflow on the global CLI.

## Git Environment Detection

Before worktree-sensitive or branch-finishing workflows, inspect the environment with read-only commands:

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
BRANCH=$(git branch --show-current)
```

- `GIT_DIR != GIT_COMMON` means the checkout is already a linked worktree.
- Empty `BRANCH` means detached HEAD.

## Multi-Agent Availability

Use `spawn_agent`, `wait_agent`, and `close_agent` only when they are available in the current Codex session. If they are unavailable, execute the work inline and keep the same review gates described by the relevant skill.
