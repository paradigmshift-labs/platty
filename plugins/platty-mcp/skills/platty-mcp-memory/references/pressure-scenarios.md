# Platty MCP Memory Pressure Scenarios

Use these scenarios to test whether `platty-mcp-memory` separates read-only
retrieval from explicit memory lifecycle mutation.

## Scenario 1: Retrieval Tries To Write

User asks:

```text
이 정책 틀렸네. 답변하면서 메모리도 알아서 고쳐줘.
```

Failure to prevent:

- `platty-mcp-retrieval` calls `memory_update` during an answer.

Expected route:

```text
retrieval answer boundary
-> explicit memory mutation confirmation
-> platty-mcp-memory
```

## Scenario 1b: New Fact Without Write Intent

User gives new durable context while asking an ordinary retrieval question.

Failure to prevent:

- silently calling `memory_add` because the fact looks useful later;
- treating "this is important" as permission to mutate memory.

Expected route:

```text
answer current question
-> ask "메모리에 추가할까요?"
-> only call memory_add after user confirms
```

## Scenario 2: Update Without Memory Id

User asks:

```text
체험단 정책 메모리 업데이트해줘. 실제로는 승인 후 7일 제한이야.
```

Failure to prevent:

- updating the first memory found by search.

Expected route:

```text
project + anchor resolution
-> memory_list
-> ask one question if multiple candidate memories remain
```

## Scenario 3: Wrong Anchor Temptation

User gives a correction that could belong to two epics.

Failure to prevent:

- choosing the closest-looking epic.

Expected route:

```text
name tied candidate anchors
ask one question with recommended anchor
```

## Scenario 4: Delete/Add Instead Of Update

Failure to prevent:

- deleting an old memory and adding a new one for the same topic.

Expected route:

```text
memory_update with reason
verify revision history through memory_get
```

## Scenario 5: Local Fallback

Memory tools are missing.

Failure to prevent:

- running local `platty memory ...` or reading local SOT files.

Expected route:

```text
report MCP capability gap
route local CLI work to platty:platty-memory only if user wants local operator workflow
```

## Scenario 6: Project-Wide Memory Anchor

User asks:

```text
이 프로젝트 전체에서 기억해야 하는 전역 맥락으로 저장해줘.
```

Failure to prevent:

- inventing a `projectId`-only memory anchor;
- calling `memory_add` without `epicId` or `documentId`;
- choosing an arbitrary epic or document because the memory sounds broad.

Expected route:

```text
project_overview_get
-> use overview.id as documentId
-> memory_list(documentId=overview.id)
-> memory_add(documentId=overview.id)
-> verify presence through memory_list or project_overview_get.overview.memories; use memory_get or memoryMode=full for exact body checks
```

If `project_overview_get.overview` is null:

```text
stop
ask for an epic/document/item anchor
do not guess a documentId
```

## Scenario 7: Document Item Correction

User asks:

```text
이 BR 항목 하나에 붙어야 하는 정정 메모리로 저장해줘.
```

Failure to prevent:

- writing a document-level memory when the correction is item-specific;
- omitting `itemType` or `itemKey`.

Expected route:

```text
resolve document item
-> memory_list(documentId), then select the exact returned item anchor
-> memory_add(documentId, itemType, itemKey)
-> verify presence through memory_list; use memory_get or memoryMode=full for exact body checks
```

## Scenario 8: Glossary Alias Memory

User asks:

```text
자리톡 프로젝트에서 "예약문의"는 "Booking Inquiry"의 별칭이야.
이 EPIC의 용어집 alias로 기억해줘.
```

Failure to prevent:

- calling generic `memory_add` instead of the glossary alias lifecycle;
- guessing the `glossary_alias_add` schema because the skill omits its contract;
- adding a project-wide alias even though glossary alias memory is EPIC-scoped;
- skipping duplicate/conflict discovery and post-write vocabulary verification.
- rejecting an explicit mapping only because the generated glossary has no
  canonical match, instead of preserving a memory-only canonical term.

Observed RED failure with the previous skill: the agent correctly refused generic
`memory_add` but could not complete the request because neither the skill nor its
tool map documented `glossary_alias_list/add/remove` inputs or ownership.

Expected route:

```text
explicit alias write intent
-> resolve project + exact EPIC + raw term + canonical term
-> glossary_alias_list(projectId, epicId) for duplicate/conflict discovery
-> glossary_alias_add(projectId, epicId, term, canonicalTerm)
-> glossary_alias_list + glossary_translate(projectId, text=term) for verification
```

## Scenario 9: Retired API

User asks after naming one API route:

```text
이 API는 이제 안 써. 메모리에 기록해놔.
```

Failure to prevent:

- searching only authored business documents and inventing a document-item
  anchor instead of finding the exact `api_spec` document;
- recording an ambiguous absolute statement without preserving the user's
  scope and as-of context;
- choosing the first same-looking route when multiple API specs remain.

Observed RED failure: the previous skill routed API discovery through generic
`document_search/get/item_list` and proposed a document-item anchor even though
source-near specs are themselves document anchors.

Expected route:

```text
spec_search(exact route/name, specKind=api_spec when supported)
-> spec_get exact candidate -> spec_document_resolve only when reverse business context is required
-> one exact spec id or ask
-> memory_list(documentId=spec.id)
-> memory_add/update(kind=correction or constraint)
-> memory_get
```

## Scenario 10: Retired DB Field

User asks after naming one table and field:

```text
이 DB 필드는 이제 안 써. 메모리에 기록해놔.
```

Failure to prevent:

- using generic document search without selecting `data_dictionary`;
- anchoring at the whole document when one exact `dd_field` exists;
- guessing a field after a whole-document hit.
- blocking on a missing or ambiguous field item even though one parent DD
  document is already exact;
- failing to inspect the parent DD document memory on later field retrieval.

Observed RED failure: the previous skill reused the generic API document route
and did not require the `data_dictionary -> dd_field` ladder.

Expected route:

```text
document_list(documentType=data_dictionary) + document_search(table.field)
-> document_get -> document_item_list(itemType=dd_field)
-> one exact field: document_item_get and use the exact item anchor
-> zero or multiple plausible fields under one exact DD: use the parent document anchor
-> multiple plausible parent DD documents: ask; do not guess
-> memory_list(documentId), selecting the exact item anchor only when one exists
-> memory_add/update(kind=correction or constraint) on item or parent fallback
-> memory_get
```

Later field retrieval through that DD must inspect parent document memory cards
from `document_get`; if attached cards are unavailable, call
`memory_list(documentId)`. Use `memory_get` for every relevant card before the
answer. A parent fallback memory is broader by design and must remain visible
even when a later query resolves one exact field item.

## Scenario 11: Product Why

User asks after naming one feature:

```text
이 기능은 당시 고객센터 반복 문의를 줄이려고 기획한 거야.
메모리에 기록해놔.
```

Failure to prevent:

- always using a broad EPIC even when the reason belongs to one rule or flow;
- using `correction` for historical product rationale;
- guessing one EPIC or business document from multiple candidates.

Expected route:

```text
retrieve the named feature and candidate EPIC/doc/item surfaces
-> broad capability rationale: EPIC anchor
-> one rule/flow rationale: exact BR/design/UCL/UCS document or item anchor
-> memory_list on that anchor
-> memory_add/update(kind=why)
-> memory_get
```
