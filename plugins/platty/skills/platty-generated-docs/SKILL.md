---
name: platty-generated-docs
description: Use when generating, validating, reviewing, resuming, or repairing Platty generated outputs through the public generate-docs workflow.
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

## Agent Provider Gate

platty-generated-docs owns the provider gate. Other Platty skills should route
here instead of asking duplicate provider questions.

Before starting worker-backed generated-output work, ask which provider to use
unless the user already chose one in the current conversation or the verified
`nextCommand` or `nextAction.command` already includes `--provider`.

Ask in the user's language. For Korean users, ask:

```text
어떤 실행 방식으로 생성할까요?

1. Codex CLI - 기본값, PATH의 `codex exec` headless JSON 실행
2. Claude Code CLI - PATH의 `claude` JSON 실행
3. Claude API - Anthropic API 키 필요
```

Map the answer to command flags:

| Choice | Flags |
| --- | --- |
| Codex CLI | omit `--provider` or use `--provider codex_cli`; requires installed Codex CLI available on `PATH` |
| Claude Code CLI | `--provider claude_code`; requires installed Claude Code CLI available on `PATH` |
| Claude API | `--provider claude_api` |

If the user chooses Claude API, `claude_api` requires `ANTHROPIC_API_KEY`.
The shell environment takes precedence; the CLI also loads `~/.platty/.env`.

```bash
open ~/.platty/.env
```

The file must contain an uncommented line:

```env
ANTHROPIC_API_KEY=<anthropic-api-key>
```

If the CLI returns `ANTHROPIC_API_KEY_REQUIRED`, follow the response's
`nextCommand` or `nextAction.command`, let the user add the key, then retry the
same command.

Keep the selected provider for the whole generated-docs workflow. If
`generate-docs run` reaches EPIC confirmation, run the returned
`generate-docs confirm-epics` command automatically unless the user explicitly
asked to review EPICs before confirmation. Preserve the same provider flags when
reconstructing a command.

## Public Workflow

Inspect targets before generation:

```bash
platty targets list --project <project> --json
```

Start or resume public generated-output work:

```bash
platty generate-docs run --project <project> --json
```

With an explicit provider choice:

```bash
platty generate-docs run --project <project> --provider claude_api --json
```

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

If a provider was selected earlier, preserve it:

```bash
platty generate-docs confirm-epics --project <project> --run-id <run-id> --provider claude_api --json
```

### Finalize: export the SOT projection

`generate-docs` does not refresh the SOT projection. Auto-export only runs for
`analyze` (and the analysis pipeline `run`), so after `analyze` the SOT under
`~/.platty/sot/<projectId>/` still reflects only catalog state — the technical
docs, EPICs, and business docs you just generated are not in it until you
export.

When the generation run reaches terminal completion (business docs all saved,
no failed tasks), export the SOT so retrieval, SDD, and memory read the new
content:

```bash
platty sot export --project <project> --json
```

Confirm the projection advanced: the README `lastExportAt` should move to the
export time and the `epics`/`docs` counts should be non-zero. Skip the export
only if the run stopped before terminal completion (for example it is still at
`epics_confirmation_required`, or a stage has failed tasks awaiting
`retry-failed`).

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

- target review is missing or incomplete;
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

## Stop Conditions

- EPIC confirmation is required but no concrete `confirm-epics` command or run
  id is available: stop and report the missing command or run id.
- The user explicitly requested manual EPIC review before confirmation: stop
  and ask whether to proceed.
- `targets list` shows target review is incomplete: stop and route target work
  through `platty targets ...`.
- User asks for sync while generated work is active, failed, or incomplete:
  route to `platty-sync` and stop before syncing.
- Known business-doc run has saved/completed tasks: preserve the run id and do
  not regenerate saved work.
- A lower-level command appears in a public happy-path suggestion: stop and
  reroute through this skill.
