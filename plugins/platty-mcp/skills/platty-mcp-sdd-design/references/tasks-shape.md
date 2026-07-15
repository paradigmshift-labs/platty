# MCP SDD 독립 실행 개발 체크리스트 형식

`tasks.md`는 승인된 `system_design.md`를 구현 순서로 투영한 독립 실행 문서다. Claude Code,
Codex 또는 개발자가 `tasks.md` 하나만 받아도 파일 탐색을 다시 하거나 제품 결정을 만들지 않고
구현을 시작할 수 있어야 한다.

`system_design.md`는 구조·관계·이유·근거를 소유한다. `tasks.md`는 구현에 필요한 최소 계약을
의도적으로 다시 적고, 파일·symbol·schema·상태 변화·실패 처리·검증을 체크박스로 소유한다.
긴 추적성 메타데이터를 각 작업마다 반복하지 않는다.

## 생성 게이트

- design Self Review가 `PASS / ready`다.
- `approvedRevision = designRevision`이며 승인자와 승인 시각이 현재 revision에 유효하다.
- 제품·근거 fingerprint와 source commit이 최신이다.
- open 제품/기술 질문, implicated `UNKNOWN`, candidate-only edit target이 없다.
- 모든 변경에 confirmed `EDIT-*`, full source commit, exact file 또는 승인된 신규 file parent가 있다.
- 모든 신규·변경 API는 method/path와 request/response/error schema가 승인됐다.
- DB·event·job·external·UI 영역은 변경 또는 `N/A/NO-CHANGE + 이유`로 판정됐다.
- test target과 exact command preflight가 확인됐다. Design의 command가
  `SOURCE_CONFIRMED`라면 §1에 동일 id/command의 실제 실행 체크가 있다.
- `system_design.md`가 `sdd-design.v2`이고 readiness validator가 95점 이상, critical 0이다.

하나라도 실패하면 신규 `tasks.md`를 만들지 않는다. 기존 artifact는 `stale/blocked`로 표시하고
design Evidence-Resolution → 새 revision → Self Review → 명시적 승인 순서로 돌아간다.

## Frontmatter

```yaml
---
schemaVersion: "sdd-tasks.v4"
designSchemaVersion: "sdd-design.v2"
id: "SPEC-<slug>-<YYYY-MM>"
type: "sdd-tasks"
status: "planned"
planKind: "implementation-checklist"
executionReadiness: "ready"
projectId: "<projectId>"
outputLanguage: "ko"
designRevision: "sha256:<hex>"
approvedRevision: "sha256:<hex>"
productInputFingerprint: "sha256:<hex>"
evidenceFingerprint: "sha256:<hex>"
derivedFrom: ["prd.md", "user_stories.md", "system_design.md"]
---
```

## 본문

````markdown
# 구현 체크리스트 — <요청 제목>

> **READY FOR IMPLEMENTATION**
> 이 문서 하나로 구현한다. 설계 근거가 필요할 때만 `system_design.md`를 연다.

## 0. 변경 범위와 실행 순서

| 순서 | 모듈 | 변경 결과 | 변경 유형 | 구현 섹션 | 선행 작업 | 완료 검증 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | <backend API> | <사용자가 관찰할 결과> | NEW | §2 | 없음 | VER-01 |
| 2 | DB·데이터 | <기존 table SELECT 재사용> | NO-CHANGE | §3 | §2 | VER-01 |

변경 유형은 `NEW`, `MODIFY`, `REUSE`, `NO-CHANGE`, `DEPRECATE`, `DELETE`, `N/A` 중 하나다.
표의 순서가 실제 실행 순서다. 모든 행은 정확히 하나의 `## N.` 구현 섹션을 가리킨다.

## 1. 실행 전 확인

- [ ] Design: `designRevision = approvedRevision = sha256:<hex>`
- [ ] Source baseline: `<repo>@<40-char commit>`
- [ ] Create/Modify 대상의 parent·symbol을 current HEAD에서 다시 찾는다.
- [ ] test runner가 CMD-* receipt와 같은 이유로 시작되는지 확인한다.
- [ ] `SOURCE_CONFIRMED`인 `CMD-<id>`마다 `<exact command>`를 실제 실행하여
      `PASS` 또는 기능 부재 `EXPECTED_RED` receipt를 기록한다. 실행 전에는 구현 파일을 편집하지 않는다.
- [ ] customer DB/RDS·production 외부 연동을 사용하지 않는 fixture/profile인지 확인한다.

실패하면 코드를 고치지 않고 stale 대상과 영향을 받는 섹션을 보고한다.

## 2. <backend/service> — <완성 결과>

### 2.1 <DTO·model>

- [ ] Create: `src/exact/NewResponse.java` — `NewResponse`
- [ ] 아래 schema를 동일한 이름·타입·nullability로 정의한다.

```text
NewResponse {
  id: long
  status: ResultStatus
  optionalValue: string?
}
```

- [ ] 응답 금지 필드: `<raw/PII/secret fields>`

### 2.2 <repository·use case·service>

- [ ] Create: `src/exact/NewQueryRepository.java` — `NewQueryRepository`
- [ ] 아래 signature를 구현한다.

```java
ResultPage findResults(int page, int size, ResultStatus status);
Optional<Result> findResult(long resultPk);
```

- [ ] filter를 pagination/limit 전에 query predicate에 적용한다.
- [ ] 정렬, tie-breaker, hasNext 계산을 승인 계약과 동일하게 구현한다.
- [ ] transaction/write/event/outbound 변화 여부를 명시한다.
- [ ] 빈 결과, 중복, timeout, partial failure 동작을 명시한다.

### 2.3 API 연결

