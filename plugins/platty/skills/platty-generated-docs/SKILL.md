---
name: platty-generated-docs
description: Use when generating, validating, reviewing, resuming, or repairing Platty generated outputs through the public generate-docs workflow, or when correcting wrong generated Claims and regenerating only the affected EPICs' business docs.
---

# Platty Generated Docs

Use this skill for the public generated-output workflow:

```text
targets -> generate-docs run -> EPIC auto-confirm -> generate-docs confirm-epics
```

This skill owns technical document generation, EPIC draft generation, automatic
EPIC confirmation from returned CLI commands, business-doc generation after
confirmation, generated-docs lifecycle status, and failed-task retry recovery
for all three worker stages.

Do not route public work directly through lower-level `docs`, `epics`, or
`business-docs` commands. Those commands are internal compatibility surfaces for
Platty maintainers and repo-local debugging; keep public agent workflows on the
`generate-docs` facade.

## Required Inputs

Resolve these before running project-scoped commands:

- project selector from `platty project list/create/use --json`;
- target review state from `platty targets list --project <project> --json`;
- generated-docs status or run id, if resuming;
- EPIC run id or returned confirmation command when continuing past the EPIC
  confirmation point.
- agent provider choice when a command will run generated-output workers, unless
  the user already specified one.

Public/plugin workflows use the installed global CLI:

```bash
platty <command> --json
```

Repo-local maintainer execution is documented outside the public plugin skills;
public/plugin workflows stay on the installed global CLI.

## LLM Policy Gate

`generate-docs run` never asks an operator to choose a provider or model. The
active LLM policy revision selects the route and validates any required runtime
credentials. If policy admission fails, surface the returned error and direct
the operator to repair the policy or its runtime configuration; do not append
provider/model flags to retry commands.

## Runtime-Controlled Capacity

Concurrency and fallback behavior are owned by the active policy/runtime. A
rate-limit or provider-capacity failure is a policy/runtime recovery issue, not
a reason to reconstruct `generate-docs run` with worker or model flags.

## Public Workflow

Inspect targets before generation:

```bash
platty targets list --project <project> --json
```

Start or resume public claim-native generated-output work:

```bash
platty generate-docs run --project <project> --json
```

The active LLM policy chooses provider, model, fallback, and concurrency. Do
not add provider/model/worker/stage flags to public `generate-docs run`.

`epics_confirmation_required` is a machine handoff, not a human gate. EPIC
confirmation is auto-confirm by default: when the response reports
`epics_confirmation_required`, treat the returned `nextCommand` as the approval
action and run it automatically. Do not stop and ask the user to approve EPICs.
Summarize that EPIC generation reached confirmation, preserve returned
`--project`, `--run-id`, provider/model flags, and `--json`, then execute:

```bash
platty generate-docs confirm-epics --project <project> --run-id <run-id> --json
```

The only times you pause before confirming are:

- the user explicitly asked to review EPICs before approval in the current
  conversation; or
- the CLI response lacks a run id or confirmation command (then stop and report
  instead of guessing one).

A plain `epics_confirmation_required` with a valid `nextCommand` is never a
reason to ask the user — confirm it and continue to business docs.

### Finalize in the canonical store

When generation reaches terminal completion, retrieve the persisted documents
and provenance through MCP/DB. HTML/Markdown SOT export is not part of the
public completion contract.

Check a known stage run during long-running or resumed work:

```bash
platty generate-docs status --project <project> --stage <stage> --run-id <run-id> --json
```

Read the top-level lifecycle fields: `stage`, `runId`, `status`,
`taskCountsByStatus`, `nextAction`, and `nextCommand`. Do not rely on
stage-specific nested status shapes.

### Monitoring an in-flight or backgrounded run

`generate-docs status` needs a run id, and that run id does not come from
`runs list`. Use the right source for each case:

- `runs list` surfaces only analyze-pipeline runs (`build_service_map`,
  `build_relations`, ...). It does not list generated-docs runs
  (`build_docs`, `build_epics`, `build_business_docs`). Do not look for a
  generated-docs run id there.
- Get the run id from the `generate-docs run` / `confirm-epics` JSON output
  (for example `epicsRunId`, or the `--run-id` embedded in the returned
  `nextCommand`). That is the run id for `status --run-id` and `retry-failed
  --run-id`.
- `generate-docs status --run-id <id>` also requires the matching `--stage`.
  A run id for `build_epics` queried with the default/`build_docs` stage fails
  with a stage mismatch. Pass the stage that matches the run id.
