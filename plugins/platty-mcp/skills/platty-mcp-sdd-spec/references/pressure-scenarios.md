# MCP SDD Spec Pressure Scenarios

Use these scenarios to test whether `platty-mcp-sdd-spec` preserves retrieval
discipline, SDD draft status, impact-artifact ownership, and local file
persistence boundaries.

## Scenario 1: Search-First Request Draft

User asks:

```text
MCP로 체험단 참여 제한 정책 변경 request.md 초안 만들어줘.
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
draft request.md and stories.md
-> build/reuse impactSeedPacket
-> platty-mcp-impact-analysis writes partial impact.md
-> add a compact impact.md link with partial status and the coverage limit
-> carry source impact as coverage limit
draft only product/spec claims supported by MCP evidence
```

## Scenario 2A: Bilingual Retrieval Terms In Handoff

User asks:

```text
MCP로 결제 쿠폰 기능 request.md 초안 만들어줘.
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

- returning only `request.md` plus a stories gate;
- hiding unresolved assumptions in generated stories.

Expected route:

```text
return request.md draft
return stories.md draft
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
produce request.md and stories.md markdown
resolve localPersistenceTarget
impact skill writes or refreshes impact.md under ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/
SDD spec writes request.md and stories.md under the same directory
verify all three files are readable and share `projectId` and `contextStatus`
verify impact metadata uses `sourceCommits` and `retrievedAt`
derive spec identity from `impactArtifactPath` and the shared SDD directory
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
MCP 근거로 request.md랑 stories.md 초안까지 만들어줘. 문서 양식은 SDD 템플릿으로 맞춰줘.
```

Failure to prevent:

- returning a prose requirements summary instead of `request.md`;
- using generic numbered sections instead of `§0 Impact` through `§8 Validation Hypotheses`;
- drafting stories without `US-NN`, Given/When/Then scenarios, and Traceability.

Expected route:

```text
read request-shape.md before request drafting
read stories-shape.md before stories drafting
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
- writing `impact.md` from `impactMarkdown` in the SDD spec skill;
- treating the impact artifact as an optional attachment.

Expected route:

```text
build/reuse impactSeedPacket
-> invoke platty-mcp-impact-analysis
-> impact skill alone writes or refreshes impact.md
-> SDD spec receives impactArtifactPath, impactStatus, and sourceParity
-> SDD spec writes only request.md and stories.md
```

## Scenario 10: Three-File Verification

The impact skill has returned a verified artifact path and the SDD spec has
written its drafts.

Failure to prevent:

- returning after verifying only request.md and stories.md;
- accepting mismatched project, spec, or freshness metadata;
- omitting `impact.md` from the answer paths.

Expected route:

```text
verify impact.md, request.md, and stories.md are readable
-> verify the three files share `projectId` and `contextStatus`
-> verify impact source metadata uses `sourceCommits` and impact freshness uses `retrievedAt`
-> derive spec identity from `impactArtifactPath` and the shared SDD directory
-> return all three paths
```

## Scenario 11: Open-Assumption Handoff

The request has open assumptions when impact investigation completes.

Failure to prevent:

- promoting the impact result to a confirmed decision;
- copying the full impact matrix, raw payload, shell transcript, or source bodies
  into request.md;
- hiding partial source parity or coverage limits.

Expected route:

```text
keep assumptions in §7 and stories draft
-> keep detailed discovery in impact.md and add only its compact status link to request.md
-> point to impact.md with status and the user-relevant coverage limit
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
