# Job Cards, Collector JSON, Levels, and the Ledger

## Session Card (every job receives it verbatim)

```text
projectId: <id echoed by context_status>
today: <YYYY-MM-DD — the runtime's date>
revision: <analyzed revision / sync state from context_status or workspace_sync_status, or 미확인>
tools: <bare name → host name map>
tracks: docs+code | code-only (<reason>)
documentAvailability: br <n> / ucl <n> / design <n> / data_dictionary <n> / specs <n>
session map (code): repo roles, repo sets + repoIds (workspace_repo_list), exclusion globs, route tools listed
guide: available (<sha256 prefix>, <totalChars>) | not registered
vocabulary tools: <glossary_term_search / glossary_translate when usable>
```

No guide → proceed from repo names and note "코드 환경 가이드 미등록" in the ledger `notes`.

## Guide Brief (per job)

Cut from the guide read in Setup, verbatim, each part headed
`guide:<section>`. Docs job: vocabulary / abbreviation sections and the
appendix rows the question names. Code job: repo roles, layer conventions
(screen → server call → service → data access → SQL), the recipe for the
question type, exclusion globs, mirror rules, appendix rows. Never the whole
guide. Guide facts give scope and vocabulary, never behaviour (근거상 보임 at most).

## Audience (per question, on every card)

Default non-developer (현업). Developer only with technical context: code
identifiers in the question (file, class, API path, table, query id) or
phrases such as "어디를 고쳐야", "쿼리", "리팩터", "소스 코드", "개발자용".
Bare "코드 / 로그 / 배포" are not signals; an explicit "비개발자용 / 개발자용"
overrides. Audience never changes the four-part answer (answer-template.md).

## Docs Job Card

```text
job: Q<n>-docs            round: 1 (2 on a repair card)
question: <raw question>
asks: <a1: … ; a2: … — one per distinct thing asked (처리 / 사유 / 판매자 안내 = three); never merged>
audience: non-developer | developer
business words: <menu, button, state, message, document names from the question>
epics: <tier-1 EPICs: epicId / name / tier / reason>   (tier-2/3 only on expansion)
families: <per EPIC: BR present(<documentId>) | not_generated | empty | failed(<why>) ; UCL … ; DESIGN … ; DD … ; supporting: <spec IDs + titles from documentRefs (scoping §5), or none>>
neighbors: <epicId / name / reason — context only; read one only when a link leads there>
terms: <Term Map rows 화면 용어 ↔ code form, source, termId when from the glossary>
budget: 16 calls (+4 on a repair card) ; document searches ≤ 2, only when the map fails ; glossary_term_search ≤ 1 outside that cap
already read: <same track only: document / item IDs an earlier docs job opened — verify, do not trust>
repair: <keep: <claim ids>; do: <missing item with its IDs>; no search; calls left: <n>>
Session Card / Guide Brief: <above>
```

## Code Job Card

```text
job: Q<n>-code | Q<n>-impact            round: 1 (2 on a repair card)
question / asks / audience / business words / terms: <as above>
scope: <readings, primary first: EPIC names + ids, matched screen / menu / program names>
route candidates: <priority ≤ 15 in tier order: specId or null / type / title or path / epicId / tier / role owner|supporting / entryPointId or null ; then the rest: specId + title. A row with entryPointId and no spec (specDocumentIds []) is an entry-point-only row>
asked effects: <side-effect words the question itself names — 이메일, 알림톡, 슬랙, 포인트, 배치, 외부 API, DB 저장 … — each with its target / condition when the question states them; never hypotheses>
pin: <repair only: spec IDs the docs resolvers returned that the code job did not consume>
budget: 26 calls (+6 on a repair card) ; discovery searches ≤ 4 ; route_resolve ≤ 2 (wrong candidate only, reason required)   (this line overrides the skill defaults; the impact investigator card has no budget line)
already read: <same track only: file paths and routes an earlier code job opened>
repair: <keep: <claim ids>; do: <missing checklist row / read / other side / pin>; no new search, except an S2 repair's missing repo-wide value searches; calls left: <n>>
values: <impact investigator card only: the changed value forms the question names — references/impact.md>
impact candidates: <route_impact_candidates rows f1…fn verbatim, each with resolution / reason; coverage.complete and every coverage.partial entry (reason, recovery, recoverable) — impact investigator card only>
Session Card / Guide Brief: <above>
```

