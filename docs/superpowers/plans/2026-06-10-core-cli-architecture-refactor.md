# Core/CLI Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the imported SDD-agent core/CLI modules into clean, role-owned Platty package boundaries, restore the missing `docs` CLI surface, and preserve both skill-driven CLI workflows and Codex headless worker execution.

**Architecture:** The refactor groups modules by domain ownership and execution responsibility, not by historical import folder names. CLI commands expose composable user/agent workflows; `@platty/core` owns runtime state, leases, context, submit validation, sync planning, and Codex worker queues. Temporary compatibility shims are allowed only inside a migration phase and must be removed or architecture-checked before completion.

**Tech Stack:** TypeScript, Node.js ESM, Commander, Drizzle SQLite schema, Node test runner, `@platty/core`, `@platty/cli`, Codex CLI worker integration.

---

## Source Of Truth

- Existing migration plan: `docs/superpowers/specs/2026-06-09-sdd-agent-core-cli-migration-plan-validation.md`
- Source project for parity checks: `/Users/pshift/Development/sdd-agent`
- Target project: `/Users/pshift/Development/platty`
- Target branch: `codex-import-sdd-agent-core-cli`

This document covers the structure cleanup after the core/CLI migration work already imported most runtime behavior. It does not reintroduce excluded legacy systems.

Excluded:

- Legacy `build_docs`
- Legacy `sync`
- Web/server API routes
- `src/artifacts` PoC code
- Local project DB assumptions such as `./data/sdd_v2.db`

Required:

- `docs` CLI parity with sdd-agent
- Static pipeline retains `build_pattern_profile`
- `build_docs` start rebuilds shared code segments before task planning
- Skill + CLI workflows do not require CLI-internal LLM calls
- Codex headless worker queues remain available through `codex exec`
- `sync_v2` source is named `sync` in Platty target concepts

---

## Design Review

### Clean Architecture Decision

The clean boundary is:

```text
packages/cli
  owns command parsing, option normalization, JSON/text response rendering

packages/core
  owns domain modules, persistence, runtime lifecycle, sync planning, worker queues

external agent / Codex CLI
  owns LLM reasoning and document drafting when using skill + CLI or headless worker mode
```

CLI must not own generation lifecycle state. Core must not import CLI. Tests should be able to inject task invokers without launching Codex.

### Testability Decision

Every workflow has two testable lanes:

```text
skill + CLI lane:
  start -> worker next -> context get/page -> tasks submit
  no real LLM, no codex process

headless worker lane:
  run --provider codex_cli
  test via injected taskInvoker
  no real codex process in automated tests
```

This keeps unit/integration tests deterministic and makes live Codex smoke tests optional.

### Extensibility Decision

Generation workflows use the same conceptual subfolders:

```text
core     pure domain rules and validation
runtime  run/task/lease/context/submit/status lifecycle
worker   headless worker queue wrappers over runtime
source   upstream input assembly and source projections
sync     incremental stale/missing/orphan planning
```

Not every workflow needs every folder immediately. Empty folders must not be created.

---

## Final Target Structure

```text
packages/core/src/pipeline_modules/
  analyze_repo/
  build_graph/
  build_pattern_profile/
  static_analysis_dsl_discovery/

  build_models/
  build_route/
    review_decisions.ts
    target_inventory.ts

  build_relations/
  build_service_map/

  build_docs/
    runtime/
    worker/
    source/
    sync/

  build_epics/
    core/
    runtime/
    worker/
    sync/
    source/

  build_business_docs/
    core/
    runtime/
    worker/
    sync/
    source/

  generation_runs/
  cli_agent_runner/
  graph_query/
  shared/
```

```text
packages/cli/src/commands/
  docs.ts
  epics.ts
  business-docs.ts
  pipeline.ts
  project.ts
  repo.ts
  runs.ts
```

---

## Ownership Rules

### `build_route`

Owns entry point discovery and review decisions for route/page/job/event targets.

