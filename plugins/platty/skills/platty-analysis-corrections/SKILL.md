---
name: platty-analysis-corrections
description: Use when a Platty Service Map edge is wrong or missing, when static analysis missed an entry point, code relation, call edge, or code symbol, or when adding, replacing, suppressing, retiring, or restoring manual graph edges or analysis supplements.
---

# Platty Analysis Corrections

Two hotfix tools correct static-analysis results without changing the analyzer.
Pick by what is wrong:

| Wrong thing | Tool | Takes effect |
| --- | --- | --- |
| A Service Map edge between existing nodes (screen -> API, API -> table, job, event, external service) is wrong, missing, or should be hidden | `platty graph edge` | Immediately; no re-analysis |
| The analyzer never saw an entry point, code relation, call edge, or code symbol | `platty graph supplement` (alias `graph entry`) | After a human confirms and `platty analyze` reruns the owning phase |
| The LLM-written text of a generated technical-doc Claim is wrong | `platty claims` via `platty-generated-docs` | On read; business docs after regeneration |

Resolve `<project>` first (`platty project list --json`). A repository path is
never a project selector. `graph edge` writes and supplement
`confirm`/`retire` need `--actor <id>` and `--reason "<why>"`; state the source
file and lines that prove the change in the reason. Supplement `import` takes
only `--file`, `--actor`, and `--dry-run`; its proof goes in each item's
`evidence` and optional `reason`.

## Evidence Before Any Write

Only correct what source proves. Cite the file and line range that shows the
edge, relation, entry, or symbol. Absent static evidence is a gap to report
(`platty-evidence-audit`), not a reason to add an edge. If the proof is missing
or ambiguous, stop and ask.

## Service Map Edge Overrides (`platty graph edge`)

Overrides sit beside the analyzer's rows with an immutable audit history. Graph
trace/impact/view, MCP, `build_docs`, and the SOT all read the merged effective
graph.

1. Find ids. Nodes use the public ids that `graph trace` and `graph impact`
   print. For an automatic edge id, run `platty graph impact --from <node-id>
   --project <project> --json` and take `data.confirmed[].id` where
   `effectiveSource` is `automatic`. `manual_add`/`manual_replace` rows carry
   an `overrideId` instead.
2. Write exactly the change the user asked for:

   ```bash
   platty graph edge add --project <project> --from <node-id> --to <node-id> --kind <kind> --actor <actor-id> --reason "<why + file:lines>" --json
   platty graph edge replace --project <project> --edge <automatic-edge-id> --to <node-id> [--from <node-id>] [--kind <kind>] --actor <actor-id> --reason "<why>" --json
   platty graph edge suppress --project <project> --edge <automatic-edge-id> --actor <actor-id> --reason "<why>" --json
   ```

   Kinds: `navigates`, `calls_api`, `accesses_db`, `publishes_event`,
   `triggers`, `uses_external_service`, `opens_external_link`,
   `calls_db_object`, `trigger_target`, `scheduled_action`,
   `executes_db_object`.
3. Change or undo an override with its current revision from `platty graph
   edge show --override <id> --project <project> --json`:

   ```bash
   platty graph edge update  --project <project> --override <override-id> --expected-revision <n> [--from|--to|--kind ...] --actor <actor-id> --reason "<why>" --json
   platty graph edge retire  --project <project> --override <override-id> --expected-revision <n> --actor <actor-id> --reason "<why>" --json
   platty graph edge restore --project <project> --override <override-id> --expected-revision <n> --actor <actor-id> --reason "<why>" --json
   ```

   There is no delete. "Delete an analyzer edge" means `suppress`; "delete my
   override" means `retire`. An operation never changes: retire and create a
   new override instead.
4. The write returns `data.invalidatedDocumentIds`: those docs are now stale.
   Refresh them with `platty sync run --project <project> --json` via
   `platty-sync`.
5. Overrides survive re-analysis, but no CLI output (trace, impact, view, or
   `graph edge show`) reports one that stops applying, and there is no
   automatic `needs_review` transition. `replace`/`suppress` apply only while
   their original analyzer edge still matches exactly one edge; `add` applies
   while both endpoints resolve. After re-analysis, run `platty graph impact`
   on the affected nodes: each override edge must appear with its `overrideId`
   and each suppressed edge must be absent. Report any that do not; do not
   retire them on your own.

## Analysis Supplements (`platty graph supplement`)

