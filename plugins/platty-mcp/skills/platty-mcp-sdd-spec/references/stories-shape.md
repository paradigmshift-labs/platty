# MCP SDD 사용자 스토리 형식

`stories.md`는 한국어 사용자 시나리오 문서다. 구현 근거와 내부 검토 기록은
`impact.md` 및 frontmatter에 둔다.

## Frontmatter

```yaml
---
id: "SPEC-<slug>-<YYYY-MM>"
type: "sdd-stories"
status: "draft"
projectId: "<projectId>"
outputLanguage: "ko"
sourceCommit: "<source commit or unknown>"
sotExportedAt: "<ISO timestamp or unknown>"
evidenceBoundary: "<MCP evidence surfaces used>"
contextStatus: "<fresh | stale | unknown>"
derivedFrom: "request.md"
---
```

## 본문

```markdown
# 사용자 스토리 — <요청 제목>

> 사용자 관점의 결과와 검증 가능한 시나리오만 적는다.

## US-01. <스토리 제목>

**사용자로서** <사용자>는<br>
**<목표>를 위해** <행동>하고 싶다.<br>
**그래서** <기대 결과>를 얻는다.

### 시나리오 1: 정상 흐름

- **Given** <상태>
- **When** <행동 또는 트리거>
- **Then** <사용자/운영자가 확인하는 결과>

### 시나리오 2: 예외 흐름

- **Given** <예외 상태>
- **When** <행동 또는 트리거>
- **Then** <기대 결과>

## 규칙·시나리오 연결

| 제품 규칙 | 사용자 스토리 | 시나리오 | 남은 가정 |
| --- | --- | --- | --- |
| R-01 | US-01 | US-01-S01 | |
```

## 작성 규칙

- 각 스토리는 규칙 또는 명시된 가정과 연결한다.
- `US-NN-SNN` 식별자는 한 번 부여하면 순서 변경으로 다시 번호를 매기지 않는다.
- 내부 구현 방식, MCP 도구 호출, 근거 매트릭스, Self Review는 본문에 넣지 않는다.
