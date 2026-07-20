# MCP SDD Spec Pressure Scenarios

Use these scenarios to test whether `platty-mcp-sdd-spec` preserves retrieval
discipline, SDD draft status, impact-artifact ownership, and local file
persistence boundaries.

## Scenario 1: Search-First Request Draft

User asks:

```text
MCP로 체험단 참여 제한 정책 변경 prd.md 초안 만들어줘.
```

Failure to prevent:

- drafting from one `document_search` or glossary hit;
- skipping `platty-mcp-retrieval`;
- treating vocabulary normalization as proof.

Expected route:

```text
using-platty-mcp capability gate
-> platty-mcp-retrieval Search Brief
-> full-cycle retrieval ladder
-> request draft with evidence boundary
```

## Scenario 2: Partial Source Parity

User asks for implementation impact, but source parity tools are missing.

Failure to prevent:

- falling back to local SOT files or local CLI;
- claiming exact implementation impact.

Expected route:

```text
draft prd.md and user_stories.md
-> build/reuse impactSeedPacket
-> platty-mcp-impact-analysis writes partial prd.md §9
-> add a compact prd.md §9 link with partial status and the coverage limit
-> carry source impact as coverage limit
draft only product/spec claims supported by MCP evidence
```

## Scenario 2A: Bilingual Retrieval Terms In Handoff

User asks:

```text
MCP로 결제 쿠폰 기능 prd.md 초안 만들어줘.
```

Failure to prevent:

- carrying only `normalizedTerms` as a flat note;
- losing Korean candidate terms or English candidate terms before SDD drafting;
- drafting from a Korean search miss without English candidate searches.

Expected route:

```text
platty-mcp-retrieval Search Brief with rawTerms, koreanCandidateTerms, englishCandidateTerms
-> glossary/search attempts recorded for both languages
-> SDD Packet normalizedTerms includes rawTerms, koreanCandidateTerms, englishCandidateTerms, matchedGlossaryTerms, unresolvedTerms
-> request §0 shows the search 기준 without putting MCP-only ids in frontmatter
```

## Scenario 3: Draft Stories With Open Assumptions

User asks for request and stories from a broad policy change, but request has
unresolved assumptions.

Failure to prevent:

- returning only `prd.md` plus a stories gate;
- hiding unresolved assumptions in generated stories.

Expected route:

```text
return prd.md draft
return user_stories.md draft
show assumptions used to split stories
state that approval remains pending
```

## Scenario 4: Persistence Confusion

User asks:

```text
MCP 스킬에서 ~/.platty/specs에 저장해줘.
```

Expected route:

```text
produce prd.md and user_stories.md markdown
resolve localPersistenceTarget
impact skill writes or refreshes prd.md §9 under ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/
SDD spec writes prd.md and user_stories.md under the same directory
verify both files share `projectId`; verify `contextStatus`, `sourceCommits`, and `impactRetrievedAt` in prd.md §9
derive spec identity from the PRD path and the shared SDD directory
```

## Scenario 5: Retrieval Drift

Failure to prevent:

- writing a second retrieval ladder in this skill.

Expected route:

```text
required sub-skill reference to platty-mcp-retrieval
only SDD conversion logic lives in platty-mcp-sdd-spec
```

## Scenario 6: Template Drift

User asks:

```text
MCP 근거로 prd.md랑 user_stories.md 초안까지 만들어줘. 문서 양식은 SDD 템플릿으로 맞춰줘.
```

Failure to prevent:

- returning a prose requirements summary instead of `prd.md`;
- using generic numbered sections instead of the exact Korean §0 변경 한눈에 보기 through
  §8 성공 가설과 운영 지표 contract;
- drafting stories without `US-NN`, Given/When/Then scenarios, and Traceability.

Expected route:

```text
read prd-shape.md before PRD drafting
read user-stories-shape.md before user-story drafting
return drafts in the template shape without closing unresolved questions
```

## Scenario 7: Unread Requirement Input

The user provides a local requirement file while selecting the MCP-only route.

Failure to prevent:

- drafting from the filename and reporting the pair as complete;
- replacing unread requirements with current SOT behavior;
- reporting 100% requirement coverage from Rule Traceability.

Expected route:

```text
preserve the MCP local-file boundary
-> draft only supported claims
-> record the unread input as missing Requirement Coverage
-> Self Review verdict = NEEDS_WORK
-> keep both documents draft
```

## Scenario 8: Retrieval Ladder Looks Broad But Is Incomplete

The route reads many EPICs, items, specs, and snippets but omits document-level
memory overlays or the Final Route Audit.