Cards carry IDs, titles, paths, tiers, and reasons — never class, method, table, or column
names the main saw, never a document's conclusion or "check whether X does Y" — except the `impact candidates:` rows
(server output, not a conclusion). Across tracks only `pin` spec IDs pass.

## Collector JSON (both tracks return only this object, no prose, no fence)

```json
{ "question": "Q<n>", "job": "<jobId>", "round": 1, "track": "docs | code", "calls": 0,
  "asks": { "a1": "answered(<claim ids>) | 불가(<reason>) | unread(<why>) | not_this_track" },
  "claims": [{
    "id": "<jobId>-r<round>-c<k>", "ask": "a1",
    "claim": "<one sentence in business words; names the screen / endpoint / generation it describes>",
    "level": "확인됨 | 근거상 보임 | 불가",
    "appliesTo": "<endpoint / generation / screen / batch>",
    "reason": "<for 불가: [DB] | [외부] | [런타임] | [신규] | searched scope | 미조회>",
    "evidence": [{ "ref": "<docs: family:documentId/itemId | spec:specId/claims.<i> ; code: repo:path:line[-line]>", "quote": "<≤ 200 chars, verbatim, contains the asserted part>" }],
    "evidenceRefs": [{ "kind": "code | doc | spec_claim | relation", "ref": "<same ref>", "readBy": "<jobId>-r<round>#<log n>" }],
    "scope": "covers: <range / item / chain from the entry point; for runs/fires claims: registration <file:line> + entry body <file:line>; for enumerations: every guard / branch read> / not read: <callees, branches, caller chain, pages, screen code, flag value, the other side — or none>",
    "dateGuard": { "kind": "end | start | window | signup_age", "operator": "<as read>", "date": "<YYYY-MM-DD>" },
    "readRange": ["<code: repo:path:a-b read for this claim>"], "unreadCallees": ["<code: callees not opened>"],
    "link": "<impact: screen | api | service | db | event | job | settlement | notification | external | client>", "sweep": "S1..S7" }],
  "relationChecklist": [{ "candidate": "f<k> | null", "route": "<entryPointId or path>", "kind": "db_access | api_call | navigation | external_link | external_service | event_publish | event_listen | schedule_trigger | webview_message_send | webview_message_listen | symbol_binding", "operation": "<insert | select | … | null>", "target": "<table / endpoint / event / subscriber>", "status": "checked | not_relevant | unchecked", "note": "<file:line read, or why not relevant / not opened>" }],
  "relationGaps": [{ "route": "…", "askedEffect": "<word + its target / condition / result as asked>", "matchedRow": "<checklist row whose target/condition/result matches, or null>", "verdict": "found(<file:line>) | not_found(<bundle files, searches>) | unread(<why>)" }],
  "routeCandidates": { "consumed": ["<specId or entryPointId>"], "skipped": [{ "id": "…", "why": "ask covered | budget | not relevant" }] },
  "coverage": { "<epicId>": { "br": "present | not_generated | empty | failed | partial | unavailable | not_needed", "ucl": "…", "design": "…", "dd": "…", "how": "<card | read | corrected: …>", "fallback": "<what replaced absent families, or null>" } },
  "pinnedSpecIds": ["<docs: spec IDs the resolvers returned>"], "neighbors": [{ "epicId": "…", "reason": "…", "ref": "…" }],
  "terms": [{ "code": "<identifier>", "label": "<screen word or null>", "source": "screen | screen_spec | glossary | data_dictionary | db_comment | code_comment | guide", "ref": "…", "quote": "…" }],
  "gaps": ["<not found / not checked, with the searched scope; screen→API links the documents never state; scope miss / scope link>"],
  "nextChecks": ["<≤ 5, plain words: what one more read would settle>"],
  "sweeps": [{ "sweep": "S1..S7", "status": "done | partial | not-applicable", "coverage": "…", "open": ["…"] }],
  "log": [{ "n": 1, "step": "card | item | resolve | spec | relations | code | read | gap | search | fallback", "tool": "<host tool name>", "input": "<ids / ranges / query>", "result": "<one line; truncated: true when the tool said so>" }],
  "searches": [{ "n": "<the log n of this search>", "tool": "…", "query": "…", "scope": "…", "reason": "map_failed: <what was tried> | checklist | gap:<asked effect> | fallback", "hits": 0, "status": "complete | partial | truncated" }],
  "unread": [{ "what": "<file, node, page (itemPage / evidenceOmitted / nextCursor), truncated remainder, candidate>", "why": "budget | too_large | truncated | SERVER_BUSY | error:<code> | not_needed", "effect": "<which claim or ask stays below 확인됨>" }],
  "budget": { "cap": 0, "used": 0, "searchesUsed": 0, "repairCallsLeft": 0 } }
```

