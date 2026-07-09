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

## Runtime Rules

- Keep the Search Brief as runtime working context only. Do not store it in
  Platty memory, local files, DB tables, or MCP artifacts.
- When Korean/English vocabulary may not line up, split the raw phrase into
  Korean candidate terms and English candidate terms. Preserve both lists,
  search both Korean candidate terms and English candidate terms, and record
  which glossary/search-assist queries were attempted. A blank Korean
  `glossary_translate` result is not a stop condition while plausible English
  candidates remain.
- Use configured read-only MCP tools to reduce ambiguity before asking the
  user. Start with `glossary_translate`, `project_overview_get`, `epic_list` /
  `epic_get`, `document_list` / `document_item_list`, `spec_list`, or
  `spec_get` as the branch requires.
- Ask exactly one clarifying question only when MCP evidence leaves two or
  more equally plausible interpretations, choosing one would hide a meaningful
  answer branch, and the choice is product/user intent rather than a fact
  available from MCP evidence. Include the recommended interpretation in the
  question.
- For long retrieval tasks, restate the Search Brief in a short progress update
  whenever the selected interpretation, branch, or MCP route changes. This is a
  compaction defense, not a product storage feature.

## Exact Anchor Example

`GET /api/campaigns/:id 응답 shape이 뭐야?` goes directly to the exact API
branch unless the endpoint maps to multiple specs.