- To watch progress without a run id (such as a run you started in the
  background), use `generate-docs report --project <project> --json` for
  cumulative calls/tokens/cost, `epics list` for confirmed EPICs, and
  `docs list` for both technical and business documents. `docs list` returns
  documents under `data.documents`; each has a `track` (`technical` or
  `business`) and a `type` (`api_spec`, `br`, `data_dictionary`, `design`,
  ...). Count business docs by filtering `data.documents` to `track:
  business` — there is no `business-docs list` command (`business-docs`
  subcommands are run-id based: `status --run <id>`, `review --run <id>`,
  `document show --document <id>`).

### Watch a long run in the background

`build_docs` and `build_business_docs` can each run for many minutes. For a
long run, start it in the background and poll instead of blocking on a single
foreground call:

1. Start `generate-docs run` / `confirm-epics` in the background.
2. Poll on an interval (about every 30-60s) with `generate-docs report
   --project <project> --json` (no run id) plus `generate-docs status
   --run-id <id> --stage <stage> --json` once you have the run id. Report the
   `saved`/`pending`/`leased`/`failed` counts and the remaining
   (`pending + leased`).
3. Keep polling until the stage `status` is terminal (`completed`) or the
   process exits.

On errors, retry — do not abandon the run:

- A transient error from a poll command (timeout, lock contention): just
  re-issue the same status/report command on the next interval. A failed
  status check is not a failed run.
- Stage status reports `failed` tasks or `nextAction.type:
  retry_failed_tasks`: recover repair-first with `generate-docs retry-failed
  --project <project> --stage <stage> --run-id <id> --json`, then re-run
  `generate-docs run` (it resumes and re-extracts only the failed/incomplete
  work). Bound the retry rounds; if tasks still fail after retrying, stop and
  report the failed tasks to the user rather than looping forever.
- Stage status has failed tasks but `nextAction.type` is `lease_tasks` or
  `repair_task`: active/incomplete work still exists. Continue the returned
  `nextCommand` or `nextAction.command` for that same run instead of jumping to
  `retry-failed`.

## Gate Precedence

Do not blindly follow `nextCommand` or `nextAction.command` across these gates:

- `BUILD_DOCS_FAILED_BLOCKS_EPICS` or failed `build_docs` tasks block EPIC and
  business-doc generation from incomplete technical docs. Follow the primary
  `nextAction`: continue active work for `lease_tasks` / `repair_task`, and use
  `generate-docs retry-failed` only when the primary `nextAction.type` is
  `retry_failed_tasks`.
- any generated-docs stage status with primary `nextAction.type:
  retry_failed_tasks` requires `generate-docs retry-failed` for that same
  `--stage` and `--run-id` before assigning more work. Do not treat
  `alternateActions` as the primary recovery path.
- EPIC confirmation command is missing, malformed, or conflicts with the
  current project/run id; stop instead of guessing a confirm command.
- generated-output work is active and the user asks for sync;
- recovery must preserve an existing run and avoid regeneration.

If a gate blocks progress, stop and use a `Platty handoff` card with the latest
verified JSON state.

## Recovery

Use the generated-docs facade first for recovery, inspection, debugging, and
worker-level contexts.

### Failed Stage Retry

If `generate-docs run`, `generate-docs confirm-epics`, or `generate-docs status`
shows failed generated-docs tasks, keep the existing run and retry only failed
tasks. The public workflow is repair-first.

When the CLI returns `BUILD_DOCS_FAILED_BLOCKS_EPICS`, failed stage status, or
`nextAction.type: retry_failed_tasks`, run the returned `nextCommand` when
present and the primary `nextAction.type` is `retry_failed_tasks`. If failed
tasks are present but the primary action is `lease_tasks` or `repair_task`,
continue that action first; the run is still active. If you must reconstruct a
retry command, preserve the status response's `stage` and `runId`:

```bash
platty generate-docs retry-failed --project <project> --stage <stage> --run-id <run-id> --json
```

Then re-run the pipeline. A plain re-run resumes completed stages and processes
the just-reset tasks; it does not regenerate completed work:

```bash
platty generate-docs run --project <project> --json
```

`retry-failed` is public for `build_docs`, `build_epics`, and
`build_business_docs`. Do not start a fresh run with `--full`/`--new-run` just to
recover failed tasks — a plain `generate-docs run` resumes and re-extracts only
the failed/incomplete work.

Do not suggest `--force` or lower-level `docs` commands for this public gate.
Use lower-level commands only when a Platty maintainer explicitly asks for
repo-local debugging.

### Explicitly Skip Failed build_docs Tasks

`generate-docs skip-failed` is an explicit, audited recovery path for
`build_docs` only. It is never the automatic primary `nextAction`; use it only
when all of these are true:

