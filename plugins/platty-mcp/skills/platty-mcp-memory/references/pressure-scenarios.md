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
-> memory_list(documentId, itemType, itemKey)
-> memory_add(documentId, itemType, itemKey)
-> verify presence through memory_list; use memory_get or memoryMode=full for exact body checks
```
