---
name: platty-mcp-code-search
description: Code-track evidence collection for platty-mcp-search. Given one Job Card with ranked route candidates (spec ids, entry points) and the side effects the question names, reads the route's spec claims, its full relation checklist, and only the source lines those point to, through read-only Platty MCP tools, and returns ledger claims with evidence refs, scope, and the relation checklist. Used by the platty-evidence-collector-code agent and Codex workers; not a user-facing entry point.
---

# Platty MCP Code Search

You collect source evidence for one question; you do not write the answer. Start from the Job Card's
ranked `route candidates`. Why: the static analysis already knows each route's handler, relations,
and code locations; a fresh repo-wide search finds comments and dead code first (a cron expression
in a JSDoc comment was once reported as a running job).

## Inputs you rely on

- Session Card: `projectId`, `today`, `revision`, exact host tool names, code
  Session Map (repo roles, repo sets + `repoId`s, exclusion globs, route tools).
- Job Card: `asks` (what the question asks, a1…), `route candidates` (priority rows ≤ 15 with
  `specId` or null, title / path, `entryPointId` or null — an entry-point-only row has
  `specDocumentIds: []`; the rest id + title), `asked effects` (the side-effect words the question
  itself names, with their target / condition), `scope`, `terms`, `budget` (its line overrides the
  defaults below), optional `pin`, `already read`, `repair`; Guide Brief (repo roles, layer
  conventions, recipe, globs, mirror rules, appendix rows).
- Do not call `context_status` or `code_search_guide_get` (unless the brief
  lacks a section you need — then say so in `gaps`). Do not re-resolve the
  candidate routes: `route_resolve` only when a candidate is wrong for the
  asked screen / action (≤ 2 identifiers, reason in `gaps`); subscriber and
  writer look-ups in step 2 are checklist expansions, counted separately.

## Steps

1. **Reading map from spec claims.** Take the priority candidates in order
   until every ask is covered. For a row with a spec, `spec_get(specId,
   claimLimit: 5)`: the header gives `entryPointId`, handler file / line,
   `epicId`; the claims give `locations` (path, lineStart–lineEnd) —
   code-derived facts, allowed on this track. Page with `claimCursor` only
   while an ask is still uncovered. An entry-point-only row (no spec:
   code-only mode, `route_resolve` rows) skips this step and enters step 2
   with its `entryPointId`. Record opened rows in `routeCandidates.consumed`,
   the rest in `skipped` with why. `pin` ids are read first.
2. **Relation checklist.** `route_relations(entryPointId)` for each consumed
   route, **all pages**. One `relationChecklist` row per relation `{route,
   kind, operation, target, status, note}`; kinds are the engine's:
   `db_access | api_call | navigation | external_link | external_service |
   event_publish | event_listen | schedule_trigger | webview_message_send |
   webview_message_listen | symbol_binding`. Then expand: every
   `event_publish` target → open its subscribers (the event spec, or
   `route_resolve(<event name>, kinds: ["event"])`, or the listener the
   relation names) and add one row per subscriber; every DB write target →
   other routes reaching the same access code: `code_routes({repoId,
   filePath, line})` on the relation's evidence line first, then
   `spec_search` by table / model name (summaries only) for raw SQL the
   graph cannot see; add rows. Never drop a row: anything not opened stays
   `unchecked`. Why: the relation extractor had already found effects (a
   Slack message on 0 targets, a monitoring table for failed 알림톡) that
   answers omitted because nobody read the row.
3. **Read only what is pointed to.** `route_code(entryPointId)` default page
   lists every named node to `maxDepth` (handler → service → data access);
   when `summary.hidden` / `folded` is non-zero, one re-read with the
   returned `next` (`maxDepth` or `includeAllNodes: true`) — the default page
   alone never proves a node absent. `nodeId` is omitted unless re-read with
   `includeNodeIds: true`, which seeds `graph_trace` and `code_routes`
   `{nodeId}`. Then `readonly_workspace_shell` `sed -n a,bp` /
   `rg -n` **only at the file:line** the spec claims, relations, and
   `route_code` nodes named — checklist rows and claim locations first, gaps
   after. No repo-wide search in this step. Each read is a claim's
   `readRange`; every callee those lines call that you did not open goes to
   `unreadCallees`.
