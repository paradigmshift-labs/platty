# Codex-First Platty Skill Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Platty agent skills explicitly Codex-first while preserving Claude Code compatibility through a complete tool mapping reference.

**Architecture:** Keep `skills/` as the shared source of truth. Update `using-platty` to declare Codex as the canonical execution runtime, expand the Codex and Claude Code mapping references, then regenerate `.codex/skills/` and `agent-marketplace/` from the shared source.

**Tech Stack:** Markdown skills, Node.js architecture contract tests, npm scripts `sync:agent-skills` and `package:agent-marketplace`.

---

## File Structure

- Modify: `tests/architecture/agent-skills-cross-runtime-contract.test.mjs`
  - Adds contract assertions for Codex-first wording and the expanded Codex/Claude mapping entries.
- Modify: `skills/using-platty/SKILL.md`
  - Adds the Codex-first execution contract while keeping skill bodies runtime-neutral.
- Modify: `skills/using-platty/references/codex-tools.md`
  - Expands the canonical Codex mapping, including subagents, skill loading, parallelism, browser checks, web lookup, git environment detection, and Codex app git directives.
- Modify: `skills/using-platty/references/claude-code-tools.md`
  - Expands the Claude Code compatibility mapping for the same Platty actions.
- Regenerate: `.codex/skills/`
  - Generated mirror of `skills/`; do not edit directly.
- Regenerate: `agent-marketplace/`
  - Generated marketplace package; do not edit directly.

## Tasks

### Task 1: Add Failing Contract Coverage

**Files:**
- Modify: `tests/architecture/agent-skills-cross-runtime-contract.test.mjs`

- [ ] **Step 1: Add the failing Codex-first and mapping assertions**

In `tests/architecture/agent-skills-cross-runtime-contract.test.mjs`, replace the current `it('bootstraps using-platty and references per-runtime tool mappings', () => { ... })` block with this complete block:

```js
  it('bootstraps using-platty with Codex-first cross-runtime mappings', () => {
    const usingPlatty = skill('skills/using-platty')
    assert.match(usingPlatty, /Codex-first/)
    assert.match(usingPlatty, /canonical execution runtime/)
    assert.match(usingPlatty, /runtime-neutral actions/)
    assert.match(usingPlatty, /claude-code-tools\.md/)
    assert.match(usingPlatty, /codex-tools\.md/)
    assert.match(usingPlatty, /platty-cli-router/)

    const codexTools = read('skills/using-platty/references/codex-tools.md')
    for (const expected of [
      /apply_patch/,
      /update_plan/,
      /spawn_agent/,
      /wait_agent/,
      /close_agent/,
      /multi_tool_use\.parallel/,
      /Browser plugin/,
      /web tools/,
      /git rev-parse --git-dir/,
      /git rev-parse --git-common-dir/,
      /git branch --show-current/,
      /Codex app git directives/,
    ]) {
      assert.match(codexTools, expected)
    }

    const claudeTools = read('skills/using-platty/references/claude-code-tools.md')
    for (const expected of [
      /Read/,
      /Grep/,
      /Glob/,
      /Write/,
      /Edit/,
      /Bash/,
      /TodoWrite/,
      /Skill/,
      /Task/,
      /WebFetch/,
      /WebSearch/,
    ]) {
      assert.match(claudeTools, expected)
    }
  })
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: FAIL in `bootstraps using-platty with Codex-first cross-runtime mappings` because `skills/using-platty/SKILL.md` does not yet contain `Codex-first` or `canonical execution runtime`, and the mapping reference files do not yet contain the expanded tool entries.

- [ ] **Step 3: Commit the failing contract test**

```bash
git add tests/architecture/agent-skills-cross-runtime-contract.test.mjs
git commit -m "test: require codex-first platty skill mappings"
```

### Task 2: Update `using-platty` Codex-First Contract

**Files:**
- Modify: `skills/using-platty/SKILL.md`

- [ ] **Step 1: Replace the Tool Mapping section**

In `skills/using-platty/SKILL.md`, replace the current `## Tool Mapping` section with this text:

```markdown
## Tool Mapping

Platty skills are Codex-first. Codex is the canonical execution runtime for Platty agent workflows unless a specific skill explicitly says otherwise.

Skill bodies should still use runtime-neutral actions such as "read a file", "search files", "run Platty CLI", "track multi-step work", and "dispatch a worker". Runtime-neutral actions keep the shared catalog usable across Codex and Claude Code.

When a runtime-specific tool name appears, translate it through the mapping for the current harness:

- Codex: `references/codex-tools.md`
- Claude Code: `references/claude-code-tools.md`

Claude Code support is a compatibility layer for the shared Platty catalog. If Codex and Claude behavior differ, preserve the Codex workflow and document the Claude translation in `references/claude-code-tools.md`.
```

- [ ] **Step 2: Run the focused test and verify remaining failures**

Run:

```bash
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: FAIL remains because the mapping reference files are not expanded yet and generated surfaces are not synced. The failure should no longer be caused by missing `Codex-first`, `canonical execution runtime`, or `runtime-neutral actions` in `skills/using-platty/SKILL.md`.

- [ ] **Step 3: Commit the `using-platty` contract update**

```bash
git add skills/using-platty/SKILL.md
git commit -m "docs: make platty skills codex first"
```

### Task 3: Expand Codex Tool Mapping

**Files:**
- Modify: `skills/using-platty/references/codex-tools.md`

- [ ] **Step 1: Replace the Codex mapping file**

Replace the full contents of `skills/using-platty/references/codex-tools.md` with:

````markdown
# Codex Tool Mapping For Platty Skills

Codex is the canonical execution runtime for Platty skills. Skill bodies should prefer runtime-neutral actions; use this file when a skill needs a concrete Codex tool translation.

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

Use the local built CLI when available:

```bash
node packages/cli/dist/main.js <command> --json
```

Use installed `platty <command> --json` when the binary is on `PATH`.

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
````

- [ ] **Step 2: Run the focused test and verify Claude mapping failures remain**

Run:

```bash
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: FAIL remains because `skills/using-platty/references/claude-code-tools.md` is not expanded yet and generated surfaces are not synced. Codex mapping assertions against `skills/using-platty/references/codex-tools.md` should pass.

