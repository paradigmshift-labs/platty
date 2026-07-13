---
name: platty-mcp-retrieval
description: Use when answering Platty project questions through configured read-only MCP tools, including domain terms, epics, business documents, specs, exact code locations, or source confirmation, or when another Platty MCP skill needs an Impact Seed Packet.
---

# Platty MCP Retrieval

**전제:** 이번 turn에서 이미 읽지 않았다면, 행동하기 전에 `using-platty-mcp`를
읽는다.

Platty MCP retrieval은 map-first다. search hit보다 project, epic, document-item,
spec map을 먼저 훑는다.

<HARD-GATE>
넓은 질문, domain-term, business-rule, data-field, system-design, capability,
journey, comparison, inventory, semantic impact-seed 질문에서는 Full-Cycle
Retrieval Ladder를 완료하거나 필수 MCP surface가 없다고 보고하기 전까지 답하지
않고, search를 proof로 취급하지 않는다.

`document_search`, `ssot_search`, `spec_search`, `code_search`, `graph_trace`를
먼저 호출하지 않는다. 먼저 project overview, 필요 시 vocabulary, epic map,
선택한 BR/DD/DESIGN/UCL map을 만든다. Search는 map 이후 candidate를 좁히는
도구다. exact `epic_get`, `document_list`, `document_item_get`,
`document_resolve`, `spec_get`, `readonly_workspace_shell` read를 대체할 수 없다.
</HARD-GATE>

MCP profile은 read-only다. configured MCP tool만 사용한다. local file을 읽거나,
local shell/CLI를 fallback으로 쓰거나, local SOT를 읽거나, project를 mutate하거나,
document를 generate하거나, memory를 쓰지 않는다. MCP가 제공하는 source tool인
`readonly_workspace_shell`은 노출되어 있고 evidence gate가 요구할 때 사용할 수
있다. 이것은 local fallback이 아니다. Stored SOT file은 MCP artifact tool을
통해서만 사용할 수 있으며, behavior claim 전에 exact evidence read가 필요하다.

Memory overlay read: 선택한 `project_overview_get.overview.memories`,
`epic_get.memories`, `document_get.memories`를 확인한다. broad read는 summary card를
반환할 수 있다. attached card만으로 부족하면 `memory_list` 또는 `memory_get`을
사용한다. scoped discovery에는 list, 답변에 영향을 줄 수 있는 exact memory body에는
get을 사용한다.

## 언제 사용할지

domain term, epic, business doc, spec, exact API, exact source-near question,
code location, source confirmation에 대한 일반 retrieval 답변에 이 스킬을 사용한다.
`platty-mcp-impact-analysis` 또는 owning SDD skill이 Impact Seed Packet을 필요로
할 때도 사용한다.

## 사용하지 않을 때

setup, analysis, sync, generation, mutation, memory write, local cache 변경,
local inspection에는 사용하지 않는다. 이런 경우 boundary gap으로 보고한다.

## Impact Escalation Gate

명시적 SDD file authoring을 먼저 route한다. request/story authoring은
`platty-mcp-sdd-spec`, design/task authoring은 `platty-mcp-sdd-design`으로 간다.
이 intent는 일반 impact 또는 design-change wording보다 우선한다.

일반 retrieval은 retrieval-only로 유지한다. 특히 exact API, exact screen, exact
source-near question은 사용자가 observable impact question도 함께 묻지 않는 한 이
스킬에 남는다.

"what changes", "what breaks", "what is affected", blast radius, affected
surface, cross-EPIC impact, design-change impact 같은 질문은 observable impact
trigger로 취급한다. 다음 route contract를 사용한다.

```text
ordinary question -> retrieval answer
user impact trigger -> retrieval(routeMode=seed-only, routeOrigin=user)
-> semantic map -> Impact Seed Packet -> platty-mcp-impact-analysis
impact without packet -> retrieval(routeMode=seed-only, routeOrigin=impact)
-> return Impact Seed Packet to impact; do not escalate
impact with packet -> dossier axes; do not re-enter retrieval
SDD file authoring intent -> platty-mcp-sdd-spec or platty-mcp-sdd-design
```

`routeMode: seed-only`에서는 이 스킬이 packet producer 역할만 한다.
`platty-mcp-impact-analysis`로 escalate하거나 route하지 않는다. Impact Seed Packet을
caller에게 반환하거나 hand back한다. 이미 만들어진 packet이 있으면 semantic
discovery, vocabulary normalization, EPIC mapping, business-document gate,
selected specs를 다시 만들지 말고 재사용한다. Retrieval은 semantic scope와 selected
specs를 소유하고, impact는 graph, cross-EPIC, repository, source convergence를
소유한다.

## Operating Flow

