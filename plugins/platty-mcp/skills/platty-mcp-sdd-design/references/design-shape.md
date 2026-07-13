# MCP SDD 개발 설계 형식

`design.md`는 개발자가 구현 방향을 빠르게 파악하는 한국어 문서다. 승인·최신성·
fingerprint·source parity 같은 기계 검증값은 frontmatter에 보존하고, 상세 근거는
`impact.md`에 둔다.

## Frontmatter

```yaml
---
id: "SPEC-<slug>-<YYYY-MM>"
type: "sdd-design"
status: "draft"
projectId: "<projectId>"
outputLanguage: "ko"
requestStatus: "approved"
storiesStatus: "approved"
requestRevision: "sha256:<hex>"
storiesRevision: "sha256:<hex>"
productInputFingerprint: "sha256:<hex>"
impactRevision: "sha256:<hex>"
impactArtifact: "impact.md"
impactEvidenceSnapshot: []
impactStatus: "<seeded | investigated | partial>"
impactRefreshReason:
  condition: "not-needed"
  affectedEvidenceIds: []
  affectedCoverageLimits: []
sourceParity: "<confirmed | partial | unavailable>"
impactRetrievedAt: "<ISO timestamp>"
contextStatus: "<fresh | stale | unknown>"
evidenceFingerprint: "sha256:<hex>"
designRevision: "sha256:<hex>"
approvedRevision: ""
approvedAt: ""
approvedBy: ""
sourceCommits: {}
crossEpicTraversalStatus: "<complete | partial | unknown>"
impactCoverageLimits: []
review:
  verdict: "PASS | NEEDS_WORK"
  readiness: "ready | partial | blocked"
  blockingFindings: []
  warnings: []
  impactAssessmentAudit: {}
  requirementCoverage: {}
  changeCoverage: {}
  verificationCoverage: {}
derivedFrom: ["request.md", "stories.md", "impact.md"]
---
```

## 본문

