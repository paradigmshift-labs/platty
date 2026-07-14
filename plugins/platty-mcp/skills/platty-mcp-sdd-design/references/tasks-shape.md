# MCP SDD 작업 계획 형식

`tasks.md`는 승인된 `system_design.md`의 `SLICE-*`를 실제 에이전트가 인계받아 실행할
수 있는 한국어 작업 문서로 바꾼다. 각 슬라이스는 하나의 사용자 결과를 완성하며, 적용되는
계약·데이터, 백엔드/API, 프런트/화면, 연동·계측, 검증 작업만 묶는다.

## Frontmatter

```yaml
---
id: "SPEC-<slug>-<YYYY-MM>"
type: "sdd-tasks"
status: "planned | stale"
executionReadiness: "blocked | partial | ready"
projectId: "<projectId>"
outputLanguage: "ko"
designRevision: "sha256:<hex>"
approvedRevision: "sha256:<hex>"
productInputFingerprint: "sha256:<hex>"
evidenceFingerprint: "sha256:<hex>"
derivedFrom: ["prd.md", "user_stories.md", "system_design.md"]
---
```

승인자·승인 시각은 `system_design.md`, impact 상태·source parity·조사 한계는
`system_design.md` 부록 A와 `prd.md` §9를 따른다.

`status: stale`인 기존 문서는 반드시 `executionReadiness: blocked`로 표시한다. `partial`과
`ready`는 현재 승인·fingerprint가 유효한 `status: planned` 문서에만 사용할 수 있다.

## 본문