1. Project context와 context status를 resolve한다.
2. 질문에 필요한 MCP capability tier를 확인한다.
3. 질문이 broad하거나 ambiguous하면 Search Clarification Gate를 실행한다.
4. broad 또는 semantic branch에는 Full-Cycle Retrieval Ladder를 실행한다.
5. observable impact trigger라면 Impact Seed Packet을 만들거나 재사용한다. 그렇지
   않으면 선택한 retrieval branch가 요구하는 exact spec 또는 source evidence를
   따라간다.
6. 관련 memory overlay를 반영하되 SOT나 source proof로 취급하지 않는다.
7. Final Route Audit를 실행한다.
8. evidence boundary, direct evidence, inference, memory overlay, missing MCP
   surface를 분리해서 답한다.

답변에 correction recording, re-anchoring, refresh, sync, generation이 필요하면
boundary gap을 보고한다.

## Quick Rules

| Do | Don't |
| --- | --- |
| bounded source confirmation에 필요하고 노출되어 있다면 MCP `readonly_workspace_shell`까지 포함해 configured MCP tool만 사용한다. | local file, local shell/CLI fallback, local SOT, DB table, cache를 읽는다. |
| project, epic, BR/DD/DESIGN/UCL, spec, source map을 순서대로 만든다. | search hit, snippet, score 하나를 proof로 취급한다. |
| 선택한 epic/document의 attached memory overlay를 읽는다. | memory를 generated SOT 또는 source-confirmed behavior로 취급한다. |
| term이 맞물리지 않을 수 있으면 vocabulary를 normalize한다. | glossary normalization을 behavior evidence로 취급한다. |
| implementation claim 전에는 exact item/spec/source evidence를 읽는다. | required evidence tier 없이 response shape, permission, write, emit, absence를 주장한다. |
| code claim에는 `code_search`와 MCP `readonly_workspace_shell`을 한 쌍으로 취급한다. 후보 file/symbol을 찾고, exact behavior를 주장하기 전에 bounded source를 읽는다. | source code inspection이 필요한데 `code_search`에서 멈춘다. |
| exact BR/DD/DESIGN/UCL item을 읽은 뒤에는 답이 순수 conceptual인 경우를 제외하고 source-near search 전에 `document_resolve(itemId)`를 호출한다. | linked context를 먼저 resolve하지 않고 business item에서 `document_search` 또는 `spec_search`로 점프한다. |
| MCP evidence를 사용한 뒤에도 해석이 동률일 때만 clarifying question 하나를 묻는다. | ambiguity를 줄이기 위해 MCP evidence를 사용하기 전에 사용자에게 묻는다. |

## Vocabulary Tool 선택

- exact raw phrase 또는 candidate term에는 `glossary_translate(projectId, text)`를
  사용한다. raw phrase와 Korean/English candidate를 visible하게 유지한다.
- broad vocabulary inventory, comparison, ambiguous concept, all-alias request,
  또는 translation이 blank/conflicting인 뒤 candidate discovery에는
  `glossary_list(projectId, limit, cursor)`를 사용한다.
- exact/raw phrase에 대한 `glossary_translate`가 blank/conflicting인데 plausible
  Korean/English candidate가 남아 있으면, 추가 candidate를 translate하기 전에
  `glossary_list`를 호출해 candidate discovery를 한다.
- complete inventory에는 `pageInfo.hasNextPage`가 false가 될 때까지
  `pageInfo.nextCursor`를 따라간다. targeted discovery에는 필요한 candidate를 찾으면
  멈춘다.
- query expansion에는 `aliases`를 사용한다. `generatedAliases`와 `memoryAliases`는
  분리한다. memory alias는 overlay이고 glossary output은 routing evidence이지
  behavior 또는 source proof가 아니다.

## Search Clarification Gate

route하기 전에 질문이 exact인지, runtime Search Brief가 필요한지 결정한다. Exact
source-near question은 term, scope, target set이 ambiguous하지 않으면 우회할 수
있다.

broad inventory, impact, Korean/English bridge, business-vs-implementation split,
또는 search hit 하나가 target set을 놓칠 수 있는 경우 Search Brief를 만든다.
trigger는 `references/search-clarification.md`를 읽는다.

Search Brief shape:

```text
Search Brief
- Raw question:
- Question branch:
- Ambiguity triggers:
- Candidate interpretations:
- Raw terms:
- Korean candidate terms:
- English candidate terms:
- Alias candidates:
- Glossary searches attempted:
- Search-assist queries attempted:
- Candidate MCP route:
- User decision needed:
```

Search Brief는 runtime context에만 유지한다. 사용자에게 묻기 전에 MCP evidence를
사용한다. evidence가 tied interpretation을 남길 때만 clarifying question 하나를
묻고, recommended interpretation을 함께 제시한다.

## Full-Cycle Retrieval Ladder

