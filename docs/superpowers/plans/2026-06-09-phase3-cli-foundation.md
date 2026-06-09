# Phase 3 CLI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable local `platty` CLI shell for project/repo registration, static analysis status/run shortcuts, and run lifecycle inspection without importing server/web/legacy surfaces.

**Architecture:** `packages/cli` remains a thin command and presentation layer. It opens the explicit global core DB through `@platty/core`, calls exported core APIs, and does not import internal `packages/core/src/**` paths. Static analysis execution is exposed from core as a deterministic Phase 2 pipeline runner over `analyze_repo -> build_graph -> build_pattern_profile -> build_models -> build_route -> build_relations -> build_service_map`.

**Tech Stack:** TypeScript ESM, Commander, Node test or Vitest for CLI tests, `@platty/core` public exports, Drizzle SQLite through core DB helpers.

---

## Scope Locks

- Use source of truth plan: `docs/superpowers/specs/2026-06-09-sdd-agent-core-cli-migration-plan-validation.md`.
- Do not port `src/server/**`, HTTP API routes, web code, `src/artifacts/**`, legacy `pipeline_modules/legacy_generation/**`, or legacy `pipeline_modules/sync/**`.
- Do not port docs/epics/business-docs commands in Phase 3.
- Do not copy source CLI `localDbPath: '.platty/platty.db'` behavior. The CLI must use the global DB default from core: `~/.platty/platty.db`, with `PLATTY_HOME` and `PLATTY_DB_PATH` overrides.
- Do not make CLI commands import `@/db/*` or `@/pipeline_modules/*`. CLI imports only from `@platty/core` plus local CLI files.

## File Map

- Modify: `packages/core/src/index.ts`
  - Export project/repo service functions, static pipeline runner, and run lifecycle helpers needed by CLI.
- Create: `packages/core/src/project_service.ts`
  - Owns create/list/select/summarize project DB operations.
- Create: `packages/core/src/repository_service.ts`
  - Owns add/list/update/remove repository DB operations and source-root normalization.
- Create: `packages/core/src/static_pipeline.ts`
  - Runs Phase 2 deterministic static pipeline for one repo or all repos in a project.
- Create: `packages/core/src/run_service.ts`
  - Lists run rows and cancels active runs.
- Modify: `packages/cli/package.json`
  - Add `commander` dependency if not already available through workspace install.
- Replace: `packages/cli/src/main.ts`
  - Real CLI entrypoint with `runPlattyCommand()`.
- Create: `packages/cli/src/program.ts`
  - Commander dispatch for `init`, `project`, `repo`, `status`, `run`, `runs`.
- Create: `packages/cli/src/argv.ts`
  - Small argv helpers copied/adapted from source CLI.
- Create: `packages/cli/src/output.ts`
  - Stable JSON/text result envelope.
- Create: `packages/cli/src/config-store.ts`
  - Project-root marker/config only. No project-local DB path.
- Create: `packages/cli/src/project-root.ts`
  - Locate `.platty/config.json` or git root for init.
- Create: `packages/cli/src/db.ts`
  - Opens core DB via `openPlattyDb()` and closes it.
- Create: `packages/cli/src/commands/init.ts`
  - Initializes `.platty/config.json` with project root/current project only.
- Create: `packages/cli/src/commands/project.ts`
  - `create`, `list`, `use`, `status`.
- Create: `packages/cli/src/commands/repo.ts`
  - `add`, `list`, `remove`, `update`.
- Create: `packages/cli/src/commands/pipeline.ts`
  - `status`, `run --step-only`.
- Create: `packages/cli/src/commands/runs.ts`
  - `list`, `show`, `cancel`.
- Create: `packages/cli/tests/*.test.ts`
  - CLI tests copied/adapted from source Phase 3 subset using injected test DBs.

---

### Task 0: Commit Or Stash Phase 2 Before Editing

**Files:**
- Inspect only.

- [ ] **Step 1: Check worktree**

Run:

```bash
git status --short
```

Expected: Phase 2 files are present and there are no unrelated user edits mixed into files that Phase 3 will modify.

- [ ] **Step 2: Commit Phase 2 when approved**

Run:

```bash
git add package-lock.json packages/core scripts/check-architecture.mjs
git commit -m "feat(core): import static analysis pipeline"
```

Expected: commit succeeds. If the user wants to review first, stop before this step.

---

### Task 1: Add Core Project And Repository Services

**Files:**
- Create: `packages/core/src/project_service.ts`
- Create: `packages/core/src/repository_service.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/project_service.test.ts`
- Test: `packages/core/tests/repository_service.test.ts`

- [ ] **Step 1: Write failing project service tests**

