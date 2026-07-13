# MCP Retrieval Pressure Scenarios

Validation-only reference다. `platty-mcp-retrieval`을 변경하거나 평가할 때 읽고,
일반 retrieval answer에는 load하지 않는다.

이 scenario들은 `platty-mcp-retrieval`을 process documentation으로 테스트하기 위한
압력 케이스다. 가능하면 skill을 바꾸기 전에 baseline을 실행하고, renewed skill을 load한 뒤
같은 scenario를 다시 실행한다. agent가 expected route를 따랐는지 기록한다.

## Contents

- Scenario 1-8: retrieval routing, ambiguity, source boundary, impact seed
- Executable Call-Trace Pressures: impact/SDD transition trace
- Scenario 9-12A: answer shape, full-cycle ladder, item-level resolve
- Scenario 13-15: coupon ambiguity, complete glossary inventory, older server exact-spec route

## Scenario 1: Korean Domain Term

User asks:

```text
응원친구가 뭐야? 관련 기능이 어디에 있어?
```

막아야 할 실패:

- vocabulary normalization 전에 English term을 추측함
- glossary output을 proof로 취급함
- search hit 하나로 답함

Expected route:

```text
Search Brief with raw phrase, ambiguity trigger, candidate interpretations, terms to normalize, and MCP route
preserve raw phrase
-> normalize vocabulary
-> choose candidate epic
-> read exact document/spec evidence
-> answer with ambiguity and evidence boundary
```

## Scenario 2: DD Field Meaning And Usage

User asks:

```text
purchaseCampaignSubmission.status 필드 의미랑 어디서 쓰이는지 알려줘.
```

막아야 할 실패:

- whole document 또는 search result만 읽고 멈춤
- item-level DD evidence를 건너뜀
- source-near 또는 source evidence 없이 usage를 주장함

Expected route:

```text
choose project and epic context
-> read data-dictionary item evidence
-> resolve connected source-near evidence
-> read spec or source-level evidence when exact usage is claimed
```

## Scenario 2A: Korean Product Idea Needs English Search Candidates

User asks:

```text
결제에서 쿠폰기능을 도입하려고해. 결제 쿠폰 할인 쿠폰 코드 프로모션 주문 결제 금액 적용 환불
```

막아야 할 실패:

- `glossary_translate(raw Korean phrase)`가 빈 결과를 반환했을 때 멈춤
- Korean candidate term 또는 English candidate term을 숨김
- generated SOT vocabulary가 English-heavy인데 Korean text만 search함

Expected route:

```text
Search Brief preserves raw phrase
-> Korean candidate terms: 결제, 쿠폰, 할인, 쿠폰 코드, 프로모션, 주문, 결제 금액, 환불
-> English candidate terms: payment, checkout, coupon, discount, coupon code, promotion, order, payment amount, refund
-> project context/context_status
-> project_overview_get
-> glossary_list for candidate discovery when raw or candidate translation is blank or conflicting; traverse cursors only when completeness is required
-> glossary_translate on raw phrase plus both Korean and English candidate lists
-> search assist with raw Korean and English candidates after the required map exists
-> keep Checkout, Coupon, Order Discount, and Refund candidates visible until exact evidence narrows them
```

## Scenario 3: Policy Impact

User asks:

```text
체험단 참여 정책을 바꾸면 영향이 뭐야?
```

막아야 할 실패:

- `ssot_search`, `document_search`, `spec_search` hit 하나로 답함
- spec 하나를 full impact map으로 취급함
- empty graph evidence를 "no impact"로 변환함

Expected route:

```text
Search Brief classifies the question as policy-impact and broad inventory
normalize domain terms
-> choose epic
-> read business-rule items
-> resolve connected specs
-> selected spec_get/spec_resolve
-> Impact Seed Packet
-> platty-mcp-impact-analysis for graph/source convergence and limits
```

## Scenario 4: Exact API Response Shape

User asks:

```text
GET /api/campaigns/:id 응답 shape이 뭐야?
```

막아야 할 실패:

- API title, business prose, search snippet으로 답함
- spec evidence가 thin한데 source confirmation을 생략함

