---
name: platty-mcp-sdd-spec
description: Use when creating locally saved MCP-grounded SDD PRD and user-story drafts from a product idea, feature request, PRD need, policy change, or requirements discussion.
---

# Platty MCP SDD Spec

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Produce MCP-grounded SDD documents and persist them locally. This skill gathers
evidence through `platty-mcp-retrieval`, drafts `prd.md` and `user_stories.md`,
then uses `platty-mcp-impact-analysis` to persist the impact snapshot under
`~/.platty/specs/<projectId>/...`.

Use `../using-platty-mcp/references/sdd-revision-contract.md` for every product
revision and downstream fingerprint value.
Use `../using-platty-mcp/references/sdd-question-ownership.md` before turning
retrieval uncertainty into a product assumption, open question, blocker, or
design handoff.

All reader-facing output is Korean. Keep code identifiers, API paths, file
paths, status values, and quoted evidence in their original form.

## Required Sub-Skills

1. Use `using-platty-mcp` for MCP capability and project context.
2. Use `platty-mcp-retrieval` for all evidence gathering.
3. Use `platty-mcp-impact-analysis` for a product-scope review covering policy,
   journey, data, EPIC, API, and screen impact, then build the impact snapshot
   after the request and story drafts exist.
4. Apply the shared SDD question-ownership contract to every unresolved item.

This impact review checks product requirements for the affected policy, journey,
data, EPIC, API, and screen scope before the drafts are finalized.

Do not implement an independent retrieval route in this skill. Search,
glossary, epic, document, spec, graph, code, source confirmation, and negative
evidence routes belong to `platty-mcp-retrieval`.

## When To Use

Use for MCP-grounded SDD authoring from product ideas, feature requests, policy
changes, PRD questions, or rough requirements.

Use `platty-mcp-retrieval` alone for retrieval-only answers. Use this skill when
the task should create SDD planning files from MCP evidence and save them in the
local Platty specs directory.

## Product Discovery Budget

Use brainstorming-style progressive clarification without turning product
discovery into an interview. Ask one question per message and allow at most two
discovery questions:

1. **Initial question — optional.** Before deep or full-cycle retrieval, ask
   only when the raw idea itself has materially different user-visible
   interpretations and choosing the wrong one would redirect the product scope
   or evidence branch. Ask what the user intends. Do not claim an existing fact
   and do not expose an implementation alternative.
2. **Evidence-informed follow-up — optional.** After MCP evidence, ask at most
   one tied `PRODUCT` question with a plain-language recommendation, reason, and
   user-visible difference.

Track `initialQuestionUsed`, `followupQuestionUsed`, and
`discoveryQuestionsRemaining` in runtime context. Resume from the recorded
Search Brief after each answer instead of restarting discovery. Skip a round
when unnecessary; zero discovery questions is correct for a specific request
whose safe product default is supported by current evidence. The final product
approval after both drafts are saved is a separate gate. Final product approval does not count toward the discovery budget.

One ambiguity is mandatory, not optional: a time-based reward request that gives
a threshold but omits reward cadence. “Once per visit or eligibility window” and
“repeat whenever the threshold elapses” create materially different earnings,
abuse incentives, and budget exposure. The route must use the initial question
to select that user-visible policy before overview, glossary, EPIC, document, or
source retrieval. An existing reward pattern may support the recommendation,
but it cannot choose the product policy on the user's behalf. Skip this special
case only when the raw request already states the cadence or repetition limit.

If a third material product ambiguity appears, do not ask a third discovery
question. Preserve it as an open `O-*`, keep both files draft, and report
`NEEDS_WORK`. `FACT` items remain retrieval work and `DESIGN` items remain the
technical-design handoff; neither consumes the product-question budget.

## Operating Flow