Create `packages/core/tests/project_service.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createTestPlattyDb } from '../src/db/testing.js'
import { createProject, listProjects, resolveProjectSelector } from '../src/project_service.js'

describe('project_service', () => {
  it('creates and resolves projects by id, name, and slug', () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'My App', description: 'demo' })

    expect(project.name).toBe('My App')
    expect(project.description).toBe('demo')
    expect(listProjects(client.db)).toHaveLength(1)
    expect(resolveProjectSelector(client.db, project.id).project?.id).toBe(project.id)
    expect(resolveProjectSelector(client.db, 'My App').project?.id).toBe(project.id)
    expect(resolveProjectSelector(client.db, 'my-app').project?.id).toBe(project.id)

    client.close()
  })
})
```

- [ ] **Step 2: Write failing repository service tests**

Create `packages/core/tests/repository_service.test.ts`:

```ts
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createTestPlattyDb } from '../src/db/testing.js'
import { createProject } from '../src/project_service.js'
import { addRepository, listRepositories } from '../src/repository_service.js'

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'platty-cli-repo-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  return dir
}

describe('repository_service', () => {
  it('adds a git repository to a project with normalized sourceRoot', () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'My App' })
    const repoPath = gitRepo()

    const repo = addRepository(client.db, {
      projectId: project.id,
      path: repoPath,
      name: 'api',
      sourceRoot: '.',
      cwd: repoPath,
    })

    expect(repo.repoPath).toBe(realpathSync.native(repoPath))
    expect(repo.sourceRoot).toBeNull()
    expect(listRepositories(client.db, project.id)).toHaveLength(1)

    client.close()
  })
})
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npm run test --workspace packages/core -- tests/project_service.test.ts tests/repository_service.test.ts
```

Expected: FAIL because `project_service.js` and `repository_service.js` do not exist.

- [ ] **Step 4: Implement minimal services from source patterns**

Implement `project_service.ts` with `createProject`, `listProjects`, `resolveProjectSelector`, `projectPointer`, `slugify`.

Implement `repository_service.ts` with `addRepository`, `listRepositories`, `normalizeSourceRoot`, git-root validation, and no CLI output formatting.

- [ ] **Step 5: Export services**

Add to `packages/core/src/index.ts`:

```ts
export * from './project_service.js'
export * from './repository_service.js'
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run test --workspace packages/core -- tests/project_service.test.ts tests/repository_service.test.ts
npm run typecheck --workspace packages/core
```

Expected: both pass.

---

### Task 2: Add Core Static Pipeline Runner

**Files:**
- Create: `packages/core/src/static_pipeline.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/static_pipeline.test.ts`

- [ ] **Step 1: Write failing runner order test**

Create `packages/core/tests/static_pipeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { STATIC_PIPELINE_STAGES } from '../src/static_pipeline.js'

describe('static_pipeline', () => {
  it('keeps build_pattern_profile between build_graph and build_models', () => {
    expect(STATIC_PIPELINE_STAGES).toEqual([
      'analyze_repo',
      'build_graph',
      'build_pattern_profile',
      'build_models',
      'build_route',
      'build_relations',
      'build_service_map',
    ])
  })
})
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm run test --workspace packages/core -- tests/static_pipeline.test.ts
```

Expected: FAIL because `static_pipeline.js` does not exist.

- [ ] **Step 3: Implement static pipeline API**

Create `packages/core/src/static_pipeline.ts` with:

```ts
export const STATIC_PIPELINE_STAGES = [
  'analyze_repo',
  'build_graph',
  'build_pattern_profile',
  'build_models',
  'build_route',
  'build_relations',
  'build_service_map',
] as const
```

Then add `runStaticPipelineForRepository()` using the exported Phase 2 runners. It must await `runAnalyzeRepo(...).completion` and `runBuildGraph(...).completion`, then await the promise-based stages.

- [ ] **Step 4: Export static pipeline**

Add to `packages/core/src/index.ts`:

```ts
export * from './static_pipeline.js'
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run test --workspace packages/core -- tests/static_pipeline.test.ts
npm run typecheck --workspace packages/core
```

Expected: pass.

---

### Task 3: Build CLI Shell With Global DB Opening

**Files:**
- Modify: `packages/cli/package.json`
- Replace: `packages/cli/src/main.ts`
- Create: `packages/cli/src/argv.ts`
- Create: `packages/cli/src/output.ts`
- Create: `packages/cli/src/program.ts`
- Create: `packages/cli/src/db.ts`
- Test: `packages/cli/tests/argv.test.ts`
- Test: `packages/cli/tests/commander-program.test.ts`

- [ ] **Step 1: Write failing argv tests**

