---
name: platty-mcp-code-qa
description: "Internal code-track ladder, explicit invocation by exact name only (never auto-selected for a question): session map, Evidence Ladder, Missing-Link Ladder, impact sweeps, and honesty levels for answering a business or operational question from source code only (code-only mode) through Enterprise MCP tools, kept for the SDD skills. To answer a user's project question use platty-mcp-search."
disable-model-invocation: true
---

# Platty MCP Code QA

Sub-skill: user-facing answers to project questions go through
`platty-mcp-search`, which runs this ladder (in-session for one code-only
question, as code collectors otherwise) and owns the answer shape (결론
first). Read this skill for the code ladder, recipes, and honesty rules.

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Answer business questions ("what happens when I press X", "which state allows
Y", "why does error Z appear", "what breaks if we change W") from source code
alone, for readers who are not developers. Code is the only evidence. The
operator code search guide tells you where things live; this skill tells you
how to climb from a business word to the exact source lines and how to say what
you found honestly and simply.

## When To Use

- `context_status.documentAvailability` reports `br`, `ucl`, `design`, and
  `data_dictionary` all 0. Technical spec counts (`api_spec`, `screen_spec`,
  ...) do not matter for this trigger.
- The user explicitly asks for a code-only / source-only answer ("코드로만",
  "문서 없이 소스 기준으로"), even when business documents exist.
- `platty-mcp-search`, `platty-mcp-retrieval`, or `platty-mcp-impact-analysis`
  handed off because the business-document maps are empty.

This skill was the code-track collector ladder of earlier `platty-mcp-search`
versions; the current code collector follows `platty-mcp-code-search` and
the Job Card budget in `platty-mcp-search/references/job-cards.md`, not this
skill. When this skill is invoked by name in collector style it returns the
collector JSON instead of a final answer and runs inside a per-job budget
(22 calls; discovery searches ≤ 4, `route_resolve` ≤ 3 identifiers,
`route_code` family ≤ 4, `graph_trace` ≤ 2, `route_text_links` ≤ 2 with
`targetRepoIds`, ≤ 4 unlinked nodes read per route, 2 calls reserved for the
source text fallback and one confirming read) and logs the climb as rungs
C0–C4 / B1–B5. The in-session code-only answer (no collectors) keeps the
budget-free Completion Criteria below.

## When Not To Use

- Business documents exist and the user did not ask for code-only:
  `platty-mcp-search` runs the docs track on `platty-mcp-retrieval` (its
  map-first hard gate stays authoritative there). Exception: when dispatched
  as the code-track collector of `platty-mcp-search`, run this ladder even
  though documents exist; the docs track runs separately.
- SDD or impact packet requests (`routeMode: seed-only`): retrieval keeps
  returning the Impact Seed Packet with the empty business-document maps as a
  documented gap.
- Setup, analysis, sync, document generation, project mutation, or Memory
  writes. Route explicit Memory intent to `platty-mcp-memory`.
- Designing a feature that does not exist. This skill reports "현재 코드에
  없음 (검색 범위)" plus the nearest similar pattern, never a new design.

## Boundary

Use only configured Platty Enterprise MCP tools. Never use local CLI, local
files, or a host shell, and never execute project code. If a needed MCP tool is
missing, name the capability gap and weaken the claim.

Secrets: never read, open, or quote credential or secret files — for example
`settings-helper.gradle`, `.env*`, `*credential*`/`*secret*` files, keystores
(`*.jks`, `*.keystore`, `*.p12`, `*.pem`, `*.key`), and properties/xml files
that hold connection info (datasource URLs, accounts, passwords) — even when
the shell allowlist would let you. Exclude them from every `workspace_search`
with negative globs.

Routing configuration is different: a web server or gateway routing
configuration file that the guide explicitly names (even when it lives under an
environment folder such as `env/`) may be read with bounded reads only — one
`rg -n '<path or prefix>' <that file>` or `sed -n <a>,<b>p <that file>` with a
narrow range, never a whole-file dump. Do not widen this to neighbouring files
the guide does not name. If a search hit or routing read shows a
credential-looking value (password, token, key, connection string), mask the
value and never repeat it in the answer or the trail.

## Session Setup (once per session)

Tool names: hosts may expose MCP tools with a server prefix (for example
`platty_route_resolve` for `route_resolve`). Use the names exactly as the
host's `tools/list` shows them, spelling and prefix included, and
never call unprefixed names blindly. This skill writes bare names.

0. `projectId`: when the user did not name a project, omit `projectId` on
   `context_status`: the server uses its default project (the Platty CLI's
   current project, or the only project you can read). Do not call
   `project_list` first. Call `project_list` only when that call returns
   `INVALID_INPUT` naming `projectId` (no default is set; the operator can set
   one with `platty project use <id>`), when the user names a project without
   its opaque ID, or when the user asks which projects exist. `context_status`
   echoes the `projectId` it used; pass that ID explicitly to every later call.
1. `context_status(projectId)` — record `documentAvailability`. All four
   business families at 0 confirms code-only mode. Note the tools it reports
   as `missing` or `unavailable`: it reports only those, so every other tool
   in the discovered `tools/list` is usable.
   Decide the disclosure (the per-family counts) here, at setup, before the
   first question. When business documents exist and the user
   explicitly asked for code-only, stay on this code ladder and add one line
   under 확인할 수 없는 부분 in every answer: the business documents exist
   (per-family counts from `context_status`, e.g. `br <n> / ucl <n>`) and
   were not consulted, so a cross-check against them is possible.
2. `code_search_guide_get(projectId)` — read it fully: replay
   `pageInfo.nextCursor` until no page remains. Extract into a runtime-only
   Session Map:
   - repository roles and which repo owns which domain / layer;
   - the layer conventions (screen file naming, how a screen calls the server,
     controller → service → data-access → SQL file layout, table naming);
   - the guide's recipes and any menu → screen or code-value appendix;
   - noise paths to exclude (vendor libraries, samples, copies/backups) and
     any credential files to avoid;
   - known gaps the guide itself lists.
   `available: false` means no guide: derive repo roles from
   `workspace_repo_list` names only and say so in the trail.
3. `workspace_repo_list(projectId)` — map repo names to `repoId`s and define
   named repo sets from the guide (for example SCREEN, SERVER-<domain>, BATCH,
   MIRROR). Reuse the sets for every question.
4. Build one negative-glob set of at most 12 exclusions from the default
   exclusion set below plus the guide's noise paths (merge with broad patterns
   such as `!**/*backup*/**` when the list is longer), and attach it to every
   `workspace_search`. The schema allows 20 `globs` combined (inclusions plus
   exclusions), so reserve at least 4 slots for the per-question includes.
   Globs accept `{a,b}` alternation; use it to keep each family in one slot.
   Default exclusion set (4 slots — credentials, then test/spec/e2e/fixture/mock
   code, which otherwise crowds real hits out of `perRepoLimit`):

   ```text
   !**/{.env*,*credential*,*secret*,settings-helper.gradle}
   !**/*.{jks,keystore,p12,pem,key}
   !**/{test,tests,__tests__,e2e,__mocks__,mocks,fixtures}/**
   !**/{*.spec.*,*.test.*,*_test.*,test_*.*}
   ```

   Drop the last two (test-code) exclusions only for a search whose question
   is about tests (T9 test scenarios, "is this covered by a test?"); keep them
   for every other question.
