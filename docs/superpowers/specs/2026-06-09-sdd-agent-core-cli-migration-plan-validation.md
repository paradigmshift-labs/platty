# Sdd-Agent Core/Cli Migration Plan Validation

> Status: validated plan for approval. No migration implementation has started in this document.
> Date: 2026-06-09.
> Target branch: `codex-import-sdd-agent-core-cli`.

## Goal

Move the sibling `/Users/pshift/Development/sdd-agent` local engine into this monorepo without carrying over legacy or PoC surfaces:

- `packages/core`: static analysis pipeline, DB/runtime infrastructure, latest generation runtimes, lease/run lifecycle, Codex CLI worker adapter, and fixture/self-improve support code.
- `packages/cli`: local `platty` CLI command surface that calls exported `@platty/core` APIs.
- Exclude: web app, server/API routes, PoC artifacts/export commands, legacy `build_docs`, legacy `sync`, and unrelated generated worktrees/projects.

## Source Of Truth

- Source repository guidance: `/Users/pshift/Development/sdd-agent/AGENTS.md` and `/Users/pshift/Development/sdd-agent/CLAUDE.md`.
- Actual pipeline order: `src/pipeline_modules/analyze_project/index.ts`.
- Latest generation paths:
  - `src/pipeline_modules/build_docs_cli_runtime/**`
  - `src/pipeline_modules/build_docs_generation/**`
  - `src/pipeline_modules/build_epics_core/**`
  - `src/pipeline_modules/build_epics_cli_runtime/**`
  - `src/pipeline_modules/build_business_docs_cli/**`
  - `src/pipeline_modules/generation_runs/**`
  - `src/pipeline_modules/cli_agent_runner/codex_cli.ts`
- Latest sync paths:
  - `src/pipeline_modules/sync_v2/**`
  - CLI-reachable companion sync runtimes: `build_epics_sync/**`, `build_business_docs_sync/**`
- Current target scaffold:
  - `docs/architecture/monorepo.md`
  - `tests/architecture/workspace-contract.test.mjs`
  - `packages/core`, `packages/cli`, `packages/sdk`, `apps/*`

## Subagent Validation Summary

| Agent | Scope | Verdict | Plan impact |
| --- | --- | --- | --- |
| Feynman | Static/core pipeline mapping | Accept with additions | Add `build_pattern_profile`, `project_analysis_v2`, `static_config`, WASM parser assets, route/relations/service-map dependencies. |
| Hume | Latest docs/epics/business-docs runtime boundary | Accept with sequencing caveat | Keep runtimes in core, CLI commands thin; preserve generation leases and Codex CLI schema/result/log handling. |
| Turing | Verification/test strategy | Accept with environment blockers | Add Vitest/native dependency gate; fix missing architecture script; use fake invokers before real Codex. |
| Jason | Critical plan review | Reject original broad phase list | Split foundation, DB/runtime, static pipeline, CLI shell, sync v2, latest generation runtimes, Codex worker, fixtures. |

## Final Scope

### Include In `packages/core`

- DB layer: `src/db/client.ts`, `src/db/schema/**`, migrations, Drizzle helpers, test DB helpers as package-local paths.
- Project/repo/runtime services: `config`, `repo`, `runner`, `pipeline_infra`, `observability`, `project_analysis_v2`, local root/project helpers required by CLI.
- Static pipeline:
  - `analyze_repo`
  - `build_graph`
  - `build_pattern_profile`
  - `build_models`
  - `build_route`
  - `build_relations`
  - `build_service_map`
  - `pipeline_modules/shared/**`, especially `shared/static_config/**`
  - required parser adapters and WASM assets
- Latest sync:
  - `sync_v2/static_map.ts`
  - `sync_v2/doc_sync.ts`
  - `sync_v2/hash.ts`
- Latest docs generation:
  - `build_docs_cli_runtime/**`
  - `build_docs_generation/**`
  - `generation_runs/**`
  - `shared_code_segments` schema/migration support
