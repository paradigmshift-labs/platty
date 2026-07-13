# MCP SDD 요청서 형식

`request.md`는 기획자·디자이너·QA가 읽는 한국어 문서다. MCP 조사 상세,
최신성, source parity, 도구 호출, Self Review는 `impact.md`와 frontmatter에
남기고 본문에 복사하지 않는다.

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

**조사 근거**: [impact.md](impact.md) — 상태: <investigated | partial>, 한계: <한 줄 또는 없음>.
```

## 작성 규칙

- `document_resolve`로 연결한 제품 문서와 `graph_trace` 결과의 상세는
  `impact.md`에 남긴다.
- 확인되지 않은 구현 경로를 제품 결정처럼 쓰지 않는다.
- 미결 가정은 `미결 질문`에 남기고 확정 결정으로 승격하지 않는다.
- `impact.md`가 partial이면 본문의 범위 또는 검증에서 그 한계를 짧게 알린다.
