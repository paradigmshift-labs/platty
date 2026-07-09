---
name: platty-mcp-sdd-spec
description: Use when creating locally saved MCP-grounded SDD request and story drafts from a product idea, feature request, PRD need, policy change, or requirements discussion.
---

# Platty MCP SDD Spec

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Produce MCP-grounded SDD documents and persist them locally. This skill gathers
evidence through `platty-mcp-retrieval`, drafts `request.md` and `stories.md`,
then writes both files under `~/.platty/specs/<projectId>/...`.

## Required Sub-Skills

1. Use `using-platty-mcp` for MCP capability and project context.
2. Use `platty-mcp-retrieval` for all evidence gathering.

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
7. Draft `request.md` content by applying the request template.
8. Always draft `stories.md` with `request.md` by applying the stories template.
   If the request has unresolved questions, keep stories as draft and surface the
   assumptions used to split scenarios.
9. Persist both files locally under the same SDD directory.
10. Verify both files are readable before returning the final response.

## Template Contract

`request.md` and `stories.md` are not free-form summaries. They must follow the
template references exactly enough that designers, planners, and implementation
agents can review them without reshaping them.

Persist durable workflow metadata needed by later SDD stages in frontmatter:
`projectId`, `outputLanguage`, `sourceCommit`, `sotExportedAt`,
`evidenceBoundary`, and `contextStatus`. Keep runtime-only metadata such as
`localPersistenceTarget`, raw MCP tool payloads, and transient candidate lists in
the SDD packet, not in the drafted file frontmatter.

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
```

`stories.md` uses `references/stories-shape.md`, starts with `# User Stories`,
uses `US-NN` story blocks with Given/When/Then scenarios, and ends with
Traceability.

## Local Persistence

Persist `request.md` and `stories.md` to:

```text
~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/
```

The selected `projectId` must come from MCP project context or the resolved
Platty project. The slug should be stable and human-readable from the request
title or raw idea. Use the current year-month for `<YYYY-MM>` unless the user
provided a spec id or date.

Persistence rules:

- Create the target directory if it does not exist.
- Write `requestMarkdown` to `request.md`.
- Write `storiesMarkdown` to `stories.md`.
- Update both files together when regenerating the same spec; do not leave one
  stale.
- Do not delete unrelated files in the directory.
- Verify both files are readable after writing and include both paths in the
  final response.

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
- requestMarkdown
- storiesMarkdown
- localPersistenceTarget
```

`localPersistenceTarget` is the mandatory local write target:

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

## Answer Contract

Use this default response shape:

```text
## request.md draft
<full markdown>

## stories.md draft
<full markdown>

## Local persistence
Saved:
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/request.md
- ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/stories.md
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
- The user asks for analysis, sync, generated-docs, export, project mutation, or
  memory writes from this MCP route.

## Common Mistakes

| Mistake | Required behavior |
| --- | --- |
| Drafting from one search hit | Run `platty-mcp-retrieval` and its full-cycle ladder first. |
| Recreating retrieval logic here | Keep retrieval in `platty-mcp-retrieval`; this skill converts evidence to SDD documents. |
| Treating glossary normalization as proof | Use it only for routing; exact document/spec/source reads prove claims. |
| Leaving stories behind a gate | Always draft `stories.md` with `request.md`; keep it draft and preserve assumptions when approval is missing. |
| Returning only instructions | Persist both files locally in `~/.platty/specs/<projectId>/...` and verify both files before final response. |
| Returning a prose SDD summary | Apply the request/stories templates and include all required sections. |

## Verification

Use `references/pressure-scenarios.md` when testing this skill.