- Latest EPIC generation:
  - `build_epics_core/**`
  - `build_epics_cli_runtime/**`
  - `build_epics_sync/**`
- Latest business-doc generation:
  - `build_business_docs_cli/**`
  - `build_business_docs_sync/**`
  - business-doc schema/migration support
- Worker execution:
  - `cli_agent_runner/codex_cli.ts`
  - fake/injected task invoker seams for tests
- Fixture/self-improve support, after the core pipeline is stable:
  - `tests/fixture_corpus/**` support modules
  - source fixture predictors under `src/fixture_corpus/**`
  - self-improve oracle/decision/reporting pieces

### Include In `packages/cli`

- Thin command/presentation layer equivalent to:
  - project/repo/init/status/run commands needed for local operation
  - docs commands backed by `BuildDocsCliRuntime` / `BuildDocsGenerationRuntime`
  - epics commands backed by latest `BuildEpicsCliRuntime` and `BuildEpicsSyncRuntime`
  - business-docs commands backed by latest `build_business_docs_cli` and sync runtime
  - runs/status commands backed by core run lifecycle
- CLI command tests using injected DBs and fake task invokers.

### Exclude

- `src/server/**`, backend HTTP API routes, web dashboard code, and browser/API serving surfaces.
- `src/artifacts/**` and artifact CLI commands such as business-map/service-map export PoCs.
- `src/pipeline_modules/legacy_generation/**`.
- Legacy `src/pipeline_modules/sync/**`.
- `src/legacy/**`, `tests/legacy/**`.
- `.sdd/worktrees/**`, `.claude/worktrees/**`, generated `projects/**`, and real-project exhaustive fixtures in early phases.
- Browser E2E and Playwright gates until the local core/CLI migration is already green.

## Validated Migration Phases

### Phase 0: Target Foundation Repair

Goal: make the current monorepo scaffold testable before importing real code.

- Add or repair `scripts/check-architecture.mjs`, because root `package.json` already references it.
- Ensure explicit architecture test command works.
- Decide test runner strategy: source tests are Vitest-based, while target scaffold currently uses Node test.
- Add package/build/dependency plumbing without importing behavior yet.

Verification:

```bash
node --test tests/architecture/workspace-contract.test.mjs
npm run check:architecture
npm run typecheck
npm run build
```

Current known blocker: `npm` is not available on this shell PATH, and `node --test tests` does not work as a directory command in the current scaffold.

### Phase 1: Core Package Infrastructure

Goal: create the dependency, alias, DB, migration, and package-local runtime base that all later phases need.

- Add core dependencies from source: `better-sqlite3`, `drizzle-orm`, `commander`, `fast-glob`, `nanoid`, tree-sitter packages, Codex/OpenAI/Gemini packages only where needed.
- Port DB client, schema, migrations, helpers, enums, and test DB helpers into `packages/core`.
- Preserve migration path logic as package-local, not cwd-dependent.
- Add public core API exports that the CLI can call instead of importing internal paths directly.

Verification:

```bash
vitest run packages/core/tests/db packages/core/tests/pipeline_infra
npm run typecheck --workspace packages/core
npm run build --workspace packages/core
```

### Phase 2: Repo Runtime And Static Pipeline

Goal: port and verify the deterministic static pipeline before generation.

Pipeline order:

```text
analyze_repo
-> build_graph
-> build_pattern_profile
-> build_models
-> build_route
-> build_relations
-> build_service_map
```

Required support:

- `pipeline_modules/shared/**`
- `shared/static_config/**`
- route/build relation adapters and rule/config registries
- parser adapters and WASM assets
- `project_analysis_v2/review_decisions`
- repo/worktree helpers and runner orchestration

Verification:

```bash
vitest run packages/core/tests/pipeline_modules/shared
vitest run packages/core/tests/pipeline_modules/analyze_repo
vitest run packages/core/tests/pipeline_modules/build_graph
vitest run packages/core/tests/pipeline_modules/build_pattern_profile
vitest run packages/core/tests/pipeline_modules/build_models
vitest run packages/core/tests/pipeline_modules/build_route
vitest run packages/core/tests/pipeline_modules/build_relations
vitest run packages/core/tests/pipeline_modules/build_service_map
vitest run packages/core/tests/e2e/runner.test.ts
```