- [ ] **Step 3: Commit the Codex mapping update**

```bash
git add skills/using-platty/references/codex-tools.md
git commit -m "docs: expand codex tool mapping for platty skills"
```

### Task 4: Expand Claude Code Compatibility Mapping

**Files:**
- Modify: `skills/using-platty/references/claude-code-tools.md`

- [ ] **Step 1: Replace the Claude Code mapping file**

Replace the full contents of `skills/using-platty/references/claude-code-tools.md` with:

````markdown
# Claude Code Tool Mapping For Platty Skills

Platty skills are Codex-first. Use this file as the Claude Code compatibility layer for the shared Platty skill catalog.

| Platty skill action | Claude Code equivalent |
| --- | --- |
| Read a file | `Read` |
| Search file contents | `Grep` |
| Search file names | `Glob` |
| Create a file | `Write` |
| Edit a file | `Edit` |
| Run a shell command | `Bash` |
| Run Platty CLI | `Bash` from the repo root and prefer `--json`. |
| Track multi-step work | `TodoWrite` when available. |
| Ask a concise blocking question | Send a normal assistant message or use a structured question tool when available. |
| Invoke a skill | `Skill` |
| Dispatch an independent worker or subagent | `Task` |
| Dispatch multiple independent workers | Multiple `Task` calls. |
| Wait for a worker result | Read the `Task` result. |
| Inspect or test a browser UI | Use available browser automation tools in the Claude Code environment. |
| Fetch a specific web page | `WebFetch` when available. |
| Search the web | `WebSearch` when available. |
| Detect git worktree state | Use `Bash` with `git rev-parse --git-dir`, `git rev-parse --git-common-dir`, and `git branch --show-current`. |
| Stage, commit, branch, push, or create PRs | Use `Bash` for git commands and the available GitHub/PR tooling in the Claude Code environment. |

Use the local built CLI when available:

```bash
node packages/cli/dist/main.js <command> --json
```

Use installed `platty <command> --json` when the binary is on `PATH`.

## Compatibility Rule

When Codex and Claude Code capabilities differ, preserve the Codex-first workflow intent and translate only the tool operation. Do not change Platty CLI command order, JSON inspection rules, approval gates, or document-generation safety rules for Claude Code.
````

- [ ] **Step 2: Run the focused test and verify only generated-surface drift remains**

Run:

```bash
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: FAIL remains because `.codex/skills/` and `agent-marketplace/` are not synced yet. The new mapping assertions against the shared `skills/using-platty` source should pass, and the remaining failures should be generated-surface drift.

- [ ] **Step 3: Commit the Claude mapping update**

```bash
git add skills/using-platty/references/claude-code-tools.md
git commit -m "docs: add claude compatibility mapping for platty skills"
```

### Task 5: Sync Generated Skill Surfaces

**Files:**
- Regenerate: `.codex/skills/`
- Regenerate: `agent-marketplace/`

- [ ] **Step 1: Sync the Codex skill mirror**

Run:

```bash
npm run sync:agent-skills
```

Expected: exit 0. `.codex/skills/using-platty/SKILL.md` and `.codex/skills/using-platty/references/*` match `skills/using-platty`.

- [ ] **Step 2: Package the agent marketplace snapshot**

Run:

```bash
npm run package:agent-marketplace
```

Expected: exit 0. `agent-marketplace/plugins/platty-agent-skills/skills/using-platty` matches `skills/using-platty`.

- [ ] **Step 3: Run generated-surface checks and the focused contract test**

Run:

```bash
npm run check:agent-skills
npm run check:agent-marketplace
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: all commands exit 0. The focused contract test should pass with 8 tests, 1 suite, 0 failures.

- [ ] **Step 4: Commit generated surfaces**

```bash
git add .codex/skills agent-marketplace
git commit -m "chore: sync codex-first platty skill package"
```

### Task 6: Final Verification

**Files:**
- Verify only; no source changes expected.

- [ ] **Step 1: Run focused cross-runtime contract test**

Run:

```bash
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: PASS with 8 tests, 1 suite, 0 failures.

- [ ] **Step 2: Run all architecture tests**

Run:

```bash
node --test tests/architecture/*.test.mjs
```

Expected: PASS with all architecture tests passing and 0 failures.

- [ ] **Step 3: Run architecture and generated-surface checks**

Run:

```bash
npm run check:architecture
npm run check:agent-skills
npm run check:agent-marketplace
```

Expected: all commands exit 0.

- [ ] **Step 4: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit 0.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat HEAD~5..HEAD
git status --short
```

Expected: committed changes cover only:

```text
tests/architecture/agent-skills-cross-runtime-contract.test.mjs
skills/using-platty/SKILL.md
skills/using-platty/references/codex-tools.md
skills/using-platty/references/claude-code-tools.md
.codex/skills/...
agent-marketplace/...
```

Expected `git status --short`: no output.

## Self-Review

- Spec coverage: The plan covers Codex-first policy, expanded Codex mapping, Claude compatibility mapping, generated mirrors, marketplace package sync, and verification.
- Placeholder scan: No prohibited placeholder phrases or deferred-work instructions remain.
- Type and name consistency: The test names and file paths match existing repository paths and npm scripts.