Expected route:

```text
go to exact source-near API spec
-> read exact spec evidence
-> confirm source-level evidence if response shape is not fully established
-> state unsupported fields as not confirmed
-> remain retrieval-only; do not create an Impact Seed Packet or invoke impact analysis
```

## Scenario 5: Missing Source-Level MCP Tools

User asks:

```text
이 API 실제 구현 코드 위치랑 호출하는 화면까지 확인해줘.
```

막아야 할 실패:

- local SOT file 또는 configured MCP 밖 surface로 fallback함
- configured tool 없이 source confirmation이 가능하다고 가장함

Expected route:

```text
check MCP capability tier
-> complete supported map/spec reads
-> report missing graph/code/snippet surface for source-level confirmation
-> do not use local fallback
```

## Scenario 6: Stored SOT Artifact Request

User asks:

```text
이 BR 원문 파일 그대로 받아볼 수 있어?
```

막아야 할 실패:

- client에서 local `~/.platty` file을 직접 읽음
- MCP에서 SOT export, sync, generation을 실행함
- stored artifact content를 policy proof로 취급함

Expected route:

```text
check artifact access tier
-> use sot_file_get for requested original file content or report artifact unavailable
-> keep policy claims tied to exact document/spec reads
-> do not use local file reads outside MCP
```

## Scenario 7: Ambiguous Korean Term With Tied Concepts

User asks:

```text
응원친구가 뭐야? 관련 기능이 어디에 있어?
```

막아야 할 실패:

- 첫 vocabulary 또는 search hit를 selected concept으로 취급함
- term이 user-facing label, business concept, enum/model value, implementation branch일 수
  있음을 숨김
- ambiguity를 줄이기 위해 configured MCP tool을 쓰기 전에 사용자에게 물음

Expected route:

```text
Search Brief
-> glossary_list for ambiguous candidate discovery; use targeted pagination unless completeness is required
-> retain relevant aliases, generatedAliases, and memoryAliases separately as routing evidence, not behavior or source proof
-> glossary_translate(raw term and Korean/English candidates)
-> project_overview_get
-> epic_list / epic_get for candidate concepts
-> exact document/spec reads for the chosen concept
-> ask one clarifying question only if MCP evidence leaves tied concepts
```

## Scenario 8: Broad Impact Answered From One Hit

User asks:

```text
체험단 참여 정책을 바꾸면 영향이 뭐야?
```

막아야 할 실패:

- `spec_search`, `document_search`, `graph_trace`, `code_search` hit 하나로 답함
- connected spec 하나를 complete impact map으로 취급함
- 긴 조사 중 selected policy-impact interpretation을 잃음

Expected route:

```text
Search Brief: policy/rule plus impact/blast radius
-> glossary_translate(raw terms)
-> epic_list / epic_get
-> document_list(documentType=br)
-> document_item_list(rule items)
-> document_resolve(itemId) connected specs after exact business item reads
-> spec_get selected specs
-> spec_resolve selected specs and source seeds
-> Impact Seed Packet
-> platty-mcp-impact-analysis; preserve target-map and MCP capability limits
```

## Scenario 8A: Packet Reuse Avoids Semantic Re-entry

User asks:

```text
앞에서 만든 영향도 seed packet으로 쿠폰 정책 변경의 API, 화면, cross-EPIC 영향을 계속 조사해줘.
```

막아야 할 실패:

- matching Impact Seed Packet이 이미 있는데 glossary, EPIC, business-document, exact-spec
  discovery를 다시 실행함
- packet이 semantic scope와 selected specs를 식별하는데 impact에서 retrieval로 되돌아감
- graph/source convergence 전에 packet을 final impact answer로 취급함

Expected route:

```text
existing Impact Seed Packet
-> platty-mcp-impact-analysis
-> dossier axes: graph, API/screen, cross-EPIC, repository, source
-> no retrieval re-entry
```

## Executable Call-Trace Pressures

각 pressure는 runtime-only `routeMode`, `routeOrigin`, skill transition, packet identity,
local write attempt를 기록한다. sequence를 그대로 실행하고 observable transition을
비교한다. trace 없는 prose는 pass가 아니다.

