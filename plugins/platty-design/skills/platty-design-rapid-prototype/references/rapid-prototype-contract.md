# Rapid Prototype contract

The public `platty-design` Rapid Prototype is a neutral, exploratory HTML
artifact. Product evidence remains authoritative: current PRD and User Stories
define scope, the registered Design System defines available visual evidence,
and the prototype handoff records the exact limits of the run.

## Scope and IA

- Retrieve current PRD and User Stories through the Platty MCP context and record
  their revisions or provenance. Missing or conflicting documents stop delivery.
- Resolve the Design System before styling. When resolution is `absent` or
  `unavailable`, use a **neutral low-fidelity fallback** and record the
  availability gap; never invent brand colors or components.
- When Design System resolution is `ready`, provenance records its canonical
  repository path, Git revision, and non-empty evidence files used by the
  prototype.
- The visual IA contains **page/screen destinations only**. It uses solid
  connectors and has no dotted connector; it excludes control-level actions and
  decorative workflow nodes. Every flow target must name an existing screen.
- Each selected screen has one screen-spec panel immediately adjacent after the
  screen. The panel records its purpose, state inventory, interaction summary, and one function-spec row
  for every review-relevant control on that screen.

## HTML markers and interaction contract

The standalone `index.html` is reviewed without a framework. A document must
provide:

| Marker | Required evidence |
| --- | --- |
| `data-page-flow`, `data-flow-node="page"`, `data-flow-connector` | Page-only IA with solid connectors and existing screen targets |
| `data-screen-id`, `data-role`, `data-states` | One screen identity, actor role, and non-empty state list |
| `data-control-id`, `data-function-number`, `data-action` | Every review-relevant editable, selection, navigation, and action control |
| `data-control-number` | One visible number badge equal to the control function number |
| `data-screen-spec`, `data-function-id`, `data-function-number` | Exactly one matching function-spec row adjacent to each screen |
| `data-interaction-summary` | One summary per screen-spec panel |
| `data-review-memo`, `data-storage-key` | One labelled native review memo per page/screen; the key template contains `{route}`, its screen identity, and `{state}` |
| `data-memo-persistence` | A script that calls both `localStorage.getItem` and `localStorage.setItem` |
| `data-prototype-provenance`, `data-prototype-model` | Parseable JSON provenance and embedded model |
| viewport meta, `data-supported-viewports` | Responsive behavior and declared supported viewports |

Editable product decisions use native `input`, `select`, `textarea`, radio,
checkbox, and `button` controls. User edits persist through rerender and
navigation in the prototype session. Decision-relevant validation and recovery
states must be reachable by editing those controls and invoking their action.
every interactive element in the review inventory receives one unique visible number
in DOM order and exactly one matching adjacent function-spec row naming its
behavior and resulting state or navigation. Decorative copy is not an
interaction.

The review shell provides one native memo `textarea` per page/screen, labelled
`검토 메모`, with visible text explaining that it is saved only in this browser.
It provides one persistent review memo per page.
Its key is scoped to the tracked route, screen identity, and selected state; the
draft survives navigation, reload, and review viewport changes while remaining
isolated from other screens/states. Review chrome is outside the product canvas
and cannot submit, share, approve, reject, publish, or create product feedback.

## Audit gates

Run the built-in `scripts/prototype-audit.mjs` against the absolute `index.html`
and require `status: "passed"` before delivery. The deterministic audit reports
these stable error codes:

`FLOW_ACTION_NODE`, `FLOW_DOTTED_CONNECTOR`, `CONTROL_NOT_NATIVE`,
`CONTROL_NUMBER_MISSING`, `CONTROL_NUMBER_BADGE_MISSING`,
`FUNCTION_SPEC_MISSING`, `FUNCTION_NUMBER_MISMATCH`,
`SCREEN_SPEC_NOT_ADJACENT`, `ACTION_TARGET_MISSING`, `MEMO_MISSING`,
`MEMO_PERSISTENCE_MISSING`, `PROVENANCE_MISSING`, `VIEWPORT_META_MISSING`,
`VIEWPORT_COVERAGE_MISSING`, `INTERACTION_SUMMARY_MISSING`,
`PROTOTYPE_STRUCTURE_EMPTY`, `NAVIGATION_RUNTIME_MISSING`,
`STATE_RUNTIME_MISSING`, `PROVENANCE_INCOMPLETE`, `MODEL_INCOMPLETE`,
`MEMO_SCOPE_INVALID`, and `MEMO_REVIEW_COPY_MISSING`.

