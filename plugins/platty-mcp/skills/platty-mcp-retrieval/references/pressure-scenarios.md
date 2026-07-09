# MCP Retrieval Pressure Scenarios

Use these scenarios to test `platty-mcp-retrieval` as process documentation.
Run a baseline before changing the skill when feasible, then run the same
scenario with the renewed skill loaded. Record whether the agent followed the
expected route.

## Scenario 1: Korean Domain Term

User asks:

```text
응원친구가 뭐야? 관련 기능이 어디에 있어?
```

Failure to prevent:

- guessing an English term before vocabulary normalization;
- treating glossary output as proof;
- answering from one search hit.

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

Failure to prevent:

- reading a whole document or search result and stopping;
- skipping item-level DD evidence;
- claiming usage without source-near or source evidence.

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

Failure to prevent:

- stopping after `glossary_translate(raw Korean phrase)` returns no terms;
- hiding the Korean candidate terms or English candidate terms;
- searching only Korean text when the generated SOT vocabulary is English-heavy.

Expected route:

```text
Search Brief preserves raw phrase
-> Korean candidate terms: 결제, 쿠폰, 할인, 쿠폰 코드, 프로모션, 주문, 결제 금액, 환불
-> English candidate terms: payment, checkout, coupon, discount, coupon code, promotion, order, payment amount, refund
-> glossary_translate on raw phrase plus both candidate lists
-> search assist with raw Korean and English candidates after the required map exists
-> keep Checkout, Coupon, Order Discount, and Refund candidates visible until exact evidence narrows them
```

## Scenario 3: Policy Impact

User asks:

```text
체험단 참여 정책을 바꾸면 영향이 뭐야?
```

Failure to prevent:

- answering from one `ssot_search`, `document_search`, or `spec_search` hit;
- treating one spec as the full impact map;
- converting empty graph evidence into "no impact".

Expected route:

```text
Search Brief classifies the question as policy-impact and broad inventory
normalize domain terms
-> choose epic
-> read business-rule items
-> resolve connected specs
-> use source-level evidence if exact impact is requested and tools exist
-> report graph/source limits
```

## Scenario 4: Exact API Response Shape

User asks:

```text
GET /api/campaigns/:id 응답 shape이 뭐야?
```

Failure to prevent:

- answering from API title, business prose, or search snippet;
- omitting source confirmation when spec evidence is thin.

Expected route:

```text
go to exact source-near API spec
-> read exact spec evidence
-> confirm source-level evidence if response shape is not fully established
-> state unsupported fields as not confirmed
```

## Scenario 5: Missing Source-Level MCP Tools

User asks:

```text
이 API 실제 구현 코드 위치랑 호출하는 화면까지 확인해줘.
```

Failure to prevent:

- falling back to local SOT files or surfaces outside configured MCP tools;
- pretending source confirmation is possible without configured tools.

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

Failure to prevent:

- reading local `~/.platty` files directly from the client;
- running SOT export, sync, or generation from MCP;
- treating stored artifact content as policy proof.

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

Failure to prevent:

- treating the first vocabulary or search hit as the selected concept;
- hiding that the term could be a user-facing label, business concept, enum/model
  value, or implementation branch;
- asking the user before configured MCP tools have been used to reduce the
  ambiguity.

Expected route:

```text
Search Brief
-> glossary_translate(raw term)
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

Failure to prevent:

- answering from one `spec_search`, `document_search`, `graph_trace`, or
  `code_search` hit;
- treating one connected spec as the complete impact map;
- losing the selected policy-impact interpretation during a long investigation.

Expected route:

```text
Search Brief: policy/rule plus impact/blast radius
-> glossary_translate(raw terms)
-> epic_list / epic_get
-> document_list(documentType=br)
-> document_item_list(rule items)
-> document_resolve connected specs
-> spec_get selected specs
-> graph_trace/code tools only when configured and needed
-> answer with target-map and MCP capability limits
```

## Scenario 9: Stakeholder-Friendly Answer Shape

User asks:

```text
후기 작성 가능 시점 차이는 어떻게 봐야 해?
```

Failure to prevent:

- starting with a long evidence dump before the answer;
- listing internal symbols before explaining what they mean;
- saying "확인됨" for search candidates or partial specs;
- splitting into planning/engineering sections when the user did not ask for
  that split.

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

Failure to prevent:

- reading the file with `sot_file_get` and treating catalog text as proof;
- skipping `document_item_get`, `spec_get`, or `code_snippet`;
- using local filesystem fallback when the artifact path is rejected.

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

Failure to prevent:

- skipping the Search Brief because several search tools are available;
- treating `검증단` exact-term misses as proof that verification campaigns are not
  independent;
- reading one team-campaign item and concluding that verification is only a
  mission status;
- answering before candidate EPICs and BR/UCL/DESIGN/DD items are mapped;
- using `document_search`, `spec_search`, or `code_search` as a substitute for
  the full-cycle map/list/detail ladder.

Expected route:

```text
Search Brief classifies the question as broad domain-term comparison
preserve raw Korean terms
-> glossary_translate(raw terms)
-> project_overview_get
-> epic_list
-> epic_get for campaign, team, purchase, participation, review, and verification candidates before discarding them
-> document_list(documentType=BR) for policy/rule differences
-> document_list(documentType=UCL) for user/admin journey and capability differences
-> document_list(documentType=DESIGN) for system grouping or flow differences
-> document_list(documentType=DD) for entity/type/status meaning when terms map to data fields
-> document_get/document_item_list to map candidate items
-> document_item_get exact candidate items
-> document_resolve connected specs
-> spec_list/spec_resolve when connected APIs/specs must be mapped
-> spec_get for source-near behavior claims
-> code_search/code_snippet only if exact implementation or negative source evidence is claimed
-> Final Route Audit
-> answer with direct evidence, inference, and coverage limits
```

## Scenario 12: Full-Cycle Ladder Beats Search-First

User asks:

```text
후기 작성 가능 시점 차이는 어떻게 봐야 해? 일반 체험단/검증단/팀 체험단별로 알려줘.
```

Failure to prevent:

- starting with `document_search` or `code_search` because `reviewUnlockDays`
  seems like an obvious code term;
- reading a code hit and skipping BR/DD/UCL evidence for what the labels mean;
- claiming the type split is complete without an EPIC and document-type map;
- claiming exact calculation or response shape without `spec_get` or
  `code_snippet`.

Expected route:

```text
Search Brief classifies the question as mixed domain-term, policy/rule, data-field, and source-near behavior
-> project context/context_status
-> project_overview_get
-> glossary_translate(raw Korean terms and review timing phrase)
-> epic_list
-> epic_get for campaign/review/diary/participation candidates
-> document_list(documentType=BR) and document_item_get for timing policy
-> document_list(documentType=DD) and document_item_get for campaign type/status fields
-> document_list(documentType=UCL) and document_item_get for user/admin capability
-> document_resolve connected specs
-> spec_list/spec_resolve when multiple specs are connected
-> spec_get for exact API/screen behavior
-> code_search then code_snippet for calculation/source confirmation
-> Final Route Audit
-> answer with confirmed type meanings, source-near behavior, implementation evidence, and remaining coverage gaps
```

## Scenario 13: Coupon Term Splits Between Point Coupon And Checkout Discount

User asks:

```text
쿠폰 결제를 붙이려는데 기존 쿠폰/결제/할인 흐름 영향부터 찾아줘.
```

Failure to prevent:

- choosing only the checkout/payment epic because discount/order evidence is easy to find;
- saying coupon is a new feature before checking point/coupon issuance candidates;
- treating `ShoppingOrderDiscountLine` as proof that coupon purchase behavior is absent;
- treating empty `document_item_list` results from narrow `query` or `itemType`
  filters as proof that the document has no matching item;
- continuing confidently after `document_item_list` reports an item-tier gap.

Expected route:

```text
Search Brief classifies the term as mixed coupon issuance, point spending, checkout payment, and discount accounting
-> glossary_translate(raw terms: 쿠폰, coupon, 결제, 할인)
-> project_overview_get
-> epic_list / epic_get for both coupon/points and shopping checkout candidates
-> document_list/document_item_list for BR, DESIGN, UCL, and DD under both candidate epics
-> if item query returns empty but diagnostics show available rows, retry document_item_list without the query filter
-> document_item_get exact coupon issuance and checkout discount items
-> document_resolve linked specs
-> spec_get for exact API/screen behavior
-> code_search/code_snippet only if exact implementation or absence is claimed
-> Final Route Audit
-> answer separates confirmed coupon issuance, confirmed checkout discount/order validation, and proposed new coupling work
```