- the primary `nextAction.type` is `retry_failed_tasks`;
- the response exposes `alternateActions` with `type: skip_failed_tasks`;
- no active work remains (`pending`, `leased`, `expired`, or
  `repair_requested` counts are zero);
- the user explicitly chooses to continue without those technical docs and
  provides a reason.

Run the returned alternate command, replacing the placeholder reason with the
user's reason:

```bash
platty generate-docs skip-failed --project <project> --stage build_docs --run-id <run-id> --reason "<why this target is intentionally excluded>" --json
```

Skipping marks only failed technical-doc tasks as skipped. It means downstream
EPIC context may be missing those docs, so do not infer that skipped content was
successfully extracted.

Known generated-output recovery preserves the existing run and avoids
regenerating completed work. Inspect through the facade, then re-run to resume:

```bash
platty generate-docs status --project <project> --stage <stage> --run-id <run-id> --json
platty generate-docs run --project <project> --json
```

Do not use `--new-run` or `--force-regenerate` unless the user explicitly asks
to discard or regenerate existing work.

The public generated-docs workflow is `run` / `confirm-epics` / `status` /
`retry-failed`, and recovery is always a plain re-run of `generate-docs run`.
Use direct `docs`, `epics`, or `business-docs` roots only when a Platty
maintainer explicitly asks for an internal command or repo-local debugging
requires it. Do not present those roots as public workflows.

## Correcting Generated Claims

When a generated technical document states something wrong (an LLM-written
Claim or its summary), correct it in place with the public `platty claims`
root instead of regenerating. Corrections are overlays: stored separately,
applied whenever documents are read (CLI, MCP) and fed to native business
docs. An overlay expires by itself when the code unit behind its Claim
changes, so re-analysis never keeps a correction for changed code.

1. Read the effective Claims and their ids:

   ```bash
   platty claims read --project <project> --document <document-id> --json
   ```

   Each Claim has `claimId`, `baseClaimId`, `text`, `source`
   (`generated`, `edited`, `added`, `lineage_renamed`) and `overlayId`. Always
   pass `baseClaimId` to `--claim` / `--anchor`; an `added` Claim has none and
   is changed by retiring its overlay.
2. Write the correction. Agents always add `--producer agent`; the overlay then
   stays proposed until a human confirms it:

   ```bash
   platty claims edit --project <project> --document <document-id> --claim <baseClaimId> --text "<corrected text>" --actor <agent-id> --reason "<why>" --producer agent --json
   ```

   Use `delete` to hide a wrong Claim, `add --anchor <baseClaimId>` for a
   missing one, and `summary` for the document summary.
3. Hand the returned `nextAction` to the user. For an agent overlay it is
   `platty claims confirm --overlay <overlay-id> --expected-revision <n> ...`,
   which only a human runs. For an active overlay it is:

   ```bash
   platty generate-docs run --project <project> --business-docs-only --epic <epic-id> --json
   ```

   which regenerates only those EPICs' business docs. Add
   `--document-types ucl,br` only when the user asks for specific types.
4. Verify with `platty claims list --project <project> --document <document-id> --json`:
   each overlay's resolution is `applied`, `expired`, `orphaned`, `conflict`
   or `pending`.

Rules:

- A summary correction is shown in retrieval but is not fed to business docs.
- The last Claim of a document cannot be deleted; edit it, or add a
  replacement first.
- One live edit or delete per Claim: to change an edited Claim, retire its
  overlay (`platty claims retire`), then edit `baseClaimId` again.
- Routes, request/response shapes, DB access and calls are not Claims. Correct
  them through `platty-analysis-corrections`: `platty graph edge` for a
  Service Map edge between existing nodes (no re-analysis), or
  `platty graph supplement` for an entry, relation, call edge, or symbol the
  analyzer missed (re-run analysis after a human confirms).
- Never full-regenerate (`generate-docs run --full`) to apply a Claim
  correction; use `--business-docs-only --epic` for the affected EPICs.

## Retrying Incomplete Business Docs

When `generate-docs run` finished but some EPIC × document-type units ended as
issues (no current document), retry only those units instead of hand-building
`--epic` lists:

```bash
platty generate-docs run --project <project> --business-docs-only --retry-issues --dry-run --json
platty generate-docs run --project <project> --business-docs-only --retry-issues --json
```

- The selection is per type: confirmed, non-deleted, non-ETC EPICs with a live,
  bindable source link and no `active`, `fresh` document of that type
  (`grounded_empty` units are never selected). These filters are DB-only and
  fast. Excluded EPICs are listed in `excludedEpics` with a reason. Show the
  `--dry-run` counts and EPIC ids to the user before running.