Move here:

```text
packages/core/src/project_analysis_v2/review_decisions.ts
packages/core/src/project_analysis_v2/target_inventory.ts
```

Target:

```text
packages/core/src/pipeline_modules/build_route/review_decisions.ts
packages/core/src/pipeline_modules/build_route/target_inventory.ts
```

Reason:

- `analysis_review_decisions` are decisions on `entry_points`.
- `entry_points` are produced by `build_route`.
- `build_docs` and `build_epics` consume those decisions but do not own them.

### `pipeline_infra`

Owns parent/child run relationship tracking.

Move here:

```text
packages/core/src/project_analysis_v2/run_links.ts
```

Target:

```text
packages/core/src/pipeline_infra/execution/run_links.ts
```

Reason:

- Run links connect pipeline runs.
- They are not project-analysis review state.

### `build_docs`

Owns technical document generation runtime, source context assembly, worker queue, and technical doc sync planning.

Target examples:

```text
packages/core/src/pipeline_modules/build_docs/runtime/
packages/core/src/pipeline_modules/build_docs/worker/
packages/core/src/pipeline_modules/build_docs/source/
packages/core/src/pipeline_modules/build_docs/sync/
```

### `build_epics`

Owns EPIC generation domain rules, runtime lifecycle, worker queue, and EPIC sync.

Target examples:

```text
packages/core/src/pipeline_modules/build_epics/core/
packages/core/src/pipeline_modules/build_epics/runtime/
packages/core/src/pipeline_modules/build_epics/worker/
packages/core/src/pipeline_modules/build_epics/source/
packages/core/src/pipeline_modules/build_epics/sync/
```

### `build_business_docs`

Owns business document generation domain rules, runtime lifecycle, worker queue, source projections, and business-doc sync.

Target examples:

```text
packages/core/src/pipeline_modules/build_business_docs/core/
packages/core/src/pipeline_modules/build_business_docs/runtime/
packages/core/src/pipeline_modules/build_business_docs/worker/
packages/core/src/pipeline_modules/build_business_docs/source/
packages/core/src/pipeline_modules/build_business_docs/sync/
```

### `static_analysis_dsl_discovery`

Keep top-level under `pipeline_modules`.

Reason:

- It consumes `build_pattern_profile` but is an optional discovery loop, not the deterministic profile builder itself.
- It has author injection, prompt parsing, promotion, telemetry, and fixture-lane behavior.
- Keeping it top-level prevents `build_pattern_profile` from owning optional agent/discovery concerns.

---

## Docs CLI Required Surface

`/Users/pshift/Development/sdd-agent/src/cli/commands/docs.ts` is the source behavior.

Platty must expose:

```text
platty docs shared-segments rebuild
platty docs shared-segments list

platty docs targets list
platty docs targets deprecate
platty docs targets include

platty docs start
platty docs run
platty docs worker next
platty docs context get
platty docs context page
platty docs tasks lease
platty docs tasks submit
platty docs preview
platty docs approve
platty docs status
platty docs cancel
platty docs leases release

platty docs list
platty docs search
platty docs export
```

Expected behavior:

- `docs worker next`, `docs context get/page`, and `docs tasks submit` support pure skill + CLI operation.
- `docs run --provider codex_cli --workers N` supports Codex headless parallel execution.
- `docs run --provider claude_code` fails unless a test/integration harness injects `docsTaskInvoker`.
- Automated tests inject `docsTaskInvoker`; they must not spawn `codex`.

---

## Migration Phases

### Task 1: Add Docs CLI Safety Tests

**Files:**

- Create: `packages/cli/tests/docs/command-routing.test.ts`
- Create: `packages/cli/tests/docs/run-with-injected-invoker.test.ts`
- Modify only if needed: `packages/cli/package.json`

- [x] **Step 1: Write failing routing tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runPlattyCommand } from '../../src/main.js'

