# MCP Retrieval Pressure Scenarios

Validation-only reference. Read this file when changing or evaluating
`platty-mcp-retrieval`; do not load it for ordinary retrieval answers.

Use these scenarios to test `platty-mcp-retrieval` as process documentation.
Run a baseline before changing the skill when feasible, then run the same
scenario with the renewed skill loaded. Record whether the agent followed the
expected route.

## Contents

- Scoped summary discovery: micro decisions and paired synthetic call traces
- Scenarios 1-8: retrieval routing, ambiguity, source boundaries, impact seeds
- Executable Call-Trace Pressures: impact/SDD transition traces
- Scenarios 9-12A: answer shape, full-cycle ladder, item-level resolve
- Scenarios 13-15: coupon ambiguity, complete glossary inventory, older server
  exact-spec route
- Scenario 17: managed-worktree Git history and deployment-boundary labeling
- Scenarios 18-19: complete spec inventory versus exact targeted lookup
- Scenario 20: product result already chosen while implementation alternatives remain

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
-> project context/context_status
-> project_get
-> glossary_term_list for candidate discovery when raw or candidate translation is blank or conflicting; traverse cursors only when completeness is required
-> glossary_translate on raw phrase plus both Korean and English candidate lists
-> search assist with raw Korean and English candidates after the required map exists
-> keep Checkout, Coupon, Order Discount, and Refund candidates visible until exact evidence narrows them
```

## Scenario 3: Policy Impact

User asks:

```text
체험단 참여 정책을 바꾸면 영향이 뭐야?
```

Failure to prevent:

- answering from one `<family>_search` or `spec_search` hit;
- treating one spec as the full impact map;
- converting empty graph evidence into "no impact".

Expected route:

```text
Search Brief classifies the question as policy-impact and broad inventory
normalize domain terms
-> choose epic
-> read business-rule items
-> concrete family_spec_resolve per selected itemId
-> selected spec_get and spec_impact_resolve
-> Impact Seed Packet
-> platty-mcp-impact-analysis for graph/source convergence and limits
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
-> remain retrieval-only; do not create an Impact Seed Packet or invoke impact analysis
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
-> resolve exact documentId and offer sot_render DB-rendered Markdown; report original-file access unavailable
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
-> glossary_term_list for ambiguous candidate discovery; use targeted pagination unless completeness is required
-> retain relevant aliases, generated aliases and human alias provenance separately as routing evidence, not behavior or source proof
-> glossary_translate(raw term and Korean/English candidates)
-> project_get
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

- answering from one `spec_search`, `<family>_search`, `graph_trace`, or
  `code_search` hit;
- treating one connected spec as the complete impact map;
- losing the selected policy-impact interpretation during a long investigation.

Expected route:

```text
Search Brief: policy/rule plus impact/blast radius
-> glossary_translate(raw terms)
-> epic_list / epic_get
-> business_rule_list(projectId,epicId?)
-> <family>_item_list(rule items)
-> <family>_spec_resolve(itemId) connected Specs after exact business item reads
-> spec_get selected specs
-> spec_impact_resolve selected Specs for one-hop technical edges
-> graph_trace returned typed seeds, depth=1 when another frontier hop is required
-> Impact Seed Packet
-> platty-mcp-impact-analysis; preserve target-map and MCP capability limits
```

## Scenario 8A: Packet Reuse Avoids Semantic Re-entry

User asks:

```text
앞에서 만든 영향도 seed packet으로 쿠폰 정책 변경의 API, 화면, cross-EPIC 영향을 계속 조사해줘.
```

Failure to prevent:

- rerunning glossary, EPIC, business-document, or exact-spec discovery after a
  matching Impact Seed Packet already exists;
- returning from impact to retrieval when the packet identifies its semantic
  scope and selected specs;
- treating a packet as a final impact answer before graph/source convergence.

Expected route:

```text
existing Impact Seed Packet
-> platty-mcp-impact-analysis
-> dossier axes: graph, API/screen, cross-EPIC, repository, source
-> no retrieval re-entry
```

## Executable Call-Trace Pressures

Each pressure records the runtime-only `routeMode`, `routeOrigin`, skill
transitions, packet identity, and local write attempts. Execute the sequence as
written and compare its observable transitions; prose without the trace does
not pass.

