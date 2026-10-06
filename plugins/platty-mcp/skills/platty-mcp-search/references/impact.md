# Impact Questions (S1–S7 sweeps, one investigator, impact table)

Read only for change-impact ("W를 바꾸면 뭐가 깨지나"), regression-scope, bug-cause, A-to-Z chain, and direct
data edit questions — alone or inside a question list. They stay in this skill with both tracks plus
the sweeps below. Audits of earlier runs found such answers directionally right but missing five to
eight real consumers per chain: other writers of the same table, batch jobs, literals inside SQL
templates, webview copies of a screen, request-direction codes, and fall-through branches. The
relation checklist (every `route_relations` row, subscribers of each event, other writers of each
table) is the seed of the impact table; the sweeps close what the extractor cannot see.

Two axes, in this order — an answer that skipped either is partial:

1. **Data and events (tools first, mechanical).** For every changed route:
   `route_relations` (all pages) → each DB write / read target → `code_routes`
   on that relation's evidence line → every other route and screen touching
   the same data; each `event_publish` → its subscribers. These are the
   static analysis's own edges — list them all before any text search, then
   settle each row (affected / "관련 없음 — 이유" / unchecked).
2. **Values and rules (repo-wide text).** The changed value in every form
   (`15`, `0.15`, `15%`, `15퍼센트`, day counts, message text, constant
   names) searched in **each** repo over the whole repo — exclusion globs
   only, never a folder or file filter. Every hit is read and classified:
   computes the rule / displays it / unrelated. Rules copied into clients
   (a webview's own limit, a screen's hard-coded "10%") write nothing to the
   DB, so axis 1 cannot find them. Past miss: a rate lived in a server
   constant, an app constant with a different default, and two hard-coded
   screens; the folder-scoped search found one.

## Impact candidates (main session, once per impact question)

Collectors skipped both axes when only prose asked for them, so the main session runs them once,
deterministically, after Scope (step 2) and before dispatch:
`route_impact_candidates(entryPointIds | specDocumentIds` of the ≤ 5 owner route candidates,
`values`: the changed value forms the question names (never values read from code), `excludeGlobs`:
the Session Card exclusion globs, `routesPerTableLimit: 15)`. It lists seed data targets (what each
changed route reads and writes), other routes on each table, event listeners and their tables,
callers of the API routes, and value hits per repo.

Triage before dispatch — a change spreads through what the changed code **writes, emits, and
serves**, not through what it only reads:
- carry as rows: readers of each table the changed route writes, every `shared_access_code` row (the
  same code changes), event listeners, API callers, value hits;
- summarize in one line as unread scope: other writers of the same tables, and tables the changed
  route only reads ("같은 데이터를 쓰는 다른 기능 n개 — 이번 변경과의 관계 미확인"); data-edit and bug-cause questions carry
  other writers as rows — one of them may be overwriting the value.
- Carried rows go verbatim on the impact investigator card as
  `impact candidates:` rows `f1…fn` in result order, with each row's `resolution` / `reason` and the
  `coverage.partial` entries (reason, recovery, recoverable).
- Collectors settle every row in `relationChecklist` (`candidate: f<k>`): `checked` (evidence line
  read) | `not_relevant — <이유>` | `unchecked`. `unresolved` rows are candidates, never 확인됨 without a
  read; a `no_caller_found` / `no_listener_found` row is "검색 범위에서 찾지 못함".
- S1 and S3 are `done` only when every candidate row of their kind is settled and
  `coverage.complete` is true, or every `coverage.partial` entry of their section was recovered (its
  `recovery` calls run and logged, their rows settled). An entry not recovered —
  `recoverable: false` included — keeps the sweep `partial`, naming what stays open; recording it
  never makes it `done`. S2 counts the tool's value search for a repo only when that repo's row is
  `complete` and not `truncated`.
- Tool missing or failing after one retry: the investigator runs the axis-1 steps above by hand, and "후보 목록
  미생성" goes under 확인할 수 없는 부분.

## Sweeps