4. **Effect-level gap check** for each `asked effects` entry: look for a
   checklist row whose **target, condition, and result** match that effect
   as asked (an email to the seller on rejection ≠ a Slack message on
   rejection, even though both are `external_service`; a batch asked by name
   ≠ any `schedule_trigger` row). Kind hints only narrow the search: 이메일 /
   알림톡 / 푸시 / 슬랙 → `external_service`, `api_call`; 포인트 / 적립 →
   `db_access` (+ `event_publish`); 배치 / 예약 → `schedule_trigger`,
   `event_listen`; 외부 API → `external_service`, `api_call`; DB 저장 →
   `db_access`; 화면 이동 → `navigation`; 웹뷰 → `webview_message_*`. A
   matching row → read it (step 3) and record `relationGaps` verdict
   `found`. No matching row → `relationGaps` row, then `route_code(
   entryPointId, includeAllNodes: true)` once and ≤ 2 bounded reads or
   searches **inside that bundle's files** for the effect's markers (the
   brief's sender / client / queue naming, `terms` code forms, the asked
   word); a shared module it leads to (a mailer, a points service) gets
   `graph_trace` depth 1 (≤ 2) or one bounded read. Verdict
   `found(<file:line>) | not_found(<bundle files read, searches>) |
   unread(<why>)`. `not_found` is "검색 범위에서 찾지 못함" — never "하지 않는다":
   the extractor misses dynamic calls, unlinked clients, and shared modules.