```markdown
# 구현 작업 — <요청 제목>

> 승인된 설계 기준: [system_design.md](system_design.md). 근거 상세: `prd.md` §9.

## 0. 실행 계약과 작업 순서

- design/input/evidence fingerprint 일치 여부
- 실행 가능한 `edit-target` 수와 먼저 해결할 `candidate-target`
- 에이전트가 수정할 수 있는 저장소·경로와 건드리지 않을 경계

| Wave | 슬라이스·작업 | 완성할 결과 | 선행 작업 | 병렬 실행 | 준비 상태 | 완료 후 열리는 작업 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | ER-TASK-01 | 코드 위치 확정 | 없음 | 가능 | evidence-resolution | SLICE-01 |
| 1 | SLICE-01 | <사용자 결과> | ER-TASK-01 | SLICE-02와 가능 | ready | SLICE-03 |

이 표가 실제 실행 순서다. 슬라이스 번호나 기술 레이어 순서만으로 실행 순서를 정하지 않는다.

## 1. 실행 직전 최신성 확인

에이전트는 구현 전에 네 문서를 다시 읽고 아래 값을 재계산한다. 생성 당시의 값만 믿지 않는다.

| 확인 항목 | 다시 읽을 값 | 통과 조건 | 불일치 시 행동 |
| --- | --- | --- | --- |
| 제품 입력 | `prd.md`, `user_stories.md` status·revision | 둘 다 approved, 저장값 일치 | 중단; tasks stale |
| 설계 승인 | `system_design.md` design/approved revision | 둘이 같고 승인 정보 존재 | 중단; 재승인 필요 |
| 근거 최신성 | PRD §9와 design/tasks evidence fingerprint·source commits | 모두 일치 | 중단; impact 갱신 후 새 설계 |
| 작업 대상 | 현재 repo HEAD와 각 `EDIT-*`의 full source commit·심볼 | HEAD가 기록 commit과 같고 심볼을 다시 찾을 수 있음 | 중단; Evidence-Resolution |

Preflight는 문서를 자동 수정하지 않는다. 하나라도 실패하면 구현·테스트·배포를 시작하지
않고 어떤 값이 달라졌는지 보고한다.

## 2. 선행 근거 해결

구현에 필요한 위치가 `candidate-target`이면 먼저 좁은 Evidence-Resolution 작업을 만든다.

### ER-TASK-01. <확인할 사실>

- **막고 있는 슬라이스·작업**: <SLICE/TASK/CHG>
- **현재 후보 위치**: <repo / commit / file / symbol / lines / evidence>
- **확인할 질문**: <read/write, contract, permission, consumer 등 하나의 질문>
- **필요한 도구**: `document_resolve` → `graph_trace` → `code_search` → `readonly_workspace_shell`
- **완료 조건**: `edit-target` 또는 `do-not-touch`로 분류 가능한 원문 근거
- **후속 처리**: `prd.md` §9 갱신 → 새 `system_design.md` 승인 → `tasks.md` 재생성

## 3. SLICE-00. <공통 선행 결과>

### 슬라이스 인계 요약

| 항목 | 내용 |
| --- | --- |
| 완성할 결과 | |
| 제품 연결 | <R-* / AC-* / US-NN-SNN / D-* / A-* / O-* / H-*> |
| 설계 연결 | <DEC-* / TQ-* / CHG-* / VER-*> |
| 영향 표면 | <SCREEN-* / API-* / EVENT-* / DATA-* / 해당 없음> |
| 변경 유형 | <design §5의 NEW / MODIFY / REUSE / NO-CHANGE / DEPRECATE / DELETE / UNKNOWN 행 참조> |
| 비적용 구역 | <frontend/screen N/A: 화면 없는 변경 등 이유> |
| 선행 슬라이스 | |
| 병렬 실행 | |
| 금지 범위 | |
| 완료 후 인계 | |

### 작업 인덱스

| TASK ID | 완료 결과 | 변경 유형 | 담당 구역 | 선행 작업 | 대상·경계 ID | 준비 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-00-01 | | <design §5 참조> | <contract/data / backend/API / frontend/screen / integration/observability> | <TASK / 없음> | <EDIT-* / CAND-* / NOEDIT-* / 해당 없음+이유> | <ready / evidence-resolution / blocked> |

이 표는 아래 상세 TASK 카드에서 파생한다. 모든 상세 TASK는 인덱스에 정확히 한 행을 가지며,
`CAND-*`만 있거나 결과에 영향을 주는 open `O-*`/`TQ-*`가 남은 구현 TASK를 `ready`로
표시하지 않는다. 비적용 구역은 빈 TASK 카드를 만들지 않고 슬라이스 인계 요약의
`비적용 구역`에 `N/A + 이유`로 한 번 기록한다.

### 코드 편집 지도

| target id | 저장소·source commit | 확인된 파일·심볼 | 위치 힌트 | 변경 의도 | 상태 | 누락 필드·다음 확인 |
| --- | --- | --- | --- | --- | --- | --- |
| CAND-01 | | | | | candidate-target | |

`edit-target`만 구현 작업에 사용할 수 있다. 라인은 탐색 힌트이며 에이전트는 심볼과
현재 소스를 다시 확인한 뒤 수정한다.

### TASK-00-01. <독립적으로 검증 가능한 결과>

- **상태**: <ready / evidence-resolution / blocked>
- **차단 사유**: <open O-* / open TQ-* / 선행 작업 / rollout gate / evidence gap / 해당 없음>
- **담당 구역**: <contract/data / backend/API / frontend/screen / integration/observability>
- **제품 연결**: <R-* / AC-* / US-NN-SNN / D-* / A-* / O-* / H-* 중 해당 ID>
- **설계 연결**: <SLICE-* / DEC-* / TQ-* / CHG-* / VER-* 중 해당 ID>
- **영향 표면**: <SCREEN-* / API-* / EVENT-* / DATA-* / 해당 없음>
- **변경 유형**: <design §5의 해당 표면 분류; task가 다시 결정하지 않음>
- **대상·경계 ID**: <EDIT-* / CAND-* / NOEDIT-* / 해당 없음+이유>
- **선행 작업**: <TASK 또는 없음>
- **작업 위치·확인 상태**:
  - confirmed location: <EDIT-* / repo id / full commit / confirmed file / symbol / advisory lines>
  - candidate location: <CAND-* / 현재 확인된 후보 locator / 누락 필드 / 다음 bounded read>
  - no-edit execution: <해당 없음+이유 / 확인된 관측·수동 검증·rollout 실행 방식>
  - 함께 읽을 소비자·테스트·설정: <confirmed targets / 후보와 다음 확인>
- **입출력·상태 변화**: <확인된 계약과 전이, 없으면 read-only 등 명시>
- **구현 내용**: <변경할 동작과 유지할 동작>
- **예외·실패 처리**: <권한, 빈 결과, 중복, timeout, partial failure 또는 N/A 이유>
- **금지 범위**: <이 작업에서 수정하지 않을 write/contract/module>
- **완료 조건**: <사용자·시스템이 관찰하는 결과>
- **검증 루프**:
  - RED: <VER id / 확인된 test file·symbol / 추가할 assertion·scenario / 명령 / 기능 부재로 실패할 이유 / no-edit이면 N/A+이유>
  - GREEN: <같은 test file·symbol과 명령 / 기대 결과 / no-edit이면 N/A+이유>
  - no-edit 실행 검증: <코드 변경이면 N/A / 사전조건 / 확인된 실행 방식 / 기대 관측 / 실패 임계값 / 중단·rollback 조치>
  - 회귀 확인: <인접 소비자·기존 흐름 확인 또는 N/A 이유>
- **인계 결과**: <다음 TASK가 사용할 계약·파일·결정>
- **근거**: <system_design 부록 A / prd §9 evidence id>

## 4. SLICE-01. <사용자 결과>

SLICE-00과 같은 `슬라이스 인계 요약 → 작업 인덱스 → 코드 편집 지도 → TASK 카드` 구조를 완전하게
반복한다. “위와 동일”로 생략하지 않는다.

## 5. SLICE-02. <사용자 결과>

동일 구조로 작성한다. 서로 파일과 계약이 겹치지 않고 선행 작업이 끝났으면 §0에서
병렬 실행 가능으로 표시한다.

## 6. 통합 검증

### 6-1. 자동화 검증

| VER ID | 슬라이스·작업 | 검증 수준 | 명령 또는 검증 방식 | 기대 결과 |
| --- | --- | --- | --- | --- |

### 6-2. E2E 시나리오

| 시나리오 | Given | When | Then | 연결 SLICE·TASK·VER |
| --- | --- | --- | --- | --- |

### 6-3. 수동 검증

| 확인 항목 | 자동화하지 않는 이유 | 기대 결과 | 담당 |
| --- | --- | --- | --- |

## 7. 배포·롤백·완료 인계

| 순서 | 슬라이스·변경 | 선행 조건 | 확인 신호·중단 기준 | 실패 시 조치 | 소유자 |
| --- | --- | --- | --- | --- | --- |

### 최종 완료 조건

- 모든 `CHG-*`가 하나의 주 슬라이스와 완료 TASK에 연결됨
- 모든 `VER-*`와 안정 사용자 시나리오가 통과하거나 명시적으로 제외됨
- feature flag, 관측 지표, 롤백 책임자가 확인됨
- 다음 에이전트가 재검색 없이 변경 위치와 남은 위험을 설명할 수 있음
```

