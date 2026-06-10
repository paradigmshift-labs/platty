import { and, desc, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DB } from '@/db/client.js'
import {
  documentItemDocumentLinks,
  documentItems,
  documentLinks,
  documentVersions,
  documents,
} from '@/db/schema/build_docs.js'
import type { BusinessDocument } from './types.js'

/**
 * Phase C — CLI-owned port of the legacy_generation/build_business_docs satellite
 * writers. These materialize the business doc's SOT output graph (derives_from
 * links, per-item links, the FTS index, and version history) fueled by the EPIC's
 * `systemSourceDocIds`. Ported faithfully; do NOT import from legacy_generation.
 *
 * The version no-op-skip logic and the FTS raw-SQL delete-then-insert ordering are
 * correctness-critical and preserved exactly from the reference.
 */
type BusinessDocsGraphWriteDb = Pick<DB, 'select' | 'insert' | 'delete' | 'run'>

/**
 * Inserts a +1 version snapshot of the document content/summary. Reads the latest
 * `versionNo` for the document (desc) and appends `latest + 1`. SKIPS the insert
 * when the latest snapshot already holds identical content (no-op) so re-saving an
 * unchanged document does not grow the version history.
 */
export function appendVersion(
  db: BusinessDocsGraphWriteDb,
  documentId: string,
  content: Record<string, unknown>,
  summary: string | null,
  sourceRunId?: string,
  sourceCommit?: string,
): void {
  const latest = db.select({ versionNo: documentVersions.versionNo, content: documentVersions.content })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.versionNo))
    .get()
  if (latest && JSON.stringify(latest.content) === JSON.stringify(content)) return
  db.insert(documentVersions).values({
    id: nanoid(),
    documentId,
    versionNo: (latest?.versionNo ?? 0) + 1,
    content,
    summary,
    createdBy: 'llm',
    sourceRunId,
    sourceCommit,
  }).run()
}

/**
 * Replaces the document's derives_from links: deletes existing `document_links`
 * rows whose `fromDocumentId` is this business doc, then inserts a `derives_from`
 * edge to each source doc returned by `linkedDocumentIds` that actually exists in
 * `documents`.
 */
export function replaceDocumentLinks(
  db: BusinessDocsGraphWriteDb,
  documentId: string,
  document: BusinessDocument,
  systemSourceDocIds: string[] = [],
): void {
  db.delete(documentLinks)
    .where(and(
      eq(documentLinks.fromDocumentId, documentId),
      eq(documentLinks.linkType, 'derives_from'),
    ))
    .run()
  for (const sourceId of linkedDocumentIds(document, systemSourceDocIds)) {
    if (sourceId === documentId) continue
    const linked = db.select({ id: documents.id }).from(documents).where(eq(documents.id, sourceId)).get()
    if (!linked) continue
    db.insert(documentLinks).values({
      fromDocumentId: documentId,
      toDocumentId: sourceId,
      linkType: 'derives_from',
      createdBy: 'system',
    }).onConflictDoNothing().run()
  }
}

/**
 * Replaces the per-item SOT satellites for a document: clears the FTS rows + item
 * links for the document's current items, then re-emits `document_item_document_links`
 * (derives_from, role='supporting', item -> each source doc) and `document_items_fts`
 * rows for the items that exist in `document_items`.
 *
 * The CLI owns the `document_items` write itself (worker-submitted items, with its
 * own upsert/stale semantics), so unlike the reference this reads the persisted item
 * rows rather than re-extracting via the resolver. The source docs each item derives
 * from are `systemSourceDocIds` (the resolver's fallback), filtered to ids that
 * exist in `documents`.
 *
 * NOTE: the FTS table is FTS5; an AFTER DELETE trigger on `document_items` removes the
 * matching FTS row, but INSERTs are done in code. We delete FTS rows by item_id BEFORE
 * touching the item links so re-saving is idempotent and the trigger never double-fires
 * against a row we are also clearing here.
 */
export function replaceDocumentItemSatellites(
  db: BusinessDocsGraphWriteDb,
  documentId: string,
  projectId: string,
  systemSourceDocIds: string[] = [],
): void {
  const items = db.select({
    id: documentItems.id,
    itemType: documentItems.itemType,
    title: documentItems.title,
    summary: documentItems.summary,
    content: documentItems.content,
  })
    .from(documentItems)
    .where(eq(documentItems.documentId, documentId))
    .all()

  for (const item of items) {
    db.run(sql`DELETE FROM document_items_fts WHERE item_id = ${item.id}`)
    db.delete(documentItemDocumentLinks)
      .where(and(
        eq(documentItemDocumentLinks.fromItemId, item.id),
        eq(documentItemDocumentLinks.linkType, 'derives_from'),
      ))
      .run()
  }

  const sourceDocumentIds = resolveExistingSourceDocumentIds(db, systemSourceDocIds, documentId)

  for (const item of items) {
    for (const sourceDocumentId of sourceDocumentIds) {
      db.insert(documentItemDocumentLinks).values({
        fromItemId: item.id,
        toDocumentId: sourceDocumentId,
        linkType: 'derives_from',
        role: 'supporting',
        createdBy: 'system',
      }).onConflictDoNothing().run()
    }

    db.run(sql`
      INSERT INTO document_items_fts (item_id, project_id, item_type, title, summary, content)
      VALUES (${item.id}, ${projectId}, ${item.itemType}, ${item.title ?? ''}, ${item.summary ?? ''}, ${JSON.stringify(item.content)})
    `)
  }
}

/**
 * derives_from source ids: `systemSourceDocIds` (sorted) when present, else the
 * document's own `source_doc_ids` plus (data_dictionary) entity `source_refs` minus
 * `model:`-prefixed refs.
 */
export function linkedDocumentIds(document: BusinessDocument, systemSourceDocIds: string[] = []): string[] {
  const ids = new Set(systemSourceDocIds)
  if (ids.size > 0) return [...ids].sort()

  for (const sourceId of document.source_doc_ids ?? []) ids.add(sourceId)
  if (document.type === 'data_dictionary') {
    for (const entity of document.entities) {
      for (const ref of entity.source_refs ?? []) if (!ref.startsWith('model:')) ids.add(ref)
    }
  }
  return [...ids].sort()
}

function resolveExistingSourceDocumentIds(
  db: BusinessDocsGraphWriteDb,
  systemSourceDocIds: string[],
  documentId: string,
): string[] {
  const result: string[] = []
  for (const sourceDocumentId of [...new Set(systemSourceDocIds)].sort()) {
    if (sourceDocumentId === documentId) continue
    const linked = db.select({ id: documents.id }).from(documents).where(eq(documents.id, sourceDocumentId)).get()
    if (!linked) continue
    result.push(sourceDocumentId)
  }
  return result
}