1. Confirm MCP capability tier and project context through `using-platty-mcp`.
2. Build a raw Product Intent Brief. Before deep retrieval, use the optional
   initial question only when two materially different user-visible meanings
   are already present. A time-based reward with an unstated reward cadence must
   use the initial question before broad evidence. On answer, narrow the target
   branch and resume.
3. Route the narrowed idea through `platty-mcp-retrieval`.
4. Require a Search Brief for broad, domain-term, policy, data, journey, or
   impact ideas.
5. Require the retrieval full-cycle ladder before SDD product claims.
6. Stop if minimum retrieval or a selected branch's required evidence surface is
   missing.
7. Require the retrieval packet to distinguish document-map evidence resolved
   with `document_spec_resolve` from candidates and include its runtime-only
   `questionOwnershipAudit`.
8. Classify each unresolved item as `FACT`, `PRODUCT`, or `DESIGN`. Resolve
   `FACT` through retrieval or record its exact evidence boundary. Split mixed
   items instead of exposing the technical part as a product question.
9. Apply a safe `PRODUCT` recommendation when the user's visible result is
   specific and current evidence supports one reversible existing flow. Record
   the adopted recommendation as `D-*` and close the related `O-*`. Ask before
   drafting only when two materially different user-visible `PRODUCT` choices
   remain genuinely tied and the evidence-informed follow-up has not been used.
   Ask one question, record the answer, and resume without rerunning completed
   retrieval. If the follow-up was already used, preserve the ambiguity as an
   open `O-*` and keep the pair `NEEDS_WORK`.
10. Preserve every `DESIGN` item in the Design Decision Handoff. API, DTO, DB,
   index, migration, cache, query, ordering implementation, tie-breaker,
   component, file, test, deployment, and rollback choices do not block product
   drafting when they preserve the proposed user result.
11. Draft `prd.md` content through §8 by applying the request template.
12. Always draft `user_stories.md` with `prd.md` by applying the stories template.
   If the request has unresolved questions, keep stories as draft and surface the
   assumptions used to split scenarios.
13. Before detailed source descent, build a **Macro Approval Packet** across the
   raw idea, users, problem, scope/non-scope, proposed `R-*`/`AC-*`, stories,
   and `H-*`. Mark each promise approval-critical when it adds or changes money
   movement, privileged mutation, permission, irreversible state, notification
   guarantee, persistence, or a user-facing surface. Source-confirm only the
   facts needed to decide whether those promises are feasible and safe; defer
   exact edit targets, exhaustive consumers, tests, and implementation details
   that do not change the product promise to `platty-mcp-sdd-design`.
14. Run product Self Review across the raw idea, requirement inputs, retrieval
   packet, PRD §0–§8, and all stories. Apply `review -> revise -> review` until
   the product pair is internally consistent. Do not run impact against a product
   body that may still be revised.
15. Persist both draft files together. The PRD may contain the §9 heading and a
    pending marker at this point; no impact claim may be made from that marker.
16. Compute the finalized `productSegmentRevision` from PRD §0–§8 and
    `storiesRevision` from stable stories frontmatter and body, excluding the
    mutable status. Review policy,
    journey, data, EPIC, API, and screen impact, then invoke
    `platty-mcp-impact-analysis` with both revisions and the seed packet.
17. Impact analysis alone replaces the final §9 and binds the dossier to those
    two revisions. Reread `prd.md` and verify the bound revisions,
    `impactRevision`, status, freshness, source parity, and coverage limits.
