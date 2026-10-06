# Code QA Recipes

Generic recipes for answering business questions from source code through
Platty Enterprise MCP tools. Stack-specific facts (file naming, folder layout,
how a screen calls the server, data-access style, table naming, mirror repos,
noise paths) come from the operator guide loaded with `code_search_guide_get`.
Substitute the guide's conventions into the `<...>` slots below; never assume a
layout the guide does not state.

## Generic Layer Recipe

Business systems usually follow this chain. Each layer lists what to look for,
the tool, and what the layer can and cannot prove.

| # | Layer | Find it by | Tool | Output |
| --- | --- | --- | --- | --- |
| L1 | screen | menu label, screen title, or button text from the question; the guide's menu → screen mapping if it has one | `workspace_search(SCREEN, "<label>", fixedStrings, globs=<screen file types>)` | candidate screen file (drop noise copies/backups) |
| L2 | event handler and client validation | the button's handler attribute → the handler function body | `readonly_workspace_shell(rg -n -e '<button text>' -e '<handler>' -A 40 <screen file>)` | required-field checks, alerts/message codes shown on screen, enabled/disabled conditions, the data sent |
| L3 | service URL | the server call inside the handler (the guide names the call helper and URL prefix rules) | same read | service URL / route path, request dataset or payload |
| L4 | controller / route handler | `route_resolve(projectId, query=<last URL segment>)` → `handler.filePath:lineStart`; fallback `workspace_search(SERVER, "<segment>", globs=<controller files>)` | `route_resolve` or `workspace_search`, then shell read | handler method, which service it calls |
| L5 | service | the service method the handler calls | shell `rg -n '<method>' -A 80 <service file>` | transaction boundary (annotation/explicit), state checks (`if` on status fields), thrown exceptions and message codes, loops, calls to other domains or external clients |
| L6 | DAO / repository → query id | data-access calls in the service or repository (string query ids, mapper methods, ORM calls) | `route_relations(projectId, entryPointId, kinds=[db_access])` details `queryId`/`tableName`; fallback shell `rg -n '<data-access call pattern>' <repository file>` | query id list (namespace + id) or ORM entity |
| L7 | SQL | the SQL file or annotation owning the query id (guide gives the location rule) | `workspace_search(SERVER, "<namespace or id>", globs=<SQL files>)` → shell `rg -n 'id="<statementId>"' <mapper.xml>` → `sed -n <a>,<b>p <mapper.xml>` | `WHERE` conditions, `UPDATE ... SET` columns, `INSERT` column lists, dynamic branches (`<if test>` or string building), joins |
| L8 | tables | tables named in L7 | from the SQL read | which tables are read, inserted, updated, deleted; history/temp tables |
| L9 | other writers | other SQL, screens, batch jobs, or interfaces that write or filter on the same table/column | `workspace_search(ALL or SERVER+BATCH, "<TABLE>")`, optionally `"<COLUMN>"` | cross effects: batch jobs, other screens, interface senders/receivers |
| L10 | mirror systems | repos the guide marks as mirrors / partner copies / shared SQL includes | `workspace_search(MIRROR, "<namespace or TABLE>")` | "the partner-side screen is also affected" flag, or not found (with status) |

At L4–L6, `route_resolve` should start with `includeDeprecated: false`
(retry with `true` only when nothing relevant is active, and disclose it).
A `route_relations` entry with `details.adapter: "user_supplement"` is a
manual connection by the analysis operator: use it as the lead for L6–L8 and
cite it as "수동 연결(운영자)". `route_relations` may be incomplete for routes
the operator did not curate, so a short relation list never replaces the L6–L9
text searches.

Optional at L4–L6: `code_search(<class name>)` → `graph_trace(depth 1, both)`
for callers/callees. When the trace stops at data access, record "engine link
not available" and continue with text search: missing graph links are expected
for string query ids and XML SQL.

### Missing links (route inventory complete, links may be missing)

On customer projects every API and screen entry point is indexed, but
screen→api (L3→L4) and api→db (L6→L8) links can be missing because of dynamic
patterns. Recover them with the SKILL's Missing-Link Ladder:

- L4 no match: re-query `route_resolve` with other identifiers (segment,
  handler name, screen file name, synonym) before concluding absence.
- L3→L4 missing: `route_text_links(projectId, direction: 'outgoing', from: {entryPointId} | {repoId, filePath})`;
  read the cited lines of each candidate; resolve `ambiguity` > 1 with the
  guide's routing / ownership rules; report "코드 대조로 찾은 연결".
