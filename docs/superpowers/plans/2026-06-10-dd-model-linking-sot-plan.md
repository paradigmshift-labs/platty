# DD Model Linking SOT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure backend business Data Dictionary documents preserve and materialize links from DD entities/fields to extracted models, fields, and db_access relations.

**Architecture:** Treat DD as the business data SOT: logical entities are primary, physical model/table/field links are evidence-backed attachments. No new DB table is required because `document_item_model_links` and `document_item_relation_links` already exist; the work is contract, prompt/schema, persistence, and materialization.

**Tech Stack:** TypeScript, Drizzle ORM, SQLite, Vitest, Platty core business-docs CLI pipeline.

---

## File Structure

- Modify: `packages/core/src/pipeline_modules/build_business_docs_cli/worker_runner.ts`
  - Tighten the DD prompt so workers must use `model_evidence` when present and must preserve model/table/field identifiers in DD output.
- Modify: `packages/core/src/pipeline_modules/build_business_docs_cli/sot/types.ts`
  - Extend the DD SOT type contract for logical entity storage metadata if the existing type is too loose.
- Modify: `packages/core/src/pipeline_modules/build_business_docs_cli/submit.ts`
  - Normalize submitted DD entities/items so model identity survives into persisted `document_items.content`.
- Modify: `packages/core/src/pipeline_modules/build_business_docs_cli/sot/materialize_business_graph.ts`
  - Prefer explicit `model_id`, `model_name`, `table_name`, `field.model_id`, `field.column_name`.
  - Fallback to source API `db_access` relation evidence when DD output omitted explicit model ids.
  - Materialize `document_item_relation_links` from DD item source documents and db_access evidence.
- Modify: `packages/core/tests/pipeline_modules/build_business_docs_cli/materialize_business_graph.test.ts`
  - Add TDD coverage for explicit model ids, db_access fallback, and relation link creation.
- Modify: `packages/core/tests/pipeline_modules/build_business_docs_cli/worker_runner_contract.test.ts`
  - Add schema/prompt contract coverage for DD model evidence preservation.
- Modify: `packages/core/tests/pipeline_modules/build_business_docs_cli/submit.test.ts`
  - Add submit-level integration coverage that a DD save creates model/relation links.

## Schema Decision

No DB migration is required for the current issue.

Existing tables already cover the needed graph:

- `document_item_model_links`
  - DD item to model/field links.
  - Supports `describes_model`, `describes_field`, `uses_model`.
- `document_item_relation_links`
  - DD item to `code_relations`/`doc_relation_links` db_access evidence.
- `document_item_document_links`
  - DD item to source `api_spec`, `screen_spec`, `event_spec`, `schedule_spec`.

Allowed content-contract changes:

- Add/normalize JSON fields inside DD `document_items.content`.
- Example entity item content:

```json
{
  "entity": "기획전",
  "storage": {
    "kind": "model",
    "model_id": "qakQcgFRuZWYlI6Ia73oY:StoreCuration",
    "model_name": "StoreCuration",
    "table_name": "StoreCuration"
  },
  "fields": [
    {
      "name": "기획전 ID",
      "column_name": "id",
      "model_id": "qakQcgFRuZWYlI6Ia73oY:StoreCuration",
      "source_mapping": ["source_document_1"]
    }
  ]
}
```

When DB/model evidence is absent, DD remains valid as logical SOT:

```json
{
  "entity": "외부 결제 승인",
  "storage": {
    "kind": "external",
    "model_id": null,
    "table_name": null
  },
  "fields": []
}
```

Only emit a missing-model gap when source evidence implies backend persistence should exist but no model/relation evidence can be found.

---

### Task 1: Add Failing Tests For Explicit DD Model Links

**Files:**
- Modify: `packages/core/tests/pipeline_modules/build_business_docs_cli/materialize_business_graph.test.ts`

- [ ] **Step 1: Write a failing test for explicit model id linking**

Add a test where the DD item title is Korean but `content.storage.model_id` points to an existing model. This proves linking must not depend on entity title string matching.