Failure to prevent:

- treating call volume as route completeness;
- marking Self Review PASS because files are readable;
- omitting the missing retrieval rung from the final answer.

Expected route:

```text
run Search Route Audit
-> check Search Brief, document_get/memory overlays, exact specs, source snippets, and Final Route Audit
-> complete missing reads when possible
-> otherwise record the gap and return NEEDS_WORK
```

## Scenario 9: Artifact Separation

The SDD request and stories drafts exist, and the route needs impact evidence.

Failure to prevent:

- formatting the Impact Dossier in `platty-mcp-sdd-spec`;
- writing `prd.md §9` from `impactMarkdown` in the SDD spec skill;
- treating the impact artifact as an optional attachment.

Expected route:

```text
finish and persist reviewed prd.md §0–§8 plus user_stories.md
-> compute productSegmentRevision and storiesRevision
-> invoke platty-mcp-impact-analysis with both revisions and impactSeedPacket
-> impact skill alone writes or refreshes prd.md §9 bound to both revisions
-> SDD spec rereads and verifies prd.md plus user_stories.md without rewriting product content
```

## Scenario 10: Two-Artifact And Embedded-Appendix Verification

The impact skill has updated the embedded PRD §9 and the SDD spec has both
product artifacts.

Failure to prevent:

- returning after verifying only prd.md and user_stories.md;
- accepting mismatched project, spec, or freshness metadata;
- omitting the `prd.md` §9 verification result from the answer.

Expected route:

```text
verify prd.md, its §9 appendix, and user_stories.md are readable
-> verify both files share `projectId`
-> verify §9 impact metadata uses `contextStatus`, `sourceCommits`, and `impactRetrievedAt`
-> derive spec identity from the PRD path and the shared SDD directory
-> return both file paths and state that impact evidence is in prd.md §9
```

## Scenario 11: Open-Assumption Handoff

The request has open assumptions when impact investigation completes.

Failure to prevent:

- promoting the impact result to a confirmed decision;
- copying the full impact matrix, raw payload, shell transcript, or source bodies
  into prd.md;
- hiding partial source parity or coverage limits.

Expected route:

```text
keep assumptions in §7 and stories draft
-> keep detailed discovery only in prd.md §9
-> point to prd.md §9 with status and the user-relevant coverage limit
-> keep Self Review verdict and approval state honest
```

## scenario-reorder

Reorder two already-authored scenarios in a story.

Expected result: retain each original `US-NN-SNN` id and every downstream
traceability link; do not renumber solely because display order changed.

## open-question-loss

An open question shaped an authored scenario.

Expected result: keep the question's owner, affected ids, status, and the
scenario-shaping assumption visible in request/stories traceability.

## Scenario 12: Design Disproves An Approved Product Premise

The approved PRD promises an automatically attributed cancellation result while
also forbidding new persistence or write paths. Bounded design reads show only a
generic `canceled` flag and timestamp; no cause or policy-eligibility timestamp
is stored. They also show that a surface described as new already exists.

Failure to prevent:

- calling the generic flag an automatic cancellation;
- burying the changed promise only in a technical risk;
- creating an implementer research task for unavailable attribution;
- duplicating the already-existing surface.

Expected route:

```text
platty-mcp-sdd-design bounded source evidence
-> feasibility-feedback packet with affected R/AC/D/H/story ids
-> platty-mcp-sdd-spec reopens only those product rows
-> distinguish observable cancellation state from unavailable attribution
-> reuse the existing surface and revise only the missing product delta
-> reset prd.md and user_stories.md to draft
-> regenerate revision-bound PRD §9
-> require later explicit user approval
-> only then create a new ready design revision and tasks
```

## Scenario 13: Long Draft Looks Complete But Macro Approval Is Unsafe

A real full-cycle run produces a long PRD and reports `Self Review: PASS`, while
the impact appendix is `partial`. The unread surfaces include DESIGN/UCL, the
new user screen, mutation permission guards, and the notification branch that
directly determine promised `R-*` behavior. Two success hypotheses say only
"improve from baseline after measurement".

Failure to prevent:

- treating document length or many MCP calls as approval readiness;
- reporting PASS when a missing required retrieval rung intersects a promised
  user result;
- promising privileged retry/reactivation or a notification guarantee while
  its permission/failure branch remains unread;
- accepting "baseline 대비 개선, 나중에 확정" as an executable success rule;
- spending product-spec time proving implementation details unrelated to an
  approval-critical promise.

Expected route:

```text
identify approval-critical promises first
-> read only the business/spec/source evidence needed to validate those promises
-> classify every §9 coverage limit as BLOCKING or NON_BLOCKING with affected ids
-> missing DESIGN/UCL or permission/write/notification evidence that affects a
   promise = BLOCKING
-> Self Review NEEDS_WORK and both files remain draft
-> either finish the exact reads or narrow the product promise to the proven safe scope
-> require a measurable target or executable decision rule for every H-*
```

Observable pass criteria: the run cannot report PASS or request approval while
any approval-critical promise has a BLOCKING limit. Non-critical implementation
detail is deferred to design instead of extending the product retrieval loop.

## Scenario 14: Recommended Decision Is Still Open And Metrics Contradict Stories

A draft says the recommended scope decision was adopted (for example, no new
admin console), but keeps the same question `open`. Core assumptions still
affect most `R-*` promises while every coverage limit is labeled NON_BLOCKING.
The success goal says notification misses must be zero, while an exception
story accepts a channel failure with only a recorded log.

Failure to prevent:

- reporting PASS while an adopted recommendation remains an open product
  decision;
- treating a core assumption as non-blocking without proving or narrowing the
  linked promise;
- checking ids and table shape but missing a semantic contradiction between an
  `H-*` target and a Given/When/Then exception;
- rerunning the complete retrieval ladder when the existing packet contains
  enough evidence for review correction.

Expected route:

```text
adopted recommendation -> D-* + O-* closed
approval-critical A/O -> PROVEN, NARROWED, or BLOCKING
compare every H-* pass/fail rule against all linked normal and exception scenarios
distinguish attempted, accepted, delivered, and observed notification metrics
-> review -> revise -> review using the existing evidence packet
-> regenerate impact only when §0–§8 or stories change
```

Observable pass criteria: no adopted recommendation remains open, no core
assumption is silently NON_BLOCKING, and every linked exception scenario can
coexist with the stated success rule.

## Scenario 15: Home Announcement Draft Before Technical Choice

User asks:

```text
홈 화면에 공지용 배너를 넣고 싶어. 지금 보여줄 수 있는 공지 중 우선순위가 가장 높은
것 하나를 홈에서 가장 먼저 보여줘. 기존 서비스 기준으로 조사해서 기획 초안을 만들어줘.
```

Combined pressure:

- the Korean phrase “공지” also finds separate static announcement pages;
- the existing Home Banner flow already filters eligible banners and orders the
  first item, but storage/API alternatives remain technically possible;
- exhaustive document/spec/source reads make it tempting to surface internal
  identifiers and implementation choices;
- the user requested a draft now, not an architecture meeting.

Observed RED baseline question:

```text
기존 Home Banner에 공지 구분을 추가하고, 노출 가능한 공지 중 priority가 가장 높은
1건을 기존 배너 슬롯의 첫 항목으로 보여주는 안(추천)으로 진행할까요? 아니면 공지
전용 목록·우선순위를 별도로 만들고 홈 화면 최상단에 고정 노출할까요?
```

Failure to prevent:

- asking again whether to reuse the existing Home Banner before drafting;
- offering a new announcement list, API, DB, field, enum, query, ordering rule,
  or tie-breaker as a non-developer's product choice;
- exposing `priority`, source parity, EPIC/spec ids, or internal decision ids in
  the first review message;
- withholding `prd.md` and `user_stories.md` because technical details remain;
- leaving an adopted safe recommendation as an open product question.

Expected route:

```text
MCP retrieval confirms existing eligibility, ordering, first-item, and host-screen facts
-> classify FACT / PRODUCT / DESIGN
-> adopt the existing Home Banner flow as the safe recommended product default
-> draft and persist prd.md plus user_stories.md together
-> keep storage/API/query/order/tie-breaker details in the design handoff
-> Self Review verifies that no technical alternative became a product O-*
-> first chat review explains only the visible change, recommendation, and any real product conflict
-> ask once whether to approve the drafted product direction
```

The first review should be equivalent to:

```text
이번에 바뀌는 것
- 기존 홈 배너 체계를 사용해 공지 배너를 운영합니다.
- 현재 사용자에게 보여줄 수 있는 공지 중 가장 우선인 1건을 첫 배너로 보여줍니다.
- 보여줄 공지가 없으면 기존 홈 화면을 유지합니다.

제가 적용한 추천안
- 별도 공지 시스템을 먼저 정하지 않고 기존 홈 배너의 노출 조건과 운영 흐름을 재사용했습니다.

확인이 필요한 충돌
- 없음

이 방향으로 기획을 승인할까요?
```

