# MCP SDD Request Shape

Use this template reference when `platty-mcp-sdd-spec` drafts `request.md`.
Preserve this section order. Fill unknowns as open questions or assumptions
instead of changing the template.

## Frontmatter

```yaml
---
id: "SPEC-<slug>-<YYYY-MM>"
type: "sdd-request"
status: "draft"       # draft -> approved
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

## Required Sections

```markdown
# <Request Title>

> <One-paragraph product intent, grounded in MCP evidence and clearly marked assumptions.>

## §0 Impact

- **영향 유저**
  - <Affected users or actors>
- **검색 기준**
  - Raw terms: <raw user terms>
  - Korean candidate terms: <Korean terms searched>
  - English candidate terms: <English terms searched>
- **영향 EPIC**
  - <EPIC>: <affected product area>
- **영향 화면**
  - <screen/flow/API if known>
- **관련 SOT**
  - <MCP document/spec ids read>
- **관련 코드 참조**
  - <source confirmations or "추가 확인 필요">

## §1 Customer Task

> 유저와 제품팀이 해결하려는 일

- **<actor>**: "<job-to-be-done>"

## §2 Current Situation

### 2-1. 관측된 문제

- <Observed problem, metric, workflow gap, or policy conflict>

### 2-2. 문제가 아닌 것으로 본 영역

- <Non-goal or area not treated as the bottleneck>

### 2-3. 데이터 해석 주의

- <Data caveat, freshness caveat, source parity limit, or MCP coverage limit>

## §3 Limits

> 기존 해결책의 한계와 이번 변경의 범위

- <Why existing behavior or workaround is insufficient>

### In Scope

- <Behavior, actor, flow, or policy included in this request>

### Out of Scope

- <Adjacent behavior explicitly excluded from this request>

### Non-Goals

- <Outcome this request intentionally does not optimize or redesign>

## §4 Solution

> 제안하는 변경 내용

### 4-1. <solution area>

- <Requested product behavior>

## §5 Rules

> EARS 패턴 비즈니스 규칙

| ID | EARS 텍스트 | 비고 |
|----|------------|------|
| R-01 | WHEN <trigger>, 시스템은 <observable behavior>. | <evidence or assumption> |

## §6 Confirmed Decisions

> 대화 중 확정된 의사결정

| ID | 결정 | 근거 |
|----|------|------|
| D1 | <Only user-approved or exact MCP evidence-backed decision> | <basis> |

## §7 Open Questions

> 미결 사항 — design/tasks 단계 전 확인 필요

| ID | 질문 | Owner | Affected ids | Status | Scenario-shaping assumption | 추천안 |
|----|------|-------|--------------|--------|-----------------------------|--------|
| O1 | <Question> | <decision owner> | <R-NN / US-NN-SNN> | <open or resolved> | <assumption carried into scenarios> | <Recommended default and implication> |

## §8 Validation Hypotheses

> 성공 검증 방법

| ID | 가설 | 측정 기준 | 목표 방향 |
|----|------|----------|----------|
| H1 | <Hypothesis> | <Metric or validation signal> | <Target direction> |

## Engineering Discovery Handoff

- **Impact artifact**: `impact.md`
- **Impact status**: <seeded | investigated | partial>
- **Source parity**: <confirmed | partial | unavailable>
- **Seed EPICs**: <ids and names>
- **Seed specs**: <ids and kinds>
- **Context freshness**: <fresh | stale | unknown>
- **Source commits**: <repo id -> commit>
- **Coverage limits**: <short summary or none>

## §9 Self Review

- **Verdict**: <PASS | NEEDS_WORK>
- **Blocking findings**: <count>
- **Warnings**: <count>

### Requirement Coverage

| Input source or requirement | Result | Evidence or gap |
|----|----|----|
| <raw idea, provided requirement, confirmed answer, or MCP evidence> | <covered|partial|missing|conflict> | <request/story location or finding> |

### Search Route Audit

| Check | Result | Evidence or gap |
|----|----|----|
| Search Brief preserves raw, Korean, English, alias, and attempted-query fields | <PASS|FAIL|N/A> | |
| Project overview, candidate EPIC map, and relevant Memory overlay were checked | <PASS|FAIL> | |
| BR/DD/DESIGN/UCL maps and exact items were read for the selected branch | <PASS|FAIL> | |
| `document_get`/`document_item_get` and `document_resolve` completed where required | <PASS|FAIL> | |
| Selected specs received `spec_get` and `spec_resolve` | <PASS|FAIL|N/A> | |
| Exact source claims use bounded `readonly_workspace_shell` evidence | <PASS|FAIL|N/A> | |
| Direct evidence, inference, unread surfaces, freshness, and missing MCP surfaces are separated | <PASS|FAIL> | |
| Final Route Audit completed before drafting factual claims | <PASS|FAIL> | |

### Findings

| Severity | Finding | Required action |
|----|----|----|
| <blocking|warning> | | |
```

## MCP Grounding Slots

- Put exact MCP reads in §0 `관련 SOT` and §6 decision bases.
- Put source parity gaps, stale evidence, and data caveats in §2-3.
- Put unresolved assumptions in §7, not in §6.
- Append the compact Engineering Discovery Handoff after §8 from the verified
  impact result. Do not include the full Impact Evidence Matrix, raw MCP
  payload, shell transcript, or source bodies in `request.md`.
- Keep MCP-only metadata such as project id, output language, evidence boundary,
  context status, derived evidence ids, and local persistence target outside the
  markdown draft in the SDD Handoff Packet.

## Rules

- Explain internal names before listing ids, symbols, APIs, or document keys.
- Keep raw user terms, Korean candidate terms, English candidate terms, and
  matched glossary terms visible when retrieval normalized vocabulary.
- Do not promote open questions or assumptions into confirmed decisions.
- Mark source-level impact as a coverage limit when source parity is missing.
- Keep the handoff to its eight summary fields; `impact.md` owns the complete
  impact dossier and evidence matrix.
- Every §5 rule must be observable or testable.
- Self Review `PASS` does not change frontmatter status to `approved`.
- Missing required input or a required retrieval rung makes the verdict
  `NEEDS_WORK`; preserve the gap instead of claiming completeness.
