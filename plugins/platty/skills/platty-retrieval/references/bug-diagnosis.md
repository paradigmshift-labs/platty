# Bug Diagnosis Retrieval Guide

Use for "why is this bug happening?", "user says X failed", incident triage, regression suspicion, and investigation-order questions.

## First Hops

1. Identify the product flow and entry point: screen, API, event, batch, or external service.
2. Read source-near specs and relevant business rules only to form hypotheses.
3. Trace the flow across API, DB, events, batches, external services, and read carriers.
4. Inspect source snippets for the highest-risk branch or guard.

## Required Coverage

- Ordered hypotheses, not a single asserted root cause.
- Checks from user symptom -> entry point -> state table/log -> side effects -> downstream carrier.
- Tables/logs/events/batches to inspect.
- Source anchors for any concrete failure mechanism.
- Explicit "not confirmed" boundary for unverified causes.

## Stop Rule

Do not claim a definitive root cause without direct evidence. Unsupported root-cause certainty should be treated as a quality failure.