18. Run final cross-document Self Review without rewriting §0–§8 or stories.
    Require every §9 coverage limit to name affected product/story ids and an
    approval impact of `BLOCKING` or `NON_BLOCKING`. A missing required retrieval
    rung, unread permission/write/payment/notification branch, or unverified new
    screen is `BLOCKING` when it controls an approval-critical promise. Any
    `BLOCKING` row forces `NEEDS_WORK`; document length, call volume, or a merely
    readable pair can never override it. A partial dossier may pass only when all
    partial limits are explicitly `NON_BLOCKING` for the approved product result.
    A bounded missing route, caller, component, API, or exact edit target is a
    `NON_BLOCKING design guard` when the product promise is defined independently,
    does not depend on a claimed current-system fact, and the missing evidence can
    only change implementation placement. Exact edit targets are deferred to
    technical design in that case. You must not mark or classify such a gap `BLOCKING` merely
    because the approved change has a user-facing surface. Carry the affected ids,
    searched scope, and required design recheck into the handoff. It remains
    `BLOCKING` when resolving the source could change feasibility, money movement,
    permission, persistence ownership, notification guarantees, or the promised
    user result.
    An adopted recommendation is a decision: record it as `D-*` and close the
    related `O-*`; do not keep it open merely as a possible future revision.
    Any `A-*` or `O-*` that can change an approval-critical user result is
    BLOCKING until proven, narrowed out of scope, or explicitly decided.
    If
    a product change is required, update both product files, reset their status
    to `draft`, and restart from step 12 so impact is regenerated for the new
    revisions. Persist and read back the final pair before reporting completion.
19. Accept a feasibility-feedback packet from `platty-mcp-sdd-design` when
    bounded source reads disprove an approved product premise or show that a
    requirement needs data, attribution, policy, or a user surface that the
    approved scope forbids. Reopen only the affected `R-*`, `AC-*`, `D-*`,
    `H-*`, story, and scenario rows; preserve the original intent and record the
    exact product trade-off. Reset both product files to `draft`, regenerate §9
    against the new revisions, and require a later explicit user approval. A
    design finding never silently edits an approved product pair and never
    becomes an implementation task while the pair is draft.

## Template Contract

`prd.md` and `user_stories.md` are not free-form summaries. They must follow the
template references exactly enough that designers, planners, and implementation
agents can review them without reshaping them.

Keep frontmatter reader-light: persist only `id`, `type`, `status`, `projectId`,
`outputLanguage`, and the stories `derivedFrom` link. Source commits,
freshness, evidence boundary, impact status/revision, source parity, coverage
limits, review detail, `localPersistenceTarget`, raw MCP payloads, and
transient candidates do not belong above the title. Durable evidence metadata
is stored in PRD §9; runtime-only metadata stays in the SDD packet.

Do not include raw MCP payloads, shell transcripts, or source bodies. The
evidence table, review findings, and source references belong only in the final
§9 appendix; §0–§8 remain planner-facing.

Write §0–§8 as a product document, not a source-analysis summary. Its allowed
shape is user/operations/policy language, with only the minimal confirmed
original status value or values in parentheses when a product rule directly
depends on them. Explain the Korean business meaning first. Class,
function, file, line, code-node, spec-id, route/component candidate, full enum
transition list, source-parity, graph/search status, and confidence narration
belong in §9. Evidence-handling or authoring behavior is not a product rule:
never create `R-*`, `AC-*`, `D-*`, or `H-*` for how the document labels partial
source evidence.

`prd.md` uses `references/prd-shape.md` and includes these sections in
order:

```text
§0 변경 한눈에 보기
§1 사용자 과업
§2 현재 상황과 문제
§3 범위와 비범위
§4 제안하는 해결 방향
§5 제품 규칙과 수용 기준
§6 확정 결정
§7 가정과 미결 질문
§8 성공 가설과 운영 지표
§9 Impact evidence appendix
```

`user_stories.md` uses `references/user-stories-shape.md`, starts with `# 사용자 스토리`,
places the Korean `스토리 한눈에 보기` index before the detailed stories, uses
`US-NN` story blocks with Given/When/Then scenarios, and ends with the Korean
rule-to-scenario connection table. The index is derived from the detailed story
and trace rows; it never owns a new product decision.

