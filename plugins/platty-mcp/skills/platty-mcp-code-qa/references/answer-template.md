# Code QA Evidence And Wording Reference

The final answer shape belongs to `platty-mcp-search`
(`../../platty-mcp-search/references/answer-template.md`): every user-facing
answer has four parts, 결론 → 쉽게 말하면 → 근거 → 확인할 수 없는 부분, for
every audience (no separate developer template, no audience line). That holds
for a single code-only question answered in the main session on this ladder
as much as for an orchestrated answer. This file does not restate that
template; it holds only what the code track adds.

Readers are business / DX staff, not developers. Write in Korean with
business terms first: the words users see on screen, never table, column, or
variable abbreviations. Code names, tables, classes, and code values live in
근거.

## Code-Track Lines In The Template

**확인할 수 없는 부분** — the code track adds these lines (omit the ones that do
not apply; "없음" when none):

```markdown
- 후보: <확실하지 않은 점을 가능성 있는 설명으로> — 확인하려면: <무엇을 보면 되는지(담당자 확인, 데이터 조회, 로그 등)>
- [DB] <코드값 뜻, 메시지 문구, 공통코드, 실제 데이터>
- [외부] <다른 시스템/연동 너머의 동작>
- [런타임] <로그, 실제 입력값, 동시 처리>
- [신규] <현재 코드에 없는 기능>
- 코드로 확인 불가 (동적 호출) <호출 지점(file:line)에서 실행 중에 만들어지는 주소/쿼리를 확인한 경우만 — 시도한 방법>
- 코드로 확인 불가 <검색 범위에서 연결 미발견 / 도구 미제공 / 모호성 미해소 중 실제 사유 — 시도한 방법>
- 업무 문서 <br n건 / ucl n건 …> 있음 — 코드 전용 요청이라 참고하지 않음(교차 확인 가능)
  (업무 문서가 있는데 코드 전용을 요청받은 경우에만)
```

**근거** — the code track adds: a screen-only check versus a server
check stated separately; a dynamic SQL branch named by its switching
parameter; and, when the answer rests on a route marked out of the analysis
scope, "분석 범위 밖으로 표시된 기능 기준입니다".

Screen word ↔ code form: the screen word in 결론 / 쉽게 말하면, the code form
in the matching 근거 item as `` `<약어>`(<화면 용어>) `` with its label source
(화면 라벨 <repo> `<path>:<L>`); unknown → "(업무 용어 미확인)" and the places
searched under 확인할 수 없는 부분.

## Evidence Rows And Trail

The code evidence rows feed the 근거 items of the search template (the
"코드:" line + 요지, ≤ 3). The rows and the trail themselves are kept in the
session ledger `notes`, never in the answer:

```markdown
개발 근거 기록 (파일:라인 — ledger notes)

| 단계 | 리포 | 파일:라인 | 확인 내용 | 상태 |
| --- | --- | --- | --- | --- |
| 1 | <repo> | <file>:<line> | <무엇을 읽었는지> | 확인됨 |

Tools (<N>회): context_status(세션) → ... → readonly_workspace_shell ×<k>
Searches: workspace_search("<pattern>", repos=<set>, globs=<요약>) → <n>건,
status=<complete | 부분: repo 목록>, truncated=<true|false>
Route: route_resolve("<query>") → <entryPointId> / route_relations(kinds=<...>)
| route tools not exposed
Missing links: <없음 | route_code(<entryPointId>) → 기본 페이지 <n>개 표시, hidden <n>개
(beyond_max_depth / other_pages / folded) → maxDepth / includeAllNodes 재조회 → 관계 없는 노드 <n>개 읽음
| route_text_links(<outgoing|incoming>) → 후보 <n>, 확인 <k> | code_routes(<target>) → <n>
| 미노출 → workspace_search/readonly_workspace_shell/graph_trace 대체>
Graph: <미사용 | graph_trace(<node>, both, 1) → 엣지 <n> | 비어 있음(영향 없음 아님)>
```

Evidence-row notes: a row backed by a deprecated route says "분석 범위 밖으로
표시된 기능" in its 확인 내용; a row backed by a relation whose
`details.adapter` is `user_supplement` says "수동 연결(운영자)" in its 확인 내용
(operator-asserted; 확인됨 only after a bounded source read); a screen→api
link recovered with `route_text_links` and verified by reading the cited lines
says "코드 대조로 찾은 연결" in its 확인 내용, and a link a dynamic pattern
defeated (observed at a call site, with file:line) says "동적 호출" with what
was tried; any other missing link states its actual gap instead.

Impact questions (T6, T7, impact-shaped T4 bug-cause, A-to-Z chains): the
7-step and 4-caveat caps are lifted. The search template adds a 바꾸면 같이
봐야 하는 곳 table below 쉽게 말하면 (어디 / 무엇이 영향받나 / 같이 고쳐야 하나 /
수준 — one row per affected place, 수준 확정 / 추론 / 문서상 값(코드 미확인);
unconfirmed places go under 확인할 수 없는 부분); the S1–S7 sweep status from
`code-qa-recipes.md` "Impact Sweeps", each done with its coverage or marked 부분
with what is open, goes in the session ledger `notes`; the code track supplies
the rows and the sweep status.

