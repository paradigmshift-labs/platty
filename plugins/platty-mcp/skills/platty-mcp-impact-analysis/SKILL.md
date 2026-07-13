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

## Operating Flow

1. Confirm project, freshness, and MCP tiers through `using-platty-mcp`.
2. Reuse a packet when present; never re-enter retrieval with an existing
   packet. Otherwise invoke retrieval with `routeMode: seed-only` and require it
   to return the packet to this caller without escalating back to impact. Read
   `references/impact-seed-packet.md`.
3. Resolve selected business-document items with `document_resolve` before
   graph tracing, then trace graph upstream/downstream while preserving
   confirmed edges, candidates, relation candidates, omissions, and truncation.
   Use `graph_trace` as the fast structural map of `screen ↔ API ↔ domain ↔ DB`
   plus related event/job/external paths; it never proves detailed behavior alone.
4. Traverse confirmed cross-EPIC evidence through
   `references/cross-epic-traversal.md`.
5. Follow the source ladder exactly: `workspace_repo_list -> select repo ->
   readonly_workspace_shell search -> exact source read`. Call
   `workspace_repo_list` before shell investigation unless repo id and analyzed
   commit are already present.
6. Use `readonly_workspace_shell` only after repository selection, with the
   documented read-only command allowlist and bounded output. Search exact
   identifiers before aliases, then read exact source regions. A grep hit remains
   a candidate until its source region is read. Never write, install, execute
   project code, read blocked secrets, or leave the selected repository root.
7. Build one evidence-matrix entry per target and classify confirmed, likely,
   candidate, or unknown. Add a compact path map that separates confirmed hops,
   candidate/unknown hops, omitted classes, and required exact source reads.
8. Apply `references/impact-dossier.md` and its completion gate.
9. In an SDD context, write or refresh only `impact.md` under the selected
   `~/.platty/specs/<projectId>/SPEC-<slug>-<YYYY-MM>/` and verify readability.

## Completion Gate

Complete only when every seed has an exact spec or explicit gap, graph
directions were attempted, API/screen candidates were classified, confirmed
cross-EPIC edges reached the bound or retained a frontier, repository scope is
known or named as a gap, hard code claims have bounded source reads, and missing
evidence has a next exact read or coverage limit.

If a required branch is incomplete, return and persist a partial dossier.
Never convert empty graph/search output into no impact.

When missing workspace or source tools prevent a source read, persist `partial`,
name the MCP capability gap and next exact read, and use no local fallback.

## Local SDD File Access

The only local exception is selected `impact.md`. Do not read local SOT, run
local Platty CLI commands, inspect unrelated files, or write request, stories,
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
