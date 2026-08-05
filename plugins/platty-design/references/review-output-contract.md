# Platty Design review output contract

This contract separates product evidence from review workflow UI.

## Product HTML boundary

Product HTML and browser captures contain only source-grounded product UI. A
seller header, left navigation, active navigation item, and product content
remain when they are product UI. Review-only UI means a review rail, IA panel,
state inventory, capture status, memo textarea, screen specification,
provenance, or authorization questions.

Capture accepts a product-only canvas and reports any review-only selector or
copy as `REVIEW_UI_IN_PRODUCT_HTML`. Product copy stays source-grounded. Rapid
Prototype retains its separate exploratory HTML contract.

The browser evidence receipt binds the declared browser viewport and capture
surface, visible shell selectors, and bounding boxes to the captured PNG
dimensions and records zero review-only selector matches. Seller-only regions
are required only for a seller shell. A boolean-only shell claim or 1x1
placeholder image is not review evidence.

## Conversation review surface

The model conversation is the primary review surface. Present, in order:

1. one compact IA with page/screen destinations only;
2. every passed state screenshot, grouped by page and viewport;
3. the caption and observable result for each screenshot;
4. its screen function specification and current screen-scoped memo;
5. capture coverage and blocking gaps.

Render screenshots with absolute local image paths when the client supports
local Markdown images. Otherwise link each screenshot individually in the same
order. A contact sheet is supplementary; each state remains individually readable.

## Memo save action

Memo editing happens in the conversation, not in the product mockup. Offer the
explicit action label `메모 저장`. Use a native choice/action control when the
runtime provides one; otherwise ask the user to reply with `메모 저장`.

Activation writes the current screen-scoped memo to `review_handoff.json` via
the Capture store script. A save succeeds only after the script returns the new
revision. Echo the saved content, screen identity, revision, and storage path.
The script's `status: "saved"` is the sole save-completion signal.

Use [the durable memo contract](../skills/platty-design-capture/references/capture-contract.md#durable-memo)
for stable page identity, revision conflict, and resume behavior.
