# Cross-Runtime Platty Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Superpowers-style shared Platty skill catalog that can be packaged for both Codex and Claude Code while preserving current Codex repo-local skill usage.

**Architecture:** `skills/` becomes the shared source of truth for Platty agent skills. Runtime-specific integration lives in `.codex-plugin/`, `.claude-plugin/`, `hooks/`, and `skills/using-platty/references/`; `.codex/skills/` remains a generated compatibility mirror for the current Codex repo-local workflow. Contract tests enforce discovery metadata, plugin wiring, bootstrap hooks, and mirror synchronization.

**Tech Stack:** Markdown `SKILL.md` files, Codex/Claude plugin manifests, Bash session-start hooks, Node ESM validation/sync scripts, Node built-in test runner.

---

## File Structure

- `docs/architecture/agent-skills.md`: human architecture contract for cross-runtime Platty skills.
- `tests/architecture/agent-skills-cross-runtime-contract.test.mjs`: RED/GREEN contract for shared skills, plugin manifests, hooks, and Codex mirror sync.
- `skills/using-platty/SKILL.md`: bootstrap/orchestration skill for choosing Platty skills.
- `skills/using-platty/references/codex-tools.md`: Codex tool mapping for Platty skills.
- `skills/using-platty/references/claude-code-tools.md`: Claude Code tool mapping for Platty skills.
- `skills/platty-cli-router/SKILL.md`: command router skill for choosing the right Platty skill/command.
- `skills/platty-project-setup/SKILL.md`: `init`, `project`, and `repo` workflow skill.
- `skills/platty-static-analysis/SKILL.md`: `status`, `run`, `confirm`, and `runs` workflow skill.
- `skills/platty-docs-target-curation/SKILL.md`: `docs targets` and shared segment curation skill.
- `skills/platty-docs-generation/SKILL.md`: shared copy of the existing technical docs generation skill.
- `skills/platty-retrieval/SKILL.md`: shared copy of the existing document retrieval skill.
- `skills/platty-epics-generation/SKILL.md`: `epics` generation and sync skill.
- `skills/platty-business-docs-generation/SKILL.md`: `business-docs` generation and sync skill.
- `skills/platty-corpus-quality/SKILL.md`: fixture corpus and self-improve QA skill.
- `.codex-plugin/plugin.json`: Codex plugin manifest pointing at shared `skills/` and Codex hooks.
- `.claude-plugin/plugin.json`: Claude Code plugin metadata.
- `hooks/hooks-codex.json`: Codex `SessionStart` hook registration.
- `hooks/hooks.json`: Claude Code `SessionStart` hook registration.
- `hooks/run-hook.cmd`: cross-platform wrapper for session hooks.
- `hooks/session-start-codex`: Codex bootstrap that injects `skills/using-platty/SKILL.md`.
- `hooks/session-start`: Claude bootstrap that injects `skills/using-platty/SKILL.md`.
- `scripts/sync-agent-skills.mjs`: copies shared skills into `.codex/skills/` and checks mirror drift.
- `package.json`: adds `sync:agent-skills` and `check:agent-skills` scripts.

## Scope Boundaries

This plan creates the shared skill catalog and runtime wiring only. It does not publish a marketplace plugin, install anything into `~/.codex`, install anything into `~/.claude`, create MCP servers, or change Platty CLI command behavior.

## Implementation Rules

- Use `apply_patch` for hand-authored files.
- Use the provided `cp` commands only for mechanical migration of existing skill files whose content must remain byte-for-byte identical.
- Run RED baseline workers before creating each skill file. The baseline worker must not receive this plan or the GREEN draft.
- Do not combine multiple new skills into one commit.

### Task 1: RED Cross-Runtime Skill Contract

**Files:**
- Create: `tests/architecture/agent-skills-cross-runtime-contract.test.mjs`

- [ ] **Step 1: Write the failing contract test**

Create `tests/architecture/agent-skills-cross-runtime-contract.test.mjs` with this exact content:

```js
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'

const root = resolve(import.meta.dirname, '../..')

const expectedSkills = [
  'using-platty',
  'platty-cli-router',
  'platty-project-setup',
  'platty-static-analysis',
  'platty-docs-target-curation',
  'platty-docs-generation',
  'platty-retrieval',
  'platty-epics-generation',
  'platty-business-docs-generation',
  'platty-corpus-quality',
]

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readJson(path) {
  return JSON.parse(read(path))
}

function skill(path) {
  const fullPath = join(root, path, 'SKILL.md')
  assert.equal(existsSync(fullPath), true, `${path}/SKILL.md should exist`)
  return readFileSync(fullPath, 'utf8')
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(match, 'skill should have YAML frontmatter')
  return match[1]
}

describe('cross-runtime Platty skill catalog', () => {
  it('stores shared skills under root skills directory', () => {
    for (const name of expectedSkills) {
      const body = skill(`skills/${name}`)
      const meta = frontmatter(body)
      assert.match(meta, new RegExp(`^name: ${name}$`, 'm'))
      assert.match(meta, /^description: Use when /m)
    }
  })

  it('keeps current Codex repo-local skills as a generated mirror', () => {
    for (const name of expectedSkills) {
      const source = skill(`skills/${name}`)
      const mirror = skill(`.codex/skills/${name}`)
      assert.equal(mirror, source, `.codex/skills/${name}/SKILL.md should match shared source`)
    }
  })

  it('declares Codex plugin wiring against the shared catalog', () => {
    const manifest = readJson('.codex-plugin/plugin.json')
    assert.equal(manifest.name, 'platty-agent-skills')
    assert.equal(manifest.skills, './skills/')
    assert.equal(manifest.hooks, './hooks/hooks-codex.json')
    assert.match(manifest.description, /Platty/)

    const hooks = readJson('hooks/hooks-codex.json')
    assert.ok(hooks.hooks.SessionStart, 'Codex SessionStart hook should be configured')
    const encoded = JSON.stringify(hooks)
    assert.match(encoded, /session-start-codex/)
    assert.match(encoded, /PLUGIN_ROOT/)
  })

  it('declares Claude plugin metadata and bootstrap hook', () => {
    const manifest = readJson('.claude-plugin/plugin.json')
    assert.equal(manifest.name, 'platty-agent-skills')
    assert.match(manifest.description, /Platty/)
    assert.equal(manifest.version, '0.1.0')

    const hooks = readJson('hooks/hooks.json')
    assert.ok(hooks.hooks.SessionStart, 'Claude SessionStart hook should be configured')
    const encoded = JSON.stringify(hooks)
    assert.match(encoded, /session-start/)
    assert.match(encoded, /CLAUDE_PLUGIN_ROOT/)
  })

  it('bootstraps using-platty and references per-runtime tool mappings', () => {
    const usingPlatty = skill('skills/using-platty')
    assert.match(usingPlatty, /codex-tools\.md/)
    assert.match(usingPlatty, /claude-code-tools\.md/)
    assert.match(usingPlatty, /platty-cli-router/)

    const codexTools = read('skills/using-platty/references/codex-tools.md')
    assert.match(codexTools, /apply_patch/)
    assert.match(codexTools, /update_plan/)

    const claudeTools = read('skills/using-platty/references/claude-code-tools.md')
    assert.match(claudeTools, /Read/)
    assert.match(claudeTools, /Edit/)
  })

  it('ships a deterministic sync script for Codex mirror drift', () => {
    const script = read('scripts/sync-agent-skills.mjs')
    assert.match(script, /expectedSkills/)
    assert.match(script, /--check/)
    assert.match(script, /\.codex\/skills/)

    const rootPackage = readJson('package.json')
    assert.equal(rootPackage.scripts['sync:agent-skills'], 'node scripts/sync-agent-skills.mjs')
    assert.equal(rootPackage.scripts['check:agent-skills'], 'node scripts/sync-agent-skills.mjs --check')
    assert.match(rootPackage.scripts.test, /check:agent-skills/)
  })
})
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: FAIL because `skills/using-platty/SKILL.md`, plugin manifests, hooks, and the sync script do not exist yet.

- [ ] **Step 3: Commit RED test**

Run:

```bash
git add tests/architecture/agent-skills-cross-runtime-contract.test.mjs
git commit -m "test: define cross-runtime Platty skill contract"
```

Expected: commit succeeds with only the new contract test staged.

### Task 2: Architecture Document

**Files:**
- Create: `docs/architecture/agent-skills.md`

- [ ] **Step 1: Create the architecture document**

Create `docs/architecture/agent-skills.md` with this exact content:

```markdown
# Platty Agent Skills Architecture

Platty agent skills follow the Superpowers pattern: one shared skill catalog, with thin runtime-specific integration layers for Codex and Claude Code.

## Layout

```text
platty/
  skills/
    using-platty/
    platty-cli-router/
    platty-project-setup/
    platty-static-analysis/
    platty-docs-target-curation/
    platty-docs-generation/
    platty-retrieval/
    platty-epics-generation/
    platty-business-docs-generation/
    platty-corpus-quality/

  .codex-plugin/
  .claude-plugin/
  hooks/
  .codex/skills/
```

## Source Of Truth

`skills/` is the shared source of truth. Skill bodies should be written in harness-agnostic language: "read a file", "run a command", "track steps", "submit a draft", and "inspect JSON output".

Runtime-specific tool names belong in `skills/using-platty/references/`.

`.codex/skills/` is a generated mirror for the current repo-local Codex workflow. Do not hand-edit mirrored files. Change `skills/` first, then run:

```bash
npm run sync:agent-skills
```

## Runtime Integration

Codex plugin wiring:

- `.codex-plugin/plugin.json` points at `./skills/` and `./hooks/hooks-codex.json`.
- `hooks/session-start-codex` injects `skills/using-platty/SKILL.md` into session context.

Claude Code plugin wiring:

- `.claude-plugin/plugin.json` provides marketplace/plugin metadata.
- `hooks/hooks.json` registers a session-start hook.
- `hooks/session-start` injects `skills/using-platty/SKILL.md` into session context.

## Skill Boundaries

- `using-platty`: bootstrap and skill-selection rules.
- `platty-cli-router`: choose the correct root command or skill.
- `platty-project-setup`: initialize workspaces, projects, and repositories.
- `platty-static-analysis`: run and inspect static pipeline progress.
- `platty-docs-target-curation`: curate technical documentation targets.
- `platty-docs-generation`: author technical docs from worker packets.
- `platty-retrieval`: answer questions from existing generated docs.
- `platty-epics-generation`: generate and confirm epics.
- `platty-business-docs-generation`: generate, validate, review, and sync business docs.
- `platty-corpus-quality`: run fixture corpus and self-improvement quality workflows.

## Validation

Run these before changing or publishing skills:

```bash
npm run check:agent-skills
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
node --test tests/architecture/*.test.mjs
git diff --check
```
```

- [ ] **Step 2: Verify the document exists**

Run:

```bash
test -f docs/architecture/agent-skills.md && sed -n '1,220p' docs/architecture/agent-skills.md
```

Expected: exits `0` and prints the architecture document.

- [ ] **Step 3: Commit architecture document**

Run:

```bash
git add docs/architecture/agent-skills.md
git commit -m "docs: describe Platty agent skills architecture"
```

Expected: commit succeeds.

### Task 3: Shared Skill Catalog With Per-Skill TDD

**Files:**
- Create: `docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md`
- Create: `skills/using-platty/SKILL.md`
- Create: `skills/using-platty/references/codex-tools.md`
- Create: `skills/using-platty/references/claude-code-tools.md`
- Create: `skills/platty-cli-router/SKILL.md`
- Create: `skills/platty-project-setup/SKILL.md`
- Create: `skills/platty-static-analysis/SKILL.md`
- Create: `skills/platty-docs-target-curation/SKILL.md`
- Create: `skills/platty-epics-generation/SKILL.md`
- Create: `skills/platty-business-docs-generation/SKILL.md`
- Create: `skills/platty-corpus-quality/SKILL.md`
- Copy: `.codex/skills/platty-docs-generation/SKILL.md` to `skills/platty-docs-generation/SKILL.md`
- Copy: `.codex/skills/platty-retrieval/SKILL.md` to `skills/platty-retrieval/SKILL.md`

**Writing-skills gate:** Do not create these skills in one batch. `superpowers:writing-skills` treats skill authoring as RED-GREEN-REFACTOR documentation TDD. For every skill below, first create or select a pressure scenario, record the baseline failure without that skill, write the minimal `SKILL.md`, re-run the focused contract or scenario, then commit before moving to the next skill.

**Baseline worker protocol:** RED baseline must be run in a fresh worker that has not read this plan's GREEN draft for the skill. Dispatch a fresh subagent when available. Give it only:

```text
You are checking current behavior without the planned Platty skill.
Do not read docs/superpowers/plans/2026-06-10-cross-runtime-platty-skills.md.
Do not read any planned skills under skills/<skill-name>/.
Answer this prompt from the current repo and available CLI context:

<scenario prompt>
```

If no subagent tool is available, use a separate clean Codex/Claude session and paste only the baseline worker prompt. Do not self-grade the baseline from the same context that contains the GREEN draft. Record the worker's actual output or a concise verbatim excerpt in the pressure scenario file before writing the skill.

- [ ] **Step 1: Write pressure scenarios before creating skills**

Create `docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md` with this exact content:

```markdown
# Cross-Runtime Platty Skill Pressure Scenarios

These scenarios are the RED baseline prompts for the shared Platty skill catalog. Run each scenario in a fresh worker before creating the named skill and record the observed failure in this file under that scenario.

## Baseline Recording Format

```text
Skill:
Prompt:
Baseline worker:
Without-skill behavior:
Observed rationalization or gap:
Expected behavior after skill:
Verification:
```

## Scenarios

### using-platty

Baseline worker result:

Prompt: "I'm in the Platty repo. Which Platty skill should I use to generate docs, and does this work in both Codex and Claude?"

Expected without skill: agent guesses from memory, ignores runtime tool mapping, or treats Codex-only `.codex/skills` as the only source.

Expected with skill: agent identifies `using-platty`, loads runtime mapping, and routes to `platty-cli-router` or the specific generation/retrieval skill.

### platty-cli-router

Baseline worker result:

Prompt: "Platty status says there is no repo, and I want docs. What command should I run next?"

Expected without skill: agent jumps to `platty docs start` instead of setup/status flow.

Expected with skill: agent routes `init -> project -> repo -> status` and follows `nextAction.command`.

### platty-project-setup

Baseline worker result:

Prompt: "Set up Platty for a new local repository under an existing project."

Expected without skill: agent confuses project and repo or omits `project use` before `repo add`.

Expected with skill: agent initializes, lists/selects project, adds repo, then checks status.

### platty-static-analysis

Baseline worker result:

Prompt: "The repo is registered. Run the analysis safely and explain what to do if a gate appears."

Expected without skill: agent runs docs directly or loops `run` without checking confirmation.

Expected with skill: agent uses `status`, `run`, `confirm`, `run --step-only`, and `runs` inspection correctly.

### platty-docs-target-curation

Baseline worker result:

Prompt: "Before generating docs, list only POST API targets matching auth and exclude one bad target."

Expected without skill: agent starts docs generation before curating targets.

Expected with skill: agent uses `docs targets list`, then `docs targets deprecate/include` with selectors.

### platty-docs-generation

Baseline worker result:

Prompt: "Continue a technical docs run manually from a worker packet."

Expected without skill: agent writes a merged document, includes forbidden fields, or reads source files instead of `agentInput.context`.

Expected with skill: agent follows worker next, context-only draft generation, submit, repair, status.

### platty-retrieval

Baseline worker result:

Prompt: "Answer a question from existing generated docs and mention whether evidence is stale."

Expected without skill: agent searches source files first or hides freshness state.

Expected with skill: agent uses docs indexes/search/show and reports freshness.

### platty-epics-generation

Baseline worker result:

Prompt: "Generate epics and confirm the draft after validation."

Expected without skill: agent mixes `docs` and `epics` commands or skips draft validation.

Expected with skill: agent uses `epics preview/start/worker next/tasks submit/draft show/validate/draft confirm`.

### platty-business-docs-generation

Baseline worker result:

Prompt: "Resume a business-docs run, validate it, and inspect a context page for a leased task."

Expected without skill: agent uses technical `docs` commands or misses business-docs run/task flags.