Create `packages/cli/tests/argv.test.ts`:

```ts
import { describe, expect, it } from 'node:test'
import assert from 'node:assert/strict'
import { stripGlobalFlags, commandArgvAfter } from '../src/argv.js'

describe('argv helpers', () => {
  it('strips global json/project/root flags', () => {
    assert.deepEqual(stripGlobalFlags(['--json', '--project', 'p1', 'repo', 'list']), ['repo', 'list'])
  })

  it('returns argv after command root', () => {
    assert.deepEqual(commandArgvAfter('repo', ['repo', 'add', '.']), ['add', '.'])
  })
})
```

- [ ] **Step 2: Write failing CLI dispatch test**

Create `packages/cli/tests/commander-program.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runPlattyCommand } from '../src/main.js'

describe('platty command shell', () => {
  it('prints version JSON without opening a DB', async () => {
    const response = await runPlattyCommand(['--json', 'version'], { analyticsRecorder: null })
    assert.equal(response.exitCode, 0)
    assert.match(response.stdout, /"ok": true/)
    assert.match(response.stdout, /"version": "0.1.0"/)
  })

  it('rejects unknown commands', async () => {
    const response = await runPlattyCommand(['missing'], { analyticsRecorder: null })
    assert.equal(response.exitCode, 2)
    assert.match(response.stdout, /UNKNOWN_COMMAND/)
  })
})
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npm test --workspace packages/cli
```

Expected: FAIL because files do not exist or `main.ts` still returns scaffold text.

- [ ] **Step 4: Implement shell**

Adapt source `argv.ts`, `output.ts`, and `program.ts`, but only register:

```ts
version
init
project
repo
status
run
runs
```

Create `packages/cli/src/db.ts`:

```ts
import { openPlattyDb, type OpenPlattyDbResult } from '@platty/core'

export function openCliDb(): OpenPlattyDbResult {
  return openPlattyDb()
}
```

Do not use source CLI `local-db.ts`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test --workspace packages/cli
npm run typecheck
```

Expected: pass.

---

### Task 4: Implement Init And Project Commands

**Files:**
- Create: `packages/cli/src/config-store.ts`
- Create: `packages/cli/src/project-root.ts`
- Create: `packages/cli/src/commands/init.ts`
- Create: `packages/cli/src/commands/project.ts`
- Test: `packages/cli/tests/setup-init.test.ts`
- Test: `packages/cli/tests/project-commands.test.ts`

- [ ] **Step 1: Write failing init test**

Create `packages/cli/tests/setup-init.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runPlattyCommand } from '../src/main.js'

describe('platty init', () => {
  it('creates project config without project-local DB path', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'platty-init-'))
    const response = await runPlattyCommand(['--json', 'init'], { cwd, analyticsRecorder: null })

    assert.equal(response.exitCode, 0)
    const config = JSON.parse(readFileSync(join(cwd, '.platty/config.json'), 'utf8'))
    assert.equal(config.projectRoot, cwd)
    assert.equal('localDbPath' in config, false)
  })
})
```

- [ ] **Step 2: Write failing project command test**

Create `packages/cli/tests/project-commands.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTestPlattyDb } from '@platty/core'
import { runPlattyCommand } from '../src/main.js'

describe('project commands', () => {
  it('creates, lists, and selects a project', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'platty-project-'))
    const db = createTestPlattyDb()

    assert.equal((await runPlattyCommand(['init'], { cwd, db: db.db, analyticsRecorder: null })).exitCode, 0)
    assert.equal((await runPlattyCommand(['project', 'create', 'Demo'], { cwd, db: db.db, analyticsRecorder: null })).exitCode, 0)
    const list = await runPlattyCommand(['--json', 'project', 'list'], { cwd, db: db.db, analyticsRecorder: null })
    assert.match(list.stdout, /Demo/)
    const use = await runPlattyCommand(['project', 'use', 'demo'], { cwd, db: db.db, analyticsRecorder: null })
    assert.equal(use.exitCode, 0)

    db.close()
  })
})
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npm test --workspace packages/cli -- tests/setup-init.test.ts tests/project-commands.test.ts
```

Expected: FAIL because commands are not implemented.

- [ ] **Step 4: Implement commands using core services**

`init` writes only:

```json
{
  "version": 1,
  "projectRoot": "/absolute/path",
  "currentProject": null
}
```

`project` calls `createProject`, `listProjects`, `resolveProjectSelector`, and updates `currentProject` in config.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test --workspace packages/cli -- tests/setup-init.test.ts tests/project-commands.test.ts
```

Expected: pass.

---

### Task 5: Implement Repo Commands