## 작성 규칙

- 승인 전에는 `tasks.md`를 만들거나 덮어쓰지 않는다.
- `status: stale`은 어떤 TASK나 Evidence-Resolution도 실행하도록 승인하지 않는다. 내용은
  다음 impact/design revision의 조사 backlog로만 참고하고, 승인된 새 tasks로 재생성한다.
- `system_design.md` §8의 `SLICE-*`를 그대로 사용한다. tasks에서 임의로 다시 묶거나
  순수 기술 레이어 그룹으로 바꾸지 않는다.
- 변경 유형은 `system_design.md` §5를 그대로 참조한다. tasks가 `UNKNOWN`을 `NEW`나
  `MODIFY`로 승격하거나 `REUSE`를 `NO-CHANGE`로 다시 분류하지 않는다. 인덱스와 카드에
  표시하는 유형은 §5의 표면별 분류를 그대로 복사하며, 축약한 유형 집합으로 바꾸지 않는다.
- 모든 `CHG-*`를 정확히 하나의 주 슬라이스에 배치하고, 관련 슬라이스에서는 링크만 한다.
- §0 실행 순서는 의존성·파일 충돌·롤아웃 안전성에서 파생한다.
- 모든 슬라이스는 `인계 요약 → 작업 인덱스 → 코드 편집 지도 → TASK 카드` 순서를
  유지한다. 코드 대상이 없으면 지도를 생략하지 않고 `해당 없음`과 이유 또는 선행 ER을 적는다.
