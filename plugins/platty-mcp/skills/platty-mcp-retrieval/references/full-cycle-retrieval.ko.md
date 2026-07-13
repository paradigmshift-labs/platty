# Full-Cycle Retrieval Ladder

`platty-mcp-retrieval`이 broad, semantic, comparison, inventory, impact question으로
route할 때 이 reference를 사용한다. 각 rung은 list/map first, exact detail second다.

## Contents

- Exact Item Fast Path
- Evidence Depth By Question Type
- Canonical Ladder
- Runtime Evidence Checklist
- Business Document To Source-Near Spec Descent
- Retrieval Order
- Final Route Audit

## Exact Item Fast Path

exact BR/DD/DESIGN/UCL item이 이미 선택되어 있다면 search로 먼저 넓히지 않는다.
item을 source-near evidence로 가는 bridge로 사용한다.

```text
document_item_get
-> document_resolve(itemId)
-> rank linked api_spec/screen_spec/event_spec/schedule_spec candidates
-> spec_get for selected source-near behavior
-> spec_resolve for related docs/items, graph seeds, and code seeds
```

선택된 routing card 또는 item에는 `document_resolve(documentId)`보다
`document_resolve(itemId)`를 선호한다. whole-document resolve는 inventory에는 유용하지만
broad candidate를 반환할 수 있다. item-level resolve가 screen/API/event/schedule
descent의 fast path다.

## Evidence Depth By Question Type

claim을 뒷받침할 수 있는 최소 evidence depth를 사용한다. pure concept overview에는
source-near spec이나 source read를 강제하지 않는다. 그러나 flow, policy,
implementation-facing behavior, data claim에는 overview/search에서 멈추지 않는다.

| Question type | Required depth |
| --- | --- |
| Service overview, user-type explanation, implementation/API/screen/data claim 없는 high-level product inventory | `project_overview_get` -> `epic_list`/`epic_get` -> optional `ssot_search`/`ssot_get`; 답이 conceptual로 남고 coverage limit을 밝히면 여기서 멈출 수 있다 |
| Product flow, capability, journey, admin workflow, user action | Project/epic map -> DESIGN business document map near-mandatory -> 필요 시 BR/DD/UCL -> exact document/item reads -> source-near specs |
| Business policy, eligibility, status transition, rule enforcement | BR 및 관련 DESIGN/DD/UCL exact items -> connected specs -> enforcement를 주장할 때 source read |
| Data shape, table, field, state distribution, funnel, conversion, operational bottleneck | DD 및 관련 DESIGN/BR exact items -> behavior가 중요하면 connected specs. data MCP가 노출되면 guide를 읽고 read-only query를 사용한다. operational data source가 없으면 measurable funnel steps, instrumentation points, SSOT 기반 bottleneck hypothesis까지만 말하고 actual conversion cause를 주장하지 않는다 |
| API, screen, event, schedule, job, integration, permission, response shape, DB write, emit, external call, implementation behavior | Selected `api_spec`/`screen_spec`/`event_spec`/`schedule_spec` -> `spec_resolve` -> `code_search` -> spec이 thin/ambiguous하거나 exact source confirmation이 필요하면 bounded `readonly_workspace_shell` |

`readonly_workspace_shell`은 MCP가 제공하는 read-only source tool을 뜻한다. exposed되어 있고
evidence gate가 요구할 때 사용할 수 있다. `code_search` path의 source-reading half로
취급한다. `code_search`는 candidate file/symbol을 찾고, `readonly_workspace_shell`은
bounded source region을 읽는다. claim에 source inspection이 필요하면 `code_search`에서
멈추지 않는다. MCP source tool이 없다고 local filesystem 또는 local shell read로
대체하지 않는다.

conceptual answer에 "this API writes X", "this screen calls Y", "this status
changes when Z", "users drop here" 같은 concrete behavior가 들어가면 더 이상 pure
overview가 아니다. claim 전에 deeper branch로 escalate한다.

## Canonical Ladder