**Files:**
- Create: `packages/cli/src/commands/repo.ts`
- Test: `packages/cli/tests/repo-commands.test.ts`

- [ ] **Step 1: Write failing repo command test**

Create `packages/cli/tests/repo-commands.test.ts` with a temp git repo and injected `createTestPlattyDb()`. Assert `repo add`, `repo list`, and `repo remove` work under the selected project.

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm test --workspace packages/cli -- tests/repo-commands.test.ts
```

Expected: FAIL because `repo` command is missing.

- [ ] **Step 3: Implement repo command using core repository service**

Support only:

```text
platty repo add <path> [--name <name>] [--source-root <relative>] [--branch <branch>]
platty repo list
platty repo remove <selector>
platty repo update <selector> [--name <name>] [--path <path>] [--source-root <relative>] [--branch <branch>]
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test --workspace packages/cli -- tests/repo-commands.test.ts
```

Expected: pass.

---

### Task 6: Implement Static Status/Run Shortcuts

**Files:**
- Create: `packages/cli/src/commands/pipeline.ts`
- Test: `packages/cli/tests/analysis-run-next.test.ts`

- [ ] **Step 1: Write failing injected-run test**

Create a CLI test that injects a fake `runStaticPipelineForProject` function into `runPlattyCommand()` options and asserts:

```text
platty status
platty run --step-only
```

select the current project and call only core-facing seams.

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm test --workspace packages/cli -- tests/analysis-run-next.test.ts
```

Expected: FAIL because pipeline command is not implemented.

- [ ] **Step 3: Implement status/run command**

`status` returns project summary from core.

`run` calls the core static pipeline runner. `--step-only` should run at most one pending repo/stage if the core runner supports it; otherwise return a validation error until step mode is implemented.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test --workspace packages/cli -- tests/analysis-run-next.test.ts
```

Expected: pass.

---

### Task 7: Implement Run Lifecycle Commands

**Files:**
- Create: `packages/core/src/run_service.ts`
- Create: `packages/cli/src/commands/runs.ts`
- Test: `packages/core/tests/run_service.test.ts`
- Test: `packages/cli/tests/runs-command.test.ts`

- [ ] **Step 1: Write failing core run service test**

Assert `listRuns`, `getRun`, and `cancelRun` work against `pipeline_runs`.

- [ ] **Step 2: Write failing CLI runs test**

Assert:

```text
platty runs list
platty runs show --run-id <id>
platty runs cancel --run-id <id>
```

uses injected DB and selected project.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npm run test --workspace packages/core -- tests/run_service.test.ts
npm test --workspace packages/cli -- tests/runs-command.test.ts
```

Expected: FAIL because service/command do not exist.

- [ ] **Step 4: Implement core and CLI run services**

Only lifecycle inspection/cancel belongs in Phase 3. Do not port generation-run resume/retry adapters yet.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run test --workspace packages/core -- tests/run_service.test.ts
npm test --workspace packages/cli -- tests/runs-command.test.ts
```

Expected: pass.

---

### Task 8: Final Phase 3 Verification

**Files:**
- Modify: `scripts/check-architecture.mjs`

- [ ] **Step 1: Extend architecture guard**

Add checks that:

```text
packages/cli/src does not import packages/core/src relatively
packages/cli/src does not import @/...
packages/cli/src/commands/docs.ts does not exist
packages/cli/src/commands/epics.ts does not exist
packages/cli/src/commands/business-docs.ts does not exist
packages/cli/src/commands/service-map.ts does not exist
packages/cli/src/commands/business-map.ts does not exist
packages/cli/src/commands/search.ts does not exist
packages/cli/src/commands/live-index.ts does not exist
```

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm run test --workspace packages/core -- tests/project_service.test.ts tests/repository_service.test.ts tests/static_pipeline.test.ts tests/run_service.test.ts
npm test --workspace packages/cli
npm test
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 3: Clean build artifacts and inspect worktree**

Run:

```bash
rm -rf packages/*/dist apps/*/dist packages/*/tsconfig.tsbuildinfo apps/*/tsconfig.tsbuildinfo tsconfig.tsbuildinfo
git status --short
```

Expected: only intended Phase 3 source/test/package changes remain.

---

## Self-Review

- Spec coverage: covers Phase 3 CLI shell, project/repo/init/status/run/runs foundation. Excludes docs/epics/business-docs until their runtimes exist.
- DB policy: plan explicitly rejects source project-local DB behavior and requires core global DB open helper.
- Legacy exclusion: plan keeps server/API/web/artifacts/legacy sync/docs out and adds architecture checks.
- TDD: every implementation task starts with failing tests and expected RED/GREEN commands.
