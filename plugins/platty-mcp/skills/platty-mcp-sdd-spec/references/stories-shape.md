# MCP SDD Stories Shape

Use this template reference whenever `platty-mcp-sdd-spec` drafts
`stories.md`. Preserve this story/scenario/traceability shape so designers,
planners, and implementation agents can review the same product behavior.

## Frontmatter

```yaml
---
id: "SPEC-<slug>-<YYYY-MM>"
type: "spec-stories"
status: "draft"       # draft -> approved
projectId: "<projectId>"
outputLanguage: "ko"
sourceCommit: "<source commit or unknown>"
sotExportedAt: "<ISO timestamp or unknown>"
evidenceBoundary: "<MCP evidence surfaces used>"
contextStatus: "<fresh | stale | unknown>"
derived_from: "request.md"
---
```

## Required Sections

```markdown
# User Stories — <Request Title>

> request.md의 §1 Customer Task + §5 Rules에서 파생.
> 디자이너·기획자가 사용자 관점에서 시나리오를 검토할 수 있도록 Given-When-Then 형식으로 작성.
> 내부 구현 방식보다 유저가 인지하는 결과와 제품팀이 검증해야 할 행동을 중심으로 기술한다.

---

## US-01: <story title>

**As a** <actor><br>
**I want** <goal><br>
**So that** <outcome>

### Scenario 1: <scenario title> (정상)

- **Given** <user/system state>
- **When** <user action or system trigger>
- **Then** <visible or measurable result>
- **And** <optional additional result>

### Scenario 2: <scenario title> (엣지)

- **Given** <edge state>
- **When** <action or trigger>
- **Then** <expected behavior>

---

## Traceability

> 각 User Story가 어떤 Rule(§5)에서 파생됐는지 추적

| User Story | Scenario | 관련 Rules | 비고 |
|------------|----------|------------|------|
| US-01 | S1 <scenario> | R1 | <note> |

**Rule 커버리지: R1~R<N> 전부 1개 이상 시나리오에 매핑 (<N>/<N>, 100%)**
```

## Rules

- Every story must map to a request rule or open assumption.
- Do not invent implementation detail that the request did not establish.
- Preserve unresolved assumptions instead of silently closing them.
- If `request.md` is still draft, keep `stories.md` draft and include the
  assumptions that were used to split stories.
- Keep runtime-only metadata outside the markdown draft in the SDD packet.
- If a request rule has no scenario, keep the coverage line below 100% and call
  out the missing rule in Traceability.