BR, DD, DESIGN, UCL은 semantic document family다. `document_list` tool argument에는
live MCP schema가 다른 값을 광고하지 않는 한 MCP filter value(`br`,
`data_dictionary`, `design`, `ucl`)를 사용한다. DD는 `dd`가 아니라
`data_dictionary`에 매핑된다.

```text
project_list/project_get/context_status
-> project_overview_get; read project_overview_get.overview.memories when present and use memory_get for exact bodies when needed
-> glossary_list for broad inventory, comparison, ambiguity, all-alias requests, or blank/conflicting translation; traverse every page when completeness is required
-> glossary_translate for the raw phrase and Korean/English candidates; record matched terms and alias candidates
-> epic_list
-> epic_get for each plausible candidate epic before discarding it; read epic_get.memories for selected candidate epics
-> document_list for the selected branch:
   documentType=br for policy/rule/eligibility
   documentType=data_dictionary for entity, table, field, or data-shape questions
   [MUST] documentType=design for product flow, capability, journey, admin workflow,
   system design, integration, data flow, architecture, or implementation-facing
   questions
   documentType=ucl for capability, journey, screen, or user action questions
-> document_get/document_item_list to map candidate items; read document_get.memories for selected documents and use memory_get for exact bodies when needed
-> document_item_get for exact BR/DD/DESIGN/UCL evidence
-> document_resolve(itemId) after exact item reads; use document_resolve(documentId)
   only for document-wide inventory. Follow explicit links to connected API,
   screen, event, schedule, data, service, or spec anchors and collect linked
   api_spec/screen_spec/event_spec/schedule_spec spec ids when returned
-> rank linked api_spec, screen_spec, event_spec, and schedule_spec candidates
   and keep the selected spec ids visible; use spec_list/spec_search only after
   document_resolve when the explicit linked set is absent, incomplete, stale,
   too broad, or the exact spec id is unknown
-> when spec_search is used, select candidate specs before making claims
-> spec_get for exact source-near behavior
-> spec_resolve to expand selected specs to related documents, items, graph seeds, and code seeds
-> code_search only when source address is incomplete and configured
-> readonly_workspace_shell to read the bounded candidate source before claiming
   exact code behavior, implementation absence, writes, emits, permissions, or response shape
```

ladder에 필요한 map/list surface가 없으면 해당 rung을 search로 대체하지 말고 MCP
capability gap을 보고한다.

## Runtime Evidence Checklist

답하기 전에 이 checklist를 runtime context에 유지하고, 선택한 question branch가 요구하는
rung을 완료한다. 사용자가 route audit을 요청하지 않는 한 final answer에 긴 checklist를
출력하지 않는다.

```text
[ ] Select project with project_list or project_get.
[ ] Check context_status and project_overview_get.
[ ] Identify relevant EPICs with epic_list and epic_get.
[ ] Normalize ambiguous Korean/domain terms with glossary_translate or
    glossary_list when needed.
[ ] If this is a pure service overview/user-type explanation with no concrete
    implementation, API, screen, event, schedule, state, or operational-data
    claim, stop at overview/epic/SSOT depth and state the boundary.
[ ] For product/business flow: use ssot_search -> ssot_get when SSOT evidence is
    the selected surface.
[ ] For authored docs or business rules: use document_list/search/get and exact
    document_item_get when item evidence is needed.
[ ] If any exact BR/DD/DESIGN/UCL item was used, run document_resolve(itemId)
    before source-near search, or state why the answer remains purely
    conceptual.
[ ] For product flow, capability, journey, admin workflow, data flow,
    integration, architecture, or implementation-facing questions, include
    DESIGN as a near-mandatory business map before descending to specs.
[ ] For API/screen/event/schedule/source-near behavior: use
    document_resolve(itemId) first after exact item reads, and prefer explicitly
    linked api_spec/screen_spec/event_spec/schedule_spec ids when available.
    Use spec_search only as fallback when explicit links are absent, incomplete,
    stale, too broad, or unresolved.
[ ] Run spec_resolve after selected spec reads when connected docs/items, graph
    seeds, or code seeds matter.
[ ] If implementation behavior is important or still ambiguous:
    [ ] use code_search to find filePath/functionName candidates when the source
        address is incomplete.
    [ ] use workspace_repo_list if repoId is unknown.
    [ ] actively use bounded readonly_workspace_shell to read only the relevant
        file/function range before making code behavior claims. There is no
        code_snippet tool; do not ask for or claim one.
[ ] If operational data is claimed:
    [ ] only do this when a data MCP is exposed for the environment.
    [ ] read data_analysis_guide/domain_guide when exposed by that data MCP.
    [ ] use read-only RDS/Athena SELECT and state sample/cohort limits.
[ ] If no operational data MCP is exposed for a funnel/conversion/bottleneck
    question, limit the answer to SSOT-derived funnel steps, instrumentation
    points, and hypotheses. Do not claim observed conversion drops or causes.
[ ] Do not treat search snippets, scores, overview text, or glossary output as
    proof.
[ ] State freshness, coverage, missing MCP surfaces, and any unresolved
    ambiguity.
```

