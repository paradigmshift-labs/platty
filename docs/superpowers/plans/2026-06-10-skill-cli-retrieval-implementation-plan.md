# Skill CLI Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement deterministic CLI primitives and skill guidance for glossary-first, EPIC-first Platty document retrieval without adding internal LLM or agent execution.

**Architecture:** Keep natural-language interpretation in the external agent skill. Add read-only EPIC retrieval commands to `packages/cli/src/commands/epics.ts`, enrich `docs show/related` with code and DD evidence from existing graph tables, and rewrite `.codex/skills/platty-retrieval/SKILL.md` around the new flow.

**Tech Stack:** TypeScript, Vitest, Drizzle SQLite schema from `@platty/core`, existing Platty CLI command runner tests.

---

## File Structure

- Modify `packages/cli/src/commands/epics.ts`: add `list`, `search`, `show`, and `related` read-only retrieval subcommands.
- Modify `packages/cli/tests/epics-command.test.ts`: add TDD coverage for EPIC compact index and EPIC document graph.
- Modify `packages/cli/src/commands/docs.ts`: enrich `docs show` and `docs related` with DD model links and API/screen code evidence.
- Modify `packages/cli/tests/docs/search-retrieval.test.ts`: add tests for DD model evidence and API code location evidence.
- Modify `.codex/skills/platty-retrieval/SKILL.md`: make glossary-first and EPIC-first traversal the default workflow.

## Task 1: EPIC Compact Index CLI

**Files:**

- Modify: `packages/cli/tests/epics-command.test.ts`
- Modify: `packages/cli/src/commands/epics.ts`

- [ ] **Step 1: Write the failing test**

Add a test that seeds two confirmed EPICs, one linked `api_spec`, one linked `screen_spec`, and business docs scoped to the EPIC. Run:

```bash
npm test --workspace packages/cli -- packages/cli/tests/epics-command.test.ts -t "lists confirmed EPIC retrieval candidates"
```

Expected: fail with `UNKNOWN_COMMAND` for `epics list`.

- [ ] **Step 2: Implement `epics list --compact`**

Add a read-only branch before build-epics runtime commands:

```bash
platty epics list --project <project> --compact --json
```

Return active, confirmed, non-deleted EPICs with:

- `epicId`
- `stableKey`
- `title`
- `summary`
- `status`
- `confirmedAt`
- `documentCounts`
- `terms`
- `freshness`

Use document titles, summaries, EPIC names, and stable keys as deterministic `terms`.

- [ ] **Step 3: Run the focused test**

Run:

```bash
npm test --workspace packages/cli -- packages/cli/tests/epics-command.test.ts -t "lists confirmed EPIC retrieval candidates"
```

Expected: pass.

## Task 2: EPIC Search And Detail Graph

**Files:**

- Modify: `packages/cli/tests/epics-command.test.ts`
- Modify: `packages/cli/src/commands/epics.ts`

- [ ] **Step 1: Write failing tests**

Add tests for:

```bash
platty epics search --project <project> --terms "order,checkout" --json
platty epics show --project <project> --epic <epic-id> --include-docs --json
platty epics related --project <project> --epic <epic-id> --json
```

Expected failures: commands are unknown.

- [ ] **Step 2: Implement search**

`epics search` must accept normalized terms only. It must not accept or document `--question`.

Rank by deterministic substring matches across EPIC name, summary, stable key, linked document title, summary, type, and item titles/summaries.

- [ ] **Step 3: Implement show/related**

Group connected documents by type:

```json
{
  "documents": {
    "glossary": [],
    "ucl": [],
    "ucs": [],
    "br": [],
    "data_dictionary": [],
    "design": [],
    "api_spec": [],
    "screen_spec": [],
    "event_spec": [],
    "schedule_spec": []
  }
}
```

Include link summaries from `epic_document_links`, same-EPIC business docs, and freshness.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test --workspace packages/cli -- packages/cli/tests/epics-command.test.ts -t "searches EPIC retrieval candidates"
npm test --workspace packages/cli -- packages/cli/tests/epics-command.test.ts -t "shows an EPIC document graph grouped by type"
```

Expected: pass.

## Task 3: Document Detail Evidence

**Files:**

- Modify: `packages/cli/tests/docs/search-retrieval.test.ts`
- Modify: `packages/cli/src/commands/docs.ts`

- [ ] **Step 1: Write failing DD evidence test**

Seed a `data_dictionary` document item, a `models` row, and `document_item_model_links`. Assert `docs show` returns `modelLinks` with `describes_model` and `describes_field`.

- [ ] **Step 2: Write failing API code evidence test**

Seed an `api_spec` document with `scopeId` equal to an `entry_points.id`, seed `code_nodes` for handler and service, and seed `code_bundles`. Assert `docs show` returns:

```json
{
  "code": {
    "primaryNode": {
      "nodeId": "node:controller",
      "filePath": "src/orders.controller.ts",
      "startLine": 10
    },
    "relatedNodes": [
      {
        "nodeId": "node:service",
        "role": "reachable",
        "filePath": "src/orders.service.ts"
      }
    ]
  }
}
```

- [ ] **Step 3: Implement DD model evidence output**

Join `document_item_model_links` to `models` and attach item-level `modelLinks`.

- [ ] **Step 4: Implement API/screen code evidence output**

For technical documents whose `scopeId` matches an `entry_points.id`, return the entry point handler as `primaryNode` and bundle nodes as `relatedNodes`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test --workspace packages/cli -- packages/cli/tests/docs/search-retrieval.test.ts
```

Expected: pass.

## Task 4: Skill Rewrite

**Files:**

- Modify: `.codex/skills/platty-retrieval/SKILL.md`

- [ ] **Step 1: Rewrite workflow**

Make the default workflow:

```text
question
-> project glossary
-> optional clarification
-> subquestions
-> epics list/search
-> epics show/related
-> docs show/related
-> DD model evidence or API code evidence
-> answer with freshness
```

- [ ] **Step 2: Remove old default**

Do not describe global `docs list` as the primary starting point. Keep it only as fallback/debug inventory.

- [ ] **Step 3: Verify skill instructions**

Run:

```bash
rg -n "docs list|epics search|docs investigate|docs ask|glossary" .codex/skills/platty-retrieval/SKILL.md
```

Expected: `docs list` appears only as fallback/debug guidance; `docs investigate` and `docs ask` do not appear as recommended commands.

## Task 5: Verification And Commit

**Files:**

- All modified files above.

- [ ] **Step 1: Run focused CLI tests**

```bash
npm test --workspace packages/cli -- packages/cli/tests/epics-command.test.ts
npm test --workspace packages/cli -- packages/cli/tests/docs/search-retrieval.test.ts
```

- [ ] **Step 2: Run package verification**

```bash
npm run typecheck --workspace @pshift/platty
npm run build --workspace @pshift/platty
```

- [ ] **Step 3: Inspect git diff**

```bash
git status --short
git diff -- packages/cli/src/commands/epics.ts packages/cli/src/commands/docs.ts packages/cli/tests/epics-command.test.ts packages/cli/tests/docs/search-retrieval.test.ts .codex/skills/platty-retrieval/SKILL.md
```

- [ ] **Step 4: Commit only this work**

Stage only the retrieval implementation and plan files. Do not stage unrelated dirty files already present in the workspace.
