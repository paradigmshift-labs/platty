# Claude Code Tool Mapping For Platty Skills

Claude Code is one of two equal Platty runtimes. Use this file when working in Claude Code and a skill needs a concrete tool translation. The Codex equivalent lives in `codex-tools.md`.

| Platty skill action | Claude Code equivalent |
| --- | --- |
| Read a file | `Read` |
| Search file contents | `Grep` |
| Search file names | `Glob` |
| Create or edit files | `Write` for new files and `Edit` for existing files. |
| Run a shell command | `Bash` |
| Run Platty CLI | `Bash` from the repo root and prefer `--json`. |
| Track multi-step work | `TodoWrite` when available. |
| Ask a concise blocking question | Send a normal assistant message or use a structured question tool when available. |
| Invoke a skill | `Skill` |
| Dispatch an independent worker or subagent | `Task` |
| Dispatch multiple independent workers | Multiple `Task` calls. |
| Wait for a worker result | Read the `Task` result. |
| Close a completed worker | No explicit close step; a completed `Task` result is final. |
| Run independent local tool calls in parallel | Use parallel tool calls when supported; otherwise run the operations sequentially. |
| Inspect or test a local browser UI | Use available browser automation tools in the Claude Code environment. |
| Fetch current or external information | Use `WebFetch` for specific pages and `WebSearch` for search when available. |
| Detect git worktree state | Use `Bash` with `git rev-parse --git-dir`, `git rev-parse --git-common-dir`, and `git branch --show-current`. |
| Stage, commit, branch, push, or create PRs | Use `Bash` for git commands and the available GitHub/PR tooling in the Claude Code environment. |

Use the local built CLI when available:

```bash
node packages/cli/dist/main.js <command> --json
```

Use installed `platty <command> --json` when the binary is on `PATH`.

## Compatibility Rule

When Codex and Claude Code capabilities differ, translate only the tool operation. Do not change Platty CLI command order, JSON inspection rules, approval gates, or document-generation safety rules between runtimes — the Platty workflow is identical regardless of runtime.