- L6→L8 missing: `route_code(projectId, entryPointId, includeAllNodes?, maxDepth?, includeNodeIds?, includeViaPath?, limit?, cursor?)`.
  The default page lists every named node to `maxDepth` 2; callbacks and
  locals that certainly belong to a listed caller are folded into it
  (`folded` counts), and deeper nodes are counted in `summary.hidden` as
  `beyond_max_depth` / `other_pages`. The unlinked deeper helpers you are
  looking for are in the hidden part, so when `summary.hidden` or
  `summary.folded` is non-empty, replay the returned `next` re-reads first:
  `route_code(..., maxDepth: <bundle depth>)` or
  `route_code(..., includeAllNodes: true)`. Then read the nodes with
  `relationCount: 0`, data-access methods (`dataAccessCandidate`) first, and
  follow the query id / SQL / model mapping (L7, or the ORM variant).
  `nodeId` is omitted by default: take it from the `next`
  `route_code(..., includeNodeIds: true)` re-read of the same page before
  seeding `graph_trace` or `code_routes {nodeId}`; shell reads and
  `code_routes` work with `repoId` + `filePath` + `lineStart` without it.
- L9 reverse: `code_routes(projectId, target: {nodeId} | {repoId, filePath, line?}, kinds?, includeDeprecated?, limit?, cursor?)`
  on the SQL statement or model location, plus the text search for other
  writers.
- Callers of an API: `route_text_links(projectId, direction: 'incoming', from: {entryPointId}, targetRepoIds: [<one repo>])`
  (without `targetRepoIds` the scan truncates at `file_cap`).
- Registration check (is this batch / listener / route actually registered?):
  before saying a job, cron, listener, webhook, or route runs, read its
  registration line with context — `readonly_workspace_shell(rg -n -B 3 -A 3
  -e '<decorator or registration>' <file>)` — and confirm it is executable
  code, not a commented-out or JSDoc line. No entry point from
  `route_resolve` with `kinds: ['job', 'event']` for a cron or route the question
  names → suspect "not registered" (commented-out or absent registration)
  before "graph gap", and search the registration site before reading the
  handler body. A commented-out registration is "코드에 있으나 비활성";
  a handler body without its registration read is 근거상 보임 ("등록 미확인").
- Collector caps (`platty-mcp-search` code jobs, see its collector contract):
  `route_code` family ≤ 4 calls, ≤ 4 unlinked nodes read per route,
  `route_text_links` ≤ 2, discovery searches ≤ 4, 2 calls reserved for the
  text fallback + one confirming read; a link still missing ends with the
  contract's fixed `link gap <route>: …` line.
- Unlisted tool: same step with `workspace_search`, `readonly_workspace_shell`,
  and `graph_trace`. A link defeated by a dynamic pattern observed in source
  (call site `file:line` read) is 코드로 확인 불가 (동적 호출); otherwise
  report the actual gap (no link found in searched scope, tool unavailable,
  ambiguity unresolved) as 코드로 확인 불가 with that reason. Either way, say
  what was tried.

### Client caller ladder (client code with no route links)

Use when `code_routes` returns no routes for a method in a mobile or web
client, because client code is reached through providers, dependency
injection, or state containers that the engine does not link to screens.
Each hop is one `workspace_search` on the symbol (the method or class name),
`fixedStrings: true`, narrowed to the client repo, with generated files
excluded (negative globs for the generated-file patterns the guide names,
plus the usual noise set):

1. repository / client method: the method that performs the server call (found
   with `route_text_links` outgoing or by reading the file). Search its name
   to find the callers.
2. service / provider: the class or provider that wraps the repository. Search
   its method or provider name.
