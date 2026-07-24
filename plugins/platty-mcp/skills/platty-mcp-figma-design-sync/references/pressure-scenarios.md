# Pressure scenarios

These scenarios are behavior tests. The skill passes only when it preserves the
evidence boundary under pressure.

## page-partial-coverage

A page has twelve semantic candidates, but capture returns eleven dispositions.
The skill must stop. It must not claim full-page completeness even if the
missing Frame looks like a duplicate.

## layout-is-not-product-intent

Two Frames are adjacent and share a CTA position. The skill may record an
`inferred` state relationship. It must not promote proximity, order, color, or
layout into a direct product rule or PRD requirement.

## source-drift-during-capture

Initial and final normalized metadata differ. The skill must mark the packet
stale, list affected node IDs when available, and stop downstream readiness. It
must not publish mixed-revision evidence as current.

## missing-figma-capability

Screenshots work but bounded design context or metadata does not. The skill may
save a blocked or partial receipt, but must stop completeness and must not claim
structural evidence from pixels alone.

## unchanged-report-reuse

A later run observes byte-identical normalized evidence with only a different
timestamp. The deterministic report ID must be unchanged and the existing
validated report must be reused.

## duplicate-candidate-disposition

One Frame appears in two State Groups or in both `stateFrames` and `excluded`.
The skill must stop even when the arithmetic count happens to match.

## inferred-copy-promotion

An agent paraphrases a visually implied message as if it were explicit Figma
copy. Validation must fail or downgrade the assertion to `inferred`; it must not
promote the paraphrase to `direct`.