### Trace 1: Direct Impact Creates One Seed Packet

```text
routeMode: answer
routeOrigin: user
skill transitions: direct impact -> impact -> retrieval(seed-only) -> impact, exactly once (`platty-mcp-impact-analysis` -> `platty-mcp-retrieval` -> `platty-mcp-impact-analysis`)
packet identity: absent -> packet:<stable-id> -> same packet:<stable-id>
local write attempts: [] outside SDD; final §9 of selected prd.md only in an SDD context
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
skill transitions: impact + SDD design authoring -> sdd-design -> impact sub-route -> system_design.md only; no tasks.md write before approval (`platty-mcp-sdd-design` -> `platty-mcp-impact-analysis` -> `platty-mcp-retrieval(seed-only)` -> `platty-mcp-impact-analysis` -> `platty-mcp-sdd-design`)
packet identity: absent -> packet:<stable-id> -> same packet:<stable-id>
local write attempts: system_design.md only through platty-mcp-sdd-design; no tasks.md write before approval; final PRD §9 only through platty-mcp-impact-analysis
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

- reading the file with `sot_render` and treating catalog text as proof;
- skipping `<family>_item_get`, `spec_get`, or `readonly_workspace_shell`;
- using local filesystem fallback when the artifact path is rejected.

Expected route:

```text
check artifact access tier
-> report original path/file artifact access unavailable; never pass catalog/epics.md as documentId
-> resolve a returned exact documentId and offer sot_render DB-rendered Markdown as a projection
-> use exact typed business item, Spec, and bounded source reads required for factual policy claims
-> label rendered Markdown as database_rendered projection, not original-file or policy proof
-> no host-local filesystem or CLI fallback
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
- using `<family>_search`, `spec_search`, or `code_search` as a substitute for
  the full-cycle map/list/detail ladder.

Expected route:

```text
Search Brief classifies the question as broad domain-term comparison
preserve raw Korean terms
-> project context/context_status
-> project_get
-> glossary_term_list to discover aliases and candidate concepts for the comparison target map; paginate as needed for the comparison scope
-> retain relevant aliases, generated aliases and human alias provenance separately as routing evidence
-> glossary_translate(raw terms and Korean/English candidates)
-> epic_list
-> epic_get for campaign, team, purchase, participation, review, and verification candidates before discarding them
-> business_rule_list(projectId,epicId?) for policy/rule differences
-> use_case_list(projectId,epicId?) for user/admin journey and capability differences
-> design_list(projectId,epicId?) for system grouping or flow differences
-> data_dictionary_list(projectId,epicId?) for entity/type/status meaning when terms map to data fields
-> <family>_get/<family>_item_list to map candidate items
-> <family>_item_get exact candidate items
-> <family>_spec_resolve(itemId) connected Specs after exact item reads
-> spec_list(projectId, epicId, specKind?) when complete EPIC Spec inventory is needed
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

Failure to prevent:

- starting with `<family>_search` or `code_search` because `reviewUnlockDays`
  seems like an obvious code term;
- reading a code hit and skipping BR/DD/UCL evidence for what the labels mean;
- claiming the type split is complete without an EPIC and document-type map;
- claiming exact calculation or response shape without `spec_get` or
  `readonly_workspace_shell`.

Expected route:

```text
Search Brief classifies the question as mixed domain-term, policy/rule, data-field, and source-near behavior
-> project context/context_status
-> project_get
-> glossary_term_list for list-first comparison discovery of campaign type and review timing candidate concepts; paginate as needed for the comparison target map
-> retain relevant aliases, generated aliases and human alias provenance separately as routing evidence
-> glossary_translate(raw Korean terms, campaign type labels, and review timing phrase)
-> epic_list
-> epic_get for campaign/review/diary/participation candidates
-> business_rule_list(projectId,epicId?) and <family>_item_get for timing policy
-> data_dictionary_list(projectId,epicId?) and <family>_item_get for campaign type/status fields
-> use_case_list(projectId,epicId?) and <family>_item_get for user/admin capability
-> <family>_spec_resolve(itemId) connected Specs after exact item reads
-> spec_list(projectId, epicId, specKind?) when complete EPIC Spec inventory is needed
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