PRD §0 must name what the current review is being asked to approve by linking
the existing scope, `R-*`/`AC-*`, `O-*`, and `H-*` items. PRD §8 must make a
success decision possible: record the observed baseline, target or decision
rule, measurement period, owner, and linked rules. Unknown baselines or targets
stay attached to `A-*`, `O-*`, or a bounded baseline-collection decision; do not
invent a number to complete the table or ask the user to guess one.
`baseline 대비 개선`, `측정 후 확정`, or an unbounded directional goal is not
an executable success decision. Every `H-*` needs either a numeric target or a
decision rule with a comparison window, minimum sample or guardrail when
relevant, owner, and the exact outcome of pass versus fail. When the approved
visible result does not depend on an unknown number, a bounded collection
window plus an executable post-collection pass/fail decision is sufficient;
instrumentation remains `DESIGN`. If neither a product target nor such a rule
can be chosen, keep the pair `NEEDS_WORK` and link the gap to an open `O-*`.

## Local Persistence

Both artifacts use this directory:

```text
~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/
```

The selected `projectId` must come from MCP project context or the resolved
Platty project. The slug should be stable and human-readable from the request
title or raw idea. Use the current year-month for `<YYYY-MM>` unless the user
provided a spec id or date.
Resolve `~` to the current user's home directory before creating directories or
writing files; do not pass a literal `~` path to filesystem tools.

Persistence rules:

- Create the target directory if it does not exist.
- Write the reviewed PRD §0–§8 plus pending §9 marker to `prd.md` and
  `storiesMarkdown` to `user_stories.md` before impact analysis.
- The impact skill formats and exclusively replaces §9, binding it to
  `productSegmentRevision` and `storiesRevision`, then returns its revision,
  status, parity, commits, and coverage limits.
- After impact returns, this skill rereads both files and does not rewrite
  `prd.md` unless a product revision is intentionally restarted from step 9.
- Update the request and stories together when regenerating the same spec; do
  not leave either stale.
- Do not delete unrelated files in the directory.
- Verify both files are readable after writing and share `projectId`. Verify
  source commits, freshness, and impact state from PRD §9. Include both paths
  in the final response.

The MCP impact work is read-only except for the final §9 of the selected PRD. Do not
read local SOT or run local Platty CLI commands, mutate projects, generate docs,
sync, refresh caches, or write memory from this route.

## SDD Packet

Return these fields in the working context and final response when applicable:

```text
SDD Packet
- projectId
- projectName
- rawIdea
- selectedInterpretation
- outputLanguage
- requestStatus
- evidenceBoundary
- contextStatus
- surfacesRead
- normalizedTerms
  - rawTerms
  - koreanCandidateTerms
  - englishCandidateTerms
  - matchedGlossaryTerms
  - unresolvedTerms
- candidateEpics
- selectedEpics
- exactDocumentItems
- connectedSpecs
- sourceConfirmations
- directEvidence
- inferredEvidence
- assumptions
- confirmedDecisions
- openQuestions
- productDiscovery
  - initialQuestionUsed
  - followupQuestionUsed
  - discoveryQuestionsRemaining
  - finalApprovalExcludedFromBudget: true
- questionOwnershipAudit
  - factItems
  - productItems
  - designItems
  - userQuestion
  - stopReason
- recommendedProductAssumptions
- designDecisionHandoff
- coverageLimits
- impactSeedPacket
- impactDossier
- impactStatus
- impactRevision
- productSegmentRevision
- storiesRevision
- sourceParity
- impactAppendix
- selfReview
  - verdict
  - blockingFindings
  - warnings
  - requirementCoverage
- searchRouteAudit
- requestMarkdown
- storiesMarkdown
- localPersistenceTarget
```

`localPersistenceTarget` is the mandatory local artifact target:

```text
~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/
```

## Request Gate

Carry forward the local `platty-sdd-spec` request states:

- `draft` while evidence and decisions are still being assembled;
- unresolved assumptions or unanswered decisions remain visible in §7 while the
  file frontmatter stays `status: "draft"`;
