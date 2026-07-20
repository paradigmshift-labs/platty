---
name: platty-onboarding
description: Use when Platty CLI and agent skills are already installed and a user wants the first end-to-end project journey from repository registration through static analysis and generated SOT, or wants to resume that multi-phase onboarding journey.
---

# Platty Onboarding

**Prerequisite:** Read `using-platty` before acting unless it has already been read in this turn.

Coordinate the installed first-run journey. This skill does not install the CLI or agent plugin. Route detailed phase behavior and recovery to `platty-setup`, `platty-static-analysis`, `platty-docs-target-curation`, and `platty-generated-docs`.

## Conversation Language

Determine the conversation language from the user's request at the start. An
explicit language instruction takes precedence. Otherwise use Korean when the
request is Korean, mixes Korean and English, or is ambiguous enough that the
language cannot be inferred. Use English when the request is in English. Do not
infer the response language from the repository's source language. Keep every
user-facing progress update, explanation, question, approval card, and
completion or failure report in that language across all routed owner skills.
Preserve commands, paths, project and repository names, provider values, ids,
and error codes verbatim.

For the shared Start Notice, Progress Checkpoint, and Handoff Card, translate
all human-readable labels and headings into the conversation language while
preserving the template structure and machine values.

## Invocation Input

Treat a path appended to an explicit skill invocation as the initial repository
candidate. `.` means the host session's current working directory. Resolve any
relative or absolute path to its absolute Git root before setup inspection. If
the path or Git root is unverifiable, stop and ask for a valid repository path.
The path identifies the initial repository and is never a project selector; the
normal project resolution, branch gate, and additional-repository questions
still apply.

## Resume First

Use the shared Platty Start Notice, then inspect `platty setup --json`. Inside the private source checkout, translate public commands to `node packages/cli/dist/main.js <command> --json` as required by `AGENTS.md`. If the CLI or agent plugin is missing, stop and route the user to installation; do not install it from this skill.

If inspection returns `PLATTY_DB_MIGRATION_NEWER_THAN_CLI`, stop normal onboarding. Never delete or repair the existing database or default Platty home. Only for a user-authorized disposable validation run, create a fresh isolated `PLATTY_HOME`, label it as separate test state, and preserve that same `PLATTY_HOME` for every command and resume. Record the absolute `PLATTY_HOME` path in a durable workflow-state or resume-note artifact outside the analyzed repository, and repeat that `PLATTY_HOME` in every pause and handoff. Without that artifact, report the exact path and do not promise automatic fresh-context resume.

Resolve the project before project-scoped commands and inspect repositories, analysis status, generated-doc runs, and the last verified `nextAction`. Reconstruct project, repository ids and branches, the latest analysis run id, generated-doc stage/run ids, provider/model flags, and next action from persisted Platty state; never rely on chat history alone. Resume at the first incomplete phase. A repository path is never a project selector.

## 1. Project and Repositories

Use `platty-setup`. When no intended project is resolved and multiple plausible
projects exist, explain that they are persisted Platty projects from earlier
runs, not filesystem directories discovered beside the repository. Run `repo
list` for each candidate and summarize whether the current repository is
already registered, including source roots only when verified. Offer an
existing project or a new project in one concise question. Do not render `Platty handoff`
while waiting for this ordinary, resolvable choice; it is not a
terminal stop.

When no plausible existing project exists, ask for the project name and short description.

When the user selects a project, or supplies the project name and short description
for a new one, create or select it and run `repo list` before every
`repo add`. Reuse every verified registration and add only missing repositories
or source roots. For each new registration collect the repository path, display name, analysis branch, and optional source root. Follow the owner skill's
default-versus-current branch gate when the branch is omitted.

Before choosing registrations, inspect the Git root, root manifest, workspace declaration or metadata, and nested app or package manifests. When one Git root has no usable root manifest or workspace declaration but contains multiple independently analyzable nested app manifests, register the same absolute Git repository path once per app with a distinct `--source-root` and unique display names. Do not register application subdirectories as the repository path. Pass an explicit `--branch` on each registration and keep the `repo list`-before-add invariant.

Explain that multi-repository analysis can connect source-grounded routes, models, API calls, storage access, and service relations across repositories. After each add, ask whether another repository belongs to the same project. Start analysis only when registration is complete.

## 2. Static Analysis

