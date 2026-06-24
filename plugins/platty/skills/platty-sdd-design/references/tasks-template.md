---
id: "SPEC-<slug>-<YYYY-MM>"
type: "sdd-tasks"
status: "draft"
projectId: "<platty-project-id>"
sourceCommit: "<sot-source-commit-or-unknown>"
sotExportedAt: "<ISO timestamp>"
evidenceBoundary: "<business-docs|static-only|mixed|stale>"
derivedFrom: ["design.md"]
approvedAt:
approvedBy:
---

# Tasks — <Spec title>

## 1. Implementation

Order tasks by dependency: data, backend/domain, API/controller, frontend/screen, jobs/events, observability.

- [ ] 1.1 `<file path>` — <specific change>

## 2. Tests

- [ ] 2.1 `<test file path>` — <specific scenario>

## 3. E2E Scenarios

| # | Given | When | Then | Maps to |
| --- | --- | --- | --- | --- |
| 1 | | | | R1 / US-01 |

## 4. Manual Verification

Only include checks that cannot reasonably be automated.

- [ ] 4.1 <manual check>

## 5. Rollback Checklist

- [ ] 5.1 <rollback action>