Failure to prevent:

- reading a DESIGN or UCL item about the time-deal/store-explore flow and then
  jumping to `<family>_search`, `spec_search`, or `code_search`;
- repeating a broad document inventory after an exact item is known instead of
  following its directional Spec links;
- making screen/API behavior claims from BR/DESIGN prose without ranking linked
  `screen_spec` and `api_spec` candidates;
- hiding that exact scroll thresholds remain unconfirmed when no linked screen
  spec or source read proves them.

Expected route:

```text
Search Brief preserves raw Korean terms and English candidates: time-deal, store explore, scroll, point, special sale
-> project context/context_status
-> project_get
-> epic_list / epic_get for Missions & Benefits and adjacent commerce/points epics
-> design_list(projectId,epicId?) and use_case_list(projectId,epicId?)
-> <family>_get/<family>_item_list
-> <family>_item_get exact time-deal/store-explore design and user-action items
-> <family>_spec_resolve(itemId) for the selected exact items, one itemId per resolver call
-> rank linked screen_spec and api_spec candidates before search fallback
-> spec_get selected API/screen specs
-> spec_business_resolve selected Specs only for reverse business context
-> spec_impact_resolve selected Specs for direct one-hop technical impact
-> graph_trace returned typed seeds, depth=1 when another frontier hop is required
-> code_search/readonly_workspace_shell only if exact scroll threshold or source behavior is claimed
-> Final Route Audit names any unresolved scroll/page-navigation limits
```

## Scenario 13: Coupon Term Splits Between Point Coupon And Checkout Discount

User asks:

```text
쿠폰 결제를 붙이려는데 기존 쿠폰/결제/할인 흐름 영향부터 찾아줘.
```

Failure to prevent:

- using `glossary_translate` alone for a term that spans coupon issuance, point
  spending, checkout payment, and discount accounting candidates;
- choosing only the checkout/payment epic because discount/order evidence is easy to find;
- saying coupon is a new feature before checking point/coupon issuance candidates;
- treating `ShoppingOrderDiscountLine` as proof that coupon purchase behavior is absent;
- treating empty scoped item-page results or malformed/readState gaps as proof that the document has no matching item;
- continuing confidently after `<family>_item_list` reports an item-tier gap.

Expected route:

