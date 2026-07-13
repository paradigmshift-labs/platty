# MCP SDD Design Document Contract

Use this as the single `design.md` shape. The Impact Dossier remains in
`impact.md`; reference its entries instead of copying its matrix or transcript.

## Canonical Revision Rules

- `designRevision` is `sha256:<hex>` over the UTF-8, LF-normalized complete
  design content after removing the mutable frontmatter keys `status`,
  `designRevision`, `approvedRevision`, `approvedAt`, and `approvedBy`.
- `requestRevision` and `storiesRevision` are `sha256:<hex>` over the complete
  persisted UTF-8, LF-normalized `request.md` and `stories.md` bytes, including
  their current `status`. Any content or approval-status change therefore
  changes the corresponding revision.
- `productInputFingerprint` is `sha256:<hex>` over canonical JSON containing
  `requestRevision`, `requestStatus`, `storiesRevision`, and `storiesStatus`.
  Sort object keys lexically and encode as UTF-8. Approval and every task
  preflight reread both product inputs and require this fingerprint to match.
- `impactRevision` is the verified `impact.md` frontmatter revision. It is the
  timestamp-independent canonical evidence snapshot defined by
  `impact-dossier.md`; do not hash the complete persisted file or mutable
  `retrievedAt` to recreate it.
- `impactEvidenceSnapshot` is the lexically sorted list of stable Impact Dossier
  matrix `evidenceId` values used by this design. It records exactly which
  impact evidence the design consumed and remains unchanged when only
  `impact.md.retrievedAt` changes.
- `impactCoverageLimits` is the canonical persisted list. Copy the Impact
  Dossier's `coverageLimits` into this frontmatter field; do not persist a
  second `coverageLimits` alias. The fingerprint sorts this persisted list, so
  source ordering cannot change approval-time recomputation.
- `evidenceFingerprint` is `sha256:<hex>` over canonical JSON containing
  `impactRevision`, sorted `impactEvidenceSnapshot`, sorted `sourceCommits`,
  `contextStatus`, `sourceParity`, `crossEpicTraversalStatus`, and sorted
  `impactCoverageLimits`. Sort object keys lexically, represent `sourceCommits`
  as a lexically sorted list of repo/commit pairs, sort coverage-limit strings
  lexically, encode as UTF-8, and exclude timestamps.
- On a new or revised design, keep `status: draft` and leave
  `approvedRevision`, `approvedAt`, and `approvedBy` empty.
- Explicit approval rereads the file, verifies its current hash, sets
  `approvedRevision = designRevision`, fills `approvedAt` with the current ISO
  timestamp and `approvedBy` with the authenticated actor id or `user`, changes
  `status` to `approved`, persists, and reads back the transition.
- Any later design-content, `productInputFingerprint`, or `evidenceFingerprint`
  change creates another revision, resets `status: draft`, and clears all three
  approval fields.

```yaml
---
id: "SPEC-<slug>-<YYYY-MM>"
type: "sdd-design"
status: draft
projectId: "<projectId>"
outputLanguage: "ko"
contextStatus: "<fresh | stale | unknown>"
sotExportedAt: "<ISO timestamp or unknown>"
derivedFrom: ["request.md", "stories.md", "impact.md"]
requestRevision: "sha256:<hex>"
requestStatus: "<draft | approved>"
storiesRevision: "sha256:<hex>"
storiesStatus: "<draft | approved>"
productInputFingerprint: "sha256:<hex>"
impactArtifact: "impact.md"
impactRevision: "sha256:<hex>"
impactEvidenceSnapshot: []
impactStatus: "<seeded | investigated | partial>"
sourceParity: "<confirmed | partial | unavailable>"
sourceCommits: {}
impactRetrievedAt: "<ISO timestamp or unknown>"
crossEpicTraversalStatus: "<complete | partial | unavailable>"
impactCoverageLimits: []
designRevision: "sha256:<hex>"
evidenceFingerprint: "sha256:<hex>"
approvedRevision:
approvedAt:
approvedBy:
---
```

# Design - <Spec title>

> DRAFT until explicitly approved. Evidence and readiness are audited below.

## 1. One-Page Overview

- **Problem and outcome**: <request-backed summary>
- **Scope and non-goals**: <in/out>
- **Primary technical decision**: <TO-BE summary>
- **Change ids**: <CHG-01, ...>
- **Readiness**: <ready | partial | blocked>

## 2. Inputs, Evidence, Freshness, Assumptions, and Coverage

Build `productInputMetadata` before validating the design input packet. Canonical
product metadata is validated directly. Legacy product metadata is adapted only
in `productInputMetadata` so the same validated design input packet can consume
it without rewriting `request.md`, `stories.md`, or the input artifact.

| Input/evidence | Status or revision | Source parity / Confidence | Coverage and use |
| --- | --- | --- | --- |
| request.md | <approved revision/status> | <confidence> | <rules used> |
| stories.md | <approved revision/status> | <confidence> | <scenarios used> |
| impact.md | Impact status: <status> | Source parity: <status>; Confidence: <summary> | <coverage limits> |

- **Source commits**: <repo -> commit>
- **Impact retrieved at**: <timestamp>
- **Cross-EPIC traversal status**: <status and retained frontier>
- **Assumptions**: <explicit assumptions or none>
- **Accepted risks**: <separately confirmed D-NN decisions or none>

## 3. Impact Assessment