Expected with skill: agent uses `business-docs status/resume/validate/context page/tasks submit` with `--run`, `--task`, and `--lease-token`.

### platty-corpus-quality

Baseline worker result:

Prompt: "Check whether a fixture can pass a corpus gate and find the next self-improvement candidate."

Expected without skill: agent runs production analysis commands or executes self-improve without dry-run.

Expected with skill: agent uses `corpus gate-check`, `next-candidate`, `audit-queue`, and keeps `self-improve-once --dry-run`.
```

Run:

```bash
test -f docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md
```

Expected: exits `0`.

- [ ] **Step 2: Commit pressure scenarios**

Run:

```bash
git add docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md
git commit -m "test: add Platty skill pressure scenarios"
```

Expected: commit succeeds.

- [ ] **Step 3: Migrate `platty-docs-generation` after recording its RED baseline**

Run the `platty-docs-generation` baseline worker prompt and record the result before copying the existing skill.

Run:

```bash
mkdir -p skills/platty-docs-generation
cp .codex/skills/platty-docs-generation/SKILL.md skills/platty-docs-generation/SKILL.md
```

Expected: the copied file exists and matches the current Codex repo-local skill.

- [ ] **Step 4: Verify and commit `platty-docs-generation` migration**

Run:

```bash
cmp .codex/skills/platty-docs-generation/SKILL.md skills/platty-docs-generation/SKILL.md
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: `cmp` exits `0`; the contract test still FAILS because the remaining shared skills, plugin manifests, hooks, and sync script are not complete yet.

Run:

```bash
git add docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md skills/platty-docs-generation/SKILL.md
git commit -m "feat: migrate Platty docs generation skill"
```

Expected: commit succeeds.

- [ ] **Step 5: Migrate `platty-retrieval` after recording its RED baseline**

Run the `platty-retrieval` baseline worker prompt and record the result before copying the existing skill.

Run:

```bash
mkdir -p skills/platty-retrieval
cp .codex/skills/platty-retrieval/SKILL.md skills/platty-retrieval/SKILL.md
```

Expected: the copied file exists and matches the current Codex repo-local skill.

- [ ] **Step 6: Verify and commit `platty-retrieval` migration**

Run:

```bash
cmp .codex/skills/platty-retrieval/SKILL.md skills/platty-retrieval/SKILL.md
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: `cmp` exits `0`; the contract test still FAILS because the remaining shared skills, plugin manifests, hooks, and sync script are not complete yet.

Run:

```bash
git add docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md skills/platty-retrieval/SKILL.md
git commit -m "feat: migrate Platty retrieval skill"
```

Expected: commit succeeds.

- [ ] **Step 7: Create `using-platty` after recording its RED baseline**

Before writing the file, run the `using-platty` pressure scenario from `docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md` without `skills/using-platty/SKILL.md` present. Record the observed behavior in that scenario section.

Then create `skills/using-platty/SKILL.md` with this exact content:


```markdown
---
name: using-platty
description: Use when starting Platty repository work, choosing Platty CLI skills, or operating Platty agent skills across Codex and Claude Code.
---

# Using Platty Skills

Use this skill as the entry point for Platty CLI and documentation workflows.

## Tool Mapping

Skills are written as runtime-neutral actions. Load the mapping for the current harness when tool names matter:

- Codex: `references/codex-tools.md`
- Claude Code: `references/claude-code-tools.md`

## Skill Router

Use `platty-cli-router` when deciding which Platty root command or skill applies.

Common routes:

- New workspace/project/repo setup: `platty-project-setup`
- Static analysis progress: `platty-static-analysis`
- Technical docs target review: `platty-docs-target-curation`
- Technical docs worker authoring: `platty-docs-generation`
- Existing docs search or answers: `platty-retrieval`
- Epic generation: `platty-epics-generation`
- Business docs generation or sync: `platty-business-docs-generation`
- Fixture corpus quality work: `platty-corpus-quality`

## Core Rules

- Prefer `--json` for CLI commands so results can be inspected precisely.
- Resolve the project before running project-scoped commands.
- Use `platty status --json` when the next action is unclear.
- Follow `nextAction.command` from JSON output unless there is a specific reason not to.
- Do not use generation skills for retrieval-only questions.
```

- [ ] **Step 8: Create `using-platty` tool mappings**

Create `skills/using-platty/references/codex-tools.md` with this exact content:

```markdown
# Codex Tool Mapping For Platty Skills

| Skill action | Codex equivalent |
| --- | --- |
| Read a file | shell command such as `sed`, `cat`, or `rg` |
| Search files | `rg` through shell |
| Create or edit files | `apply_patch` |
| Run Platty CLI | shell command from the repo root |
| Track multi-step work | `update_plan` |
| Ask a concise blocking question | normal assistant message |

Use the local built CLI when available:

```bash
node packages/cli/dist/main.js <command> --json
```

Use installed `platty <command> --json` when the binary is on `PATH`.
```

Create `skills/using-platty/references/claude-code-tools.md` with this exact content:

```markdown
# Claude Code Tool Mapping For Platty Skills

| Skill action | Claude Code equivalent |
| --- | --- |
| Read a file | `Read` |
| Search files | `Grep` or `Glob` |
| Create a file | `Write` |
| Edit a file | `Edit` |
| Run Platty CLI | `Bash` from the repo root |
| Track multi-step work | todo/task tracking tool when available |
| Ask a concise blocking question | normal assistant message or structured question tool when available |

Use the local built CLI when available:

```bash
node packages/cli/dist/main.js <command> --json
```