- By default the slow per-EPIC admission binding pre-check is skipped, so
  `excludedEpics` has no `binding_invalid`/`not_fresh` entries. If a type fails
  with `business_docs_admission_rejected`, rerun with `--precheck` (after
  resuming any started run per `nextCommand`); it excludes the EPICs admission
  would reject. `--precheck` requires `--retry-issues`.
- Without `--document-types` it uses only the types the project's Business Docs
  already have.
- It starts one EPIC-scoped run per type, so a good document of another type is
  never regenerated. Narrow with `--document-types design,data_dictionary`.
- `--retry-issues` requires `--business-docs-only` and cannot be combined with
  `--epic`. An unfinished Business Docs run refuses it exactly as it refuses
  `--business-docs-only`.
- Exit 1 with `BUSINESS_DOCS_RETRY_ISSUES_FAILED` reports per-type status; the
  other types still ran. Follow `nextCommand`: a run that stopped after it
  started must be resumed with `--resume-business-docs-run <runId>` first;
  otherwise rerun the same command. Never use `--full` here.

## Editing Published EPICs (advanced)

To fix EPIC or domain structure after `generate-docs run` published it
(rename, summary, domain move, split, merge, delete, document moves), edit the
live head with the advanced `platty epics revise` command instead of regenerating EPICs. No model
is called; the batch applies in order and the whole batch is rejected if one
command fails.

1. Advanced: read the head and its `publicationRevision`:

   ```bash
   platty epics head --project <project> --json
   ```

2. Write a revision file. New EPICs/domains use a `ref` (`new:<name>`) that
   later commands can use in place of an id:

   ```json
   { "envelopeVersion": "epic-revision.v1", "commands": [
     { "family": "create_epic", "ref": "new:refunds", "domainId": "<domain-id>", "name": "Refunds", "summary": "Order refunds", "reason": "<why>" },
     { "family": "move_document", "documentId": "<doc-id>", "epicId": "new:refunds", "reason": "<why>" },
     { "family": "rename_epic", "epicId": "<epic-id>", "summary": "<new summary>", "reason": "<why>" }
   ] }
   ```

   Families: `create_domain`, `create_epic`, `rename_domain`, `rename_epic`
   (name and/or summary), `reparent_epic`, `move_document` (API/event/schedule
   owners, ETC documents, unlinked screens, DB-logic anchors),
   `unassign_document` (back to ETC), `merge_epics`, `delete_epic`,
   `merge_domains`, `delete_domain`.
3. Advanced: apply it against the head you read:

   ```bash
   platty epics revise --project <project> --base <publicationRevision> --input <file> --reason "<why>" --json
   ```

4. Hand the returned `nextAction` (`generate-docs run --business-docs-only
   --epic <membershipChangedEpicIds>`) to the user. Business docs of removed
   EPICs are retired automatically; renamed-only EPICs keep their business docs.

Rules:

- Move or unassign documents before `delete_epic`; move EPICs before
  `delete_domain`. An EPIC or created domain left empty is rejected.
- Screens with an API link follow their APIs and cannot be moved by hand.
- EPIC and domain names must stay unique; the ETC bucket is never a target.
- `base_conflict`: re-read `epics head` and rebuild the batch.
  `source_conflict`: technical docs changed; run `platty sync run` first.
  `EPIC_EDIT_BUSY`: wait for the active EPIC, sync, or business-docs run.
- Edits are not pinned: a full EPIC regeneration re-plans everything, and an
  incremental sync may reassign documents whose code changed. Say so when a
  user plans a `--full` rerun or a sync.
- `epics head` marks screens with `apiLinked: true`; those follow their APIs
  and cannot be moved or unassigned by hand.

## Stop Conditions

- `platty claims` returns `CLAIM_OVERLAY_BUSY`: a business-docs run is active.
  Report it and wait; do not retry in a loop or cancel the run yourself.
- A Claim correction is requested for a structural fact (route, shape, DB
  access, call): stop and route to `platty-analysis-corrections` (`platty graph
  edge` or `platty graph supplement`) instead of `platty claims`.
- An agent overlay is proposed: stop after reporting the `confirm` nextAction;
  never confirm your own overlay.

- EPIC confirmation is required but no concrete `confirm-epics` command or run
  id is available: stop and report the missing command or run id.
- The user explicitly requested manual EPIC review before confirmation: stop
  and ask whether to proceed.
- User asks for sync while generated work is active, failed, or incomplete:
  route to `platty-sync` and stop before syncing.
- Known business-doc run has saved/completed tasks: preserve the run id and do
  not regenerate saved work.
- A lower-level command appears in a public happy-path suggestion: stop and
  reroute through this skill.