| Sweep | What it closes | How (the impact investigator) |
| --- | --- | --- |
| S1 same table / model | every writer and reader of the changed data, all repos | axis 1: the settled `impact candidates` seed-data / table rows; without them `route_relations` per changed route, then `code_routes({repoId, filePath, line})` on each data-access evidence line — both logged before any text search; then text search for the ORM model name, the mapped table name, and raw SQL / query-builder forms (camelCase, snake_case, plural) for what the graph cannot see; list every hit, never the first few; a `truncated` search is partial |
| S2 values, rules, literals | the changed value in every form, enum / status literals, rule constants, message text — SQL templates, config, client code, request DTOs and paths clients send | axis 2: per repo, whole repo, exclusion globs only; coverage lists repo → patterns → hit count; old clients keep sending the old value after a rename: check the request direction |
| S3 jobs and events | scheduled jobs, batch endpoints, emitters and listeners of the domain | the settled `impact candidates` event rows, then `route_resolve(kinds: ["job","event"])` with the domain words + search for the scheduler / listener registrations the guide names; each one needs activation proof (registration read, not commented out) |
| S4 client surface | every client — app, webviews, admin, seller / partner web, native and webview copies of the same screen | search the backend's stakeholder APIs for the entity first, then follow each route to its client; a client repo with no hit does not clear that stakeholder |
| S5 branch completeness | where a gated branch falls through (`if (!x) continue / return`, fallbacks, defaults) | read the fall-through path; "no target" is not "no effect" until it is read |
| S6 idempotency and aggregations | dedupe guards ("already granted"), counters, statistics, exports, reports, settlements that read the changed data | read each guard's condition |
| S7 close every open item | each 미조회 / unchecked / 문서만 row | one settling search or read, or mark partial with the reason |

Every sweep ends `done` (with its coverage: patterns, name forms, repos, per-repo status) or
`partial` (with what is open) and is listed in the ledger `notes`; a partial sweep's open items are
확인할 수 없는 부분 items. A sweep without an entry counts as not run.

## One investigator (impact questions)

An impact answer is an investigation that one mind must hold end to end:
split collectors each saw part of the picture and the merge mixed the
conditions of similar features. Dispatch, in parallel:
- the docs job (as usual);
- **one** `platty-mcp:platty-impact-investigator` job (no call budget) with the
  question, its asks, the Session Card and Term Map, the changed route
  candidates, every `impact candidates` row (triaged as above) with
  `coverage.partial`, and the value forms the question names.
Launch both in one message with `run_in_background: false` so the session
waits for them; never end the turn while the investigator runs (a headless
run stops idle background work). No main code job and no repo sweeps for an
impact question. The agent file itself carries the relation checklist,
asked effects, S1–S7 criteria, and the no-candidate fallback (Codex passes
that body as the worker prompt). The investigator's JSON is audited like any
code collector's; a gap it lists is one repair dispatch to the same agent
type.

## Answer additions (directly below 쉽게 말하면)

```markdown
**바꾸면 같이 봐야 하는 곳**
| 어디 | 무엇이 영향받나 (화면·업무 말) | 같이 고쳐야 하나 | 수준 |
| --- | --- | --- | --- |
| <화면 / 서버 처리 / 예약 작업 / 알림 / 기록·정산 / 외부 연동> | <그 화면·기능에서 바뀌는 것> [c: id] | <예 — 값이 따로 있음 / 아니오 — 바뀐 값을 그대로 받음> | 확정 |
```

One row per affected place, duplicates merged, business words only — no code identifier, path, or
English name in any cell (code locations go in 근거; sweep coverage in the ledger `notes`). 수준:
확정 | 추론 | 문서상 값(코드 미확인) (job-cards.md Levels); a place that could not be confirmed (not
found in the searched scope, not checkable in code) is a 확인할 수 없는 부분 item, not a row.
"영향 없음" is never written. The auditor audits every row; `[c: id]` is stripped from the final answer.

**One row per feature, conditions as the investigator wrote them.** Each
affected feature gets its own row even when names or code look alike; its
conditions (who, amount, cap, duplicate guard, period) are copied from that
feature's own claim — shortened in wording only, never merged with another
feature's or generalized ("이벤트 공통", "모두"). Past error: the investigator
reported each event's conditions separately and correctly; the final answer
merged them into one list and attributed one event's condition to all.

**Copies of a value are independent.** When the same rule or value lives in more than one place (a
server constant and an app constant, a hard-coded screen text, a config key), each copy is its own
row with "같이 고쳐야 함", unless you read the line where one copy is read from the other (an API field, a
shared config). Never write that copies "follow" or "change together" without that line. Past error:
two constants of one rate were described as one value the screen follows.

## Verify rules for impact answers

- An S1 or S3 sweep marked `done` while a candidate row of its kind is
  unsettled, or while a `coverage.partial` entry of its section was not
  recovered, or an S2 sweep whose searches carry a folder / file filter or
  skip a repo, is partial → one repair dispatch.
  Without a candidate list, an S1 `log` must hold `route_relations` and
  `code_routes` calls.
- Before accepting a row that says "no target", "no effect", or "not
  checked": run the S5 fall-through read or the S7 closing search yourself,
  or keep the row partial.
- An `event_publish` checklist row whose subscribers were not opened is a
  repair item (one dispatch), then a 확인할 수 없는 부분 item.
- A job or listener listed by S3 is "runs" only with activation proof; a
  commented-out registration is "코드에 있으나 비활성", a missing registration
  "등록 미확인".
- Legacy API generations inside the chain: include them only when a client
  call site still calls them (read it); otherwise note them in the ledger
  `notes`, never as an affected link.