```ts
it('materializes DD model links from explicit storage model identity even when entity title is business-language', () => {
  const db = seeded()
  seedStoreCurationModel(db)
  seedDataDictionaryItem(db, {
    id: 'item:dd:store-curation',
    title: '기획전',
    content: {
      entity: '기획전',
      storage: {
        kind: 'model',
        model_id: `${repoId}:StoreCuration`,
        model_name: 'StoreCuration',
        table_name: 'StoreCuration',
      },
      fields: [
        {
          name: '기획전 ID',
          column_name: 'id',
          model_id: `${repoId}:StoreCuration`,
        },
      ],
    },
  })

  const result = materializeDocumentItemModelLinks(db, { projectId, documentId: 'doc:dd:orders' })

  const links = db.select().from(documentItemModelLinks)
    .where(eq(documentItemModelLinks.itemId, 'item:dd:store-curation'))
    .all()
  expect(result.createdLinks).toBe(2)
  expect(links).toEqual(expect.arrayContaining([
    expect.objectContaining({
      modelId: `${repoId}:StoreCuration`,
      fieldName: null,
      linkType: 'describes_model',
      role: 'primary',
    }),
    expect.objectContaining({
      modelId: `${repoId}:StoreCuration`,
      fieldName: 'id',
      linkType: 'describes_field',
      role: 'supporting',
    }),
  ]))
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
npx vitest run packages/core/tests/pipeline_modules/build_business_docs_cli/materialize_business_graph.test.ts
```

Expected: FAIL because `materializeDocumentItemModelLinks()` currently does not read `storage.model_id`.

---

### Task 2: Implement Explicit Model Identity Matching

**Files:**
- Modify: `packages/core/src/pipeline_modules/build_business_docs_cli/sot/materialize_business_graph.ts`

- [ ] **Step 1: Add explicit model terms before loose terms**

Update `modelTermsFromItem()` so it reads:

- `content.model_id`
- `content.modelId`
- `content.storage.model_id`
- `content.storage.modelId`
- `content.storage.model_name`
- `content.storage.table_name`
- field-level `model_id`, `modelId`, `column_name`

Implementation shape:

```ts
function modelTermsFromItem(item: DataDictionaryItem): { modelTerms: Set<string>; fieldTerms: Set<string>; explicitModelIds: Set<string> } {
  const modelTerms = normalizedSet([item.title])
  const fieldTerms = new Set<string>()
  const explicitModelIds = new Set<string>()
  const content = item.content

  addModelIdentityTerms({ modelTerms, explicitModelIds }, content)
  const storage = isRecord(content.storage) ? content.storage : null
  if (storage) addModelIdentityTerms({ modelTerms, explicitModelIds }, storage)

  addRecordTerms(modelTerms, content, ['entity', 'name', 'table_name', 'model', 'model_name'])
  addRefs(modelTerms, content.source_refs)
  addRefs(modelTerms, content.source_mapping)

  const fields = content.fields
  if (Array.isArray(fields)) {
    for (const field of fields) {
      if (!isRecord(field)) continue
      addRecordTerms(fieldTerms, field, ['name', 'column_name'])
      addModelIdentityTerms({ modelTerms, explicitModelIds }, field)
      addRefs(modelTerms, field.source_refs)
      addRefs(modelTerms, field.source_mapping)
    }
  }

  return { modelTerms, fieldTerms, explicitModelIds }
}
```

- [ ] **Step 2: Match explicit model ids first**

Update `matchItemModels()` so exact model id matches win even when title/entity names are Korean.

```ts
const explicitMatch = terms.explicitModelIds.has(normalize(model.id))
const matchedBy = explicitMatch
  ? [model.id]
  : [...terms.modelTerms].filter((term) => modelNames.has(term))
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx vitest run packages/core/tests/pipeline_modules/build_business_docs_cli/materialize_business_graph.test.ts
```

Expected: PASS.

---

### Task 3: Add Relation Fallback Tests For Backend DD

