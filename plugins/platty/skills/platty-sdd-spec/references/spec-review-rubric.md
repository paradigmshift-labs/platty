# SDD Spec Review Rubric

Return `PASS` only when every required item is satisfied or explicitly accepted by the user.

## Request Review

- Every user-supplied source and confirmed answer is covered or named as a gap.
- Impact names affected users, areas, and scale.
- Customer task is written from the user's perspective.
- Current situation and limits explain why the change is needed.
- Solution is concrete enough to validate.
- Every rule uses testable EARS-style language.
- Existing SOT conflicts are named.
- Confirmed decisions have evidence or user answers.
- Open questions are either answered, accepted as assumptions, or block approval.
- Status values, enums, thresholds, metrics, scope, and terminology match the
  user inputs or expose the conflict explicitly.
- Numeric targets identify their source or remain recommendations/open questions.
- `request.md` links to `impact.md` and keeps only a short investigation status,
  freshness, and coverage-limit summary.

## Stories Review

- Every customer task maps to at least one user story.
- Every request rule maps to at least one scenario.
- Every story has a happy path and at least one edge path.
- Scenarios use Given-When-Then.
- Then clauses describe user-visible or operator-visible results, not hidden implementation details.
- Stories do not contradict `request.md`.
- Rule coverage is not mislabeled as total input-requirement coverage.

## Impact Review

- `impact.md` records SOT paths, freshness, evidence boundary, exact reads,
  candidate evidence, source references, coverage limits, and next reads.
- The Search Route Audit records map-first evidence, memory/human-knowledge
  overlays when available, unread surfaces, and the final route audit.
- Do not store source bodies or raw command transcripts in the impact dossier.

## Verdict

- `PASS`: no blocking findings remain; open items are explicit and accepted as
  assumptions or approval blockers.
- `NEEDS_WORK`: a required input is missing, an evidence conflict is unresolved,
  a numeric rule is unsupported, a search route is incomplete, the dossier has
  an undisclosed limit, or the planning documents contradict each other.

Self Review never changes document status to `approved`.
