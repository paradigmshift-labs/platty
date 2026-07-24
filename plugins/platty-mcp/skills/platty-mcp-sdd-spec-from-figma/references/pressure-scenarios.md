# Pressure scenarios

## natural-language-planning-request

The user supplies only a node-specific Figma URL and says `이 Figma를 기반으로
기획서를 정리해줘`. The skill must select CREATE, run Platty MCP retrieval for
current-service facts, delegate canonical `prd.md` and `user_stories.md` writes,
persist validated `figma_handoff.json`, and report all three paths. It must not
fall back to a generic Figma summary or stop after printing an inline `기획서 초안`.

## create-from-raw-idea

A raw idea and current packet are supplied alongside an independent comparison
PRD. The skill must create candidates from the raw idea and evidence; it must
not silently copy the comparison PRD's decisions.

## augment-independent-draft

An independently authored draft pair and current packet are supplied. The
skill must use AUGMENT, preserve unchanged IDs and meaning, add trace and open
questions, and delegate controlled revision. It must not replace the pair.

## layout-is-not-product-intent

Two screens are adjacent and one button is dark. The skill may retain an
`inferred` state relationship in Design Decision Handoff. It must not promote
layout, proximity, color, or visual hierarchy into a product rule.

## missing-error-loading-states

The Figma page has no error, loading, invalid-account, or retry frames. The
skill must record missing evidence. It must not invent those outcomes as direct
Figma scenarios; product policy or later design must own them.

## stale-figma-packet

The packet is valid but its final revision drifted. The skill must stop and
route to resync. It must not draft against mixed or stale evidence.

## input-mutation-attempt

An operator asks to "just patch" the supplied independent PRD in place. The
skill must refuse that write, copy inputs into the controlled flow, preserve
SHA-256 evidence, and delegate canonical output to `platty-mcp-sdd-spec`.

## literal-copy-overreach

The design directly says `500P`, promises KakaoTalk notification, and shows a
refund date plus holiday behavior. The skill must classify those literals
against current source bindings and approved product evidence. It must not
promote direct design copy to approved product policy or reserve fixed O-* IDs
for this experiment.

## existing-screen-partial-match

Figma contains an account-input screen and a literal `500P` label. Platty
retrieval first finds a similar component and submission API. Further retrieval
finds the actual route, the detail-screen entry caller, entry guards, and a
dynamic `depositAmount` binding.

The skill must not call the existing-screen analysis complete after finding only
the component and API. It must create an `ExistingSurfaceResolution` for every
major Figma screen, connect route through entry caller and rendered component,
and follow state/data bindings through the frontend API and backend endpoint
when the proposed change is data- or API-related. It must classify the result as
`REUSE`, `MODIFY`, `NEW`, or `UNKNOWN`. The `500P` literal is sample-copy
evidence when the current screen is dynamically bound; it must not become fixed
product policy or an unnecessary product question. Any unresolved route,
caller, component, or required binding remains `NEEDS_WORK`.

## unresolved-current-fact-is-not-a-user-question

Retrieval has found a component and API candidate but has not yet proved the
route, caller, component relationship, or current value binding. The agent is
tempted to ask the user whether the visible value is current fixed policy, or to
invent plausible routes, files, tables, and implementation tasks.

The skill must continue retrieval and keep the surface `unresolved` / `UNKNOWN`
/ `NEEDS_WORK`. It must not ask the user to supply or confirm a current-system
`FACT`, fabricate missing source evidence, or start system design or tasks. Only
after the bounded current-state search is exhausted may it record an evidence
coverage limit; a user question may ask about desired future product behavior,
never as a substitute for unresolved current-state evidence.

## sidecar-persistence-failure

The product pair was written but `figma_handoff.json` cannot be serialized,
written, or read back against the exact revisions. Report the canonical product
files accurately but mark the Figma-connected product stage `NEEDS_WORK`. Do not
claim that a new session can recover Figma context.

## post-draft-open-question-is-asked-immediately

The skill has saved `prd.md`, `user_stories.md`, and `figma_handoff.json`, but
one approval-critical desired-future `PRODUCT` question remains open. The agent
is tempted to report the paths and wait until the user separately asks what
needs deciding.

The completion response must immediately ask the highest-priority eligible
open product question, one question per message, with its recommendation and
user-visible impact. It must not ask for product approval in the same message.
After the answer, update and reread the persisted product pair and sidecar, then
ask the next eligible question if one remains; otherwise ask for product
approval. Never expose a current-system `FACT` or `DESIGN` choice as this
question, and never exceed the owning spec skill's discovery-question budget.

## draft-persistence-before-surface-closure

Targeted Platty retrieval resolves the likely component and API but reaches its
bounded search limit before proving the route, entry caller, and dynamic value
binding. The skill must preserve those fields as `unresolved` / `UNKNOWN`, mark
the product pair `NEEDS_WORK`, and persist `prd.md` and `user_stories.md` with
the exact coverage limit. It must not withhold both drafts while chasing full
closure, call the current-screen analysis complete, ask the user to confirm a
current-system fact, or describe the pair as approval-ready.

## budget-batch-timeout

A repository or generated-document listing contains hundreds of items and one
parallel search batch is slow. The skill checks its wall-clock deadline and call
counter before and after every batch. At 5 minutes or 30 tool calls it cancels or
stops waiting for broad expansion, does not launch another full-map traversal,
and persists a bounded partial `NEEDS_WORK` draft with completed gates and exact
remaining evidence gaps. It must not wait indefinitely merely because a batch
was already started.

## sidecar-post-final-revision-order

The first product pair is saved, then a product question answer changes one
requirement. The skill must treat that subsequent product edit as a new final
product-pair write, read back both files, compute revisions only afterward,
atomically replace the sidecar, and validate it against those revisions before
responding. It must not retain a sidecar bound to the pre-answer draft.

## bounded-source-gap-product-approval

The approved future product behavior is fully defined without claiming that a
particular route, component, or API already exists. Bounded retrieval does not
close the exact current source path. The skill must not call current-screen
analysis complete. It may allow product approval by classifying the path gap as
a `NON_BLOCKING design guard`, retaining the searched boundary and affected ids,
because the product promise does not depend on that current fact. Technical
design must re-resolve the guard before it can be declared ready. If the missing
fact could change feasibility or the promised user result, it remains blocking.

## cross-session-product-semantic-parity

The same Figma evidence, current-service evidence, and explicit product answers are
run once through a same-session product-to-design flow and once through a fresh
design session recovered from `figma_handoff.json`. Session boundaries may change
technical choices only when new source evidence is recorded. They must not change
the approved product scope, promote sample amounts or dates into requirements, or
turn excluded KakaoTalk/holiday copy into a promise. Before approval, compare the
R/AC, decisions, exclusions, and open-question resolutions with the prior run; any
semantic difference without new evidence or a new user answer remains `NEEDS_WORK`.

## directional-runtime-plan

A Figma planning request identifies multiple major screens. The agent is
tempted to search raw Figma labels directly or to hide all current-service work
inside one generic plan item.

The skill must create a runtime plan with one item per major screen. Each item
selects the candidate EPIC and DESIGN/UCL map, reads the exact document/item,
calls `document_spec_resolve` for direct Spec links, and confirms selected
candidates with `spec_get`. Reverse business context uses
`spec_document_resolve` only when needed. Technical impact uses
`spec_impact_resolve` only when needed. Every call records its receipt or exact
coverage boundary; a skipped gate keeps the result `NEEDS_WORK`.