Use `platty-static-analysis`. Before starting, say static analysis does not invoke an LLM and does not consume LLM tokens. Explain that it extracts files, symbols, imports, calls, literals, routes, models, database and API access, navigation, events, jobs, storage, and service relations so later documents remain grounded in code.

At the repository-to-analysis boundary, use this required readiness shape in
the conversation language:

- **Repositories:** list the registered repositories and source roots that will
  be analyzed.
- **What static analysis does:** summarize the code evidence it extracts and
  why that evidence grounds later documents.
- **LLM use:** state that this phase does not invoke an LLM or consume LLM
  tokens.
- **Next action:** state that static analysis is ready to start.

If the user's original request explicitly authorizes static analysis, including
an end-to-end request to continue through analysis, do not ask a duplicate
question; proceed after the readiness summary. Otherwise ask one concise
question to start static analysis and wait for the answer. This is a
conversational readiness check; it does not add or imply a CLI confirmation
command. The next CLI action remains
`platty analyze --project <project> --json`.

After completion, give an intermediate report with the project, analyzed and failed repository counts, completed stages, target counts by useful category when available, the analysis run id, actionable blocking failures, and the state-derived next action. Preserve non-actionable internal unresolved facts in the run evidence, but do not expose them in ordinary onboarding output. Do not paste raw JSON. Stop on the owner skill's failure or stall conditions.

Inspect the terminal result's automatic `sotExport`. Verify and report its `outDir` and `graphView.htmlPath` immediately. If the export or `outDir` is missing, run `platty sot export --project <project> --json`; if GraphView is still missing or `graphView.error` is present, run `platty graph view --project <project> --json`. Apply the private-checkout command translation from **Resume First**. Summarize the fresh static target inventory. Report a catalog path only when the CLI returned that path and the file exists; never invent a pre-LLM API, screen, event, or job catalog from an expected directory layout.

## 3. Target Review and LLM Approval

Use `platty-docs-target-curation`. Summarize only active APIs, screens, events, and jobs as curatable target kinds. Let the user describe unused or obsolete targets in natural language, resolve them against a fresh list, and mutate only exact target ids. Ask one focused question on ambiguity. Explicitly include the accepted active ids when nothing is excluded. In this public onboarding path, do not run the lower-level `docs shared-segments` compatibility commands; continue through the public `generate-docs` facade, which rebuilds the required segments.

Resolve the local provider before approval. Determine the current runtime from the host session context, not from executable ordering, then verify its matching CLI with `command -v codex` or `command -v claude`. Map a detected `codex` executable to the CLI provider value `codex_cli`, and a detected `claude` executable to `claude_code`; `<resolved-provider>` below always means one of those CLI enum values, never the executable name. Otherwise select the one available local CLI. If both exist and the runtime gives no preference, ask once. Do not select `claude_api` implicitly. Stop if neither local provider exists.

Put the static result, target-review outcome, and approval card in the same user-facing response. Do not pause between them; pause only at the explicit approval request. Divide the card into these sections:

- **Generated outputs and why:** explain why technical docs, EPIC grouping, and business docs are generated.
- **Execution:** show the resolved provider, how availability was verified including the resolved `command -v` path, parallel workers, and automatic EPIC continuation.
- **Cost and resume:** warn about LLM tokens and possible provider cost, and explain that persisted run/task state resumes saved work after interruption.
- **Approval:** say the user may still name targets to deprecate, then request approval.

### Required approval-card shape

Use the following positive recipe in this order. Translate the headings and
field labels into the conversation language; keep machine values verbatim.

**Generated outputs and why**

- **Technical documents:** explain that they organize each accepted API,
  screen, event, or job with its source-grounded behavior and evidence.
- **EPIC grouping:** explain that it connects related technical behavior into
  coherent product or business capabilities.
- **Business documents:** explain that they turn the grouped evidence into
  readable end-to-end flows, rules, and relationships.

**Execution**

- **Provider:** show the resolved CLI provider value.
- **Availability:** show the verified `command -v` executable path.
- **Parallel work:** state that independent document tasks can run through
  multiple workers concurrently.
- **Automatic continuation:** state that technical documents continue through
  EPIC drafting, returned-command EPIC confirmation, and business documents
  without another routine approval.

**Cost and resume**