5. Capability check: record which route tools `tools/list` exposes —
   `route_resolve` and `route_relations` (Evidence Ladder entry), and the
   missing-link tools `route_code`, `route_text_links`, and `code_routes`
   (Missing-Link Ladder). Record each as listed / not listed; a tool that is
   not listed switches its ladder step to the documented fallback
   (`workspace_search`, `readonly_workspace_shell`, `graph_trace`).

The guide scopes where to search. It is never behavior evidence by itself.

## Question Card (runtime only)

For each question, before the first search, write a short card:

```text
Q<n> raw: <question as asked>
audience: <non-developer | developer> (per question, see Audience)
type: T1..T10 (see references/code-qa-recipes.md)
business words: <menu / button / message code / state / document names>
anchor candidates: <exact strings to search, one per call>
repo sets: <from Session Map>
flags expected: [DB] [외부] [런타임] [신규]
required steps: <ladder steps this type needs, incl. missing-link steps>
reuse: Q<m> evidence if same screen/service
```

## Evidence Ladder

Climb only as far as the question type needs (see
`references/code-qa-recipes.md` for the generic layer recipe and per-type
recipes). Each step names its tool.

1. **Route index first (when exposed).**
   `route_resolve(projectId, query?, httpMethod?, repoIds?, kinds?,
   includeDeprecated?, limit?, cursor?)` turns a URL segment, path, or handler
   name taken from a screen script or the guide into entry-point candidates:
   `{entryPointId, repoId, kind, httpMethod, path, fullPath,
   handler{nodeId, filePath, name, lineStart, lineEnd}, deprecated}`.
   Then `route_relations(projectId, entryPointId, kinds?, includeViaPath?, limit?, cursor?)`
   returns the route's outgoing facts grouped by source node, not as a flat
   list: `sources[{sourceNodeId, name, depth, parent/edge | via, relations[{kind
   (db_access, api_call, ...), operation, target, details (tableName, queryId,
   ...), evidence[{filePath, lineStart, lineEnd}], confidence?,
   unresolvedReason?, connection?}]}]` plus `relationCount` and
   `specDocumentIds`. `confidence` is omitted when high, `unresolvedReason` and
   `connection` when null, `repoId` when it is the route's, and a detail
   constant over the page (`orm`, `adapter`) sits once in
   `relationDefaults.details` instead of on each relation.
   Use them to jump straight to the handler lines and the query id / table
   candidates. They are static-analysis candidates: read the handler and SQL
   lines before calling anything 확인됨. An `unresolvedReason` is a lead to
   search, not an absence. Read sources by `depth` (it is stated once on the
   source, not on each relation): a source at depth > 1 is deeper bundle code (a service,
   use case, or helper the handler reaches through calls), so rebuild its
   chain with `parent` (the index in `sources` of the caller source, walked
   back to the handler) or `via{path, complete}` when the caller is not on the
   page, and read the handler → caller chain down to its `sourceNodeId` /
   evidence lines before attributing a relation to this route or calling it
   noise. A `tableVerified: false` target may be a
   repository, DAO, or wrapper class name rather than a table; confirm the real
   table with the mapping annotation/directive or the SQL before listing it as
   a table.
   **Active scope first.** Call `route_resolve` with `includeDeprecated: false`
   first: operators often mark most routes outside the project's analysis scope
   as `deprecated` (curated out of the documentation scope, not removed from
   code), so the active results are the routes the operator cares about. Only
   when nothing relevant is found, retry once with `includeDeprecated: true`.
   When the answer relies on a `deprecated` route (`deprecation{reason, note}`
   explains why), say so in plain Korean in 근거, for example
   "분석 범위 밖으로 표시된 기능", and repeat it in the evidence table row.
   **Operator-curated relations.** A relation with
   `details.adapter: "user_supplement"` (confidence medium) was connected
   manually by the analysis operator. It is operator-asserted evidence: cite it
   as "수동 연결(운영자)" in the evidence table, never drop it as noise, and do a
   bounded read of the source before calling it 확인됨 when the answer depends
   on its exact table/operation (otherwise it stays 근거상 보임).
   Absence of a relation is still not proof of no access: keep the
   `workspace_search` text-search fallback.
   **Sparse relations.** `route_relations` may be incomplete for routes the
   operator did not curate, because the engine cannot link every call. Treat
   few or zero relations as a lead, and the mandatory `workspace_search`
   fallback below still applies before any "not found".
   Pass `kinds` only with values the live schema lists.
   If `route_resolve` / `route_relations` are missing from the tool list (older
   server), skip this step and run the guide's recipes with `workspace_search`
   for the same anchors.