`spec_search`를 사용했다면 선택한 모든 spec candidate를 같은 route 안에서 `spec_get`과
`spec_resolve`로 이어가야 한다. spec search hit를 complete evidence로 취급하거나
resolve를 나중의 optional step으로 미루지 않는다.

## Business Document To Source-Near Spec Descent

질문이 SOT business context에서 시작하면 BR/DD/DESIGN/UCL document와 item은 map이지
source-near proof가 아니다.

```text
business question
-> document_list/document_get/document_item_list
   [MUST] include DESIGN for product flow, capability, journey, admin workflow,
   data flow, integration, architecture, or implementation-facing questions
-> document_item_get for exact business item
-> document_resolve(itemId) to follow explicit item links and collect linked
   api_spec, screen_spec, event_spec, and schedule_spec ids when returned
-> rank linked source-near spec candidates and keep selected spec ids visible
-> spec_list/spec_search only if document_resolve returns no usable link, an
   incomplete/stale/too-broad linked set, or the exact spec id is unknown
-> when spec_search is used, select candidate specs before making claims
-> spec_get for selected api_spec/screen_spec/event_spec/schedule_spec details
-> spec_resolve to expand selected specs to related docs/items, graph seeds, and code seeds
```

`document_resolve(itemId)`는 exact business item에서 linked source-near spec으로 가는 첫
bridge다. exact item이 선택되기 전 document-wide inventory를 할 때만
`document_resolve(documentId)`를 사용한다. `spec_resolve`는 business doc에서 spec으로
가는 첫 bridge가 아니다. spec을 선택한 뒤 reverse anchor, related item/document,
source seed expansion을 모으는 데 사용한다.

Business document item은 routing evidence다. exact API, screen, event, schedule
behavior에는 detail을 열기 전에 connected `api_spec`, `screen_spec`, `event_spec`,
`schedule_spec` candidate를 rank한다. direct document/spec link, same epic,
same entity/field, same route/screen/API/event/schedule target, same branch intent가
우선순위가 높다.

항상 explicit link를 먼저 사용한다. `document_resolve(itemId)`는 traced business-doc
item context를 linked spec/item으로 따라가는 MCP equivalent이며, exact business
evidence에서 source-near evidence로 가는 첫 bridge다. 선택한 DESIGN/BR/DD/UCL document
또는 item이 충분한 linked source-near spec을 반환하지 않거나 stale/too-broad candidate를
반환하면, document에서 발견한 business term, route/screen name, table/model name,
status name, API/action name으로 `spec_search`를 사용해 넓힌다. source-near claim 전에는
선택한 spec에 `spec_get`과 `spec_resolve`를 읽는다. 모든 connected spec을 처음부터 열지
말고, 먼저 rank한 뒤 가장 강한 candidate를 읽는다.

