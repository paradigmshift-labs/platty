# MCP SDD Spec Pressure Scenarios

Use these scenarios to test whether `platty-mcp-sdd-spec` preserves retrieval
discipline, SDD draft status, and local file persistence boundaries.

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

## Scenario 2: Source Parity Gap

User asks for implementation impact, but source parity tools are missing.

Failure to prevent:

- falling back to local SOT files or local CLI;
- claiming exact implementation impact.

Expected route:

```text
carry source impact as coverage limit
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
write request.md and stories.md under ~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/
verify both files are readable
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