2. **`workspace_search`** — one exact identifier per call (menu label, button
   text, URL segment, query id, table name, message code, constant). Always pass
   narrowed `repoIds` from the repo sets and `globs` (file-type includes plus
   the negative set; 20 combined at most). `limit` ≤ 1000 (default 100),
   `perRepoLimit` to keep one repo from crowding out others, per-repo
   `timeoutMs` ≤ 15000, 60 s total.
   Read every `repositories[].status`: `status: complete` means the search ran
   to the end for that repo, but files larger than 16MB are skipped even then.
   `timeout`, `deadline_exceeded`, or unavailable means partial.
   If `truncated` is true or any status is not complete, narrow (fewer repos,
   tighter globs, a more specific pattern) and search once more; if it is still
   partial, record "검색 범위 부분적" with the repos affected.
   Before any "not found" stop that involves a guide-named large file (for
   example a menu tree, screen registry, or code-value export the guide points
   to), run one bounded `readonly_workspace_shell` `rg -n '<identifier>'` on
   that exact file; a miss there is part of the stated scope.
   Matches are candidates.
3. **`readonly_workspace_shell`** — exact reads in one repo: `rg -n` with
   `-A/-B/-C` context, then `sed -n <a>,<b>p <file>` for the exact region. Read
   the lines you will cite. Only lines read here (or returned verbatim by a
   relation's evidence and then read) can be 확인됨, apart from the
   single-line `확인됨 (검색 원문)` exception under Honesty Levels.
   The server validates every command first: follow the input rules in
   `references/code-qa-recipes.md` Search Patterns (no `$`, `;`, `&`, `<`, `>`
   or backticks even inside quotes; alternation with repeated `-e`; no pattern
   or path starting with `/`; paths relative to `cwd`).
4. **Optional:** `code_search` (one identifier: class, method, file name) and
   `graph_trace(seeds=[{kind:"code",nodeId}], depth=1, direction="both")` to
   find callers/callees. An empty trace or zero `code_search` result is not
   absence: missing graph links are expected for string query ids and XML SQL,
   because the engine may not link string-keyed data-access calls to SQL files.

**Empty graph/route fallback (mandatory).** When `route_resolve`,
`route_relations`, `code_search`, or `graph_trace` comes back empty, you must
run one bounded `workspace_search` on the same identifier (query id, table,
URL segment, class or method name) in the owning repo set before any stop.
Only that text search's scope and status decide a "not found".

## Missing-Link Ladder

Premise for customer projects: the **route inventory is complete** — every API
entry point and screen entry point is indexed — but the links between them may
be missing. screen→api links and api→db links are often dropped because the
code uses dynamic patterns (URLs built from variables, string-keyed query ids,
reflection, config-driven dispatch). A missing link is a lead to recover, never
evidence that the call or access does not exist.

If `route_code`, `route_text_links`, or `code_routes` is not listed in the
Session Setup capability check, run the same step with `workspace_search`,
`readonly_workspace_shell`, and `graph_trace` on the same identifiers, and note
the fallback in the trail.

1. **The entry is always a route.** Start every question with
   `route_resolve` (Evidence Ladder step 1). Because the route inventory is
   complete, when no route matches, re-query with other identifiers (another
   URL segment, the handler or controller name, the screen file name, a menu
   label synonym, `includeDeprecated: true`) before concluding the feature
   does not exist. A failed, empty, or erroring route query never authorizes a
   "does not exist" claim by itself: the mandatory `workspace_search` fallback
   (see Empty graph/route fallback) must run on the same identifiers, and only
   its scope and status decide. When it also finds nothing, report
   "검색 범위에서 찾지 못함 (시도한 식별자: …)" with the tried queries and
   statuses.
2. **api→db link missing** (the route has no or too few `db_access`
   relations):
   `route_relations` → `route_code(projectId, entryPointId, includeAllNodes?, maxDepth?, includeNodeIds?, includeViaPath?, limit?, cursor?)`,
   which returns the code the route reaches as nodes with `filePath`,
   `lineStart`/`lineEnd`, `depth`, `parent`/`edge` (the caller's index in
   `nodes`; walk it to the handler for the call chain, or pass
   `includeViaPath:true` for `via`), `relationCount`, and
   `dataAccessCandidate` (only when true: unlinked code that makes the same
   call as an extracted data access). Replay `cursor` until done.
   **The default page is bounded by depth**: every named node to `maxDepth`
   2 is listed. Anonymous callbacks and local variables that certainly
   belong to a listed caller are folded into it as `folded{callbacks, locals}`
   counts (the view never hides a named node), and deeper nodes are counted in
   `summary.hidden` by reason: `beyond_max_depth`, and on a paged read
   `other_pages` (plus Core's node-type counts). A missing api→db
   link lives exactly there — the deeper DAO / repository / mapper helpers
   with `relationCount: 0` are hidden as `beyond_max_depth` — so when
   `summary.hidden` lists `beyond_max_depth` (or `summary.folded` is
   non-zero), replay the returned `next` re-reads before
   reading any node: `route_code(..., maxDepth: <bundle depth>)` for the
   deeper nodes, or `route_code(..., includeAllNodes: true)` for every
   authorized node of the page. Never conclude from the default page alone
   that no unlinked node exists. `nodeId` is omitted by default and cannot be
   derived from the path and name: when a node must seed `graph_trace` or
   `code_routes {nodeId}`, replay the `next` `route_code(..., includeNodeIds: true)`
   re-read of the same page (same shaping and cursor) first — then
   `graph_trace(seeds=[{kind:"code", nodeId}])`. `readonly_workspace_shell`
   and `code_routes` need no `nodeId`: they take `repoId` + `filePath` +
   line (`repoId` is `entryPoint.repoId` when a node omits it). Then read the
   nodes without relations (`relationCount: 0`), data-access methods first
   (`dataAccessCandidate`, DAO / repository / mapper calls, then services),
   with `readonly_workspace_shell`. From each data-access call, follow the
   query id to its SQL, the SQL statement itself, or the model mapping to its
   table, per `references/code-qa-recipes.md` (L6–L8 or the ORM variant).
   As a `platty-mcp-search` collector: `route_code` default page once plus
   one hidden/folded re-read (`route_code` family ≤ 4 calls per job), read
   at most 4 unlinked nodes per route (data-access candidates → the guide's
   data-access naming → depth ascending), then bounded source reads and
   `workspace_search` with the guide's repo set and globs inside the
   discovery-search cap; `includeAllNodes: true` exposes the authorized
   bundle of that page, not the whole repository. Close a link that stays
   missing with the contract's fixed line in `gaps`: `link gap <route>:
   route_relations <n> / route_code <nodes> nodes, unlinked <m>, read <k>
   (<names>) / search <s> <status> / route_text_links <dir> <n> (<reason>)`.
3. **screen→api link missing** (a screen's server calls are not linked):
   `route_text_links(projectId, direction: 'outgoing', from: {entryPointId} | {repoId, filePath}, limit?, cursor?)`
   returns candidate API routes matched by text, each with `matchLevel`
   (`full_path` > `path_suffix` > `templated_prefix` > `method_name`;
   `templated_prefix` is a templated route such as `/feed/:id` matched by its
   literal prefix followed by a run-time part like `${id}`), `ambiguity` (how
   many routes the same text matches), `alreadyLinked`, and `sourceFilePath`
   (the file the cited lines are in). Verify each candidate by reading the
   cited lines in `sourceFilePath` (the call site) and the matched handler. When
   `ambiguity` > 1, disambiguate with the guide's routing / ownership rules
   (URL prefix → repo, domain ownership, gateway routing); if it stays
   ambiguous, list every candidate as 근거상 보임. Report verified links as
   "코드 대조로 찾은 연결" in the body and the evidence table.
   **Thin wrapper.** A thin wrapper page (it only renders components) names
   no route itself; the tool then also scans the nearest 20 files its code
   reaches (depth 1–4, see `sourceFilePath`), yet can return zero candidates
   when calls sit deeper. Do not read zero candidates as "no calls": retry with
   `from: {repoId, filePath}` on each of the component or screen files that
   `route_code` nodes or `route_relations` sources and their call chains
   (`parent`/`via`) name (client, service, or repository files first), then
   verify as above.
4. **Who calls this API (which screens)?**
   `route_text_links(projectId, direction: 'incoming', from: {entryPointId}, targetRepoIds: [<one repo>], limit?, cursor?)`
   lists files whose code text matches the route, with the screens or clients
   among them; verify each as in step 3. Always pass `targetRepoIds` with one
   repository for incoming: without it the scan truncates at `file_cap`
   (`coverage.truncated: true`) and proves nothing. As a `platty-mcp-search`
   collector, `route_text_links` is ≤ 2 calls per job (outgoing once, plus
   either the thin-wrapper retry or one incoming). A matching file in a layered client
   (repository, service) declares no route itself, so it names a file, not a
   screen: map it to screens with step 5 or the client caller ladder.
5. **Impact / reverse lookup** (table, column, SQL, or model → affected
   features): find the SQL statement or model location with `workspace_search`
   on the table / column / model name, then
   `code_routes(projectId, target: {nodeId} | {repoId, filePath, line?}, kinds?, includeDeprecated?, limit?, cursor?)`
   to list the APIs, screens, and batches whose code reaches that location.
   Then text-search for other writers (other SQL, batch jobs, interfaces) on
   the same table/column, since reverse reachability is only as complete as the
   links in step 2–3.
   `code_routes` `items` can mix routes that reach the target method with
   routes that reach only its enclosing class through other methods: count
   impact only for items whose `target.nodeId` is the innermost method node,
   and report the class-only reach separately.
   When `code_routes` returns no routes for client code (mobile or web clients
   whose calls are reached through providers, dependency injection, or state
   containers, so no route links exist), run the bounded client caller ladder
   in `references/code-qa-recipes.md` instead of stopping.
6. **Dynamic patterns that defeat all of the above** (URL or query id built at
   runtime, reflection, config- or data-driven dispatch): mark the link
   코드로 확인 불가 (동적 호출) and list what was tried (tools, identifiers,
   repos, status) in the trail and under 확인할 수 없는 부분, but only when dynamic
   dispatch was observed in source, for example a URL or query id built from
   variables at the call site, with its `file:line`. When no such site was
   read, do not infer it from the missing link; report the actual gap as
   코드로 확인 불가 with its reason (no link found in searched scope, tool
   unavailable, or ambiguity unresolved), and list what was tried the same way.

**Pagination.** `route_resolve`, `code_routes`, `route_code`,
`route_relations`, and `route_text_links` return pages (`route_resolve`
defaults to 20 results). When the answer claims a complete caller,
impact, or reachable-code list, follow `pageInfo.nextCursor` (and any
`truncated` or coverage flag) until the list is exhausted. Otherwise state
that the list is partial and which tool and cursor stopped it. A
`coverage.truncated: true` with no cursor to follow is also partial: the
complete `workspace_search` on the same text decides, and the answer names
what was not covered, using `coverage.truncatedReasons` (for example
`file_cap`, `deadline`, `oversized_files`) to name it.

## Completion Criteria

In-session (no collectors) there is no per-question call or time budget:
quality decides when an answer is done. As a `platty-mcp-search` collector,
the collector contract's per-job budget applies instead: at the cap, stop,
return the evidence read, and list the unexecuted rungs in `unread`; a budget
stop never skips a mandatory rung that still has calls left (the reserved
source fallback and confirming read exist for that) and never turns into an
absence. Keep investigating until all of these hold:

- every claim in the answer is 확인됨, or is explicitly classified as
  근거상 보임 or 코드로 확인 불가 with its reason (reason tag, searched scope,
  or what was tried);
- every required ladder step for the question type is done (the recipe for
  T1–T10 in `references/code-qa-recipes.md`, plus the Missing-Link Ladder
  steps whenever a needed link is missing);
- the mandatory fallbacks have run: the empty graph/route `workspace_search`
  fallback, the guide-named large-file `rg -n`, and the narrowing retry for
  partial search status;
- impact questions (T6, T7, impact-shaped T4, A-to-Z chains): every Impact
  Sweep S1–S7 in `references/code-qa-recipes.md` is done with its coverage or
  named partial with what is open.

Loop guard (quality, not budget):

- Do not repeat an identical search: the key is tool, pattern, repos, globs,
  `cursor`, and filters (`includeDeprecated`, `kinds`, `direction`, `repoIds`).
  Reuse its earlier result. A continuation page (new `cursor`) or an
  `includeDeprecated: true` retry has a different key and is allowed.
- Progress means question-relevant progress: a new candidate, a verified
  link, or an eliminated hypothesis. Incidental new files, lines, or routes
  that do not bear on the open item do not count.
- If three consecutive different searches for the same open item add nothing
  new in that sense, conclude that item with what is known, classify it
  honestly, and name the next check under 확인할 수 없는 부분.
- The loop guard never skips pending mandatory ladder steps, mandatory
  fallbacks, or known unchecked candidates; it only stops open-ended
  exploration beyond them.
- In a batch of questions, reuse confirmed evidence from an earlier card
  (`reuse: Q<m>`) instead of re-reading the same screen or service.

## Trail Recording

Every answer keeps its trail in the session ledger `notes` (never in the answer; 근거 cites its rows):

- each evidence row: step, repo, `file:line`, what the line shows, and its
  honesty level;
- `Tools:` the ordered list of tool calls for this question with a count;
- `Searches:` each `workspace_search` pattern, repo set, globs summary, match
  count, per-repo status (`complete` / partial), and `truncated`;
- route tool use (`route_resolve` query, chosen `entryPointId`, relation kinds
  used) or "route tools not exposed";
- graph use and whether it returned edges.

Paths are repo name + path relative to the repo source root.

## Honesty Levels

Use exactly three levels.

| Level | Meaning |
| --- | --- |
| 확인됨 | The cited source lines were read with `readonly_workspace_shell`, or the single-line exception below applies (written `확인됨 (검색 원문)`). |
| 근거상 보임 | Only a search hit, route relation, graph edge, naming, or a label inside code (SQL `CASE` label, constant name) supports it. |
| 코드로 확인 불가 | Code cannot answer it. Add the reason tag. |

Single-line exception — `확인됨 (검색 원문)`: a fact that lives entirely on one
source line (a constant definition, an annotation or decorator, a mapping or
config line) may be marked `확인됨 (검색 원문)` without an extra shell read when
the `workspace_search` match returned that full, untruncated line (no trailing
`…` or omitted-text marker, the statement visibly complete) with its
file:line, and that repo's status is `complete`. Cite the match path and line
as given. Multi-line logic (conditions, loops, method bodies, SQL statements,
anything whose meaning depends on surrounding lines) still needs an exact read
with `readonly_workspace_shell` before it is 확인됨.

Reason tags for 코드로 확인 불가:

- **[DB]** code-value meanings, message texts, common-code tables, actual data,
  DB constraints/sequences/procedures not present in the repositories;
- **[외부]** behaviour beyond an external call or another system (approval,
  e-signature, interface/EAI, a system whose repo is not registered);
- **[런타임]** logs, timing, concurrency in production, environment settings,
  actual user input;
- **[신규]** the requested feature does not exist in the searched scope.

Rules:

- An empty search result is not proof of absence or no impact. Say "검색 범위
  (repos, pattern, status)에서 찾지 못함" and only after a `complete` search
  plus up to two synonyms.
- A screen-only check (client validation, a disabled button, a hidden field)
  is not proof of a server rule. State the screen rule and the server rule
  separately; if the server has no matching check, say so as a finding.
- Quote code values as they appear (`'21'`, `'Y'`). Give a meaning only when the
  code itself labels it, as 근거상 보임; otherwise tag [DB].
- Dynamic SQL (`<if test=...>`, string-built queries): name the parameter
  condition that switches each branch; never present one branch as the whole
  rule.
- Never describe what happens inside an external system or after a callback you
  cannot read.

## Plain Korean Rules

Business terms first; code names appear only in 근거. Conclusion first (the
결론 of the `platty-mcp-search` template), then 쉽게 말하면, one action per line. Translate technical
words: UPDATE → "바꿉니다", INSERT → "새로 저장합니다", WHERE 조건 → "~인
경우에만", transaction → "하나의 저장 묶음(실패하면 전부 취소)", cache →
"미리 복사해 둔 목록". Wording table, evidence/trail format, and a worked
evidence example: `references/answer-template.md`.

Business terms are the **words users see on screen**. Legacy code often names
tables, columns, and variables with abbreviations (a code `<약어>` that the
screens show as `<화면 용어>`); business readers cannot follow an answer
written in them.

- Search a screen word in its code forms too, using the guide's abbreviation
  or vocabulary sections and any `terms` the orchestrator passed.
- For every abbreviation or code identifier the answer needs, take the screen
  word from, in priority order: the label on the screen that shows that field
  (a grid column header or form label bound to that column, a message
  resource, a menu name) > DB column comment > code comment > guide. Use
  labels from reads you already made, plus at most one targeted
  `workspace_search` for the identifier in screen files per unlabeled
  abbreviation.
- This skill stays code-only: it does not read glossary or data dictionary
  documents for vocabulary (the search orchestrator and docs track do), so the
  code-only disclosure that business documents were not consulted stays true.
- Never expand an abbreviation from its letters. Still unknown → keep the
  code form with "(업무 용어 미확인)" and list it under 확인할 수 없는 부분.
- Non-developer body: screen words only. Developer answers keep identifiers
  exact and add the screen word once at the first mention,
  `` `<약어>`(<화면 용어>) ``.
- A screen word ↔ code form pairing goes in the matching 근거 item (no
  separate term table). A mapping is vocabulary, not behaviour evidence: one backed only by the guide
  or naming is marked 근거상 보임.

## Audience

The answer **audience is decided per question** and written on its Question
Card. The evidence work (ladders, honesty levels, loop guard) is identical;
only the answer's presentation changes.

- **Default: non-developer.** Plain Korean business wording, uncertain points
  presented as candidates or hypotheses with what would confirm them, code
  evidence in 근거.
- **Developer** when the question is developer-oriented. Signals:
  - code identifiers: file, class, or method names, API paths, table or column
    names, query ids, stack terms;
  - developer phrasing: "어디를 고쳐야", "쿼리", "API", "리팩터", "소스 코드",
    "코드 어디", "서버 로그", "배포 시", or the user saying "개발자용".
  - Bare "코드", "로그", "배포" alone are not signals: operational questions use
    them too ("승인 코드가 무슨 뜻인가요?", "로그인 로그가 남나요?", "배포된
    쿠폰"). Switch on these words only with 기술 맥락 (technical context): code
    identifiers, file/class/API/table names, or a phrase above. Otherwise keep
    the non-developer default. Example: "승인 코드가 무슨 뜻인가요?" stays
    non-developer; "승인 코드 어디서 만드는지 코드 어디 봐야 해?" is developer.
- An explicit user instruction ("비개발자용" / "개발자용") overrides detection.
- Decide per question; a QA list can mix both. With no signal, keep the default.
- The audience is not printed: every answer has the same four parts
  (`../platty-mcp-search/references/answer-template.md`).

Developer style: the same four parts; a developer question may repeat the
code form it named in 결론, and 근거 carries the `repo:file:line` locations
with 요지 (≤ 3 코드 lines) — there is no separate developer template.

## Answer Shape

The final answer shape is owned by `platty-mcp-search`
(`../platty-mcp-search/references/answer-template.md`), not by this skill:
결론 → 쉽게 말하면 → 근거 → 확인할 수 없는 부분, the same four parts for
every audience. A single code-only question answered in the main session
(in-session on this ladder, no collectors) uses that same template, so it also
opens with 결론; as a collector, return the collector JSON and no answer at all.

This skill contributes only what the code track adds to that template:

- the audience decision (see Audience) and the three honesty levels as the
  status values;
- the code-only lines under 확인할 수 없는 부분 (business documents exist but
  were not consulted; 코드로 확인 불가 with its reason tag and what was tried);
- the evidence rows and the trail (Tools / Searches / Route / Missing links /
  Graph) in the session ledger `notes`, feeding 근거, and the evidence-row notes
  (deprecated route, 수동 연결(운영자), 코드 대조로 찾은 연결, 동적 호출);
- the plain Korean wording table and the screen-word rules.

All of these are in `references/answer-template.md`.

## Red Flags

| Thought | Correct action |
| --- | --- |
| "The search hit shows it, call it 확인됨." | Read the line with the shell first, or mark 근거상 보임 — unless it is one complete, untruncated line from a `complete` search: then `확인됨 (검색 원문)`. |
| "This deep relation looks like noise for the route." | Read the handler → caller chain to its `sourceNodeId` first. |
| "`route_relations` lists the tables." | `tableVerified: false` may be a repository/wrapper name; confirm with the mapping or SQL. |
| "This `user_supplement` relation is manual noise." | It is operator-asserted: cite "수동 연결(운영자)", read the source before 확인됨, never drop it. |
| "Only a deprecated route matches, so I'll answer without saying so." | Say "분석 범위 밖으로 표시된 기능" in 근거 and in the evidence row. |
| "Status '21' obviously means manual completion." | Quote `'21'`; meaning is [DB] unless the code labels it. |
| "No matches, so nothing else is affected." | Report searched scope and status; not proof of no impact. |
| "The changed value skips this batch, so the batch is unaffected." | Impact Sweep S5: read the fall-through branch; "no target" is not "no effect". |
| "The screen blocks it, so the system forbids it." | Check the server layer separately. |
| "I'll describe what the approval system does next." | Stop at the call; tag [외부]. |
| "Route tools are missing, so I can't answer." | Use the guide recipes with `workspace_search`. |
| "Let me read the credentials helper to see the DB." | Never; it is excluded. |
| "The guide's routing config is under `env/`, so I can't read it." | Bounded `rg -n` / `sed -n` on that named file only; mask credential-looking values. |
| "`complete` status, zero hits, so the menu entry does not exist." | Files over 16MB are skipped; `rg -n` the guide-named large file first. |
| "The graph has no edge to the SQL, so the query is unused." | Run the mandatory `workspace_search` fallback on the query id / table. |
| "I've used a lot of calls, so I'll stop and answer partially." | In-session: there is no budget; continue until the Completion Criteria hold. As a collector: stop only at the contract cap, and then return `unread` with the rungs not run — never a padded or guessed claim. |
| "`SERVER_BUSY` came back, so that path has no evidence." | Retry after about 2 s, then 5 s; still busy → the read is `unavailable`, the claim keeps its level, never an absence. |
| "`route_text_links` incoming without `targetRepoIds` scanned 500 files, so these are all the callers." | Without `targetRepoIds` the scan truncates at `file_cap`; narrow to one repo and re-run. |
| "Same search again, maybe it returns more this time." | Never repeat an identical search; after three different searches add nothing new, conclude that item. |
| "No route matches, so the feature does not exist." | The route inventory is complete; re-query with other identifiers first. |
| "The route has no `db_access` relation, so it touches no table." | Run `route_code`, replay its hidden-node re-reads, and read the nodes without relations, data-access first. |
| "`route_code` listed no node without relations, so nothing unlinked exists." | The default page is bounded by `maxDepth`; `summary.hidden` (`beyond_max_depth`) holds the deeper helpers. Replay the `maxDepth` / `includeAllNodes: true` `next` re-reads first. |
| "I'll build the `graph_trace` seed from the node's file and name." | A `nodeId` is a scoped symbol, not derivable; replay the `includeNodeIds: true` re-read of the same page and use its `nodeId`. |
| "`route_text_links` found a match, so the screen calls this API." | Read the cited lines first; `ambiguity` > 1 needs the guide's routing rules. |
| "The URL is built at runtime, so I'll guess the target." | Do not guess. 동적 호출 only with the call-site `file:line` where it was observed; otherwise name the actual gap. List what was tried. |
| "The link is still missing, so it must be a dynamic call." | Missing is not dynamic. Report the actual gap as 코드로 확인 불가 with its reason. |
| "`code_routes` on a class or container target lists 100+ routes for a one-line method." | Routes reach the class, not the method. Use the innermost method target and count only items whose `target.nodeId` is that method. |
| "The graph says the call reaches the wrapper method, so the wrapper is affected." | A raw library client call can be linked to a same-named wrapper method by name alone (a false edge). Read the receiver at the call site to confirm its type before attributing. |
| "`route_text_links` returned nothing for the page, so the page calls no API." | A thin wrapper page reaches its calls through other files, possibly deeper than the tool scans; retry with `{repoId, filePath}` of the component files from `route_code` nodes / `route_relations` sources (follow `parent` or `via`). |
| "Docs are empty, so I'll run the retrieval ladder anyway." | Empty maps; stay on this code ladder. |

## Stop Conditions

Stop the current layer, mark the item 코드로 확인 불가 or partial, and name the
next check when: the business word is not found in a `complete` search of the
screen repos after two synonyms; a service URL matches no handler after the
Missing-Link route re-query; a query id has no SQL file after one cross-repo
search; a meaning lives in data; the path crosses an external call; a link is
defeated by a dynamic pattern observed in source after the Missing-Link
Ladder; three consecutive different searches add nothing question-relevant
(never skipping pending mandatory steps or known unchecked candidates); or search coverage stays partial after one
narrowing retry. An empty graph/route result is never a stop by itself: the
mandatory `workspace_search` fallback on the same identifier
runs first, and a guide-named file above the 16MB search cap gets one exact
`rg -n` read. Details: `references/code-qa-recipes.md`.

## References

- `references/code-qa-recipes.md` — generic layer recipe, per-type recipes
  T1–T10, stop conditions.
- `references/answer-template.md` — the code track's contribution to the
  `platty-mcp-search` answer template: evidence rows, trail format, status
  values, plain Korean wording table, worked evidence example with
  placeholders.
- `references/pressure-scenarios.md` — load only when validating or changing
  this skill.