3. screen / widget / page: the file that uses that service or provider in
   screen code (the guide's screen folders). Read the usage lines.
4. screen route: map the screen file to its screen route with
   `code_routes(projectId, target:{repoId, filePath})`, or `route_resolve` on
   the screen's identifier (screen file name or handler name). `route_code`
   takes only an `entryPointId`, so it cannot map a file path to a route; use
   it only after a route is resolved.

Every relevant caller branch continues until it reaches a screen or route, or
dead-ends (no further caller found in the searched scope). The 3–4 hops limit
bounds the depth of a single branch only, one symbol per call; it never
bounds how many branches are followed. Stopping a branch early (hop limit hit
or no new candidate) requires listing that branch under 확인할 수 없는 부분 as
partial coverage, with the hops tried. Reaching one screen never completes a
caller or impact list: keep following the other branches. Keep one row per
hop in the trail. `route_text_links` incoming on a repository file returns files, not
screens (the file declares no route), so it only supplies the entry for hop 1.
A hop that cannot be read stays 근거상 보임; a ladder that ends before a screen
is reported as 코드로 확인 불가 with the hops tried.

### ORM / schema-model variant (L6–L9)

The L6–L8 rows above assume a SQL-mapper stack (query ids, mapper/SQL files).
When the guide or the data-access calls show an ORM or schema-model stack
instead (calls name a model or entity, not a query id), climb this ladder:

| # | Layer | Find it by | Tool | Output |
| --- | --- | --- | --- | --- |
| L6o | model / entity file | the model or entity name in the data-access call (`<client>.<model>.<operation>`, `<repository>.<method>`, an entity class) | `workspace_search(SERVER, "<Model>", globs=<schema/model files>)` → shell read | model definition: fields, types, defaults |
| L7o | table mapping | the model's table mapping annotation or directive (entity/table annotation, table-name directive or property); none means the naming convention decides — say so | shell `rg -n -A 3 '<Model>' <schema or model file>` | the real table name |
| L8o | relations / FK and delete policy | relation fields, foreign-key declarations, and the delete policy (and update policy: cascade, set null, restrict) on both sides of each relation | shell `sed -n <a>,<b>p` on the model block and its related models | which tables follow a delete or update; FK columns |
| L9o | repository / query usages | every repository, service, or raw query that uses the model | `workspace_search` on both the model name and the mapped table name (two calls: code uses the model name, raw SQL and batch jobs use the table name) | read/write call sites (create / update / delete / raw query) |

Raw SQL strings inside ORM code still go through L7. Migration files in the
repos can confirm columns and constraints; constraints that exist only in the
database stay [DB].

## Per-Type Recipes

Classify each question into one type. A question can borrow steps from another
type; reuse evidence instead of re-reading.

### T1 Processing flow — "what happens when I press X?"

Run L1–L10. Output numbered steps: screen check → data sent → server check →
state check → tables changed (in order) → history/notification/interface →
response and screen refresh. Use the transaction boundary to decide whether to
say "하나의 저장 묶음(실패하면 전부 취소)". Include tables written by other
domains the service calls.

### T2 Preconditions and state gates — "in which state can I do Y?"

Collect conditions from three layers separately: screen (enable/visible rules,
L2), service (`if` on state fields, thrown codes, L5), SQL (`WHERE <state> IN
(...)`, L7). Quote code values. Look for a code-level label (SQL `CASE WHEN
... THEN '<label>'`, constant names) as 근거상 보임; otherwise tag [DB].

### T3 Required values and validation — "what must I enter?"

(1) screen required checks and the field labels they point to; (2) server
validation (bean validation annotations, explicit empty checks); (3) SQL
`INSERT` column list and duplicate checks (`COUNT`/`EXISTS` before insert) with
their message codes. Without DDL in the repos, DB NOT NULL / unique constraints
are [DB].

### T4 Error cause and troubleshooting — "where does error Z come from?" / symptom reports

Search the message code across screen, server, SQL, and message-property files
in one `workspace_search`. Classify each hit: (a) screen script → client check,
the server is never called; (b) service `throw` → the `if` right above is the
cause; (c) a global exception handler → which exception maps to it. Message
text that is not in a file is [DB]. For symptom-only reports, give at most three
code-level candidate causes, each with how to confirm it (which data, which log
line, which screen capture). Log statements can be quoted; log locations and
contents are [런타임].

When the symptom follows a change or a condition that gates a branch (a
bug-cause question about "why did X get the wrong message / amount / state"),
run Impact Sweeps S5 (branch completeness) and S2 (literal sweep) below before
naming candidate causes.

Reply-letter variant (현업 회신문): rebuild the T4 result as "현업에서 확인할 것"
(screen message, record state, input values) plus "시스템이 막는 경우" list; keep
code evidence in 근거.

### T5 Number generation — "how is the number assigned? can a used number come back?"

Search number-generation patterns in SERVER SQL and code (sequence calls,
`MAX(...)+1`, a numbering table update, a numbering helper class, a procedure
call). Classify: DB sequence (not rolled back; gaps appear) / `MAX+1`
(concurrency duplicate risk) / numbering-table update (rolls back with the same
transaction) / procedure or DB object not in repos ([DB]). Confirm whether the
generation runs inside the save transaction (L5). For "split by X" requests,
check whether the key of the numbering rule contains X.

### T6 Change impact and regression scope — "what breaks if we change W?"

Fix the identifier (table, column, code value, constant, query id; on an ORM
stack, both the model name and the mapped table name — see the ORM variant
above). One
`workspace_search` across ALL with `limit` up to 1000 and `perRepoLimit`;
confirm every repo `complete`; if `truncated`, split by layer globs (screens /
SQL / server code / batch). Group hits by screen / API / SQL / batch / mirror /
interface. Read one or two representative hits per group to decide read vs
write. For short code values (`'21'`), search together with the column name or
read `-B3` context to drop noise. Regression scope = writers of the state +
readers filtering on it + batch jobs + external callbacks. Then run the Impact
Sweeps (S1–S7) below; each ends done with its coverage or partial.

When the impact list is large (dozens or hundreds of routes), do not list each
one in the answer: present feature groups with counts and representative routes
(a handler or screen per group), and keep the full list in the session ledger `notes`
(paged to exhaustion, per Pagination). For a method-level question,
count only routes whose `target.nodeId` is the method itself, not routes that
reach only its enclosing class.

### T7 Direct data edit impact — "what if we change the data directly?"

T6 plus: (a) history tables written only by the service (a direct edit skips
them); (b) batch or interface jobs that react to the state or resend data;
(c) caches, aggregates, and temp tables that will not follow. Answer as "바로
반영되는 것 / 따라오지 않는 것 / 위험". Run the Impact Sweeps (S1–S7) below;
S3 and S6 decide what "따라오지 않는 것" covers.

### T8 Data origin and snapshots — "does the contract change when the master changes?"

Check whether the `INSERT` copies names/values into the target table (copied at
save time) or stores only a key and the read SQL joins the master (live:
changes with the master). Mixed designs are common; report per column. For
copies (`INSERT ... SELECT`), report the source table per column.

A copied value is not yet a snapshot. For an existing-contract or
master-data-change question, run the other-writer check (L9): search the target
table and the copied columns for later `UPDATE` statements in services, batch
jobs, and interface/sync jobs that refresh them from the master. Confirm the
copy operation itself (the `INSERT ... SELECT` or copy lines you read, 확인됨 for
those lines only). A `complete` search with no later writer is never proof of
"never changes": `complete` can skip files over 16MB, and DB-side writers
(trigger, procedure, other systems) are outside source. Answer 근거상 보임 that
it looks like a snapshot within the searched scope, and list the
unchecked writers and what was not searchable (large files,
triggers/procedures, other repos or systems, partial search status) under
확인할 수 없는 부분. For "who owns this master", list every
writer: screen service, interface receiver ([외부] origin), batch.

### T9 Test scenarios — "what cases should we check?"

From the T1–T3 evidence, one row per branch (`if`/`else`, `throw`, SQL dynamic
branch): input condition / expected result per code / evidence `file:line`.
Expected message texts are code values only ([DB] for text). Add a "not
verifiable from code" row group: DB constraints, concurrency, permissions,
external systems. To look for existing tests, drop the test-code exclusions
from the default negative-glob set for those searches only.

### T10 Change request feasibility — "can we change it to V?"

Current logic (reuse T2/T5/T8) → the places to change (screen, handler/service,
SQL, common codes [DB], batch, mirror repos) → what may break (T6) → verdict:
가능 / 조건부 가능 / 코드 밖 결정 필요. For features that do not exist, report
"현재 코드에 없음 (검색 범위 명시)" and the nearest similar pattern only; tag
[신규].

### Impact Sweeps (S1–S7)

Mandatory for T6 and T7, for the "what may break" step of T10, for
impact-shaped T4 bug-cause questions, and for A-to-Z chain questions. Audits
of answers without these sweeps found five to eight real consumers missing per
chain. Each sweep ends either done, with its coverage (name forms and
patterns, tools, repo set, per-repo status), or partial, with what is still
open; the session ledger `notes` lists all seven (open items go under 확인할 수 없는 부분). In `platty-mcp-search` a
link-focused collector job may own a single sweep and report it in the
contract's `sweeps` field.

- **S1 Same-table and same-model writers and readers.** Search ALL repos, not
  only the owning server, for each name form: the model name (L6o), the mapped
  table name (L7o), and the forms raw SQL and query-builder code use —
  camelCase, snake_case, and plural variants (one `workspace_search` per form,
  `fixedStrings: true`). Then list every function that writes (create, insert,
  update, delete, upsert, raw `INSERT` / `UPDATE`) and every reader. List them
  all, grouped by feature per the T6 grouping rule; never filter to the
  writers that share the changed rule or to the first few hits.
- **S2 Enum, type-code, and status literals.** For each affected value search
  both the identifier form (`<Enum>.<VALUE>`) and the bare literal
  (`'<VALUE>'`, the numeric code): string literals inside SQL templates,
  query-builder templates, configuration, and client code are invisible to
  symbol search and route relations. Include the request direction:
  request DTOs, bodies, and paths that carry the value from clients, because
  old clients keep sending the old value after a renumbering or rename. Search
  the server DTOs for the enum type, then the client repos for the endpoint
  strings that accept it.
- **S3 Job and event inventory.** `route_resolve(projectId, query=<domain word>, kinds: ['job', 'event'])`
  for scheduled jobs and event handlers; `route_relations` kinds
  `schedule_trigger`, `event_publish`, and `event_listen` on the affected
  routes; and one `workspace_search` for the scheduler and listener decorators
  or registrations the guide names (cron annotations, scheduler registrations,
  queue consumers), narrowed by domain words. Exhaust `route_resolve` and each
  `route_relations` page by following `pageInfo.nextCursor` until none remains
  (the default is 20 results, so one page is not the inventory); if you stop
  early, report S3 as partial and name the remaining cursor. List each job,
  batch endpoint, emitter, and listener, then check each against the change: does it read,
  write, or branch on the changed thing? A job or listener found by the
  decorator search but missing from `route_resolve` is listed only after its
  registration line is read (Registration check): a registration that is
  commented out is "코드에 있으나 비활성", not an affected job.
- **S4 Client surface.** For every stakeholder (end-user app, webviews, admin
  web, seller or partner web, other repos), search the backend first for the
  stakeholder-specific APIs that touch the entity (the guide's admin, seller,
  or partner controller and use-case naming), then follow each route to its
  client with `route_text_links` incoming or the client caller ladder. A
  client repo with no hit does not clear the stakeholder: the logic may live in
  its backend API. Search webview repos as well as native ones; the same
  screen, logic, or constant (limits, thresholds, labels) often has a native
  copy and a webview copy, sometimes fed across an app-to-webview bridge.
- **S5 Branch completeness.** When the changed condition gates a branch
  (`if (!x) continue`, `if (!x) return`, a `??` default, `else`, a `default:`
  case, a fallback template), read the whole consumer function from the query
  to the branch and ask what happens when the row is absent or no longer
  matches: the fall-through path may run a different action (another message,
  amount, or state). "No target" is not "no effect" until the fall-through
  path is read.
- **S6 Idempotency, duplicate guards, and aggregations.** Search for code that
  reads the changed data to decide "already done" (dedupe checks, `exists` or
  `count` before insert, lookup-by-type helpers) and for counters, statistics,
  exports, reports, and settlements that aggregate it. A changed value or code
  can silently break a duplicate guard (a double grant) or an aggregate.
- **S7 Close open items.** Before answering, every row marked "not checked",
  "미조회", or "docs only" gets the one search or read that would settle it
  (for example the `source`, `status`, or `type` condition that would flip it),
  or is listed as partial with the reason.

## Search Patterns

- One identifier per `workspace_search` call. Prefer `fixedStrings: true` for
  labels and codes; use a regex only for structural patterns.
- Always narrow `repoIds` to the repo set and add `globs` for file types plus the
  negative noise/credential set.
- Korean labels may differ from the question; try up to two synonyms (menu label
  vs screen title vs button text), then stop.
- Use `perRepoLimit` when one repository dominates matches.
- Keep `globs` at 20 combined: at most 12 shared exclusions plus the
  per-question includes.
- `readonly_workspace_shell` quoting: the tokenizer does not support backslash
  escapes. Wrap patterns in single quotes and write double quotes literally
  (`rg -n 'id="<statementId>"' <mapper.xml>`); for alternatives pass repeated
  `-e '<a>' -e '<b>'` instead of a `|` regex.
- `readonly_workspace_shell` input rules. The server validates each command
  before it runs and answers `INVALID_INPUT` on a violation:
  - `$`, `;`, `&`, `<`, `>`, and backticks are rejected anywhere in the
    command, even inside quotes (single or double). Search the fixed text next
    to a `$` instead (for example the variable name), and search a generic or
    comparison by its identifier alone. `;` is allowed only between `sed -n`
    print ranges.
  - Alternation: do not put `|` in a regex; pass repeated `-e '<a>' -e '<b>'`
    instead. An unquoted `|` starts a pipeline of at most four allowlisted
    commands, and some server versions reject `|` even inside quotes.
  - Patterns and paths must not start with `/` (rejected as absolute paths):
    search `'v2/orders'`, not `'/v2/orders'`. `..` segments (`../`) are
    rejected too.
  - Paths are cwd-relative: file and directory arguments resolve against the
    `cwd` argument (default: the repository source root). Use the repo-relative
    paths that `workspace_search` returned; a path that does not exist fails,
    so take it from a search result before `sed -n`.
  - Allowed commands: `rg`, `grep`, `find`, `sed -n <a>,<b>p`, `cat`, `head`,
    `tail`, `wc`, `ls`, `pwd`, and the repository grep and file-list commands.
- `workspace_search` skips files larger than 16MB even when the repo status is
  `complete`. For a guide-named large file (menu tree, screen registry,
  code-value export), run one `rg -n '<identifier>' <that file>` before any
  "not found" stop.
- Comment and string hits: an `rg` / `workspace_search` match tells you the
  text exists, not that it executes. Before citing a decorator, registration,
  call, or condition from a hit, look at the matched line and its `-B/-A`
  context: a line beginning with `//`, `*`, `/*`, `#`, `<!--`, or inside a
  string literal is a comment / doc / text hit. Count such hits separately in
  the trail ("hits 3, of which 2 in comments") and never let a comment-only
  hit support 확인됨 or `확인됨 (검색 원문)`.

## Stop Conditions

Mark the item 코드로 확인 불가 or partial, write the next check, and stop
climbing when:

1. The menu / button / business word is not found in a `complete` search of the
   screen repos after two synonyms, plus one exact `rg -n` read of any
   guide-named menu/registry file above the 16MB search cap → "해당 명칭의
   화면을 코드에서 찾지 못함 (검색어: ...)". If it may belong to another
   system, tag [외부].
2. The service URL matches no handler (route index and a `complete` search) →
   "서버 연결을 찾지 못함 — 외부 연동 또는 다른 시스템 가능".
3. The query id has no SQL definition after one cross-repo search of the
   namespace → "SQL 미발견 — annotation/provider query or mirror include
   가능".
4. A code-value meaning, message text, or common-code group has no literal label
   in code → [DB].
5. The chain crosses an external call (HTTP client, interface module, approval /
   e-signature callback) → [외부]; do not narrate the other side.
6. Three consecutive different searches for the same open item add nothing
   new that is question-relevant (a new candidate, verified link, or
   eliminated hypothesis; incidental new files do not count) → conclude that item with
   what is known; list the next check under 확인할 수 없는 부분. The guard never skips
   pending mandatory ladder steps, mandatory fallbacks, or known unchecked
   candidates. Never repeat an identical search (the key includes `cursor` and
   filters such as `includeDeprecated`, `kinds`, `direction`, `repoIds`, so
   continuation pages and `includeDeprecated: true` retries are allowed). A
   link still missing after the Missing-Link Ladder is reported as the actual
   gap, 코드로 확인 불가 with its reason (no link found in searched scope,
   tool unavailable, or ambiguity unresolved); use 동적 호출 only when dynamic
   dispatch was observed in source (URL or query id built from variables at
   the call site) and cite that file:line.
7. `workspace_search` stays `truncated` or not `complete` after one narrowing
   retry → "검색 범위 부분적" with the affected repos.
8. `graph_trace`, `code_search`, `route_resolve`, or `route_relations` is
   empty → never "no impact" and never a stop by itself. The text-search
   fallback is mandatory: you must run one bounded `workspace_search` on the
   same identifier (query id, table, URL segment, class/method) before any
   stop; missing graph links are expected for string query ids and XML SQL.
   Stop only on that search's scope and status (items 1–3, 7).
