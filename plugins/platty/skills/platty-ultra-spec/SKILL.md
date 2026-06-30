---
name: platty-ultra-spec
description: Use when turning a plain product idea into a source-grounded spec via Platty's ultra-spec pipeline — compile an idea into typed registry facts, diff against the canonical SOT, and produce a one-page summary (and optionally design/tasks/qa). Distinct from platty-sdd-spec (which writes request.md + stories.md); ultra-spec compiles facts into the registry and diffs them against the code's source-of-truth.
---

# Platty Ultra-Spec

Turn an idea into a source-grounded spec through the `platty spec` command. Unlike `platty-sdd-spec` (free-form request.md + stories.md), this pipeline compiles the idea into **typed registry facts**, **diffs them against the canonical SOT** (the code's as-is behavior), and renders a **one-page confirmation** — the planner sees that one page, the compiled docs stay internal.

Inside this repository, `AGENTS.md` overrides public examples: run `node packages/cli/dist/main.js spec ... --json`.

## Required Gates

1. Resolve a Platty project before any `spec` command (a repo path is never a selector).
2. The project must have business docs (SOT) for the diff to be meaningful; otherwise findings degrade to static-only.
3. Pick a provider explicitly when not defaulting: `--provider codex_cli | claude_code | claude_api`.
4. Treat the one-page summary's **⚠️ conflicts** and **❓ open questions** as the only things needing a human decision; everything else is auto-derived.

## Commands

- **Triage scope first for a broad idea:**
  `spec triage "<idea>" --project <p> --json` → `single` epic (proceed) or an ordered multi-epic map. For multi, spec one epic at a time.
- **Generate a spec:**
  `spec generate "<idea>" --project <p> [--provider <p>] [--model <m>] [--validate] [--design] [--out <dir>] --json`
  - returns the one-page summary + proposal + SOT-conflict findings.
  - `--validate` runs independent, evidence-isolated cross-validation of each rule (as-is contradiction + intent scope-creep).
  - `--design` lowers the approved bundle to `design.md` / `tasks.md` / `qa.md`.
  - `--out <dir>` writes the artifacts (summary/design/tasks/qa/validation + branch tag) as the durable receipt.

## Reading the Output

- **생기는 것 / Created**: the typed facts minted into the registry (`SPEC:TERM-…`, `SPEC:BR-…`, `SPEC:FLD-…`). `SPEC:` means "not yet in code".
- **⚠️ Conflicts**: `missing-anchor` (a field targets an entity absent from the canonical data dictionary) and `overlap` (a rule touches an existing rule). These are conservative *candidates* — review, don't assume contradiction. `--validate` adds the LLM's semantic verdict.
- **❓ Open questions**: genuinely unresolved product decisions; answer them, then regenerate or edit.

## Stop Conditions

- No project can be resolved, or no business-docs SOT exists and the user has not accepted static-only/degraded findings.
- A required provider is unavailable (e.g. missing API key for `claude_api`).
- Validation reports an as-is contradiction the user has not chosen to override.

## Red Flags

| Temptation | Required behavior |
| --- | --- |
| "Show the planner all the compiled docs." | Show only the one-page summary; link the rest. |
| "The diff says overlap, so it conflicts." | Overlap is a candidate; confirm with `--validate` or a human. |
| "Invent a missing fact to fill a gap." | Leave it an open question; do not fabricate SOT. |
| "Use platty-sdd-spec for this." | Ultra-spec compiles + diffs against SOT; sdd-spec writes request/stories. Pick by need. |
