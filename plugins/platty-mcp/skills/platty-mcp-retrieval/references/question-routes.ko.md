# MCP Question Routes

`platty-mcp-retrieval`이 branch를 선택한 뒤 이 reference를 사용한다. 이 문서는
`full-cycle-retrieval.md`의 canonical ladder에 branch-specific document family,
requirement, completion check를 더한다. ladder를 복제하거나 대체하지 않는다.

Tool name은 `../../using-platty-mcp/references/tool-mapping.md`의 intent를 가리킨다.

## Contents

- Routing Precedence
- Concept Or Domain Term
- Policy, Rule, Permission, Eligibility
- Data Entity Or Field
- System Design Or Integration
- Capability, Journey, User Action
- Exact API, Screen, Event, Schedule
- Impact Or Blast Radius
- Code Location Or Source Absence
- Mixed Questions

Search Clarification Gate가 발동하면 Search Brief를 선택한 branch로 가져간다. branch
route는 `Question branch`, `Candidate MCP route`, `User decision needed`를 다듬을 수
있지만, raw question과 gate를 발동시킨 ambiguity trigger는 보존해야 한다.

semantic answer를 확정하기 전에 선택한 `project_overview_get.overview.memories`,
`epic_get.memories`, `document_get.memories` result에 attached memory를 읽는다. broad
document read는 full body 대신 summary card를 노출할 수 있다. memory overlay가 answer
boundary에 영향을 줄 수 있으면 `memory_get`을 사용한다. memory는 SOT/spec/source proof와
분리한다.

BR, DD, DESIGN, UCL 같은 document family name은 이 guide의 semantic label이다.
`document_list.documentType`에 전달할 때는 live tool schema가 다르게 말하지 않는 한
MCP filter value(`br`, `data_dictionary`, `design`, `ucl`)를 사용한다. DD는 `dd`가
아니라 `data_dictionary`다.

## Routing Precedence

SDD file authoring intent는 request/story creation을 `platty-mcp-sdd-spec`으로,
design/task creation을 `platty-mcp-sdd-design`으로 route한다. 이 intent는 generic impact
또는 design-change wording보다 우선한다. owning SDD skill은 impact를 sub-route로 호출할
수 있지만, retrieval은 file-authoring owner를 우회하면 안 된다.

일반 exact API, screen, event, schedule, source-near question은 retrieval-only에 남긴다.
질문이 what changes, what breaks, affected surface, blast radius, cross-EPIC effect,
design-change impact를 묻지 않는 한 impact analysis를 호출하지 않는다.

## Concept Or Domain Term

Full-Cycle Retrieval Ladder를 사용한다. concept이 요구하는 경우에만 BR/DD/DESIGN/UCL을
포함하고, source-near behavior를 주장할 때만 connected specs로 내려간다.

Completion:

- raw user phrase를 보존한다.
- normalized term을 사용했다면 밝힌다.
- normalized candidate가 다른 concept을 가리키면 ambiguity를 드러낸다.
- term이 user-facing label, business concept, enum/model value, implementation branch일 수
  있으면 답하기 전에 split을 이름 붙이고 selected interpretation을 Search Brief에
  유지한다.
- normalized concept이 absent 또는 not independent라고 말하기 전에 Final Route Audit를
  실행한다.
- raw term이 Korean이고 likely system term이 English라면 answer boundary에 두 term을 모두
  유지한다.

## Policy, Rule, Permission, Eligibility

Full-Cycle Retrieval Ladder를 사용한다. Required document family: policy/rule/eligibility
map에는 BR. rule이 system flow, data shape, user journey에 의존하면 DESIGN/DD/UCL을
포함한다. Enforcement claim에는 connected spec evidence가 필요하고, exact permission,
validation, write, emit, absence claim에는 노출된 경우 source-level confirmation이
필요하다.

Completion:

- rule item을 식별한다.
- documented intent와 confirmed enforcement를 구분한다.
- permission, validation, response shape, DB write, event emit behavior를 주장하기 전에
  connected spec 또는 source-level evidence를 읽는다.
- enforcement, permission, eligibility, negative claim 전에는 Final Route Audit를 실행한다.
- vocabulary routing이 branch를 바꿨다면 raw term, normalized term, selected
  interpretation을 보존한다.
- 버린 interpretation이 answer boundary를 바꾼다면 discarded interpretation을 보존한다.
- 읽지 않았지만 relevant한 policy, rule, spec, source surface를 coverage limit 또는 next
  MCP read로 보존한다.
- "not allowed", "not eligible", "not enforced" 같은 claim은 search miss가 아니라 exact
  item/spec/source evidence에서 negative boundary를 확인한다.

## Data Entity Or Field

Full-Cycle Retrieval Ladder를 사용한다. Required document family:
entity/table/field meaning에는 `data_dictionary`. API/screen/source-near usage를 주장할
때만 connected spec을 포함한다.

Completion:

- 읽은 entity 또는 field item을 이름 붙인다.
- usage가 documented, source-near, source-confirmed 중 무엇인지 밝힌다.
- whole-document search hit를 field-level proof로 취급하지 않는다.
- exact API 또는 screen usage에는 detail을 열기 전에 connected `api_spec`과
  `screen_spec` candidate를 rank한다. direct document/spec link, same entity, same field,
  same route/screen/API target, same branch intent가 우선순위가 높다.

## System Design Or Integration