Every row is required. Assessment is `yes/no/unknown`; a blank is invalid. A
`no` must pass the negative-claim gate. An implicated `unknown` blocks ready
unless a separately confirmed `D-NN` risk-acceptance decision records its owner,
rationale, affected ids, bounded scope, and revisit condition in a new design
revision. Generic design approval does not accept the risk and must not remove
the blocker.

| Surface | Assessment (yes/no/unknown) | Reason | Impact evidence | CHG-* or N/A |
| --- | --- | --- | --- | --- |
| API/contract | | | | |
| DB/data | | | | |
| Business logic/state | | | | |
| UI/UX | | | | |
| Jobs/events | | | | |
| External integrations | | | | |
| Security/permissions | | | | |
| Observability/release | | | | |

## 4. Technical AS-IS

Record only evidence-backed current facts. Keep candidates and unknowns out of
hard factual prose and point to their evidence gaps.

| Current area | Current behavior/path | Evidence | Confidence / limit |
| --- | --- | --- | --- |

## 5. Technical TO-BE

Record technical decisions, constraints, and target behavior. Each decision
must map to request rules/stories, impact evidence, and one or more `CHG-*` rows.

| Decision | Target behavior | Rationale | Maps to |
| --- | --- | --- | --- |

## 6. Canonical Change Map

This is the only canonical delta list. Do not create another area-change,
module-change, migration-change, or implementation-delta list elsewhere.

| CHG ID | Surface | AS-IS | TO-BE | Rationale | Owner/repo | Compatibility | Impact evidence | Maps to |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CHG-01 | DB/data | ... | ... | ... | ... | ... | impact.md evidence id | R-01 / US-01-S01 |

Use stable ids `CHG-NN`. Every applicable impact row and every material AS-IS to
TO-BE delta maps to a row; non-applicable surfaces use N/A only in the impact
assessment.

## 7. Conditional Detailed Modules

Expand only applicable `CHG-*` rows and title each subsection with its ids.
Omit non-applicable detailed modules; the Impact Assessment still remains
complete.

### API/Contract - <CHG-NN>

Cover request/response/events, compatibility, consumers, errors, permissions,
and versioning as applicable.

### DB/Data - <CHG-NN>

Detailed DB/data design is conditional, but the DB/data impact assessment is
always required. When applicable, cover:

- affected stores and source of truth;
- current and target shape plus read/write paths;
- schema, index, and constraint changes;
- transaction, concurrency, and idempotency behavior;
- data-backfill and reconciliation;
- lock/load risk;
- old/new reader-writer compatibility;
- expand, compatible deploy, backfill, validate, switch, and contract phases;
- rollback/restore or roll-forward-only behavior;
- privacy, retention, and deletion;
- production validation and telemetry.

### Business Logic/State - <CHG-NN>

Cover rules, state transitions, invariants, failure handling, and idempotency.

### UI/UX - <CHG-NN>

Cover states, transitions, errors, accessibility, and API dependencies.

### Jobs/Events And External Integrations - <CHG-NN>

Cover producers/consumers, ordering, retries, deduplication, timeouts, contracts,
and operational ownership.

### Security/Permissions And Observability - <CHG-NN>

Cover authorization, sensitive data, auditability, metrics, logs, alerts, and
release signals.

## 8. Delivery Safety

| CHG ID | Rollout/dependency order | Compatibility phase | Data safety | Rollback or roll-forward | Release signal |
| --- | --- | --- | --- | --- | --- |

Include migration/backfill sequencing, reversible boundaries, production
validation, and explicit stop conditions where applicable.

## 9. Verification and Traceability

Every `CHG-*` row maps to at least one `VER-*` row. Every request rule and stable
story scenario maps to verification or an explicit evidence gap.

| VER ID | Rule/scenario | CHG IDs | Test level | Expected evidence | Exact command or evidence gap |
| --- | --- | --- | --- | --- | --- |
| VER-01 | R-01 / US-01-S01 | CHG-01 | integration | <observable result> | `<command>` |

Use stable ids `VER-NN`. Commands must be exact and runnable when known; do not
invent commands when evidence is missing.

## 10. Risks, Open Decisions, Evidence Appendix, and Self Review

### Risks And Open Decisions

Use stable decision ids `D-NN`. Risk acceptance is a separate product/technical
decision, not a side effect of approving the design. It must be confirmed before
the new design revision is presented for approval.

| ID | Type | Risk/decision | Affected ids | Owner | Rationale and bounded scope | Revisit condition | Confirmation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-01 | risk_acceptance | <implicated unknown> | <R/US/CHG/evidence ids> | <owner> | <why and exact boundary> | <observable trigger/date> | <acceptedBy / acceptedAt> |

### Evidence Appendix

Reference `impact.md` dossier entry ids and bounded source references. Do not
copy the dossier matrix, complete snippets, or search transcript.

| Design claim / CHG | Dossier evidence id | Repo/commit/path/symbol | Confidence / limit |
| --- | --- | --- | --- |

### Self Review

Apply `design-review-rubric.md` as the single readiness owner and record:

```yaml
verdict: PASS | NEEDS_WORK
readiness: ready | partial | blocked
blockingFindings: []
warnings: []
requirementCoverage: {}
productInputAudit: {}
impactAssessmentAudit: {}
changeCoverage: {}
verificationCoverage: {}
sourceParityAudit: {}
taskGate: "<blocked and NEEDS_WORK are not approval-eligible; otherwise open only after explicit approval of this current design revision>"
```