**Files:**
- Modify: `packages/core/tests/pipeline_modules/build_business_docs_cli/materialize_business_graph.test.ts`

- [ ] **Step 1: Write a failing test for source db_access fallback**

Seed:

- one `api_spec` source doc
- one `doc_relation_links` row: `kind='db_access'`, `target='StoreCuration'`
- one DD item with `source_mapping: ['source_document_1']`
- one context/source mapping path, or call a materializer helper with source doc ids directly if the helper is extracted

Expected:

- `document_item_model_links` links DD item to `StoreCuration`
- `document_item_relation_links` links DD item to the db_access relation evidence

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
npx vitest run packages/core/tests/pipeline_modules/build_business_docs_cli/materialize_business_graph.test.ts
```

Expected: FAIL because `document_item_relation_links` are currently not materialized and fallback model matching does not use DD source document db_access evidence.

---

### Task 4: Materialize DD Item Relation Links

**Files:**
- Modify: `packages/core/src/pipeline_modules/build_business_docs_cli/sot/materialize_business_graph.ts`

- [ ] **Step 1: Import existing schemas**

Use existing tables:

```ts
import {
  docRelationLinks,
  documentItemRelationLinks,
} from '@/db/schema/build_docs.js'
```

- [ ] **Step 2: Add result counters**

Extend `MaterializeBusinessGraphResult` with optional relation counters:

```ts
export interface MaterializeBusinessGraphResult {
  deletedLinks: number
  createdLinks: number
  deletedModelLinks?: number
  createdModelLinks?: number
  deletedRelationLinks?: number
  createdRelationLinks?: number
}
```

- [ ] **Step 3: Load source document links for each DD item**

Use `document_item_document_links` rows from each DD item to source technical docs, then load `doc_relation_links` for those source docs where `kind === 'db_access'`.

- [ ] **Step 4: Insert `document_item_relation_links`**

For each DD item and db_access relation:

```ts
db.insert(documentItemRelationLinks).values({
  id: `${item.id}:${relation.documentId}:${relation.kind}:${relation.canonicalTarget ?? relation.target ?? relation.relationId ?? 'unknown'}`,
  itemId: item.id,
  relationId: relation.relationId,
  relationKey: `${relation.documentId}:${relation.kind}:${relation.canonicalTarget ?? relation.target ?? ''}:${relation.operation ?? ''}`,
  repoId: relation.repoId,
  sourceNodeId: relation.sourceNodeId,
  kind: relation.kind,
  target: relation.target,
  operation: relation.operation,
  canonicalTarget: relation.canonicalTarget,
  payloadJson: relation.payloadJson,
  evidenceNodeIdsJson: relation.evidenceNodeIdsJson,
  confidence: relation.confidence,
}).onConflictDoNothing().run()
```

- [ ] **Step 5: Use relation targets as model fallback**

If explicit DD model matching returns no model, match relation targets to `models.name/tableName` using the same `normalizeDbTarget()` semantics used by `loadEpicSources()`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx vitest run packages/core/tests/pipeline_modules/build_business_docs_cli/materialize_business_graph.test.ts
```

Expected: PASS.

---

### Task 5: Tighten DD Worker Contract

**Files:**
- Modify: `packages/core/src/pipeline_modules/build_business_docs_cli/worker_runner.ts`
- Modify: `packages/core/tests/pipeline_modules/build_business_docs_cli/worker_runner_contract.test.ts`

- [ ] **Step 1: Add failing prompt/schema contract test**

Assert the DD prompt contains:

- `model_evidence`
- `storage.model_id`
- `storage.model_name`
- `storage.table_name`
- `fields[].model_id`
- `fields[].column_name`
- “Do not translate model/table/column identifiers”

- [ ] **Step 2: Update DD prompt contract**

For `data_dictionary`, instruct the worker:

```text
When model_evidence is present, every entity that corresponds to a backend model MUST preserve the exact model id/name/table_name from model_evidence in content.storage.
Do not translate model/table/column identifiers.
Use Korean/English business names only in entity.name and field.name.
If no backend model evidence exists, set storage.kind to dto_only, external, derived, or unknown and explain the source mapping.
```