Full-Cycle Retrieval Ladder를 사용한다. Required document family: DESIGN. selected design
item에는 search 전에 `document_resolve(itemId)`를 사용하고, exact spec read 전에 linked
API/screen/event/schedule candidate를 rank한다.

Completion:

- design item 또는 connection read를 밝힌다.
- design item이 선택되었다면 `document_resolve(documentId)` 또는 search보다 item-level
  `document_resolve`를 선호한다.
- exact implementation을 주장하기 전에 connected source-near evidence를 resolve한다.

## Capability, Journey, User Action

Full-Cycle Retrieval Ladder를 사용한다. Required document families: user action/journey에는
UCL. 질문이 product flow, screen behavior, admin workflow, data flow, integration,
architecture, implementation-facing behavior를 묻는다면 DESIGN이 필수다. selected
DESIGN/UCL item에는 source-near search 전에 `document_resolve(itemId)`를 사용한다.

Completion:

- 질문이 product flow, capability, journey, screen, admin workflow,
  implementation-facing behavior를 묻는다면 UCL 전에 DESIGN을 product/system map으로
  포함한다.
- selected design/UCL item에서 screen/API spec으로 가는 첫 bridge로
  `document_resolve(itemId)`를 사용한다. linked context가 absent, incomplete, stale,
  too broad이거나 exact spec id를 알 수 없을 때만 `spec_search`를 사용한다.
- user action 또는 capability item을 식별한다.
- journey evidence와 implementation evidence를 분리한다.
- exact API 또는 screen behavior에는 detail을 열기 전에 connected `api_spec`과
  `screen_spec` candidate를 rank하고, source-near claim 전에 exact spec을 읽는다.
- "difference between A/B/C" 질문은 relevant EPIC/document map이 세워질 때까지 inventory로
  취급한다.
- adjacent candidate EPIC이 unresolved인 상태에서 첫 matching UCL item만으로 답하지 않는다.

## Exact API, Screen, Event, Schedule

Full-Cycle Retrieval Ladder의 exact source-near branch를 사용한다. exact spec id를 알고
있으면 `spec_get`에서 시작한다. exact spec id를 모를 때만 `spec_list/spec_search`를
사용한다. 선택한 spec 뒤에는 `spec_resolve`를 실행한다.

Completion:

- exact spec을 읽는다.
- unsupported field는 not confirmed로 표시한다.
- spec이 thin하거나 contradicted면 source-level evidence를 사용한다.

## Impact Or Blast Radius

먼저 Full-Cycle Retrieval Ladder로 semantic target을 map한다. 그 뒤 connected spec을
resolve하고 selected source-near spec을 읽고 `spec_resolve`를 실행한 다음,
`platty-mcp-impact-analysis`용 Impact Seed Packet을 만든다.

Completion:

- broad inventory question에 답하기 전에 target map을 만든다.
- broad impact에는 graph/source evidence를 읽기 전에 Search Brief에
  `Question branch: impact/blast radius`와 expected map source를 기록한다.
- packet은 `platty-mcp-impact-analysis`에 넘긴다. graph, cross-EPIC, repository, source
  convergence는 그 skill이 소유한다.
- 기존 packet이 있으면 semantic discovery로 돌아가지 말고 재사용한다.
- empty graph evidence를 "no impact"로 바꾸지 않는다.

## Code Location Or Source Absence

Full-Cycle Retrieval Ladder의 source-near branch를 사용한다. known spec id가 있으면
선호한다. 그렇지 않으면 semantic route가 target scope를 확정한 뒤에만 code search를
사용한다.

Completion:

- repo, file, line scope를 밝힌다.
- 검색한 exact term을 밝힌다.
- source absence 또는 negative location claim 전에는 Final Route Audit를 실행한다.
- searched scope 밖의 absence를 주장하지 않는다.
- business term을 code term으로 번역했다면 searched scope, exact term, selected
  interpretation, discarded interpretation을 보존한다.
- search miss를 absence boundary로 바꾸기 전에 unread-but-relevant MCP surface와 missing MCP
  surface를 보존한다.
- exact code absence, lack of writes/emits/calls, permission/validation path not present를
  주장할 때는 source-level confirmation을 요구한다.
- 질문이 source-location request와 business term을 섞으면 Search Brief에 두 route를 모두
  visible하게 유지한다: semantic route first, source-near confirmation second.

## Mixed Questions

필요하다면 Full-Cycle Retrieval Ladder를 두 번 사용한다. 먼저 semantic branch로
vocabulary, EPIC, document scope를 잡고, 두 번째로 source-near branch에서 exact spec,
graph, code, snippet confirmation을 한다.

Completion:

- 답하기 전에 business meaning과 implementation fact를 분리한다.
- 사용자에게 묻기 전에 MCP evidence로 branch order를 선택한다.
- MCP evidence가 tied interpretation을 남기고 하나를 선택하면 다른 해석이 숨겨질 때만
  clarifying question 하나를 묻는다.
- 두 branch 전체에서 raw term, normalized term, unread-but-relevant surface를 보존한다.
- route를 바꾸는 경우 answer에 selected interpretation을 밝힌다.
- discarded interpretation이 없으면 source 또는 semantic branch가 complete해 보일 때는
  discarded interpretation을 밝힌다.
- semantic branch 뒤, source-near claim 전에는 Final Route Audit를 실행한다.
- audit에서 missing semantic candidate가 발견되면 더 많은 code/search hit를 읽기 전에 map으로
  돌아간다.