### Phase 3: CLI Foundation Commands

Goal: migrate only CLI shell and local foundation commands after core has stable APIs.

- `init`, project/repo registration, status, static analysis trigger/status, runs list/detail/cancel.
- Do not register full docs/epics/business-docs commands until their runtimes are present.
- Do not import server route code or web/API clients.

Verification:

```bash
vitest run packages/cli/tests/cli/commander-program.test.ts
vitest run packages/cli/tests/cli/argv.test.ts
vitest run packages/cli/tests/cli/project-commands.test.ts
vitest run packages/cli/tests/cli/repo-commands.test.ts
vitest run packages/cli/tests/cli/runs-command.test.ts
```

### Phase 4: Sync V2

Goal: port latest sync only.

- Port `sync_v2/static_map.ts`, `sync_v2/doc_sync.ts`, `sync_v2/hash.ts`.
- Verify `sync_v2/static_map.ts` can run against Phase 2 static outputs.
- Keep legacy `sync/**` excluded.

Verification:

```bash
vitest run packages/core/tests/pipeline_modules/sync_v2
```

### Phase 5: Shared Code Segment Summaries Before Docs

Goal: preserve the common-module summarization step that runs before build-docs planning.

Evidence from source: `BuildDocsGenerationRuntime.start()` calls `rebuildSharedCodeSegmentsForProject()` before planning generation tasks.

- Port `build_docs_generation/shared_segments.ts`.
- Port `shared_code_segments` schema/migrations.
- Verify detection, persistence, loading, source-context compaction, and `shared_context` context-page behavior.

Verification:

```bash
vitest run packages/core/tests/pipeline_modules/build_docs_generation/shared_segments.test.ts
vitest run packages/core/tests/pipeline_modules/build_docs_generation/runtime.test.ts -- -t "shared_context"
```

### Phase 6: Latest Build Docs Runtime

Goal: port latest build-docs, not legacy `build_docs`.

- `build_docs_cli_runtime/**`
- `build_docs_generation/**`
- `generation_runs/**`
- lease engine, context bundle/page persistence, task lease/submit/status/retry/release flows
- fake worker tests before real Codex

Verification:

```bash
vitest run packages/core/tests/pipeline_modules/generation_runs
vitest run packages/core/tests/pipeline_modules/build_docs_generation
vitest run packages/core/tests/pipeline_modules/build_docs_cli_runtime
vitest run packages/cli/tests/cli/docs-commands.test.ts
```

### Phase 7: Latest Build Epics Runtime

Goal: port deterministic EPIC core plus current CLI runtime and sync companion.

- `build_epics_core/**`
- `build_epics_cli_runtime/**`
- `build_epics_sync/**`
- preserve current worker lease/readiness behavior first; converge later only after green tests.

Verification:

```bash
vitest run packages/core/tests/pipeline_modules/build_epics_core
vitest run packages/core/tests/pipeline_modules/build_epics_cli_runtime
vitest run packages/core/tests/pipeline_modules/build_epics_sync
vitest run packages/cli/tests/cli/epics-command.test.ts
```

### Phase 8: Latest Build Business Docs Runtime

Goal: port current business-docs CLI runtime and sync companion.

- `build_business_docs_cli/**`
- `build_business_docs_sync/**`
- keep business-doc generation tables and lifecycle semantics separate from the generic `generation_runs` tables; use adapters at the boundary.
- include lease, lifecycle, preview, quality, review, submit, source refs, worker runner.

Verification:

```bash
vitest run packages/core/tests/pipeline_modules/build_business_docs_cli
vitest run packages/core/tests/pipeline_modules/build_business_docs_sync
vitest run packages/cli/tests/cli/business-docs-command.test.ts
```