Use installed `platty <command> --json` when the binary is on `PATH`.
```

- [ ] **Step 9: Verify and commit `using-platty`**

Run:

```bash
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: still FAIL because other shared skills, plugin manifests, hooks, and sync script are incomplete; failure list should no longer include missing `skills/using-platty/SKILL.md` or missing tool mapping references.

Run:

```bash
git add docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md skills/using-platty
git commit -m "feat: add using Platty skill"
```

Expected: commit succeeds.

- [ ] **Step 10: Create `platty-cli-router` after recording its RED baseline**

Before writing the file, run the `platty-cli-router` pressure scenario without `skills/platty-cli-router/SKILL.md` present. Record the observed behavior in the pressure scenario file.

Create `skills/platty-cli-router/SKILL.md` with this exact content:

```markdown
---
name: platty-cli-router
description: Use when deciding which Platty CLI root command, project workflow, analysis workflow, document workflow, or Platty skill should handle a user request.
---

# Platty CLI Router

Use this before choosing a Platty command when the user asks what to run next or asks broadly about Platty CLI workflows.

## Default Order

```text
init -> project -> repo -> status -> run -> confirm -> status -> docs or epics or business-docs
```

## Root Commands

| Need | Command or skill |
| --- | --- |
| Initialize `.platty` config | `platty init` via `platty-project-setup` |
| Create/select a project | `platty project ...` via `platty-project-setup` |
| Register repositories | `platty repo ...` via `platty-project-setup` |
| Ask "what next?" | `platty status --json` via `platty-static-analysis` |
| Run static analysis | `platty run --json` via `platty-static-analysis` |
| Approve static gate | `platty confirm --json` via `platty-static-analysis` |
| Inspect/cancel pipeline runs | `platty runs ... --json` via `platty-static-analysis` |
| Curate technical targets | `platty docs targets ... --json` via `platty-docs-target-curation` |
| Generate technical docs | `platty-docs-generation` |
| Search existing docs | `platty-retrieval` |
| Generate epics | `platty-epics-generation` |
| Generate business docs | `platty-business-docs-generation` |
| Check fixture corpus | `platty-corpus-quality` |

## Rule

If the CLI output includes `nextAction.command`, prefer that command as the next step.
```

- [ ] **Step 11: Verify and commit `platty-cli-router`**

Run:

```bash
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: still FAIL because later shared skills and runtime wiring are incomplete; failure list should no longer include missing `skills/platty-cli-router/SKILL.md`.

Run:

```bash
git add docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md skills/platty-cli-router/SKILL.md
git commit -m "feat: add Platty CLI router skill"
```

Expected: commit succeeds.

- [ ] **Step 12: Create remaining skills one at a time**

For each skill below, do not batch the steps. Run that skill's pressure scenario first in a fresh baseline worker, record the RED baseline in `docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md`, create only that skill's file, run the focused contract, and commit only that skill plus the updated pressure scenario file before proceeding to the next skill.

Use the following GREEN drafts as the exact file contents.

`skills/platty-project-setup/SKILL.md`:

```markdown
---
name: platty-project-setup
description: Use when initializing a Platty workspace, creating or selecting a Platty project, or adding and managing repositories for analysis.
---

# Platty Project Setup

Use this for setup before analysis.

## Flow

1. Initialize workspace:

```bash
platty init --json
```

2. Create or select a project:

```bash
platty project list --json
platty project create "<name>" --description "<description>" --json
platty project use <project-id-or-name> --json
```

3. Add repositories:

```bash
platty repo add <path> --project <project> --json
platty repo list --project <project> --json
```

Use `--source-root` when only a subdirectory should be analyzed. Use `--branch` when analysis should track a specific branch.

## Next Step

Run:

```bash
platty status --project <project> --json
```
```

`skills/platty-static-analysis/SKILL.md`:

```markdown
---
name: platty-static-analysis
description: Use when running Platty static analysis, inspecting pipeline state, approving analysis gates, or managing analysis runs.
---

# Platty Static Analysis

Use this after a project has at least one registered repository.

## Flow

1. Inspect next action:

```bash
platty status --project <project> --json
```

2. Run analysis:

```bash
platty run --project <project> --json
```

3. If an analysis gate is waiting for confirmation:

```bash
platty confirm --project <project> --json
platty run --step-only --project <project> --json
```

4. Inspect run history when debugging:

```bash
platty runs list --project <project> --json
platty runs show --run-id <run-id> --project <project> --json
platty runs cancel --run-id <run-id> --project <project> --reason "<reason>" --json
```

## Rule

Keep calling `platty status --json` between phases. When status reports `build_docs`, switch to `platty-docs-target-curation` or `platty-docs-generation`.
```

`skills/platty-docs-target-curation/SKILL.md`:

```markdown
---
name: platty-docs-target-curation
description: Use when listing, filtering, including, deprecating, or reviewing Platty technical documentation targets before docs generation.
---

# Platty Docs Target Curation

Use this before technical document generation when the user wants to inspect or narrow API, screen, event, or schedule targets.

## Commands

```bash
platty docs targets list --project <project> --json
platty docs targets list --project <project> --kind api --json
platty docs targets list --project <project> --kind screen --search "<term>" --json
platty docs targets deprecate --project <project> --ids <id1,id2> --note "<reason>" --json
platty docs targets include --project <project> --ids <id1,id2> --json
```

Use `--kind`, `--repo`, `--method`, `--search`, `--limit`, and `--offset` to narrow large target sets.

## Shared Segments

