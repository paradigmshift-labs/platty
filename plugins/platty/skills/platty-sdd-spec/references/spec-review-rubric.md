# SDD Spec Review Rubric

Return `PASS` only when every required item is satisfied or explicitly accepted by the user.

## Request Review

- Impact names affected users, areas, and scale.
- Customer task is written from the user's perspective.
- Current situation and limits explain why the change is needed.
- Solution is concrete enough to validate.
- Every rule uses testable EARS-style language.
- Existing SOT conflicts are named.
- Confirmed decisions have evidence or user answers.
- Open questions are either answered, accepted as assumptions, or block approval.
- Evidence appendix includes SOT paths or commands and freshness.

## Stories Review

- Every customer task maps to at least one user story.
- Every request rule maps to at least one scenario.
- Every story has a happy path and at least one edge path.
- Scenarios use Given-When-Then.
- Then clauses describe user-visible or operator-visible results, not hidden implementation details.
- Stories do not contradict `request.md`.
