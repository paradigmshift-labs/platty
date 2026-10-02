# Hybrid QA Answer Template

Same reader and wording rules as the `platty-mcp-code-qa` answer template
(business terms first, one action per step, code names only in the evidence
section or once as "(개발용 이름: X)"). The difference is the evidence table:
each row shows the document evidence and the code evidence side by side and
says whether they agree.

The audience is decided per question (see the skill's Audience section). Every
answer starts with one short audience line. This section is the
non-developer template (the default); the Developer Template below is used for
developer-oriented questions.

## Template

```markdown
### Q<번호>. <질문 원문>
> 대상: 비개발자용

**한 줄 결론**
<확인됨 | 근거상 보임 | 확인 불가> — <한 문장 결론, 현재 동작 기준>

**쉬운 설명**
1. <업무 용어로 단계 1 — 한 단계에 한 동작>
2. <단계 2>
...(최대 7단계 — 영향 질문은 제한 없음)

**영향 체인 지도** (영향·회귀 범위·버그 원인·A-to-Z·데이터 직접 수정 질문만)

| 링크 | 무엇이 영향받나 (업무 용어) | 수준 | 근거 |
| --- | --- | --- | --- |
| 화면 | <앱 / 웹뷰 / 관리자 / 파트너 화면 — 사본 포함> | 확인됨 | <repo> `<path>:<L>` |
| API | <요청·응답에 값이 오가는 기능> | 근거상 보임 | <API 경로> (검색 히트) |
| 서비스 | <같은 데이터로 판단하는 처리, 중복 방지 판정> | 확인됨 | <repo> `<path>:<L>` |
| DB | <같은 테이블을 쓰는 곳 n곳 / 읽는 곳 n곳> | 확인됨 | <repo> `<path>:<L>` 외 |
| 이벤트 / 배치 | <예약 작업, 이벤트 수신 — 대상이 빠질 때 넘어가는 분기 포함> | 확인됨 | <배치 이름> `<path>:<L>` |
| 정산 | <정산, 지급, 환급, 집계> | 검색 범위에서 찾지 못함 (<검색어, 저장소, 상태>) | — |
| 알림 / 외부 | <알림 발송, 외부 연동> | 근거상 보임 | <path:L> |
| 클라이언트 | <구버전 앱이 보내는 값> | 확인됨 | <repo> `<path>:<L>` |

수준은 다음 중 하나: 확인됨 | 근거상 보임 | 검색 범위에서 찾지 못함 (검색 범위 명시) |
코드로 확인 불가 (사유 명시: 동적 호출 / 외부 경계 / DB 쪽 / 미조회) | partial (남은 것 명시).
"검색 범위에서 찾지 못함"은 완료된 검색에만 씁니다. 검색이 끝나지 않았거나 읽지
않았다면 partial 또는 코드로 확인 불가(미조회)로 쓰고, 찾지 못함으로 쓰지 않습니다.
"영향 없음"은 쓰지 않습니다. 대상이 빠지는 경우 넘어가는 분기를 읽은 뒤에만
"변화 없음"이라고 씁니다.

**점검 sweep 현황**
- [x] S1 같은 테이블·모델을 쓰고 읽는 곳 (모든 저장소, 모델명·테이블명·SQL 문자열 형태) — <범위>
- [x] S2 코드값·상태 값 (식별자 + 문자열, 클라이언트가 보내는 요청 포함) — <범위>
- [ ] S3 예약 작업·배치·이벤트 목록 — 부분: <남은 것>
- [x] S4 모든 클라이언트 (앱, 웹뷰, 관리자, 파트너 웹, 같은 화면의 네이티브·웹뷰 사본)
- [x] S5 분기 끝까지 읽기 ("대상 없음"이 "영향 없음"은 아님)
- [x] S6 중복 방지 판정과 집계 (이미 지급 판정, 통계, 내보내기, 정산)
- [x] S7 미조회 항목 정리 (검색으로 닫거나 부분으로 표시)

**주의 / 예외**
- 버전 차이: <문서는 구버전(<v1 경로>) 기준, 현재 화면/앱은 <v2 경로>를 호출 — 현재 동작으로 답함>
- <화면에서만 막는 것과 서버에서 막는 것이 다르면 구분>
- <문서와 코드가 다르고 코드를 채택한 이유>
...(최대 4개 — 영향 질문은 제한 없음)

**추가 확인 필요**
- 후보: <확실하지 않은 점을 가능성 있는 설명으로> — 확인하려면: <무엇을 보면 되는지(담당자 확인, 데이터 조회, 로그 등)>
- <문서·코드 모두 근거 없음 — 찾아본 범위>
- [DB] / [외부] / [런타임] <코드로 확인 불가 사유>
- <업무 문서 있음 — 코드 전용 요청이라 참고하지 않음> (code-only 요청일 때만)
...(해당 없으면 "없음")

<details><summary>근거 표 (문서·코드)</summary>

| 항목 | 문서 근거 | 코드 근거 file:line | 일치 |
| --- | --- | --- | --- |
| <업무 항목> | <family>:<documentId>/<itemId> | <repo> `<path>:<L>` | 일치 |
| <값·조건> | <item> (상수 이름만) | <repo> `<path>:<L>` | 보완 |
| <버튼 이동/호출 대상> | (문서에 연결 없음) | <repo> `<path>:<L>` **검증** | 충돌 → 코드 채택 |
| <한도 도달 시 처리> | <v1 spec item> | <v2 path:L> **검증** | 버전 차이 |
| <연관 규칙> | <item> | (코드 트랙 미조회) | 문서만 |
| <부재 확인> | 없음 | <repo> `<path>:<L>` (검색 범위) | 코드만 |
| <해소 못한 항목> | <item> | <path:L> | 미해결 |

가이드 근거 (동작 근거 아님 — 범위·용어·코드값 뜻):
- <코드값 '<xx>' = <뜻>> — guide:<section> (근거상 보임)
- <이 경로는 <repo>가 담당> — guide:<section>

Tracks: docs+code | code-only (<사유>) · 검증 읽기 <n>회 · 코드 환경 가이드: 사용 | 미등록
</details>
```

`일치` values, exactly one per row:

| Value | Meaning |
| --- | --- |
| 일치 | Both tracks support the same statement. |
| 보완 | One track adds detail the other lacks (for example the literal value). |
| 충돌 → 코드 채택 | They disagree on behaviour the code track read; the code is used. |
| 버전 차이 | Docs describe a legacy endpoint/generation, code the current one. |
| 문서만 | Only the docs track has it (the code track did not read that path). |
| 코드만 | Only the code track has it. |
| 미해결 | They disagree and the targeted reads did not settle it. |

The 영향 체인 지도 and 점검 sweep 현황 appear only for impact questions
(change-impact, regression scope, bug cause, A-to-Z chain, direct data edit);
for those answers the step and caveat caps are lifted. Build the chain-map rows
from the collectors' `link` tags, merge duplicates, and copy every `partial`
sweep with its open items into the checklist (unchecked box, "부분").

Mark rows the synthesizer re-read with **검증**. Facts that only the code
environment guide supports (`guide:<section>` refs) never become table rows of
their own; list them under 가이드 근거 so readers see they are guide-only.

## Developer Template

For developer-oriented questions (`audience: developer`). Code locations come
first, identifiers are exact, and the change work is a checklist. Honesty
levels, the 일치 values, the evidence table, and the collapsed 가이드 근거 and
Tracks lines are the same as above; only the order and wording change.

```markdown
### Q<번호>. <질문 원문>
> 대상: 개발자용 (<판정 근거 한 줄: 식별자 포함 | 개발 표현 | 사용자 지정>)

**한 줄 결론**
<확인됨 | 근거상 보임 | 확인 불가> — <한 문장, 정확한 식별자 사용>

**코드 위치** (진입점부터 호출 순서)
- <repo>:<path>:<L> — `<Class.method>` — <역할 한 줄> (확인됨)
- <repo>:<path>:<L> — `<API 경로>` → `<handler>` (근거상 보임)
- <repo>:<path>:<L> — `<TABLE.COLUMN>` / `<queryId>` — <읽기 | 쓰기>
...

**영향 체인 지도** / **점검 sweep 현황** (영향·회귀 범위·버그 원인·A-to-Z·데이터 직접 수정 질문만 —
업무 용어 열 대신 정확한 식별자를 쓰고, 표 형식과 S1–S7 항목은 위 템플릿과 같음)

**변경 지점 체크리스트**
- [ ] <repo>:<path>:<L> `<식별자>` — <무엇을 어떻게 바꾸나>
- [ ] <repo>:<path>:<L> `<식별자>` — <같이 바꿔야 하는 곳: 같은 테이블의 다른 쓰기 지점, 클라이언트 복사본>

**부작용 / 영향 체크리스트**
- [ ] <repo>:<path>:<L> <같은 값·테이블을 쓰는 곳, 배치·이벤트, 구버전 클라이언트> — <수준>
- [ ] <분기 끝까지 읽은 결과: 대상 없음일 때 넘어가는 분기>

**테스트 포인트**
- [ ] <확인할 입력 / 상태 / 경계값> → <기대 결과> (<repo>:<path>:<L>)
- [ ] <회귀 확인: 기존 동작이 유지돼야 하는 경로>

**주의 / 예외**
- <버전 차이, 화면에서만 막는 것과 서버에서 막는 것의 차이, 문서와 코드가 다른 점>

**추가 확인 필요**
- [DB] / [외부] / [런타임] <코드로 확인 불가 사유 — 시도한 방법>
- 후보: <확실하지 않은 점> — 확인하려면: <로그, 쿼리, 호출 지점 등 구체적 확인 방법>
...(해당 없으면 "없음")

<details><summary>근거 표 (문서·코드)</summary>

| 항목 | 문서 근거 | 코드 근거 file:line | 일치 |
| --- | --- | --- | --- |
| <업무 항목 또는 식별자> | <family>:<documentId>/<itemId> | <repo> `<path>:<L>` | 일치 |

가이드 근거 (동작 근거 아님): <guide:<section> 항목>

Tracks: docs+code | code-only (<사유>) · 검증 읽기 <n>회 · 코드 환경 가이드: 사용 | 미등록
</details>
```

Rules: no step or caveat caps for developer answers. Inline `repo:path:line`
references go in the body, not only in the collapsed table. Code identifiers
are quoted exactly as read; never paraphrase a method, table, or query id.
Checklist items name a location and a level, never a guess about intent.

## 수집기 품질 Note

Add after the last answer when Verify corrected any collector claim:

```markdown
#### 수집기 품질
| 수집기 | 호출 수 | 주장 수 | 정정 | 내용 |
| --- | --- | --- | --- | --- |
| Q<n>-docs | <calls> | <n> | <k> | [<i>] 구버전 동작을 현재 동작으로 일반화 → 코드로 정정 |
| Q<n>-code | <calls> | <n> | <k> | [<i>] 줄번호 어긋남(<a> → <b>), 내용은 일치 |
```

Keep it short: one line per collector, corrected items only, plus one sentence
on any common pattern (for example "문서 트랙이 화면→API 연결을 추정으로 채움").