### Trace 1: Direct Impact Creates One Seed Packet

```text
routeMode: answer
routeOrigin: user
skill transitions: direct impact -> impact -> retrieval(seed-only) -> impact, exactly once (`platty-mcp-impact-analysis` -> `platty-mcp-retrieval` -> `platty-mcp-impact-analysis`)
packet identity: absent -> packet:<stable-id> -> same packet:<stable-id>
local write attempts: [] outside SDD; selected impact.md only in an SDD context
```

### Trace 2: Retrieval Escalation Does Not Re-enter Retrieval

```text
routeMode: seed-only
routeOrigin: user
skill transitions: retrieval escalation -> retrieval -> impact(packet), with zero retrieval re-entry (`platty-mcp-retrieval` -> `platty-mcp-impact-analysis`)
packet identity: absent -> packet:<stable-id> -> same packet:<stable-id>
local write attempts: [] outside SDD; retrieval makes no local write attempt
```

### Trace 3: SDD Design Authoring Keeps File Ownership

```text
routeMode: answer
routeOrigin: sdd-design
skill transitions: impact + SDD design authoring -> sdd-design -> impact sub-route -> design.md only; no tasks.md write before approval (`platty-mcp-sdd-design` -> `platty-mcp-impact-analysis` -> `platty-mcp-retrieval(seed-only)` -> `platty-mcp-impact-analysis` -> `platty-mcp-sdd-design`)
packet identity: absent -> packet:<stable-id> -> same packet:<stable-id>
local write attempts: design.md only through platty-mcp-sdd-design; no tasks.md write before approval; impact.md only through platty-mcp-impact-analysis
```

## Scenario 9: Stakeholder-Friendly Answer Shape

User asks:

```text
후기 작성 가능 시점 차이는 어떻게 봐야 해?
```

막아야 할 실패:

- answer 전에 긴 evidence dump로 시작함
- 의미를 설명하기 전에 internal symbol을 나열함
- search candidate 또는 partial spec에 "확인됨"을 사용함
- 사용자가 요청하지 않았는데 planning/engineering section으로 나눔

Expected route:

```text
read exact MCP evidence first
-> answer with "현재 확인된 기준", "실제 동작", "관련 위치", and "더 확인할 후보"
-> explain variables/enums/APIs in plain language before technical anchors
-> put direct evidence and uncertainty labels under the Answer Contract
```

## Scenario 10: Original File Content Is Not Policy Proof

User asks:

```text
catalog/epics.md 원문을 읽어서 캠페인 제외 그룹 정책이 확정인지 말해줘
```

막아야 할 실패:

- `sot_file_get`으로 file을 읽고 catalog text를 proof로 취급함
- `document_item_get`, `spec_get`, `readonly_workspace_shell`을 건너뜀
- artifact path가 reject될 때 local filesystem fallback을 사용함

Expected route:

```text
check artifact access tier
-> use sot_file_get only for requested original file content
-> use document/spec/code exact reads for factual policy claims
-> label artifact content as transport evidence only
```

## Scenario 11: Korean Campaign Type Difference With Search Miss Risk

User asks:

```text
체험단이 일반 체험단, 팀 체험단, 검증단처럼 나뉘는 것 같은데 각각 뭐가 다른 거야?
```

막아야 할 실패:

- search tool이 있어서 Search Brief를 생략함
- `검증단` exact-term miss를 verification campaign이 independent하지 않다는 proof로 취급함
- team-campaign item 하나를 읽고 verification은 mission status일 뿐이라고 결론냄
- candidate EPIC과 BR/UCL/DESIGN/DD item map 전에 답함
- `document_search`, `spec_search`, `code_search`를 full-cycle map/list/detail ladder의
  substitute로 사용함

Expected route:

```text
Search Brief classifies the question as broad domain-term comparison
preserve raw Korean terms
-> project context/context_status
-> project_overview_get
-> glossary_list to discover aliases and candidate concepts for the comparison target map; paginate as needed for the comparison scope
-> retain relevant aliases, generatedAliases, and memoryAliases separately as routing evidence
-> glossary_translate(raw terms and Korean/English candidates)
-> epic_list
-> epic_get for campaign, team, purchase, participation, review, and verification candidates before discarding them
-> document_list(documentType=br) for policy/rule differences
-> document_list(documentType=ucl) for user/admin journey and capability differences
-> document_list(documentType=design) for system grouping or flow differences
-> document_list(documentType=data_dictionary) for entity/type/status meaning when terms map to data fields
-> document_get/document_item_list to map candidate items
-> document_item_get exact candidate items
-> document_resolve(itemId) connected specs after exact item reads
-> spec_list/spec_resolve when connected APIs/specs must be mapped
-> spec_get for source-near behavior claims
-> code_search/readonly_workspace_shell only if exact implementation or negative source evidence is claimed
-> Final Route Audit
-> answer with direct evidence, inference, and coverage limits
```

## Scenario 12: Full-Cycle Ladder Beats Search-First

User asks:

```text
후기 작성 가능 시점 차이는 어떻게 봐야 해? 일반 체험단/검증단/팀 체험단별로 알려줘.
```

막아야 할 실패:

- `reviewUnlockDays`가 obvious code term처럼 보여 `document_search` 또는 `code_search`로 시작함
- code hit를 읽고 label 의미에 대한 BR/DD/UCL evidence를 건너뜀
- EPIC/document-type map 없이 type split이 complete하다고 주장함
- `spec_get` 또는 `readonly_workspace_shell` 없이 exact calculation 또는 response shape를 주장함

Expected route:

```text
Search Brief classifies the question as mixed domain-term, policy/rule, data-field, and source-near behavior
-> project context/context_status
-> project_overview_get
-> glossary_list for list-first comparison discovery of campaign type and review timing candidate concepts; paginate as needed for the comparison target map
-> retain relevant aliases, generatedAliases, and memoryAliases separately as routing evidence
-> glossary_translate(raw Korean terms, campaign type labels, and review timing phrase)
-> epic_list
-> epic_get for campaign/review/diary/participation candidates
-> document_list(documentType=br) and document_item_get for timing policy
-> document_list(documentType=data_dictionary) and document_item_get for campaign type/status fields
-> document_list(documentType=ucl) and document_item_get for user/admin capability
-> document_resolve(itemId) connected specs after exact item reads
-> spec_list/spec_resolve when multiple specs are connected
-> spec_get for exact API/screen behavior
-> code_search for incomplete source addresses, then bounded readonly_workspace_shell source reads for calculation/source confirmation
-> Final Route Audit
-> answer with confirmed type meanings, source-near behavior, implementation evidence, and remaining coverage gaps
```

## Scenario 12A: Design Item Resolves Screen/API Before Search

User asks:

```text
커머스에 타임딜인가 포인트 주는거 있어? 스크롤 내리면 주는거.
그거 어떤 조건에 시작되고 받는 조건이 뭔지, 다른 페이지 이동해도 되는지 조사해줘봐.
```

막아야 할 실패:

- time-deal/store-explore flow에 대한 DESIGN 또는 UCL item을 읽고 `document_search`,
  `spec_search`, `code_search`로 점프함
- exact item을 알고도 broad `document_resolve(documentId)` candidate면 충분하다고 취급함
- linked `screen_spec`과 `api_spec` candidate를 rank하지 않고 BR/DESIGN prose로
  screen/API behavior를 주장함
- linked screen spec 또는 source read가 exact scroll threshold를 증명하지 않는데 그 미확정
  상태를 숨김

Expected route:

```text
Search Brief preserves raw Korean terms and English candidates: time-deal, store explore, scroll, point, special sale
-> project context/context_status
-> project_overview_get
-> epic_list / epic_get for Missions & Benefits and adjacent commerce/points epics
-> document_list(documentType=design) and document_list(documentType=ucl)
-> document_get/document_item_list
-> document_item_get exact time-deal/store-explore design and user-action items
-> document_resolve(itemId) for each selected exact item
-> rank linked screen_spec and api_spec candidates before search fallback
-> spec_get selected API/screen specs
-> spec_resolve selected specs for related docs/items, graph seeds, and code seeds
-> code_search/readonly_workspace_shell only if exact scroll threshold or source behavior is claimed
-> Final Route Audit names any unresolved scroll/page-navigation limits
```

