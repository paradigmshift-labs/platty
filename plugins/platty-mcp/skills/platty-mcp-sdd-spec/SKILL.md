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

All reader-facing output is Korean. Keep code identifiers, API paths, file
paths, status values, and quoted evidence in their original form.

## Required Sub-Skills

1. Use `using-platty-mcp` for MCP capability and project context.
2. Use `platty-mcp-retrieval` for all evidence gathering.
3. Use `platty-mcp-impact-analysis` for a product-scope review covering policy,
   journey, data, EPIC, API, and screen impact, then build the impact snapshot
   after the request and story drafts exist.

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

## Operating Flow

1. Confirm MCP capability tier and project context through `using-platty-mcp`.
2. Route the idea through `platty-mcp-retrieval`.
3. Require a Search Brief for broad, domain-term, policy, data, journey, or
   impact ideas.
4. Require the retrieval full-cycle ladder before SDD product claims.
5. Stop if minimum retrieval or a selected branch's required evidence surface is
   missing.
6. Require the retrieval packet to distinguish document-map evidence resolved
   with `document_resolve` from candidates, then build an SDD packet from direct evidence, inference boundaries,
   coverage limits, assumptions, confirmed decisions, and open questions.
7. Draft `prd.md` content through §8 by applying the request template.
8. Always draft `user_stories.md` with `prd.md` by applying the stories template.
   If the request has unresolved questions, keep stories as draft and surface the
   assumptions used to split scenarios.
9. Run product Self Review across the raw idea, requirement inputs, retrieval
   packet, PRD §0–§8, and all stories. Apply `review -> revise -> review` until
   the product pair is internally consistent. Do not run impact against a product
   body that may still be revised.
10. Persist both draft files together. The PRD may contain the §9 heading and a
    pending marker at this point; no impact claim may be made from that marker.
11. Compute the finalized `productSegmentRevision` from PRD §0–§8 and
    `storiesRevision` from stable stories frontmatter and body, excluding the
    mutable status. Review policy,
    journey, data, EPIC, API, and screen impact, then invoke
    `platty-mcp-impact-analysis` with both revisions and the seed packet.
12. Impact analysis alone replaces the final §9 and binds the dossier to those
    two revisions. Reread `prd.md` and verify the bound revisions,
    `impactRevision`, status, freshness, source parity, and coverage limits.
13. Run final cross-document Self Review without rewriting §0–§8 or stories. If
    a product change is required, update both product files, reset their status
    to `draft`, and restart from step 9 so impact is regenerated for the new
    revisions. Persist and read back the final pair before reporting completion.

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
stay attached to `A-*` or `O-*`; do not invent a number to complete the table.

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
Self Review result. Recompute `productSegmentRevision` and `storiesRevision`,
verify that PRD §9 is bound to both values and has no blocking coverage finding,
then change both statuses to `approved` in one operation. Read both files back
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
   overlays when relevant, `document_resolve`, selected `spec_get` plus
   `spec_resolve`, source snippets for exact claims, and unread surfaces.
3. Check statuses, enums, thresholds, metrics, scope, and terminology for
   contradictions or unsupported promotion from inference to decision.
4. Verify that the PRD §0 approval summary contains only existing §3/§5/§7/§8
   items, every closed `O-*` points to its resolving `D-*`, and each `H-*` has a
   usable success criterion or an explicit `A-*`/`O-*` gap.
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
9. If a fix changes PRD §0–§8 or stories, reset both statuses to draft and rerun
   impact before the final review. Never leave §9 bound to older product bytes.

Set the final verdict to `NEEDS_WORK` when blocking findings remain. A required
input that cannot be read inside the MCP boundary is a requirement-coverage gap,
not permission to claim completeness. Preserve it in the review result and keep
both files draft. `PASS` means the authored pair is internally reviewable; it
does not mean user approval.

## Answer Contract

Use this default response shape:

```text
## prd.md draft
<full markdown>

## user_stories.md draft
<full markdown>

## Local persistence
Saved:
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/prd.md
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/user_stories.md

Impact evidence is the final §9 of `prd.md`; it is not a separate path.

## Self Review
<verdict, blocking findings, warnings, and remaining coverage gaps>
```

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

## Verification

Use `references/pressure-scenarios.md` when testing this skill.
