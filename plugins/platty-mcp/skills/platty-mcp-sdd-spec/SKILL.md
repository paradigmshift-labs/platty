---
name: platty-mcp-sdd-spec
description: Use when creating locally saved MCP-grounded SDD request and story drafts from a product idea, feature request, PRD need, policy change, or requirements discussion.
---

# Platty MCP SDD Spec

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Produce MCP-grounded SDD documents and persist them locally. This skill gathers
evidence through `platty-mcp-retrieval`, drafts `prd.md` and `user_stories.md`,
then uses `platty-mcp-impact-analysis` to persist the impact snapshot under
`~/.platty/specs/<projectId>/...`.

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
9. Review the product requirements for policy, journey, data, EPIC, API, and
   screen impact. Build or reuse `impactSeedPacket` from the retrieval results,
   then invoke `platty-mcp-impact-analysis`. It returns the formatted §9
   appendix plus `impactRevision`, status, source parity, and coverage limits.
   Missing workspace parity creates partial impact without erasing the product drafts.
10. Append the returned appendix as the final §9 of `prd.md`; detailed
    discovery, freshness, graph, and source evidence remain there.
11. Run Self Review across the raw idea, all available requirement inputs, MCP
   evidence, `prd.md`, `user_stories.md`, and the impact result.
12. Run `review -> revise -> review`; retain the final Requirement Coverage,
    Search Route Audit, and cross-document findings in §9, not in §0–§8.
13. Persist the revised `prd.md` and `user_stories.md` under the same SDD
    directory, then verify both files are readable and their shared project and
    freshness metadata agree.

## Template Contract

`prd.md` and `user_stories.md` are not free-form summaries. They must follow the
template references exactly enough that designers, planners, and implementation
agents can review them without reshaping them.

Persist durable workflow metadata needed by later SDD stages in frontmatter:
`projectId`, `outputLanguage`, `sourceCommit`, `sotExportedAt`,
`evidenceBoundary`, and `contextStatus`. Keep runtime-only metadata such as
`localPersistenceTarget`, raw MCP tool payloads, and transient candidate lists in
the SDD packet, not in the drafted file frontmatter.

Do not include raw MCP payloads, shell transcripts, or source bodies. The
evidence table, review findings, and source references belong only in the final
§9 appendix; §0–§8 remain planner-facing.

`prd.md` uses `references/request-shape.md` and includes these sections in
order:

```text
§0 Impact
§1 Customer Task
§2 Current Situation
§3 Limits
§4 Solution
§5 Rules
§6 Confirmed Decisions
§7 Open Questions
§8 Validation Hypotheses
§9 Impact evidence appendix
```

`user_stories.md` uses `references/stories-shape.md`, starts with `# 사용자 스토리`,
uses `US-NN` story blocks with Given/When/Then scenarios, and ends with the
Korean rule-to-scenario connection table.

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
- The impact skill formats the §9 appendix and returns its revision, status,
  parity, commits, and coverage limits.
- Write `requestMarkdown` with that appendix to `prd.md`.
- Write `storiesMarkdown` to `user_stories.md`.
- Update the request and stories together when regenerating the same spec; do
  not leave either stale.
- Do not delete unrelated files in the directory.
- Verify both files are readable after writing and share `projectId` and
  `contextStatus`. Use PRD frontmatter for source commits and impact freshness.
  Include both paths in the final response.

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

Read `references/request-shape.md` before drafting request content. If the
SDD packet has unresolved assumptions or unanswered decisions, keep the
frontmatter `status` as `draft` and preserve the unresolved items in §7 instead
of inventing closure.

## Stories Draft

Always draft `user_stories.md` with `prd.md`. Approval controls whether the files
can move from `draft` to `approved`; it does not control whether
`user_stories.md` exists.

Read `references/stories-shape.md` before drafting stories content. If
`prd.md` has open questions or assumptions, make those visible in
`user_stories.md` and trace which stories would change if the answers change.

## Self Review Gate

Self Review is mandatory after the compact impact link and both drafts exist. It
must not move either file to `approved`; explicit user approval remains the only
approval gate.

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
4. Check request-to-story coverage without treating rule-to-scenario coverage
   as total input-requirement coverage.
5. Check that the final §9 appendix agrees with `impactRevision`,
   `impactStatus`, freshness, and coverage limits, while §0–§8 remains free of
   detailed impact evidence.
6. Revise both drafts for every fixable blocking finding, then review the
   revised pair again.

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