- [ ] **Step 3: Run worker contract tests**

Run:

```bash
npx vitest run packages/core/tests/pipeline_modules/build_business_docs_cli/worker_runner_contract.test.ts
```

Expected: PASS.

---

### Task 6: Submit-Level Integration Test

**Files:**
- Modify: `packages/core/tests/pipeline_modules/build_business_docs_cli/submit.test.ts`

- [ ] **Step 1: Add test for saving DD with model evidence**

Create a DD submission with:

- logical Korean entity name
- `storage.model_id`
- field `column_name`
- source mapping to an API doc with db_access relation

Expected after submit:

- saved business doc exists
- persisted DD item exists
- `document_item_document_links` points to source API
- `document_item_model_links` points to model/field
- `document_item_relation_links` points to db_access relation

- [ ] **Step 2: Run focused submit tests**

Run:

```bash
npx vitest run packages/core/tests/pipeline_modules/build_business_docs_cli/submit.test.ts
```

Expected: PASS.

---

### Task 7: Verify On Existing heroines_back_store Data

**Files:**
- No source edits.

- [ ] **Step 1: Build packages**

Run:

```bash
npm run build
```

Expected: build passes and dist aliases are rewritten.

- [ ] **Step 2: Re-run business graph materializer**

Run:

```bash
node packages/cli/dist/main.js business-docs graph rebuild --project 7SEF58jTZDYvqu4k2N6m3 --json
```

Expected:

- `createdModelLinks > 0`
- `createdRelationLinks > 0`
- no broken links

- [ ] **Step 3: Query verification**

Run:

```bash
node - <<'NODE'
const Database = require('better-sqlite3')
const db = new Database(`${process.env.HOME}/.platty/platty.db`, { readonly: true })
const projectId = '7SEF58jTZDYvqu4k2N6m3'
console.table(db.prepare(`
  select d.scope_id, count(*) as model_links
  from document_item_model_links l
  join document_items i on i.id = l.item_id
  join documents d on d.id = i.document_id
  where d.project_id = ?
    and d.type = 'data_dictionary'
    and d.status = 'active'
    and d.validity = 'fresh'
  group by d.scope_id
`).all(projectId))
console.table(db.prepare(`
  select d.scope_id, l.kind, count(*) as relation_links
  from document_item_relation_links l
  join document_items i on i.id = l.item_id
  join documents d on d.id = i.document_id
  where d.project_id = ?
    and d.type = 'data_dictionary'
    and d.status = 'active'
    and d.validity = 'fresh'
  group by d.scope_id, l.kind
`).all(projectId))
NODE
```

Expected:

- backend DD docs have non-zero model links.
- backend DD docs have non-zero `db_access` relation links.

---

### Task 8: Full Regression

**Files:**
- No source edits.

- [ ] **Step 1: Run focused business-docs suite**

Run:

```bash
npx vitest run packages/core/tests/pipeline_modules/build_business_docs_cli
```

Expected: PASS.

- [ ] **Step 2: Run package checks**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all pass.

- [ ] **Step 3: Commit**

Run:

```bash
git status --short
git add packages/core/src/pipeline_modules/build_business_docs_cli \
  packages/core/tests/pipeline_modules/build_business_docs_cli \
  docs/superpowers/plans/2026-06-10-dd-model-linking-sot-plan.md
git commit -m "fix: link data dictionary items to backend models"
```

Expected: one commit containing tests, implementation, and this plan.

---

## Self-Review

- Spec coverage: The plan covers backend DD model linking, db_access relation linking, prompt/schema contract, submit integration, and live data verification.
- Schema coverage: No migration is required because current graph tables already represent the needed edges.
- Risk: Existing generated DD documents may lack explicit `storage.model_id`; the relation fallback task covers current documents without requiring regeneration.
- Testability: Each behavior has focused unit tests plus submit integration and live DB verification.