Large impact lists (T6, T7): in the body and the evidence table use one row
per feature group with counts and representative routes (a handler file per
group), not one row per route; keep the full list in the session ledger
`notes`.

Status column values are exactly `확인됨`, `근거상 보임`, `코드로 확인 불가`.
A single-line fact taken from a complete, untruncated `workspace_search` match
(constant, annotation, mapping line) is written `확인됨 (검색 원문)`; it is a
form of `확인됨`, not a fourth level.
Batch answers: one block per question; shared evidence appears in the first
block and later blocks say "근거: Q<m> 참고".

Developer answers: no step or caveat caps; identifiers are quoted exactly as
read; checklist items name a location and a level, never a guess about
intent. `repo:file:line` references go in 근거 (the "코드:" line), never in
쉽게 말하면.

## Plain Korean Wording

| Code concept | Say instead |
| --- | --- |
| UPDATE | "~를 바꿉니다" |
| INSERT | "새로 저장합니다" |
| DELETE | "지웁니다" |
| WHERE 조건 | "~인 경우에만" |
| transaction / rollback | "하나의 저장 묶음(중간에 실패하면 전부 취소)" |
| sequence | "번호표 기계(한 번 뽑은 번호는 취소해도 돌아오지 않음)" |
| cache | "미리 복사해 둔 목록(바꾼 뒤 새로고침이 필요할 수 있음)" |
| API / service URL | "서버 요청" |
| exception + message code | "오류 안내(코드 <code>)" |
| batch job | "정해진 시간에 자동으로 도는 작업" |
| history table | "변경 이력" |
| client validation | "화면에서 먼저 확인" |

Rules: conclusion first; one action per step; no code abbreviations in the
body — write the screen word and put the abbreviation in 근거 (never
expand it from its letters; unknown → "(업무 용어 미확인)"); keep code values
quoted as they appear and add "(뜻은 공통코드 확인 필요)" unless the code
labels them.

## Worked Example

All names below are placeholders (`<...>`). Replace them with what the
investigation actually read; never invent paths. The answer follows the
`platty-mcp-search` template (결론 first); the code track's ledger record
below is kept out of the answer.

```markdown
### Q<n>. <대상>을 일괄승인하면 안에서 무슨 일이 벌어지나요?

**결론** … **쉽게 말하면** … (화면 용어만)
**근거** … (코드: <server-repo>/<service file>:<L>-<L> — 요지: …)
**확인할 수 없는 부분** …

개발 근거 기록 (파일:라인 — ledger notes, 답변에 넣지 않음)

| 단계 | 리포 | 파일:라인 | 확인 내용 | 상태 |
| --- | --- | --- | --- | --- |
| 1 | <screen-repo> | <screen file>:<L> | 버튼 `<일괄승인>` → `<handler>` | 확인됨 |
| 1 | <screen-repo> | <screen file>:<L>-<L> | 체크 건수 검사, 서버 요청 `<service URL>` | 확인됨 |
| 3 | <server-repo> | <controller file>:<L> | `<URL segment>` → `<service>.<method>` | 확인됨 |
| 3 | <server-repo> | <service file>:<L>-<L> | 저장 묶음 선언, 반복, 상태 `'<xx>'` 검사, `<MSGxxxx>` | 확인됨 |
| 4 | <server-repo> | <sql file>:<L>-<L> | `UPDATE <TABLE> SET <STATE>='<yy>' ... WHERE ...` | 확인됨 |
| 5 | <server-repo> | <sql file>:<L> | `INSERT INTO <HISTORY_TABLE>` | 확인됨 |
| 6 | <screen-repo> | <screen file>:<L> | 완료 후 재조회 호출 | 근거상 보임 |
| 교차 | <batch-repo> | <job file>:<L> | 같은 테이블 상태를 읽는 작업 | 근거상 보임 |

Tools (13회): route_resolve → route_relations → route_code ×2 → workspace_search ×3 →
readonly_workspace_shell ×6
Searches: workspace_search("<일괄승인>", repos=SCREEN, globs=<screen types, noise 제외>)
→ 2건, status=complete, truncated=false; workspace_search("<TABLE>",
repos=SERVER+BATCH+MIRROR) → 9건, status=complete, truncated=false
Route: route_resolve("<URL segment>") → <entryPointId>; route_relations(kinds=[db_access])
→ queryId 2건 (1건 unresolvedReason → 텍스트 검색으로 확인)
Missing links: route_code(<entryPointId>) → 기본 페이지 12개 표시, hidden 31개
(beyond_max_depth) → maxDepth 재조회 → 관계 없는 노드 2개 읽음
Graph: 미사용
```
