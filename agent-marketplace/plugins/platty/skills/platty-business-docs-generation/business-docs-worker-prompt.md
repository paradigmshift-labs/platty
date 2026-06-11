# Business Docs Worker Prompt

Per-task instructions for a worker that owns one leased business-docs task end-to-end. The coordinator (see `SKILL.md`) leases tasks and hands each worker this prompt plus the task's lease token and context handle.

1. Read every context page for the task (`context get`, then `context page` for `target`, `schema`, `source_document_cards`, `source_graph_projection`, and any `relation_evidence` / `model_evidence`). The `schema` page's `expectedJson.expectedItemContent` defines the exact `items[].content` fields for the documentType. The `source_document_cards` page lists `sourceRef` labels (e.g. `source_document_1`).
2. Build one `business-doc.v1` JSON object preserving `documentType`, `scope`, `scopeId`. Set document `evidenceIds` and every `items[].evidenceIds` to `[]`. Link sources only through `source_mapping` `sourceRef` labels. Write prose in the language the `target` page declares in `outputLanguage` — do not assume a fixed language.
3. **Populate `items[]` fully** — every item needs a non-empty `itemType`, `stableKey`, and `content` object matching the schema page. Never emit empty item objects (`{}`); empty items are the most common validation failure. Mirror the same concrete entries in both the canonical `content` arrays and `items[]`.
   - The top-level `content` field must be a JSON object holding the type-specific core array (`content.rules` for `br`, `content.use_cases` for use-case docs, `content.entities` for `data_dictionary`, …). A missing `content` object fails with `$.content must be a JSON object`.
   - `content.rules[]` entries additionally require a `statement` field carrying the rule text (the `items[].content` shape uses `rule`; the canonical array uses `statement`).
   - Keep business prose free of technical identifiers: an API path such as `/api/...` inside `condition`/`rule` text fails with `BUSINESS_LANGUAGE_CONTAMINATION (TECH_API_PATH)`.
4. Submit (write JSON to a temp file to avoid shell escaping):
   `platty business-docs tasks submit --project <p> --task <taskId> --lease-token <token> --attempt <n> --document-json "$(cat <file>)" --json`
   For the first submit, `<n>` is the task's `attemptNo` from the lease response (usually `0`) — a different number fails with `BUSINESS_DOCS_ATTEMPT_CONFLICT`.
5. On `repair_requested`, the submit releases the lease — the old lease token no longer authorizes context reads (`BUSINESS_DOCS_LEASE_CONFLICT`). Lease again with `tasks lease`: the same task comes back with a fresh lease token and a `validation_errors` context page. Read that page, fix every error, and re-submit with `--attempt <nextRepairAttemptNo>` from the repair response. `maxRepairAttempts` defaults to 1, so a second validation failure becomes `failed`.
