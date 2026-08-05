# Capture contract

## Artifact package

Write beside the source specification:

```text
<SPEC>/.feature-captures/<capture-id>/
├── source_inventory.json
├── capture_matrix.json
├── review_presentation.json
├── review_handoff.json
└── screenshots/
```

Schemas are `platty-design-capture-source-inventory.v1`,
`platty-design-capture-matrix.v1`,
`platty-design-review-presentation.v1`, and
`platty-design-review-handoff.v1`.

The revision-bound source inventory independently defines every expected
page/scenario/state/viewport row. The matrix matches that inventory exactly.

The matrix binds every source scenario to actor, page/screen, route, state,
entry action or fixture, URL, viewport, capture timestamp, console result,
shell/navigation expectations, memo and function-spec identity, screenshot
hash, observable result, and source revisions. `requiredRowIds` accounts for
every expected row exactly once; duplicate, omitted, unexpected, or failed rows
block presentation and both authorization questions.

Each row records browser-observed product evidence for seller header,
navigation, active item, content, and absence of review-only UI. Evidence binds
the declared browser viewport and capture surface, PNG dimensions, selector and
bounding-box observations, and zero review-UI matches. The package audit verifies
the contained PNG path, signature, dimensions, viewport binding, SHA-256 hash,
bounded regions, and shell-specific observations;
the real-browser run owns selector evaluation.

The presentation manifest records compact IA destinations, ordered screenshot
rows, captions, screen-spec references, screen-scoped memo references, and
display status. Every row repeats its screen, state, viewport, source IDs,
observable result, screenshot path, memo revision, and contiguous display order
so the package audit can compare it with the matrix. It is a resumable manifest,
serving only as the conversation review manifest.

## Durable memo

`review_handoff.json` is the durable local source for memos and decisions.
`screenId` is the stable page key derived from the source screen identity, not
from route labels, state, display order, or revision. Every state of one screen
shares its memo; different screen IDs retain separate entries. Each memo contains
content, update time, and revision. The package revision increments on every
explicit `메모 저장` action. Saving with a stale
expected revision fails with a revision conflict (`MEMO_REVISION_CONFLICT`)
instead of overwriting newer content.

State changes, routes, browser reload, and resumed sessions retain the current
screen memo. `SCREEN_ID_INVALID` rejects unsafe identities.

## Presentation gate

Conversation output and product evidence follow
[the shared review output contract](../../../references/review-output-contract.md).
Incomplete conversation output fails with `REVIEW_PRESENTATION_INCOMPLETE`;
product-boundary violations fail with `REVIEW_UI_IN_PRODUCT_HTML`.

## Decision receipt

The handoff records exact authorization copy, both answers, source revisions,
timestamp, and result mapping. `PRD=No, Figma=Yes` maps to PRD reflection then
Figma delivery. `No/No` preserves artifacts without downstream mutation. The
decision revision map must exactly match `source_inventory.json`.
Write it with the revision-checked `save-decision` command. Downstream PRD and
Figma owners receive both the passed matrix and saved decision receipt; source
revision drift blocks both branches.
