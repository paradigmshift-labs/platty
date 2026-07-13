# MCP SDD 작업 계획 형식

`tasks.md`는 승인된 `design.md`를 구현 작업으로 나눈 한국어 문서다. 상세
fingerprint와 readiness는 frontmatter로 검증하고, 본문은 실행 순서와 검증에 집중한다.

## Frontmatter

```yaml
---
id: "SPEC-<slug>-<YYYY-MM>"
type: "sdd-tasks"
status: "planned"
executionReadiness: "partial | ready"
projectId: "<projectId>"
outputLanguage: "ko"
designApprovedAt: "<approved design approvedAt>"
designApprovedBy: "<approved design approvedBy>"
designRevision: "sha256:<hex>"
approvedRevision: "sha256:<hex>"
productInputFingerprint: "sha256:<hex>"
evidenceFingerprint: "sha256:<hex>"
impactStatus: "<seeded | investigated | partial>"
sourceParity: "<confirmed | partial | unavailable>"
coverageLimits: []
derivedFrom: ["request.md", "stories.md", "impact.md", "design.md"]
---
```

## 본문

```markdown
# 구현 작업 — <요청 제목>

> 승인된 설계 기준: [design.md](design.md). 근거 상세: [impact.md](impact.md).

## 0. 작업 연결표

| 작업 | 설계 변경 | 규칙·시나리오 | 근거 | 준비 상태 |
| --- | --- | --- | --- | --- |
| TASK-01 | CHG-01 | R-01 / US-01-S01 | impact.md <id> | ready |

## 1. 구현 작업

### TASK-01. <독립적으로 검증 가능한 결과>

- **변경**: `CHG-01`
- **대상**: <확인된 파일·심볼 또는 Evidence-Resolution>
- **구현**: <무엇을 바꾸는지>
- **완료 조건**: <관찰 가능한 결과>
- **검증**: `VER-01`
- **근거**: <impact evidence id / source reference>

확인된 파일·심볼·명령이 없으면 구현 경로를 추측하지 않는다. 아래처럼 조사 작업으로 분리한다.

### Evidence-Resolution TASK-02. <확인할 사실>

- **필요한 MCP 도구**: `document_resolve` | `graph_trace` | `code_search` | `readonly_workspace_shell`
- **다음 확인**: <좁은 대상과 질문>
- **완료 조건**: <새 설계 revision에서 CHG/VER로 확정할 수 있는 근거>
- **후속 처리**: impact owner가 `impact.md`를 갱신하고 새 design 승인 후 tasks를 재생성한다.

## 2. 자동화 검증

| VER ID | 작업 | 자동화 수준 | 명령 또는 검증 방식 | 기대 결과 |
| --- | --- | --- | --- | --- |

## 3. E2E 시나리오

| 시나리오 | Given | When | Then | 연결 |
| --- | --- | --- | --- | --- |

## 4. 수동 검증

| 확인 항목 | 자동화하지 않는 이유 | 기대 결과 |
| --- | --- | --- |

## 5. 배포와 롤백

| 순서 | 변경 | 확인 신호 | 실패 시 조치 |
| --- | --- | --- | --- |
```

## 작성 규칙

- 승인 전에는 `tasks.md`를 만들거나 덮어쓰지 않는다.
- `ready` 작업은 파일·심볼·인터페이스·검증 방식이 근거로 확인된 경우에만 쓴다.
- 근거가 부족하면 Evidence-Resolution 작업으로 남기고, `impact.md` 갱신 → 새
  design revision → 재승인 → tasks 재생성 순서를 따른다.
- 테스트 코드나 파일 경로를 템플릿에 미리 생성하지 않는다.