broad, semantic, comparison, inventory, impact-seed에는 ladder를 사용한다.
project context -> overview -> vocabulary -> epic map -> BR/DD/DESIGN/UCL map ->
exact items -> connected specs -> exact specs -> 필요 시 source confirmation ->
Final Route Audit.

각 rung은 list/map first, exact detail second다. Overview, artifact, catalog row,
glossary output, search hit는 방향만 잡는다. ladder와 audit은
`references/full-cycle-retrieval.md`를 읽는다.

## Branch Table

`references/full-cycle-retrieval.md`가 canonical order of operations다.
`references/question-routes.md`는 branch-specific document family, extra
requirement, completion check를 고를 때만 읽는다. ladder의 두 번째 사본으로
취급하지 않는다.

question type에 따라 route한다: concept/domain term, policy/rule, data field,
design, capability/journey, exact API/screen/event/schedule, impact seed, source
absence.

## Evidence Gates

- Vocabulary normalization은 proof가 아니다.
- Search hit, snippet, score는 candidate이지 fact가 아니다.
- Project overview와 epic row는 scope를 고르는 데 쓰며 final behavior가 아니다.
- BR, DD, DESIGN, UCL은 semantic router다.
- Memory overlay는 human/agent note다. correction, constraint, why/context,
  ambiguity에 사용하되 generated SOT 및 source evidence와 분리한다.
- Source-near behavior claim에는 exact spec evidence가 필요하다.
- 선택한 `spec_search` candidate는 `spec_get`과 `spec_resolve`로 이어간다.
- Exact implementation, response shape, permission, DB write, event emit,
  external call, negative source evidence에는 MCP 서버가 노출하는 경우 source-level
  confirmation이 필요하다. `code_search`로 candidate를 찾은 뒤 MCP
  `readonly_workspace_shell`을 적극적으로 사용해 bounded source region을 읽는다.
- `itemType`을 포함한 `document_item_list`가 row를 반환하지 않지만 available item을
  보고하거나 `DOCUMENT_ITEM_FILTER_EMPTY_WITH_AVAILABLE_ITEMS`를 emit하면, item을
  absent로 취급하기 전에 narrowing filter 없이 같은 document를 retry한다.
- `document_list` 또는 `document_get`이 document-level `content.items`를 보여주는데
  `document_item_list`가 row를 반환하지 않거나 `itemTier: inconsistent`를 보고하면,
  exact `document_item_get`을 사용할 수 없는 한 MCP item-tier gap을 보고하고
  document-level evidence로 약화한다.
- 필수 read-only surface가 없으면 MCP capability gap을 보고한다. configured MCP tool
  밖의 surface로 전환하지 않는다.
- Stored SOT file content와 artifact path는 transport evidence일 뿐이다.

예시와 branch-specific evidence rule은 `references/evidence-gates.md`를 읽는다.

## Stop Conditions

selected-branch tool이 없거나, 사용자가 setup, analysis, sync, generation,
mutation, memory write, local cache/local read를 요청하거나, full-cycle map을 만들
수 없거나, search candidate만 있거나, raw term과 normalized term이 갈라지거나,
broad inventory/impact seed에 target map이 없거나, 필요한 source confirmation tool이
없으면 중단하고 boundary를 보고한다.

MCP evidence가 tied interpretation을 남기면 recommended interpretation과 함께
clarifying question 하나를 묻는다. MCP evidence 안에서 ambiguity를 해결할 수 없을
때만 중단한다.

evidence가 약하면 다음 read-only MCP surface를 이름으로 밝힌다. 그것이 refresh,
export, sync, generation, memory write, local file을 필요로 하면
configuration/boundary gap을 보고한다.

## Final Route Audit

모든 final answer 전에 runtime context에서 route를 audit한다. 필수 rung이 빠졌으면
MCP step을 수행하거나 weaken/stop한다. audit failure를 confident claim으로 바꾸지
않는다. Checklist: `references/full-cycle-retrieval.md`.

## Stakeholder Answer Shape

product 또는 implementation question에는 answer first, evidence second,
uncertainty last로 답한다. 전체 template은 `references/answer-shape.md`.

```text
## 현재 확인된 기준
## 실제 동작
## 관련 위치
## 더 확인할 후보
```

technical id보다 internal name을 먼저 설명한다. "확인됨"은 exact MCP content read에만
사용한다. search hit 또는 inferred behavior에는 "후보", "근거상 보임", "추가 확인
필요"를 사용한다.

## Answer Contract

모든 답변에는 evidence boundary, 사용한 normalized term, selected interpretation,
읽은 surface, direct evidence vs inference, freshness 또는 coverage limit, missing MCP
surface, confidence 또는 scope를 바꾸는 audit result가 포함되어야 한다.

## Verification Reference

이 스킬을 validate하거나 변경할 때만 `references/pressure-scenarios.md`를 사용한다.
일반 retrieval answer에는 load하지 않는다.