### Phase 9: Codex CLI Worker Execution

Goal: preserve the headless-friendly Codex CLI wrapper and parallel worker behavior.

- Port `cli_agent_runner/codex_cli.ts`.
- Preserve schema/result/log file workflow and strict schema normalization.
- Keep real `codex exec` behind opt-in smoke tests; default tests use fake invokers.
- Verify docs/epics/business-docs worker runners can lease, run, submit, retry, and terminate with no-progress safeguards.

Verification:

```bash
vitest run packages/core/tests/pipeline_modules/cli_agent_runner/codex_cli.test.ts
vitest run packages/core/tests/pipeline_modules/build_docs_cli_runtime/worker_runner.test.ts
vitest run packages/core/tests/pipeline_modules/build_epics_cli_runtime/worker_runner.test.ts
vitest run packages/core/tests/pipeline_modules/build_business_docs_cli/fake_worker_e2e.test.ts
```

### Phase 10: Fixture Corpus Base

Goal: port the fixture corpus as a controlled validation harness, not as early migration noise.

- Port fixture registry/load/execution/run-log code.
- Port static-stage runners and small representative fixtures.
- Port CLI commands: `run-fixture`, `batch-report`, `compare`, `gate-check`, `next-candidate`, `audit-queue`.
- Keep full real-project corpus out until the base subset is green.

Verification:

```bash
vitest run packages/core/tests/fixture_corpus/load.test.ts
vitest run packages/core/tests/fixture_corpus/execution_smoke.test.ts
vitest run packages/core/tests/fixture_corpus/runners/static_stages.test.ts
vitest run packages/cli/tests/fixture_corpus/cli
```

### Phase 11: Fixture Self-Improve Loop

Goal: port the self-improvement loop after the fixture base can produce stable results.

- Port self-improve oracle, decision, reports, stage-order, Codex oracle provider, and prompt artifact.
- Port `self_improve_once` CLI behavior.
- Port or adapt `scripts/auto-enrich-loop.ts` only after core/CLI boundaries are clear.
- Gate real Codex oracle behind explicit opt-in; default tests use fake or recorded oracle output.

Verification:

```bash
vitest run packages/core/tests/fixture_corpus/self_improve
vitest run packages/cli/tests/fixture_corpus/cli/__tests__/self_improve_once.test.ts
```

### Phase 12: Package Smoke

Goal: verify the installed CLI shape after core and CLI are green locally.

- Build packages.
- Dry-run pack CLI package.
- Install packed tarball into a temp prefix.
- Run basic local commands.

Verification:

```bash
npm run build
npm pack --dry-run --workspace packages/cli
platty --version --json
platty init --json
```

## Acceptance Criteria

- Architecture boundaries still pass after real imports:
  - `packages/core` does not import CLI, SDK, backend, web, desktop, server routes, or PoC artifacts.
  - `packages/cli` calls public core APIs instead of deep-importing migrated internals.
- Static pipeline runs in the validated order and includes `build_pattern_profile`.
- `sync_v2` is the only technical-doc sync path migrated.
- Latest docs/epics/business-docs CLI runtimes work through lease/status/submit flows.
- Shared code segment summaries are rebuilt before build-docs task planning.
- Codex CLI workers support fake default tests and real opt-in execution.
- Fixture corpus and self-improve loop are migrated in separate, verifiable steps.
- Legacy generation, legacy sync, web/server API, and artifacts PoC code remain excluded.

## Open Decisions Before Implementation

- Whether to add Vitest to the target monorepo as the main migrated test runner, or adapt source tests to Node test over time. Recommendation: add Vitest for parity first, then simplify later.
- Whether `sot_search`, `graph_query`, and `live_code_index` are in the first migration slice. They are CLI-adjacent and useful, but not required for the requested core/docs/epics/business-docs happy path unless selected CLI commands depend on them.
- Whether CLI auth/analytics/cloud API pieces are explicitly out of scope. Recommendation: exclude for this migration unless a local command requires a small config helper.