describe('docs command routing', () => {
  it('routes docs root instead of returning UNKNOWN_COMMAND', async () => {
    const response = await runPlattyCommand(['docs', '--json'], { cwd: process.cwd() })
    assert.notEqual(response.result.ok, true)
    assert.notEqual(response.result.error?.code, 'UNKNOWN_COMMAND')
  })
})
```

- [x] **Step 2: Run test and verify current failure**

Run:

```bash
npm run test --workspace packages/cli -- tests/docs/command-routing.test.ts
```

Expected:

```text
FAIL
actual error code is UNKNOWN_COMMAND
```

- [x] **Step 3: Commit test-only failure if using strict TDD branch checkpoints**

```bash
git add packages/cli/tests/docs/command-routing.test.ts
git commit -m "test(cli): cover docs command routing"
```

Skipped red-test-only commit; this branch keeps commits green.

---

### Task 2: Restore Docs CLI Command Surface

**Files:**

- Create: `packages/cli/src/commands/docs.ts`
- Modify: `packages/cli/src/program.ts`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/core/src/index.ts` if `BuildDocsTaskInvoker` is not exported
- Test: `packages/cli/tests/docs/command-routing.test.ts`
- Test: `packages/cli/tests/docs/run-with-injected-invoker.test.ts`

- [x] **Step 1: Add `docsTaskInvoker` to CLI run options**

In `packages/cli/src/main.ts`, extend imports and options:

```ts
import type { BuildDocsTaskInvoker, BuildEpicsTaskInvoker, BusinessDocsTaskInvoker, DB, OpenPlattyDbResult } from '@platty/core'

export interface PlattyCommandRunOptions {
  cwd?: string
  db?: DB
  openDb?: () => OpenPlattyDbResult
  analyticsRecorder?: null
  now?: () => Date
  staticPipelineRunner?: StaticPipelineRunner
  docsTaskInvoker?: BuildDocsTaskInvoker
  epicsTaskInvoker?: BuildEpicsTaskInvoker
  businessDocsTaskInvoker?: BusinessDocsTaskInvoker
}
```

- [x] **Step 2: Add `docs` root to commander dispatch**

In `packages/cli/src/program.ts`, update roots:

```ts
const PUBLIC_COMMAND_ROOTS = new Set(['business-docs', 'corpus', 'docs', 'epics', 'init', 'project', 'repo', 'run', 'runs', 'status', 'version'])
```

Add command registration near `epics` and `business-docs`:

```ts
setAction(configurePassthrough(program.command('docs').description('Run and inspect technical-document generation workflows.')), async () => {
  const { runDocsCommand } = await import('./commands/docs.js')
  return runDocsCommand(commandArgvAfter('docs', stripGlobalFlags(_argv)), {
    cwd: _options.cwd,
    db: _options.db,
    openDb: _options.openDb,
    project: value(_argv, '--project'),
    docsTaskInvoker: _options.docsTaskInvoker,
  })
}, setResponse)
```

- [x] **Step 3: Port `runDocsCommand`**

Create `packages/cli/src/commands/docs.ts` from `/Users/pshift/Development/sdd-agent/src/cli/commands/docs.ts`, adapting:

```ts
import {
  BuildDocsCliRuntime,
  runBuildDocsWorkerQueue,
  rebuildSharedCodeSegmentsForProject,
  parseDraftJsonWithRepair,
  listDocsTargets,
  normalizeDocsTargetKind,
  resolveDocsTargetSelectors,
  upsertAnalysisReviewDecision,
  type BuildDocsRunnerPreset,
  type BuildDocsRunnerProvider,
  type BuildDocsTaskInvoker,
  type DB,
  type OpenPlattyDbResult,
} from '@platty/core'
```

Use `openCliDb()` from `../db.js`, not sdd-agent `openLocalPlattyDb`.

- [x] **Step 4: Run docs CLI tests**

```bash
npm run test --workspace packages/cli -- tests/docs
```

Expected:

```text
PASS
```

