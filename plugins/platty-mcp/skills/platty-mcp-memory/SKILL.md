---
name: platty-mcp-memory
description: Use when a user explicitly asks to inspect their Platty Memory requests, read approved Memory, request a correction, rationale, constraint, or context, or add, rename, or remove a glossary alias through configured MCP tools.
---

# Platty MCP Memory

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn. Use its `references/tool-mapping.md` for exact
schemas. This skill owns explicit Memory requests and reads;
`platty-mcp-retrieval` owns read-only evidence.

## Write intent and boundary

Submit only after explicit intent such as “remember this”, “request a memory”,
“기억해줘”, or “기억 요청해줘”. New durable context in an ordinary answer remains
read-only; finish that answer and ask “메모리에 추가할까요?” before a request.
The MCP surface is `memory_list/get/request` plus the glossary alias writes
`glossary_alias_add/update/remove`. Memory update/delete, approval and
rejection remain administrator workflows outside MCP: name each as an
unavailable action. Never encode an alias write, a Memory update or a deletion
as a new `memory_request`.
Use configured MCP only; no local CLI, local SOT, generated-SOT edit, or secrets.

## Glossary alias writes

Write an alias only after explicit intent such as “별칭 추가해줘”, “rename this
alias” or “remove this alias”. The server allows only ADMIN or SUPER_ADMIN; a
listed write tool is callable, so let the server decide instead of pre-judging
the caller's role.

1. Resolve `epicId` and the exact canonical term from `glossary_term_list` or
   `glossary_term_search`; read `glossary_alias_list` for an existing alias's
   `id` and `revision`.
2. Every write needs `reason`. Use the user's stated reason; when none is
   stated, ask for it before writing.

   | Intent | Call |
   | --- | --- |
   | Add | `glossary_alias_add({projectId, epicId, canonicalTerm, alias, reason})` |
   | Rename | `glossary_alias_update({projectId, aliasId, alias, reason, expectedRevision})` with the listed revision |
   | Remove | `glossary_alias_remove({projectId, aliasId, reason})` |

3. Read back `glossary_alias_list` for the same EPIC to verify the change.

`FORBIDDEN` means the caller lacks the ADMIN or SUPER_ADMIN glossary policy:
report it, name an administrator as the next owner, and stop. `CONFLICT` means
the alias already exists in that EPIC or the revision moved: re-read
`glossary_alias_list` and report the current state instead of retrying blindly.

## Operating flow

1. When the user did not name a project, omit `projectId`: the server uses
   its default project and echoes the `projectId` it used. Do not call
   `project_list` first. Call `project_list` only when a call returns
   `INVALID_INPUT` naming `projectId` (no default is set; the operator can set
   one with `platty project use <id>`), or when the user names a project
   without its opaque ID. Check the selected route's tools, not an unrelated
   retrieval tier.
2. For own request status/body, call `memory_get` with
   `scope:"own_requests"`, or `memory_list` with that scope and optional
   `requestStatus`. For approved retrieval use `scope:"approved"` and no
   request-status filter. Replay returned approved `next.arguments` unchanged.
3. For a request, resolve the narrowest subject through read-only evidence:

   | Subject | Request anchor / discovery |
   | --- | --- |
   | Explicit project-wide background | `{kind:"project"}`; selected project is sufficient, no overview document required |
   | Capability-wide reason/policy | `{kind:"epic",epicId}` from `epic_list/get` |
   | Rule, design, use case or data object | exact typed get/item_get; `{kind:"document_item",itemId}` when one item owns it, otherwise `{kind:"document",documentId}` |
   | API/screen/event/schedule/DB logic | exact `spec_get(projectId,documentId)`; document anchor |

   Keep a user's explicit project-wide scope. For data fields read the exact
   parent DD and its approved Memory first. A column is not necessarily an
   independently addressable item: use the parent document when no exact item
   exists, retaining the exact field name. Ask once only when live parent/EPIC/
   Spec targets remain tied. IDs come from returned evidence, not titles or keys.
4. Inspect approved Memory on the selected anchor for conflicts or duplicates;
   `memory_list(projectId,scope:"approved",documentId?/epicId?)` is a scoped
   fallback. Project inventory needs no overview anchor. Keep human knowledge
   separate from source facts; report conflicts without silently rewriting them.
5. Choose `memoryKind`: `why` rationale; `correction` wrong/current understanding;
   `constraint` operational restriction; `context` other background. Preserve
   exact user wording/scope and as-of date where meaningful. “No longer used”
   does not establish deleted, no callers, or safe removal.
6. Submit `memory_request` with `projectId`, trimmed `content` (1–4000 chars),
   `memoryKind`, and one closed anchor object. Pass no actor/source/status,
   itemType/itemKey, spoofed parent, confidence, or approval fields.
7. Use the returned receipt and an own-scope verification read to report the
   request ID, exact anchor, kind, pending review state, and verification outcome.
   A receipt confirms submission only; never claim approved/activated or a changed
   runtime behavior. A failed/missing response means submission is unverified.

## Read visibility and completion

Inspect selected `project_get`, `epic_get`, typed document/item and Spec Memory
summaries before discarding evidence. For relevant full rationale/correction/
constraint follow returned `memory_get` with `scope:"approved"`; preview is not
full body. For a DD field inspect parent Memory even after an exact item read.
Use `memory_list` only for explicit scoped inventory or unavailable attached cards.
Approved scope preserves `READ_OWN/READ_ALL`; another actor's pending/rejected
requests and glossary-level Memory remain hidden. List/get anchors may be null
for orphan/incomplete facts; report that state without inventing an anchor.
A valid persisted anchor stays valid without parent hydration. Request receipts
always carry the resolved non-null request anchor.

Read completion names scope, selected IDs, body/status evidence and remaining
limits. Request completion names request ID, anchor, kind, returned approval
state and verification read. Alias write completion names the tool, alias ID,
returned revision and status, and the read-back result. Unavailable Memory
update/delete actions remain a named gap. Memory is an overlay, not generated SOT, source proof, or an approval
that changes authorization.

## Verification

Use `references/pressure-scenarios.md` when changing this skill.
