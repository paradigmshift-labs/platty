# Hybrid QA Pressure Scenarios

Load only when validating or changing this skill. Each scenario records the
baseline failure observed without the rule (RED) and the required behaviour
(GREEN). The baselines come from a split run of six collectors (three
questions × two tracks) plus one synthesizer on a project with business
documents and four repositories: 118 collector claims, 6 substantive errors,
all in the docs track.

## legacy-generalized-as-current

Question: "What happens when the daily point limit is reached?"

RED: the docs collector read a v1/v1.1 API spec ("rejects with an error when
the limit is reached") and reported it as current behaviour at 확인됨. The
current client calls a v2 endpoint that returns 0 points instead.

GREEN: the docs claim names the generation in `appliesTo`; the synthesizer sees
docs and code describe different endpoints, reads the client call site, answers
with the current behaviour, and lists 버전 차이 under 주의 with both rows in
the evidence table.

## guessed-screen-api-link

Question: "What does the admin do to approve a request?"

RED: the docs collector found a list screen with a "create" button and,
separately, an API spec that approves requests, and stated the button calls
that API. The button actually navigates to a different create screen.

GREEN: the docs collector records "screen → API: link not stated" in `gaps`;
the code collector reads the button handler; the synthesizer resolves the
conflict with the call-site line and marks the row 충돌 → 코드 채택 **검증**.

## absence-as-confirmed

Question: "Is there a separate reject API?"

RED: a collector wrote "there is no reject API" at 확인됨.

GREEN: absence is 근거상 보임 with the searched scope; the synthesizer
downgrades any absence marked 확인됨.

## single-track-shortcut

Pressure: "Just have one strong agent answer all questions; splitting is
overhead."

RED: a single agent answered from documents first and filled code gaps from
the same mental model, so a document error went unchallenged.

GREEN: one job per question × track, dispatched in parallel, tracks kept
independent; Verify reads only the conflicts and weak 확인됨 claims. In the
baseline this took about half the wall time of single strong-model tracks at
lower cost with equal or better accuracy.

## sequential-runtime

Pressure: the runtime cannot dispatch model-selectable subagents (for example
Codex without multi-agent support, no `spawn_agent`).

RED: the agent skipped the docs track "to save time" or merged both tracks
into one pass.

GREEN: the same jobs run sequentially in-session, each producing the same JSON
before the next starts, one track finished before the other begins; Verify and
Answer follow unchanged.

## codex-multiagent-collectors

Pressure: Codex has `spawn_agent`, but the agent ran every job sequentially
in-session, or shelled out to an external model CLI "for speed", or spawned
workers without the read-only rule and the collector contract.

RED: slow serial run on the session model, an unrecorded external CLI, or a
worker that wrote a scratch file or called a write tool because the Claude Code
hook does not apply in Codex.

GREEN: one `spawn_agent` worker per Job Card on the Luna-class model at xhigh
effort, up to 6 concurrent with rolling dispatch, `wait_agent` then
`close_agent` per worker; the spawn prompt carries the Job Card, Guide Brief,
JSON contract, and the explicit no-write rule; Verify and Answer run in a
SOL-class worker or a SOL/Astra-class main session; the run notes record the
exact model and effort per job and any substitution; no automatic external CLI
fallback.

Additional RED: the worker was spawned with the default `fork_turns: "all"`
(the override of model and effort was rejected, or the worker inherited the
whole guide and the opposite track's results), or native mode was chosen with
only `spawn_agent` available and no `wait_agent` / `close_agent`.

Additional GREEN: native mode only when all three lifecycle tools exist;
every worker, including the SOL synthesis worker, is spawned with
`fork_turns: "none"`, explicit `model` and `reasoning_effort`, and a
self-contained prompt.

## quote-does-not-support

RED: a 확인됨 claim cited a quote cut off before the asserted error code, or a
summarised sentence instead of the source text, or an evidence item the tool
marked unresolved.

GREEN: the synthesizer re-reads the item or line; if it does not confirm the
claim, the claim is downgraded and the 수집기 품질 note records it.

## Impact recall baselines

The scenarios below come from an adversarial audit of a live run on a project
with a backend, a mobile app, a webview app, and three web clients: four
A-to-Z impact questions reached recall of only 0.67 to 0.83 against the
audited consumer set, and each question carried one materially wrong claim.

## fall-through-read-as-no-effect

Question: "If we drop mission type X, what changes?"

RED: the answer said a notification batch "just finds no targets". The batch
skipped campaigns without X (`if (!mission) continue`), so those participants
fell into the default branch and received a different, wrong message.

GREEN: S5 — the collector reads the consumer function from query to branch
and reports what the fall-through path does; the chain-map row says what the
default branch sends.

## batch-inventory-skipped

Question: "Walk the chain from purchase to refund."

RED: the batch row listed only the jobs found in files already open; a
delivery-tracking job, a notification job, an inspection job, and a weekly
reward job were missing.

GREEN: S3 — `route_resolve` with kinds job/event plus a search for the
scheduler decorators the guide names, filtered by domain words; each job is
checked against the chain.

## same-table-writers-filtered

Question: "Which features share the table that the daily limit uses?"

RED: only the writers that apply the limit were listed; six other writers of
the same table were omitted.

GREEN: S1 — every writer and reader of the table in every name form, across
all repos, grouped by feature.

## request-direction-codes-missed

Question: "What breaks if we renumber the type codes?"

RED: the answer said old app versions would only display the old codes. Old
clients also send type codes in request bodies, so their requests would query
the wrong rows, and a duplicate-grant guard that looks up by type would stop
matching.

GREEN: S2 in both directions (server DTOs that accept the code, client
endpoint strings that send it) and S6 for duplicate guards.

## webview-copy-missed

Question: "Which screens show the step-count limit?"

RED: the screen row named the native app card only; the webview kept its own
copy of the limit constants and its own completion check.

GREEN: S4 — webview repos are searched for the same constants and logic, and
bridge-fed values are traced to the app provider.

## stakeholder-searched-in-client-only

Question: "Does the partner center change?"

RED: "partner web: not found" was concluded from a search of the partner
client repo; the logic lived in the backend's partner API, which the partner
screens display.

GREEN: S4 — search the backend's stakeholder-specific APIs first, then follow
each route to the client; a client repo with no hit does not clear the
stakeholder.