- [ ] Modify: `src/exact/NewRestController.java` — `NewRestController`
- [ ] API-01 <사람이 이해할 이름> — `GET /exact/path`를 연결한다.

#### API-01 요청

```text
path.id: positive long
query.page: int = 0, min 0
query.size: int = 30, min 1, max 100
```

#### API-01 응답

```text
200 {
  data: NewResponse
}
```

#### API-01 오류

- 400 `INVALID_REQUEST`: <정확한 조건>
- 401 `UNAUTHORIZED`: <정확한 조건>
- 404 `NOT_FOUND`: <정확한 조건>
- 5xx: <격리·retry·상태 변화 없음>

### 2.4 검증

- [ ] Test: `src/test/exact/NewRestControllerTest.java` — `returnsNewResponse`
- [ ] RED: `<exact command>` — <기능 부재로 실패하는 assertion>
- [ ] GREEN: `<same exact command>` — <통과할 핵심 assertion>
- [ ] Regression: `<exact adjacent command>` — <보존할 기존 동작>

설계 근거: R-* / AC-* / CHG-* / VER-* / API-* / EDIT-* / NOEDIT-*

## 3. DB·데이터

- [ ] Migration: `NONE` 또는 `YES — migrations/<exact-file>`
- [ ] Write: `SELECT_ONLY`, `INSERT`, `UPDATE`, `DELETE`의 실제 조합
- [ ] Modify: `src/exact/Entity.java` — `ExactEntity` 또는 `NO-CHANGE — 이유`
- [ ] table/column/index/constraint 변화와 rollback을 적는다.
- [ ] transaction 경계, idempotency, backfill, dual-write 필요 여부를 적는다.
- [ ] 금지된 production DB 접근과 customer data 사용이 없음을 확인한다.

## 4. Frontend

변경이 있으면 screen별 exact route, server/client 경계, API client/hook, type, 상태,
exact file action과 test를 체크박스로 적는다.

```markdown
### 4.1 SCREEN-01 <화면 이름> — `/exact/route`
- [ ] Create: `app/exact/page.tsx` — `Page`
- [ ] loading/success/empty/forbidden/error 상태를 구현한다.
- [ ] API-01 request/response type을 그대로 사용한다.
- [ ] Test/RED/GREEN/Regression exact command를 실행한다.
```

변경이 없으면 `N/A — 이유` 한 줄을 쓴다.

## 5. Job·Event·외부 연동

변경이 있으면 producer, trigger, payload schema, consumer, transaction boundary, retry,
idempotency, DLQ/실패 격리, PII, exact file action과 test를 체크박스로 적는다.
변경이 없으면 `N/A — 이유` 또는 `NO-CHANGE — 회귀 대상`을 쓴다.

## 6. 통합·배포·완료 체크

- [ ] 모든 NEW/MODIFY 모듈의 Test/RED/GREEN/Regression command가 통과한다.
- [ ] 모든 `CHG-*`와 `VER-*`가 위 체크리스트에 연결된다.
- [ ] `NOEDIT-*` production diff가 0이다.
- [ ] migration·backfill·feature flag·배포 순서가 실제 적용 여부와 일치한다.
- [ ] rollback 명령·행동, 성공 신호, 중단 기준, 소유자가 확인된다.
- [ ] response/log/metric의 secret·PII 금지 필드가 0이다.
````

## 독립 실행 규칙

1. 모든 구현 행동은 `- [ ]` 체크박스다.
2. 코드 변경은 `Create:`, `Modify:`, `Delete:` + exact path + exact symbol/signature를 쓴다.
3. 신규 file은 confirmed parent 아래에서만 승인한다. 후보 경로를 적지 않는다.
4. 모든 source baseline은 repo와 full 40-char commit을 쓴다.
5. API 변경은 사람이 이해할 이름, exact method/path, 요청, 응답, 오류를 같은 모듈 섹션에 쓴다.
6. schema는 field 이름, type, nullability, enum, wrapper를 구현 가능한 형태로 적는다.
7. DB는 변경이 없어도 `Migration: NONE`, `Write: SELECT_ONLY`처럼 독립 판정을 적는다.
8. 상태 변화, transaction, event, job, external call, retry, idempotency를 적용 또는 N/A로 적는다.
9. 각 변경 모듈은 Test/RED/GREEN/Regression exact command와 기대 결과를 가진다.
10. 설계 ID는 섹션 마지막 `설계 근거` 한 줄에 모으고 작업 설명을 ID로 대신하지 않는다.
11. `system_design.md 참고`, `위와 동일`, `적절히 처리`, `테스트 추가`로 구현 결정을 넘기지 않는다.
12. 코드 전체를 복사하지 않는다. 구현을 고정하는 signature, schema, branch, query invariant만 적는다.

## 생성 후 감사

1. frontmatter가 `sdd-tasks.v4`, `sdd-design.v2`, `implementation-checklist`, `ready`다.
2. §0의 모든 모듈 행이 하나의 실제 섹션을 가리킨다.
3. 모든 NEW/MODIFY 섹션에 checkbox, exact file action, symbol/signature, full source commit 근거가 있다.
4. 모든 변경 API에 method/path와 request/response/error schema가 있다.
5. DB migration/write 판정이 있고 UI/job/event/external은 적용 또는 N/A다.
6. Test/RED/GREEN/Regression exact command가 있다.
7. 모든 CHG/VER와 안정 사용자 시나리오가 체크리스트에 연결된다.
8. placeholder, open 질문, candidate target, blocked implementation item이 없다.
9. readiness validator가 95점 이상이고 critical finding이 0이다.

v3는 역사 artifact 검증을 위해 reader/validator에서만 유지한다. 새 생성과 갱신은 v4를 사용한다.