Memory overlay는 overview, epic, document, item, spec에 attached된
correction/constraint/why/context note다. 각 selected surface에서 attached memory card를
확인한다: `project_overview_get.overview.memories`, `epic_get.memories`,
`document_get.memories`, item memories, spec memories. broad document read는 summary를
반환할 수 있다. overlay가 answer boundary를 바꿀 수 있으면 `memory_get`을 사용한다.
memory를 generated SOT 또는 source proof로 취급하지 않는다.

## Retrieval Order

```text
project context
-> context status
-> capability check
-> Search Clarification Gate when triggers fire
-> project overview with attached overview memories when present
-> glossary_list for broad inventory, comparison, ambiguity, all-alias requests, or blank/conflicting translation; traverse every page when completeness is required
-> glossary_translate for the raw phrase and Korean/English candidates; record matched terms and alias candidates
-> candidate epic
-> candidate BR/DD/DESIGN/UCL document map
-> question branch
-> relevant business document items or exact source-near anchor
-> connected api_spec/screen_spec/event_spec/schedule_spec evidence through
   document_resolve(itemId) after exact item reads, with spec_search fallback
   only when explicit links are absent, incomplete, stale, too broad, or unresolved
-> exact spec evidence
-> spec_resolve for connected context and graph/code seeds
-> source-level confirmation only when required
-> Final Route Audit
-> answer with boundary
```

## Final Route Audit

broad, ambiguous, Korean/English, comparison, inventory, impact, mixed
business-vs-implementation question에서 confident answer를 하기 전에 다음이 모두 참이어야
한다.

1. Search Brief가 있고 raw user phrase를 보존했다.
2. Korean/English vocabulary가 맞물리지 않을 수 있으면 raw terms, Korean candidate terms,
   English candidate terms가 모두 visible하다.
3. Glossary/vocabulary output은 routing에만 사용했고 behavior proof로 쓰지 않았다.
4. final scope를 고르기 전에 project overview, present한 attached overview memories,
   epic map을 읽었다.
5. search miss, snippet, weak score 하나로 relevant candidate EPIC을 버리지 않았다.
6. 선택한 branch에 대해 candidate BR/DD/DESIGN/UCL document map을 만들었다.
7. selected overview, epic, document, item, spec의 relevant attached memory overlay를
   확인했고 generated SOT/source evidence와 분리했다.
8. business, data, design, capability claim 전에 exact document item을 읽었다.
9. selected document가 item summary를 노출하지만 `document_item_list`가 empty이면,
   document body에서 exact BR/DD/DESIGN/UCL evidence를 주장하지 않고 item-tier coverage
   gap을 보고하거나 narrowing filter 없이 retry했다.
10. exact BR/DD/DESIGN/UCL item을 읽었다면 source-near search 전에
    `document_resolve(itemId)`를 실행했거나, answer가 explicitly conceptual로 남아 있다.
11. source-near spec을 따라가기 전에 connected context를 resolve했다.
12. business doc에서 시작했다면 exact source-near spec read 전에 linked `api_spec`,
    `screen_spec`, `event_spec`, `schedule_spec` candidate를 rank했고 selected candidate의
    spec id를 visible하게 유지했다. `spec_search` fallback은 `document_resolve`가 usable
    link를 반환하지 않거나, incomplete/stale/too-broad link를 반환하거나, exact spec id가
    없을 때만 사용했다.
13. source-near behavior claim 전에 exact spec을 읽었다.
14. selected spec read 뒤 related docs/items, graph seeds, code seeds, reverse anchor를
    노출하기 위해 `spec_resolve`를 실행했다.
15. exact source claim에는 필요한 `code_search` 뒤 MCP `readonly_workspace_shell`로 bounded
    exact source region을 읽었다. code search hit만 사용하지 않았다.
16. "not present", "not independent", "not used", "no impact" 같은 negative claim은
    Evidence Gates가 요구하는 evidence tier를 갖는다.
17. 읽지 않았지만 plausible한 surface를 coverage limit 또는 next MCP read로 명명했다.
18. final answer가 direct evidence, inference, memory overlay, freshness, missing MCP
    surfaces를 분리한다.