- `approved` only after explicit user approval.

On a later explicit approval message, reread both persisted files and the final
Self Review result. Recompute `productSegmentRevision` and `storiesRevision`
with the shared executable helper at
`../using-platty-mcp/scripts/sdd-artifacts.mjs` (resolved relative to this skill):
parse the persisted files with `parseSddArtifact`, then call
`computeRequestRevision` and `computeStoriesRevision` on those parsed
artifacts. Do not reimplement the revision algorithm, strip the first body
newline, call `trim`/`trimStart`, or otherwise normalize document bodies outside
that helper.

If either recomputed revision differs from the revision embedded in PRD §9,
treat it as a revision mismatch: invoke `platty-mcp-impact-analysis` to refresh
§9 against the canonical helper values, keep both files `draft`, reread them,
and stop for a later explicit product approval. The approval message that
exposed the mismatch cannot also approve the refreshed evidence revision.

Only when the canonical revisions already match may the approval gate
verify that PRD §9 is bound to both values and has no blocking coverage finding,
then change both statuses to `approved` in one operation. Also verify that every
approval-critical promise has no open product decision and every `H-*` has an
executable success decision. Technical implementation detail may remain for
design only when it cannot change the promised user result. It must remain in
the PRD's Design Decision Handoff or the exact §9 coverage limit rather than
becoming a product `O-*`. Read both files back
and report the approved revisions. If either file changed, §9 is stale, or a
blocking finding remains, keep both files `draft` and return to the relevant
review/impact step. Any later product edit resets both statuses to `draft`.

Read `references/prd-shape.md` before drafting PRD content. If the
SDD packet has unresolved assumptions or unanswered decisions, keep the
frontmatter `status` as `draft` and preserve the unresolved items in §7 instead
of inventing closure.

## Stories Draft

Always draft `user_stories.md` with `prd.md`. Approval controls whether the files
can move from `draft` to `approved`; it does not control whether
`user_stories.md` exists.

Read `references/user-stories-shape.md` before drafting user-story content. If
`prd.md` has open questions or assumptions, make those visible in
`user_stories.md` and trace which stories would change if the answers change.

## Self Review Gate

Self Review runs once on the product pair before impact and again after the
revision-bound §9 exists. It must not move either file to `approved`; explicit
later user approval remains the only approval gate.

Apply this review sequence:

1. Check every available user requirement and MCP direct-evidence claim against
   both drafts.
2. Import the `platty-mcp-retrieval` Final Route Audit into
   `searchRouteAudit`, including Search Brief completeness, selected EPIC and
   BR/DD/DESIGN/UCL maps, exact items, `document_get` and attached memory
   overlays when relevant, `document_spec_resolve`, selected `spec_get`, the
   requested `spec_document_resolve` or `spec_impact_resolve` direction, source
   snippets for exact claims, and unread surfaces.
   Import `questionOwnershipAudit` and verify every unresolved item has exactly
   one owner or was deliberately split into product and technical parts.
3. Check statuses, enums, thresholds, metrics, scope, and terminology for
   contradictions or unsupported promotion from inference to decision.
   When review is triggered by design feasibility feedback, distinguish a
   source fact that changes implementation detail from one that changes the
   promised user result. The latter must reopen the linked product rule and
   story; it cannot be hidden only in §9 or weakened only in system design.
4. Verify that the PRD §0 approval summary contains only existing §3/§5/§7/§8
   items, every closed `O-*` points to its resolving `D-*`, and each `H-*` has a
   usable success criterion or an explicit `A-*`/`O-*` gap.
   Also verify the inverse: when the recommended answer was adopted, the
   matching `O-*` is closed and linked to `D-*`. A future revisit condition does
   not make the current decision open.
   Reject any open `O-*` whose answer is source-confirmable `FACT` or
   implementation-only `DESIGN`. Verify every deferred technical item appears
   in the Design Decision Handoff with the invariant user result.