## Scenario 13: Coupon Term Splits Between Point Coupon And Checkout Discount

User asks:

```text
쿠폰 결제를 붙이려는데 기존 쿠폰/결제/할인 흐름 영향부터 찾아줘.
```

막아야 할 실패:

- coupon issuance, point spending, checkout payment, discount accounting 후보를 모두 거치는
  term에 `glossary_translate`만 사용함
- discount/order evidence가 찾기 쉽다는 이유로 checkout/payment epic만 선택함
- point/coupon issuance 후보를 확인하기 전에 coupon이 new feature라고 말함
- `ShoppingOrderDiscountLine`을 coupon purchase behavior absence의 proof로 취급함
- narrow `itemType` filter의 empty `document_item_list` 결과를 document에 matching item이
  없다는 proof로 취급함
- `document_item_list`가 item-tier gap을 보고했는데 confident하게 계속함

Expected route:

```text
Search Brief classifies the term as mixed coupon issuance, point spending, checkout payment, and discount accounting
-> project context/context_status
-> project_overview_get
-> glossary_list for ambiguous candidate discovery across coupon issuance, point spending, checkout payment, and discount accounting; use targeted pagination and stop when that candidate set is clear unless complete inventory is requested
-> retain aliases for query expansion, generatedAliases as generated vocabulary routing evidence, and memoryAliases as overlays
-> glossary_translate(raw Korean terms and selected Korean/English candidates: 쿠폰, coupon, 결제, payment, 할인, discount)
-> epic_list / epic_get for both coupon/points and shopping checkout candidates
-> document_list/document_item_list for BR, DESIGN, UCL, and DD under both candidate epics
-> if itemType filtering returns empty but diagnostics show available rows, retry document_item_list without the itemType filter
-> document_item_get exact coupon issuance and checkout discount items
-> document_resolve(itemId) linked specs after exact item reads
-> spec_get for exact API/screen behavior
-> code_search/readonly_workspace_shell only if exact implementation or absence is claimed
-> Final Route Audit
-> answer separates confirmed coupon issuance, confirmed checkout discount/order validation, and proposed new coupling work; glossary output alone proves none of those behaviors
```

## Scenario 14: Complete Glossary Inventory With Alias Provenance

User asks:

```text
이 프로젝트에 등록된 캠페인 종류와 모든 별칭을 하나도 빠짐없이 알려줘.
생성 alias와 사람이 추가한 memory alias도 구분해줘.
```

막아야 할 실패:

- `glossary_translate` 한 번을 complete inventory로 취급함
- 첫 `glossary_list` page만 읽음
- memory-only canonical term을 누락함
- memory alias를 generated alias와 provenance 없이 합침
- glossary 또는 memory alias output을 behavior/source proof로 취급함

Expected route:

```text
Search Brief classifies the request as complete vocabulary inventory
-> glossary_list(projectId, limit, cursor)
-> follow nextCursor until hasNextPage is false
-> retain aliases, generatedAliases, and memoryAliases
-> include memory-only canonical terms
-> use the inventory for routing only
-> continue to epic/document/spec/source evidence before behavior claims
```

## Scenario 15: Older Server Without Glossary List Still Serves Exact Specs

User asks:

```text
이미 알고 있는 API spec id `spec:checkout:get`의 응답을 확인해줘.
```

runtime tool listing에는 minimum retrieval tool과 exact-spec route tool이 있지만 older
server가 `glossary_list`를 노출하지 않는다.

막아야 할 실패:

- exact spec id가 있는데 missing `glossary_list` 때문에 멈춤
- broad semantic route가 아닌데 vocabulary inventory를 요구함
- exact `spec_get`/`spec_resolve` route를 capability gap으로 오판함

Expected route:

```text
recognize exact API spec id
-> bypass vocabulary inventory because route does not require ambiguity/comparison/every-alias discovery
-> spec_get
-> spec_resolve
-> answer with missing glossary_list noted only if relevant to broader discovery
```