```text
Search Brief classifies the term as mixed coupon issuance, point spending, checkout payment, and discount accounting
-> project context/context_status
-> project_get
-> glossary_term_list for ambiguous candidate discovery across coupon issuance, point spending, checkout payment, and discount accounting; use targeted pagination and stop when that candidate set is clear unless complete inventory is requested
-> retain aliases for query expansion, generatedAliases as generated vocabulary routing evidence, and memoryAliases as overlays
-> glossary_translate(raw Korean terms and selected Korean/English candidates: 쿠폰, coupon, 결제, payment, 할인, discount)
-> epic_list / epic_get for both coupon/points and shopping checkout candidates
-> <family>_list/<family>_item_list for BR, DESIGN, UCL, and DD under both candidate epics
-> if scoped item pages are empty or regeneration-required, retain diagnostics and coverage limits
-> <family>_item_get exact coupon issuance and checkout discount items
-> <family>_spec_resolve(itemId) linked Specs after exact item reads
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

Failure to prevent:

- calling `glossary_translate` once and treating it as a complete inventory;
- reading only the first `glossary_term_list` page;
- dropping memory-only canonical terms;
- merging memory aliases into generated aliases without provenance;
- treating glossary or memory alias output as behavior or source proof.

Expected route:

```text
Search Brief classifies the request as complete vocabulary inventory
-> glossary_term_list(projectId, limit, cursor)
-> follow nextCursor until hasNextPage is false
-> retain aliases, generated aliases and human alias provenance
-> inspect orphanAliases from glossary_alias_list; do not invent missing canonical term bodies
-> use the inventory for routing only
-> continue to epic/document/spec/source evidence before behavior claims
```

## Scenario 15: Older Server Without Glossary List Still Serves Exact Specs

User asks:

```text
이미 알고 있는 API spec id `spec:checkout:get`의 응답을 확인해줘.
```

Runtime tool listing contains the minimum retrieval tools and the exact-spec
route tools, but the older server does not expose `glossary_term_list`.

Failure to prevent:

- failing the unconditional capability gate only because `glossary_term_list` is
  absent;
- inventing a glossary inventory call for an unrelated exact spec id;
- weakening the stop condition if the user later asks for a complete vocabulary
  inventory, comparison, ambiguity resolution, every alias, or blank/conflict
  candidate discovery.

Expected route:

```text
capability gate classifies glossary_term_list as conditional and confirms the exact-spec route tools are present
-> project context/context_status
-> spec_get(projectId, documentId=spec:checkout:get)
-> spec_business_resolve(projectId, specDocumentIds=[spec:checkout:get]) only when reverse business context is requested
-> answer from exact spec evidence with the normal evidence boundary
-> if the request changes to a route that requires glossary_term_list, stop and report that conditional capability gap
```

## Scenario 16: Relevant Memory Summary Requires Exact Body

User asks:

```text
정산 보류 상태는 실제로 어떤 운영 예외로 봐야 해?
```

Runtime evidence:

- `epic_get` returns a memory summary card titled "정산 보류 운영 예외" with
  a content preview mentioning manual review and delayed settlement.
- `<family>_get` returns a DESIGN item and a memory summary card mentioning a
  deprecated internal name for the same state.

Failure to prevent:

- ignoring memory summaries because generated DESIGN/DD/BR documents already
  look sufficient;
- treating the memory preview as the full body;
- omitting a relevant correction, alias, deprecated name, or operational caveat
  from the final boundary;
- mixing memory overlay with generated SOT/spec/source proof.

Expected route:

```text
-> project_get / domain_list / domain_get / epic_list / epic_get
-> inspect returned memory summary cards before selecting or discarding the EPIC
-> replay memory_get next with scope="approved" for every relevant summary card
-> <family>_list/<family>_get/<family>_item_get for DESIGN/BR/DD evidence
-> inspect document/item memory cards
-> replay memory_get next with scope="approved" for relevant document/item cards
-> answer separates generated SOT evidence, memory overlay, inference, and source/spec limits
```

## Scenario 17: Managed Worktree History Is Not Production Deployment

User asks:

```text
이 저장소 최근 Git 이력하고 지금 분석된 브랜치가 최신인지 봐줘. 최근 배포도 같이 알려줘.
```

Failure to prevent:

- passing `git log` to `readonly_workspace_shell`;
- calling the user's local CLI or reading local repository files as fallback;
- calling a cached origin ref “latest GitHub commit”;
- reporting worktree refresh time or cached branch time as production deployment;
- treating readable source files as proof that linked-worktree Git metadata is
  available.

Expected route:

```text
capability gate
-> workspace_repo_list when repoId is unknown
-> workspace_git_history(projectId, repoId, bounded limit/path)
-> workspace_sync_status(projectId, repoId)
-> distinguish worktree HEAD, last analyzed commit, cached branch tip, and explicitly unavailable timestamps
-> preserve networkChecked=false and productionDeploymentObserved=false
-> if git_metadata_unavailable, report the linked Git metadata gap without local fallback
-> state that actual production deployment requires separate CI/CD/deployment evidence
```

## Scenario 18: Complete Survey API Inventory Uses Spec List

User asks:

```text
Survey EPIC에 연결된 API를 빠짐없이 보여줘.
```

Failure to prevent:

- treating one relevance-ranked `spec_search` page as a complete inventory;
- failing to follow `nextCursor` when `hasNextPage` is true;
- widening outside the selected Survey EPIC without reporting the scope change.

Expected route:

```text
establish project and Survey EPIC scope
-> spec_list(projectId, epicId=<survey-epic-id>, specKind=api_spec)
-> follow nextCursor until hasNextPage=false
-> spec_get selected ids
-> spec_business_resolve when reverse business evidence matters
```

## Scenario 19: Exact Tally Webhook Uses Targeted Search

User asks:

```text
POST /api/v2/surveys/tally/webhook 스펙을 찾아서 동작을 확인해줘.
```

Failure to prevent:

- treating `/api/` as a request for every API;
- starting with a complete `spec_list` traversal when one exact target is known;
- passing the invalid shorthand filter `specKind=api`; use `api_spec` or omit
  the filter when the stored kind is not yet confirmed;
- stopping at a search hit without exact spec and connected-context reads.

Expected route:

```text
project context when projectId is not already known
-> spec_search(projectId, query="POST /api/v2/surveys/tally/webhook")
-> select the exact route candidate
-> spec_get(projectId, documentId=<selected-spec-id>)
-> spec_business_resolve only when reverse business context is requested
-> spec_impact_resolve(projectId, specDocumentIds=[<selected-spec-id>]) only when technical impact is requested
```

## Scenario 20: Implementation Alternatives Are Not Tied Product Interpretations

An SDD caller asks:

```text
홈 화면에 공지용 배너를 넣고 싶어. 지금 보여줄 수 있는 공지 중 우선순위가 가장 높은
것 하나를 홈에서 가장 먼저 보여줘. 기존 서비스 기준으로 조사해서 기획 초안을 만들어줘.
```

MCP evidence shows an existing Home Banner flow that filters currently eligible
banners and displays the smallest priority first. It also shows separate static
announcement pages, so an agent could imagine either reusing Home Banner or
creating a new announcement store, API, and ordering contract.

Failure to prevent:

- treating reuse versus new storage/API as tied product interpretations after
  the requested visible result and safe existing host flow are already clear;
- asking the user to choose a collection, API, field, enum, query, ordering
  implementation, or tie-breaker;
- translating a `DESIGN` alternative into a product clarification merely
  because both implementations are technically possible;
- continuing broad discovery after exact evidence is sufficient to return the
  existing product flow, recommended product assumption, and design handoff.

Expected route:

```text
Search Brief preserves the requested visible result
-> confirm the existing Home Banner eligibility, order, first-item, and host-screen facts
-> classify confirmed AS-IS behavior as FACT
-> classify "eligible notice with the highest rank is the first banner" as PRODUCT
-> return reuse of the existing visible flow as the recommended product assumption
-> classify storage/API/field/query/order/tie-breaker alternatives as DESIGN handoff
-> no user clarification because only technical alternatives remain
-> SDD caller drafts first and asks for one plain-language product approval later
```

Observable pass criteria: retrieval returns no user question about technical
alternatives, retains every unresolved technical item for design, and does not
claim a new storage/API contract as product fact.

## Scenario 21: Initial Community Reward Cadence Before Full Retrieval

An SDD caller asks for a 30-second scroll reward but leaves once-per-visit/window
versus repeated-threshold earning unstated.

Observed RED baseline: retrieval asked no initial question and used 230,067
tokens before an after-research PRODUCT question selected between those two
surfaces.

Expected route:

```text
Initial Product Intent Gate detects two visible earning cadences in the raw request
-> ask one plain-language cadence question before deep or full-cycle retrieval
-> narrow the Search Brief from the answer
-> retrieve only the selected branch
-> Post-Research Product Gate may ask the Community surface or existing-limit
   question only if one remains materially tied
