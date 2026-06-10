# Analysis Worktree Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small, tested parser for `git worktree list --porcelain` / `--porcelain -z` output so Platty can reason about analysis worktrees without ad hoc string parsing.

**Architecture:** Keep parsing logic in `packages/core/src/repo/analysis-worktree.ts` beside existing worktree lifecycle code. Export a pure parser function and typed result; do not change repo add/delete, static analysis, or document stale behavior in this plan.

**Tech Stack:** TypeScript, Node.js, Vitest, existing `@platty/core` repo conventions.

---

## Current State

- The current checkout is `main` and dirty. Do not implement this plan directly on `main`.
- Existing worktree lifecycle code lives in `packages/core/src/repo/analysis-worktree.ts`.
- Existing tests live in `packages/core/tests/repo/analysis-worktree.test.ts`.
- There is no exported parser for `git worktree list --porcelain` output today.

## Required Execution Setup

Before editing code, create an isolated worktree or otherwise move to a feature branch outside the dirty `main` checkout.

```bash
git worktree add ../platty-analysis-worktree-parser -b feature/analysis-worktree-parser
cd ../platty-analysis-worktree-parser
git status --short
```

Expected: clean or only files intentionally copied into the isolated worktree. If this fails because the branch name exists, choose a unique branch such as `feature/analysis-worktree-parser-2`.

## File Structure

- Modify: `packages/core/src/repo/analysis-worktree.ts`
  - Add `ParsedGitWorktree` interface.
  - Add `parseGitWorktreeListPorcelain(output: string): ParsedGitWorktree[]`.
  - Keep parser pure: no filesystem, no git process execution.
- Modify: `packages/core/tests/repo/analysis-worktree.test.ts`
  - Add focused parser tests before changing implementation.
  - Keep existing `prepareAnalysisWorktree` tests intact.

## Parser Contract

The parser must support both formats:

- `git worktree list --porcelain`
- `git worktree list --porcelain -z`

The parser result must expose:

```ts
export interface ParsedGitWorktree {
  path: string
  head: string | null
  branchRef: string | null
  detached: boolean
  bare: boolean
  locked: boolean
  lockedReason: string | null
  prunable: boolean
  prunableReason: string | null
  unknownFields: string[]
}
```

Field mapping:

- `worktree <path>` starts a record and sets `path`.
- `HEAD <sha>` sets `head`.
- `branch <ref>` sets `branchRef`.
- `detached` sets `detached`.
- `bare` sets `bare`.
- `locked` sets `locked`.
- `locked <reason>` sets `locked` and `lockedReason`.
- `prunable` sets `prunable`.
- `prunable <reason>` sets `prunable` and `prunableReason`.
- Unknown fields are preserved in `unknownFields`.

Malformed fields before the first `worktree` line should be ignored, because git may prepend warnings on stderr but callers should only pass stdout. Empty input returns `[]`.

---

### Task 1: Add Failing Parser Tests

**Files:**
- Modify: `packages/core/tests/repo/analysis-worktree.test.ts`

- [ ] **Step 1: Add parser import**

Change the import near the top from:

```ts
import { getAnalysisWorktreeRoot, prepareAnalysisWorktree } from '../../src/repo/analysis-worktree.js'
```

to:

```ts
import {
  getAnalysisWorktreeRoot,
  parseGitWorktreeListPorcelain,
  prepareAnalysisWorktree,
} from '../../src/repo/analysis-worktree.js'
```

- [ ] **Step 2: Add failing tests**

Add this `describe` block after `describe('analysis worktree root', ...)` and before `describe('prepareAnalysisWorktree', ...)`:

```ts
describe('parseGitWorktreeListPorcelain', () => {
  it('parses newline-delimited porcelain worktrees', () => {
    const output = [
      'worktree /repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /repo-linked',
      'HEAD 2222222222222222222222222222222222222222',
      'detached',
      'locked running analysis',
      'prunable gitdir file points to non-existent location',
      'custom future-field',
      '',
    ].join('\n')

    expect(parseGitWorktreeListPorcelain(output)).toEqual([
      {
        path: '/repo',
        head: '1111111111111111111111111111111111111111',
        branchRef: 'refs/heads/main',
        detached: false,
        bare: false,
        locked: false,
        lockedReason: null,
        prunable: false,
        prunableReason: null,
        unknownFields: [],
      },
      {
        path: '/repo-linked',
        head: '2222222222222222222222222222222222222222',
        branchRef: null,
        detached: true,
        bare: false,
        locked: true,
        lockedReason: 'running analysis',
        prunable: true,
        prunableReason: 'gitdir file points to non-existent location',
        unknownFields: ['custom future-field'],
      },
    ])
  })

  it('parses nul-delimited porcelain worktrees', () => {
    const output = [
      'worktree /repo',
      'HEAD 3333333333333333333333333333333333333333',
      'branch refs/heads/main',
      '',
      'worktree /repo-bare',
      'HEAD 4444444444444444444444444444444444444444',
      'bare',
      'locked',
      'prunable',
      '',
    ].join('\0')

    expect(parseGitWorktreeListPorcelain(output)).toEqual([
      {
        path: '/repo',
        head: '3333333333333333333333333333333333333333',
        branchRef: 'refs/heads/main',
        detached: false,
        bare: false,
        locked: false,
        lockedReason: null,
        prunable: false,
        prunableReason: null,
        unknownFields: [],
      },
      {
        path: '/repo-bare',
        head: '4444444444444444444444444444444444444444',
        branchRef: null,
        detached: false,
        bare: true,
        locked: true,
        lockedReason: null,
        prunable: true,
        prunableReason: null,
        unknownFields: [],
      },
    ])
  })

  it('returns an empty list for blank output and ignores leading malformed fields', () => {
    expect(parseGitWorktreeListPorcelain('')).toEqual([])
    expect(parseGitWorktreeListPorcelain('\n\nHEAD ignored\n\n')).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests and verify failure**

```bash
cd packages/core
npx vitest run tests/repo/analysis-worktree.test.ts -t parseGitWorktreeListPorcelain
```

Expected: fail because `parseGitWorktreeListPorcelain` is not exported.

- [ ] **Step 4: Commit the failing test**

```bash
git add packages/core/tests/repo/analysis-worktree.test.ts
git commit -m "test: cover analysis worktree porcelain parsing"
```

---

### Task 2: Implement The Pure Parser

**Files:**
- Modify: `packages/core/src/repo/analysis-worktree.ts`

- [ ] **Step 1: Add exported interface**

Add this interface after `PreparedAnalysisWorktree`:

```ts
export interface ParsedGitWorktree {
  path: string
  head: string | null
  branchRef: string | null
  detached: boolean
  bare: boolean
  locked: boolean
  lockedReason: string | null
  prunable: boolean
  prunableReason: string | null
  unknownFields: string[]
}
```

- [ ] **Step 2: Add parser function**

Add this function after `getAnalysisWorktreeRoot()`:

```ts
export function parseGitWorktreeListPorcelain(output: string): ParsedGitWorktree[] {
  const worktrees: ParsedGitWorktree[] = []
  let current: ParsedGitWorktree | null = null

  const fields = output.includes('\0') ? output.split('\0') : output.split(/\r?\n/)
  for (const field of fields) {
    if (field === '') {
      current = null
      continue
    }

    if (field.startsWith('worktree ')) {
      current = createParsedGitWorktree(field.slice('worktree '.length))
      worktrees.push(current)
      continue
    }

    if (!current) continue

    if (field.startsWith('HEAD ')) {
      current.head = field.slice('HEAD '.length) || null
    } else if (field.startsWith('branch ')) {
      current.branchRef = field.slice('branch '.length) || null
    } else if (field === 'detached') {
      current.detached = true
    } else if (field === 'bare') {
      current.bare = true
    } else if (field === 'locked') {
      current.locked = true
    } else if (field.startsWith('locked ')) {
      current.locked = true
      current.lockedReason = field.slice('locked '.length) || null
    } else if (field === 'prunable') {
      current.prunable = true
    } else if (field.startsWith('prunable ')) {
      current.prunable = true
      current.prunableReason = field.slice('prunable '.length) || null
    } else {
      current.unknownFields.push(field)
    }
  }

  return worktrees
}
```

- [ ] **Step 3: Add record factory helper**

Add this helper near the private helpers section, before `hasBranch`:

```ts
function createParsedGitWorktree(path: string): ParsedGitWorktree {
  return {
    path,
    head: null,
    branchRef: null,
    detached: false,
    bare: false,
    locked: false,
    lockedReason: null,
    prunable: false,
    prunableReason: null,
    unknownFields: [],
  }
}
```

- [ ] **Step 4: Run parser tests**

```bash
cd packages/core
npx vitest run tests/repo/analysis-worktree.test.ts -t parseGitWorktreeListPorcelain
```

Expected: all parser tests pass.

- [ ] **Step 5: Commit implementation**

```bash
git add packages/core/src/repo/analysis-worktree.ts
git commit -m "feat: parse git worktree porcelain output"
```

---

### Task 3: Regression Check Existing Worktree Lifecycle Tests

**Files:**
- No new files.

- [ ] **Step 1: Run the full worktree test file**

```bash
cd packages/core
npx vitest run tests/repo/analysis-worktree.test.ts
```

Expected: existing root and `prepareAnalysisWorktree` tests still pass.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: TypeScript passes.

- [ ] **Step 3: Commit verification-only changes if needed**

If formatting or import ordering changed during verification:

```bash
git add packages/core/src/repo/analysis-worktree.ts packages/core/tests/repo/analysis-worktree.test.ts
git commit -m "chore: tidy analysis worktree parser tests"
```

If there are no changes, do not create an empty commit.

---

### Task 4: Handoff Notes For Repo Lifecycle Follow-Up

**Files:**
- No required code changes.

- [ ] **Step 1: Record what this parser intentionally does not do**

Add this note to the PR description or implementation handoff:

```md
This change only parses `git worktree list --porcelain` output. It does not change repository add/delete behavior, static analysis behavior, document soft-delete behavior, or business document stale propagation.
```

- [ ] **Step 2: Point future work at the parser**

Add this note to the PR description or implementation handoff:

```md
Repo lifecycle cleanup can use `parseGitWorktreeListPorcelain` later to inspect locked/prunable/stale analysis worktrees before removing them.
```

---

## Final Verification

Run from repository root:

```bash
npm run typecheck
cd packages/core
npx vitest run tests/repo/analysis-worktree.test.ts
```

Expected:

- Typecheck passes.
- `analysis-worktree.test.ts` passes.
- `git status --short` only shows intended parser/test changes.

## Self-Review

- Spec coverage: covers pure worktree parser development with TDD and keeps repo lifecycle behavior out of scope.
- Placeholder scan: no TBD/TODO/fill-in-later steps remain.
- Type consistency: `ParsedGitWorktree` fields match all test expectations and parser implementation snippets.
