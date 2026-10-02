# Code QA Answer Template

Readers are business / DX staff, not developers. Write in Korean with
business terms first. Code names, tables, classes, and code values live in the collapsed
developer section; in the body use them at most once as "(개발용 이름: X)".

This is the default (non-developer) template. The audience is decided per
question (see the skill's Audience section); developer-oriented questions use
the Developer Template below. Every answer starts with one audience line.

## Template

```markdown
### Q<번호>. <질문 원문>
> 대상: 비개발자용

**한 줄 결론**
<확인됨 | 근거상 보임 | 코드로 확인 불가> — <한 문장 결론>

**쉬운 설명**
1. <업무 용어로 단계 1 — 한 단계에 한 동작>
2. <단계 2>
...(최대 7단계 — 영향 질문은 제한 없음)

**주의 / 예외**
- <이런 경우엔 다르게 동작함>
- <화면에서만 막는 것과 서버에서 막는 것이 다르면 구분해서>
- <답이 분석 범위 밖으로 표시된 기능(deprecated 경로)에 근거하면: "분석 범위 밖으로 표시된 기능 기준입니다">
...(최대 4개 — 영향 질문은 제한 없음)

**추가 확인 필요**
- 후보: <확실하지 않은 점을 가능성 있는 설명으로> — 확인하려면: <무엇을 보면 되는지(담당자 확인, 데이터 조회, 로그 등)>
- [DB] <코드값 뜻, 메시지 문구, 공통코드, 실제 데이터>
- [외부] <다른 시스템/연동 너머의 동작>
- [런타임] <로그, 실제 입력값, 동시 처리>
- [신규] <현재 코드에 없는 기능>
- 코드로 확인 불가 (동적 호출) <호출 지점(file:line)에서 실행 중에 만들어지는 주소/쿼리를 확인한 경우만 — 시도한 방법>
- 코드로 확인 불가 <검색 범위에서 연결 미발견 / 도구 미제공 / 모호성 미해소 중 실제 사유 — 시도한 방법>
- 업무 문서 <br n건 / ucl n건 …> 있음 — 코드 전용 요청이라 참고하지 않음(교차 확인 가능)
  (업무 문서가 있는데 코드 전용을 요청받은 경우에만)
...(해당 없으면 "없음")

<details><summary>개발 근거 (파일:라인)</summary>

| 단계 | 리포 | 파일:라인 | 확인 내용 | 상태 |
| --- | --- | --- | --- | --- |
| 1 | <repo> | <file>:<line> | <무엇을 읽었는지> | 확인됨 |

Tools (<N>회): context_status(세션) → ... → readonly_workspace_shell ×<k>
Searches: workspace_search("<pattern>", repos=<set>, globs=<요약>) → <n>건,
status=<complete | 부분: repo 목록>, truncated=<true|false>
Route: route_resolve("<query>") → <entryPointId> / route_relations(kinds=<...>)
| route tools not exposed
Missing links: <없음 | route_code(<entryPointId>) → 관계 없는 노드 <n>개 읽음
| route_text_links(<outgoing|incoming>) → 후보 <n>, 확인 <k> | code_routes(<target>) → <n>
| 미노출 → workspace_search/readonly_workspace_shell/graph_trace 대체>
Graph: <미사용 | graph_trace(<node>, both, 1) → 엣지 <n> | 비어 있음(영향 없음 아님)>
</details>
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
7-step and 4-caveat caps are lifted. After 쉬운 설명 add a 영향 체인 지도 (one
row per affected link: 화면, API, 서비스, DB, 이벤트 / 배치, 정산, 알림 / 외부,
클라이언트, each with 확인됨 / 근거상 보임 / 검색 범위에서 찾지 못함 and its
evidence) and a 점검 sweep 현황 checklist with S1–S7 from
`code-qa-recipes.md` "Impact Sweeps", each done with its coverage or marked
부분 with what is open. The `platty-mcp-hybrid-qa` answer template shows both
blocks.

Large impact lists (T6, T7): in the body and the evidence table use one row
per feature group with counts and representative routes (a handler file per
group), not one row per route; put the full list in the collapsed developer
section after the table.

Status column values are exactly `확인됨`, `근거상 보임`, `코드로 확인 불가`.
A single-line fact taken from a complete, untruncated `workspace_search` match
(constant, annotation, mapping line) is written `확인됨 (검색 원문)`; it is a
form of `확인됨`, not a fourth level.
Batch answers: one block per question; shared evidence appears in the first
block and later blocks say "근거: Q<m> 참고".

## Developer Template

For developer-oriented questions (`audience: developer`). Code locations come
first with inline `repo:file:line`, identifiers are exact, and the change work
is a checklist. Honesty levels, the evidence table, and the Tools / Searches /
Route / Graph trail are unchanged.

```markdown
### Q<번호>. <질문 원문>
> 대상: 개발자용 (<판정 근거 한 줄: 식별자 포함 | 개발 표현 | 사용자 지정>)

**한 줄 결론**
<확인됨 | 근거상 보임 | 코드로 확인 불가> — <한 문장, 정확한 식별자 사용>

**코드 위치** (진입점부터 호출 순서)
- <repo>:<file>:<L> — `<Class.method>` — <역할 한 줄> (확인됨)
- <repo>:<file>:<L> — `<TABLE.COLUMN>` / `<queryId>` — <읽기 | 쓰기> (근거상 보임)
...

**영향 체인 지도** / **점검 sweep 현황** (영향 질문만, 형식은 위 템플릿과 같음)

**변경 지점 체크리스트**
- [ ] <repo>:<file>:<L> `<식별자>` — <무엇을 어떻게 바꾸나>
- [ ] <repo>:<file>:<L> `<식별자>` — <같이 바꿔야 하는 곳>

**부작용 / 영향 체크리스트**
- [ ] <repo>:<file>:<L> <같은 값·테이블을 쓰는 곳, 배치, 구버전 클라이언트> — <수준>

**테스트 포인트**
- [ ] <입력 / 상태 / 경계값> → <기대 결과> (<repo>:<file>:<L>)

**주의 / 예외**
- <화면에서만 막는 것과 서버에서 막는 것의 차이, 분기 조건>

**추가 확인 필요**
- [DB] / [외부] / [런타임] / [신규] <사유 — 시도한 방법>
- 후보: <확실하지 않은 점> — 확인하려면: <로그, 쿼리, 호출 지점 등 구체적 확인 방법>
...(해당 없으면 "없음")

<details><summary>개발 근거 (파일:라인)</summary>

| 단계 | 리포 | 파일:라인 | 확인 내용 | 상태 |
| --- | --- | --- | --- | --- |
| 1 | <repo> | <file>:<line> | <무엇을 읽었는지> | 확인됨 |

Tools / Searches / Route / Missing links / Graph: 위 템플릿과 같은 형식
</details>
```

Rules: no step or caveat caps for developer answers; identifiers are quoted
exactly as read; checklist items name a location and a level, never a guess
about intent.

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

Rules: conclusion first; one action per step; no unexplained English
abbreviations; keep code values quoted as they appear and add "(뜻은 공통코드
확인 필요)" unless the code labels them.

## Worked Example

All names below are placeholders (`<...>`). Replace them with what the
investigation actually read; never invent paths.

```markdown
### Q<n>. <대상>을 일괄승인하면 안에서 무슨 일이 벌어지나요?

**한 줄 결론**
확인됨 — 화면에서 체크한 건을 한 건씩 확인해 "승인 가능한 상태"일 때만 상태를
'승인'으로 바꾸고 변경 이력을 남기며, 한 건이라도 실패하면 전부 취소됩니다.

**쉬운 설명**
1. [일괄승인]을 누르면 화면이 먼저 "체크한 건이 있는지"를 확인합니다. 없으면
   서버에 보내지 않고 안내창을 띄웁니다.
2. 체크한 건의 목록을 서버로 한 번에 보냅니다.
3. 서버는 한 건씩 현재 상태가 '<승인요청>'(코드 '<xx>')인지 확인하고, 아니면
   오류 안내(코드 <MSGxxxx>)로 멈춥니다.
4. 상태가 맞는 건은 상태를 '<승인>'(코드 '<yy>')으로 바꾸고 승인자·승인일시를
   기록합니다.
5. 변경 이력에 한 줄을 추가합니다.
6. 모두 끝나면 "처리 완료"를 보내고 화면이 목록을 다시 조회합니다.
7. 3~5번은 하나의 저장 묶음입니다. 중간에 한 건이라도 실패하면 모두 취소됩니다.

**주의 / 예외**
- 화면의 "체크 여부" 확인은 화면에서만 합니다. 서버의 상태 확인(3번)은 별도로
  있습니다.
- 상태를 바꾸는 서버 문장에 "현재 상태가 '<xx>'인 경우에만" 조건이 <있음|없음>.
  없으면 같은 건을 두 번 눌러도 두 번째에 오류가 나지 않을 수 있습니다.
- 같은 상태를 읽는 자동 작업이 <있음(근거상 보임)|검색 범위에서 찾지 못함>.

**추가 확인 필요**
- [DB] 코드 '<xx>', '<yy>'의 공식 명칭과 오류 코드 <MSGxxxx>의 문구.
- [런타임] 동시에 여러 사람이 승인할 때의 실제 동작.

<details><summary>개발 근거 (파일:라인)</summary>

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

Tools (11회): route_resolve → route_relations → workspace_search ×3 →
readonly_workspace_shell ×6
Searches: workspace_search("<일괄승인>", repos=SCREEN, globs=<screen types, noise 제외>)
→ 2건, status=complete, truncated=false; workspace_search("<TABLE>",
repos=SERVER+BATCH+MIRROR) → 9건, status=complete, truncated=false
Route: route_resolve("<URL segment>") → <entryPointId>; route_relations(kinds=[db_access])
→ queryId 2건 (1건 unresolvedReason → 텍스트 검색으로 확인)
Graph: 미사용
</details>
```
