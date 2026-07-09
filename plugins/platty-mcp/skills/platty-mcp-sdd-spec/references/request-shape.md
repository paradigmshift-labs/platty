# MCP SDD Request Shape

Use this template reference when `platty-mcp-sdd-spec` drafts `request.md`.
Preserve this section order. Fill unknowns as open questions or assumptions
instead of changing the template.

## Frontmatter

```yaml
---
id: "SPEC-<slug>-<YYYY-MM>"
type: "spec-request"
status: "draft"       # draft -> approved -> design -> tasks -> done
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

## §4 Solution

> 제안하는 변경 내용

### 4-1. <solution area>

- <Requested product behavior>

## §5 Rules

> EARS 패턴 비즈니스 규칙

| ID | EARS 텍스트 | 비고 |
|----|------------|------|
| R1 | WHEN <trigger>, 시스템은 <observable behavior>. | <evidence or assumption> |

## §6 Confirmed Decisions

> 대화 중 확정된 의사결정

| ID | 결정 | 근거 |
|----|------|------|
| D1 | <Only user-approved or exact MCP evidence-backed decision> | <basis> |

## §7 Open Questions

> 미결 사항 — design/tasks 단계 전 확인 필요

| ID | 질문 | 추천안 |
|----|------|--------|
| O1 | <Question> | <Recommended default and implication> |

## §8 Validation Hypotheses

> 성공 검증 방법

| ID | 가설 | 측정 기준 | 목표 방향 |
|----|------|----------|----------|
| H1 | <Hypothesis> | <Metric or validation signal> | <Target direction> |
```

## MCP Grounding Slots

- Put exact MCP reads in §0 `관련 SOT` and §6 decision bases.
- Put source parity gaps, stale evidence, and data caveats in §2-3.
- Put unresolved assumptions in §7, not in §6.
- Keep MCP-only metadata such as project id, output language, evidence boundary,
  context status, derived evidence ids, and local persistence target outside the
  markdown draft in the SDD Handoff Packet.

## Rules

- Explain internal names before listing ids, symbols, APIs, or document keys.
- Keep raw user terms, Korean candidate terms, English candidate terms, and
  matched glossary terms visible when retrieval normalized vocabulary.
- Do not promote open questions or assumptions into confirmed decisions.
- Mark source-level impact as a coverage limit when source parity is missing.
- Every §5 rule must be observable or testable.