Treat any audit failure as a blocking recovery item. Do not hand off a visually
plausible but structurally incomplete prototype.

After the deterministic HTML audit, run **Behavioral Acceptance** in a real
browser. Derive scenarios from every covered PRD/User Story scenario rather than
from the implementation. Exercise every modeled control and compare observable
results with the source evidence. Verify state transitions, navigation, exported
content when an export/download control exists, memo persistence and isolation
across navigation and reload, and all supported viewports.

Record `verification.behavioralAcceptance` in the handoff with `status`,
`executedAt`, `tool`, `scenarios`, and `viewportResults`. Each scenario records
its source scenario IDs, screen IDs, control IDs, categories, given, when,
expected, actual, status, and evidence. Static code inspection, marker presence,
or an audit pass is not behavioral evidence.

Run
`scripts/prototype-handoff-audit.mjs <absolute-index.html> <absolute-handoff.json>`
and require it to pass before delivery. It reports stable codes
`STATIC_AUDIT_FAILED`, `HANDOFF_INVALID`, `BEHAVIORAL_VERIFICATION_MISSING`,
`BEHAVIORAL_VERIFICATION_FAILED`, `BEHAVIORAL_VERIFICATION_INCOMPLETE`,
`BEHAVIORAL_SCENARIO_INCOMPLETE`, `SOURCE_SCENARIO_COVERAGE_MISSING`,
`CONTROL_BEHAVIOR_COVERAGE_MISSING`, `STATE_BEHAVIOR_COVERAGE_MISSING`,
`NAVIGATION_BEHAVIOR_COVERAGE_MISSING`, `EXPORT_BEHAVIOR_COVERAGE_MISSING`,
`MEMO_BEHAVIOR_COVERAGE_MISSING`, and `VIEWPORT_BEHAVIOR_COVERAGE_MISSING`.
Do not deliver until both the deterministic HTML audit and behavioral handoff
audit pass.

## Delivery and handoff

Write:

```text
<SPEC>/.feature-prototypes/<prototype-id>/index.html
<SPEC>/.feature-prototypes/<prototype-id>/prototype_handoff.json
```

The handoff schema is `platty-design-prototype-handoff.v1` and records source
revisions, actor/screen/state inventories, covered and unexplored product IDs,
Design System resolution, assumptions, decisions, open questions, audit summary,
`verification.behavioralAcceptance`, and delivery status. It also records expected and verified role, screen, state,
route, global IA-node, interaction-inventory, numbered-control, and
function-spec-row counts, including per-role and per-screen-state totals.

The artifact is exploratory and disposable. Do not claim a production-ready
approval state, invoke a design-file continuation, or modify PRD, User Stories,
Design System sources, receipts, or approval state. Formal Feature Design remains
a separate workflow.

## Recovery table

| Gap | Required response |
| --- | --- |
| Missing/unconfigured `platty-mcp` | Stop before HTML generation; install the plugin and run MCP client setup |
| Missing/conflicting product documents | Stop, name the source gap, and request the current evidence |
| Design System `absent`/`unavailable` | Use and label neutral low-fidelity fallback; do not invent brand values |
| Missing actor/screen/state | Stop or explicitly record it as unexplored; never silently narrow the journey |
| Native control or number/spec parity failure | Repair the HTML and rerun the audit |
| Memo isolation/persistence failure | Repair the storage key and browser-local read/write behavior |
| Audit failure | Do not deliver; report codes and smallest recovery action |
| Behavioral scenario, control, or viewport gap | Keep delivery blocked, repair the behavior or evidence, and rerun both audits |
