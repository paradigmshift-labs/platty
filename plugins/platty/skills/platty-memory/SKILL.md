---
name: platty-memory
description: Use when recording, updating, or removing human knowledge (why, corrections, constraints) anchored to Platty epics, documents, or document items.
---

# Platty Memory

Use this skill when the user states domain knowledge that Platty cannot derive from code: a why, a policy background, a constraint, or a statement that generated content is wrong.

Memories are an overlay on the SOT, never part of it. They are returned by retrieval reads and injected into business-doc generation context, but they never edit document content.

## When To Record

Record a memory when the user:

- explains why a rule, design, or data shape exists ("정산이 D+2인 이유는 재무팀 정책").
- corrects generated content ("이 BR은 틀렸어, 실제로는 ...").
- states a constraint or exception the code does not show.
- shares tacit knowledge about a table, field, API, screen, event, or schedule.

Do not record:

- facts derivable from code — that is the SOT's job; regenerate or sync instead.
- secrets, credentials, tokens, or PII. Memory content is sent to LLM workers (redaction exists, but do not rely on it) and survives deletion inside the revision history.

## Abstraction-Level Routing

Anchor the memory at the abstraction level where the knowledge belongs:

```text
도메인 전반의 정책/배경(why)        → EPIC anchor (--epic)
용어/명칭 교정                      → glossary document (epic 범위 용어는 epic glossary, 프로젝트 공통 용어는 project glossary)
비즈니스 규칙 교정/예외             → br document
설계 구조/아키텍처 배경             → design document
유스케이스 목록 단위 지식           → ucl document item (--item-type/--item-key, key = UCL item stableKey)
특정 유스케이스 흐름의 암묵지/예외   → ucs document
테이블/필드의 실제 의미·역사        → data_dictionary document
API/화면 구현 디테일·함정           → api_spec / screen_spec document
이벤트/스케줄 동작의 함정           → event_spec / schedule_spec document
```

The stored `level` is derived from the anchor (`epic` for epic anchors, otherwise the document type), so anchoring at the right place is what makes the memory reach the right generation context later.

## Anchor Discovery Flow

Find the anchor before adding:

```bash
platty epics list --project <project> --compact --json
platty epics show --project <project> --epic <epic-id> --include-docs --json
platty docs search --project <project> "<term>" --json
platty docs show --project <project> --document <doc-id> --json
```

For a document-item anchor (for example one UCL item), open the document with `docs show` and copy the item's `itemType` and `stableKey` into `--item-type`/`--item-key`.

If `memory list` shows `anchorStatus: "orphaned"`, the anchor was removed or orphaned by sync. Re-anchor by adding a new memory on the live anchor and deleting the orphaned one (add + delete, not update — update cannot move an anchor).

## Add vs Update vs Delete

Before `memory add`, check what already exists on the anchor:

```bash
platty memory list --project <project> --document <doc-id> --json
platty memory list --project <project> --epic <epic-id> --json
```

(or read the `memories` field already returned by `docs show`.)

- New knowledge on the anchor → `memory add`.
- Same topic as an existing memory → `memory update --reason`.
- Existing memory is wrong → `memory delete --reason`.

`--reason` is mandatory for update/delete and should quote what the user said — it becomes the audit trail.

```bash
platty memory add --project <project> --epic <epic-id> --content "정산은 영업일 기준 D+2 (재무팀 정책)" --kind why --json
platty memory add --project <project> --document <doc-id> --content "<text>" --kind correction --json
platty memory add --project <project> --document <ucl-doc-id> --item-type <item-type> --item-key <stable-key> --content "<text>" --json
platty memory update --memory <memory-id> --content "<corrected text>" --reason "사용자 교정: ..." --json
platty memory delete --memory <memory-id> --reason "사용자 요청: 더 이상 유효하지 않음" --json
platty memory show --memory <memory-id> --json
```

`--kind` is `why | correction | constraint | context` (default `context`).

## Actor And Source Convention

Agents must always pass `--source agent --actor <agent-name>`:

```bash
platty memory add --project <project> --document <doc-id> --content "<text>" --source agent --actor <agent-name> --json
```

A plain `memory add` without these defaults to `--source user --actor user` and means a human typed it. Audit fields are self-reported — acceptable for a local single-user tool, so do not misreport them.

## Boundary

- Memory never edits SOT. If a memory contradicts a fresh document, tell the user both exist and recommend business-docs sync or regeneration — the memory feeds the next generation as a correction signal.
- Memories added after a generation run started appear from the next run for standard task types (context pages snapshot at run start). UCS task pages snapshot later, when their UCL is submitted, so a memory added mid-run may still reach that run's UCS tasks.
- Soft-deleted memories stay reconstructible in revision history (`memory show` lists every revision with `op`, `actor`, `reason`, `createdAt`).