A supplement is a note that adds evidence the analyzer missed. Ops:

| Op | Adds | Injected by |
| --- | --- | --- |
| `entry_add` | an entry point (api, page, job, event) | `build_route` |
| `relation_add` | a code relation (`api_call`, `navigation`, `db_access`, `external_service`, `external_link`) from a code symbol | `build_relations` |
| `edge_add` | a code-graph `calls` edge between two symbols (reflection, dynamic dispatch) | `build_graph` |
| `node_add` | a named code symbol the analyzer did not model (e.g. a lambda body) | `build_graph` |

1. Copy selectors from stored analysis. Take existing `filePath` and `symbol`
   values exactly from `platty code search --symbol <text> --project <project>
   --json` (`data.matches[].filePath`/`name`). A `node_add` symbol does not
   exist yet: use an analyzed file's `filePath`, the symbol name and
   `lineStart`/`lineEnd` from source, and an existing `parentSymbol` when it is
   nested. Take `repo` from `platty repo list
   --project <project> --json`. Target shapes are in `platty graph supplement
   --help`.
2. Write the import file with `"producer": "agent"` and source evidence:

   ```json
   {"supplements":[{"repo":"api","op":"relation_add","producer":"agent",
     "target":{"source":{"filePath":"src/orders/service.ts","symbol":"saveOrder"},"kind":"db_access","target":"orders","operation":"insert"},
     "evidence":[{"file":"src/orders/service.ts","lines":"14-18","why":"writes orders through an in-house DAO"}],
     "reason":"analyzer does not model the in-house DAO"}]}
   ```

3. Validate, then import. Imports are always `proposed`, and proposed
   supplements are ignored by analysis. Both calls exit 0 even when items are
   rejected. Inspect all three fields: stop if `data.invalid` is non-empty;
   `data.duplicates` match an existing supplement or an earlier item in the
   same file (in a dry run that reference can be provisional) and never mean
   confirmed or applied; dry-run `data.created` ids are provisional. Hand off
   only the `data.created` ids from the real import:

   ```bash
   platty graph supplement import --project <project> --file <file.json> --actor <agent-id> --dry-run --json
   platty graph supplement import --project <project> --file <file.json> --actor <agent-id> --json
   ```

4. Stop. Report the created ids and the confirm command. Only a human runs:

   ```bash
   platty graph supplement confirm <id...> --project <project> --actor <human-id> --reason "<why>" --json
   # more than 500 ids: the import writes them to <file.json>.ids.json
   platty graph supplement confirm --ids-file <file.json>.ids.json --project <project> --actor <human-id> --reason "<why>" --json
   ```

   Hand off the import's `nextAction` command as returned: above 500 created
   ids it already uses `--ids-file` (a JSON array, or one id per line), because
   thousands of ids as arguments fail with E2BIG. Per repository, at most 20,000 `relation_add` and at most 50 `entry_add`,
   `edge_add` and `node_add` combined can be confirmed.
   `platty graph supplement retire <id...>` withdraws one; it takes the same
   flags and is also a human decision.
5. After a human confirms or retires, follow the returned `nextAction`
   (`platty analyze --project <project> --json`). Then check each outcome with
   `platty graph supplement status --project <project> --json`: `applied`,
   `absorbed` (the engine already had it), `conflict` (the engine's entry wins),
   or `orphaned` (the selector matched no node; fix `filePath`/`symbol`).
6. Continue into docs with `platty sync run --project <project> --json`.

## Stop Conditions

- The user asked for a correction but no source file/line proves it: stop and
  ask; do not add an edge or supplement to fill a gap.
- Never confirm your own supplements or retire/restore overrides you were not
  asked to change. Report the command for a human instead.
- The request is to change a Claim's wording, not a route/relation/edge: route
  to `platty claims` via `platty-generated-docs`.
- `GRAPH_EDGE_OVERRIDE_CONFLICT`, `GRAPH_EDGE_EFFECTIVE_DUPLICATE`, or
  `GRAPH_EDGE_SELECTOR_AMBIGUOUS`: report the payload; do not retry with a
  different edge.
- `GRAPH_EDGE_OVERRIDE_STALE_REVISION`: re-read with `graph edge show` and
  confirm with the user before writing again.
- A supplement stays `orphaned` or `conflict` after analyze: report it with the
  reason; do not re-import variations in a loop.