-> final product approval remains outside the two-question discovery budget
```

Observable pass criteria: at most two discovery questions, one question per
message, no existing-system claim in the initial reason, and zero FACT or DESIGN
questions.

## Scenario 22: Exact Code Location Bypasses The EPIC Map

User asks:

```text
kars에서 OrderController.remove 구현 파일과 실제 예외 처리 코드를 찾아줘.
```

Failure to prevent:

- starting with `epic_list` merely because the code belongs to a business
  feature;
- using a natural-language keyword bag in one `code_search`;
- stopping at a code-search card without reading the bounded source region;
- adding reverse business traversal when the user asked only for code.

Expected route:

```text
project context when projectId is not already known
-> workspace_repo_list when repoId is unknown
-> code_search(projectId, query="OrderController.remove")
-> readonly_workspace_shell exact bounded source read
-> answer the code-location and behavior question
```

## Scenario 23: Exact Code Impact Traverses Back To Business

User asks:

```text
OrderController.remove를 바꾸면 어떤 비즈니스 규칙과 사용자 흐름이 영향을 받아?
```

Failure to prevent:

- discarding the exact code anchor and restarting with a broad EPIC inventory;
- treating one code or Spec search hit as proof;
- using `spec_impact_resolve` as a substitute for reverse business context;
- promoting legacy broad document source links to exact business evidence.

Expected route:

```text
exact code search and bounded source read
-> recover the exact DELETE /order/:id Spec with spec_search/spec_get
-> spec_business_resolve(specDocumentIds=[<delete-spec-id>])
-> read only the returned exact business items/documents/EPIC context
-> use spec_impact_resolve only when technical blast radius is also requested
```

## Task12 typed-runtime replay (same baseline fixtures A–F)

Use mocked project p already selected; no real MCP calls, upgrades, IDs or body
invention. Reuse baseline fixtures exactly, and distinguish proposed calls from
returned evidence.

| Fixture | Required trace / claim boundary |
| --- | --- |
| A: client setup with target typed tool inventory | Check route-specific concrete tools; no generic minimum blocker, install, or mutation |
| B: known business rule br1, full documented detail | business_rule_get({projectId:"p",documentId:"br1"}); if explicitly an item, business_rule_item_get(itemIds:["br1"]); no search, no enforcement claim without exact Spec/source |
| C: unknown billing semantic question | project_get -> vocabulary as needed -> domain_list/domain_get -> epic_list/epic_get -> returned concrete BR/DESIGN/DD/UCL maps; search only if exact IDs remain unknown |
| D: known db_logic_spec s1, executable detail | spec_get({projectId:"p",documentId:"s1"}); no search, guessed kind, reverse context or impact merely to read |
| E: s1 impact, confirmed/candidate cross-EPIC, sm1 service-map continuation | spec_get(documentId:"s1"), spec_impact_resolve(specDocumentIds:["s1"],direction:"both"), requested spec_business_resolve; graph_trace seeds:[{kind:"service_map",nodeId:"sm1"}],depth:1,direction:"both"; confirmed expansion only, cycles/depth2 frontier retained, partial if frontier/gaps remain |
| F: existing c1 code candidate in r1, one-hop provenance | reuse candidate/next; graph_trace seeds:[{kind:"code",nodeId:"c1"}],depth:1; no rediscovery/Git calls or promotion into execution proof; bounded source only if claiming implementation |

## Scoped Summary Discovery

Use the same frozen synthetic packets before and after wording changes. Record
actual calls, arguments, returned evidence and final claim boundaries in both
variants; proposed micro decisions are not executed evidence. Label captured
server get outputs separately from supplemental mocked domain/list/item/Spec/
Memory rungs. This test measures skill routing, not live MCP, SDK compatibility,
real DB integration, deployment, or response-size acceptance.

Micro-test five independent fresh-context samples per variant, including a
no-new-guidance control. Supply selected packets with omitted view for project,
EPIC and BR discovery (BR itemLimit 50), an explicit EPIC full packet, an approved
Memory packet and an exact item packet. Inspect every sample: expected discovery
arguments add summary only to those three gets, BR changes to itemLimit 20, and
all other IDs/scopes/cursors/arguments remain unchanged. Explicit full, Memory
and exact item packets are unchanged. Also retain the direct known BR document/
item route; semantic wording must not turn that exact request into discovery.

Run two independent full mock replays under long-document and narrow-read
pressure:

| Question | Required observed behavior |
| --- | --- |
| Explain an EPIC rule and connected processing Spec with approved operating notes | Project/EPIC/BR summary discovery, selected typed lists, exact rule item, item Spec resolver, exact Spec and relevant approved Memory body; preserve diagnostics and missing source boundary |
| Explain another EPIC's supporting-only DESIGN responsibility and processing Spec, plus complete project API inventory | EPIC summary supporting count, returned EPIC full packet executed unchanged, exact referenced DESIGN documents/items and directional Spec reads; every project api_spec cursor exhausted |

Only selected branches expand. Unneeded supporting/full continuations stay
unselected. A direct-list empty result cannot establish supporting absence.
BR item pagination follows its returned cursor when the selected item is missing
or complete inventory is required, without adding view to item_list. Final
answers separate policy/Spec evidence, approved Memory overlay and unavailable
source enforcement. A tool error, regeneration-required state, or unsupported
summary schema remains a named gap, never a host/local retry.