- [x] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected:

```text
exit code 0
```

- [x] **Step 6: Commit**

```bash
git add packages/cli/src/main.ts packages/cli/src/program.ts packages/cli/src/commands/docs.ts packages/cli/tests/docs
git commit -m "feat(cli): add docs command surface"
```

---

### Task 3: Move Review Decisions Under Build Route

**Files:**

- Move: `packages/core/src/project_analysis_v2/review_decisions.ts` -> `packages/core/src/pipeline_modules/build_route/review_decisions.ts`
- Move: `packages/core/src/project_analysis_v2/target_inventory.ts` -> `packages/core/src/pipeline_modules/build_route/target_inventory.ts`
- Modify imports in `packages/core/src/pipeline_modules/build_docs_generation/**`
- Modify imports in `packages/core/src/pipeline_modules/build_epics_core/**`
- Modify imports in `packages/cli/src/commands/docs.ts`
- Test: move `packages/core/tests/project_analysis_v2/review_decisions.test.ts` -> `packages/core/tests/pipeline_modules/build_route/review_decisions.test.ts`

- [x] **Step 1: Move files with compatibility shims**

New shim content for `packages/core/src/project_analysis_v2/review_decisions.ts`:

```ts
export * from '@/pipeline_modules/build_route/review_decisions.js'
```

New shim content for `packages/core/src/project_analysis_v2/target_inventory.ts`:

```ts
export * from '@/pipeline_modules/build_route/target_inventory.js'
```

- [x] **Step 2: Update imports**

Replace:

```ts
@/project_analysis_v2/review_decisions.js
@/project_analysis_v2/target_inventory.js
```

With:

```ts
@/pipeline_modules/build_route/review_decisions.js
@/pipeline_modules/build_route/target_inventory.js
```

- [x] **Step 3: Run targeted tests**

```bash
npm run test --workspace packages/core -- tests/pipeline_modules/build_route tests/pipeline_modules/build_docs_generation tests/pipeline_modules/build_epics_core
```

Expected:

```text
PASS
```

- [x] **Step 4: Commit**

```bash
git add packages/core/src/project_analysis_v2 packages/core/src/pipeline_modules/build_route packages/core/tests/pipeline_modules/build_route packages/core/src/pipeline_modules/build_docs_generation packages/core/src/pipeline_modules/build_epics_core packages/cli/src/commands/docs.ts
git commit -m "refactor(core): move target review under build_route"
```

---

### Task 4: Move Run Links Into Pipeline Infra

**Files:**

- Move implementation from `packages/core/src/project_analysis_v2/run_links.ts`
- Modify: `packages/core/src/pipeline_infra/execution/run_links.ts`
- Modify imports referencing `@/project_analysis_v2/run_links.js`
- Test: move `packages/core/tests/project_analysis_v2/run_links.test.ts` -> `packages/core/tests/pipeline_infra/run_links.test.ts`

- [x] **Step 1: Replace re-export with implementation**

`packages/core/src/pipeline_infra/execution/run_links.ts` should own the actual implementation currently in `project_analysis_v2/run_links.ts`.

- [x] **Step 2: Add temporary shim**

`packages/core/src/project_analysis_v2/run_links.ts`:

```ts
export * from '@/pipeline_infra/execution/run_links.js'
```

- [x] **Step 3: Run targeted tests**

```bash
npm run test --workspace packages/core -- tests/pipeline_infra/run_links.test.ts tests/pipeline_infra/pipeline_execution.test.ts
```

Expected:

```text
PASS
```

- [x] **Step 4: Commit**

```bash
git add packages/core/src/pipeline_infra packages/core/src/project_analysis_v2 packages/core/tests/pipeline_infra
git commit -m "refactor(core): move run links into pipeline infra"
```

---

### Task 5: Group Business Docs Sync Under Business Docs

**Files:**