- **Token and cost:** state that this phase consumes LLM tokens and may incur
  provider cost; do not invent an exact total before the run.
- **Resume:** state that Platty persists run and task state, so interruption
  resumes saved work and does not regenerate already completed documents.

**Approval**

- **Targets:** give the accepted target counts by available kind.
- **Exclusions:** say the user may still name unwanted or obsolete targets to
  deprecate before generation.
- **Question:** ask for explicit approval to start LLM generation.

Wait for explicit approval. Static-analysis completion is not LLM approval.

## 4. Generated Outputs

Use `platty-generated-docs`. After approval run:

```bash
platty generate-docs run --project <project> --provider <resolved-provider> --json
```

The explicit flag satisfies the provider gate; do not ask a duplicate provider question. Preserve `--project`, `--stage`, `--run-id`, `--provider`, model flags, and `--json` in every continuation or recovery command.

Continue technical docs -> EPIC draft -> EPIC auto-confirm -> business docs without asking the user to select EPICs. A valid returned `confirm-epics` command is automatic unless the user explicitly requested manual review. If EPIC confirmation is required but the confirmation command or run id is missing, stop instead of guessing.

For long work, poll about every 30–60 seconds. Report only deltas in stage, saved/completed, active, pending, failed, remaining, cumulative tokens and cost when available, and the next automatic action. Repair failed tasks on the same run for at most two repair rounds, then stop with the remaining failures and exact next action. Preserve saved work; do not regenerate completed work after interruption.

## 5. Completion

Completion requires all generated-document stages to be terminal with no failed tasks. At terminal completion run the `platty-generated-docs` export step once:

```bash
platty sot export --project <project> --json
```

Verify non-zero `counts.docs` and `counts.epics`. Record `lastExportAt` as freshness evidence, but a changed timestamp alone is not proof. Report the SOT `outDir` and `graphView.htmlPath` from the same result. If `graphView` is missing or has `graphView.error`, use `platty graph view --project <project> --json` as the fallback and verify its HTML path. Keep worker task counts distinct from stored document counts: tasks describe execution, while `counts.docs` describes final stored business documents.

### Required completion-response shape

Finish with one structured response. Render these fields in this exact order and
translate their user-facing labels and prose into the conversation language:

1. **Generated results:** terminal stages, final stored business-document,
   technical-document, spec, and EPIC counts when returned, provider
   tokens/cost, and zero-failure state. Keep task execution counts separate from
   stored document counts.
2. **Open results:** verified SOT and GraphView paths plus only returned,
   existing catalog paths.
3. **Next skills:** explain all three next capabilities as distinct choices.
   Give capability descriptions, not example prompts or command dumps:
   - **Project search:** the local `platty-retrieval` retrieval/search skill
     from the public Platty plugin, when discoverable, or configured Platty MCP retrieval can find
     source-grounded answers across SOT, EPICs, documents, exact code locations,
     and graph relations. Do not invent or automatically run a sample query.
   - **Product specification:** `platty-sdd-spec` turns a product idea or change
     request into grounded `prd.md` and `user_stories.md` drafts.
   - **Development design:** `platty-sdd-design` continues from approved product
     documents into `system_design.md` and executable `tasks.md`.
4. **Current state:** project selector, provider, terminal counts, last verified
   next action, and blocker state.
5. **Platty handoff:** render the shared handoff card with the project, terminal
   counts, provider usage, SOT path, GraphView path, recommended capability, and
   blocker state.
6. **Final invitation:** this is exactly one search-oriented question after the
   handoff. When retrieval is available, ask the conversation-language
   equivalent of “Shall I search the project now?” When retrieval is unavailable,
   state the missing setup in **Next skills**, then ask whether to
   configure retrieval and search the project. This question is the final user-facing sentence;
   nothing, including another handoff field or generic
   closing sentence, follows it.

## Stop Conditions

An ordinary project, repository, or target choice that the user can resolve is
a guided question, not a terminal stop. Reserve a terminal handoff for missing
installation, an explicitly deferred workflow, ambiguity that remains
unrecoverable after one focused question, an unverifiable repository path or
branch, static-analysis failure or stall, no local provider, missing LLM
approval, a missing run id required for continuation or confirmation, failed
tasks after at most two repair rounds, unverifiable SOT or GraphView output, or
final completion. Preserve owner-skill evidence and the exact next action in
the handoff.