5. Verify that the story overview exactly matches the detailed story ids,
   users, outcomes, scenario ids/counts, rule/acceptance links, and affected
   assumptions/questions.
6. Scan PRD §0–§8 and every story for source-analysis leakage. Move class,
   handler, file/line, code-node, spec-id, route/component candidate, full state
   transitions, source parity, graph/search status, and confidence narration to
   PRD §9 or technical design. Reject evidence-handling instructions that were
   promoted to product rules or scenarios.
7. Check request-to-story coverage without treating rule-to-scenario coverage
   as total input-requirement coverage.
8. Check that the final §9 appendix agrees with the working packet's
   `productSegmentRevision`, `storiesRevision`, `impactRevision`,
   `impactStatus`, freshness, and coverage limits, while
   §0–§8 and frontmatter remain free of detailed impact evidence.
9. Build a final Macro Approval Gate table in runtime context with one row per
   approval-critical promise: product ids, promised result, evidence read,
   blocking limit, and disposition (`PROVEN`, `NARROWED`, or `BLOCKED`). Verify
   every §9-8 limit has affected ids and `BLOCKING | NON_BLOCKING`; any BLOCKING
   row or BLOCKED promise makes the verdict `NEEDS_WORK`.
10. Reject success hypotheses whose target is only directional or deferred.
    Require a numeric target or executable pass/fail decision rule. A bounded
    baseline-collection window plus an exact post-collection decision rule can
    satisfy this when the current product promise does not depend on the number;
    its instrumentation stays design-owned. Otherwise keep the linked `O-*`
    open and the verdict `NEEDS_WORK`.
11. Compare every `H-*` pass/fail rule with every linked normal and exception
    scenario. Distinguish notification attempted, provider accepted, delivered,
    and user-observed outcomes; a channel-failure scenario cannot coexist with
    an unqualified zero-miss guarantee. Any semantic contradiction forces
    `NEEDS_WORK` even when ids and trace tables are complete.
12. If a fix changes PRD §0–§8 or stories, reset both statuses to draft and rerun
   impact before the final review. Never leave §9 bound to older product bytes.

Set the final verdict to `NEEDS_WORK` when blocking findings remain. A required
input that cannot be read inside the MCP boundary is a requirement-coverage gap,
not permission to claim completeness. Preserve it in the review result and keep
both files draft. `PASS` means the authored pair is internally reviewable; it
does not mean user approval.

## Answer Contract

Use this default response shape. The first review surface is product language;
do not lead with full markdown or internal ids:

```text
## 이번에 바뀌는 것
- <사용자 관점 변화 3~5개>

## 제가 적용한 추천안
- <평이한 결정과 이유>

## 확인이 필요한 충돌
- <없음 또는 진짜 PRODUCT 충돌 하나>

이 방향으로 기획을 승인할까요?

## 저장된 기획 문서
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/prd.md
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/user_stories.md

조사 근거는 기획서 마지막에 함께 저장했습니다.

## 자체 검토 결과
<검토 가능 또는 보완 필요, 승인을 막는 내용, 설계에서 이어서 정할 내용>
```

The saved files retain full `R-*`, `AC-*`, `D-*`, `A-*`, `O-*`, `H-*`,
evidence, and design handoff detail. Show the full markdown in chat only when
the user asks for it.

Before sending the first review, perform a wording audit over the chat response:
replace code-field names, English implementation labels, and backticked
identifiers with ordinary product language. In this workflow, write `가장
우선인 공지` instead of ``priority`` or `priority가 가장 낮은 공지`. Exact
identifiers remain in the saved evidence and design handoff, not in the
non-developer approval summary.
The final product approval question is not a discovery question and does not
consume or replenish the two-round Product Discovery Budget.
Translate internal review statuses too: use `검토 가능` or `보완 필요`, not
`PASS`, `NEEDS_WORK`, `partial`, `blocking finding`, `coverage gap`, `Local
persistence`, or `Self Review`. Keep exact filenames only where the user needs
the saved-document links. Show raw statuses and evidence labels only on request.