Docs jobs omit `relationChecklist`, `relationGaps`, `routeCandidates`,
`readRange`, `unreadCallees`; code jobs return `coverage: {}`. Every search is one `log` row (`step: search`) and one
`searches` row carrying that same `n` — `searches` is a subset of `log`, never a second count. `log` alone is
compared with `calls` and never exceeds it; when it does, every claim of that job is capped at 근거상 보임 and the 수집기 품질 note says why. A claim without
evidence is a gap. A budget stop lists the unexecuted steps in `unread`; an
empty `unread` with a budget stop fails the audit. Quotes are verbatim and
contain the asserted value / condition / endpoint (`…` on the far side). An
unfollowed page or a truncated output is an `unread` row, never absence.

## Levels (both tracks)

| Level | Means |
| --- | --- |
| 확인됨 | the exact item / spec claim / source line was read and the verbatim quote states the claim (code: `readonly_workspace_shell`; a complete, untruncated single-line search match may be `확인됨 (검색 원문)`) |
| 근거상 보임 | only a search hit, summary card, relation, graph edge, naming, comment, guide, or a one-sided / partial read supports it |
| 불가 | that track cannot answer it — with the reason tag ([DB] data or code-value meaning, [외부] another system, [런타임] logs / timing / settings, [신규] not in the searched scope) or the searched scope |

Absence is never 확인됨. Every claim names the generation it describes; the client call site decides
which one is current (버전 차이, not a conflict). Every level is 분석된 소스 기준 (Session Card `revision`), never production.
Answer labels (converted at output; ledger values stay): 확인됨 read in code (or a non-value fact read in a document) = 확정; a list / constant / threshold / error code seen only in a document = 문서상 값(코드 미확인); 근거상 보임, or several entries combined = 추론; 불가 = a 확인할 수 없는 부분 item.

## Session ledger (kept by the main session)

```json
{ "today": "YYYY-MM-DD", "revision": "…", "asks": { "Q1": { "a1": "…", "a2": "…" } }, "notes": ["<tracks, expansion, models, sweeps, 수집기 품질 — never in the answer>"], "entries": [
  { "id": "Q1-code-r1-c1 | Q1-docs-r1-c2 | Q1.db-code-r1-c1 | Q1-code-r1-g1 | Q1-verify-v1", "ask": "a1", "text": "<claim sentence>", "level": "확인됨 | 근거상 보임 | 불가",
    "evidence": [ { "ref": "…", "quote": "…" } ], "evidenceRefs": [ { "kind": "…", "ref": "…", "readBy": "…" } ],
    "scope": "covers: … / not read: …", "dateGuard": null, "source": "collector Q1-code | collector Q1-docs | verify" } ] }
```

- Collector entries: the audited claims as they are (quotes kept). Gap
  entries (`<jobId>-r<round>-g<k>`): one per `gaps` / `unread` / `relationGaps`
  / `unchecked` row the answer mentions, level 불가, `scope` = what was searched
  or not read. Verify entries (`Q<n>-verify-v<k>`): every read the main (or the
  synthesizer) made, `readBy` = the exact call + arguments. A fact no entry covers is read first or left out.
- Draft: every line of 결론, 쉽게 말하면, 근거 (an item with its 문서 / 코드 lines is one), 확인할 수 없는
  부분, and every 바꾸면 같이 봐야 하는 곳 row ends with `[c: <id>, …]`; its wording never exceeds the
  lowest cited level and its content never exceeds the cited `scope` or `quote`. Exempt: headings, a bare "없음".
- The auditor receives only the draft block, `asks`, the cited entries, the question's gap entries, `today`, and for
  "근거: Q<m> 참고" Q<m>'s 근거 items with their entries; verdicts apply as given; an ask it reports uncovered gets a 확인할 수 없는 부분 item.
- Repair: one per job, same collector type, `round: 2`, the `repair:` line
  names the missing item with its IDs; the result replaces only the named
  claims; what stays open is downgraded (확인됨 → 근거상 보임) and named —
  nothing is re-investigated from scratch. Cap: 3 repairs per session.