```bash
platty docs shared-segments rebuild --project <project> --json
platty docs shared-segments list --project <project> --json
```

## Next Step

Switch to `platty-docs-generation` after target scope is accepted.
```

`skills/platty-epics-generation/SKILL.md`:

```markdown
---
name: platty-epics-generation
description: Use when generating, validating, editing, confirming, or syncing Platty epics from analyzed project data.
---

# Platty Epics Generation

Use this after static analysis when the user wants product or business epics.

## Main Flow

```bash
platty epics preview --project <project> --json
platty epics start --project <project> --json
platty epics worker next --run-id <run-id> --out packet.json --json
platty epics tasks submit --task-id <task-id> --lease-token <lease-token> --input result.json --json
platty epics draft show --run-id <run-id> --json
platty epics validate --run-id <run-id> --json
platty epics draft confirm --run-id <run-id> --json
```

Use `platty epics run --project <project> --provider codex_cli --json` only when the user wants the automatic worker queue.

## Sync Flow

```bash
platty epics sync preview --project <project> --doc-sync-plan-id <id> --json
platty epics sync start --project <project> --doc-sync-plan-id <id> --json
platty epics sync worker next --run-id <run-id> --out packet.json --json
platty epics sync tasks submit --task-id <task-id> --lease-token <lease-token> --input result.json --json
platty epics sync draft confirm --run-id <run-id> --json
```
```

`skills/platty-business-docs-generation/SKILL.md`:

```markdown
---
name: platty-business-docs-generation
description: Use when generating, syncing, validating, reviewing, resuming, cancelling, or repairing Platty business documents.
---

# Platty Business Docs Generation

Use this for business document generation and lifecycle operations.

## Generation Flow

```bash
platty business-docs preview --project <project> --json
platty business-docs start --project <project> --json
platty business-docs status --project <project> --run <run-id> --json
platty business-docs validate --project <project> --run <run-id> --json
platty business-docs review --project <project> --run <run-id> --json
```

Use `platty business-docs run --project <project> --provider codex_cli --json` only when the user wants the automatic worker queue.

## Manual Task Operations

```bash
platty business-docs tasks lease --project <project> --run <run-id> --worker <worker-id> --json
platty business-docs context get --context <context-handle> --lease-token <token> --json
platty business-docs context page --context <context-handle> --page <page-token> --lease-token <token> --json
platty business-docs tasks submit --project <project> --task <task-id> --lease-token <token> --attempt <n> --document-json '<json>' --json
```

## Sync Flow

```bash
platty business-docs sync preview --project <project> --json
platty business-docs sync start --project <project> --json
```
```

`skills/platty-corpus-quality/SKILL.md`:

```markdown
---
name: platty-corpus-quality
description: Use when inspecting Platty fixture corpus quality, dry-running fixture stages, comparing expected outputs, or selecting self-improvement candidates.
---

# Platty Corpus Quality

Use this for Platty development and regression checks, not normal project analysis.

## Commands

```bash
platty corpus run-fixture --id <fixture-id> --stage <stage> --json
platty corpus batch-report --framework <framework> --stage <stage> --json
platty corpus compare --id <fixture-id> --stage <stage> --json
platty corpus gate-check --id <fixture-id> --stage <stage> --json
platty corpus next-candidate --json
platty corpus audit-queue --json
platty corpus self-improve-once --id <fixture-id> --stage <stage> --dry-run --json
```

`self-improve-once` requires `--dry-run` from the packaged CLI.
```

- [ ] **Step 13: Commit each remaining skill separately**

Use these commit commands after each individual skill passes its focused check:

```bash
git add docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md skills/platty-project-setup/SKILL.md
git commit -m "feat: add Platty project setup skill"

git add docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md skills/platty-static-analysis/SKILL.md
git commit -m "feat: add Platty static analysis skill"

git add docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md skills/platty-docs-target-curation/SKILL.md
git commit -m "feat: add Platty docs target curation skill"

git add docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md skills/platty-epics-generation/SKILL.md
git commit -m "feat: add Platty epics generation skill"

git add docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md skills/platty-business-docs-generation/SKILL.md
git commit -m "feat: add Platty business docs generation skill"

git add docs/superpowers/skill-pressure-scenarios/2026-06-10-cross-runtime-platty-skills.md skills/platty-corpus-quality/SKILL.md
git commit -m "feat: add Platty corpus quality skill"
```

Expected: each commit contains exactly one new skill and the pressure scenario file update for that skill.

- [ ] **Step 14: Run focused metadata check**

Run:

```bash
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: still FAIL because plugin manifests, hooks, mirror sync script, and `.codex/skills` mirrored copies are not complete yet.

Do not create a single "shared skills" batch commit. If any skill remains uncommitted at this point, stop and commit that skill separately before moving to Task 4.

### Task 4: Runtime Plugin Manifests And Hooks

**Files:**
- Create: `.codex-plugin/plugin.json`
- Create: `.claude-plugin/plugin.json`
- Create: `hooks/hooks-codex.json`
- Create: `hooks/hooks.json`
- Create: `hooks/run-hook.cmd`
- Create: `hooks/session-start-codex`
- Create: `hooks/session-start`

- [ ] **Step 1: Create Codex plugin manifest**

Create `.codex-plugin/plugin.json` with this exact content:

```json
{
  "name": "platty-agent-skills",
  "version": "0.1.0",
  "description": "Shared Platty CLI and documentation workflow skills for Codex and Claude Code.",
  "author": {
    "name": "Paradigm Shift Labs"
  },
  "homepage": "https://github.com/paradigmshift-labs/platty",
  "repository": "https://github.com/paradigmshift-labs/platty",
  "license": "UNLICENSED",
  "keywords": [
    "platty",
    "skills",
    "cli",
    "documentation",
    "codex",
    "claude"
  ],
  "skills": "./skills/",
  "hooks": "./hooks/hooks-codex.json",
  "interface": {
    "displayName": "Platty Agent Skills",
    "shortDescription": "Platty CLI, analysis, and document-generation workflows",
    "longDescription": "Use Platty Agent Skills to guide workspace setup, static analysis, technical document generation, business document generation, epic generation, retrieval, and fixture corpus quality workflows.",
    "developerName": "Paradigm Shift Labs",
    "category": "Developer Tools",
    "capabilities": [
      "Interactive",
      "Read",
      "Write"
    ],
    "defaultPrompt": [
      "What should I run next in Platty?",
      "Generate Platty docs for this project."
    ]
  }
}
```

- [ ] **Step 2: Create Claude plugin manifest**

Create `.claude-plugin/plugin.json` with this exact content:

```json
{
  "name": "platty-agent-skills",
  "description": "Shared Platty CLI and documentation workflow skills for Codex and Claude Code.",
  "version": "0.1.0",
  "author": {
    "name": "Paradigm Shift Labs"
  },
  "homepage": "https://github.com/paradigmshift-labs/platty",
  "repository": "https://github.com/paradigmshift-labs/platty",
  "license": "UNLICENSED",
  "keywords": [
    "platty",
    "skills",
    "cli",
    "documentation",
    "workflows"
  ]
}
```

- [ ] **Step 3: Create hook registration files**

Create `hooks/hooks-codex.json` with this exact content:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear",
        "hooks": [
          {
            "type": "command",
            "command": "\"${PLUGIN_ROOT}/hooks/run-hook.cmd\" session-start-codex",
            "async": false
          }
        ]
      }
    ]
  }
}
```

Create `hooks/hooks.json` with this exact content:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" session-start",
            "async": false
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Create hook runner**

Create `hooks/run-hook.cmd` with this exact content:

```bash
: << 'CMDBLOCK'
@echo off
if "%~1"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)
set "HOOK_DIR=%~dp0"
where bash >nul 2>nul
if %ERRORLEVEL% equ 0 (
    bash "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)
exit /b 0
CMDBLOCK

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$1"
shift
exec bash "${SCRIPT_DIR}/${SCRIPT_NAME}" "$@"
```

- [ ] **Step 5: Create Codex session bootstrap**

Create `hooks/session-start-codex` with this exact content:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

using_platty_content=$(cat "${PLUGIN_ROOT}/skills/using-platty/SKILL.md" 2>&1 || echo "Error reading using-platty skill")

escape_for_json() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

using_platty_escaped=$(escape_for_json "$using_platty_content")
session_context="<EXTREMELY_IMPORTANT>\nYou have Platty skills.\n\nBelow is the full content of your 'using-platty' skill. For all other Platty skills, follow Codex native skill-loading behavior and the mappings in using-platty references.\n\n${using_platty_escaped}\n</EXTREMELY_IMPORTANT>"

printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$session_context" | cat
```

- [ ] **Step 6: Create Claude session bootstrap**

Create `hooks/session-start` with this exact content:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

using_platty_content=$(cat "${PLUGIN_ROOT}/skills/using-platty/SKILL.md" 2>&1 || echo "Error reading using-platty skill")

escape_for_json() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

using_platty_escaped=$(escape_for_json "$using_platty_content")
session_context="<EXTREMELY_IMPORTANT>\nYou have Platty skills.\n\nBelow is the full content of your 'using-platty' skill. For all other Platty skills, use Claude Code's Skill tool.\n\n${using_platty_escaped}\n</EXTREMELY_IMPORTANT>"

printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$session_context" | cat
```

- [ ] **Step 7: Make hook scripts executable**

Run:

```bash
chmod +x hooks/run-hook.cmd hooks/session-start-codex hooks/session-start
```

Expected: command exits `0`.

- [ ] **Step 8: Verify hook output shape**

Run:

```bash
PLUGIN_ROOT="$PWD" hooks/session-start-codex | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(!j.hookSpecificOutput.additionalContext.includes("using-platty")) process.exit(1)})'
CLAUDE_PLUGIN_ROOT="$PWD" hooks/session-start | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(!j.hookSpecificOutput.additionalContext.includes("using-platty")) process.exit(1)})'
```

Expected: both commands exit `0`.

- [ ] **Step 9: Document Claude packaging assumption**

Append this section to `docs/architecture/agent-skills.md`:

```markdown
## Claude Packaging Assumption

This repository follows the Superpowers Claude Code plugin shape: `.claude-plugin/plugin.json` carries plugin metadata, while the installable plugin root carries `hooks/hooks.json` and `skills/`. The local smoke test verifies that `hooks/session-start` emits the expected Claude `hookSpecificOutput.additionalContext` payload. A marketplace or local Claude plugin installation smoke test is required before claiming the Claude package is distributable.
```

Run:

```bash
rg -n "Claude Packaging Assumption|session-start" docs/architecture/agent-skills.md
```

Expected: exits `0` and prints the new section lines.

- [ ] **Step 10: Commit manifests and hooks**

Run:

```bash
git add .codex-plugin .claude-plugin hooks docs/architecture/agent-skills.md
git commit -m "feat: add Platty skill plugin bootstrap"
```

Expected: commit succeeds.

### Task 5: Codex Mirror Sync Script

**Files:**
- Create: `scripts/sync-agent-skills.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create sync script**

