# Typed retrieval receipts

Use the advertised closed schemas. The following argument shapes preserve distinct identities; copy IDs from receipts, never derive them from labels. Every project-scoped call includes `projectId`.

| Evidence | Tool and arguments |
| --- | --- |
| Business document | `business_rule_get`, `use_case_get`, `design_get`, `data_dictionary_get`, `glossary_document_get`: `{projectId, documentId}` |
| Business items | `business_rule_item_get`, `use_case_item_get`, `design_item_get`, `data_dictionary_item_get`: `{projectId, itemIds:[itemId]}`; unique 1–5, whole batch fails on denial |
| Document item map | matching family's `*_item_list({projectId, documentId, limit?, cursor?})` |
| Business → technical | `business_rule_spec_resolve`, `use_case_spec_resolve`, `design_spec_resolve`, `data_dictionary_spec_resolve`: `{projectId, itemId}` OR `{projectId, documentId}`; never both |
| Technical detail | `spec_get({projectId, documentId})`; the spec ID is a document ID, not a `specId` argument |
| Technical → business | `spec_business_resolve({projectId, specDocumentIds:[documentId]})`, unique 1–5 |
| Technical impact | `spec_impact_resolve({projectId, specDocumentIds:[documentId], direction:"both"})`; use incoming only for a requested upstream scope, outgoing for requested downstream, and both for a full technical impact sweep or a request for both directions |
| Graph continuation | `graph_trace({projectId, seeds:[{kind:"service_map",nodeId}], direction:"both", depth:1})` for a service-map receipt during a full sweep; carry the requested impact direction (incoming/upstream, outgoing/downstream, both/full) into graph continuation; use `kind:"code"` only for code-node receipts. Copy returned `next.arguments` when available. Do not mix namespaces or substitute spec/Figma IDs. |
| Business search | select `business_rule_search`, `use_case_search`, `design_search`, `data_dictionary_search`, or `glossary_document_search` from the document type; `{projectId, query, epicId?, matchMode?, limit?, cursor?}` |
| Spec search | `spec_search({projectId, query, specKind:"screen_spec", epicId?, matchMode?, limit?, cursor?})`; `specKind` omitted includes all five kinds |
| Terminology | `glossary_translate({projectId,text})`; `glossary_term_search({projectId,query})`; `glossary_term_get({projectId,termId})` |
| Approved context | `memory_list({projectId,scope:"approved",documentId?,epicId?})`, then `memory_get({projectId,scope:"approved",memoryId})`. Default `own_requests` is request history, not approved context. |
| Workspace source | `workspace_repo_list({projectId})`, then `workspace_sync_status({projectId,repoId})`, `code_search({projectId,repoId,query})`, `readonly_workspace_shell({projectId,repoId,command,cwd?})`. Repository IDs are `repoId`; workspace state is not proof of deployment or analyzed revision. |
| Rendered document | `sot_render({projectId,documentId})` returns `contentOrigin:"database_rendered"`; it is not the original generator Markdown file. |

Follow `nextCursor` until the selected scope is exhausted; carry project/filter/query/mode unchanged. Denial, unavailable backend, or invalid cursor is not an empty successful result. Restart discovery after scope changes rather than combining receipts from different principals/snapshots.

An original artifact request remains unavailable unless an authorized artifact surface actually supplies it. Keep that boundary separate from source availability: a rendered document can be available while its original file is unavailable; code candidates can exist while workspace source reads are unavailable. Record the missing original/source receipt and next exact read. Do not create replacement files or present DB rendering as the original. A source gap blocks only claims requiring that source and keeps the existing SDD readiness gate intact.
