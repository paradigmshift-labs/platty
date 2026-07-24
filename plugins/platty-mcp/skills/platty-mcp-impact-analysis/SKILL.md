---
name: platty-mcp-impact-analysis
description: Use when a Platty MCP question asks what changes, what breaks, blast radius, affected screens/APIs/services, implementation locations, cross-EPIC effects, or technical-design impact.
---

# Platty MCP Impact Analysis

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

**REQUIRED SUB-SKILL:** Use `platty-mcp-retrieval` to produce or reuse an
Impact Seed Packet. Do not recreate semantic discovery, vocabulary, EPIC maps,
business-document gates, or exact spec selection here.

The final product is an Impact Dossier: one evidence-separated, reusable record
of confirmed impact, likely impact, candidates, unknowns, coverage, and next reads.
In SDD context, use
`../using-platty-mcp/references/sdd-revision-contract.md` for product bindings
and downstream fingerprints.

## Operating Flow

1. Confirm project, freshness, and MCP tiers through `using-platty-mcp`.
2. Reuse a packet when present; never re-enter retrieval with an existing
   packet. Otherwise invoke retrieval with `routeMode: seed-only` and require it
   to return the packet to this caller without escalating back to impact. Read
   `references/impact-seed-packet.md`.
3. Resolve selected BR/UCL/DESIGN items with `document_spec_resolve`, read the
   selected Specs, then call `spec_impact_resolve` for direct upstream,
   downstream, or both-direction technical impact. DD remains on its Entity
   route. Use `graph_trace(nodeIds, direction)` as a one-hop structural map of
   `screen ↔ API ↔ domain ↔ DB` plus event/job/external paths. Preserve
   confirmed edges, unresolved candidates, omissions, truncation, and frontier.
   Continue only selected frontier node IDs and maintain a visited set; graph
   evidence alone never proves detailed behavior.
4. Traverse confirmed cross-EPIC evidence through
   `references/cross-epic-traversal.md`.
5. Apply the affected-code-path coverage gate to every implementation anchor.
   The bounded path is not the whole repository: start at the affected UI/caller
   or API/event entry and cover the reachable domain/orchestration,
   DB/external boundary, event producers/consumers, and adjacent tests,
   configuration, and migrations when they exist. Follow the source ladder
   exactly: `workspace_repo_list -> select repo -> readonly_workspace_shell
   search -> exact source read`. Call `workspace_repo_list` before shell
   investigation unless repo id and analyzed commit are already present.
6. Use `readonly_workspace_shell` only after repository selection, with the
   documented read-only command allowlist and bounded output. Search exact
   identifiers before aliases, then read exact source regions. A grep hit remains
   a candidate until its source region is read. Never write, install, execute
   project code, read blocked secrets, or leave the selected repository root.
7. Build one evidence-matrix entry per target and classify confirmed, likely,
   candidate, or unknown. Add a compact path map that separates confirmed hops,
   candidate/unknown hops, omitted classes, and required exact source reads.
   For each implementation anchor, add a code-path coverage row: resolved
   document context, graph candidates and truncation, exact source files/symbols
   read with their roles, consumers checked, and unread candidates with a reason.
   Mark it `confirmed-path` only when every known bounded boundary was actually
   read; otherwise mark it `partial-path`.
   In SDD product-spec context, start from the caller's Macro Approval Packet.
   Prioritize paths that can change an approval-critical promise and stop source
   descent once feasibility and safety can be classified. Do not expand into
   exact edit targets, exhaustive tests, or adjacent implementation detail that
   cannot change §0–§8; those belong to technical design.
8. Apply `references/impact-dossier.md` and its completion gate. Build the exact
   canonical snapshot defined there and compute `impactRevision` with
   `scripts/impact-revision.mjs`; do not hand-hash an inferred envelope or use
   prose order as the revision input. Persist the normalized matrix and coverage
   rows represented by that snapshot so the revision is independently
   reproducible.
9. In an SDD context, require the finalized `productSegmentRevision` and
   `storiesRevision`, then format the final `## 9. 영향도 조사 및 근거`
   appendix bound to those values.
   Classify every coverage limit with affected `R/AC/H/US` ids and
   `BLOCKING | NON_BLOCKING` approval impact. Missing evidence that controls
   money movement, privileged mutation, permission, irreversible state,
   notification guarantees, persistence, or a promised user surface is
   `BLOCKING` until read or until the product promise is narrowed.
   SDD context requires an existing `prd.md` with finalized §0–§8 and a pending
   §9 marker. Update only that appendix, preserving frontmatter and §0–§8
   byte-for-byte, then verify the resulting `prd.md` is readable. If the PRD is
   absent, return control to `platty-mcp-sdd-spec` to persist the reviewed
   product pair first; do not create the PRD from impact analysis.

## Completion Gate

Complete only when every seed has an exact spec or explicit gap, graph
directions were attempted, API/screen candidates were classified, confirmed
cross-EPIC edges reached the bound or retained a frontier, repository scope is
known or named as a gap, every hard code claim has `confirmed-path` bounded
source reads, and missing evidence has a next exact read or coverage limit.

If a required branch is incomplete, return and persist a partial dossier.
Never convert empty graph/search output into no impact.

When missing workspace or source tools prevent a source read, persist `partial`,
name the MCP capability gap and next exact read, and use no local fallback.

## Local SDD File Access

The only local exception is the selected `prd.md`: read it only to locate and
replace §9. Do not read local SOT, run local
Platty CLI commands, inspect unrelated files, or alter §0–§8, user stories,
design, or task files.

## Stop Conditions

- Minimum retrieval is unavailable or project context is ambiguous.
- SDD project id mismatches selected MCP project.
- The impact artifact cannot be written or verified.

Missing source parity does not stop the investigation: weaken or omit the hard
claim, record the exact missing surface and next read, and persist `partial`.
Tied or ambiguous repository ownership also remains `partial`: preserve every
tied candidate, searched scope, and disambiguation read instead of terminating
the workflow.

## Verification

Use `references/pressure-scenarios.md` and the RED baseline before changes.