Use "확인됨" only for exact MCP reads. Use "후보", "근거상 보임", or
"추가 확인 필요" for search candidates, partial evidence, inferred behavior, or
missing source parity.

## Stop Conditions

- MCP tools are not configured.
- Minimum retrieval tools are missing.
- The selected retrieval branch reports a required MCP capability gap.
- Local filesystem write access is unavailable or the target directory cannot be
  created.
- The impact skill cannot write or verify the selected `prd.md §9` artifact.
- Design feasibility feedback disproves a promised result, but the affected
  product rule/story has not been revised and explicitly reapproved.
- The user asks for analysis, sync, generated-docs, export, project mutation, or
  memory writes from this MCP route.

## Common Mistakes

| Mistake | Required behavior |
| --- | --- |
| Drafting from one search hit | Run `platty-mcp-retrieval` and its full-cycle ladder first. |
| Recreating retrieval logic here | Keep retrieval in `platty-mcp-retrieval`; this skill converts evidence to SDD documents. |
| Treating glossary normalization as proof | Use it only for routing; exact document/spec/source reads prove claims. |
| Leaving stories behind a gate | Always draft `user_stories.md` with `prd.md`; keep it draft and preserve assumptions when approval is missing. |
| Formatting the impact dossier here | Invoke `platty-mcp-impact-analysis`; the impact skill alone formats and writes `prd.md §9`. |
| Returning only instructions | Persist `prd.md` and `user_stories.md` locally in `~/.platty/specs/<projectId>/...`; verify both files and PRD §9 before final response. |
| Returning a prose SDD summary | Apply the request/stories templates and include all required sections. |
| Treating story Rule coverage as complete requirement coverage | Compare every user input and MCP evidence source in Requirement Coverage. |
| Skipping retrieval audit because files are readable | Import the Final Route Audit and return `NEEDS_WORK` when a required rung is missing. |
| Asking the non-developer to choose an API, table, field, query, ordering implementation, or tie-breaker | Keep the visible result in product scope and preserve technical alternatives in the Design Decision Handoff. |
| Re-asking a specific user direction that matches a safe existing flow | Apply it as the recommended product decision, draft first, and include it in the final product approval summary. |
| Running the full retrieval ladder before clarifying a raw, materially different user-visible scope | Ask one initial product-intent question, narrow the Search Brief from the answer, and then retrieve only the selected branch. |
| Using an existing reward pattern to choose an unstated time-based reward cadence | Ask once-versus-repeat before broad evidence; existing behavior may inform the recommendation but cannot replace the user's visible earning-policy decision. |
| Treating the final approval prompt as the second discovery round | Keep approval separate; discovery allows an optional initial question and one optional evidence-informed follow-up. |
| Reimplementing product revision hashes or trimming parsed bodies during approval | Use `sdd-artifacts.mjs` with `parseSddArtifact`, `computeRequestRevision`, and `computeStoriesRevision`; on any revision mismatch, refresh §9 through impact analysis and keep both files `draft` until a later approval. |
| Leaving ``priority`` or another code-field name in the first review | Rewrite it as the user-visible result, such as `가장 우선인 공지`; keep the exact identifier only in persisted evidence. |
| Ending the plain-language review with `Local persistence`, `Self Review`, `PASS`, or coverage terminology | Use `저장된 기획 문서` and `자체 검토 결과`, then say `검토 가능` or `보완 필요` and describe the remaining work in ordinary language. |
| Letting design silently weaken an approved product promise | Reopen the affected product rows, reset both files to draft, regenerate §9, and require later explicit approval before ready design or tasks. |

## Verification

Use `references/pressure-scenarios.md` when testing this skill.
