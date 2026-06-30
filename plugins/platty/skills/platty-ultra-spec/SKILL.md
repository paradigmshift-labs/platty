---
name: platty-ultra-spec
description: Use when turning a plain product idea into a source-grounded spec via Platty's ultra-spec pipeline — compile an idea into typed registry facts, diff against the canonical SOT, and produce a one-page summary (and optionally design/tasks/qa). Distinct from platty-sdd-spec (which writes request.md + stories.md); ultra-spec compiles facts into the registry and diffs them against the code's source-of-truth.
---

# Platty Ultra-Spec

Turn an idea into a source-grounded spec through the `platty spec` command. Unlike `platty-sdd-spec` (free-form request.md + stories.md), this pipeline compiles the idea into **typed registry facts**, **diffs them against the canonical SOT** (the code's as-is behavior), and renders a **one-page confirmation** — the planner sees that one page, the compiled docs stay internal. It is a *natural-language compiler*: when an idea has blocking ambiguity it **stops and asks before minting** (the dialogue gate) — concretizing the plan instead of guessing.

Inside this repository, `AGENTS.md` overrides public examples: run `node packages/cli/dist/main.js spec ... --json`.

## Required Gates

1. Resolve a Platty project before any `spec` command (a repo path is never a selector).
2. The project must have business docs (SOT) for the diff to be meaningful; otherwise findings degrade to static-only.
3. Pick a provider explicitly when not defaulting: `--provider codex_cli | claude_code | claude_api`.
4. Treat the one-page summary's **⚠️ conflicts** and **❓ open questions** as the only things needing a human decision; everything else is auto-derived.
5. **Honor the dialogue gate.** If `spec generate` returns `status: "needs_answers"`, **nothing was minted** — the spec does not exist yet. Relay the `blockingQuestions` to the human, get their answers, and re-run with `--answer "<question>=<answer>"` (repeatable). Pass `--accept-open-questions` ONLY when the human explicitly chooses to proceed without answering. Never answer blocking questions yourself.

## Commands

- **Triage scope first for a broad idea:**
  `spec triage "<idea>" --project <p> --json` → `single` epic (proceed) or an ordered multi-epic map. For multi, spec one epic at a time.
- **Generate a spec:**
  `spec generate "<idea>" --project <p> [--provider <p>] [--model <m>] [--validate] [--design] [--answer "<q>=<a>" …] [--accept-open-questions] [--out <dir>] --json`
  - On success (`status: "completed"`) returns the one-page summary + proposal + SOT-conflict findings, and the facts are minted.
  - **Dialogue gate** (`status: "needs_answers"`): the idea had unresolved *blocking* ambiguity, so it minted NOTHING and returned `blockingQuestions` + a `nextAction`. Relay the questions, then re-run adding `--answer "<question>=<answer>"` (repeatable) — answers fold in as decided clarifications and the gate re-evaluates. `--accept-open-questions` mints despite blockers (only on the human's explicit call).
  - `--validate` runs independent, evidence-isolated cross-validation of each rule (as-is contradiction + intent scope-creep).
  - `--design` lowers the approved bundle to `design.md` / `tasks.md` / `qa.md`.
  - `--out <dir>` writes the artifacts (summary/design/tasks/qa/validation + branch tag) as the durable receipt.
  - The full pipeline (`--validate --design`) is the intended thorough use — ultra-spec aims at near-complete, conflict-checked dev docs, not a quick sketch (use `platty-sdd-spec` for a free-form narrative spec).

## Reading the Output

- **생기는 것 / Created**: the typed facts minted into the registry (`SPEC:TERM-…`, `SPEC:BR-…`, `SPEC:FLD-…`). `SPEC:` means "not yet in code".
- **⚠️ Conflicts**: `missing-anchor` (a field targets an entity absent from the canonical data dictionary) and `overlap` (a rule touches an existing rule). These are conservative *candidates* — review, don't assume contradiction. `--validate` adds the LLM's semantic verdict.
- **❓ Open questions** (`openQuestions`): informational unresolved product decisions; the spec is **still minted**. Answer them later or regenerate with refinements.
- **⛔ Blocking questions** (`blockingQuestions`): the subset whose answer changes the spec's shape — these **gate minting** (`status: "needs_answers"`, nothing minted) until answered via `--answer` or explicitly accepted. They are also listed in `openQuestions`, so a blocker accepted with `--accept-open-questions` is never silently dropped.

## Stop Conditions

- No project can be resolved, or no business-docs SOT exists and the user has not accepted static-only/degraded findings.
- A required provider is unavailable (e.g. missing API key for `claude_api`).
- Validation reports an as-is contradiction the user has not chosen to override.
- `spec generate` returned `status: "needs_answers"` and the blocking questions are neither answered (`--answer`) nor explicitly accepted (`--accept-open-questions`) — do NOT treat the spec as created; nothing was minted.

## Red Flags

| Temptation | Required behavior |
| --- | --- |
| "Show the planner all the compiled docs." | Show only the one-page summary; link the rest. |
| "The diff says overlap, so it conflicts." | Overlap is a candidate; confirm with `--validate` or a human. |
| "Invent a missing fact to fill a gap." | Leave it an open question; do not fabricate SOT. |
| "`needs_answers` came back — I'll guess the answers and re-run." | Relay the blocking questions to the human; the gate exists because the answer changes the spec's shape. |
| "Just pass `--accept-open-questions` to get past the gate." | Only on the human's explicit call. Otherwise answer via `--answer`. |
| "`needs_answers`, so the spec was partially created." | **Nothing was minted.** It mints only on `status: "completed"`. |
| "Use platty-sdd-spec for this." | Ultra-spec compiles + diffs against SOT; sdd-spec writes request/stories. Pick by need. |
