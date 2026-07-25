# Execution profiles

## accuracy-first (default)

Use for every customer-facing Figma-to-product request unless the user explicitly
asks for a preview, a time-boxed draft, or limited exploration. Complete every
mandatory Figma, linked-spec, and current-surface gate for every major screen.
Track elapsed time and tool calls before and after each call or batch, and add a
progress receipt at 10 minutes or every 20 retrieval calls, but neither threshold
may end retrieval, create a `coverage_limit`, or trigger canonical draft writing.

Bound search by evidence scope, never by a blind global clock: selected EPIC and
document map, linked source-near specs, exact route/component/data chain, and
recorded candidates. Cancel one stuck batch only when the runtime permits,
record the tool failure and retry/next targeted read, then continue. A real
unavailable capability, revoked access, stale Figma identity that cannot refresh,
or an explicit user cancellation is a stop condition; elapsed time is not.

## fast-draft (explicit opt-in)

Use only after the user explicitly requests a preview, time-boxed draft, or
bounded exploration. Set a 5-minute or 30-tool-call overall boundary and a
3-minute or 12-current-service-candidate-call first-draft boundary. At a
boundary, persist only a `NEEDS_WORK` draft with every completed receipt, exact
coverage limits, and next reads. Never report it as approval-ready. A later
accuracy-first retry resumes the same evidence gates and is not constrained by
the prior fast-draft counter.
