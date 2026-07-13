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
requestRevision: "sha256:<hex>"
storiesRevision: "sha256:<hex>"
productInputFingerprint: "sha256:<hex>"
impactRevision: "sha256:<hex>"
impactStatus: "<seeded | investigated | partial>"
sourceParity: "<confirmed | partial | unavailable>"
evidenceFingerprint: "sha256:<hex>"
designRevision: "sha256:<hex>"
approvedRevision: ""
approvedAt: ""
approvedBy: ""
sourceCommits: {}
coverageLimits: []
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
# 개발 설계 — <요청 제목>

> **DRAFT — 개발자 검토 필요.** 상세 조사 근거: [impact.md](impact.md).

## 0. 설계 한눈에 보기

| 항목 | 내용 |
| --- | --- |
| 변경 목적 | |
| 영향 저장소/영역 | |
| 주요 변경 경계 | <화면·API·도메인·데이터·이벤트> |
| 구현 시작점 | |
| 가장 큰 위험 | |

## 1. 현재 구조 (As-Is)

| 경계 | 파일/심볼 또는 문서 | 현재 역할 | 상태 |
| --- | --- | --- | --- |

### 1-1. 빠른 경로 지도 (Graph Trace)

`graph_trace`는 빠르게 구조를 파악하는 보조 수단이다. 확정된 홉과 후보·미확인
홉을 구분하며, 쓰기·권한·트랜잭션·응답 형식은 원문 근거가 있을 때만 확정한다.

| 시작 앵커 | 화면 → API → 도메인 → 데이터/외부 경로 | 확인됨 | 후보·미확인 | 다음 확인 |
| --- | --- | --- | --- | --- |

## 2. 변경 설계 (To-Be)

| CHG ID | 변경 경계 | As-Is → To-Be | 책임/저장소 | 호환성 | 규칙·시나리오 |
| --- | --- | --- | --- | --- | --- |
| CHG-01 | | | | | R-01 / US-01-S01 |

필요할 때만 여러 경계의 호출 순서, 비동기 처리, 트랜잭션, 재시도, 보상 흐름을
Mermaid로 작성한다. 단순 CRUD에는 표와 짧은 설명을 사용한다.

## 3. 계약·데이터·상세 모듈

### API·화면·이벤트 계약

| CHG ID | 계약 | 변경 | 호환성 | 근거 |
| --- | --- | --- | --- | --- |

### 데이터·상태·비즈니스 로직

| CHG ID | 대상 | 변경/전이 | 동시성·실패 처리 | 근거 |
| --- | --- | --- | --- | --- |

### 작업·이벤트·외부 연동

| CHG ID | 생산자/소비자 또는 연동 | 순서·재시도·타임아웃 | 운영 책임 |
| --- | --- | --- | --- |

## 4. 코드 컨벤션과 구현 원칙

| 항목 | 확인한 기존 패턴 | 이번 적용 또는 예외 | 근거 |
| --- | --- | --- | --- |
| 모듈·파일 배치 | | | |
| 이름·타입·DTO | | | |
| 검증·오류 처리 | | | |
| 트랜잭션·외부 호출 | | | |
| 테스트 위치·스타일 | | | |

## 5. 검증·배포·롤백

| VER ID | 규칙/시나리오 | CHG ID | 검증 수준 | 기대 결과 | 명령 또는 근거 공백 |
| --- | --- | --- | --- | --- | --- |
| VER-01 | R-01 / US-01-S01 | CHG-01 | 통합 | | |

| 변경 | 배포 순서 | 호환성/데이터 안전 | 롤백 또는 전진 복구 | 출시 신호 |
| --- | --- | --- | --- | --- |

## 6. 위험과 미결정 사항

| ID | 위험 또는 결정 | 영향 | 소유자 | 다음 확인 또는 재검토 조건 |
| --- | --- | --- | --- | --- |

---

**근거와 한계**: [impact.md](impact.md) — <evidence id 또는 한 줄 요약>.
```

## 작성 규칙

- `document_resolve`로 연결된 문서 근거와 `graph_trace`의 상세 결과는
  `impact.md`를 SSOT로 삼는다.
- design에는 구현에 필요한 경로 지도와 근거 ID만 싣고, 매트릭스·도구 로그·
  freshness 표를 복사하지 않는다.
- `확인됨`, `후보`, `위험`을 구분한다. candidate-only 또는 빈 graph 결과는
  영향 없음의 근거가 아니다.
- 승인·fingerprint·readiness 판단은 frontmatter의 `review`와 review rubric으로 수행하며
  별도 독자용 섹션으로 만들지 않는다.