Create `scripts/sync-agent-skills.mjs` with this exact content:

```js
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')

export const expectedSkills = [
  'using-platty',
  'platty-cli-router',
  'platty-project-setup',
  'platty-static-analysis',
  'platty-docs-target-curation',
  'platty-docs-generation',
  'platty-retrieval',
  'platty-epics-generation',
  'platty-business-docs-generation',
  'platty-corpus-quality',
]

function pathFor(...parts) {
  return join(root, ...parts)
}

function read(path) {
  return readFileSync(path, 'utf8')
}

function assertSkillSourceExists(name) {
  const source = pathFor('skills', name, 'SKILL.md')
  assert.equal(existsSync(source), true, `Missing shared skill: skills/${name}/SKILL.md`)
}

function assertMirrorMatches(name) {
  const source = pathFor('skills', name, 'SKILL.md')
  const mirror = pathFor('.codex', 'skills', name, 'SKILL.md')
  assert.equal(existsSync(mirror), true, `Missing Codex mirror: .codex/skills/${name}/SKILL.md`)
  assert.equal(read(mirror), read(source), `Codex mirror drifted: ${name}`)
}

function syncSkill(name) {
  const sourceDir = pathFor('skills', name)
  const mirrorDir = pathFor('.codex', 'skills', name)
  rmSync(mirrorDir, { recursive: true, force: true })
  mkdirSync(pathFor('.codex', 'skills'), { recursive: true })
  cpSync(sourceDir, mirrorDir, { recursive: true })
}

for (const name of expectedSkills) {
  assertSkillSourceExists(name)
  if (checkOnly) {
    assertMirrorMatches(name)
  } else {
    syncSkill(name)
  }
}

if (!checkOnly) {
  for (const name of expectedSkills) assertMirrorMatches(name)
}
```

- [ ] **Step 2: Add package scripts**

Modify `package.json` so the `scripts` object includes these entries:

```json
"sync:agent-skills": "node scripts/sync-agent-skills.mjs",
"check:agent-skills": "node scripts/sync-agent-skills.mjs --check"
```

The full `scripts` object should become:

```json
{
  "build": "node \"$npm_execpath\" run build --workspaces --if-present",
  "test": "node --test tests/**/*.test.mjs && node \"$npm_execpath\" run check:architecture && node \"$npm_execpath\" run check:agent-skills",
  "check:architecture": "node scripts/check-architecture.mjs",
  "sync:agent-skills": "node scripts/sync-agent-skills.mjs",
  "check:agent-skills": "node scripts/sync-agent-skills.mjs --check",
  "typecheck": "tsc -b"
}
```

- [ ] **Step 3: Run sync**

Run:

```bash
npm run sync:agent-skills
```

Expected: command exits `0` and creates mirrored skill directories under `.codex/skills/`.

- [ ] **Step 4: Run check**

Run:

```bash
npm run check:agent-skills
```

Expected: command exits `0`.

- [ ] **Step 5: Run focused contract test**

Run:

```bash
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit sync script and mirror**

Run:

```bash
git add package.json scripts/sync-agent-skills.mjs .codex/skills
git commit -m "feat: sync shared skills to Codex mirror"
```

Expected: commit succeeds.

### Task 6: Full Verification

**Files:**
- No file changes expected.

- [ ] **Step 1: Run agent skill checks**

Run:

```bash
npm run check:agent-skills
```

Expected: PASS.

- [ ] **Step 2: Run focused contract**

Run:

```bash
node --test tests/architecture/agent-skills-cross-runtime-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run full architecture tests**

Run:

```bash
node --test tests/architecture/*.test.mjs
```

Expected: all architecture suites pass.

- [ ] **Step 4: Run root test script**

Run:

```bash
npm test
```

Expected: exits `0` and includes `check:agent-skills` through the root `test` script.

- [ ] **Step 5: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit `0`.

- [ ] **Step 6: Commit any verification-only fixes**

If any verification command required a fix, stage only the files changed for that fix:

```bash
git add <fixed-files>
git commit -m "fix: align Platty skill catalog verification"
```

Expected: commit succeeds only when fixes were needed. If no fixes were needed, skip this step.

## Self-Review

Spec coverage:

- Shared `skills/` source of truth is covered by Tasks 1 and 3.
- Codex runtime packaging is covered by Task 4.
- Claude runtime packaging is covered by Task 4's manifest, hook payload smoke, and explicit packaging-assumption note.
- Current Codex repo-local compatibility is covered by Task 5.
- Skill boundary list from the CLI root-command investigation is covered by Task 3.
- Verification and drift detection are covered by Tasks 1, 5, and 6, including root `npm test`.
- `superpowers:writing-skills` compliance is covered by Task 3's pressure scenario file, fresh baseline worker protocol, RED baseline requirement, one-skill-at-a-time creation rule, focused check after each skill, and separate commit per skill.

Placeholder scan:

- No reserved placeholder markers or unspecified file paths are used.
- Every created file has exact content or is copied from an exact existing path.

Type consistency:

- The expected skill names in the test match the sync script and the planned directories.
- The package script names in the test match the planned `package.json` changes.
- Hook paths in manifests match the planned `hooks/` files.
- The pressure scenario skill names match the planned `skills/<name>/SKILL.md` directories.
- Root `npm test` is planned to run `check:agent-skills`, matching the contract test assertion.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-10-cross-runtime-platty-skills.md`. Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution - execute tasks in this session using executing-plans, batch execution with checkpoints.
