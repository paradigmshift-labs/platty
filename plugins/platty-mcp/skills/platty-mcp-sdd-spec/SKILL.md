---
name: platty-mcp-sdd-spec
description: Use when creating locally saved MCP-grounded SDD request and story drafts from a product idea, feature request, PRD need, policy change, or requirements discussion.
---

# Platty MCP SDD Spec

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Produce MCP-grounded SDD documents and persist them locally. This skill gathers
evidence through `platty-mcp-retrieval`, drafts `request.md` and `stories.md`,
then uses `platty-mcp-impact-analysis` to persist the impact snapshot under
`~/.platty/specs/<projectId>/...`.

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
6. Build an SDD packet from direct evidence, inference boundaries,
   coverage limits, assumptions, confirmed decisions, and open questions.
7. Draft `request.md` content through §8 by applying the request template.
8. Always draft `stories.md` with `request.md` by applying the stories template.
   If the request has unresolved questions, keep stories as draft and surface the
   assumptions used to split scenarios.
9. Review the product requirements for policy, journey, data, EPIC, API, and
   screen impact. Build or reuse `impactSeedPacket` from the retrieval results,
   then invoke `platty-mcp-impact-analysis`. The impact skill writes or refreshes
   `impact.md` and returns `impactDossier`, `impactStatus`, `sourceParity`, and
   the verified `impactArtifactPath`. Missing workspace parity creates partial
   impact without erasing the product drafts.
10. Append the compact Engineering Discovery Handoff to `request.md` after §8,
    using the impact result; then complete §9 Self Review.
11. Run Self Review across the raw idea, all available requirement inputs, MCP
   evidence, `request.md`, `stories.md`, and the impact result.
12. Run `review -> revise -> review`; record the final Requirement Coverage,
    Search Route Audit, and cross-document findings in the drafts.
13. Persist the revised `request.md` and `stories.md` under the same SDD
    directory. SDD spec must not format or write impact.md.
14. Verify all three files are readable. Confirm that the three artifacts share
    `projectId` and `contextStatus`; use `impact.md`'s `sourceCommits` and the
    handoff's Source commits for source metadata, and use its `retrievedAt` for
    impact freshness. Derive the spec identity from the verified
    `impactArtifactPath` and confirm that `impact.md`, `request.md`, and
    `stories.md` are in the same shared SDD directory before returning the final
    response. Do not require `impact.md` to contain the request files' `sourceCommit`
    or `sotExportedAt` fields.

## Template Contract

`request.md` and `stories.md` are not free-form summaries. They must follow the
template references exactly enough that designers, planners, and implementation
agents can review them without reshaping them.

Persist durable workflow metadata needed by later SDD stages in frontmatter:
`projectId`, `outputLanguage`, `sourceCommit`, `sotExportedAt`,
`evidenceBoundary`, and `contextStatus`. Keep runtime-only metadata such as
`localPersistenceTarget`, raw MCP tool payloads, and transient candidate lists in
the SDD packet, not in the drafted file frontmatter.

Append `## Engineering Discovery Handoff` immediately after §8 in `request.md`.
Use the compact shape in `references/request-shape.md`; do not include the full
impact matrix, raw MCP payload, shell transcript, or source bodies in the
request.

`request.md` uses `references/request-shape.md` and includes these sections in
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
Engineering Discovery Handoff
§9 Self Review
```

`stories.md` uses `references/stories-shape.md`, starts with `# User Stories`,
uses `US-NN` story blocks with Given/When/Then scenarios, and ends with
Traceability followed by Self Review.

## Local Persistence

All three artifacts use this directory:

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
- The impact skill writes or refreshes `impact.md` first and returns its verified
  `impactArtifactPath`, `impactStatus`, and `sourceParity`.
- Write `requestMarkdown` to `request.md`.
- Write `storiesMarkdown` to `stories.md`.
- SDD spec writes only `request.md` and `stories.md`; it does not format or
  write `impact.md`.
- Update the request and stories together when regenerating the same spec; do
  not leave either stale.
- Do not delete unrelated files in the directory.
- Verify all three files are readable after writing and share `projectId` and
  `contextStatus`. Use `impact.md`'s `sourceCommits` and the Engineering
  Discovery Handoff's Source commits for source metadata, and its `retrievedAt`
  for impact freshness. Derive the spec identity from `impactArtifactPath` and
  the shared SDD directory containing `impact.md`, `request.md`, and
  `stories.md`; do not require nonexistent `spec id`, `sourceCommit`, or
  `sotExportedAt` fields in `impact.md`. Include all paths in the final response.

The MCP impact work is read-only except for the selected `impact.md`. Do not
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
- impactArtifactPath
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

Always draft `stories.md` with `request.md`. Approval controls whether the files
can move from `draft` to `approved`; it does not control whether
`stories.md` exists.

Read `references/stories-shape.md` before drafting stories content. If
`request.md` has open questions or assumptions, make those visible in
`stories.md` and trace which stories would change if the answers change.

## Self Review Gate

Self Review is mandatory after the request handoff and both drafts exist. It
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
5. Check that the compact handoff agrees with `impactArtifactPath`,
   `impactStatus`, `sourceParity`, seed EPICs/specs, freshness, source commits,
   and coverage limits without copying impact evidence into the request.
6. Revise both drafts for every fixable blocking finding, then review the
   revised pair again.

Set the final verdict to `NEEDS_WORK` when blocking findings remain. A required
input that cannot be read inside the MCP boundary is a requirement-coverage gap,
not permission to claim completeness. Preserve it in §9 and keep both files
draft. `PASS` means the authored pair is internally reviewable; it does not mean
user approval.

## Answer Contract

Use this default response shape:

```text
## request.md draft
<full markdown>

## stories.md draft
<full markdown>

## Local persistence
Saved:
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/impact.md
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/request.md
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/stories.md

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
- The impact skill cannot write or verify the selected `impact.md` artifact.
- The user asks for analysis, sync, generated-docs, export, project mutation, or
  memory writes from this MCP route.

## Common Mistakes

| Mistake | Required behavior |
| --- | --- |
| Drafting from one search hit | Run `platty-mcp-retrieval` and its full-cycle ladder first. |
| Recreating retrieval logic here | Keep retrieval in `platty-mcp-retrieval`; this skill converts evidence to SDD documents. |
| Treating glossary normalization as proof | Use it only for routing; exact document/spec/source reads prove claims. |
| Leaving stories behind a gate | Always draft `stories.md` with `request.md`; keep it draft and preserve assumptions when approval is missing. |
| Formatting the impact dossier here | Invoke `platty-mcp-impact-analysis`; the impact skill alone formats and writes `impact.md`. |
| Returning only instructions | Persist all three artifacts locally in `~/.platty/specs/<projectId>/...` and verify all three files before final response. |
| Returning a prose SDD summary | Apply the request/stories templates and include all required sections. |
| Treating story Rule coverage as complete requirement coverage | Compare every user input and MCP evidence source in Requirement Coverage. |
| Skipping retrieval audit because files are readable | Import the Final Route Audit and return `NEEDS_WORK` when a required rung is missing. |

## Verification

Use `references/pressure-scenarios.md` when testing this skill.
