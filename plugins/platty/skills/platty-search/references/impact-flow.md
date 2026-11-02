# Change impact workflow

Use this flow when a question proposes adding, removing, changing, or deleting
code or data. An impact question does not authorize implementation.

1. Complete connection preparation and target clarification.
2. Record the proposed change: identifier and business name, operation,
   affected columns/values, and unresolved scope. If the operation is unstated,
   inspect the plausible add/remove/value-change/delete cases and state that
   interpretation. Ask only when target ambiguity changes the investigation.
3. Establish core data and companion writes using [impact rules](impact.md).
4. Search related writes, reads, comparisons, assignments, and callers using
   [exploration](explore.md). Include all discovered write tables and screen
   conditions; follow cursors and account for incomplete repositories.
5. Resolve the resulting entry points and classify their trigger, guard,
   alternative, or downstream role. Keep all candidates visible. If the user
   narrows a large candidate set, mark unselected rows `Listed only: user excluded`;
   do not silently call the reduced scope a complete impact assessment.
6. Read every relevant trigger, guard, and alternative; trace validators back
   to root service methods and read calls after the initial check. Record
   unread downstream effects and unavailable scheduler/menu evidence.
7. Draft the two-layer answer, apply [review](review.md), and incorporate one
   repair pass. Name unresolved gaps and the searched snapshot.
8. Add a [design draft](design.md) only when explicitly requested.

In noninteractive execution, select a stated interpretation without waiting,
keep other candidates visible, and flag ambiguity. Do not hide unread rows
to fit a call or candidate limit.