- 작업 인덱스와 상세 TASK 카드는 ID, 결과, 변경 유형, 담당 구역, 선행 작업, 대상·경계 ID, 준비 상태가
  일치해야 한다. 인덱스는 새 구현 내용이나 새 근거를 만들지 않는다.
- 작업 결과에 영향을 주는 open `O-*`는 제품 개정 또는 명시된 제품 결정을 기다리고,
  open `TQ-*`는 기술 결정 또는 Evidence-Resolution을 기다린다. 어느 쪽도 해결되기 전에는
  해당 구현 TASK를 `ready`로 표시하지 않는다.
- 모든 기술 구역의 TASK를 강제하지 않는다. 화면 없는 변경처럼 비적용 구역은 인계 요약에
  `N/A + 이유`로 한 번 기록하고 빈 TASK 카드를 만들지 않는다.
- `edit-target`은 `EDIT-*`, 후보는 `CAND-*`, 금지 경계는 `NOEDIT-*` ID를 쓴다.
  `edit-target` 위치는 `repo + full source commit + file + symbol + advisory line range +
  change intent + bounded-read evidence`로 쓴다. 라인 번호만 적지 않는다.
- bounded 원문 읽기로 확인된 위치만 `edit-target`이다. code_search·graph·spec 메타데이터만
  있는 위치는 `candidate-target`이며 구현 TASK를 `ready`로 만들 수 없다. 후보의 라인은
  `search-hint`이고 누락 필드와 다음 원문 확인을 반드시 적는다.
- readiness와 위치 확신도를 섞지 않는다. 코드를 변경하는 `ready` TASK는 confirmed
  `EDIT-*`가 필요하다. 의도적으로 코드를 변경하지 않는 관측·수동 검증·rollout TASK는
  `해당 없음+이유`와 확인된 실행·검증 방식을 가지면 `ready`일 수 있다. locator를 확인하는
  `evidence-resolution`은 `CAND-*`와 다음 bounded read를 사용한다. `blocked`는 차단 원인이
  open 질문·선행 작업·rollout gate인지 evidence gap인지 별도 기록하며, 이미 확인된
  `EDIT-*`가 있으면 그대로 보존하고 없으면 `CAND-*`와 누락 필드를 쓴다. 의도적 no-edit
  TASK라면 `해당 없음+이유`를 보존한다.
- 각 TASK는 한 에이전트가 독립적으로 완료·검증·인계할 수 있는 크기여야 한다. 대상,
  동작, 예외, 금지 범위, 완료 조건, 검증, 인계 결과 중 하나라도 없으면 ready가 아니다.
- 테스트 명령과 파일 경로는 확인된 코드 컨벤션에서만 쓴다. 확인되지 않은 경우
  Evidence-Resolution으로 남기며 그럴듯한 테스트 코드나 경로를 만들지 않는다.
- 코드를 변경하는 `ready` TASK는 구현 전에 확인된 검증 범위에서 RED를 관찰하고, 같은
  범위의 GREEN과 인접 회귀 확인까지 기록한다. 의도적 no-edit `ready` TASK는 RED/GREEN을
  `N/A+이유`로 표시하고, 확인된 실행 방식의 사전조건·기대 관측·실패 임계값·중단 또는
  rollback 조치를 기록한다. 테스트 코드를 템플릿에 미리 만들거나 라인 단위로 검사하지 않는다.
- partial 설계는 실행 가능한 Evidence-Resolution만 상세히 쓰고, 차단된 구현 TASK는
  필요한 근거와 승격 조건만 기록한다.
