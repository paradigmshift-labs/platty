# MCP SDD 요청서 형식

`prd.md`는 기획자·디자이너·QA가 읽는 한국어 문서다. 제품 기획 본문은 §0–§8에
두고, MCP 조사 상세·최신성·source parity·도구 호출·Self Review 근거는 **맨 아래
§9**에 둔다. 별도 영향도 파일은 만들지 않는다.

## Frontmatter

```yaml
---
id: "SPEC-<slug>-<YYYY-MM>"
type: "sdd-request"
status: "draft"
projectId: "<projectId>"
outputLanguage: "ko"
sourceCommit: "<source commit or unknown>"
sotExportedAt: "<ISO timestamp or unknown>"
evidenceBoundary: "<MCP evidence surfaces used>"
contextStatus: "<fresh | stale | unknown>"
impactRevision: "sha256:<hex>"
impactStatus: "<seeded | investigated | partial>"
sourceParity: "<confirmed | partial | unavailable>"
impactRetrievedAt: "<ISO timestamp>"
sourceCommits: {}
impactCoverageLimits: []
epic: "<EPIC, EPIC>"
created: "<YYYY-MM-DD>"
---
```

## 본문

```markdown
# <요청 제목>

> <무엇을, 왜 바꾸는지 2~4문장>

## 0. 변경 한눈에 보기

| 항목 | 내용 |
| --- | --- |
| 대상 사용자 | |
| 바꾸는 경험/정책 | |
| 영향 영역 | |
| 이번에 하지 않는 것 | |

## 1. 사용자 과업과 현재 문제

### 사용자 과업

> **<사용자>**는 <목표>를 위해 <행동>할 수 있어야 한다.

### 현재 문제

- <관찰된 문제 또는 정책 충돌>
- <현재 흐름의 한계>

## 2. 범위

| 포함 | 제외 |
| --- | --- |
| | |

## 3. 제안하는 해결 방향

### <해결 영역>

- <사용자에게 보이는 변경>

## 4. 제품 규칙

| ID | 규칙 |
| --- | --- |
| R-01 | WHEN <조건>, 시스템은 <관찰 가능한 결과>를 제공한다. |

## 5. 확정 결정과 미결 질문

### 확정 결정

| ID | 결정 | 근거 |
| --- | --- | --- |
| D-01 | | |

### 미결 질문

| ID | 질문 | 영향 | 추천안 |
| --- | --- | --- | --- |
| O-01 | | | |

## 6. 성공 검증

| ID | 확인할 결과 | 측정 또는 관찰 방법 |
| --- | --- | --- |
| H-01 | | |

---

## 9. 영향도 조사 및 근거

> 이 부록은 `platty-mcp-impact-analysis`가 작성·갱신한다. 제품 본문 §0–§8과
> 사용자 스토리의 기획 결정을 다시 쓰지 않는다.

### 9-1. 조사 기준과 문서 연결
### 9-2. 최신성 및 근거 경계
### 9-3. 관련 EPIC·문서·스펙
### 9-4. 화면·API·데이터 후보
### 9-5. 빠른 경로 지도 (Graph Trace)
### 9-6. 교차 EPIC·저장소·원문 확인
### 9-7. 영향 근거 매트릭스
### 9-8. 조사 한계와 다음 확인
```

## 작성 규칙

- `document_resolve`로 연결한 제품 문서와 `graph_trace` 결과의 상세는 §9에
  남긴다.
- 확인되지 않은 구현 경로를 제품 결정처럼 쓰지 않는다.
- 미결 가정은 `미결 질문`에 남기고 확정 결정으로 승격하지 않는다.
- §9가 partial이면 본문의 범위 또는 검증에서 그 한계를 짧게 알린다.
