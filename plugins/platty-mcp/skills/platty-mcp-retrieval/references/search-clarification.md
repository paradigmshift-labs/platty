# MCP Search Clarification

Use this reference when `platty-mcp-retrieval` says to build a runtime Search
Brief before choosing a branch.

## Search Brief Triggers

Create a Search Brief when any trigger is present:

- the core noun is polysemous, domain-specific, or team-specific;
- Korean, English, product vocabulary, or code identifiers may not line up;
- the question asks for all, every, which screens, each, the whole flow,
  difference, impact, what breaks, or another broad inventory;
- the question can be read as business meaning or implementation fact;
- one `ssot_search`, `document_search`, `spec_search`, `code_search`, or graph
  hit could look sufficient while missing the target set;
- raw and normalized vocabulary candidates may point to different concepts.

Exact source-near questions that name a specific API, screen, event, schedule,
file, symbol, spec id, or source anchor can bypass the gate unless one trigger
still applies.

## Adaptive SDD Product Interview

For an SDD product caller, use one question at a time with no arbitrary maximum:

- **Initial intent:** before deep or full-cycle retrieval, ask one question only
  when the raw request itself names two materially different user-visible
  scopes or outcomes and evidence cannot decide what the user meant. Use no
  source claim in the reason. Narrow the Search Brief from the answer.
  A time-based reward threshold with no stated cadence always qualifies: ask
  once-per-visit/window versus repeated-threshold earning before broad evidence.
  Existing reward behavior may inform a recommendation later but cannot choose
  this user-visible policy.
- **Post-research interview:** after MCP evidence, rank remaining tied `PRODUCT`
  questions. Ask the highest-priority one with an evidence-grounded
  recommendation and visible consequence, research the boundary changed by its
  answer, then reclassify before asking anything else.

The route may ask zero, one, or many questions. Never ask two questions in one
message. Continue only while `remainingProductDecisions` is non-empty and stop
when there are zero unresolved `PRODUCT` decisions. Final product approval is a
separate gate. `FACT` and `DESIGN` items are not interview questions.

## Runtime Rules

- Keep the Search Brief as runtime working context only. Do not store it in
  Platty memory, local files, DB tables, or MCP artifacts.
- For an SDD caller, classify every unresolved item through
  `../../using-platty-mcp/references/sdd-question-ownership.md` as `FACT`,
  `PRODUCT`, or `DESIGN`. Split mixed items rather than assigning the whole
  question to the most technical part.
- When Korean/English vocabulary may not line up, split the raw phrase into
  Korean candidate terms and English candidate terms. Preserve both lists,
  search both Korean candidate terms and English candidate terms, and record
  which glossary/search-assist queries were attempted. A blank Korean
  `glossary_translate` result is not a stop condition while plausible English
  candidates remain; call `glossary_list` for candidate discovery before
  translating additional Korean/English candidates.
- Use `glossary_list` before asking the user when the request is a vocabulary
  inventory, needs every alias, remains ambiguous after translation, or a
  plausible `glossary_translate` query is blank. Traverse all pages only when
  completeness is required; otherwise stop after the candidate set is clear.
- Except for the initial intent question above, use configured read-only
  MCP tools to reduce ambiguity before asking the user. For vocabulary, choose `glossary_list` for inventory, every-alias,
  unresolved ambiguity, broad comparison, or blank/conflicting translation; use
  `glossary_translate` for an exact raw phrase or candidate term. Then continue
  with `project_overview_get`, `epic_list` / `epic_get`, `document_list` /
  `document_item_list`, `spec_list`, or `spec_get` as the branch requires.
- At each post-research interview round, ask exactly one clarifying question only when MCP evidence leaves two or
  more equally plausible interpretations, choosing one would hide a meaningful
  answer branch, and the choice is a `PRODUCT` decision with materially
  different user-visible consequences rather than a fact available from MCP
  evidence or a technical implementation choice. Include the recommended
  interpretation in plain product language. Record the answer in
  `decisionLedger`, research the affected boundary, update
  `productInterviewRounds`, and re-rank `remainingProductDecisions`.
- Do not treat API, DB, field, enum, migration, cache, query, ordering
  implementation, tie-breaker, component, file, test, deployment, or rollback
  alternatives as tied interpretations. Preserve them in the design decision
  handoff. Technical possibility alone never creates a product clarification.
- When the user's visible result is specific and exact evidence confirms a safe
  existing host flow, return that flow as the recommended product assumption.
  Stop expanding adjacent implementation candidates after all required rungs
  for that selected branch are complete.
- For long retrieval tasks, restate the Search Brief in a short progress update
  whenever the selected interpretation, branch, or MCP route changes. This is a
  compaction defense, not a product storage feature.

## SDD Ownership Extension

Append these runtime-only fields for an SDD caller:

```text
- Ownership by unresolved item: FACT | PRODUCT | DESIGN
- Recommended product assumption:
- Design decision handoff:
- User decision needed: none | current PRODUCT question
- decisionLedger:
- productInterviewRounds:
- remainingProductDecisions:
- stopReason: zero unresolved PRODUCT decisions | waiting for product answer | capability gap
```

If only `DESIGN` items remain, `User decision needed` is `none`. Return the
evidence packet to the SDD caller so it can draft first.

## Exact Anchor Example

`GET /api/campaigns/:id 응답 shape이 뭐야?` goes directly to the exact API
branch unless the endpoint maps to multiple specs.