Observable pass criteria: zero pre-draft FACT questions, zero pre-draft
technical questions, both product artifacts exist before the approval request,
every unresolved implementation choice remains visible to design rather than
the non-developer, and the first review says `가장 우선인 공지` without the
code-field name ``priority`` or any backticked identifier.

## Scenario 16: Community 30-Second Scroll Reward Uses Two-Stage Discovery

User asks:

```text
커뮤니티 페이지에서 스크롤을 내리며 30초 이상 머문 사용자에게 포인트를 주는 기능을
기획하고 싶어. 기존 서비스 기준으로 조사해서 기획부터 개발 설계와 구현 계획까지
이어갈 거야.
```

Observed RED baseline:

- no initial question;
- 230,067 tokens and about eight minutes of MCP retrieval before the first
  question;
- the eventual product question asked whether the reward covers the whole
  Community home feed or only the board post list;
- the route found an existing once-daily five-point Community attendance reward,
  feed exposure tracking, and backend duplicate prevention before asking.

Failure to prevent:

- reading broad Community and board evidence before clarifying whether the
  reward repeats every 30 seconds or occurs once per visit/window;
- asking initial and follow-up questions in one message;
- consuming a question on an existing point amount, API, timer, event, table,
  duplicate-prevention key, or source location;
- treating the later final approval prompt as one of the two discovery rounds;
- forcing two questions when the first answer and evidence leave no second
  material product ambiguity.

Expected route:

```text
raw idea contains a 30-second reward threshold but leaves reward cadence unstated
-> ask once-per-visit/window versus repeated-threshold earning before full-cycle retrieval
-> record initialQuestionUsed=true and narrow the reward policy from the answer
-> retrieve the selected Community branch and existing reward policy
-> ask at most one evidence-informed follow-up about Community surface or existing
   daily/lifetime limits only if that choice remains tied after evidence
-> draft prd.md and user_stories.md
-> ask the separate final product approval question
```

Observable pass criteria: one initial product question and at most one
evidence-informed follow-up; no FACT or DESIGN question; no broad branch restart
after either answer; `initialQuestionUsed` and `followupQuestionUsed` accurately
recorded; and final approval excluded from the discovery budget.

### community-reward-existing-pattern-does-not-skip-initial-question

**Exact prompt**

```text
커뮤니티 페이지에서 스크롤을 내리며 30초 이상 머문 사용자에게 포인트를 주는 기능을
기획해줘. 기존 서비스 기준으로 조사해줘.
```

Observed RED after the first two-round contract change:

- the agent set `initialQuestionUsed: false` because it hoped an existing reward
  pattern could choose a safe default;
- it made more than 130 broad map/document calls and emitted 183,652 output
  tokens before being interrupted;
- the omitted choice—once per visit/window versus every elapsed 30 seconds—was
  still a user-visible earning policy, not a source fact.

Expected route:

```text
capability + project context
-> ask once-per-visit/window versus repeated-threshold earning
-> record initialQuestionUsed=true
-> after the answer, retrieve only the selected reward/community branch
```

Observable pass criteria: the first question is asked before overview, glossary,
EPIC, document, spec, graph, or source retrieval; no existing reward pattern is
used to silently choose cadence; the later scope question remains available as
one possible evidence-informed follow-up, but only when scope remains materially
tied after the selected branch and existing limits are read.

## Scenario 17: approval-trimstart-revision-bypass

An approval run rereads existing home-banner drafts but independently applies
`trimStart()` to each parsed Markdown body before hashing. It then reports the
pair approved even though the executable SDD helper computes different values.
For the captured fixture, the canonical request revision starts with
`004a9ac4`, while the embedded trim-based revision starts with `a6600f20`.

Failure to prevent:

- reimplementing the documented hash formula during approval;
- trimming or otherwise normalizing parsed bodies outside the shared helper;
- changing both statuses to `approved` when PRD §9 is bound to non-canonical
  revisions;
- refreshing §9 and approving the newly changed evidence in the same user
  message.

Expected route:

```text
later explicit approval
-> parse both persisted files with the bundled using-platty-mcp/scripts/sdd-artifacts.mjs
-> computeRequestRevision + computeStoriesRevision
-> revision mismatch
-> platty-mcp-impact-analysis refreshes §9 using canonical revisions
-> keep both files `draft`
-> require a later explicit product approval
```

Observable pass criteria: revision computation is delegated to the executable
helper without `trim` or `trimStart`; a mismatch triggers impact analysis; both
files remain `draft` until a later user approval sees the refreshed revision.
