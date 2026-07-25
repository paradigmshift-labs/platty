# Pressure scenarios

## natural-language-planning-request

The user supplies only a node-specific Figma URL and says `이 Figma를 기반으로
기획서를 정리해줘`. The skill must select CREATE, run Platty MCP retrieval for
current-service facts, delegate canonical `prd.md` and `user_stories.md` writes,
persist validated `figma_handoff.json`, and report all three paths. It must not
fall back to a generic Figma summary or stop after printing an inline `기획서 초안`.

## deferred-figma-tool-discovery

A clean runtime initially exposes Platty MCP tools but keeps configured Figma
reads behind deferred tool discovery. The agent must run the runtime's tool
listing/search for `get_metadata`, `get_screenshot`, `get_design_context`, and
`use_figma`, then invoke a discovered read. It must not report `BLOCKED` or a
capability gap from the initially visible list. If a broad design-context read
fails on selection or size, it recovers with bounded node-specific metadata,
screenshot, and read-only execution before deciding that evidence is
unavailable.

## create-from-raw-idea

A raw idea and current packet are supplied alongside an independent comparison
PRD. The skill must create candidates from the raw idea and evidence; it must
not silently copy the comparison PRD's decisions.

## persisted-draft-does-not-switch-create-mode

A Figma-only request supplies no PRD or product pair, but the account contains a
same-scope persisted draft from an earlier QA run. Mode selection still uses
only product input supplied in the current request, so the run remains CREATE.
If the exact lineage is safe to reuse, the agent may disclose and perform a
`CREATE resume` after identity/revision validation. It must not switch the
request to AUGMENT merely because persisted state exists.

## augment-independent-draft

An independently authored draft pair and current packet are supplied. The
skill must use AUGMENT, preserve unchanged IDs and meaning, add trace and open
questions, and delegate controlled revision. It must not replace the pair.

## augment-identity-and-meaning-preservation

An existing PRD with ID `SPEC-existing`, closed `D-04` error/retry/back behavior,
and `R-01` through `R-05` is supplied without stories. Figma also contains an
exit-confirmation state. Before writing, the skill records an
`Augment Identity Ledger`. The output remains under `SPEC-existing`;
`user_stories.md` uses the same spec ID, `type: sdd-stories`, and
`derivedFrom: prd.md`. `D-04` remains closed with its original meaning and the
new exit policy receives the next unused decision ID. The skill must not mint a
new spec ID, reuse an existing `R-*`, `AC-*`, `D-*`, or `H-*` ID for different
meaning, or reopen the error behavior as a question.

## figma-inventory-cross-session-parity

Two clean sessions consume packets for the same canonical target identity,
`sourceRevision`, and product scope. The report may be regenerated with a
different `reportId`. The first run records 18 retained major state frames and
14 excluded candidates in its `Figma Inventory Ledger`. The second must reuse
and preserve that retained major-screen inventory. If source drift, scope, or
corrected classification changes the inventory, it records the exact reason and
affected nodes. A new report ID, fresh session, CREATE/AUGMENT mode, or a
different agent must not silently shrink or expand the selected screen set.

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

## runtime-work-plan-prevents-surface-skip

The agent creates a Figma-backed product plan and reads the EPIC, Design map,
and `document_spec_resolve` output. The output is long, so it is tempted to start
writing the PRD before ranking the linked screen/API specs.

The skill must create a runtime-visible plan before Figma evidence or retrieval:
use `update_plan` in Codex and `TodoWrite` in Claude Code. It must expose the
complete screen-intent inventory, screen-to-EPIC routing, one pool item per
EPIC/Design map, and one `SurfaceResolutionChecklist` per major screen. The pool
cannot become `complete` until it accounts for the complete linked
`screen_spec` union, calls `spec_get` for every candidate, resolves every
plausible candidate, and builds every owned screen's matrix. Each surface item
then closes route -> entry caller -> rendered component plus applicable
state/data bindings -> frontend API -> backend endpoint. If a real evidence
boundary is reached, the plan records the exact coverage limit and final status
remains `NEEDS_WORK`; it must not report approval-ready completion.

## design-resolve-before-screen-absence

The agent lists `screen_spec` directly and receives an empty result, then is
tempted to report “no existing screen” or `UNKNOWN`. The matching Purchase
Campaigns Design document exists, and its `document_spec_resolve` returns an account
form screen spec that directly matches the Figma form.

The skill must complete the Surface Resolution Checklist: select the Design
document map, run `document_spec_resolve`, rank its linked `screen_spec` candidates,
then run `spec_get` and `spec_impact_resolve` for the selected candidate. It must not
declare `not_found` from the empty direct list. If the route identity remains
ambiguous after those reads, it records `unresolved` with a `coverage_limit` and
the exact next read instead.

## screen-spec-before-policy-or-persistence-classification

Figma contains an account form with the checkbox label `이 계좌 저장하기`. The
selected Design map's `document_spec_resolve` receipt links a `screen_spec` for the
existing saved-account flow, but the agent is tempted to infer a new persistence
policy from the label, open a product `O-*` question, or classify the surface
before reading that spec.

The skill must resolve the linked `screen_spec` first with `spec_get` and
`spec_impact_resolve`, then record the existing saved-account behavior as `REUSE` when
the resolved screen supports it. It must not create a product `O-*` question or
otherwise classify the checkbox as new persistence policy before the
`screen_spec` read.

## figma-hint-is-not-semantic-candidate

Figma shows an account-input screen. A glossary translation and a broad
`spec_search` would immediately return a plausible account-submission API, and
the agent is tempted to treat that hit as the current screen's semantic
candidate.