```markdown
# 시스템 설계 — <요청 제목>

> **DRAFT — 개발자 검토 필요.** 상세 조사 근거: [impact.md](impact.md).

## 0. 시스템 설계 한눈에 보기

| 항목 | 내용 |
| --- | --- |
| 변경 목적과 성공 기준 | |
| 범위와 비목표 | |
| 영향 시스템/저장소 | |
| 주요 설계 결정 | |
| 결정이 필요한 쟁점 | |

## 1. 시스템 경계와 책임

| 구성요소/외부 시스템 | 책임 | 소유 데이터 | 동기/비동기 연결 | 변경 여부 |
| --- | --- | --- | --- | --- |

필요한 경우에만 컨텍스트 또는 컴포넌트 Mermaid 다이어그램을 사용한다. 다이어그램은
책임과 경계를 보여 주며, 확인되지 않은 연결은 `후보`로 표기한다.

## 2. 현재 구조와 영향 경로 (As-Is)

| 경계 | 파일/심볼 또는 문서 | 현재 역할 | 상태 |
| --- | --- | --- | --- |

### 2-1. 빠른 경로 지도 (Graph Trace)

`graph_trace`는 빠르게 구조를 파악하는 보조 수단이다. 확정된 홉과 후보·미확인
홉을 구분하며, 쓰기·권한·트랜잭션·응답 형식은 원문 근거가 있을 때만 확정한다.

| 시작 앵커 | 화면 → API → 도메인 → 데이터/외부 경로 | 확인됨 | 후보·미확인 | 다음 확인 |
| --- | --- | --- | --- | --- |

### 2-2. 영향 코드 경로 읽기 범위

| 앵커 | 읽은 경계와 파일/심볼 | 확인한 소비자 | 미열람 후보/이유 | 상태 |
| --- | --- | --- | --- | --- |

`confirmed-path`만 현재 구현 사실 또는 정확한 변경 위치의 근거가 된다. `partial-path`는
위험 또는 Evidence-Resolution으로 남긴다. 상세 근거는 `impact.md`를 따른다.

## 3. 목표 구조와 설계 결정 (To-Be)

### 3-1. 목표 구조

컴포넌트 책임, 동기 API, 비동기 이벤트, 외부 연동, 데이터 소유권을 설명한다.
필요한 경우에만 Mermaid를 사용한다.

### 3-2. 설계 결정

| D ID | 결정 | 고려한 대안 | 선택 이유 | 영향/후속 |
| --- | --- | --- | --- | --- |
| D-01 | | | | |

### 3-3. 구현 변경 연결

| CHG ID | 변경 경계 | As-Is → To-Be | 책임/저장소 | 호환성 | 규칙·시나리오 |
| --- | --- | --- | --- | --- | --- |
| CHG-01 | | | | | R-01 / US-01-S01 |

필요할 때만 여러 경계의 호출 순서, 비동기 처리, 트랜잭션, 재시도, 보상 흐름을
Mermaid로 작성한다. 단순 CRUD에는 표와 짧은 설명을 사용한다.

## 4. 인터페이스와 데이터 설계

### 4-1. API·화면·이벤트 계약

| CHG ID | 계약 | 변경 | 호환성 | 근거 |
| --- | --- | --- | --- | --- |

### 4-2. 데이터 소유권·상태·일관성

| CHG ID | 대상 | 변경/전이 | 동시성·실패 처리 | 근거 |
| --- | --- | --- | --- | --- |

### 4-3. 작업·이벤트·외부 연동

| CHG ID | 생산자/소비자 또는 연동 | 순서·재시도·타임아웃 | 운영 책임 |
| --- | --- | --- | --- |

## 5. 핵심 흐름과 실패 처리

중요한 정상/예외 경로에서만 sequence Mermaid를 사용한다. 재시도, 중복 실행,
보상, 부분 실패, 타임아웃의 소유자와 관찰 신호를 명시한다.

| 흐름 | 트리거 | 일관성/멱등성 | 실패·복구 | 관찰 신호 |
| --- | --- | --- | --- | --- |

## 6. 비기능·운영 설계

| 영역 | 요구/결정 | 구현 또는 운영 책임 | 검증 신호 |
| --- | --- | --- | --- |
| 권한·개인정보 | | | |
| 성능·용량 | | | |
| 관측성·알림 | | | |

## 7. 마이그레이션·배포·롤백

| 변경 | 순서 | 호환성/데이터 안전 | 롤백 또는 전진 복구 | 출시 신호 |
| --- | --- | --- | --- | --- |

## 8. 구현 연결과 미결정 사항

### 8-1. 코드 컨벤션과 구현 원칙

| 항목 | 확인한 기존 패턴 | 이번 적용 또는 예외 | 근거 |
| --- | --- | --- | --- |
| 모듈·파일 배치 | | | |
| 이름·타입·DTO | | | |
| 검증·오류 처리 | | | |
| 트랜잭션·외부 호출 | | | |
| 테스트 위치·스타일 | | | |

### 8-2. 검증 연결

| VER ID | 규칙/시나리오 | CHG ID | 검증 수준 | 기대 결과 | 명령 또는 근거 공백 |
| --- | --- | --- | --- | --- | --- |
| VER-01 | R-01 / US-01-S01 | CHG-01 | 통합 | | |

### 8-3. 위험과 미결정 사항

| ID | 위험 또는 결정 | 영향 | 소유자 | 다음 확인 또는 재검토 조건 |
| --- | --- | --- | --- | --- |

---

**근거와 한계**: [impact.md](impact.md) — <evidence id 또는 한 줄 요약>.
```

## 작성 규칙

- `document_resolve`로 연결된 문서 근거, `graph_trace` 후보, 정확한 원문 읽기
  범위는 `impact.md`를 SSOT로 삼는다.
- design에는 구현에 필요한 경로 지도와 근거 ID만 싣고, 매트릭스·도구 로그·
  freshness 표를 복사하지 않는다.
- `확인됨`, `후보`, `위험`을 구분한다. candidate-only 또는 빈 graph 결과는
  영향 없음의 근거가 아니다.
- 승인·fingerprint·readiness 판단은 frontmatter의 `review`와 review rubric으로 수행하며
  별도 독자용 섹션으로 만들지 않는다.