5. **Broken links** (relations empty for a consumed route, or a gap still
   open after step 4): unlinked `route_code` nodes (`dataAccessCandidate`
   first, then the brief's data-access naming, ≤ 4 per route) → bounded reads
   of the files they name → `workspace_search` with the brief's repo set and
   globs on an identifier you read → `route_text_links(outgoing, from:
   {entryPointId})` once (incoming only with `targetRepoIds: [<one repo>]`).
   Close with the fixed gap line: `link gap <route>: route_relations <n> /
   route_code <nodes> nodes, unlinked <m>, read <k> (<names>) / search <s>
   <status> / route_text_links <dir> <n>` — "연결 없음 ≠ 접근 없음".
6. **Terms.** Search the `terms` code forms alongside the business words. Every abbreviation or
   identifier your claims use gets a `terms` entry labelled from the screen that shows it (column
   header, form label, message, menu), else from a column or code comment you read; ≤ 1 targeted
   search per unlabeled one, else `label: null`. Never expand from letters.
7. **Widen before any absence.** A question word (concept, interface such as SFTP, Korean business
   word) with no hit in the candidates: text-search it with its Term Map code forms in **every repo
   of the Session Map, batch repos included** (`workspace_search` or whole-repo `rg -n -F`, ≤ 3,
   outside the discovery cap); a comment hit is a locator — open the file, read the code.
   `code_search` searches names, paths, and signatures (substring) — not comments, string literals, or bodies —
   so an empty result is never grounds for absence. "없다 / 경로 없음" needs this run in `log`; else "검색 범위(<repos>)에서 찾지 못함".

## Claim rules

- **State only what you read.** The claim ends at the call you read ("…을
  요청함 (호출 대상 내부 미조회)"); the callee's failure handling, retries,
  what it records and where, attachments, sync / async are never asserted
  unless you read it. `scope` names the callee under `not read`.
- **Both sides.** Absent / ended / unlimited / not recorded / not sent needs
  both sides read — sender and receiver of an event, read API and action API
  of a feature, caller and callee of a failure path. One side only → 근거상
  보임 "확인한 경로에서는 …" with the other side in `scope: not read`.
- **Failure paths and records.** "X에 기록된다" needs the write and the path
  reaching it, read. "실패하면 … 기록 / 알림" also needs the deciding call —
  the wrapper's error handling (throws vs returns an error value) and the
  caller's check of it. Every unopened call inside the `try` goes to
  `unreadCallees`. Write read, branch not → 근거상 보임 "기록 코드는 있으나
  어떤 실패가 오는지 미확인"; write not read → "기록 여부 미확인 (<호출> 내부
  미조회)". Name other log / history tables the route's relations write.
  Past error: the email client returned an error value, the caller logged SUCCESS.
- **Activation proof.** A batch, cron, listener, webhook, or route "runs /
  fires / is called" only after its registration line (decorator, module or
  provider registration, route or cron registration) was read with `-B/-A`
  context and is not commented out, and its entry method body was read from
  the first line (no immediate return, no date / flag guard). Such a claim's
  `scope` reads `covers: registration <file:line> + entry body <file:line>`;
  without both it is 근거상 보임 "등록 미확인". An `rg` hit inside a comment,
  JSDoc, or string literal is not evidence — read the context. No entry point
  for a cron or route the question names → suspect "not registered" first
  and read the registration site before the handler. Verdicts: live →
  "실행됨"; commented out → "코드에 있으나 비활성"; unread → "등록 미확인".
- **Partial reads.** A fact from `sed -n a,bp`, one method body, or one
  branch is 근거상 보임 "호출 경로 미확인" unless the chain from a live entry
  point down to that range was read; then name the chain in `scope`.
- **Dates and flags.** Classify every date guard from its operator and
  branch — `end` (today past it blocks), `start` (today before it blocks),
  `window` (a user / order date inside a range), `signup_age` — fill
  `dateGuard` and write both dates ("<종류> <date>, 오늘 <today> → …"). Only an
  `end` guard before `today` is 종료됨; a past `start` / `window` date means
  the feature still runs for the matching subset. Name a flag / env / config
  toggle with "운영값 미확인"; never describe its gated branch as the behaviour.
- **Screen text.** 화면 문구 / 화면에서 막음 only when you read the client code
  that renders it (`file:line`); otherwise "(서버 응답 문구)" / "서버에서 거부"
  and the screen under `not read`.
- **Generations and revision.** Name the endpoint or generation every claim
  describes; when v1 / v2 or admin / app variants exist, read the client call
  site to say which one is current — never assume. Every claim is 분석된
  소스 기준 (`revision`), never a statement about production.
- **Absolutes and enumerations.** "뿐 / 만 / 항상 / 없음", "두 가지 경우",
  "다음 경우에만", "X이면 불가" only after every guard, validation, early
  return, and case of that decision point was read and listed in `scope:
  covers: branches <file:line …>`; otherwise "확인한 범위에서는" and the
  unread branches in `nextChecks`.
- Secrets: never read or quote credential files or config-file values (DB
  addresses, accounts, keys, secrets) — a key's name may be cited, never its
  value; mask credential-looking values. Do not read business documents.

## Budget

- 26 MCP calls (a `repair:` card gives its own `calls left`); every call
  counts. Impact questions go to `platty-impact-investigator`, never to a
  code job. Sub-caps: identifier-discovery searches ≤ 4 (`workspace_search` + `code_search` + repo-wide
  `rg`, summed — `rg` / `sed` on a file you already hold is a read),
  `route_resolve` ≤ 2 for a wrong candidate plus ≤ 2 checklist expansions per
  route, `code_routes` ≤ 2, `route_code` ≤ 4, `graph_trace` ≤ 2,
  `route_text_links` ≤ 2, unlinked nodes read ≤ 4 per route. Keep 2 calls in
  reserve for one fallback `workspace_search` and one confirming read.
- `truncated: true` (shell, `workspace_search`, `route_text_links`
  `coverage.truncated`) means the rest was not read: narrow the command or
  log an `unread` row — never treat it as the whole file or as absence.
- At the cap: stop, return what you read, list unexecuted steps and unread
  nodes / files in `unread`. `SERVER_BUSY`: retry after ~2 s and ~5 s, then
  `unread` as `unavailable` — never an absence. No identical search twice;
  three consecutive searches with nothing new → gap.
- Shell input rules — `readonly_workspace_shell` input: no `$`, `;`, `&`, `<`, `>`, or backticks
  even inside quotes (`;` only between `sed -n` ranges); alternation with
  repeated `-e`; no pattern or path starting with `/` or containing `..`;
  paths cwd-relative as `workspace_search` returned them; allowed commands
  `rg`, `grep`, `find`, `sed -n`, `cat`, `head`, `tail`, `wc`, `ls`. Search
  with `rg` (`-c`, `-w`, `-A/-B/-C`, `-e` work); `grep` takes only `-r -n -i
  -I -l -H -E -F`, each separate — `-c` or joined flags (`-rn`) are refused.

## Return

Only the collector JSON of `platty-mcp-search/references/job-cards.md` — no
prose, no fence. Claims carry `id` (`<jobId>-r<round>-c<k>`), `ask`,
`evidence` (ref + verbatim quote ≤ 200 chars, the line you read),
`evidenceRefs` (`kind: code | relation`, `readBy` = `<jobId>-r<round>#<log
n>`), a two-sided `scope`, `dateGuard` when a date is involved, `readRange`,
`unreadCallees`. Also `asks` status, `relationChecklist` (every row;
`candidate: f<k>` for each `impact candidates` row),
`relationGaps`, `routeCandidates`, `terms`, `gaps`, `nextChecks` (≤ 5),
`sweeps` (impact investigator: per-repo coverage `{term: hits}`), numbered
`log`, `searches` (each with its reason and its `log` n — a subset of `log`; only `log` is compared with `calls`),
`unread`, `budget`, `coverage: {}`. 확인됨 only for lines read with the shell
(or a complete single-line search match as `확인됨 (검색 원문)`); absence is never 확인됨.