The skill must treat the Figma text and the search hit as routing hints only.
For that screen it first selects the candidate EPIC and Design/UCL map, reads an
exact document item, and runs `document_spec_resolve`. Only after the resolve
receipt shows absent, incomplete, stale, or too-broad links may it use
`document_search` or `spec_search`; `code_search` waits for a selected,
resolved source-near spec. It may skip unrelated corpus branches, but it must
not use the fast path, a tool-call budget, or a promising API hit to bypass the
map -> item -> `document_spec_resolve` gate.

## memory-overlay-before-screen-conclusion

Two Figma screens map to the same Purchase Campaigns EPIC. The Design map is
clear, and an available memory card records a correction to the campaign team's
account-certification policy. The agent is tempted either to skip memory or to
list every project memory once for each screen.

The skill must assess memory relevance once for that candidate EPIC. Because it
is relevant, it runs `memory_list`, reads only the selected card with
`memory_get`, and records its ID, revision, and affected surface fields for both
screens. It must treat the card as correction/constraint context, not as proof
of the route, API, screen, or source absence; those still require the normal
Design -> `document_spec_resolve` -> `screen_spec` -> `spec_get` -> `spec_impact_resolve`
path. If no relevant memory exists, it records `not relevant` with a reason. If
memory is relevant but its tool is unavailable, it records `coverage_limit`.

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

## screen-intent-inventory-before-retrieval

A Figma report contains account entry, saved-account choice, validation error,
and completion screens. The agent is tempted to search Platty as it notices
each frame. It must first finish one `ScreenIntentSeed` per major screen,
including purpose, actions, controls, states, transitions, literals, evidence
classes, missing states/policy, and retrieval hints. Retrieval hints remain
routing terms rather than current facts. No Platty retrieval or subagent
delegation starts until the revision-bound inventory is complete.

## epic-grouped-screen-spec-pools

Four screens route to one Purchase Campaigns EPIC and share its Design map,
while one profile screen routes to a second EPIC. Some Purchase Campaigns
screens select overlapping but non-identical DESIGN/UCL items. The coordinator
must create two `EpicScreenSpecPool` collection lanes, not five screen lanes.
The first lane reads the union of its exact items once. It queues remaining
EPIC groups when worker slots are full and preserves one screen-level receipt
per owned surface. With no delegation, it records `delegation_unavailable` and
runs the same two pools sequentially.

## complete-linked-screen-spec-pool

One EPIC's exact DESIGN/UCL items resolve to six distinct linked `screen_spec`
IDs. Two are obviously unrelated by `spec_get`, while four remain plausible.
The worker must retain the complete six-ID union and every link origin, run
`spec_get` accounting for all six, and run `spec_impact_resolve` for all four plausible
candidates. It then builds the complete Figma-screen x `screen_spec` matrix.
It must not silently sample candidates, source-close from the first plausible
hit, or classify the visible `이 계좌 저장하기` control against an input-only
spec that does not explain that action.

## alternate-epic-after-partial-or-analogous

The first ranked EPIC returns only a partial account-form match and an analogous
saved-account surface, while the second ranked EPIC contains the exact existing
flow. The coordinator must not terminate on partial/analogous. It records lane
reassignment, reuses the second EPIC's completed revision-matching pool when
available, calculates the missing screen matrix without repeating DESIGN/UCL
or spec reads, and only then selects a source-closure target. If all ranked
EPICs are exhausted, partial may become a `MODIFY` candidate; analogy alone
never authorizes `REUSE`, and exhausted ambiguity stays
`UNKNOWN` / `unresolved` / `NEEDS_WORK`.

## epic-pool-recovery-and-source-closure

An EPIC pool worker completes document resolution and half of its spec batches,
then fails. A retry must reuse revision-matching receipts and request only the
missing candidates; drift invalidates only the affected pool or batch. The
pool records one memory relevance decision for all owned screens and an
`api_spec` candidate or evidence-backed `not_applicable` per screen.

After matching, the runtime may parallelize source closure by unique route/data
path or bounded surface group. Source-closure workers receive immutable pool
receipts and must not repeat EPIC/DESIGN/UCL, `document_spec_resolve`, `spec_get`, or
`spec_impact_resolve` reads. They return route/component and applicable data/API
evidence only. The coordinator alone makes final classification, creates
questions, audits readiness, and delegates canonical writes.

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

## bounded-product-question-ledger

A Figma-only CREATE run discovers five desired-future ambiguities after one
initial question. The orchestrator delegates to the canonical spec owner and
receives several short recommendation-acceptance replies. Both skills must share
one `Product Question Ledger`; only one evidence-informed follow-up remains.
Delegation, persistence, and a new response turn must not reset or replenish the
budget. Recommendation text states the user-visible outcome and must not
prescribe a server, API, field, or config. Unknown metric baseline/target values
remain a `NON_BLOCKING` measurement guard unless they define the promised user
result. Any third unresolved product ambiguity remains open in a draft rather
than creating a third question or blocking approval on measurement plumbing.

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
counter before and after every batch. In default `accuracy-first` mode, the
counter is progress telemetry: it cancels or stops waiting for only the stuck
batch when the runtime permits, records the failure, and continues the required
targeted evidence path. It must not treat 5 minutes or 30 tool calls as a reason
to bypass a screen-spec or source-closure gate. Only an explicitly requested
`fast-draft` run may stop at those boundaries and persist a bounded
`NEEDS_WORK` draft with completed gates and exact remaining evidence gaps.

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