- Move: `packages/core/src/pipeline_modules/build_business_docs_sync/*`
- Target: `packages/core/src/pipeline_modules/build_business_docs/sync/*`
- Modify imports in `packages/cli/src/commands/business-docs.ts`
- Modify exports in `packages/core/src/index.ts`

- [x] **Step 1: Move sync files**

Target paths:

```text
packages/core/src/pipeline_modules/build_business_docs/sync/preview.ts
packages/core/src/pipeline_modules/build_business_docs/sync/start.ts
packages/core/src/pipeline_modules/build_business_docs/sync/impact.ts
packages/core/src/pipeline_modules/build_business_docs/sync/source_hashes.ts
packages/core/src/pipeline_modules/build_business_docs/sync/types.ts
packages/core/src/pipeline_modules/build_business_docs/sync/index.ts
```

- [x] **Step 2: Add temporary shim**

`packages/core/src/pipeline_modules/build_business_docs_sync/index.ts`:

```ts
export * from '@/pipeline_modules/build_business_docs/sync/index.js'
```

- [x] **Step 3: Update public exports**

In `packages/core/src/index.ts`, replace:

```ts
export * from './pipeline_modules/build_business_docs_sync/index.js'
```

With:

```ts
export * from './pipeline_modules/build_business_docs/sync/index.js'
```

- [x] **Step 4: Run targeted tests**

```bash
npm run test --workspace packages/core -- tests/pipeline_modules/build_business_docs/sync tests/pipeline_modules/build_business_docs_cli
npm run test --workspace packages/cli -- tests/business-docs
```

Expected:

```text
PASS
```

- [x] **Step 5: Commit**

```bash
git add packages/core/src/pipeline_modules/build_business_docs packages/core/src/pipeline_modules/build_business_docs_sync packages/core/src/index.ts packages/cli/src/commands/business-docs.ts packages/core/tests packages/cli/tests
git commit -m "refactor(core): move business docs sync under workflow"
```

---

### Task 6: Group Build Docs Modules

**Files:**

- Move: `packages/core/src/pipeline_modules/build_docs_generation/*`
- Move: `packages/core/src/pipeline_modules/build_docs_cli_runtime/*`
- Target:
  - `packages/core/src/pipeline_modules/build_docs/runtime/*`
  - `packages/core/src/pipeline_modules/build_docs/worker/*`
  - `packages/core/src/pipeline_modules/build_docs/source/*`
- Modify exports in `packages/core/src/index.ts`
- Modify docs CLI imports if needed

- [ ] **Step 1: Move runtime files**

Move lifecycle files to:

```text
packages/core/src/pipeline_modules/build_docs/runtime/
```

Examples:

```text
runtime.ts
types.ts
draft_contract.ts
draft_json_repair.ts
quality_audit.ts
materialize_document_graph.ts
persist_helpers.ts
```

- [ ] **Step 2: Move worker files**

Move:

```text
build_docs_cli_runtime/worker_runner.ts
build_docs_cli_runtime/runtime.ts
```

To:

```text
build_docs/worker/worker_runner.ts
build_docs/runtime/cli_runtime.ts
```

The class may remain named `BuildDocsCliRuntime` for API compatibility during migration, but the file path should no longer say `cli_runtime`.

- [ ] **Step 3: Move source assembly files**

Move context/source files to:

```text
build_docs/source/
```

Examples:

```text
context_builder.ts
source_closure.ts
source_links.ts
shared_segments.ts
service_map_facts.ts
system_merge.ts
relation_compactor.ts
agent_packet.ts
target_selector.ts
```

- [ ] **Step 4: Add temporary shims**

`packages/core/src/pipeline_modules/build_docs_generation/index.ts`:

```ts
export * from '@/pipeline_modules/build_docs/runtime/index.js'
export * from '@/pipeline_modules/build_docs/source/index.js'
```

`packages/core/src/pipeline_modules/build_docs_cli_runtime/index.ts`:

```ts
export * from '@/pipeline_modules/build_docs/runtime/cli_runtime.js'
export * from '@/pipeline_modules/build_docs/worker/index.js'
```

- [ ] **Step 5: Run tests**

```bash
npm run test --workspace packages/core -- tests/pipeline_modules/build_docs_generation
npm run test --workspace packages/cli -- tests/docs
npm run typecheck
```

Expected:

```text
PASS
exit code 0
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline_modules/build_docs packages/core/src/pipeline_modules/build_docs_generation packages/core/src/pipeline_modules/build_docs_cli_runtime packages/core/src/index.ts packages/core/tests packages/cli/tests packages/cli/src/commands/docs.ts
git commit -m "refactor(core): group build docs modules"
```

---

### Task 7: Group Build Epics Modules

**Files:**

- Move: `packages/core/src/pipeline_modules/build_epics_core/*`
- Move: `packages/core/src/pipeline_modules/build_epics_cli_runtime/*`
- Move: `packages/core/src/pipeline_modules/build_epics_sync/*`
- Target: `packages/core/src/pipeline_modules/build_epics/{core,runtime,worker,source,sync}/`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/cli/src/commands/epics.ts`

- [ ] **Step 1: Move core files**

Target:

```text
packages/core/src/pipeline_modules/build_epics/core/
```

- [ ] **Step 2: Move runtime files**

Target:

```text
packages/core/src/pipeline_modules/build_epics/runtime/
```

Include:

```text
runtime.ts
lifecycle-style task/context/submit support files
```

- [ ] **Step 3: Move worker files**

Target:

```text
packages/core/src/pipeline_modules/build_epics/worker/
```

Include:

```text
worker_runner.ts
```

- [ ] **Step 4: Move source assembly files**

Target:

```text
packages/core/src/pipeline_modules/build_epics/source/
```

Include files such as:

```text
cards.ts
draft.ts
editing.ts
taxonomy_consolidation.ts
cross_domain.ts
```

Only move a file to `source` when it primarily assembles agent input or draft material. Keep validation and persistence in `core`.

- [ ] **Step 5: Move sync files**

Target:

```text
packages/core/src/pipeline_modules/build_epics/sync/
```

- [ ] **Step 6: Add temporary shims**

Keep old top-level index files as re-exports for one phase.

- [ ] **Step 7: Run tests**

```bash
npm run test --workspace packages/core -- tests/pipeline_modules/build_epics_core tests/pipeline_modules/build_epics_cli_runtime tests/pipeline_modules/build_epics_sync
npm run test --workspace packages/cli -- tests/epics
npm run typecheck
```

Expected:

```text
PASS
exit code 0
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/pipeline_modules/build_epics packages/core/src/pipeline_modules/build_epics_core packages/core/src/pipeline_modules/build_epics_cli_runtime packages/core/src/pipeline_modules/build_epics_sync packages/core/src/index.ts packages/cli/src/commands/epics.ts packages/core/tests packages/cli/tests
git commit -m "refactor(core): group build epics modules"
```

---

### Task 8: Group Build Business Docs Modules

**Files:**

- Move: `packages/core/src/pipeline_modules/build_business_docs_cli/*`
- Target: `packages/core/src/pipeline_modules/build_business_docs/{core,runtime,worker,source}/`
- Sync already moved in Task 5
- Modify: `packages/core/src/index.ts`
- Modify: `packages/cli/src/commands/business-docs.ts`

- [ ] **Step 1: Move runtime files**

Target:

```text
packages/core/src/pipeline_modules/build_business_docs/runtime/
```

Include:

```text
start.ts
lease.ts
submit.ts
lifecycle.ts
preview.ts
review.ts
types.ts
```

- [ ] **Step 2: Move worker files**

Target:

```text
packages/core/src/pipeline_modules/build_business_docs/worker/
```

Include:

```text
worker_runner.ts
```

- [ ] **Step 3: Move source files**

Target:

```text
packages/core/src/pipeline_modules/build_business_docs/source/
```

Move:

```text
sot/*
source_refs.ts
sot/source_graph.ts
sot/projections.ts
```

- [ ] **Step 4: Move core files**

Target:

```text
packages/core/src/pipeline_modules/build_business_docs/core/
```

Include validation/quality/domain helpers when they are not runtime-specific:

```text
quality.ts
```

- [ ] **Step 5: Add temporary shim**

`packages/core/src/pipeline_modules/build_business_docs_cli/index.ts`:

```ts
export * from '@/pipeline_modules/build_business_docs/runtime/index.js'
export * from '@/pipeline_modules/build_business_docs/worker/index.js'
export * from '@/pipeline_modules/build_business_docs/source/index.js'
export * from '@/pipeline_modules/build_business_docs/core/index.js'
```

- [ ] **Step 6: Run tests**

```bash
npm run test --workspace packages/core -- tests/pipeline_modules/build_business_docs_cli tests/pipeline_modules/build_business_docs
npm run test --workspace packages/cli -- tests/business-docs
npm run typecheck
```

Expected:

```text
PASS
exit code 0
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pipeline_modules/build_business_docs packages/core/src/pipeline_modules/build_business_docs_cli packages/core/src/index.ts packages/cli/src/commands/business-docs.ts packages/core/tests packages/cli/tests
git commit -m "refactor(core): group business docs modules"
```

---

### Task 9: Restore Optional Static Analysis DSL Discovery

**Files:**

- Copy/adapt from source: `/Users/pshift/Development/sdd-agent/src/pipeline_modules/static_analysis_dsl_discovery/*`
- Create: `packages/core/src/pipeline_modules/static_analysis_dsl_discovery/*`
- Copy/adapt tests from: `/Users/pshift/Development/sdd-agent/tests/pipeline_modules/static_analysis_dsl_discovery/*`
- Create tests under: `packages/core/tests/pipeline_modules/static_analysis_dsl_discovery/*`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Port module files**

Expected files:

```text
agent_output.ts
agent_prompt.ts
clustering.ts
coverage_gap.ts
index.ts
projections.ts
promote.ts
promote_candidates.ts
telemetry.ts
types.ts
```

- [ ] **Step 2: Keep default pipeline deterministic**

Do not add `static_analysis_dsl_discovery` to `STATIC_PIPELINE_STAGES` by default unless the source migration plan explicitly changes this requirement.

- [ ] **Step 3: Run targeted tests**

```bash
npm run test --workspace packages/core -- tests/pipeline_modules/static_analysis_dsl_discovery
npm run typecheck
```

Expected:

```text
PASS
exit code 0
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pipeline_modules/static_analysis_dsl_discovery packages/core/tests/pipeline_modules/static_analysis_dsl_discovery packages/core/src/index.ts
git commit -m "feat(core): add static analysis dsl discovery"
```

---

### Task 10: Enforce Architecture Boundaries

**Files:**

- Modify: `scripts/check-architecture.mjs`
- Modify tests if present: `tests/architecture/workspace-contract.test.mjs`

- [ ] **Step 1: Add forbidden import checks**

Rules:

```text
project_analysis_v2 imports forbidden outside temporary shim tests
pipeline_modules/build_docs_generation imports forbidden
pipeline_modules/build_docs_cli_runtime imports forbidden
pipeline_modules/build_epics_core imports forbidden
pipeline_modules/build_epics_cli_runtime imports forbidden
pipeline_modules/build_epics_sync imports forbidden
pipeline_modules/build_business_docs_cli imports forbidden
pipeline_modules/build_business_docs_sync imports forbidden
sync_v2 path/name forbidden in Platty target code
packages/core importing packages/cli forbidden
packages/cli importing core internals forbidden; CLI should use @platty/core public exports
```

- [ ] **Step 2: Run architecture check**

```bash
node scripts/check-architecture.mjs
```

Expected:

```text
Architecture check passed
```

- [ ] **Step 3: Commit**

```bash
git add scripts/check-architecture.mjs tests/architecture/workspace-contract.test.mjs
git commit -m "test: enforce core cli architecture boundaries"
```

---

### Task 11: Remove Temporary Shims

**Files:**

- Delete old compatibility modules once all imports are migrated:
  - `packages/core/src/project_analysis_v2/*`
  - `packages/core/src/pipeline_modules/build_docs_generation/*`
  - `packages/core/src/pipeline_modules/build_docs_cli_runtime/*`
  - `packages/core/src/pipeline_modules/build_epics_core/*`
  - `packages/core/src/pipeline_modules/build_epics_cli_runtime/*`
  - `packages/core/src/pipeline_modules/build_epics_sync/*`
  - `packages/core/src/pipeline_modules/build_business_docs_cli/*`
  - `packages/core/src/pipeline_modules/build_business_docs_sync/*`

- [ ] **Step 1: Confirm no imports remain**

```bash
rg -n "project_analysis_v2|build_docs_generation|build_docs_cli_runtime|build_epics_core|build_epics_cli_runtime|build_epics_sync|build_business_docs_cli|build_business_docs_sync|sync_v2" packages scripts tests
```

Expected:

```text
Only changelog/plan references remain, or no matches in source/test files.
```

- [ ] **Step 2: Delete shims**

Use `apply_patch` deletion or `git rm` for tracked files.

- [ ] **Step 3: Run full verification**

```bash
npm run typecheck
node scripts/check-architecture.mjs
npm run test --workspaces --if-present
npm test
npm run build
```

Expected:

```text
All commands exit 0.
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(core): remove legacy module shims"
```

---

## Final Verification Matrix

Run after every structural phase:

```bash
npm run typecheck
node scripts/check-architecture.mjs
```

Run before final completion:

```bash
npm run test --workspace packages/core -- tests/pipeline_modules/build_route
npm run test --workspace packages/core -- tests/pipeline_modules/build_docs
npm run test --workspace packages/core -- tests/pipeline_modules/build_epics
npm run test --workspace packages/core -- tests/pipeline_modules/build_business_docs
npm run test --workspace packages/cli -- tests/docs tests/epics tests/business-docs
npm run test --workspaces --if-present
npm test
npm run build
```

Expected final evidence:

```text
typecheck: exit 0
architecture: Architecture check passed
workspace tests: pass
full build: exit 0
```

---

## Risk Register

### Risk: Path-only refactor hides behavior changes

Mitigation:

- Move one workflow at a time.
- Keep temporary shims for one phase.
- Run targeted tests before moving the next workflow.

### Risk: CLI imports core internals after folder move

Mitigation:

- Export stable APIs from `packages/core/src/index.ts`.
- Architecture check forbids `@platty/core/dist` and `@/pipeline_modules` style imports from CLI.

### Risk: Real Codex execution accidentally runs in tests

Mitigation:

- Worker queue tests must inject task invokers.
- Tests assert no `codex` process is spawned by default.

### Risk: `project_analysis_v2` removal breaks persisted DB schema naming

Mitigation:

- Do not rename database tables in this refactor.
- Module/folder names can change while schema table names stay stable.
- `analysis_review_decisions` and `pipeline_run_links` remain as-is unless a separate migration plan is approved.

### Risk: Over-splitting files into empty folders

Mitigation:

- Create only folders that receive real files.
- If a workflow has no separate `core` yet, do not create `core`.

---

## Completion Criteria

The refactor is complete when:

- `platty docs` command exists and supports skill + CLI and injected-worker test flows.
- No source/test imports reference `project_analysis_v2`.
- No source/test imports reference old top-level generation folders.
- `build_route` owns review decisions and target inventory.
- `pipeline_infra` owns run links.
- `build_docs`, `build_epics`, and `build_business_docs` use consistent responsibility folders.
- Architecture check enforces the new boundaries.
- Full test/typecheck/build verification passes.
