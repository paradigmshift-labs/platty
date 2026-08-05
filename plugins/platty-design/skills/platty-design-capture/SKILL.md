---
name: platty-design-capture
description: Use when Capture is needed for supplied product-page URL review or when PRD/Figma handoff requires exhaustive page/state evidence.
---

# Platty Design Capture

Capture is an exhaustive evidence loop: source inventory, verified browser rows,
model conversation review, then authorization. Mockups remain product-only.

Use [the capture contract](references/capture-contract.md) for schemas,
identities, storage, resume behavior, and errors. Load
[the shared review output contract](../../references/review-output-contract.md)
when reaching product capture, conversation presentation, or memo interaction.

## Prerequisites

Load `platty-mcp:using-platty-mcp`. Resolve the project, PRD, User Stories,
supplied URL, Design System, source revisions, real browser, and MCP client.
Represent missing sources as blocking gaps and unreachable states as failed rows.

**Complete when:** every prerequisite has a revision-bound result and the
browser/MCP client is ready, or the run has stopped with an exact blocking gap.

## Workflow

1. **Inventory sources.** Write revision-bound `source_inventory.json` for every
   source-required actor, screen, state, viewport, and its route, shell, result,
   function spec, and memo identity. **Complete when:** every source ID is
   accountable once or by an explicit many-to-one mapping.
2. **Build the matrix.** Build `capture_matrix.json`; keep IA to page/screen
   destinations and keep controls/state transitions in function specifications.
   **Complete when:** inventory and matrix identities, source revisions, and
   required row IDs match exactly with no duplicate, missing, or extra row.
3. **Capture product evidence.** Apply the shared product boundary to every row
   and record the capture-contract evidence. **Complete when:** every row has
   verified browser evidence or a named failure; failures hold authorization.
4. **Initialize or resume review.** Run
   `scripts/capture-review-store.mjs init <absolute-capture-dir> <capture-id>`.
   **Complete when:** the command returns `initialized` or `resumed` and the
   handoff revision is loaded.
5. **Present the conversation review.** Present one compact IA, then every passed
   state screenshot using the shared contract and absolute local image paths.
   **Complete when:** the response and `review_presentation.json` account for the
   same IA, rows, order, function specs, memo references, and gaps.
6. **Audit the package.** Run
   `scripts/capture-package-audit.mjs <absolute-capture-dir>`.
   **Complete when:** it returns `status: "passed"`; this unlocks authorization.

## Memo save

For memo interaction, use the stable `screenId` page key defined by the capture
contract and the shared contract's `메모 저장` action. On activation, run:

```text
scripts/capture-review-store.mjs save-memo <absolute-capture-dir> <screen-id> <expected-revision> <memo>
```

**Complete when:** the script returns `status: "saved"` and the response echoes
the saved screen, revision, content, and storage path. A revision conflict loads
the current durable memo before a new save attempt.

## Authorization and routing

After the package audit passes, ask in this order:

1. `현재 검토 결과를 PRD에 반영하시겠습니까?`
2. `확정된 화면과 IA를 Figma로 옮기시겠습니까? 선택하면 PRD에도 함께 반영됩니다.`

Persist both answers with
`scripts/capture-review-store.mjs save-decision <absolute-capture-dir> <expected-revision> <prd-answer> <figma-answer> <source-revisions-json>`.
`status: "decision-saved"` unlocks downstream routing.

Figma authorization implies one successful PRD reflection first. Route PRD work
to the owning Platty MCP SDD skill and Figma delivery to the owning Figma/HDS
skills. Pass both owners the validated matrix and revision-bound receipt. Source
revision parity is the routing gate; destination mutations remain with the owners.

When changing this skill, use
[the pressure scenarios](references/pressure-scenarios.md) as the RED/GREEN gate.
